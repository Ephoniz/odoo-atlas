// Parse Odoo addons' static/src JS and emit a JSON description of OWL
// components, services, registry entries, patches, hooks and ORM/RPC calls.
//
// usage: node js_owl.mjs <odoo_root> <addon_dir>[,<addon_dir>...] > out.json
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

const [odooRoot, addonList] = process.argv.slice(2);
if (!odooRoot || !addonList) {
  console.error("usage: node js_owl.mjs <odoo_root> <addon_dir,...>");
  process.exit(1);
}

const ORM_METHODS = new Set([
  "call", "create", "nameGet", "read", "readGroup", "formattedReadGroup", "webReadGroup", "search",
  "searchRead", "searchCount", "unlink", "webResequence", "webSearchRead", "webRead", "webSave",
  "webSaveMulti", "write",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "tests" || name === "lib" || name === "libs") continue;
      walk(p, out);
    } else if (name.endsWith(".js") && !name.endsWith(".test.js")) {
      out.push(p);
    }
  }
  return out;
}

function strLit(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked).join("");
  }
  return null;
}

function identifiersIn(node, acc = new Set()) {
  if (!node || typeof node !== "object") return acc;
  if (node.type === "Identifier") acc.add(node.name);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => identifiersIn(c, acc));
    else if (v && typeof v.type === "string") identifiersIn(v, acc);
  }
  return acc;
}

function memberChain(node) {
  // this.orm.call -> ["this","orm","call"]
  const parts = [];
  let cur = node;
  while (cur) {
    if (cur.type === "MemberExpression") {
      parts.unshift(cur.computed ? "[]" : cur.property.name ?? "?");
      cur = cur.object;
    } else if (cur.type === "ThisExpression") {
      parts.unshift("this");
      break;
    } else if (cur.type === "Identifier") {
      parts.unshift(cur.name);
      break;
    } else if (cur.type === "CallExpression") {
      // this.orm.silent.call / this.env.services.orm.call
      cur = cur.callee;
    } else break;
  }
  return parts;
}

function parseFile(file, module, relFile, source) {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["classProperties", "classPrivateProperties", "classPrivateMethods", "topLevelAwait", "importAttributes"],
      errorRecovery: true,
    });
  } catch (e) {
    return null;
  }
  const out = {
    module, file: relFile,
    imports: [], classes: [], registry: [], patches: [], hooks: [], orm: [], rpc: [], services: [],
  };
  const registryVars = new Map(); // const viewRegistry = registry.category("views")
  const topLevelObjects = new Map(); // name -> ObjectExpression (for services)

  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value;
      const names = path.node.specifiers.map((s) => s.local.name);
      out.imports.push({ from: src, names });
    },
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!init || id.type !== "Identifier") return;
      if (init.type === "CallExpression" && memberChain(init.callee).join(".") === "registry.category") {
        const cat = strLit(init.arguments[0]);
        if (cat) registryVars.set(id.name, cat);
      }
      if (init.type === "ObjectExpression") topLevelObjects.set(id.name, init);
    },
    ClassDeclaration(path) {
      const n = path.node;
      if (!n.id) return;
      const cls = {
        name: n.id.name,
        line: n.loc.start.line,
        endLine: n.loc.end.line,
        extends: n.superClass ? (n.superClass.type === "Identifier" ? n.superClass.name : memberChain(n.superClass).join(".")) : null,
        template: null, components: [], props: [], services: [], hooks: [], methods: [], orm: [], rpc: [],
        exported: path.parentPath.isExportNamedDeclaration() || path.parentPath.isExportDefaultDeclaration(),
        source: n.end - n.start > 6000 ? source.slice(n.start, n.start + 6000) + "\n// … truncated" : source.slice(n.start, n.end),
      };
      for (const el of n.body.body) {
        if (el.type === "ClassProperty" && el.static && el.key.type === "Identifier") {
          if (el.key.name === "template") {
            cls.template = strLit(el.value) ?? (el.value?.type === "TaggedTemplateExpression" ? "<inline xml>" : null);
          } else if (el.key.name === "components" && el.value?.type === "ObjectExpression") {
            for (const p of el.value.properties) {
              if (p.type === "ObjectProperty") cls.components.push(p.value.type === "Identifier" ? p.value.name : p.key.name ?? "?");
              else if (p.type === "SpreadElement") cls.components.push("..." + (p.argument.type === "Identifier" ? p.argument.name : "?"));
            }
          } else if (el.key.name === "props" && el.value?.type === "ObjectExpression") {
            for (const p of el.value.properties) {
              if (p.type === "ObjectProperty" && p.key.type === "Identifier") cls.props.push(p.key.name);
              else if (p.type === "SpreadElement" && p.argument.type === "Identifier") cls.props.push("..." + p.argument.name);
            }
          }
        } else if (el.type === "ClassMethod" && el.key.type === "Identifier") {
          cls.methods.push({ name: el.key.name, kind: el.kind, line: el.loc.start.line, static: !!el.static });
        }
      }
      // Body scan for hooks / orm / rpc
      path.traverse({
        CallExpression(p) {
          const callee = p.node.callee;
          if (callee.type === "Identifier") {
            if (callee.name === "useService") {
              const s = strLit(p.node.arguments[0]);
              if (s) cls.services.push(s);
            } else if (/^use[A-Z]/.test(callee.name)) {
              cls.hooks.push(callee.name);
            } else if (callee.name === "rpc") {
              const r = strLit(p.node.arguments[0]);
              if (r) cls.rpc.push(r);
            }
          } else if (callee.type === "MemberExpression") {
            const chain = memberChain(callee);
            const last = chain[chain.length - 1];
            const hasOrm = chain.includes("orm");
            if (hasOrm && ORM_METHODS.has(last)) {
              const model = strLit(p.node.arguments[0]);
              const method = last === "call" ? strLit(p.node.arguments[1]) : last;
              cls.orm.push({ model: model ?? dynamicLabel(p.node.arguments[0]), method, dynamic: model == null, line: p.node.loc.start.line });
            }
          }
        },
      });
      cls.services = [...new Set(cls.services)];
      cls.hooks = [...new Set(cls.hooks)];
      out.classes.push(cls);
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== "MemberExpression") return;
      const chain = memberChain(callee);
      const last = chain[chain.length - 1];
      // registry.category("x").add("key", value)   or  xRegistry.add("key", value)
      if (last === "add") {
        let cat = null;
        const obj = callee.object;
        if (obj.type === "CallExpression" && memberChain(obj.callee).join(".") === "registry.category") {
          cat = strLit(obj.arguments[0]);
        } else if (obj.type === "Identifier" && registryVars.has(obj.name)) {
          cat = registryVars.get(obj.name);
        } else if (obj.type === "CallExpression" && memberChain(obj.callee).slice(-1)[0] === "add") {
          // chained .add().add() — find root
          let root = obj;
          while (root.type === "CallExpression" && memberChain(root.callee).slice(-1)[0] === "add") root = root.callee.object;
          if (root.type === "CallExpression" && memberChain(root.callee).join(".") === "registry.category") cat = strLit(root.arguments[0]);
          else if (root.type === "Identifier" && registryVars.has(root.name)) cat = registryVars.get(root.name);
        }
        if (cat) {
          const key = strLit(path.node.arguments[0]);
          const value = path.node.arguments[1];
          const refs = value ? [...identifiersIn(value)] : [];
          const seq = path.node.arguments[2]?.type === "ObjectExpression"
            ? path.node.arguments[2].properties.find((p) => p.key?.name === "sequence")?.value?.value ?? null
            : null;
          out.registry.push({ category: cat, key: key ?? "<dynamic>", refs, line: path.node.loc.start.line, sequence: seq,
            valueKind: value?.type ?? null, valueName: value?.type === "Identifier" ? value.name : null });
          if (cat === "services" && value) {
            const svc = { key, line: path.node.loc.start.line, dependencies: [], asyncMethods: [] };
            const objNode = value.type === "ObjectExpression" ? value : (value.type === "Identifier" ? topLevelObjects.get(value.name) : null);
            if (objNode) {
              for (const p of objNode.properties) {
                if (p.type === "ObjectProperty" && p.key.name === "dependencies" && p.value.type === "ArrayExpression") {
                  svc.dependencies = p.value.elements.map(strLit).filter(Boolean);
                }
              }
              // orm calls inside the service body
              const found = [];
              traverse(objNode, {
                noScope: true,
                CallExpression(p2) {
                  const c = p2.node.callee;
                  if (c.type === "MemberExpression") {
                    const ch = memberChain(c);
                    const l = ch[ch.length - 1];
                    if (ch.includes("orm") && ORM_METHODS.has(l)) {
                      const model = strLit(p2.node.arguments[0]);
                      found.push({ model: model ?? dynamicLabel(p2.node.arguments[0]), method: l === "call" ? strLit(p2.node.arguments[1]) : l, dynamic: model == null, line: p2.node.loc.start.line });
                    }
                  } else if (c.type === "Identifier" && c.name === "rpc") {
                    const r = strLit(p2.node.arguments[0]);
                    if (r) found.push({ rpc: r, line: p2.node.loc.start.line });
                  }
                },
              });
              svc.orm = found.filter((f) => f.model);
              svc.rpc = found.filter((f) => f.rpc).map((f) => f.rpc);
            }
            out.services.push(svc);
          }
        }
      }
      // patch(X.prototype, {...}) / patch(X, {...})
    },
  });

  // patches, hooks, module-level orm/rpc (second cheap pass on top-level statements)
  for (const stmt of ast.program.body) {
    const expr = stmt.type === "ExpressionStatement" ? stmt.expression : null;
    if (expr?.type === "CallExpression" && expr.callee.type === "Identifier" && expr.callee.name === "patch") {
      const target = expr.arguments[0];
      const chain = target ? memberChain(target) : [];
      const targetName = chain[0] ?? "?";
      const proto = chain.includes("prototype");
      const members = [];
      if (expr.arguments[1]?.type === "ObjectExpression") {
        for (const p of expr.arguments[1].properties) {
          if (p.key?.type === "Identifier") members.push(p.key.name);
        }
      }
      out.patches.push({ target: targetName, prototype: proto, members, line: expr.loc.start.line });
    }
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "FunctionDeclaration" && decl.id && /^use[A-Z]/.test(decl.id.name)) {
      const services = new Set();
      traverse(decl, {
        noScope: true,
        CallExpression(p) {
          if (p.node.callee.type === "Identifier" && p.node.callee.name === "useService") {
            const s = strLit(p.node.arguments[0]);
            if (s) services.add(s);
          }
        },
      });
      out.hooks.push({ name: decl.id.name, line: decl.loc.start.line, services: [...services], exported: stmt.type === "ExportNamedDeclaration" });
    }
  }
  return out;
}

function dynamicLabel(node) {
  if (!node) return "<dynamic>";
  if (node.type === "MemberExpression" || node.type === "Identifier") return "<" + memberChain(node).join(".") + ">";
  return "<dynamic>";
}

const results = [];
for (const addonDir of addonList.split(",")) {
  const staticSrc = join(addonDir, "static", "src");
  let files = [];
  try { files = walk(staticSrc); } catch { continue; }
  const module = addonDir.split(/[\\/]/).filter(Boolean).pop();
  for (const f of files) {
    const rel = relative(odooRoot, f).split(sep).join("/");
    const src = readFileSync(f, "utf8");
    if (src.length > 400_000) {
      console.error(`[js_owl] skip (too large): ${rel}`);
      continue;
    }
    let parsed = null;
    try {
      parsed = parseFile(f, module, rel, src);
    } catch (e) {
      console.error(`[js_owl] skip (${e.constructor.name}): ${rel}`);
    }
    if (parsed) results.push(parsed);
  }
}
process.stdout.write(JSON.stringify(results));
