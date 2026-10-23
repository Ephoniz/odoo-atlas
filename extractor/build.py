"""Orchestrate extraction and write the data shards the web app loads.

Output layout (under --out):
  meta.json            version, counts, node types, edge kinds, module list
  index.json           every node: {id, t, n, m, ...brief}
  edges.json           every edge: {s, t, k, ...meta}
  detail/<module>.json id -> detail payload for nodes owned by that module
  detail/_unowned.json ids without a module (external references)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

from .graph import Graph
from .js_graph import build_js, run_js_parser
from .manifests import add_module_nodes, discover_addons, load_order
from .py_models import build_controllers, build_models, scan_controllers, scan_python
from .xml_data import scan_data_xml, scan_qweb

PLACEHOLDER_TYPES = {"model", "field", "method", "view", "template", "component", "jsclass", "service", "hook", "registry", "route"}


def prune_dangling(g: Graph) -> int:
    """Edges to ids that were never declared (e.g. method:x.y from a `calls` guess).

    Referenced-but-undeclared *models/templates/components* are kept as ghost nodes;
    referenced-but-undeclared fields/methods are dropped (too noisy)."""
    removed = 0
    keep = []
    for e in g.edges:
        for end in (e.source, e.target):
            if end not in g.nodes:
                prefix = end.split(":", 1)[0]
                if prefix in ("field", "method", "view", "action", "hook"):
                    break
                g.node(end, {"tpl": "template", "cmp": "component", "svc": "service", "reg": "registry", "route": "route", "mod": "module"}.get(prefix, prefix), end.split(":", 1)[1], external=True)
        else:
            keep.append(e)
            continue
        removed += 1
    g.edges = keep
    return removed


def mark_ghosts(g: Graph) -> None:
    """Nodes referenced but not defined by any scanned module."""
    defined = {e.target for e in g.edges if e.kind in ("defines", "serves")}
    for n in g.nodes.values():
        if n.type == "module":
            continue
        if n.id not in defined and not n.brief.get("external"):
            n.brief["ghost"] = True


def write_output(g: Graph, out: Path, version: str, modules: list[str], t0: float) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "detail").mkdir(exist_ok=True)

    index = []
    for n in g.nodes.values():
        rec = {"id": n.id, "t": n.type, "n": n.name}
        if n.module:
            rec["m"] = n.module
        rec.update(n.brief)
        index.append(rec)
    (out / "index.json").write_text(json.dumps(index, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    edges = []
    for e in g.edges:
        rec = {"s": e.source, "t": e.target, "k": e.kind}
        rec.update(e.meta)
        edges.append(rec)
    (out / "edges.json").write_text(json.dumps(edges, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    shards: dict[str, dict] = {}
    for n in g.nodes.values():
        if not n.detail:
            continue
        shards.setdefault(n.module or "_unowned", {})[n.id] = n.detail
    for mod, payload in shards.items():
        (out / "detail" / f"{mod}.json").write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    meta = {
        "version": version,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsed_s": round(time.time() - t0, 1),
        "modules": modules,
        "counts": {"nodes": len(g.nodes), "edges": len(g.edges)},
        "node_types": dict(Counter(n.type for n in g.nodes.values())),
        "edge_kinds": dict(Counter(e.kind for e in g.edges)),
        "shards": sorted(shards),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="odoo-atlas-extract")
    ap.add_argument("--odoo", required=True, type=Path, help="path to an odoo/odoo checkout")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--version", default=None, help="label, e.g. 19.0 (default: odoo/release.py, then the checkout's branch)")
    ap.add_argument("--only", default=None, help="comma-separated addon names to restrict to")
    ap.add_argument("--no-js", action="store_true")
    args = ap.parse_args(argv)

    t0 = time.time()
    odoo_root: Path = args.odoo.resolve()
    version = args.version or _read_version(odoo_root)

    addons = discover_addons(odoo_root)
    if args.only:
        wanted = set(args.only.split(","))
        addons = {k: v for k, v in addons.items() if k in wanted}
    order = load_order(addons)
    rank = {n: i for i, n in enumerate(order)}
    print(f"[atlas] {len(addons)} addons, load order: {', '.join(order)}", file=sys.stderr)

    g = Graph()
    add_module_nodes(g, addons, order)

    classes = []
    controllers = []
    for name in order:
        a = addons[name]
        cs = scan_python(a, odoo_root)
        classes.extend(cs)
        controllers.extend(scan_controllers(a, odoo_root))
        print(f"[atlas] {name}: {len(cs)} model classes", file=sys.stderr)
    build_models(g, classes, rank)
    build_controllers(g, controllers)

    for name in order:
        a = addons[name]
        scan_data_xml(g, a, odoo_root)
        scan_qweb(g, a, odoo_root)

    if not args.no_js:
        files = run_js_parser(odoo_root, addons)
        print(f"[atlas] js: {len(files)} files parsed", file=sys.stderr)
        build_js(g, files)

    removed = prune_dangling(g)
    mark_ghosts(g)
    print(f"[atlas] pruned {removed} dangling edges", file=sys.stderr)

    write_output(g, args.out, version, order, t0)
    print(f"[atlas] wrote {len(g.nodes)} nodes / {len(g.edges)} edges to {args.out} in {time.time() - t0:.1f}s", file=sys.stderr)
    return 0


def _read_version(odoo_root: Path) -> str:
    rel = odoo_root / "odoo" / "release.py"
    if rel.is_file():
        for line in rel.read_text(encoding="utf-8").splitlines():
            if line.startswith("version_info"):
                try:
                    import ast
                    v = ast.literal_eval(line.split("=", 1)[1].strip())
                    return f"{v[0]}.{v[1]}" if isinstance(v, tuple) else str(v)
                except Exception:
                    pass
    # Sparse checkouts often skip odoo/release.py; the branch name (19.0, saas-18.4) is the next best label.
    head = odoo_root / ".git" / "HEAD"
    if head.is_file():
        ref = head.read_text(encoding="utf-8").strip()
        if ref.startswith("ref: refs/heads/"):
            branch = ref.removeprefix("ref: refs/heads/")
            if re.fullmatch(r"(saas-)?\d+\.\d+", branch):
                return branch
    return "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
