import { useAtlas } from "../data/store";
import { LENS_META } from "../data/neighbourhood";

export function Caption() {
  const lens = useAtlas((s) => s.lens);
  const focus = useAtlas((s) => s.focus);
  const nodes = useAtlas((s) => s.nodes);
  const inspectorOpen = useAtlas((s) => s.inspectorOpen);
  const setInspector = useAtlas((s) => s.setInspector);
  const n = focus ? nodes.get(focus) : null;
  return (
    <div className="caption">
      <b>{LENS_META[lens].title}</b> · {LENS_META[lens].blurb}
      {n ? (
        <div style={{ marginTop: 4 }}>
          Click a node to chart it · double-click to start fresh from it
          {!inspectorOpen ? (
            <>
              {" · "}
              <button onClick={() => setInspector(true)} style={{ color: "var(--notice)" }}>open inspector</button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
