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
/* eslint-disable @typescript-eslint/no-require-imports -- a webpack loader, run by Node as CommonJS */

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { englishMessage, helperCode, getCompile } = require("./icu-loader.cjs");

const MAKERS = new Set(["useT", "serverT", "getT", "translator"]);
const H = { N: "__i18nN", O: "__i18nO", F: "__i18nF", M: "__i18nM", A: "__i18nA", T: "__i18nT", R: "__i18nR" };
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

/** The translator types a file exports (`export type BoardT = Translator<typeof board.en>`): type name → namespace name. */
const aliasCache = new Map();
function exportedAliases(file) {
  if (aliasCache.has(file)) return aliasCache.get(file);
  const out = new Map();
  aliasCache.set(file, out);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  if (!text.includes("Translator<")) return out;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const nsImports = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.name) continue;
    const m = /^@\/messages\/([a-z0-9-]+)$/.exec(st.moduleSpecifier.text);
    if (m) nsImports.set(st.importClause.name.text, m[1]);
  }
  for (const st of sf.statements) {
    if (!ts.isTypeAliasDeclaration(st) || !isExported(st)) continue;
    const m = /^Translator<typeof([A-Za-z_$][\w$]*)\.en>$/.exec(st.type.getText(sf).replace(/\s+/g, ""));
    if (m && nsImports.has(m[1])) out.set(st.name.text, nsImports.get(m[1]));
  }
  return out;
}

/** A file's safe slots for an export, following `export * from` and `export { a as b } from` (an index re-exporting helpers). */
function safeExport(file, name, registry, src, depth = 0) {
  const own = registry.get(file)?.get(name);
  if (own || depth > 4) return own;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  if (!/\bexport\b[^;]*\bfrom\b/.test(text)) return undefined;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || st.isTypeOnly) continue;
    const target = resolveModule(st.moduleSpecifier.text, file, src);
    if (!target) continue;
    if (!st.exportClause) {
      const found = safeExport(target, name, registry, src, depth + 1);
      if (found) return found;
    } else if (ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) if (el.name.text === name) return safeExport(target, (el.propertyName ?? el.name).text, registry, src, depth + 1);
    }
  }
  return undefined;
}

/**
 * One file: its translators, how each is used, the edits that inline English, and which of its exported helpers'
 * translator parameters are safe (every use inlined). `registry`: file → export → [param index → namespace] known safe.
 */
function analyze(file, source, compile, registry, src, addDependency, opts = {}) {
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
  // Translator types imported from another file (`import { type BoardT } from "@/lib/dle-i18n"`).
  const importedTypes = new Map(); // local type name -> local namespace key
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    const target = resolveModule(st.moduleSpecifier.text, file, src);
    if (!target) continue;
    const aliases = exportedAliases(target);
    if (!aliases.size) continue;
    for (const el of st.importClause.namedBindings.elements) {
      const nsName = aliases.get((el.propertyName ?? el.name).text);
      if (!nsName) continue;
      let key = [...namespaces].find(([, v]) => v.name === nsName)?.[0];
      if (!key) {
        const json = path.join(src, "messages", "en", `${nsName}.json`);
        if (!fs.existsSync(json)) continue;
        addDependency?.(json);
        key = `\0${nsName}`;
        namespaces.set(key, { name: nsName, tree: JSON.parse(fs.readFileSync(json, "utf8")) });
      }
      addDependency?.(target);
      importedTypes.set(el.name.text, key);
    }
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
    return m && namespaces.has(m[1]) ? m[1] : typeAliases.get(text) ?? importedTypes.get(text) ?? null;
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
  const collapsed = new Set(); // an English-only build's message helpers in use (see visitOne)
  const tables = new Map(); // a key expression's messages ("({…})") -> the module-level const holding them
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
        // A part that can only be some strings ("help" or "helpStrict") narrows the keys to those.
        const options = (x0) => {
          const x = unwrap(x0);
          if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return [x.text];
          if (ts.isConditionalExpression(x)) {
            const a = options(x.whenTrue);
            const b = a && options(x.whenFalse);
            return b ? [...a, ...b] : null;
          }
          return null;
        };
        let re = esc(e.head.text);
        for (const span of e.templateSpans) {
          const opts = options(span.expression);
          re += `${opts ? `(?:${opts.map(esc).join("|")})` : "[^.]+"}${esc(span.literal.text)}`;
        }
        return patterns.push(new RegExp(`^${re}$`)), true;
      }
      return false;
    };
    if (!collect(keyNode)) return undefined;
    // A translator call inside the key (not a method such as .test( ): its own edit would overlap.
    if (/(?<![.\w])t[A-Za-z]*\(/.test(keyNode.getText(sf))) return undefined;
    const entries = [];
    for (const [key] of leaves(ns.tree)) if (patterns.some((re) => re.test(key))) entries.push(`${JSON.stringify(key)}:${en(ns, key)}`);
    if (!entries.length) return undefined;
    if (debug && entries.length > 6) console.log(`[i18n-inline] ${path.relative(process.cwd(), file)}:${sf.getLineAndCharacterOfPosition(keyNode.getStart(sf)).line + 1} inlines ${entries.length} messages for ${keyNode.getText(sf).slice(0, 70)}`);
    // One table per distinct set of messages, shared by every call in the file that picks from it.
    const text = `({${entries.join(",")}})`;
    if (!tables.has(text)) tables.set(text, `__i18nMap${tables.size}`);
    return { map: tables.get(text) };
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
    const slot = target && safeExport(target, name, registry, src)?.[index];
    // "<ns>!": English-only, the helper needs nothing of the translator at run time (see `free` below).
    return slot === ns.name ? "safe" : slot === `${ns.name}!` ? "free" : false;
  };
  const localProp = (attr) => {
    const el = attr.parent?.parent;
    if (!el || !(ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el)) || !ts.isIdentifier(el.tagName)) return null;
    const first = functionOf(resolve(el.tagName))?.parameters[0];
    if (!first || !ts.isObjectBindingPattern(first.name)) return null;
    const want = attr.name.getText(sf);
    return first.name.elements.find((b) => ts.isIdentifier(b.name) && (b.propertyName ? b.propertyName.getText(sf) : b.name.text) === want && !b.dotDotDotToken) ?? null;
  };

  // Code that only runs on a page in another language: behind `if (t.locale === "en") return …`, or on the far side
  // of `t.locale !== "en" &&` and the like (any of this file's translators: a page has one language). There the
  // language's own messages answer (every language file has all of English's keys: check-messages), so a `t.has(…)`
  // or a key that can't be inlined there needs no English and keeps nothing.
  const EN = (e) => (ts.isStringLiteral(e) && e.text === "en") || (ts.isIdentifier(e) && e.text === "DEFAULT_LOCALE");
  const isLocaleRead = (e) => {
    e = unwrap(e);
    if (!ts.isPropertyAccessExpression(e) || e.name.text !== "locale" || !ts.isIdentifier(unwrap(e.expression))) return false;
    const d = resolve(unwrap(e.expression));
    return !!d && translators.has(d);
  };
  const localeTest = (c, op) => {
    c = unwrap(c);
    if (!ts.isBinaryExpression(c) || c.operatorToken.kind !== op) return false;
    return (isLocaleRead(c.left) && EN(unwrap(c.right))) || (isLocaleRead(c.right) && EN(unwrap(c.left)));
  };
  const isEn = (c) => localeTest(c, ts.SyntaxKind.EqualsEqualsEqualsToken) || localeTest(c, ts.SyntaxKind.EqualsEqualsToken);
  const isNotEn = (c) => localeTest(c, ts.SyntaxKind.ExclamationEqualsEqualsToken) || localeTest(c, ts.SyntaxKind.ExclamationEqualsToken);
  /** True ⇒ another language. */
  const nonEn = (c0) => {
    const c = unwrap(c0);
    if (isNotEn(c)) return true;
    if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return nonEn(c.left) || nonEn(c.right);
    if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken) return falseNonEn(c.operand);
    return false;
  };
  /** False ⇒ another language. */
  const falseNonEn = (c0) => {
    const c = unwrap(c0);
    if (isEn(c)) return true;
    if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.BarBarToken) return falseNonEn(c.left) || falseNonEn(c.right);
    if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken) return nonEn(c.operand);
    return false;
  };
  const exits = (st) => ts.isReturnStatement(st) || ts.isThrowStatement(st) || (ts.isBlock(st) && st.statements.length > 0 && exits(st.statements[st.statements.length - 1]));
  const otherLanguageOnly = (n) => {
    for (let child = n, p = n.parent; p; child = p, p = p.parent) {
      if (ts.isConditionalExpression(p)) {
        if (child === p.whenTrue && nonEn(p.condition)) return true;
        if (child === p.whenFalse && falseNonEn(p.condition)) return true;
      } else if (ts.isBinaryExpression(p) && child === p.right) {
        if (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && nonEn(p.left)) return true;
        if (p.operatorToken.kind === ts.SyntaxKind.BarBarToken && falseNonEn(p.left)) return true;
      } else if (ts.isIfStatement(p)) {
        if (child === p.thenStatement && nonEn(p.expression)) return true;
        if (child === p.elseStatement && falseNonEn(p.expression)) return true;
      } else if (ts.isBlock(p) || ts.isSourceFile(p)) {
        for (const st of p.statements) {
          if (st === child) break;
          if (ts.isIfStatement(st) && !st.elseStatement && exits(st.thenStatement) && falseNonEn(st.expression)) return true;
        }
      }
    }
    return false;
  };

  const visitOne = (n, tr) => {
    tr.uses = (tr.uses ?? 0) + 1;
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
    // `!t` (is there a translator?) reads nothing from it.
    const tested = ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken;
    if (readsLocale && opts.englishOnly && !p.questionDotToken) {
      // English-only: every translator's language is English, and a test of it is a constant (the minifier then
      // drops what only another language runs).
      const test = p.parent;
      const op = ts.isBinaryExpression(test) && (test.left === p || test.right === p) && EN(unwrap(test.left === p ? test.right : test.left)) ? test.operatorToken.kind : null;
      const K = ts.SyntaxKind;
      if (op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken) tr.edits.push([test.getStart(sf), test.getEnd(), "true"]);
      else if (op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken) tr.edits.push([test.getStart(sf), test.getEnd(), "false"]);
      else tr.edits.push([p.getStart(sf), p.getEnd(), '"en"']);
      tr.collapsed = (tr.collapsed ?? 0) + 1;
      return;
    }
    // English-only, an effect's dependency on the translator needs nothing of it.
    if (inDeps && opts.englishOnly) return void (tr.collapsed = (tr.collapsed ?? 0) + 1);
    if (readsLocale || inDeps || tested) return;
    if (localArg) return void (aliases.push([localArg, tr]), (tr.handoffs = (tr.handoffs ?? 0) + 1));
    const handed = argIndex >= 0 && importedSafe(p, argIndex, tr.ns);
    if (handed === "free") tr.handoffs = (tr.handoffs ?? 0) + 1;
    if (handed) return;
    const has = ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "has" && ts.isCallExpression(p.parent) && p.parent.expression === p;
    // Only another language's page gets here: its own messages answer, so no English rides along.
    if ((has || call) && otherLanguageOnly(n)) {
      // English-only, that code never runs: it needs nothing of the translator either.
      if (opts.englishOnly) tr.collapsed = (tr.collapsed ?? 0) + 1;
      return;
    }
    if (english === undefined) {
      tr.escapes = true;
      if (debug) console.log(`[i18n-inline] ${path.relative(process.cwd(), file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} keeps ${tr.ns.name}: ${(call ?? p).getText(sf).slice(0, 90)}`);
      return;
    }
    if (opts.englishOnly) {
      // An English-only build: every translator is English (catalog.english.ts), so `t("key", values)` is its English
      // and nothing else; the call becomes that English (no key, no lookup), `t.rich` likewise through the same
      // fragment the translator makes. Arguments stay where they are, so a translator call inside the values keeps
      // its own edits.
      const keyArg = call.arguments[0];
      const start = n.getStart(sf);
      const fn = rich ? H.R : H.T;
      const noValues = rich && call.arguments.length === 1 ? ", {}" : "";
      if (!rich && english.direct !== undefined && call.arguments.length === 1 && english.direct.startsWith('"')) tr.edits.push([start, call.getEnd(), english.direct]);
      else if (english.direct !== undefined) collapsed.add(fn), tr.edits.push([start, keyArg.getEnd(), `${fn}(${english.direct}${noValues}`]);
      else collapsed.add(fn), tr.edits.push([start, keyArg.getStart(sf), `${fn}(${english.map}[`], [keyArg.getEnd(), keyArg.getEnd(), `]${noValues}`]);
      tr.collapsed = (tr.collapsed ?? 0) + 1;
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
        (tr.kids ??= []).push(known);
        if (known.ns !== tr.ns) known.escapes = tr.escapes = true;
        else if (known !== tr && !known.parent && known.nsArg === null) known.parent = known.parent ?? null;
        continue;
      }
      const kid = { ns: tr.ns, nsArg: null, escapes: false, edits: [], parent: tr };
      (tr.kids ??= []).push(kid);
      translators.set(param, kid);
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
  // English-only: a translator is `free` when nothing reads it at run time: every use became its English or a
  // constant, or hands it to a helper (here or in another file) that is free in turn.
  const freeMemo = new Map();
  const free = (tr) => {
    if (!opts.englishOnly || tr.escapes) return false;
    if (freeMemo.has(tr)) return freeMemo.get(tr);
    freeMemo.set(tr, false);
    const ok = (tr.uses ?? 0) === (tr.collapsed ?? 0) + (tr.handoffs ?? 0) && (tr.kids ?? []).every(free);
    freeMemo.set(tr, ok);
    return ok;
  };
  for (const tr of translators.values()) if (tr.exportAs && !tr.escapes) result.safe.push([...tr.exportAs, free(tr) ? `${tr.ns.name}!` : tr.ns.name]);
  // A free `const t = useT(ns)` (or serverT) goes, and so does a free parameter's English default: 0 stands in
  // (a helper handed it reads nothing of it either).
  if (opts.englishOnly) {
    for (const [decl, tr] of translators) {
      if (!tr.nsArg || !free(tr)) continue;
      const init = decl.initializer;
      if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || !/^(useT|serverT|translator)$/.test(init.expression.text)) continue;
      if (!ts.isVariableDeclaration(decl) && !ts.isParameter(decl)) continue;
      tr.dropped = true;
      edits.push([init.getStart(sf), init.getEnd(), "0"]);
    }
  }
  const stubs = new Map();
  for (const tr of translators.values()) {
    if (tr.escapes || !tr.nsArg || tr.dropped) continue;
    const id = `__i18nNs_${tr.ns.name.replace(/[^a-z0-9]/g, "_")}`;
    stubs.set(id, tr.ns.name);
    edits.push([tr.nsArg.getStart(sf), tr.nsArg.getEnd(), id]);
  }
  if (!edits.length) return result;
  const lastImport = [...sf.statements].filter(ts.isImportDeclaration).pop();
  // Only the tables some kept edit names (a translator that escapes keeps its namespace and drops its edits).
  const kept = edits.map((e) => e[2]).join("\n");
  const tableCode = [...tables].filter(([, id]) => kept.includes(id)).map(([text, id]) => `const ${id}=${text};`).join("");
  const collapse =
    (collapsed.has(H.T) && kept.includes(`${H.T}(`) ? `const ${H.T}=(m,v)=>typeof m==="string"?m:String(m(v??{}));` : "") +
    (collapsed.has(H.R) && kept.includes(`${H.R}(`)
      ? `import { createElement as ${H.R}E, Fragment as ${H.R}F } from "react";const ${H.R}=(m,v)=>{const o=typeof m==="string"?m:m(v);return Array.isArray(o)?${H.R}E(${H.R}F,null,...o):o;};`
      : "");
  const head = `\n${helperCode(used, H)}${collapse}${[...stubs].map(([id, name]) => `const ${id}={name:${JSON.stringify(name)},en:{}};`).join("")}${tableCode}\n`;
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
function buildRegistry(src, compile, opts = {}) {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!/^(messages|i18n|data)$/.test(name) || dir !== src) walk(full);
      } else if (/\.tsx?$/.test(name)) {
        all.push([full, fs.readFileSync(full, "utf8")]);
      }
    }
  };
  const all = [];
  walk(src);
  // The translator types files export (`BoardT`): a file that imports one has translators too.
  const names = new Set();
  for (const [full, text] of all) if (text.includes("Translator<")) for (const n of exportedAliases(full).keys()) names.add(n);
  const typeRe = names.size ? new RegExp(`\\b(${[...names].join("|")})\\b`) : null;
  for (const [full, text] of all) if (text.includes("@/messages/") || (typeRe && typeRe.test(text))) files.push([full, text]);
  const registry = new Map();
  registry.typeRe = typeRe;
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const [file, text] of files) {
      const { safe } = analyze(file, text, compile, registry, src, undefined, opts);
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

/** English-only: `useLocale()` (i18n/locale-context, a plain function there) is "en"; the call becomes the constant. */
function englishLocale(file, source) {
  if (!source.includes("@/i18n/locale-context")) return source;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== "@/i18n/locale-context" || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    for (const el of st.importClause.namedBindings.elements) if ((el.propertyName ?? el.name).text === "useLocale") names.add(el.name.text);
  }
  if (!names.size) return source;
  const edits = [];
  const walk = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text) && !n.arguments.length) {
      const d = resolve(n.expression);
      if (d && ts.isImportSpecifier(d)) edits.push([n.getStart(sf), n.getEnd()]);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  let out = source;
  for (const [from, to] of edits.sort((a, b) => b[0] - a[0])) out = `${out.slice(0, from)}"en"${out.slice(to)}`;
  return out;
}

module.exports = function inlineLoader(source) {
  const done = this.async();
  const src = path.resolve(this.rootContext ?? process.cwd(), "src");
  getCompile()
    .then(async (compile) => {
      registryPromise ??= Promise.resolve().then(() => buildRegistry(src, compile, { englishOnly: !process.env.LIVE_LOCALES }));
      const registry = await registryPromise;
      if (!process.env.LIVE_LOCALES) source = englishLocale(this.resourcePath, source);
      if (!source.includes("@/messages/") && !source.includes("Translator<") && !(registry.typeRe && registry.typeRe.test(source))) return done(null, source);
      // LIVE_LOCALES empty: an English-only build (next.config swaps in catalog.english.ts), whose calls collapse to their English.
      done(null, analyze(this.resourcePath, source, compile, registry, src, (f) => this.addDependency(f), { englishOnly: !process.env.LIVE_LOCALES }).out);
    })
    .catch((e) => done(new Error(`${this.resourcePath}: ${e.message}`)));
};
module.exports.analyze = analyze;
module.exports.buildRegistry = buildRegistry;
module.exports.englishLocale = englishLocale;
