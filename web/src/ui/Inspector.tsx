import { useEffect, useMemo, useState, type ReactNode } from "react";
import { detailOf, useAtlas } from "../data/store";
import { FAMILY_LABEL, kindMeta, typeMeta, type KindMeta } from "../data/kinds";
import type { AtlasNode, EdgeGroup } from "../data/types";
import { Source } from "./Source";

const GH = "https://github.com/odoo/odoo/blob/19.0/";
type Tab = "overview" | "relations" | "source" | "strata";

export function Inspector() {
  const open = useAtlas((s) => s.inspectorOpen);
  const setInspector = useAtlas((s) => s.setInspector);
  const focus = useAtlas((s) => s.focus);
  const node = useAtlas((s) => (s.focus ? s.nodes.get(s.focus) : undefined));
  const detail = useAtlas((s) => (s.focus ? detailOf(s, s.focus) : undefined));
  const loading = useAtlas((s) => s.detailLoading.size > 0);
  const groupsOf = useAtlas((s) => s.groupsOf);
  const [tab, setTab] = useState<Tab>("overview");

  const groups = useMemo(() => (focus ? groupsOf(focus) : []), [focus, groupsOf]);
  const layers = (detail?.layers as Record<string, unknown>[] | undefined) ?? [];
  const hasStrata = layers.length > 0 && (node?.t === "model" || node?.t === "method" || node?.t === "field");
  const hasSource = !!(detail && (detail.source || detail.arch || layers.some((l) => l.source)));

  useEffect(() => {
    if (tab === "strata" && !hasStrata) setTab("overview");
    if (tab === "source" && !hasSource && !loading) setTab("overview");
  }, [focus, hasStrata, hasSource, tab, loading]);

  if (!node) return <aside className={`inspector${open ? "" : " is-closed"}`} />;
  const tm = typeMeta(node.t);
  const relCount = groups.reduce((a, g) => a + g.edges.length, 0);

  return (
    <aside className={`inspector${open ? "" : " is-closed"}`} aria-label="Inspector">
      <div className="insp-head" style={{ ["--accent" as string]: `var(${tm.color})` }}>
        <div className="eyebrow">
          <i className="sw" style={{ ["--sw" as string]: `var(${tm.color})` }} />
          <span>{node.ghost ? `${tm.label} · not in scanned modules` : tm.label}</span>
          {node.m ? <span className="mod">{node.m}</span> : null}
          <button onClick={() => setInspector(false)} aria-label="Close inspector" title="Close" style={{ marginLeft: 8, color: "var(--paper-dim)" }}>✕</button>
        </div>
        <h1>
          {(node.t === "field" || node.t === "method") ? <span className="prefix">{node.model as string}.</span> : null}
          {node.n}
        </h1>
        <Lead node={node} detail={detail} />
        <Chips node={node} detail={detail} />
      </div>
      <div className="insp-tabs" role="tablist">
        <TabBtn id="overview" tab={tab} setTab={setTab}>Overview</TabBtn>
        <TabBtn id="relations" tab={tab} setTab={setTab}>Relations<span className="n num">{relCount}</span></TabBtn>
        {hasSource || loading ? <TabBtn id="source" tab={tab} setTab={setTab}>Source</TabBtn> : null}
        {hasStrata ? <TabBtn id="strata" tab={tab} setTab={setTab}>Strata<span className="n num">{layers.length}</span></TabBtn> : null}
      </div>
      <div className="insp-body">
        {tab === "overview" ? <Overview node={node} detail={detail} loading={loading} groups={groups} /> : null}
        {tab === "relations" ? <Relations node={node} groups={groups} /> : null}
        {tab === "source" ? <SourceTab node={node} detail={detail} loading={loading} /> : null}
        {tab === "strata" ? <Strata node={node} detail={detail} /> : null}
      </div>
    </aside>
  );
}

function TabBtn({ id, tab, setTab, children }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; children: ReactNode }) {
  return <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{children}</button>;
}

/* ---------- header helpers ---------- */

function Lead({ node, detail }: { node: AtlasNode; detail?: Record<string, unknown> }) {
  let text: string | null = null;
  switch (node.t) {
    case "module": text = (detail?.summary as string) || (node.title as string) || null; break;
    case "model": text = (node.description as string) ?? null; break;
    case "field": text = (detail?.string as string) ?? null; break;
    case "method": {
      const l = (detail?.layers as Record<string, unknown>[] | undefined)?.[0];
      const args = (l?.args as string[] | undefined) ?? [];
      text = `${node.n}(${args.join(", ")})`;
      break;
    }
    case "component": text = node.template && node.template !== "<inline xml>" ? `renders ${node.template as string}` : null; break;
    case "view": text = [node.vtype as string, "view of", node.model as string].filter(Boolean).join(" "); break;
    case "action": text = (node.name_ as string) ?? null; break;
    case "controller": text = ((node.routes as string[]) ?? []).join("  ·  "); break;
    case "registry": text = `registry.category("${node.category as string}")`; break;
    case "cron": text = (node.name_ as string) ?? null; break;
  }
  if (!text) return null;
  return <p className={`lead${node.t === "method" || node.t === "controller" || node.t === "registry" ? " mono" : ""}`}>{text}</p>;
}

function Chips({ node, detail }: { node: AtlasNode; detail?: Record<string, unknown> }) {
  const chips: { t: string; notice?: boolean }[] = [];
  if (node.t === "model") {
    chips.push({ t: node.kind as string });
    if (detail?.attrs && typeof detail.attrs === "object") {
      const a = detail.attrs as Record<string, unknown>;
      if (a._order) chips.push({ t: `order ${a._order as string}` });
      if (a._rec_name) chips.push({ t: `rec_name ${a._rec_name as string}` });
      if (a._auto === false) chips.push({ t: "no table" });
    }
  }
  if (node.t === "field") {
    chips.push({ t: node.ftype as string });
    if (node.comodel) chips.push({ t: `→ ${node.comodel as string}` });
    if (node.computed) chips.push({ t: "computed" });
    if (node.related) chips.push({ t: "related" });
    if (node.store === false) chips.push({ t: "not stored" });
    if (detail?.required) chips.push({ t: "required" });
    if (detail?.readonly) chips.push({ t: "readonly" });
    if (detail?.tracking) chips.push({ t: "tracked" });
  }
  if (node.t === "method") {
    for (const d of (node.decorators as string[]) ?? []) chips.push({ t: d });
    if ((node.n_layers as number) > 1) chips.push({ t: `${node.n_layers as number} strata`, notice: true });
    if (node.private) chips.push({ t: "private" });
  }
  if (node.t === "component") {
    for (const s of (node.services as string[]) ?? []) chips.push({ t: `⚙ ${s}` });
    if (Array.isArray(detail?.patched_by)) chips.push({ t: `patched ×${(detail!.patched_by as unknown[]).length}`, notice: true });
  }
  if (node.t === "view") {
    for (const w of (node.widgets as string[]) ?? []) chips.push({ t: `widget ${w}` });
    for (const j of (node.js_class as string[]) ?? []) chips.push({ t: `js_class ${j}`, notice: true });
  }
  if (node.t === "route" || node.t === "controller") {
    if (node.rtype) chips.push({ t: node.rtype as string });
    if (node.auth) chips.push({ t: `auth ${node.auth as string}` });
    if (Array.isArray(node.methods)) chips.push({ t: (node.methods as string[]).join("/") });
  }
  if (node.t === "module") {
    if (node.category) chips.push({ t: node.category as string });
    if (node.application) chips.push({ t: "application" });
    if (node.auto_install) chips.push({ t: "auto install" });
  }
  if (!chips.length) return null;
  return <div className="chips">{chips.map((c, i) => <span key={i} className={`chip${c.notice ? " notice" : ""}`}>{c.t}</span>)}</div>;
}

/* ---------- Overview ---------- */

function Overview({ node, detail, loading, groups }: { node: AtlasNode; detail?: Record<string, unknown>; loading: boolean; groups: EdgeGroup[] }) {
  const nodes = useAtlas((s) => s.nodes);
  const file = detail?.file as string | undefined;
  const line = (detail?.line as number | undefined) ?? ((detail?.layers as Record<string, unknown>[] | undefined)?.[0]?.line as number | undefined);
  const doc = (detail?.docstring ?? detail?.doc ?? (detail?.layers as Record<string, unknown>[] | undefined)?.find((l) => l.doc)?.doc) as string | undefined;
  const firstLayerFile = (detail?.layers as Record<string, unknown>[] | undefined)?.[0]?.file as string | undefined;

  const listGroup = (kind: string, dir: "out" | "in", title: string, limit = 12) => {
    const g = groups.find((x) => x.kind === kind && x.dir === dir);
    if (!g) return null;
    return <LinkList title={`${title}`} ids={g.edges.map((e) => (dir === "out" ? e.t : e.s))} labels={g.edges.map((e) => e.label)} limit={limit} />;
  };

  return (
    <>
      {(file || firstLayerFile) ? (
        <div className="srcbar">
          <span>{file ?? firstLayerFile}{line ? `:${line}` : ""}</span>
          <a href={`${GH}${file ?? firstLayerFile}${line ? `#L${line}` : ""}`} target="_blank" rel="noreferrer">open on GitHub ↗</a>
        </div>
      ) : null}
      {loading && !detail ? <p className="doc">Sounding…</p> : null}
      {doc ? <p className="doc">{doc}</p> : null}

      {node.t === "module" ? (
        <>
          {detail?.description ? <p className="doc" style={{ marginTop: 10 }}>{detail.description as string}</p> : null}
          <h4 className="eyebrow">Requires</h4>
          <LinkList ids={((detail?.depends as string[]) ?? []).map((d) => `mod:${d}`)} />
          <h4 className="eyebrow">Contributes</h4>
          <Contributes id={node.id} />
        </>
      ) : null}

      {node.t === "model" ? (
        <>
          <h4 className="eyebrow">Fields</h4>
          <FieldTable model={node.n} />
          {listGroup("mixin", "out", "Mixes in")}
          {listGroup("inherits", "out", "Delegates to")}
          {listGroup("view_of", "in", "Views", 8)}
          {listGroup("opens_model", "in", "Opened by actions", 6)}
        </>
      ) : null}

      {node.t === "field" ? (
        <>
          <h4 className="eyebrow">Definition</h4>
          <dl className="kv">
            {Object.entries(detail ?? {}).filter(([k, v]) => !["layers", "module", "type"].includes(k) && v !== null && v !== undefined && typeof v !== "object").map(([k, v]) => (
              <Fragment2 key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment2>
            ))}
          </dl>
          {detail?.compute ? <LinkList title="Computed by" ids={[`method:${node.model as string}.${detail.compute as string}`]} /> : null}
          {detail?.inverse ? <LinkList title="Inverse" ids={[`method:${node.model as string}.${detail.inverse as string}`]} /> : null}
          {listGroup("api_depends", "in", "Triggers recompute of", 10)}
          {listGroup("onchange", "in", "Onchange handlers")}
          {listGroup("constrains", "in", "Constrained by")}
          {listGroup("shows_field", "in", "Shown in views", 8)}
        </>
      ) : null}

      {node.t === "method" ? (
        <>
          {listGroup("computes", "out", "Computes")}
          {listGroup("api_depends", "out", "Depends on fields", 10)}
          {listGroup("calls", "out", "Calls", 14)}
          {listGroup("calls", "in", "Called by", 14)}
          {listGroup("rpc", "in", "Called over RPC by")}
          {listGroup("button_calls", "in", "Bound to buttons in")}
          {listGroup("uses_model", "out", "Queries models")}
        </>
      ) : null}

      {node.t === "component" || node.t === "jsclass" ? (
        <>
          {Array.isArray(detail?.props) && (detail!.props as string[]).length ? (
            <>
              <h4 className="eyebrow">Props</h4>
              <div className="chips">{(detail!.props as string[]).map((p) => <span key={p} className="chip">{p}</span>)}</div>
            </>
          ) : null}
          {Array.isArray(detail?.methods) && (detail!.methods as { name: string; kind: string }[]).length ? (
            <>
              <h4 className="eyebrow">Members</h4>
              <div className="chips">{(detail!.methods as { name: string; kind: string; static?: boolean }[]).map((m) => <span key={m.name} className="chip">{m.kind === "get" ? "get " : ""}{m.static ? "static " : ""}{m.name}</span>)}</div>
            </>
          ) : null}
          {listGroup("rpc", "out", "Calls the server")}
          {listGroup("rpc_route", "out", "Fetches routes")}
          {listGroup("uses_hook", "out", "Hooks")}
          {listGroup("child_component", "out", "Child components", 16)}
          {Array.isArray(detail?.patched_by) ? (
            <>
              <h4 className="eyebrow">Patched by</h4>
              <ul className="stack">
                {(detail!.patched_by as { module: string; file: string; line: number; members: string[] }[]).map((p, i) => (
                  <li key={i}>
                    <span className="depth num">{i + 1}</span>
                    <div>
                      <div className="layer-head"><span className="m">{p.module}</span><span className="cls">{p.file.split("/").pop()}:{p.line}</span></div>
                      <div className="layer-meta">{p.members.map((m) => <b key={m}>{m}</b>)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      {node.t === "service" ? (
        <>
          {listGroup("uses_service", "out", "Depends on services")}
          {listGroup("rpc", "out", "Calls the server")}
          {listGroup("rpc_route", "out", "Fetches routes")}
          {listGroup("uses_service", "in", "Used by", 20)}
        </>
      ) : null}

      {node.t === "view" ? (
        <>
          {detail?.inherit_id ? <LinkList title="Inherits" ids={[`view:${detail.inherit_id as string}`]} /> : null}
          {Array.isArray(detail?.xpaths) && (detail!.xpaths as string[]).length ? (
            <>
              <h4 className="eyebrow">XPath targets</h4>
              <ul className="linklist">{(detail!.xpaths as string[]).map((x, i) => <li key={i}><span className="rowbtn" style={{ cursor: "default" }}>{x}</span></li>)}</ul>
            </>
          ) : null}
          {listGroup("button_calls", "out", "Buttons call")}
          {listGroup("uses_widget", "out", "Widgets")}
          {listGroup("shows_field", "out", "Fields shown", 16)}
          {listGroup("view_inherits", "in", "Extended by", 12)}
        </>
      ) : null}

      {node.t === "action" ? (
        <>
          <dl className="kv">
            <dt>type</dt><dd>{node.atype as string}</dd>
            {node.res_model ? <><dt>res_model</dt><dd>{node.res_model as string}</dd></> : null}
            {node.view_mode ? <><dt>view_mode</dt><dd>{node.view_mode as string}</dd></> : null}
            {node.tag ? <><dt>tag</dt><dd>{node.tag as string}</dd></> : null}
            {detail?.domain ? <><dt>domain</dt><dd>{detail.domain as string}</dd></> : null}
            {detail?.context ? <><dt>context</dt><dd>{detail.context as string}</dd></> : null}
          </dl>
          {listGroup("opens_view", "out", "Opens view")}
          {listGroup("button_opens", "in", "Opened from")}
        </>
      ) : null}

      {node.t === "controller" ? (
        <>
          <dl className="kv">
            {Object.entries((detail?.kwargs as Record<string, unknown>) ?? {}).map(([k, v]) => <Fragment2 key={k}><dt>{k}</dt><dd>{JSON.stringify(v)}</dd></Fragment2>)}
          </dl>
          {listGroup("calls", "out", "Calls")}
          {listGroup("uses_model", "out", "Queries models")}
        </>
      ) : null}

      {node.t === "template" ? (
        <>
          {listGroup("t_inherit", "out", "Inherits template")}
          {listGroup("renders_component", "out", "Places components", 16)}
          {listGroup("t_call", "out", "Calls templates")}
          {listGroup("renders", "in", "Rendered by")}
          {listGroup("t_inherit", "in", "Extended by")}
        </>
      ) : null}

      {node.t === "registry" ? (
        <>
          {listGroup("registers", "out", "Registers")}
          {listGroup("uses_widget", "in", "Used as widget in", 16)}
          {listGroup("client_action", "in", "Client action of")}
        </>
      ) : null}

      {node.t === "route" ? (
        <>
          {listGroup("serves", "in", "Served by")}
          {listGroup("rpc_route", "in", "Fetched by", 16)}
        </>
      ) : null}

      {node.t === "hook" ? listGroup("uses_hook", "in", "Used by", 24) : null}
      {node.t === "cron" && detail?.code ? <Source code={detail.code as string} lang="py" /> : null}

      {listGroup("defines", "in", "Defined in")}
      <p style={{ color: "var(--paper-faint)", fontSize: 11, marginTop: 20 }}>
        Everything else is under Relations. {nodes.size.toLocaleString()} nodes charted.
      </p>
    </>
  );
}

// React.Fragment with key, kept tiny.
function Fragment2({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function Contributes({ id }: { id: string }) {
  const out = useAtlas((s) => s.out);
  const nodes = useAtlas((s) => s.nodes);
  const setLens = useAtlas((s) => s.setLens);
  const setFocus = useAtlas((s) => s.setFocus);
  const counts = new Map<string, string[]>();
  for (const e of out.get(id) ?? []) {
    if (e.k !== "defines") continue;
    const n = nodes.get(e.t);
    if (!n) continue;
    (counts.get(n.t) ?? counts.set(n.t, []).get(n.t)!).push(n.id);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
  return (
    <ul className="linklist">
      {rows.map(([t, ids]) => (
        <li key={t}>
          <button
            onClick={() => {
              // Focus the first entry of that type in its home lens.
              const first = ids.sort()[0];
              const lens = t === "model" || t === "field" ? "models" : t === "method" ? "methods" : ["component", "service", "template", "registry", "hook", "jsclass"].includes(t) ? "owl" : "bridge";
              setLens(lens);
              setFocus(first);
            }}
            style={{ ["--sw" as string]: `var(${typeMeta(t).color})` }}
          >
            <i className="sw" />
            <span>{typeMeta(t).plural}</span>
            <span className="lbl num">{ids.length}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FieldTable({ model }: { model: string }) {
  const out = useAtlas((s) => s.out);
  const nodes = useAtlas((s) => s.nodes);
  const setFocus = useAtlas((s) => s.setFocus);
  const [all, setAll] = useState(false);
  const fields = (out.get(`model:${model}`) ?? []).filter((e) => e.k === "has_field").map((e) => nodes.get(e.t)!).filter(Boolean);
  const shown = all ? fields : fields.slice(0, 18);
  return (
    <>
      <ul className="linklist">
        {shown.map((f) => (
          <li key={f.id}>
            <button onClick={() => setFocus(f.id, { keep: true })} style={{ ["--sw" as string]: `var(${typeMeta("field").color})` }}>
              <i className="sw" />
              <span>{f.n}</span>
              <span className="mod">{(f.layers as string[])?.length > 1 ? `${(f.layers as string[]).length}▮ ` : ""}{f.m}</span>
              <span className="lbl">{f.ftype as string}{f.comodel ? ` → ${f.comodel as string}` : ""}{f.computed ? " ƒ" : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      {fields.length > 18 ? (
        <button className="rowbtn" onClick={() => setAll(!all)} style={{ color: "var(--paper-dim)" }}>{all ? "Show fewer" : `Show all ${fields.length} fields`}</button>
      ) : null}
    </>
  );
}

function LinkList({ title, ids, labels, limit = 12 }: { title?: string; ids: string[]; labels?: (string | undefined)[]; limit?: number }) {
  const nodes = useAtlas((s) => s.nodes);
  const setFocus = useAtlas((s) => s.setFocus);
  const [all, setAll] = useState(false);
  const items = ids.map((id, i) => ({ id, n: nodes.get(id), label: labels?.[i] })).filter((x) => x.n);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      {title ? <h4 className="eyebrow">{title}</h4> : null}
      <ul className="linklist">
        {shown.map(({ id, n, label }) => (
          <li key={id}>
            <button onClick={() => setFocus(id, { keep: true })} style={{ ["--sw" as string]: `var(${typeMeta(n!.t).color})` }}>
              <i className="sw" />
              <span>{n!.t === "field" || n!.t === "method" ? <><span style={{ color: "var(--paper-faint)" }}>{n!.model as string}.</span>{n!.n}</> : n!.n}</span>
              {n!.m && n!.t !== "module" ? <span className="mod">{n!.m}</span> : null}
              {label ? <span className="lbl">{label}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {items.length > limit ? (
        <button className="rowbtn" onClick={() => setAll(!all)} style={{ color: "var(--paper-dim)" }}>{all ? "Show fewer" : `Show all ${items.length}`}</button>
      ) : null}
    </>
  );
}

/* ---------- Relations ---------- */

function Relations({ node, groups }: { node: AtlasNode; groups: EdgeGroup[] }) {
  const expanded = useAtlas((s) => s.expanded);
  const toggleGroup = useAtlas((s) => s.toggleGroup);
  const byFamily = new Map<KindMeta["family"], EdgeGroup[]>();
  for (const g of groups) {
    const fam = kindMeta(g.kind).family;
    (byFamily.get(fam) ?? byFamily.set(fam, []).get(fam)!).push(g);
  }
  const order: KindMeta["family"][] = ["bridge", "inherit", "relation", "flow", "ui", "structure"];
  if (!groups.length) return <p className="doc">Nothing connects here yet.</p>;
  return (
    <>
      {order.filter((f) => byFamily.has(f)).map((fam) => (
        <section key={fam}>
          <h4 className="eyebrow family">{FAMILY_LABEL[fam]}</h4>
          {byFamily.get(fam)!.sort((a, b) => b.edges.length - a.edges.length).map((g) => {
            const key = `${node.id}|${g.dir}|${g.kind}`;
            const on = expanded.has(key);
            const km = kindMeta(g.kind);
            return (
              <div className="group" key={g.key}>
                <div className="group-head">
                  <span className="dir">{g.dir === "out" ? "→" : "←"}</span>
                  <span className="verb">{g.dir === "out" ? km.out : km.in}</span>
                  <span className="n num">{g.edges.length}</span>
                  <button className="plot" aria-pressed={on} onClick={() => toggleGroup(node.id, g.dir, g.kind)}>
                    {on ? "on chart" : "plot"}
                  </button>
                </div>
                <LinkList ids={g.edges.map((e) => (g.dir === "out" ? e.t : e.s))} labels={g.edges.map((e) => e.label ?? e.via)} limit={8} />
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

/* ---------- Source ---------- */

function SourceTab({ node, detail, loading }: { node: AtlasNode; detail?: Record<string, unknown>; loading: boolean }) {
  const layers = (detail?.layers as Record<string, unknown>[] | undefined)?.filter((l) => l.source) ?? [];
  const [li, setLi] = useState(layers.length - 1);
  useEffect(() => setLi(Math.max(0, layers.length - 1)), [node.id, layers.length]);
  if (!detail) return <p className="doc">{loading ? "Sounding…" : "No source captured for this node."}</p>;
  if (layers.length) {
    const l = layers[Math.min(li, layers.length - 1)];
    return (
      <>
        {layers.length > 1 ? (
          <div className="lenses" style={{ display: "inline-flex", marginBottom: 10 }}>
            {layers.map((x, i) => (
              <button key={i} className="lens" aria-selected={i === li} onClick={() => setLi(i)} style={{ padding: "4px 10px", fontFamily: "var(--f-mono)", fontSize: 12 }}>{x.module as string}</button>
            ))}
          </div>
        ) : null}
        <div className="srcbar">
          <span>{l.file as string}:{l.line as number}</span>
          {l.super ? <span className="chip">calls super()</span> : <span className="chip">no super()</span>}
          <a href={`${GH}${l.file as string}#L${l.line as number}`} target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
        <Source code={l.source as string} lang="py" />
      </>
    );
  }
  if (detail.arch) {
    return (
      <>
        <div className="srcbar"><span>{detail.file as string}</span><a href={`${GH}${detail.file as string}`} target="_blank" rel="noreferrer">GitHub ↗</a></div>
        <Source code={detail.arch as string} lang="xml" dedent={false} />
      </>
    );
  }
  if (detail.source) {
    const lang = node.t === "template" ? "xml" : node.t === "controller" || node.t === "cron" ? "py" : "js";
    return (
      <>
        <div className="srcbar">
          <span>{detail.file as string}{detail.line ? `:${detail.line as number}` : ""}</span>
          <a href={`${GH}${detail.file as string}${detail.line ? `#L${detail.line as number}` : ""}`} target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
        <Source code={detail.source as string} lang={lang} />
      </>
    );
  }
  return <p className="doc">No source captured for this node.</p>;
}

/* ---------- Strata ---------- */

function Strata({ node, detail }: { node: AtlasNode; detail?: Record<string, unknown> }) {
  const setFocus = useAtlas((s) => s.setFocus);
  const layers = (detail?.layers as Record<string, unknown>[] | undefined) ?? [];
  const tm = typeMeta(node.t);
  return (
    <>
      <p className="doc" style={{ marginBottom: 6 }}>
        {node.t === "method"
          ? "Each module that redefines this method adds a stratum. Odoo resolves them bottom-up in load order; a layer that calls super() passes through to the one above it."
          : node.t === "model"
            ? "Modules that extend this model, in load order. The first stratum declares it; the rest add fields and methods."
            : "Modules that declare or redeclare this field, in load order."}
      </p>
      <ul className="stack" style={{ ["--accent" as string]: `var(${tm.color})` }}>
        {layers.map((l, i) => (
          <li key={i} data-first={i === 0}>
            <span className="depth num">{i + 1}</span>
            <div>
              <div className="layer-head">
                <button className="m" onClick={() => setFocus(`mod:${l.module as string}`, { keep: true })}>{l.module as string}</button>
                {l.class ? <span className="cls">class {l.class as string}</span> : null}
                {node.t === "method" ? <span className={`chip super${l.super ? "" : " notice"}`}>{l.super ? "super()" : "no super — overrides fully"}</span> : null}
              </div>
              <div className="layer-meta">
                <span>{(l.file as string)?.split("/").slice(-2).join("/")}:{l.line as number}</span>
                {node.t === "model" ? (
                  <>
                    <span><b>{((l.fields as string[]) ?? []).length}</b> fields</span>
                    <span><b>{((l.methods as string[]) ?? []).length}</b> methods</span>
                    {Array.isArray(l.inherit) && (l.inherit as string[]).filter((x) => x !== node.n).length ? <span>mixins: <b>{(l.inherit as string[]).filter((x) => x !== node.n).join(", ")}</b></span> : null}
                  </>
                ) : null}
                {node.t === "method" && Array.isArray(l.decorators) && (l.decorators as { name: string; args?: unknown[] }[]).length ? (
                  <span>{(l.decorators as { name: string; args?: unknown[] }[]).map((d) => `@${d.name.replace("api.", "")}${d.args?.length ? `(${(d.args as unknown[]).map(String).join(", ")})` : ""}`).join(" ")}</span>
                ) : null}
                {node.t === "method" && Array.isArray(l.self_calls) && (l.self_calls as string[]).length ? (
                  <span>calls <b>{(l.self_calls as string[]).slice(0, 6).join(", ")}{(l.self_calls as string[]).length > 6 ? "…" : ""}</b></span>
                ) : null}
              </div>
              {node.t === "model" && Array.isArray(l.fields) && (l.fields as string[]).length ? (
                <details>
                  <summary>fields added here</summary>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {(l.fields as string[]).map((f) => <button key={f} className="chip" onClick={() => setFocus(`field:${node.n}.${f}`, { keep: true })}>{f}</button>)}
                  </div>
                </details>
              ) : null}
              {node.t === "model" && Array.isArray(l.methods) && (l.methods as string[]).length ? (
                <details>
                  <summary>methods added here</summary>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {(l.methods as string[]).map((m) => <button key={m} className="chip" onClick={() => setFocus(`method:${node.n}.${m}`, { keep: true })}>{m}</button>)}
                  </div>
                </details>
              ) : null}
              {l.source ? (
                <details>
                  <summary>source</summary>
                  <Source code={l.source as string} lang="py" />
                </details>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
