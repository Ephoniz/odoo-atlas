"""Discover addons, read manifests, compute load order."""
from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path

from .graph import Graph


@dataclass
class Addon:
    name: str
    path: Path
    manifest: dict
    depends: list[str] = field(default_factory=list)
    data_files: list[str] = field(default_factory=list)
    assets: dict = field(default_factory=dict)


def discover_addons(odoo_root: Path) -> dict[str, Addon]:
    addons: dict[str, Addon] = {}
    for base in (odoo_root / "odoo" / "addons", odoo_root / "addons"):
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            mf = d / "__manifest__.py"
            if not mf.is_file():
                continue
            try:
                manifest = ast.literal_eval(mf.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(manifest, dict):
                continue
            depends = list(manifest.get("depends", []))
            if d.name != "base" and "base" not in depends and not depends:
                depends = ["base"]
            addons[d.name] = Addon(
                name=d.name,
                path=d,
                manifest=manifest,
                depends=depends,
                data_files=list(manifest.get("data", [])),
                assets=dict(manifest.get("assets", {})),
            )
    return addons


def load_order(addons: dict[str, Addon]) -> list[str]:
    """Topological order; unknown dependencies are treated as already loaded."""
    order: list[str] = []
    state: dict[str, int] = {}

    def visit(name: str) -> None:
        if state.get(name) == 2:
            return
        if state.get(name) == 1:
            return  # cycle guard
        state[name] = 1
        a = addons.get(name)
        if a:
            for dep in sorted(a.depends):
                if dep in addons:
                    visit(dep)
        state[name] = 2
        order.append(name)

    for name in sorted(addons):
        visit(name)
    return order


def add_module_nodes(g: Graph, addons: dict[str, Addon], order: list[str]) -> None:
    rank = {name: i for i, name in enumerate(order)}
    for name, a in addons.items():
        m = a.manifest
        g.node(
            f"mod:{name}",
            "module",
            name,
            module=name,
            title=m.get("name"),
            category=m.get("category"),
            rank=rank.get(name),
            application=bool(m.get("application")),
            auto_install=bool(m.get("auto_install")),
        )
        g.nodes[f"mod:{name}"].detail.update(
            summary=m.get("summary"),
            description=(m.get("description") or "").strip(),
            version=m.get("version"),
            license=m.get("license"),
            depends=a.depends,
            data=a.data_files,
            assets={k: len(v) for k, v in a.assets.items()} if a.assets else {},
        )
    for name, a in addons.items():
        for dep in a.depends:
            if dep not in addons:
                g.node(f"mod:{dep}", "module", dep, module=dep, external=True)
            g.edge(f"mod:{name}", f"mod:{dep}", "depends")
