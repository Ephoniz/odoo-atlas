import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { AtlasNode as N } from "../data/types";
import { typeMeta } from "../data/kinds";
import type { Direction } from "./layout";

export interface AtlasNodeData extends Record<string, unknown> {
  node: N;
  focus: boolean;
  dim: boolean;
  hover: boolean;
  dir: Direction;
  fields?: { n: string; ftype: string }[];
}

export type AtlasFlowNode = Node<AtlasNodeData, "atlas">;

function splitName(node: N): { prefix?: string; name: string } {
  if (node.t === "field" || node.t === "method") {
    return { prefix: `${node.model as string}.`, name: node.n };
  }
  if (node.t === "view" || node.t === "action" || node.t === "template" || node.t === "cron") {
    const i = node.n.indexOf(".");
    if (i > 0) return { prefix: node.n.slice(0, i + 1), name: node.n.slice(i + 1) };
  }
  if (node.t === "registry") return { prefix: `${node.category as string}/`, name: node.n };
  return { name: node.n };
}

/** Insert soft break opportunities after `_`, `.`, `/` and before camelCase humps so long identifiers wrap at joints, not mid-word. */
function breakable(s: string) {
  const parts = s.split(/(?<=[_./])|(?<=[a-z0-9])(?=[A-Z])/);
  if (parts.length === 1) return s;
  return parts.map((p, i) => <span key={i}>{p}<wbr /></span>);
}

function subtitle(node: N): string | null {
  switch (node.t) {
    case "module": return (node.title as string) ?? null;
    case "model": return (node.description as string) ?? null;
    case "field": return `${node.ftype as string}${node.comodel ? ` → ${node.comodel as string}` : ""}${node.computed ? " · computed" : ""}${node.related ? " · related" : ""}`;
    case "method": {
      const d = (node.decorators as string[]) ?? [];
      return d.length ? d.join(" ") : (node.n_layers as number) > 1 ? `${node.n_layers as number} strata` : null;
    }
    case "component": return node.template && node.template !== "<inline xml>" ? `template ${node.template as string}` : (node.extends as string) ? `extends ${node.extends as string}` : null;
    case "jsclass": return node.extends ? `extends ${node.extends as string}` : null;
    case "view": return [node.vtype as string, node.model as string, node.inherit ? "inherit" : null].filter(Boolean).join(" · ");
    case "action": return [node.atype as string, (node.res_model as string) ?? (node.tag as string)].filter(Boolean).join(" · ");
    case "controller": return ((node.routes as string[]) ?? []).slice(0, 2).join("  ");
    case "route": return [node.rtype as string, node.auth ? `auth ${node.auth as string}` : null].filter(Boolean).join(" · ") || null;
    case "service": return node.n_deps ? `${node.n_deps as number} dependencies` : null;
    case "registry": return `registry ${node.category as string}`;
    case "template": return node.inherit ? `t-inherit ${node.mode ? `(${node.mode as string})` : ""}` : null;
    case "hook": return null;
    case "cron": return (node.interval as string) ?? null;
  }
  return null;
}

export const AtlasNode = memo(function AtlasNode({ data }: NodeProps<AtlasFlowNode>) {
  const { node, focus, dim, hover, dir, fields } = data;
  const tm = typeMeta(node.t);
  const { prefix, name } = splitName(node);
  const sub = subtitle(node);
  const layers = (node.layers as string[] | undefined) ?? [];
  const cls = ["node", focus && "is-focus", dim && "is-dim", hover && "is-hover", (node.ghost || node.external) && "is-ghost"]
    .filter(Boolean)
    .join(" ");
  const chips: string[] = [];
  if (focus) {
    if (node.t === "component" && Array.isArray(node.services)) chips.push(...(node.services as string[]).map((s) => `⚙ ${s}`));
    if (node.t === "view" && Array.isArray(node.widgets)) chips.push(...(node.widgets as string[]).slice(0, 6).map((w) => `widget ${w}`));
    if (node.t === "model") chips.push(node.kind as string);
    if (node.t === "route" && node.auth) chips.push(`auth ${node.auth as string}`);
    if (node.t === "module" && node.application) chips.push("application");
  }

  return (
    <div className={cls} style={{ ["--accent" as string]: `var(${tm.color})` }} role="button" tabIndex={0} aria-label={`${tm.label} ${node.n}`}>
      <Handle type="target" position={dir === "RIGHT" ? Position.Left : Position.Top} />
      <Handle type="source" position={dir === "RIGHT" ? Position.Right : Position.Bottom} />
      <div className="type">
        <span>{node.ghost ? `${tm.label} · unresolved` : tm.label}</span>
        {node.m && node.t !== "module" ? <span className="mod">{node.m}</span> : null}
      </div>
      <div className="name">
        {prefix ? <><span className="prefix">{prefix}</span><wbr /></> : null}
        {breakable(name)}
      </div>
      {sub ? <div className="sub" title={sub}>{sub}</div> : null}
      {focus && (node.t === "model" || node.t === "module") ? (
        <div className="stats">
          {node.t === "model" ? (
            <>
              <span><b>{node.n_fields as number}</b> fields</span>
              <span><b>{node.n_methods as number}</b> methods</span>
              <span><b>{layers.length}</b> strata</span>
            </>
          ) : (
            <span>{node.category as string}</span>
          )}
        </div>
      ) : null}
      {layers.length > 1 || (focus && layers.length > 0) ? (
        <>
          <div className="strata" aria-label={`built by ${layers.join(", ")}`}>
            {layers.map((m, i) => <i key={m + i} title={m} data-first={i === 0} />)}
          </div>
          {focus ? (
            <div className="strata-labels">
              {layers.map((m, i) => <span key={m + i}>{m}</span>)}
            </div>
          ) : null}
        </>
      ) : null}
      {focus && fields && fields.length ? (
        <div className="fields">
          {fields.slice(0, 8).map((f) => (
            <div className="row" key={f.n}>
              <span>{f.n}</span>
              <span className="ft">{f.ftype}</span>
            </div>
          ))}
          {fields.length > 8 ? <div className="more">+{fields.length - 8} more in inspector</div> : null}
        </div>
      ) : null}
      {chips.length ? (
        <div className="chips">
          {chips.map((c) => <span className="chip" key={c}>{c}</span>)}
        </div>
      ) : null}
    </div>
  );
});
