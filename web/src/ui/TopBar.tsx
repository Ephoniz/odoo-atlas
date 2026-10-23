import { useAtlas } from "../data/store";
import { LENS_META } from "../data/neighbourhood";
import type { Lens } from "../data/types";

const ORDER: Lens[] = ["galaxy", "models", "methods", "owl", "bridge"];

export function TopBar() {
  const lens = useAtlas((s) => s.lens);
  const setLens = useAtlas((s) => s.setLens);
  const setPalette = useAtlas((s) => s.setPalette);
  const version = useAtlas((s) => s.meta?.version ?? "");
  return (
    <header className="topbar">
      <div className="wordmark">
        <span>Odoo Atlas</span>
        {version && version !== "unknown" ? <span className="version">{version}</span> : null}
      </div>
      <nav className="lenses" role="tablist" aria-label="Lenses">
        {ORDER.map((l, i) => (
          <button key={l} role="tab" className="lens" aria-selected={lens === l} onClick={() => setLens(l)} title={LENS_META[l].blurb}>
            {LENS_META[l].title}
            <span className="k">{i + 1}</span>
          </button>
        ))}
      </nav>
      <button className="searchbtn" onClick={() => setPalette(true)} aria-label="Search the atlas">
        <SearchIcon />
        <span>Find a model, method, component…</span>
        <span className="k">⌘K</span>
      </button>
    </header>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
