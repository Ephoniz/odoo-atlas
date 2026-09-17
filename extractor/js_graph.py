"""Turn the output of js_owl.mjs into graph nodes and edges."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .graph import Graph
from .manifests import Addon

HERE = Path(__file__).parent


def run_js_parser(odoo_root: Path, addons: dict[str, Addon]) -> list[dict]:
    dirs = ",".join(str(a.path) for a in addons.values() if (a.path / "static" / "src").is_dir())
    if not dirs:
        return []
    proc = subprocess.run(
        ["node", "--stack-size=16000", str(HERE / "js_owl.mjs"), str(odoo_root), dirs],
        capture_output=True, text=True, encoding="utf-8", cwd=str(HERE), shell=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"js_owl.mjs failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def build_js(g: Graph, files: list[dict]) -> None:
    # Pass 1: index classes by name so `extends` and `static components` resolve.
    class_index: dict[str, list[tuple[str, dict, dict]]] = {}
    for f in files:
        for c in f["classes"]:
            class_index.setdefault(c["name"], []).append((f["module"], c, f))

    def resolve(name: str, prefer_module: str | None) -> str | None:
        cands = class_index.get(name)
        if not cands:
            return None
        for mod, c, _ in cands:
            if mod == prefer_module:
                return f"cmp:{mod}.{name}"
        mod, c, _ = cands[0]
        return f"cmp:{mod}.{name}"

    # Determine which classes are OWL components: extends Component or a known component (transitively).
    is_component: dict[str, bool] = {}

    def component_like(name: str, seen: set[str]) -> bool:
        if name in ("Component",):
            return True
        if name in is_component:
            return is_component[name]
        if name in seen:
            return False
        seen.add(name)
        cands = class_index.get(name)
        if not cands:
            # Heuristic: unresolved parents that look like components.
            return name.endswith(("Component", "Controller", "Renderer", "Field", "Dialog", "Popover", "Widget", "Item", "Menu"))
        _, c, _ = cands[0]
        ext = c.get("extends")
        res = bool(ext) and component_like(ext.split(".")[-1], seen)
        is_component[name] = res
        return res

    for f in files:
        module = f["module"]
        g.node(f"mod:{module}", "module", module, module=module)
        for c in f["classes"]:
            comp = component_like(c["name"], set())
            ntype = "component" if comp else "jsclass"
            cid = f"cmp:{module}.{c['name']}"
            g.node(
                cid, ntype, c["name"], module=module,
                template=c["template"], extends=c["extends"], n_children=len(c["components"]),
                services=c["services"] or None, exported=c["exported"],
            )
            g.nodes[cid].detail.update(
                file=f["file"], line=c["line"], end_line=c["endLine"], props=c["props"],
                methods=c["methods"], hooks=c["hooks"], components=c["components"], orm=c["orm"], rpc=c["rpc"], source=c.get("source"),
                imports=[i for i in f["imports"]],
            )
            g.edge(f"mod:{module}", cid, "defines")
            if c["template"] and c["template"] != "<inline xml>":
                g.node(f"tpl:{c['template']}", "template", c["template"])
                g.edge(cid, f"tpl:{c['template']}", "renders")
            if c["extends"]:
                parent = c["extends"].split(".")[-1]
                if parent != "Component":
                    pid = resolve(parent, module)
                    if pid:
                        g.edge(cid, pid, "extends")
                    else:
                        g.node(f"cmp:?.{parent}", "component" if comp else "jsclass", parent, external=True)
                        g.edge(cid, f"cmp:?.{parent}", "extends")
            for child in c["components"]:
                if child.startswith("..."):
                    continue
                chid = resolve(child, module)
                if chid:
                    g.edge(cid, chid, "child_component")
            for s in c["services"]:
                g.node(f"svc:{s}", "service", s)
                g.edge(cid, f"svc:{s}", "uses_service")
            for h in c["hooks"]:
                if h == "useService":
                    continue
                g.node(f"hook:{h}", "hook", h)
                g.edge(cid, f"hook:{h}", "uses_hook")
            for o in c["orm"]:
                _orm_edge(g, cid, o)
            for r in c["rpc"]:
                g.node(f"route:{r}", "route", r)
                g.edge(cid, f"route:{r}", "rpc_route")

        for s in f["services"]:
            sid = f"svc:{s['key']}"
            g.node(sid, "service", s["key"], module=module, n_deps=len(s["dependencies"]))
            g.nodes[sid].detail.update(file=f["file"], line=s["line"], dependencies=s["dependencies"], orm=s.get("orm", []), rpc=s.get("rpc", []))
            g.edge(f"mod:{module}", sid, "defines")
            for d in s["dependencies"]:
                g.node(f"svc:{d}", "service", d)
                g.edge(sid, f"svc:{d}", "uses_service")
            for o in s.get("orm", []):
                _orm_edge(g, sid, o)
            for r in s.get("rpc", []):
                g.node(f"route:{r}", "route", r)
                g.edge(sid, f"route:{r}", "rpc_route")

        for r in f["registry"]:
            if r["category"] == "services":
                continue
            rid = f"reg:{r['category']}.{r['key']}"
            g.node(rid, "registry", r["key"], module=module, category=r["category"], sequence=r.get("sequence"))
            g.nodes[rid].detail.update(file=f["file"], line=r["line"], value_kind=r["valueKind"])
            g.edge(f"mod:{module}", rid, "defines")
            for ref in r["refs"]:
                cid = resolve(ref, module)
                if cid:
                    g.edge(rid, cid, "registers")

        for p in f["patches"]:
            target = resolve(p["target"], None)
            if not target:
                target = f"cmp:?.{p['target']}"
                g.node(target, "jsclass", p["target"], external=True)
            elif target not in g.nodes:
                # Defined in a module processed later; create the shell now.
                mod = target.split(":", 1)[1].split(".", 1)[0]
                g.node(target, "component", p["target"], module=mod)
            g.edge(f"mod:{module}", target, "patches", label=", ".join(p["members"][:6]), via=module)
            g.nodes[target].detail.setdefault("patched_by", []).append({"module": module, "file": f["file"], "line": p["line"], "members": p["members"]})

        for h in f["hooks"]:
            hid = f"hook:{h['name']}"
            g.node(hid, "hook", h["name"], module=module, exported=h["exported"])
            g.nodes[hid].detail.update(file=f["file"], line=h["line"])
            g.edge(f"mod:{module}", hid, "defines")
            for s in h["services"]:
                g.node(f"svc:{s}", "service", s)
                g.edge(hid, f"svc:{s}", "uses_service")

    # Resolve template -> component references created by xml_data (cmpname:X).
    for e in list(g.edges):
        if e.target.startswith("cmpname:"):
            name = e.target[len("cmpname:"):]
            src_mod = g.nodes[e.source].module if e.source in g.nodes else None
            cid = resolve(name, src_mod)
            if cid:
                e.target = cid
            else:
                e.target = None  # type: ignore[assignment]
    g.edges = [e for e in g.edges if e.target]


def _orm_edge(g: Graph, source: str, o: dict) -> None:
    model = o.get("model")
    method = o.get("method")
    if not model or model.startswith("<"):
        # Dynamic model: keep as a note on the node, no edge.
        g.nodes[source].detail.setdefault("dynamic_orm", []).append(o)
        return
    g.node(f"model:{model}", "model", model)
    if method and method not in ("read", "write", "create", "unlink", "search", "searchRead", "searchCount",
                                 "nameGet", "readGroup", "formattedReadGroup", "webReadGroup", "webSearchRead",
                                 "webRead", "webSave", "webSaveMulti", "webResequence"):
        g.edge(source, f"method:{model}.{method}", "rpc", label=method)
    else:
        g.edge(source, f"model:{model}", "rpc", label=method)
