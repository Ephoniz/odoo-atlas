import { useEffect } from "react";
import { useAtlas } from "./data/store";
import { TopBar } from "./ui/TopBar";
import { Inspector } from "./ui/Inspector";
import { Palette } from "./ui/Palette";
import { Canvas } from "./graph/Canvas";
import type { Lens } from "./data/types";

const LENS_KEYS: Lens[] = ["galaxy", "models", "methods", "owl", "bridge"];

export default function App() {
  const status = useAtlas((s) => s.status);
  const progress = useAtlas((s) => s.progress);
  const error = useAtlas((s) => s.error);
  const load = useAtlas((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useAtlas.getState();
      const inInput = (e.target as HTMLElement)?.tagName === "INPUT";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        st.setPalette(!st.paletteOpen);
      } else if (e.key === "Escape") {
        if (st.paletteOpen) st.setPalette(false);
      } else if (!inInput && !st.paletteOpen) {
        if (e.key === "/") { e.preventDefault(); st.setPalette(true); }
        else if (/^[1-5]$/.test(e.key)) st.setLens(LENS_KEYS[Number(e.key) - 1]);
        else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) st.goBack();
        else if (e.key.toLowerCase() === "i") st.setInspector(!st.inspectorOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (status !== "ready") {
    return (
      <div className="splash">
        <div className="card">
          <h1>Odoo Atlas</h1>
          {status === "error" ? (
            <p className="err">Couldn't load the chart data.{"\n"}{error}{"\n\n"}Run the extractor first: python -m extractor --odoo vendor/odoo --out web/public/data</p>
          ) : (
            <>
              <p>{progress}</p>
              <div className="sound" aria-hidden />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <TopBar />
      <Canvas />
      <Inspector />
      <Palette />
    </div>
  );
}
