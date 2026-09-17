"""In-memory graph accumulated by the extractors, then serialised by build.py.

Node ids are stable, human readable strings:
  mod:sale                     module
  model:sale.order             ORM model (merged across all modules that extend it)
  field:sale.order.partner_id  field
  method:sale.order.action_confirm
  view:sale.view_order_form    ir.ui.view xml id
  action:sale.action_orders    ir.actions.* xml id
  route:/my/orders             HTTP route (one per path)
  cmp:web.FormController       OWL component (module.ClassName)
  svc:orm                      service registered in the "services" registry
  reg:fields.many2one          registry entry (category.key)
  tpl:web.FormView             QWeb template (t-name)
  hook:web.useService          exported use* function
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Node:
    id: str
    type: str
    name: str
    module: str | None = None
    # Small, list-friendly attributes that go into index.json.
    brief: dict[str, Any] = field(default_factory=dict)
    # Larger payload that goes into the per-module detail shard.
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class Edge:
    source: str
    target: str
    kind: str
    meta: dict[str, Any] = field(default_factory=dict)


class Graph:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.edges: list[Edge] = []
        self._edge_keys: set[tuple[str, str, str, str]] = set()

    def node(self, id: str, type: str, name: str, module: str | None = None, **brief: Any) -> Node:
        n = self.nodes.get(id)
        if n is None:
            n = Node(id=id, type=type, name=name, module=module)
            self.nodes[id] = n
        if module and not n.module:
            n.module = module
        for k, v in brief.items():
            if v is not None:
                n.brief[k] = v
        return n

    def edge(self, source: str, target: str, kind: str, **meta: Any) -> None:
        # Deduplicate on (s, t, kind, label) so repeated overrides still collapse.
        label = str(meta.get("label", ""))
        key = (source, target, kind, label)
        if key in self._edge_keys:
            return
        self._edge_keys.add(key)
        self.edges.append(Edge(source, target, kind, {k: v for k, v in meta.items() if v is not None}))

    def has(self, id: str) -> bool:
        return id in self.nodes
