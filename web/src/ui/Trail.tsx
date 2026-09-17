import { useAtlas } from "../data/store";
import { typeMeta } from "../data/kinds";

export function Trail() {
  const trail = useAtlas((s) => s.trail);
  const nodes = useAtlas((s) => s.nodes);
  const focus = useAtlas((s) => s.focus);
  const setFocus = useAtlas((s) => s.setFocus);
  if (trail.length < 1) return null;
  const shown = trail.slice(-6);
  return (
    <nav className="trail" aria-label="Where you have been">
      {trail.length > 6 ? <span className="sep">…</span> : null}
      {shown.map((id, i) => {
        const n = nodes.get(id);
        if (!n) return null;
        return (
          <span key={id + i} style={{ display: "contents" }}>
            {i > 0 ? <span className="sep">›</span> : null}
            <button className="crumb" aria-current={id === focus ? "location" : undefined} onClick={() => setFocus(id)} style={{ ["--dot" as string]: `var(${typeMeta(n.t).color})` }}>
              <i className="dot" />
              {n.n}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
