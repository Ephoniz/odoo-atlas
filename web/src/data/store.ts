import { create } from "zustand";
import type { AtlasEdge, AtlasNode, EdgeGroup, Lens, Meta } from "./types";
import { defaultGroups, homeLens, lensFits, LENS_META } from "./neighbourhood";

// BASE_URL is "/" locally and "/<repo>/" on GitHub Pages.
const DATA = `${import.meta.env.BASE_URL}data`;
let loading: Promise<void> | null = null;
const HARD_CAP = 220;
let dataVersion = "";

export interface AtlasState {
  status: "loading" | "ready" | "error";
  error?: string;
  progress: string;
  meta: Meta | null;
  nodes: Map<string, AtlasNode>;
  out: Map<string, AtlasEdge[]>;
  inn: Map<string, AtlasEdge[]>;
  details: Map<string, Record<string, unknown>>; // module -> {id: detail}
  detailLoading: Set<string>;

  lens: Lens;
  focus: string | null;
  visible: string[];               // ordered for stable layout
  expanded: Set<string>;           // `${nodeId}|${dir}|${kind}`
  hover: string | null;
  trail: string[];
  inspectorOpen: boolean;
  paletteOpen: boolean;
  hiddenKinds: Set<string>;

  load: () => Promise<void>;
  loadOnce: () => Promise<void>;
  setLens: (lens: Lens) => void;
  setFocus: (id: string, opts?: { keep?: boolean; lens?: Lens }) => void;
  toggleGroup: (nodeId: string, dir: "out" | "in", kind: string) => void;
  addNodes: (ids: string[]) => void;
  removeNode: (id: string) => void;
  setHover: (id: string | null) => void;
  setInspector: (open: boolean) => void;
  setPalette: (open: boolean) => void;
  toggleKind: (kind: string) => void;
  ensureDetail: (id: string) => Promise<void>;
  goBack: () => void;
  groupsOf: (id: string) => EdgeGroup[];
}

export const useAtlas = create<AtlasState>((set, get) => ({
  status: "loading",
  progress: "Reading the chart…",
  meta: null,
  nodes: new Map(),
  out: new Map(),
  inn: new Map(),
  details: new Map(),
  detailLoading: new Set(),

  lens: "models",
  focus: null,
  visible: [],
  expanded: new Set(),
  hover: null,
  trail: [],
  inspectorOpen: true,
  paletteOpen: false,
  hiddenKinds: new Set(),

  load() {
    // StrictMode mounts effects twice in dev; fetch the 7 MB of data once.
    loading ??= get().loadOnce();
    return loading;
  },

  async loadOnce() {
    try {
      set({ progress: "Loading index…" });
      const meta = (await fetch(`${DATA}/meta.json`, { cache: "no-cache" }).then((r) => r.json())) as Meta;
      dataVersion = encodeURIComponent(meta.generated_at);
      const [index, edges] = await Promise.all([
        fetch(`${DATA}/index.json?v=${dataVersion}`).then((r) => r.json() as Promise<AtlasNode[]>),
        fetch(`${DATA}/edges.json?v=${dataVersion}`).then((r) => r.json() as Promise<AtlasEdge[]>),
      ]);
      set({ progress: "Plotting soundings…" });
      const nodes = new Map<string, AtlasNode>();
      for (const n of index) nodes.set(n.id, n);
      const out = new Map<string, AtlasEdge[]>();
      const inn = new Map<string, AtlasEdge[]>();
      for (const e of edges) {
        (out.get(e.s) ?? out.set(e.s, []).get(e.s)!).push(e);
        (inn.get(e.t) ?? inn.set(e.t, []).get(e.t)!).push(e);
      }
      set({ meta, nodes, out, inn, status: "ready" });
      const fromUrl = readHash();
      if (fromUrl) {
        get().setFocus(fromUrl.focus, { lens: fromUrl.lens });
      } else {
        get().setFocus(LENS_META.models.starter, { lens: "models" });
      }
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  setLens(lens) {
    const { focus, nodes } = get();
    set({ lens });
    let target = focus;
    // The galaxy is a chart of modules: land on the module that owns the focus.
    if (lens === "galaxy" && focus) {
      const n = nodes.get(focus);
      if (n && n.t !== "module" && n.m && nodes.has(`mod:${n.m}`)) target = `mod:${n.m}`;
    }
    if (target) get().setFocus(target, { keep: false, lens });
    else writeHash(lens, null);
  },

  setFocus(id, opts) {
    const st = get();
    const node = st.nodes.get(id);
    if (!node) return;
    // Stay in the current lens if it knows how to chart this kind of node; otherwise
    // jump to its home lens (a component picked from search while in Methods → OWL).
    const lens = opts?.lens ?? (lensFits(st.lens, node.t) ? st.lens : homeLens(node.t));
    const groups = defaultGroups(lens, node);
    const expanded = new Set<string>();
    // `keep` carries the previous focus along so you can see where you came from;
    // the rest of the old neighbourhood is dropped to keep the chart a clean star.
    const visible: string[] = [id];
    if (opts?.keep && st.focus && st.focus !== id) visible.push(st.focus);
    const seen = new Set(visible);
    if (lens === "galaxy") {
      // The galaxy is the whole module DAG; the focus is just where the light is.
      for (const n of st.nodes.values()) if (n.t === "module" && !seen.has(n.id)) { seen.add(n.id); visible.push(n.id); }
    }
    for (const g of groups) {
      const list = (g.dir === "out" ? st.out : st.inn).get(id) ?? [];
      if (!list.some((e) => e.k === g.kind)) continue;
      expanded.add(`${id}|${g.dir}|${g.kind}`);
      let n = 0;
      for (const e of list) {
        if (e.k !== g.kind) continue;
        const other = g.dir === "out" ? e.t : e.s;
        if (seen.has(other)) continue;
        if (g.limit && n >= g.limit) break;
        seen.add(other);
        visible.push(other);
        n++;
        if (visible.length >= HARD_CAP) break;
      }
    }
    // Trail: don't duplicate the tail.
    const trail = st.trail[st.trail.length - 1] === id ? st.trail : [...st.trail.slice(-40), id];
    set({ focus: id, lens, visible, expanded, trail, inspectorOpen: true, hover: null });
    writeHash(lens, id);
    void get().ensureDetail(id);
  },

  toggleGroup(nodeId, dir, kind) {
    const st = get();
    const key = `${nodeId}|${dir}|${kind}`;
    const expanded = new Set(st.expanded);
    const list = ((dir === "out" ? st.out : st.inn).get(nodeId) ?? []).filter((e) => e.k === kind);
    const others = list.map((e) => (dir === "out" ? e.t : e.s));
    if (expanded.has(key)) {
      expanded.delete(key);
      // Remove nodes that are no longer reachable via any expanded group and aren't the focus.
      const stillNeeded = new Set<string>([st.focus!]);
      for (const k of expanded) {
        const [nid, d, kd] = k.split("|");
        stillNeeded.add(nid);
        for (const e of (d === "out" ? st.out : st.inn).get(nid) ?? []) if (e.k === kd) stillNeeded.add(d === "out" ? e.t : e.s);
      }
      set({ expanded, visible: st.visible.filter((v) => stillNeeded.has(v) || !others.includes(v)) });
    } else {
      expanded.add(key);
      const seen = new Set(st.visible);
      const visible = [...st.visible];
      for (const o of others) {
        if (seen.has(o) || !st.nodes.has(o)) continue;
        seen.add(o);
        visible.push(o);
        if (visible.length >= HARD_CAP) break;
      }
      set({ expanded, visible });
    }
  },

  addNodes(ids) {
    const st = get();
    const seen = new Set(st.visible);
    const visible = [...st.visible];
    for (const id of ids) if (!seen.has(id) && st.nodes.has(id)) { seen.add(id); visible.push(id); }
    set({ visible });
  },

  removeNode(id) {
    const st = get();
    if (id === st.focus) return;
    set({ visible: st.visible.filter((v) => v !== id) });
  },

  setHover: (hover) => set({ hover }),
  setInspector: (inspectorOpen) => set({ inspectorOpen }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  toggleKind(kind) {
    const hiddenKinds = new Set(get().hiddenKinds);
    if (hiddenKinds.has(kind)) hiddenKinds.delete(kind); else hiddenKinds.add(kind);
    set({ hiddenKinds });
  },

  async ensureDetail(id) {
    const st = get();
    const node = st.nodes.get(id);
    const shard = node?.m ?? "_unowned";
    if (st.details.has(shard) || st.detailLoading.has(shard)) return;
    if (st.meta && !st.meta.shards.includes(shard)) return;
    const loading = new Set(st.detailLoading);
    loading.add(shard);
    set({ detailLoading: loading });
    try {
      const payload = (await fetch(`${DATA}/detail/${shard}.json?v=${dataVersion}`).then((r) => r.json())) as Record<string, unknown>;
      const details = new Map(get().details);
      details.set(shard, payload);
      set({ details });
    } finally {
      const l = new Set(get().detailLoading);
      l.delete(shard);
      set({ detailLoading: l });
    }
  },

  goBack() {
    const st = get();
    if (st.trail.length < 2) return;
    const trail = st.trail.slice(0, -1);
    const prev = trail[trail.length - 1];
    set({ trail: trail.slice(0, -1) });
    get().setFocus(prev);
  },

  groupsOf(id) {
    const st = get();
    const groups: EdgeGroup[] = [];
    const push = (dir: "out" | "in", list: AtlasEdge[]) => {
      const byKind = new Map<string, AtlasEdge[]>();
      for (const e of list) (byKind.get(e.k) ?? byKind.set(e.k, []).get(e.k)!).push(e);
      for (const [kind, edges] of byKind) groups.push({ key: `${dir}:${kind}`, kind, dir, edges });
    };
    push("out", st.out.get(id) ?? []);
    push("in", st.inn.get(id) ?? []);
    return groups;
  },
}));

export function detailOf(st: AtlasState, id: string): Record<string, unknown> | undefined {
  const node = st.nodes.get(id);
  const shard = node?.m ?? "_unowned";
  return st.details.get(shard)?.[id] as Record<string, unknown> | undefined;
}

/* ---------- URL state ---------- */

function readHash(): { lens: Lens; focus: string } | null {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  if (!h) return null;
  const [lens, ...rest] = h.split("/");
  const focus = rest.join("/");
  if (!focus || !(lens in LENS_META)) return null;
  return { lens: lens as Lens, focus };
}

function writeHash(lens: Lens, focus: string | null) {
  const next = focus ? `#/${lens}/${encodeURIComponent(focus)}` : `#/${lens}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

window.addEventListener("hashchange", () => {
  const st = useAtlas.getState();
  const h = readHash();
  if (h && (h.focus !== st.focus || h.lens !== st.lens) && st.status === "ready") st.setFocus(h.focus, { lens: h.lens });
});
