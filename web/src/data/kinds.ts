import type { NodeType } from "./types";

export interface TypeMeta {
  label: string;       // singular, for eyebrows
  plural: string;
  color: string;       // CSS var name
  shore: "py" | "js" | "xml" | "mod";
}

export const TYPE: Record<NodeType, TypeMeta> = {
  module:     { label: "module",     plural: "modules",     color: "--c-module",     shore: "mod" },
  model:      { label: "model",      plural: "models",      color: "--c-model",      shore: "py" },
  field:      { label: "field",      plural: "fields",      color: "--c-field",      shore: "py" },
  method:     { label: "method",     plural: "methods",     color: "--c-method",     shore: "py" },
  controller: { label: "controller", plural: "controllers", color: "--c-route",      shore: "py" },
  route:      { label: "route",      plural: "routes",      color: "--c-route",      shore: "py" },
  cron:       { label: "cron",       plural: "crons",       color: "--c-action",     shore: "xml" },
  view:       { label: "view",       plural: "views",       color: "--c-view",       shore: "xml" },
  action:     { label: "action",     plural: "actions",     color: "--c-action",     shore: "xml" },
  template:   { label: "template",   plural: "templates",   color: "--c-template",   shore: "js" },
  component:  { label: "component",  plural: "components",  color: "--c-component",  shore: "js" },
  jsclass:    { label: "js class",   plural: "js classes",  color: "--c-jsclass",    shore: "js" },
  service:    { label: "service",    plural: "services",    color: "--c-service",    shore: "js" },
  registry:   { label: "registry",   plural: "registry entries", color: "--c-registry", shore: "js" },
  hook:       { label: "hook",       plural: "hooks",       color: "--c-hook",       shore: "js" },
};

export interface KindMeta {
  /** Sentence fragment read from the source node: "sale.order —depends on→ account" */
  out: string;
  /** Sentence fragment read from the target node: "account ←is depended on by— sale" */
  in: string;
  family: "structure" | "inherit" | "relation" | "flow" | "bridge" | "ui";
  /** Prefer hiding in default expansions (too many / too obvious). */
  quiet?: boolean;
}

export const KIND: Record<string, KindMeta> = {
  depends:          { out: "depends on",          in: "required by",          family: "structure" },
  defines:          { out: "defines",             in: "defined in",           family: "structure", quiet: true },
  has_field:        { out: "has field",           in: "field of",             family: "structure", quiet: true },
  has_method:       { out: "has method",          in: "method of",            family: "structure", quiet: true },
  mixin:            { out: "mixes in",            in: "mixed into",           family: "inherit" },
  inherits:         { out: "delegates to",        in: "delegated from",       family: "inherit" },
  extends:          { out: "extends",             in: "extended by",          family: "inherit" },
  patches:          { out: "patches",             in: "patched by",           family: "inherit" },
  t_inherit:        { out: "inherits template",   in: "template inherited by",family: "inherit" },
  view_inherits:    { out: "inherits view",       in: "view inherited by",    family: "inherit" },
  many2one:         { out: "many2one →",          in: "← many2one from",      family: "relation" },
  one2many:         { out: "one2many →",          in: "← one2many from",      family: "relation" },
  many2many:        { out: "many2many ↔",         in: "↔ many2many with",     family: "relation" },
  many2onereference:{ out: "reference →",         in: "← referenced by",      family: "relation" },
  targets:          { out: "points to",           in: "pointed to by field",  family: "relation" },
  related_via:      { out: "related through",     in: "path for related",     family: "relation" },
  computes:         { out: "computes",            in: "computed by",          family: "flow" },
  inverse_of:       { out: "inverse for",         in: "inverse method",       family: "flow" },
  api_depends:      { out: "depends on field",    in: "triggers recompute of",family: "flow" },
  constrains:       { out: "constrains",          in: "constrained by",       family: "flow" },
  onchange:         { out: "onchange of",         in: "onchange handler",     family: "flow" },
  calls:            { out: "calls",               in: "called by",            family: "flow" },
  uses_model:       { out: "queries",             in: "queried by",           family: "flow" },
  serves:           { out: "serves",              in: "served by",            family: "bridge" },
  rpc:              { out: "rpc →",               in: "← rpc from",           family: "bridge" },
  rpc_route:        { out: "fetches",             in: "fetched by",           family: "bridge" },
  button_calls:     { out: "button calls",        in: "button in",            family: "bridge" },
  button_opens:     { out: "button opens",        in: "opened by button in",  family: "bridge" },
  client_action:    { out: "runs client action",  in: "client action for",    family: "bridge" },
  uses_widget:      { out: "uses widget",         in: "widget used in",       family: "bridge" },
  uses_js_class:    { out: "uses js_class",       in: "js_class of",          family: "bridge" },
  view_of:          { out: "view of",             in: "shown by view",        family: "ui" },
  shows_field:      { out: "shows field",         in: "shown in",             family: "ui", quiet: true },
  opens_model:      { out: "opens",               in: "opened by action",     family: "ui" },
  opens_view:       { out: "opens view",          in: "opened by",            family: "ui" },
  renders:          { out: "renders template",    in: "rendered by",          family: "ui" },
  renders_component:{ out: "places component",    in: "placed in template",   family: "ui" },
  t_call:           { out: "calls template",      in: "called from",          family: "ui" },
  child_component:  { out: "has child",           in: "child of",             family: "structure" },
  registers:        { out: "registers",           in: "registered as",        family: "structure" },
  uses_service:     { out: "uses service",        in: "used by",              family: "flow" },
  uses_hook:        { out: "uses hook",           in: "hook used by",         family: "flow" },
};

export const FAMILY_LABEL: Record<KindMeta["family"], string> = {
  structure: "Structure",
  inherit: "Inheritance",
  relation: "Relations",
  flow: "Flow",
  bridge: "Bridge",
  ui: "Interface",
};

const FAMILY_RANK: Record<KindMeta["family"], number> = { bridge: 5, flow: 4, relation: 3, inherit: 2, ui: 1, structure: 0 };
const KIND_ORDER = [
  "rpc", "rpc_route", "button_calls", "button_opens", "serves", "client_action", "uses_widget", "uses_js_class",
  "calls", "computes", "inverse_of", "api_depends", "constrains", "onchange", "uses_model", "uses_service", "uses_hook",
  "many2one", "one2many", "many2many", "many2onereference", "targets", "related_via",
  "extends", "mixin", "inherits", "patches", "t_inherit", "view_inherits",
  "view_of", "opens_model", "opens_view", "renders", "renders_component", "t_call", "shows_field",
  "child_component", "registers", "depends", "has_field", "has_method", "defines",
];

/** Higher = more important; drives which kind wins for a collapsed edge and the fan order. */
export function kindRank(kind: string): number {
  const fam = FAMILY_RANK[kindMeta(kind).family] * 100;
  const i = KIND_ORDER.indexOf(kind);
  return fam + (i === -1 ? 0 : KIND_ORDER.length - i);
}

export function kindMeta(kind: string): KindMeta {
  return KIND[kind] ?? { out: kind.replace(/_/g, " "), in: kind.replace(/_/g, " "), family: "structure" };
}

export function typeMeta(t: string): TypeMeta {
  return TYPE[t as NodeType] ?? { label: t, plural: t, color: "--c-template", shore: "py" };
}
