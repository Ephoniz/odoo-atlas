import type { AtlasNode, Lens } from "./types";

export interface GroupSpec {
  dir: "out" | "in";
  kind: string;
  limit?: number;
}

/**
 * Which edge groups open by default when a node becomes the focus, per lens.
 * Everything else stays one click away in the inspector's Relations tab.
 */
export function defaultGroups(lens: Lens, node: AtlasNode): GroupSpec[] {
  const t = node.t;
  switch (lens) {
    case "galaxy":
      if (t === "module") return [{ dir: "out", kind: "depends" }, { dir: "in", kind: "depends", limit: 24 }];
      return [{ dir: "in", kind: "defines" }];

    case "models":
      if (t === "model")
        return [
          { dir: "out", kind: "many2one", limit: 18 },
          { dir: "out", kind: "one2many", limit: 12 },
          { dir: "out", kind: "many2many", limit: 12 },
          { dir: "out", kind: "mixin" },
          { dir: "out", kind: "inherits" },
          { dir: "in", kind: "inherits" },
          { dir: "in", kind: "defines" },
        ];
      if (t === "field")
        return [
          { dir: "in", kind: "has_field" },
          { dir: "out", kind: "targets" },
          { dir: "in", kind: "computes" }, { dir: "in", kind: "api_depends", limit: 12 },
          { dir: "out", kind: "related_via" },
        ];
      if (t === "method") return [{ dir: "in", kind: "has_method" }, { dir: "out", kind: "computes" }, { dir: "out", kind: "api_depends" }];
      if (t === "module") return [{ dir: "out", kind: "defines", limit: 30 }];
      return generic(node);

    case "methods":
      if (t === "method")
        return [
          { dir: "in", kind: "has_method" },
          { dir: "out", kind: "calls", limit: 20 },
          { dir: "in", kind: "calls", limit: 20 },
          { dir: "out", kind: "computes" },
          { dir: "out", kind: "api_depends", limit: 10 },
          { dir: "out", kind: "constrains" },
          { dir: "out", kind: "onchange" },
          { dir: "out", kind: "uses_model", limit: 10 },
          { dir: "in", kind: "button_calls" },
          { dir: "in", kind: "rpc" },
          { dir: "in", kind: "defines" },
        ];
      if (t === "model") return [{ dir: "out", kind: "has_method", limit: 40 }];
      if (t === "field") return [{ dir: "in", kind: "computes" }, { dir: "in", kind: "api_depends", limit: 20 }, { dir: "in", kind: "onchange" }, { dir: "in", kind: "constrains" }];
      return generic(node);

    case "owl":
      if (t === "component" || t === "jsclass")
        return [
          { dir: "out", kind: "extends" },
          { dir: "in", kind: "extends", limit: 14 },
          { dir: "out", kind: "child_component", limit: 16 },
          { dir: "in", kind: "child_component", limit: 10 },
          { dir: "out", kind: "renders" },
          { dir: "out", kind: "uses_service" },
          { dir: "in", kind: "registers" },
          { dir: "in", kind: "patches" },
          { dir: "in", kind: "renders_component", limit: 8 },
        ];
      if (t === "service") return [{ dir: "out", kind: "uses_service" }, { dir: "in", kind: "uses_service", limit: 24 }, { dir: "in", kind: "defines" }];
      if (t === "template") return [{ dir: "out", kind: "t_inherit" }, { dir: "in", kind: "t_inherit" }, { dir: "out", kind: "t_call" }, { dir: "in", kind: "renders" }, { dir: "out", kind: "renders_component", limit: 16 }];
      if (t === "registry") return [{ dir: "out", kind: "registers" }, { dir: "in", kind: "uses_widget", limit: 16 }, { dir: "in", kind: "client_action" }, { dir: "in", kind: "uses_js_class" }];
      if (t === "hook") return [{ dir: "out", kind: "uses_service" }, { dir: "in", kind: "uses_hook", limit: 24 }];
      if (t === "module") return [{ dir: "out", kind: "defines", limit: 30 }];
      return generic(node);

    case "bridge":
      if (t === "model")
        return [
          { dir: "in", kind: "rpc", limit: 24 },
          { dir: "in", kind: "view_of", limit: 12 },
          { dir: "in", kind: "opens_model", limit: 8 },
          { dir: "in", kind: "uses_model", limit: 12 },
        ];
      if (t === "method") return [{ dir: "in", kind: "has_method" }, { dir: "in", kind: "rpc" }, { dir: "in", kind: "button_calls" }, { dir: "in", kind: "calls", limit: 10 }];
      if (t === "component" || t === "service") return [{ dir: "out", kind: "rpc" }, { dir: "out", kind: "rpc_route" }, { dir: "in", kind: "registers" }, { dir: "out", kind: "uses_service" }];
      if (t === "view") return [{ dir: "out", kind: "view_of" }, { dir: "out", kind: "uses_widget" }, { dir: "out", kind: "uses_js_class" }, { dir: "out", kind: "button_calls" }, { dir: "out", kind: "view_inherits" }, { dir: "in", kind: "view_inherits", limit: 10 }, { dir: "in", kind: "opens_view" }];
      if (t === "registry") return [{ dir: "out", kind: "registers" }, { dir: "in", kind: "uses_widget", limit: 16 }, { dir: "in", kind: "client_action" }];
      if (t === "controller") return [{ dir: "out", kind: "serves" }, { dir: "out", kind: "calls" }, { dir: "out", kind: "uses_model" }, { dir: "in", kind: "defines" }];
      if (t === "route") return [{ dir: "in", kind: "serves" }, { dir: "in", kind: "rpc_route", limit: 16 }];
      if (t === "action") return [{ dir: "out", kind: "opens_model" }, { dir: "out", kind: "opens_view" }, { dir: "out", kind: "client_action" }, { dir: "in", kind: "button_opens" }];
      return generic(node);
  }
}

function generic(node: AtlasNode): GroupSpec[] {
  const base: GroupSpec[] = [{ dir: "in", kind: "defines" }];
  if (node.t === "module") base.push({ dir: "out", kind: "depends" });
  return base;
}

/** Node types each lens has a tailored neighbourhood for (everything else falls back to `generic`). */
const FITS: Record<Lens, Set<string>> = {
  galaxy:  new Set(["module"]),
  models:  new Set(["model", "field", "method", "module"]),
  methods: new Set(["method", "model", "field"]),
  owl:     new Set(["component", "jsclass", "service", "template", "registry", "hook", "module"]),
  bridge:  new Set(["model", "method", "component", "service", "view", "registry", "controller", "route", "action"]),
};

/** Does this lens know how to chart this node type, or would it just show "defined in"? */
export function lensFits(lens: Lens, t: string): boolean {
  return FITS[lens].has(t);
}

/** Lens a node type feels most at home in. */
export function homeLens(t: string): Lens {
  switch (t) {
    case "module": return "galaxy";
    case "model": case "field": return "models";
    case "method": return "methods";
    case "component": case "jsclass": case "service": case "template": case "hook": case "registry": return "owl";
    default: return "bridge";
  }
}

export const LENS_META: Record<Lens, { title: string; blurb: string; starter: string }> = {
  galaxy:  { title: "Galaxy",  blurb: "Modules and what they require of one another.", starter: "mod:sale" },
  models:  { title: "Models",  blurb: "ORM models, their fields and the strata of modules that shape them.", starter: "model:sale.order" },
  methods: { title: "Methods", blurb: "Method override stacks, call chains and computed-field flow.", starter: "method:sale.order._action_confirm" },
  owl:     { title: "OWL",     blurb: "Components, services, registries and templates of the web client.", starter: "cmp:web.FormController" },
  bridge:  { title: "Bridge",  blurb: "Where JavaScript meets Python: RPC calls, routes, actions and widgets.", starter: "model:sale.order" },
};
