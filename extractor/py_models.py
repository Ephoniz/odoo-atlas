"""Static extraction of Odoo models, fields and methods via `ast`.

Every module that touches a model contributes a *layer*. Model, field and method
nodes are merged across layers so the graph shows one node per concept with a
stack of contributing modules (the "strata").
"""
from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .graph import Graph
from .manifests import Addon

MODEL_BASES = {"Model", "TransientModel", "AbstractModel"}
RELATIONAL = {"Many2one", "One2many", "Many2many", "Many2oneReference"}
ORM_CALLS = {"call", "search", "search_read", "read", "write", "create", "unlink", "browse", "read_group"}

_INTERESTING_KW = {
    "string", "comodel_name", "inverse_name", "compute", "inverse", "search", "related",
    "store", "readonly", "required", "help", "selection", "default", "index", "tracking",
    "copy", "ondelete", "relation", "column1", "column2", "precompute", "recursive",
    "groups", "company_dependent", "translate", "domain",
}


@dataclass
class ClassInfo:
    module: str
    file: str
    line: int
    end_line: int
    class_name: str
    name: str | None
    inherit: list[str]
    inherits: dict[str, str]
    kind: str  # Model / TransientModel / AbstractModel
    attrs: dict[str, Any]
    fields: list[dict]
    methods: list[dict]
    docstring: str | None


@dataclass
class ModelAcc:
    name: str
    layers: list[ClassInfo] = field(default_factory=list)
    fields: dict[str, dict] = field(default_factory=dict)      # name -> merged
    methods: dict[str, list[dict]] = field(default_factory=dict)  # name -> layers


def _const(node: ast.AST) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.List, ast.Tuple)):
        vals = [_const(e) for e in node.elts]
        return vals if all(v is not None for v in vals) else None
    if isinstance(node, ast.Dict):
        out = {}
        for k, v in zip(node.keys, node.values):
            kc, vc = (_const(k) if k else None), _const(v)
            if kc is None:
                return None
            out[kc] = vc
        return out
    if isinstance(node, ast.Name):
        if node.id in ("True", "False", "None"):
            return {"True": True, "False": False, "None": None}[node.id]
        return f"<{node.id}>"
    if isinstance(node, ast.Attribute):
        return f"<{ast.unparse(node)}>"
    if isinstance(node, ast.Lambda):
        return "<lambda>"
    if isinstance(node, ast.Call):
        return f"<{ast.unparse(node)[:60]}>"
    return None


def _decorator_info(dec: ast.AST) -> dict | None:
    """Return {"name": "api.depends", "args": [...], "kwargs": {...}} or None."""
    if isinstance(dec, ast.Call):
        target, call = dec.func, dec
    else:
        target, call = dec, None
    name = ast.unparse(target)
    info: dict[str, Any] = {"name": name}
    if call is not None:
        info["args"] = [_const(a) for a in call.args]
        info["kwargs"] = {k.arg: _const(k.value) for k in call.keywords if k.arg}
    return info


# Recordset methods that return "the same kind of records", so a call chained after
# them is still a call on the current model. Also treated as noise (not charted).
RECORDSET_PLUMBING = {
    "sudo", "with_context", "with_company", "with_user", "with_env", "with_prefetch", "filtered",
    "filtered_domain", "sorted", "exists", "browse", "search", "create", "copy", "ensure_one",
    "flush_model", "flush_recordset", "invalidate_recordset", "invalidate_model", "grouped",
}
NOISE_CALLS = RECORDSET_PLUMBING | {"mapped", "get", "ids", "ensure_one", "env", "_context", "id"}


def _self_root(node: ast.AST, depth: int = 0) -> bool:
    """True if `node` is `self` or a plumbing chain that starts at `self`."""
    if depth > 6:
        return False
    if isinstance(node, ast.Name):
        return node.id == "self"
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in RECORDSET_PLUMBING:
        return _self_root(node.func.value, depth + 1)
    return False


class _CallCollector(ast.NodeVisitor):
    """Collect self.method(), self.env['model'].method() and super() usage."""

    def __init__(self) -> None:
        self.self_calls: set[str] = set()
        self.env_calls: set[tuple[str, str]] = set()
        self.field_calls: set[tuple[str, str]] = set()  # (field, method): self.order_line._foo()
        self.super_call = False
        self.mapped: set[str] = set()

    def visit_Call(self, node: ast.Call) -> None:
        f = node.func
        if isinstance(f, ast.Attribute):
            base = f.value
            # super().foo()
            if isinstance(base, ast.Call) and isinstance(base.func, ast.Name) and base.func.id == "super":
                self.super_call = True
            # self.foo()  /  self.sudo().with_context(...).foo()
            elif _self_root(base):
                if f.attr in ("mapped", "filtered", "sorted") and node.args and isinstance(node.args[0], ast.Constant):
                    self.mapped.add(str(node.args[0].value))
                elif f.attr not in NOISE_CALLS:
                    self.self_calls.add(f.attr)
            else:
                # self.env['x.y'].foo()   /  self.env['x.y'].sudo().foo() (one hop)
                model = _env_model(base)
                if model and f.attr not in NOISE_CALLS - {"search", "create", "browse"}:
                    self.env_calls.add((model, f.attr))
                else:
                    # self.some_field.foo()  /  self.some_field.sudo().foo()  → resolved via comodel later
                    fld = _self_field(base)
                    if fld and f.attr not in NOISE_CALLS and not f.attr.startswith("__"):
                        self.field_calls.add((fld, f.attr))
        self.generic_visit(node)


def _self_field(node: ast.AST, depth: int = 0) -> str | None:
    if depth > 6:
        return None
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "self":
        return node.attr if not node.attr.startswith("_") else None
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in RECORDSET_PLUMBING:
        return _self_field(node.func.value, depth + 1)
    return None


def _env_model(node: ast.AST, depth: int = 0) -> str | None:
    if depth > 3:
        return None
    if isinstance(node, ast.Subscript):
        v = node.value
        if isinstance(v, ast.Attribute) and v.attr == "env" and isinstance(node.slice, ast.Constant):
            return str(node.slice.value)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        # .sudo() / .with_context() / .with_company() chains
        if node.func.attr in ("sudo", "with_context", "with_company", "with_user", "with_env", "with_prefetch"):
            return _env_model(node.func.value, depth + 1)
    return None


def _parse_class(cls: ast.ClassDef, module: str, rel_file: str, src: str) -> ClassInfo | None:
    kind = None
    for b in cls.bases:
        text = ast.unparse(b)
        last = text.split(".")[-1]
        if last in MODEL_BASES:
            kind = last
    attrs: dict[str, Any] = {}
    fields_: list[dict] = []
    methods: list[dict] = []
    name = inherit = inherits = None
    for stmt in cls.body:
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            tname = stmt.targets[0].id
            val = stmt.value
            if tname == "_name":
                name = _const(val)
            elif tname == "_inherit":
                v = _const(val)
                inherit = [v] if isinstance(v, str) else (v or [])
            elif tname == "_inherits":
                inherits = _const(val) or {}
            elif tname.startswith("_") and not tname.startswith("__"):
                c = _const(val)
                if isinstance(c, (str, bool, int, list)):
                    attrs[tname] = c
            elif isinstance(val, ast.Call):
                fdef = _parse_field(tname, val, stmt.lineno)
                if fdef:
                    fields_.append(fdef)
        elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            methods.append(_parse_method(stmt, src))
    if kind is None and not (name or inherit):
        return None
    if kind is None:
        # Class inherits from another python class in the same module (rare). Treat as Model.
        kind = "Model"
    if name is None and inherit and len(inherit) == 1:
        name = inherit[0]
    if name is None:
        return None
    return ClassInfo(
        module=module, file=rel_file, line=cls.lineno, end_line=cls.end_lineno or cls.lineno,
        class_name=cls.name, name=name, inherit=inherit or [], inherits=inherits or {},
        kind=kind, attrs=attrs, fields=fields_, methods=methods, docstring=ast.get_docstring(cls),
    )


def _parse_field(fname: str, call: ast.Call, line: int) -> dict | None:
    func = ast.unparse(call.func)
    parts = func.split(".")
    if len(parts) < 2 or parts[-2] != "fields":
        return None
    ftype = parts[-1]
    f: dict[str, Any] = {"name": fname, "type": ftype, "line": line}
    args = [_const(a) for a in call.args]
    kwargs = {k.arg: _const(k.value) for k in call.keywords if k.arg}
    if ftype in RELATIONAL:
        if args and isinstance(args[0], str):
            f["comodel"] = args[0]
        if ftype == "One2many" and len(args) > 1 and isinstance(args[1], str):
            f["inverse_name"] = args[1]
        if "comodel_name" in kwargs:
            f["comodel"] = kwargs["comodel_name"]
        if "inverse_name" in kwargs:
            f["inverse_name"] = kwargs["inverse_name"]
    else:
        if args and isinstance(args[0], str):
            f["string"] = args[0]
    for k, v in kwargs.items():
        if k in _INTERESTING_KW and k not in ("comodel_name", "inverse_name"):
            f[k] = v
    return f


def _parse_method(fn: ast.FunctionDef | ast.AsyncFunctionDef, src: str) -> dict:
    decorators = [d for d in (_decorator_info(x) for x in fn.decorator_list) if d]
    cc = _CallCollector()
    for stmt in fn.body:
        cc.visit(stmt)
    args = [a.arg for a in fn.args.args]
    if fn.args.vararg:
        args.append("*" + fn.args.vararg.arg)
    if fn.args.kwonlyargs:
        args += [a.arg for a in fn.args.kwonlyargs]
    if fn.args.kwarg:
        args.append("**" + fn.args.kwarg.arg)
    source = ast.get_source_segment(src, fn) or ""
    if len(source) > 6000:
        source = source[:6000] + "\n# … truncated"
    return {
        "name": fn.name,
        "line": fn.lineno,
        "end_line": fn.end_lineno or fn.lineno,
        "args": args,
        "decorators": decorators,
        "doc": ast.get_docstring(fn),
        "self_calls": sorted(cc.self_calls),
        "env_calls": sorted(cc.env_calls),
        "field_calls": sorted(cc.field_calls),
        "mapped": sorted(cc.mapped),
        "super": cc.super_call,
        "source": source,
    }


def scan_python(addon: Addon, odoo_root: Path) -> list[ClassInfo]:
    out: list[ClassInfo] = []
    for py in addon.path.rglob("*.py"):
        rel_parts = py.relative_to(addon.path).parts
        if "tests" in rel_parts or "populate" in rel_parts or py.name == "__manifest__.py":
            continue
        try:
            src = py.read_text(encoding="utf-8")
            tree = ast.parse(src)
        except (SyntaxError, UnicodeDecodeError):
            continue
        rel_file = py.relative_to(odoo_root).as_posix()
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                ci = _parse_class(node, addon.name, rel_file, src)
                if ci:
                    out.append(ci)
    return out


def scan_controllers(addon: Addon, odoo_root: Path) -> list[dict]:
    """Classes deriving from http.Controller with @http.route methods."""
    out: list[dict] = []
    for py in addon.path.rglob("*.py"):
        if "tests" in py.relative_to(addon.path).parts:
            continue
        try:
            src = py.read_text(encoding="utf-8")
            tree = ast.parse(src)
        except (SyntaxError, UnicodeDecodeError):
            continue
        rel_file = py.relative_to(odoo_root).as_posix()
        for cls in ast.walk(tree):
            if not isinstance(cls, ast.ClassDef):
                continue
            for fn in cls.body:
                if not isinstance(fn, ast.FunctionDef):
                    continue
                for dec in fn.decorator_list:
                    info = _decorator_info(dec)
                    if not info or not info["name"].endswith("route"):
                        continue
                    routes = info.get("args") or []
                    if routes and isinstance(routes[0], list):
                        routes = routes[0]
                    routes = [r for r in routes if isinstance(r, str)]
                    if not routes and "route" in (info.get("kwargs") or {}):
                        r = info["kwargs"]["route"]
                        routes = r if isinstance(r, list) else [r]
                    m = _parse_method(fn, src)
                    out.append({
                        "module": addon.name, "file": rel_file, "class": cls.name,
                        "method": m, "routes": routes, "kwargs": info.get("kwargs") or {},
                    })
    return out


def build_models(g: Graph, classes: list[ClassInfo], rank: dict[str, int]) -> dict[str, ModelAcc]:
    models: dict[str, ModelAcc] = {}
    classes.sort(key=lambda c: (rank.get(c.module, 10**6), c.file, c.line))
    for ci in classes:
        acc = models.setdefault(ci.name, ModelAcc(name=ci.name))
        acc.layers.append(ci)
        for f in ci.fields:
            existing = acc.fields.get(f["name"])
            if existing is None:
                merged = dict(f)
                merged["module"] = ci.module
                merged["layers"] = [{"module": ci.module, "file": ci.file, "line": f["line"]}]
                acc.fields[f["name"]] = merged
            else:
                existing["layers"].append({"module": ci.module, "file": ci.file, "line": f["line"]})
                # later layers can add compute/related etc.
                for k, v in f.items():
                    if k not in existing or k in ("compute", "inverse", "related", "store"):
                        existing[k] = v
        for m in ci.methods:
            layer = dict(m)
            layer["module"] = ci.module
            layer["file"] = ci.file
            layer["class"] = ci.class_name
            acc.methods.setdefault(m["name"], []).append(layer)

    for name, acc in models.items():
        mid = f"model:{name}"
        # A class with _name = X and X not in its _inherit list is the definition.
        definer = next((l for l in acc.layers if name not in l.inherit), acc.layers[0])
        desc = next((l.attrs.get("_description") for l in acc.layers if l.attrs.get("_description")), None)
        kind = definer.kind
        g.node(
            mid, "model", name, module=definer.module,
            description=desc, kind=kind,
            layers=[l.module for l in acc.layers],
            n_fields=len(acc.fields), n_methods=len(acc.methods),
        )
        g.nodes[mid].detail.update(
            docstring=definer.docstring,
            attrs={k: v for l in acc.layers for k, v in l.attrs.items()},
            layers=[{
                "module": l.module, "file": l.file, "line": l.line, "class": l.class_name,
                "kind": l.kind, "inherit": l.inherit, "inherits": l.inherits,
                "fields": [f["name"] for f in l.fields], "methods": [m["name"] for m in l.methods],
            } for l in acc.layers],
        )
        for l in acc.layers:
            g.edge(f"mod:{l.module}", mid, "defines", label=l.class_name)
            for parent in l.inherit:
                if parent == name:
                    continue
                g.node(f"model:{parent}", "model", parent)
                g.edge(mid, f"model:{parent}", "mixin", via=l.module)
            for parent, fk in l.inherits.items():
                g.node(f"model:{parent}", "model", parent)
                g.edge(mid, f"model:{parent}", "inherits", label=fk, via=l.module)

        for fname, f in acc.fields.items():
            fid = f"field:{name}.{fname}"
            g.node(
                fid, "field", fname, module=f["module"],
                model=name, ftype=f["type"], comodel=f.get("comodel"),
                store=f.get("store"), computed=bool(f.get("compute")), related=bool(f.get("related")),
                layers=[l["module"] for l in f["layers"]],
            )
            g.nodes[fid].detail.update({k: v for k, v in f.items() if k not in ("name", "line")})
            g.edge(mid, fid, "has_field")
            for l in f["layers"]:
                g.edge(f"mod:{l['module']}", fid, "defines")
            if f.get("comodel"):
                com = f["comodel"]
                if isinstance(com, str) and not com.startswith("<"):
                    g.node(f"model:{com}", "model", com)
                    g.edge(fid, f"model:{com}", "targets", label=f["type"])
                    # Model-level relation so the Models lens can draw model ↔ model.
                    g.edge(mid, f"model:{com}", f["type"].lower() if f["type"] in RELATIONAL else "relation", label=fname, via=f["module"])
            comp = f.get("compute")
            if isinstance(comp, str):
                g.edge(f"method:{name}.{comp}", fid, "computes")
            inv = f.get("inverse")
            if isinstance(inv, str):
                g.edge(f"method:{name}.{inv}", fid, "inverse_of")
            rel = f.get("related")
            if isinstance(rel, str) and "." in rel:
                first = rel.split(".")[0]
                g.edge(fid, f"field:{name}.{first}", "related_via", label=rel)

        for mname, layers in acc.methods.items():
            mid_ = f"method:{name}.{mname}"
            first = layers[0]
            decos = sorted({d["name"].replace("api.", "@") for l in layers for d in l["decorators"]})
            g.node(
                mid_, "method", mname, module=first["module"],
                model=name, layers=[l["module"] for l in layers], decorators=decos,
                private=mname.startswith("_"), n_layers=len(layers),
            )
            g.nodes[mid_].detail.update(layers=[{
                k: v for k, v in l.items() if k not in ("name",)
            } for l in layers])
            g.edge(mid, mid_, "has_method")
            for l in layers:
                g.edge(f"mod:{l['module']}", mid_, "defines")
                for d in l["decorators"]:
                    if d["name"].endswith("depends"):
                        for dep in d.get("args") or []:
                            if isinstance(dep, str):
                                root = dep.split(".")[0]
                                g.edge(mid_, f"field:{name}.{root}", "api_depends", label=dep)
                    if d["name"].endswith("constrains") or d["name"].endswith("onchange"):
                        kind = "constrains" if d["name"].endswith("constrains") else "onchange"
                        for dep in d.get("args") or []:
                            if isinstance(dep, str):
                                g.edge(mid_, f"field:{name}.{dep}", kind)
                for callee in l["self_calls"]:
                    g.edge(mid_, f"method:{name}.{callee}", "calls", via=l["module"])
                for (fld, callee) in l.get("field_calls", []):
                    fdef = acc.fields.get(fld)
                    com = fdef.get("comodel") if fdef else None
                    if isinstance(com, str) and not com.startswith("<"):
                        g.edge(mid_, f"method:{com}.{callee}", "calls", label=f"via {fld}", via=l["module"])
                for (cm, cmeth) in l["env_calls"]:
                    if cmeth in ORM_CALLS and cmeth != "call":
                        g.edge(mid_, f"model:{cm}", "uses_model", label=cmeth, via=l["module"])
                    else:
                        g.edge(mid_, f"method:{cm}.{cmeth}", "calls", via=l["module"])
    return models


def build_controllers(g: Graph, controllers: list[dict]) -> None:
    for c in controllers:
        m = c["method"]
        cid = f"ctrl:{c['module']}.{c['class']}.{m['name']}"
        g.node(
            cid, "controller", m["name"], module=c["module"],
            klass=c["class"], routes=c["routes"],
            auth=c["kwargs"].get("auth"), rtype=c["kwargs"].get("type"),
            methods=c["kwargs"].get("methods"),
        )
        g.nodes[cid].detail.update(file=c["file"], line=m["line"], source=m["source"], doc=m["doc"], kwargs=c["kwargs"], env_calls=m["env_calls"])
        g.edge(f"mod:{c['module']}", cid, "defines")
        for r in c["routes"]:
            rid = f"route:{r}"
            g.node(rid, "route", r, module=c["module"])
            g.edge(cid, rid, "serves")
        for (cm, cmeth) in m["env_calls"]:
            if cmeth in ORM_CALLS and cmeth != "call":
                g.edge(cid, f"model:{cm}", "uses_model", label=cmeth)
            else:
                g.edge(cid, f"method:{cm}.{cmeth}", "calls")
