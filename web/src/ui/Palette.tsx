import { useEffect, useMemo, useRef, useState } from "react";
import MiniSearch from "minisearch";
import { useAtlas } from "../data/store";
import { typeMeta } from "../data/kinds";
import type { AtlasNode } from "../data/types";

const PREFIX: Record<string, string> = {
  "m:": "model", "f:": "field", "d:": "method", "c:": "component", "s:": "service", "v:": "view",
  "t:": "template", "r:": "registry", "a:": "action", "mod:": "module", "h:": "hook", "u:": "route",
};

let index: MiniSearch<AtlasNode> | null = null;

/**
 * Split on Odoo's separators, then also break camelCase so "KanbanRecord"
 * answers to "kanban rec". The whole token is kept too so exact names rank first.
 */
function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(/[\s._\-:/]+/)) {
    if (!raw) continue;
    out.push(raw.toLowerCase());
    const parts = raw.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    if (parts.length > 1) for (const p of parts) out.push(p.toLowerCase());
  }
  return out;
}

function getIndex(nodes: Map<string, AtlasNode>) {
  if (index) return index;
  index = new MiniSearch<AtlasNode>({
    fields: ["n", "m", "model", "description", "title", "id"],
    storeFields: ["id"],
    idField: "id",
    extractField: (doc, field) => String((doc as Record<string, unknown>)[field] ?? ""),
    tokenize,
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { n: 4, id: 2, model: 1.5 }, combineWith: "AND" },
  });
  index.addAll([...nodes.values()].filter((n) => !n.ghost));
  return index;
}

export function Palette() {
  const open = useAtlas((s) => s.paletteOpen);
  const setPalette = useAtlas((s) => s.setPalette);
  const nodes = useAtlas((s) => s.nodes);
  const setFocus = useAtlas((s) => s.setFocus);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    if (!open) return [];
    let query = q.trim();
    let type: string | null = null;
    for (const [p, t] of Object.entries(PREFIX)) {
      if (query.startsWith(p)) { type = t; query = query.slice(p.length).trim(); break; }
    }
    if (!query) {
      // Starters
      const picks = ["model:sale.order", "method:sale.order._action_confirm", "cmp:web.FormController", "svc:orm", "mod:sale", "model:res.partner", "reg:fields.many2one", "cmp:web.ListController"];
      return picks.map((id) => nodes.get(id)).filter((n): n is AtlasNode => !!n && (!type || n.t === type));
    }
    const ix = getIndex(nodes);
    const hits = ix.search(query, { filter: type ? (r) => nodes.get(r.id)?.t === type : undefined });
    return hits.slice(0, 40).map((h) => nodes.get(h.id)!).filter(Boolean);
  }, [q, open, nodes]);

  useEffect(() => setSel(0), [results]);

  if (!open) return null;

  const go = (n: AtlasNode) => {
    setPalette(false);
    setFocus(n.id);
  };

  return (
    <div className="palette-bg" onMouseDown={() => setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="sale.order, _action_confirm, FormController…"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter" && results[sel]) go(results[sel]);
            else if (e.key === "Escape") setPalette(false);
          }}
        />
        <div className="hint">
          <span>Narrow by type:</span>
          <code>m:</code>model <code>f:</code>field <code>d:</code>method <code>c:</code>component <code>s:</code>service <code>v:</code>view <code>t:</code>template <code>mod:</code>module
        </div>
        {results.length ? (
          <ul role="listbox">
            {results.map((n, i) => {
              const tm = typeMeta(n.t);
              const sub = (n.t === "field" || n.t === "method") ? (n.model as string) : n.m;
              return (
                <li key={n.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)}>
                  <button onClick={() => go(n)} style={{ ["--sw" as string]: `var(${tm.color})` }}>
                    <i className="sw" />
                    <span className="pn">
                      {n.n}
                      {sub ? <small>{sub}</small> : null}
                    </span>
                    <span className="pt">{tm.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">Nothing on the chart matches “{q}”. Try a model name like <code>account.move</code> or a shorter word.</div>
        )}
      </div>
    </div>
  );
}
