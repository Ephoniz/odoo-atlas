import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { Lens } from "../data/types";

// ELK is ~1.4 MB and only the galaxy needs it, so it loads on first use.
let elk: Promise<{ layout: (g: ElkNode) => Promise<ElkNode> }> | null = null;
function getElk() {
  elk ??= import("elkjs/lib/elk.bundled.js").then((m) => new m.default());
  return elk;
}

export interface LayoutInput {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export type Direction = "RIGHT" | "DOWN";

export function directionFor(lens: Lens): Direction {
  return lens === "galaxy" ? "DOWN" : "RIGHT";
}

export async function layout(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  direction: Direction,
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map();
  const ids = new Set(nodes.map((n) => n.id));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "SPLINES",
      "elk.layered.spacing.nodeNodeBetweenLayers": direction === "RIGHT" ? "110" : "80",
      "elk.spacing.nodeNode": direction === "RIGHT" ? "22" : "34",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
      "elk.spacing.componentComponent": "60",
      "elk.separateConnectedComponents": "true",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      .map<ElkExtendedEdge>((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await (await getElk()).layout(graph);
  const out = new Map<string, { x: number; y: number }>();
  for (const c of res.children ?? []) out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  return out;
}

/**
 * Star layout used by every lens except the galaxy: the focus sits in the middle,
 * everything it points to fans out on the right, everything pointing at it on the
 * left. Each side is packed into short columns, grouped by edge kind so related
 * things sit together. Deterministic, instant, and it reads like a chart margin.
 */
export interface GroupLabel {
  id: string;
  x: number;
  y: number;
  kind: string;
  dir: "out" | "in";
  count: number;
}

export function fanLayout(
  nodes: LayoutInput[],
  focus: string | null,
  edges: { source: string; target: string; rank: number; kind: string }[],
): { pos: Map<string, { x: number; y: number }>; labels: GroupLabel[] } {
  const pos = new Map<string, { x: number; y: number }>();
  const labels: GroupLabel[] = [];
  if (nodes.length === 0) return { pos, labels };
  const size = new Map(nodes.map((n) => [n.id, n]));
  const f = focus && size.has(focus) ? focus : nodes[0].id;
  const fs = size.get(f)!;
  pos.set(f, { x: -fs.width / 2, y: -fs.height / 2 });

  // Classify neighbours by side + kind (highest-ranked edge wins).
  const side = new Map<string, { dir: "out" | "in"; rank: number; kind: string }>();
  for (const e of edges) {
    if (e.source === f && e.target !== f) {
      const cur = side.get(e.target);
      if (!cur || e.rank > cur.rank) side.set(e.target, { dir: "out", rank: e.rank, kind: e.kind });
    } else if (e.target === f && e.source !== f) {
      const cur = side.get(e.source);
      if (!cur || e.rank > cur.rank) side.set(e.source, { dir: "in", rank: e.rank, kind: e.kind });
    }
  }
  const out: string[] = [];
  const inn: string[] = [];
  const loose: string[] = [];
  for (const n of nodes) {
    if (n.id === f) continue;
    const s = side.get(n.id);
    if (!s) loose.push(n.id);
    else (s.dir === "out" ? out : inn).push(n.id);
  }
  const byGroup = (a: string, b: string) => {
    const sa = side.get(a)!, sb = side.get(b)!;
    if (sa.rank !== sb.rank) return sb.rank - sa.rank;
    return a.localeCompare(b);
  };
  out.sort(byGroup);
  inn.sort(byGroup);

  const GAP = 12, GROUP_GAP = 40, COL_GAP = 48, FOCUS_GAP = 150, LABEL_H = 18;

  const place = (ids: string[], dir: 1 | -1) => {
    if (!ids.length) return;
    // Pack whole kind-groups into columns of at most PER_COL nodes so a group
    // isn't sliced across columns; only a group bigger than a column gets split.
    const PER_COL = 10;
    const groups: string[][] = [];
    for (const id of ids) {
      const last = groups[groups.length - 1];
      if (last && side.get(last[0])!.kind === side.get(id)!.kind) last.push(id);
      else groups.push([id]);
    }
    const cols: string[][] = [[]];
    for (const g of groups) {
      let col = cols[cols.length - 1];
      if (col.length && col.length + g.length > PER_COL) cols.push(col = []);
      for (const id of g) {
        if (col.length >= PER_COL) cols.push(col = []);
        col.push(id);
      }
    }
    let x = dir === 1 ? fs.width / 2 + FOCUS_GAP : -fs.width / 2 - FOCUS_GAP;
    for (const col of cols) {
      const colW = Math.max(...col.map((id) => size.get(id)!.width));
      const isNewGroup = (i: number) => i === 0 || side.get(col[i])!.kind !== side.get(col[i - 1])!.kind;
      // total height incl. group gaps + a label above every group
      let total = 0;
      col.forEach((id, i) => {
        if (i > 0) total += isNewGroup(i) ? GROUP_GAP : GAP;
        if (isNewGroup(i)) total += LABEL_H;
        total += size.get(id)!.height;
      });
      let y = -total / 2;
      col.forEach((id, i) => {
        if (i > 0) y += isNewGroup(i) ? GROUP_GAP : GAP;
        const s = size.get(id)!;
        const nx = dir === 1 ? x : x - colW + (colW - s.width);
        if (isNewGroup(i)) {
          const k = side.get(id)!;
          const count = col.slice(i).findIndex((o) => side.get(o)!.kind !== k.kind);
          labels.push({ id: `label:${dir}:${k.kind}:${x}:${y}`, x: nx, y, kind: k.kind, dir: k.dir, count: count === -1 ? col.length - i : count });
          y += LABEL_H;
        }
        pos.set(id, { x: nx, y });
        y += s.height;
      });
      x += dir * (colW + COL_GAP);
    }
  };
  place(out, 1);
  place(inn, -1);

  // Anything not connected to the focus sits in a quiet row underneath.
  if (loose.length) {
    const maxY = Math.max(fs.height / 2, ...[...pos.values()].map((p) => p.y + 70));
    let x = -(loose.reduce((a, id) => a + size.get(id)!.width + GAP, 0) - GAP) / 2;
    for (const id of loose) {
      pos.set(id, { x, y: maxY + 90 });
      x += size.get(id)!.width + GAP;
    }
  }
  return { pos, labels };
}

/** Rough box size so ELK can reserve space before the DOM measures the node. */
export function estimateSize(opts: { focus: boolean; type: string; layers: number; fields: number; chips: number; sub: boolean }): { width: number; height: number } {
  if (!opts.focus) {
    return { width: 210, height: (opts.sub ? 62 : 46) + (opts.layers > 1 ? 15 : 0) };
  }
  let h = 74;
  if (opts.sub) h += 18;
  if (opts.layers > 0) h += 30;
  if (opts.type === "model") h += 12 + Math.min(opts.fields, 8) * 16 + (opts.fields > 8 ? 14 : 0);
  if (opts.chips > 0) h += 24;
  if (opts.type === "method" || opts.type === "component") h += 20;
  return { width: 300, height: h };
}
