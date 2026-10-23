import { useAtlas } from "../data/store";
import { LENS_META } from "../data/neighbourhood";

export function Caption() {
  const lens = useAtlas((s) => s.lens);
  const focus = useAtlas((s) => s.focus);
  const navigated = useAtlas((s) => s.trail.length > 1);
  const inspectorOpen = useAtlas((s) => s.inspectorOpen);
  const setInspector = useAtlas((s) => s.setInspector);
  // The how-to line is for the first look; once you've clicked around it's just in the way.
  const tip = focus && !navigated;
  return (
    <div className="caption">
      <b>{LENS_META[lens].title}</b> · {LENS_META[lens].blurb}
      {tip || (focus && !inspectorOpen) ? (
        <div style={{ marginTop: 4 }}>
          {tip ? "Click a node to chart it · double-click to start fresh from it" : null}
          {!inspectorOpen ? (
            <>
              {tip ? " · " : null}
              <button onClick={() => setInspector(true)} style={{ color: "var(--notice)" }}>open inspector</button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
