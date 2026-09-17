"""Views, actions (from manifest data files) and static QWeb templates."""
from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET

from .graph import Graph
from .manifests import Addon

VIEW_ROOTS = {"form", "list", "tree", "kanban", "search", "calendar", "graph", "pivot", "activity", "qweb", "cohort", "gantt", "map"}
COMPONENT_TAG = re.compile(r"^[A-Z][A-Za-z0-9_]*$")


def _xmlid(module: str, ref: str) -> str:
    return ref if "." in ref else f"{module}.{ref}"


def _iter_records(tree: ET.ElementTree):
    for rec in tree.iter("record"):
        yield rec


def _field(rec: ET.Element, name: str) -> ET.Element | None:
    for f in rec.findall("field"):
        if f.get("name") == name:
            return f
    return None


def scan_data_xml(g: Graph, addon: Addon, odoo_root: Path) -> None:
    for rel in addon.data_files:
        if not rel.endswith(".xml"):
            continue
        p = addon.path / rel
        if not p.is_file():
            continue
        try:
            tree = ET.parse(p)
        except ET.ParseError:
            continue
        rel_file = p.relative_to(odoo_root).as_posix()
        for rec in _iter_records(tree):
            model = rec.get("model")
            rid = rec.get("id")
            if not model or not rid:
                continue
            xmlid = _xmlid(addon.name, rid)
            if model == "ir.ui.view":
                _view(g, addon, rec, xmlid, rel_file)
            elif model.startswith("ir.actions."):
                _action(g, addon, rec, xmlid, model, rel_file)
            elif model == "ir.cron":
                _cron(g, addon, rec, xmlid, rel_file)


def _view(g: Graph, addon: Addon, rec: ET.Element, xmlid: str, rel_file: str) -> None:
    model_f = _field(rec, "model")
    model = (model_f.text or "").strip() if model_f is not None else None
    inherit = _field(rec, "inherit_id")
    inherit_ref = _xmlid(addon.name, inherit.get("ref")) if inherit is not None and inherit.get("ref") else None
    arch = _field(rec, "arch")
    mode_f = _field(rec, "mode")
    vtype = None
    widgets: set[str] = set()
    js_class: set[str] = set()
    xpaths: list[str] = []
    fields_used: set[str] = set()
    buttons: list[dict] = []
    arch_text = ""
    if arch is not None:
        children = list(arch)
        if children:
            root = children[0]
            if root.tag in VIEW_ROOTS:
                vtype = "list" if root.tag == "tree" else root.tag
            elif root.tag == "data":
                inner = [c for c in root if c.tag != "xpath"]
                if inner and inner[0].tag in VIEW_ROOTS:
                    vtype = inner[0].tag
            for el in arch.iter():
                w = el.get("widget")
                if w:
                    widgets.add(w)
                jc = el.get("js_class")
                if jc:
                    js_class.add(jc)
                if el.tag == "xpath" and el.get("expr"):
                    xpaths.append(el.get("expr"))
                if el.tag == "field" and el.get("name"):
                    fields_used.add(el.get("name"))
                if el.tag == "button" and el.get("name"):
                    buttons.append({"name": el.get("name"), "type": el.get("type"), "string": el.get("string")})
            try:
                arch_text = "".join(ET.tostring(c, encoding="unicode") for c in children)
            except Exception:
                arch_text = ""
    if arch_text and len(arch_text) > 8000:
        arch_text = arch_text[:8000] + "\n<!-- … truncated -->"
    vid = f"view:{xmlid}"
    g.node(
        vid, "view", xmlid, module=addon.name,
        model=model, vtype=vtype, inherit=bool(inherit_ref),
        widgets=sorted(widgets) or None, js_class=sorted(js_class) or None,
    )
    g.nodes[vid].detail.update(
        file=rel_file, inherit_id=inherit_ref, mode=(mode_f.text if mode_f is not None else None),
        xpaths=xpaths, fields=sorted(fields_used), buttons=buttons, arch=arch_text,
    )
    g.edge(f"mod:{addon.name}", vid, "defines")
    if model:
        g.node(f"model:{model}", "model", model)
        g.edge(vid, f"model:{model}", "view_of")
        for fname in fields_used:
            g.edge(vid, f"field:{model}.{fname}", "shows_field")
        for b in buttons:
            if b.get("type") == "object":
                g.edge(vid, f"method:{model}.{b['name']}", "button_calls", label=b.get("string"))
            elif b.get("type") == "action":
                g.edge(vid, f"action:{_xmlid(addon.name, b['name'])}", "button_opens", label=b.get("string"))
    if inherit_ref:
        g.node(f"view:{inherit_ref}", "view", inherit_ref)
        g.edge(vid, f"view:{inherit_ref}", "view_inherits", label=", ".join(xpaths[:3]) if xpaths else None)
    for w in widgets:
        g.node(f"reg:fields.{w}", "registry", w, category="fields")
        g.edge(vid, f"reg:fields.{w}", "uses_widget", label=w)
    for jc in js_class:
        g.node(f"reg:views.{jc}", "registry", jc, category="views")
        g.edge(vid, f"reg:views.{jc}", "uses_js_class", label=jc)


def _action(g: Graph, addon: Addon, rec: ET.Element, xmlid: str, model: str, rel_file: str) -> None:
    def txt(name: str):
        f = _field(rec, name)
        return (f.text or "").strip() if f is not None and f.text else (f.get("ref") if f is not None else None)

    aid = f"action:{xmlid}"
    atype = model.split(".")[-1]
    g.node(
        aid, "action", xmlid, module=addon.name,
        atype=atype, name_=txt("name"), res_model=txt("res_model"), view_mode=txt("view_mode"), tag=txt("tag"),
    )
    g.nodes[aid].detail.update(file=rel_file, domain=txt("domain"), context=txt("context"), help=txt("help"))
    g.edge(f"mod:{addon.name}", aid, "defines")
    res_model = txt("res_model")
    if res_model:
        g.node(f"model:{res_model}", "model", res_model)
        g.edge(aid, f"model:{res_model}", "opens_model")
    view_id = _field(rec, "view_id")
    if view_id is not None and view_id.get("ref"):
        ref = _xmlid(addon.name, view_id.get("ref"))
        g.node(f"view:{ref}", "view", ref)
        g.edge(aid, f"view:{ref}", "opens_view")
    tag = txt("tag")
    if tag and atype == "client":
        g.node(f"reg:actions.{tag}", "registry", tag, category="actions")
        g.edge(aid, f"reg:actions.{tag}", "client_action")
    # ir.actions.server with code calling model methods
    code = txt("code")
    if code:
        for m in re.findall(r"\.(\w+)\(", code):
            g.edge(aid, f"method:{res_model}.{m}", "calls") if res_model else None


def _cron(g: Graph, addon: Addon, rec: ET.Element, xmlid: str, rel_file: str) -> None:
    def txt(name: str):
        f = _field(rec, name)
        return (f.text or "").strip() if f is not None and f.text else (f.get("ref") if f is not None else None)

    code = txt("code") or ""
    model_ref = _field(rec, "model_id")
    model_name = None
    if model_ref is not None and model_ref.get("ref"):
        # model_sale_order -> sale.order  (best effort)
        ref = model_ref.get("ref").split(".")[-1]
        if ref.startswith("model_"):
            model_name = ref[len("model_"):].replace("_", ".")
    cid = f"cron:{xmlid}"
    g.node(cid, "cron", xmlid, module=addon.name, name_=txt("name"), interval=f"{txt('interval_number')} {txt('interval_type')}")
    g.nodes[cid].detail.update(file=rel_file, code=code, model=model_name)
    g.edge(f"mod:{addon.name}", cid, "defines")
    if model_name:
        m = re.search(r"model\.(\w+)\(", code)
        if m:
            g.edge(cid, f"method:{model_name}.{m.group(1)}", "calls")
        else:
            g.edge(cid, f"model:{model_name}", "uses_model")


def scan_qweb(g: Graph, addon: Addon, odoo_root: Path) -> None:
    static = addon.path / "static" / "src"
    if not static.is_dir():
        return
    for p in static.rglob("*.xml"):
        if "tests" in p.relative_to(static).parts:
            continue
        try:
            tree = ET.parse(p)
        except ET.ParseError:
            continue
        rel_file = p.relative_to(odoo_root).as_posix()
        for t in tree.iter("t"):
            name = t.get("t-name")
            if not name:
                continue
            tid = f"tpl:{name}"
            inherit = t.get("t-inherit")
            mode = t.get("t-inherit-mode")
            comps: set[str] = set()
            calls: set[str] = set()
            for el in t.iter():
                if COMPONENT_TAG.match(el.tag):
                    comps.add(el.tag)
                c = el.get("t-call")
                if c and not c.startswith("{"):
                    calls.add(c)
            try:
                src = ET.tostring(t, encoding="unicode")
            except Exception:
                src = ""
            if len(src) > 8000:
                src = src[:8000] + "\n<!-- … truncated -->"
            g.node(tid, "template", name, module=addon.name, inherit=bool(inherit), mode=mode, n_components=len(comps))
            g.nodes[tid].detail.update(file=rel_file, line=getattr(t, "sourceline", None), source=src, components=sorted(comps), calls=sorted(calls))
            g.edge(f"mod:{addon.name}", tid, "defines")
            if inherit:
                g.node(f"tpl:{inherit}", "template", inherit)
                g.edge(tid, f"tpl:{inherit}", "t_inherit", label=mode)
            for c in calls:
                g.node(f"tpl:{c}", "template", c)
                g.edge(tid, f"tpl:{c}", "t_call")
            for c in comps:
                # Resolved to a component node later in build.py (by class name).
                g.edge(tid, f"cmpname:{c}", "renders_component")
