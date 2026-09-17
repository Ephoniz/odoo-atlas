import { useMemo } from "react";
import { useAtlas } from "../data/store";
import { FAMILY_LABEL, kindMeta, typeMeta } from "../data/kinds";
import { edgeStyle } from "../graph/AtlasEdge";

export function Legend() {
  const visible = useAtlas((s) => s.visible);
  const nodes = useAtlas((s) => s.nodes);
  const out = useAtlas((s) => s.out);
  const hiddenKinds = useAtlas((s) => s.hiddenKinds);
  const toggleKind = useAtlas((s) => s.toggleKind);

  const { types, kinds } = useMemo(() => {
    const types = new Map<string, number>();
    const kinds = new Map<string, number>();
    const vis = new Set(visible);
    for (const id of visible) {
      const n = nodes.get(id);
      if (!n) continue;
      types.set(n.t, (types.get(n.t) ?? 0) + 1);
      for (const e of out.get(id) ?? []) if (vis.has(e.t)) kinds.set(e.k, (kinds.get(e.k) ?? 0) + 1);
    }
    return {
      types: [...types.entries()].sort((a, b) => b[1] - a[1]),
      kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [visible, nodes, out]);

  return (
    <aside className="legend" aria-label="Legend">
      <header>
        <h3>On the chart</h3>
        <span className="count num">{visible.length} nodes</span>
      </header>
      <ul>
        {types.map(([t, n]) => (
          <li key={t} style={{ ["--sw" as string]: `var(${typeMeta(t).color})` }}>
            <i className="sw" />
            <span>{n === 1 ? typeMeta(t).label : typeMeta(t).plural}</span>
            <span className="num" style={{ marginLeft: "auto", color: "var(--paper-faint)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>{n}</span>
          </li>
        ))}
      </ul>
      {kinds.length ? (
        <div className="edges">
          {kinds.map(([k, n]) => {
            const s = edgeStyle(k);
            return (
              <button key={k} aria-pressed={!hiddenKinds.has(k)} onClick={() => toggleKind(k)} title={`${FAMILY_LABEL[kindMeta(k).family]} · click to hide/show`}>
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" y1="3" x2="18" y2="3" stroke={s.stroke} strokeWidth="1.6" strokeDasharray={s.dash} />
                </svg>
                <span className="lbl">{kindMeta(k).out}</span>
                <span className="num" style={{ marginLeft: "auto", color: "var(--paper-faint)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
