export type NodeType =
  | "module" | "model" | "field" | "method" | "view" | "action" | "controller" | "route" | "cron"
  | "component" | "jsclass" | "service" | "registry" | "template" | "hook";

export interface AtlasNode {
  id: string;
  t: NodeType;
  n: string;
  m?: string;
  ghost?: boolean;
  external?: boolean;
  // brief attributes, type-specific
  [k: string]: unknown;
}

export interface AtlasEdge {
  s: string;
  t: string;
  k: string;
  label?: string;
  via?: string;
  [k: string]: unknown;
}

export interface Meta {
  version: string;
  generated_at: string;
  modules: string[];
  counts: { nodes: number; edges: number };
  node_types: Record<string, number>;
  edge_kinds: Record<string, number>;
  shards: string[];
}

export type Lens = "galaxy" | "models" | "methods" | "owl" | "bridge";

export interface EdgeGroup {
  key: string;         // `${dir}:${kind}`
  kind: string;
  dir: "out" | "in";
  edges: AtlasEdge[];
}
