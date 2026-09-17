import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type OnNodesChange,
} from "@xyflow/react";
import { useAtlas } from "../data/store";
import { kindRank, typeMeta } from "../data/kinds";
import { AtlasNode, type AtlasFlowNode } from "./AtlasNode";
import { AtlasEdge, type AtlasFlowEdge } from "./AtlasEdge";
import { directionFor, estimateSize, fanLayout, layout, type GroupLabel } from "./layout";
import { LabelNode, type LabelFlowNode } from "./LabelNode";
import { Legend } from "../ui/Legend";
import { Trail } from "../ui/Trail";
import { Caption } from "../ui/Caption";

const nodeTypes = { atlas: AtlasNode, label: LabelNode };
const edgeTypes = { atlas: AtlasEdge };
type FlowNode = AtlasFlowNode | LabelFlowNode;

function Inner() {
  const st = useAtlas();
  const { fitBounds } = useReactFlow();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [labels, setLabels] = useState<GroupLabel[]>([]);
  // Nodes are derived from the store, so React Flow can't write back into them.
  // We capture what it reports (measured size, drag moves) and merge it in ourselves;
  // the minimap needs `measured`, and drags would otherwise snap back.
  const [measured, setMeasured] = useState<Map<string, { width: number; height: number }>>(new Map());
  const [dragged, setDragged] = useState<Map<string, { x: number; y: number }>>(new Map());
  const layoutKey = useRef("");
  const sizeRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  const canvasRef = useRef<HTMLDivElement>(null);
  const dir = directionFor(st.lens);

  // Visible edges: both ends visible, kind not hidden, one edge per (s,t) pair.
  // "Primary" edges touch the focus (or a node you charted earlier) and drive the
  // layout; the rest are context, drawn faintly and ignored by ELK so the chart
  // stays a readable star around the focus instead of a hairball.
  const visibleSet = useMemo(() => new Set(st.visible), [st.visible]);
  const anchors = useMemo(() => {
    const a = new Set<string>();
    if (st.focus) a.add(st.focus);
    for (const id of st.trail.slice(-4)) if (visibleSet.has(id)) a.add(id);
    // In the galaxy every module is an anchor: the dependency DAG is the point.
    if (st.lens === "galaxy") for (const id of st.visible) a.add(id);
    return a;
  }, [st.focus, st.trail, visibleSet, st.lens, st.visible]);

  const edges = useMemo(() => {
    const seen = new Map<string, AtlasFlowEdge>();
    for (const id of st.visible) {
      for (const e of st.out.get(id) ?? []) {
        if (!visibleSet.has(e.t) || st.hiddenKinds.has(e.k) || e.s === e.t) continue;
        const primary = anchors.has(e.s) || anchors.has(e.t);
        const key = `${e.s}→${e.t}`;
        const rev = seen.get(`${e.t}→${e.s}`);
        if (rev) { rev.data!.count += 1; rev.data!.primary ||= primary; continue; }
        const ex = seen.get(key);
        if (ex) {
          ex.data!.count += 1;
          ex.data!.primary ||= primary;
          // prefer the more informative kind: bridge > flow > relation > inherit > ui > structure
          if (rank(e.k) > rank(ex.data!.kind)) { ex.data!.kind = e.k; ex.data!.label = e.label; }
          continue;
        }
        seen.set(key, {
          id: key, source: e.s, target: e.t, type: "atlas",
          data: { kind: e.k, label: e.label, hl: false, dim: false, step: dir === "DOWN", count: 1, primary },
        });
      }
    }
    return [...seen.values()];
  }, [st.visible, st.out, st.hiddenKinds, visibleSet, dir, anchors]);

  // Field list for a focused model (first stored/plain fields).
  const focusFields = useMemo(() => {
    if (!st.focus) return undefined;
    const n = st.nodes.get(st.focus);
    if (!n || n.t !== "model") return undefined;
    return (st.out.get(st.focus) ?? [])
      .filter((e) => e.k === "has_field")
      .map((e) => st.nodes.get(e.t))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .sort((a, b) => Number(!!b.comodel) - Number(!!a.comodel))
      .map((f) => ({ n: f.n, ftype: (f.ftype as string) ?? "" }));
  }, [st.focus, st.nodes, st.out]);

  // Run ELK whenever the visible set (or lens) changes.
  useEffect(() => {
    const key = `${st.lens}|${st.focus}|${st.visible.join(",")}|${edges.map((e) => e.id).join(",")}`;
    if (key === layoutKey.current) return;
    layoutKey.current = key;
    const sizes = st.visible.map((id) => {
      const n = st.nodes.get(id)!;
      const isFocus = id === st.focus;
      const s = estimateSize({
        focus: isFocus, type: n.t, layers: ((n.layers as string[]) ?? []).length,
        fields: isFocus ? (focusFields?.length ?? 0) : 0,
        chips: isFocus && Array.isArray(n.services) ? (n.services as string[]).length : 0,
        sub: true,
      });
      return { id, ...s };
    });
    sizeRef.current = new Map(sizes.map((s) => [s.id, { width: s.width, height: s.height }]));
    const primary = edges.filter((e) => e.data!.primary);
    if (st.lens !== "galaxy") {
      const r = fanLayout(sizes, st.focus, primary.map((e) => ({ source: e.source, target: e.target, rank: rank(e.data!.kind), kind: e.data!.kind })));
      setLabels(r.labels);
      setPositions(r.pos);
      setDragged(new Map());
      return;
    }
    layout(sizes, primary.map((e) => ({ id: e.id, source: e.source, target: e.target })), dir).then((pos) => {
      if (layoutKey.current !== key) return; // a newer layout superseded this one
      setLabels([]);
      setPositions(pos);
      setDragged(new Map());
    }).catch((err: unknown) => {
      console.error("[atlas] layout failed", err);
    });
  }, [st.visible, st.focus, st.lens, edges, dir, focusFields, st.nodes]);

  // Fit to the freshly computed positions (not to React Flow's possibly stale measurements).
  useEffect(() => {
    if (positions.size === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [id, p] of positions) {
      const s = sizeRef.current.get(id) ?? { width: 210, height: 60 };
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + s.width); y1 = Math.max(y1, p.y + s.height);
    }
    let w = x1 - x0 + 80, h = y1 - y0 + 80;
    // Never zoom past 1:1 — small charts should sit comfortably, not loom.
    const el = canvasRef.current;
    if (el) {
      const zoom = Math.min((el.clientWidth - 260) / w, (el.clientHeight - 140) / h, 1); // leave room for legend / trail
      w = el.clientWidth / zoom; h = el.clientHeight / zoom;
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const reduce = document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => fitBounds({ x: cx - w / 2, y: cy - h / 2, width: w, height: h }, { duration: reduce ? 0 : 450 }), 20);
    return () => clearTimeout(t);
  }, [positions, fitBounds]);

  const hoverNeighbours = useMemo(() => {
    if (!st.hover || !visibleSet.has(st.hover)) return null;
    const s = new Set<string>([st.hover]);
    for (const e of st.out.get(st.hover) ?? []) s.add(e.t);
    for (const e of st.inn.get(st.hover) ?? []) s.add(e.s);
    return s;
  }, [st.hover, st.out, st.inn, visibleSet]);

  const nodes: FlowNode[] = useMemo(() => {
    const main: FlowNode[] = st.visible.map((id) => {
      const n = st.nodes.get(id)!;
      const p = dragged.get(id) ?? positions.get(id) ?? { x: 0, y: 0 };
      const isFocus = id === st.focus;
      return {
        id, type: "atlas" as const, position: p, measured: measured.get(id),
        data: {
          node: n, focus: isFocus, dir,
          dim: !!hoverNeighbours && !hoverNeighbours.has(id),
          hover: st.hover === id,
          fields: isFocus ? focusFields : undefined,
        },
        draggable: true,
      };
    });
    for (const l of labels) {
      main.push({ id: l.id, type: "label", position: { x: l.x, y: l.y }, measured: measured.get(l.id), data: { kind: l.kind, dir: l.dir, count: l.count }, draggable: false, selectable: false, focusable: false });
    }
    return main;
  }, [st.visible, st.nodes, positions, dragged, measured, labels, st.focus, st.hover, hoverNeighbours, dir, focusFields]);

  const onNodesChange: OnNodesChange<FlowNode> = useCallback((changes) => {
    let m: Map<string, { width: number; height: number }> | null = null;
    let d: Map<string, { x: number; y: number }> | null = null;
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        m ??= new Map(measured);
        m.set(c.id, c.dimensions);
      } else if (c.type === "position" && c.position) {
        d ??= new Map(dragged);
        d.set(c.id, c.position);
      }
    }
    if (m) setMeasured(m);
    if (d) setDragged(d);
  }, [measured, dragged]);

  const styledEdges = useMemo(() => {
    if (!hoverNeighbours) return edges;
    return edges.map((e) => ({
      ...e,
      data: { ...e.data!, hl: e.source === st.hover || e.target === st.hover, dim: true },
    }));
  }, [edges, st.hover, hoverNeighbours]);

  const onNodeClick: NodeMouseHandler<FlowNode> = useCallback((_, node) => {
    if (node.type === "label") return;
    if (node.id === st.focus) { st.setInspector(true); return; }
    st.setFocus(node.id, { keep: true });
  }, [st]);

  const onNodeDoubleClick: NodeMouseHandler<FlowNode> = useCallback((_, node) => {
    if (node.type === "label") return;
    st.setFocus(node.id, { keep: false });
  }, [st]);

  return (
    <div className="canvas" ref={canvasRef}>
      <ReactFlow<FlowNode, AtlasFlowEdge>
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeMouseEnter={(_, n) => n.type !== "label" && st.setHover(n.id)}
        onNodeMouseLeave={() => st.setHover(null)}
        onPaneClick={() => st.setHover(null)}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnDoubleClick={false}
        defaultEdgeOptions={{ type: "atlas" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(233,223,199,0.06)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          position="bottom-right"
          style={{ bottom: 120, width: 160, height: 100 }}
          pannable
          zoomable
          nodeColor={(n) => (n.type === "label" ? "transparent" : cssColor(typeMeta((n as AtlasFlowNode).data.node.t).color))}
          nodeStrokeWidth={0}
          nodeBorderRadius={2}
          maskColor="rgba(15,29,43,0.7)"
        />
      </ReactFlow>
      <Trail />
      <Legend />
      <Caption />
    </div>
  );
}

const rank = kindRank;

/** SVG `fill` attributes don't resolve `var()`, so read the token off :root once. */
const colorCache = new Map<string, string>();
function cssColor(token: string): string {
  let v = colorCache.get(token);
  if (!v) {
    v = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#888";
    colorCache.set(token, v);
  }
  return v;
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
