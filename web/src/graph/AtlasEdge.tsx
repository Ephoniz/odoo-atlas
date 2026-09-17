import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { kindMeta } from "../data/kinds";

export interface AtlasEdgeData extends Record<string, unknown> {
  kind: string;
  label?: string;
  hl: boolean;    // connected to hovered node
  dim: boolean;   // some other node hovered
  step: boolean;  // orthogonal routing (galaxy)
  count: number;  // parallel edges collapsed
  primary: boolean; // touches the focus; drives layout and is drawn at full strength
}

export type AtlasFlowEdge = Edge<AtlasEdgeData, "atlas">;

const FAMILY_STROKE: Record<string, string> = {
  structure: "var(--sea-line-2)",
  inherit: "var(--c-module)",
  relation: "var(--c-field)",
  flow: "var(--c-method)",
  bridge: "var(--notice)",
  ui: "var(--c-view)",
};

export function edgeStyle(kind: string) {
  const fam = kindMeta(kind).family;
  const stroke = FAMILY_STROKE[fam];
  let dash: string | undefined;
  if (fam === "relation") dash = "6 4";
  if (fam === "flow") dash = "2 4";
  if (fam === "ui") dash = "8 3 2 3";
  const animated = fam === "bridge";
  return { stroke, dash, animated };
}

export const AtlasEdge = memo(function AtlasEdge(props: EdgeProps<AtlasFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const kind = data?.kind ?? "";
  const { stroke, dash, animated } = edgeStyle(kind);
  const [path, lx, ly] = data?.step
    ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.28 });
  const hl = !!data?.hl;
  const dim = (!!data?.dim || !data?.primary) && !hl;
  const km = kindMeta(kind);
  const text = data?.label ? `${km.out} ${data.label}` : km.out;
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: hl ? 2 : 1.2,
          strokeOpacity: dim ? 0.1 : hl ? 1 : 0.6,
          strokeDasharray: dash,
          animation: animated && !dim ? "dashflow 1.4s linear infinite" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`edge-label${hl ? " show" : ""}`}
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
        >
          {text}
          {data && data.count > 1 ? ` +${data.count - 1}` : ""}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
