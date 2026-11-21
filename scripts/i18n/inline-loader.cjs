// Webpack loader (before SWC) for src/**/*.{ts,tsx}: every `t("key")` whose translator comes from a namespace
// (`const t = useT(ns)` / `serverT(ns)` / `await getT(ns)` / `translator(ns, …)`, or a parameter typed
// `Translator<typeof ns.en>`) gets the key's English text as an extra last argument, compiled as
// scripts/i18n/icu-loader.cjs compiles it. The translator uses the page's language first and that English otherwise
// (src/i18n/catalog.ts), so a component carries exactly the English it shows, as its inline text did before languages
// existed. When every use of a translator is such a call (or a hand-over to a helper whose own uses all are), it gets a
// stub of the namespace (its name only) and the namespace's English leaves the bundle. Anything else (t.has, a
// translator stored or passed where it can't be followed) keeps the whole namespace: correct, just not trimmed.
// Which helpers are safe to hand a translator to is worked out once per build over all of src (see `registry`).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { englishMessage, helperCode, getCompile } = require("./icu-loader.cjs");

const MAKERS = new Set(["useT", "serverT", "getT", "translator"]);
const H = { N: "__i18nN", O: "__i18nO", F: "__i18nF", M: "__i18nM", A: "__i18nA" };
const debug = !!process.env.I18N_INLINE_DEBUG;

function leaf(tree, key) {
  let node = tree;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function leaves(tree, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push([key, v]);
    else if (v && typeof v === "object") out.push(...leaves(v, key));
  }
  return out;
}

/** The names a node declares directly in its own scope (parameters, its block's const/let/var and functions). */
function declaredHere(node) {
  const out = new Map();
  const addBinding = (name, decl) => {
    if (ts.isIdentifier(name)) out.set(name.text, decl);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const el of name.elements) if (!ts.isOmittedExpression(el)) addBinding(el.name, ts.isIdentifier(el.name) ? el : decl);
  };
  if (ts.isFunctionLike(node)) for (const p of node.parameters) addBinding(p.name, p);
  const statements = ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node) ? node.statements : null;
  if (statements) {
    for (const st of statements) {
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) addBinding(d.name, d);
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.set(st.name.text, st);
      else if (ts.isImportDeclaration(st) && st.importClause) {
        if (st.importClause.name) out.set(st.importClause.name.text, st);
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) out.set(el.name.text, el);
        if (nb && ts.isNamespaceImport(nb)) out.set(nb.name.text, st);
      }
    }
  }
  if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer))
    for (const d of node.initializer.declarations) addBinding(d.name, d);
  if (ts.isCatchClause(node) && node.variableDeclaration) addBinding(node.variableDeclaration.name, node.variableDeclaration);
  return out;
}

function resolve(id) {
  for (let n = id.parent; n; n = n.parent) {
    const d = declaredHere(n).get(id.text);
    if (d) return d;
  }
  return null;
}

const unwrap = (e) => (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)) || ts.isNonNullExpression(e) ? unwrap(e.expression) : e);
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "@/x/y" or "./y" from `file` → the .ts/.tsx file it names, if any. */
function resolveModule(spec, file, src) {
  const base = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** A function's parameter list, for a function declaration or a const initialised with a function. */
function functionOf(d) {
  if (!d) return null;
  if (ts.isFunctionDeclaration(d)) return d;
  if (ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return d.initializer;
  return null;
}

const isExported = (node) => {
  const holder = ts.isVariableDeclaration(node) ? node.parent?.parent : node;
  return !!holder && ts.canHaveModifiers(holder) && (ts.getModifiers(holder) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
};

/**
 * One file: its translators, how each is used, the edits that inline English, and which of its exported helpers'
 * translator parameters are safe (every use inlined). `registry`: file → export → [param index → namespace] known safe.
 */
function analyze(file, source, compile, registry, src, addDependency) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const namespaces = new Map(); // local name -> { name, tree }
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.name) continue;
    const m = /^@\/messages\/([a-z0-9-]+)$/.exec(st.moduleSpecifier.text);
    if (!m) continue;
    const json = path.join(src, "messages", "en", `${m[1]}.json`);
    if (!fs.existsSync(json)) continue;
    addDependency?.(json);
    namespaces.set(st.importClause.name.text, { name: m[1], tree: JSON.parse(fs.readFileSync(json, "utf8")) });
  }
  const result = { out: source, safe: [] };
  if (!namespaces.size) return result;

  const translators = new Map(); // declaration -> { ns, nsArg, escapes, edits, parent, exportAs }
  // Type aliases of a translator: `type BoardT = Translator<typeof board.en>`.
  const translatorType = /^Translator<typeof([A-Za-z_$][\w$]*)\.en>$/;
  const typeAliases = new Map();
  for (const st of sf.statements) {
    if (!ts.isTypeAliasDeclaration(st)) continue;
    const m = translatorType.exec(st.type.getText(sf).replace(/\s+/g, ""));
    if (m && namespaces.has(m[1])) typeAliases.set(st.name.text, m[1]);
  }
  const nsOfType = (type) => {
    const text = type.getText(sf).replace(/\s+/g, "");
    const m = translatorType.exec(text);
    return m && namespaces.has(m[1]) ? m[1] : typeAliases.get(text) ?? null;
  };
  const visitDecls = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init = n.initializer;
      if (ts.isAwaitExpression(init)) init = init.expression;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && MAKERS.has(init.expression.text) && init.arguments[0] && ts.isIdentifier(init.arguments[0]) && namespaces.has(init.arguments[0].text))
        translators.set(n, { ns: namespaces.get(init.arguments[0].text), nsArg: init.arguments[0], escapes: false, edits: [], parent: null });
    }
    // A parameter typed Translator<typeof ns.en> (a helper's): a translator of that namespace.
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.type) {
      const local = nsOfType(n.type);
      if (local) {
        const fn = n.parent;
        const holder = ts.isFunctionDeclaration(fn) ? fn : (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) ? fn.parent : null;
        const exportAs = holder && isExported(holder) && holder.name && ts.isIdentifier(holder.name) ? [holder.name.text, fn.parameters.indexOf(n)] : null;
        // An English default (`= translator(ns, "en", undefined)`): it gets the stub too when every use is inlined.
        const init = n.initializer && ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression) && MAKERS.has(n.initializer.expression.text) ? n.initializer : null;
        const nsArg = init && init.arguments[0] && ts.isIdentifier(init.arguments[0]) && init.arguments[0].text === local ? init.arguments[0] : null;
        translators.set(n, { ns: namespaces.get(local), nsArg, escapes: false, edits: [], parent: null, exportAs });
      }
    }
    ts.forEachChild(n, visitDecls);
  };
  visitDecls(sf);
  if (!translators.size) return result;

  const used = new Set();
  const en = (ns, key) => {
    const text = leaf(ns.tree, key);
    return text === undefined ? undefined : englishMessage(text, compile, `${ns.name}.${key}`, used, H);
  };
  // The English for a key: a string key's message; for conditions and templates, the messages they can name, picked
  // with the key expression itself (read a second time: keys are conditions and template reads, no effects).
  const englishFor = (ns, keyNode0) => {
    const keyNode = unwrap(keyNode0);
    if (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)) {
      const m = en(ns, keyNode.text);
      return m === undefined ? undefined : { direct: m };
    }
    const patterns = [];
    const collect = (e0) => {
      const e = unwrap(e0);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return patterns.push(new RegExp(`^${esc(e.text)}$`)), true;
      if (ts.isConditionalExpression(e)) return collect(e.whenTrue) && collect(e.whenFalse);
      if (ts.isTemplateExpression(e)) {
        let re = esc(e.head.text);
        for (const span of e.templateSpans) re += `[^.]+${esc(span.literal.text)}`;
        return patterns.push(new RegExp(`^${re}$`)), true;
      }
      return false;
    };
    if (!collect(keyNode)) return undefined;
    if (/\bt[A-Za-z]*\(/.test(keyNode.getText(sf))) return undefined;
    const entries = [];
    for (const [key] of leaves(ns.tree)) if (patterns.some((re) => re.test(key))) entries.push(`${JSON.stringify(key)}:${en(ns, key)}`);
    if (!entries.length) return undefined;
    return { map: `({${entries.join(",")}})` };
  };

  const aliases = [];
  const localParam = (call, index) => {
    const callee = unwrap(call.expression);
    if (!ts.isIdentifier(callee)) return null;
    const param = functionOf(resolve(callee))?.parameters[index];
    return param && ts.isIdentifier(param.name) && !param.dotDotDotToken ? param : null;
  };
  // A helper imported from another file whose parameter at `index` is known to inline every use of this namespace.
  const importedSafe = (call, index, ns) => {
    const callee = unwrap(call.expression);
    if (!ts.isIdentifier(callee)) return false;
    const d = resolve(callee);
    if (!d || !ts.isImportSpecifier(d)) return false;
    const spec = d.parent.parent.parent.moduleSpecifier.text;
    const target = resolveModule(spec, file, src);
    const name = (d.propertyName ?? d.name).text;
    return !!target && registry.get(target)?.get(name)?.[index] === ns.name;
  };
  const localProp = (attr) => {
    const el = attr.parent?.parent;
    if (!el || !(ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el)) || !ts.isIdentifier(el.tagName)) return null;
    const first = functionOf(resolve(el.tagName))?.parameters[0];
    if (!first || !ts.isObjectBindingPattern(first.name)) return null;
    const want = attr.name.getText(sf);
    return first.name.elements.find((b) => ts.isIdentifier(b.name) && (b.propertyName ? b.propertyName.getText(sf) : b.name.text) === want && !b.dotDotDotToken) ?? null;
  };

  const visitOne = (n, tr) => {
    const p = n.parent;
    let call = null;
    let rich = false;
    if (ts.isCallExpression(p) && p.expression === n) call = p;
    else if (ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "rich" && ts.isCallExpression(p.parent) && p.parent.expression === p) (call = p.parent), (rich = true);
    const english = call && call.arguments.length >= 1 && call.arguments.length <= 2 && !call.arguments.some(ts.isSpreadElement) ? englishFor(tr.ns, call.arguments[0]) : undefined;
    const readsLocale = ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "locale";
    const inDeps = ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && ts.isIdentifier(p.parent.expression) && /^use(Effect|LayoutEffect|Memo|Callback)$/.test(p.parent.expression.text);
    const argIndex = ts.isCallExpression(p) && p.expression !== n ? p.arguments.indexOf(n) : -1;
    const localArg = argIndex >= 0 ? localParam(p, argIndex) : ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) ? localProp(p.parent) : null;
    if (readsLocale || inDeps) return;
    if (localArg) return void aliases.push([localArg, tr]);
    if (argIndex >= 0 && importedSafe(p, argIndex, tr.ns)) return;
    if (english === undefined) {
      tr.escapes = true;
      if (debug) console.log(`[i18n-inline] ${path.relative(process.cwd(), file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} keeps ${tr.ns.name}: ${(call ?? p).getText(sf).slice(0, 90)}`);
      return;
    }
    const at = call.arguments[call.arguments.length - 1].getEnd();
    const extra = english.direct !== undefined ? english.direct : `${english.map}[${call.arguments[0].getText(sf)}]`;
    tr.edits.push([at, at, call.arguments.length === 1 ? (rich ? `, {}, ${extra}` : `, undefined, ${extra}`) : `, ${extra}`]);
  };
  const scan = (decls) => {
    const walk = (n) => {
      if (ts.isIdentifier(n)) {
        const parent = n.parent;
        const isDeclName = parent && (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === n;
        const isPropName = parent && ts.isPropertyAccessExpression(parent) && parent.name === n;
        const isKey = parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isJsxAttribute(parent)) && parent.name === n;
        const isType = parent && (ts.isTypeQueryNode(parent) || ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent));
        if (!isDeclName && !isPropName && !isKey && !isType) {
          const d = resolve(n);
          if (d && decls.has(d)) visitOne(n, translators.get(d));
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
  };
  scan(new Set(translators.keys()));
  for (let round = 0; round < 4 && aliases.length; round++) {
    const batch = aliases.splice(0);
    const fresh = new Set();
    for (const [param, tr] of batch) {
      if (translators.has(param)) {
        const known = translators.get(param);
        if (known.ns !== tr.ns) known.escapes = tr.escapes = true;
        else if (known !== tr && !known.parent && known.nsArg === null) known.parent = known.parent ?? null;
        continue;
      }
      translators.set(param, { ns: tr.ns, nsArg: null, escapes: false, edits: [], parent: tr });
      fresh.add(param);
    }
    if (fresh.size) scan(fresh);
  }
  if (aliases.length) for (const [, tr] of aliases) tr.escapes = true;
  // An alias that escapes takes its translator's namespace with it.
  for (const tr of translators.values()) if (tr.escapes) for (let p = tr.parent; p; p = p.parent) p.escapes = true;
  const rootOf = (tr) => {
    let r = tr;
    while (r.parent) r = r.parent;
    return r;
  };

  const edits = [];
  for (const tr of translators.values()) if (!rootOf(tr).escapes) edits.push(...tr.edits);
  for (const tr of translators.values()) if (tr.exportAs && !tr.escapes) result.safe.push([...tr.exportAs, tr.ns.name]);
  const stubs = new Map();
  for (const tr of translators.values()) {
    if (tr.escapes || !tr.nsArg) continue;
    const id = `__i18nNs_${tr.ns.name.replace(/[^a-z0-9]/g, "_")}`;
    stubs.set(id, tr.ns.name);
    edits.push([tr.nsArg.getStart(sf), tr.nsArg.getEnd(), id]);
  }
  if (!edits.length) return result;
  const lastImport = [...sf.statements].filter(ts.isImportDeclaration).pop();
  const head = `\n${helperCode(used, H)}${[...stubs].map(([id, name]) => `const ${id}={name:${JSON.stringify(name)},en:{}};`).join("")}\n`;
  const at = lastImport ? lastImport.getEnd() : 0;
  if (head.trim()) edits.push([at, at, head]);
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = source;
  for (const [from, to, text] of edits) out = out.slice(0, from) + text + out.slice(to);
  result.out = out;
  return result;
}

/** Every file of src that uses message namespaces, and which of their exported helpers are safe (to a fixpoint). */
let registryPromise = null;
function buildRegistry(src, compile) {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!/^(messages|i18n|data)$/.test(name) || dir !== src) walk(full);
      } else if (/\.tsx?$/.test(name)) {
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("@/messages/")) files.push([full, text]);
      }
    }
  };
  walk(src);
  const registry = new Map();
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const [file, text] of files) {
      const { safe } = analyze(file, text, compile, registry, src);
      const before = JSON.stringify([...(registry.get(file) ?? new Map())]);
      const map = new Map();
      for (const [name, index, ns] of safe) {
        const slots = map.get(name) ?? [];
        slots[index] = ns;
        map.set(name, slots);
      }
      if (JSON.stringify([...map]) !== before) changed = true;
      registry.set(file, map);
    }
    if (!changed) break;
  }
  return registry;
}

module.exports = function inlineLoader(source) {
  const done = this.async();
  if (!source.includes("@/messages/") && !source.includes("Translator<")) return done(null, source);
  const src = path.resolve(this.rootContext ?? process.cwd(), "src");
  getCompile()
    .then(async (compile) => {
      registryPromise ??= Promise.resolve().then(() => buildRegistry(src, compile));
      const registry = await registryPromise;
      done(null, analyze(this.resourcePath, source, compile, registry, src, (f) => this.addDependency(f)).out);
    })
    .catch((e) => done(new Error(`${this.resourcePath}: ${e.message}`)));
};
module.exports.analyze = analyze;
module.exports.buildRegistry = buildRegistry;
