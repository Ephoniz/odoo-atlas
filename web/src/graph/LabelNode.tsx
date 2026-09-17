import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { kindMeta } from "../data/kinds";
import { edgeStyle } from "./AtlasEdge";

export interface LabelData extends Record<string, unknown> {
  kind: string;
  dir: "out" | "in";
  count: number;
}

export type LabelFlowNode = Node<LabelData, "label">;

/** Chart-margin annotation above each group of neighbours in the fan layout. */
export const LabelNode = memo(function LabelNode({ data }: NodeProps<LabelFlowNode>) {
  const km = kindMeta(data.kind);
  const s = edgeStyle(data.kind);
  return (
    <div className="glabel" style={{ ["--stroke" as string]: s.stroke }}>
      <svg width="14" height="6" aria-hidden>
        <line x1="0" y1="3" x2="14" y2="3" stroke={s.stroke} strokeWidth="1.6" strokeDasharray={s.dash} />
      </svg>
      <span>{data.dir === "out" ? km.out : km.in}</span>
      <span className="n">{data.count}</span>
    </div>
  );
});
