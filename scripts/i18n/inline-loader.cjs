// Webpack loader (before SWC) for src/**/*.{ts,tsx}: every `t("key")` whose translator comes from a namespace
// (`const t = useT(ns)` / `serverT(ns)` / `await getT(ns)` / `translator(ns, …)`) gets the key's English text as an
// extra last argument, compiled as scripts/i18n/icu-loader.cjs compiles it. The translator uses the page's language
// first and that English otherwise (src/i18n/catalog.ts), so a component carries exactly the English it shows, as its
// inline text did before languages existed, instead of its whole namespace. When every use of a translator is such a
// call, it is given a stub of the namespace (its name only) and the namespace's English leaves the bundle.
// Keys built from a template (`t(\`links.${id}\`)`) get the matching messages as a small object, looked up the same way.
// Anything else (a translator passed to a helper, t.has, t.locale) keeps the whole namespace: correct, just not trimmed.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { englishMessage, helperCode, getCompile } = require("./icu-loader.cjs");

const MAKERS = new Set(["useT", "serverT", "getT", "translator"]);
const H = { N: "__i18nN", O: "__i18nO", F: "__i18nF", M: "__i18nM", A: "__i18nA" };

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
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const el of name.elements) if (!ts.isOmittedExpression(el)) addBinding(el.name, decl);
  };
  if (ts.isFunctionLike(node)) for (const p of node.parameters) addBinding(p.name, p);
  const statements = ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) ? node.statements : ts.isCaseClause(node) || ts.isDefaultClause(node) ? node.statements : null;
  if (statements) {
    for (const st of statements) {
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) addBinding(d.name, d);
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.set(st.name.text, st);
      else if (ts.isImportDeclaration(st) && st.importClause) {
        if (st.importClause.name) out.set(st.importClause.name.text, st);
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) out.set(el.name.text, st);
        if (nb && ts.isNamespaceImport(nb)) out.set(nb.name.text, st);
      }
    }
  }
  if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer))
    for (const d of node.initializer.declarations) addBinding(d.name, d);
  if (ts.isCatchClause(node) && node.variableDeclaration) addBinding(node.variableDeclaration.name, node.variableDeclaration);
  return out;
}

/** The declaration an identifier refers to, by walking out through the scopes around it. */
function resolve(id) {
  for (let n = id.parent; n; n = n.parent) {
    const d = declaredHere(n).get(id.text);
    if (d) return d;
  }
  return null;
}

module.exports = function inlineLoader(source) {
  const done = this.async();
  if (!source.includes("@/messages/")) return done(null, source);
  getCompile()
    .then((compile) => {
      const file = this.resourcePath;
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const root = path.resolve(this.rootContext ?? process.cwd(), "src/messages");
      // Namespace imports: `import nav from "@/messages/nav"`.
      const namespaces = new Map(); // local name -> { name, tree }
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !st.importClause?.name) continue;
        const m = /^@\/messages\/([a-z0-9-]+)$/.exec(st.moduleSpecifier.text);
        if (!m) continue;
        const json = path.join(root, "en", `${m[1]}.json`);
        if (!fs.existsSync(json)) continue;
        this.addDependency(json);
        namespaces.set(st.importClause.name.text, { name: m[1], tree: JSON.parse(fs.readFileSync(json, "utf8")) });
      }
      if (!namespaces.size) return done(null, source);

      // Translators: `const t = useT(ns)` and the like.
      const translators = new Map(); // declaration node -> { ns, nsArg, escapes, calls }
      const visitDecls = (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
          let init = n.initializer;
          if (ts.isAwaitExpression(init)) init = init.expression;
          if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && MAKERS.has(init.expression.text) && init.arguments[0] && ts.isIdentifier(init.arguments[0]) && namespaces.has(init.arguments[0].text)) {
            translators.set(n, { ns: namespaces.get(init.arguments[0].text), nsArg: init.arguments[0], escapes: false, edits: [] });
          }
        }
        ts.forEachChild(n, visitDecls);
      };
      visitDecls(sf);
      if (!translators.size) return done(null, source);

      const used = new Set();
      const en = (ns, key, p) => {
        const text = leaf(ns.tree, key);
        return text === undefined ? undefined : englishMessage(text, compile, `${ns.name}.${key}`, used, H);
      };
      // The English for a call's key: a string key's message, or a template key's matching messages as an object.
      const englishFor = (ns, keyNode) => {
        if (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)) return en(ns, keyNode.text);
        if (ts.isTemplateExpression(keyNode) && keyNode.templateSpans.length === 1) {
          const prefix = keyNode.head.text;
          const span = keyNode.templateSpans[0];
          const suffix = span.literal.text;
          const expr = span.expression;
          // Only a plain name or property read: it is read again for the lookup.
          const simple = (e) => ts.isIdentifier(e) || (ts.isPropertyAccessExpression(e) && simple(e.expression));
          if (!simple(expr)) return undefined;
          const entries = [];
          for (const [key] of leaves(ns.tree)) {
            if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < prefix.length + suffix.length + 1) continue;
            const mid = key.slice(prefix.length, key.length - suffix.length);
            if (mid.includes(".")) continue;
            entries.push(`${JSON.stringify(mid)}:${en(ns, key)}`);
          }
          if (!entries.length) return undefined;
          return `({${entries.join(",")}})[${expr.getText(sf)}]`;
        }
        return undefined;
      };

      const edits = [];
      const visitUses = (n) => {
        if (ts.isIdentifier(n) && !(n.parent && ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
          // A reference to a translator?
          const isPropName = n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n;
          const isKey = n.parent && (ts.isPropertyAssignment(n.parent) || ts.isPropertySignature(n.parent)) && n.parent.name === n;
          if (!isPropName && !isKey) {
            const decl = resolve(n);
            const tr = decl && translators.get(decl);
            if (tr) {
              const p = n.parent;
              let call = null;
              let rich = false;
              if (ts.isCallExpression(p) && p.expression === n) call = p;
              else if (ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "rich" && ts.isCallExpression(p.parent) && p.parent.expression === p) (call = p.parent), (rich = true);
              const english = call && call.arguments.length >= 1 && call.arguments.length <= 2 && !call.arguments.some(ts.isSpreadElement) ? englishFor(tr.ns, call.arguments[0]) : undefined;
              const readsLocale = ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "locale";
              if (readsLocale) {
                // t.locale needs no English.
              } else if (english === undefined) tr.escapes = true;
              else {
                const at = call.arguments[call.arguments.length - 1].getEnd();
                const extra = call.arguments.length === 1 ? (rich ? `, {}, ${english}` : `, undefined, ${english}`) : `, ${english}`;
                edits.push([at, at, extra]);
              }
            }
          }
        }
        ts.forEachChild(n, visitUses);
      };
      visitUses(sf);

      // Translators used only through inlined calls get a stub namespace (name only): its English isn't needed.
      const stubs = new Map();
      for (const tr of translators.values()) {
        if (tr.escapes) continue;
        const id = `__i18nNs_${tr.ns.name.replace(/[^a-z0-9]/g, "_")}`;
        stubs.set(id, tr.ns.name);
        edits.push([tr.nsArg.getStart(sf), tr.nsArg.getEnd(), id]);
      }
      if (!edits.length) return done(null, source);

      // Helpers and stubs go after the imports ("use client" stays first).
      const lastImport = [...sf.statements].filter(ts.isImportDeclaration).pop();
      const head = `\n${helperCode(used, H)}${[...stubs].map(([id, name]) => `const ${id}={name:${JSON.stringify(name)},en:{}};`).join("")}\n`;
      const at = lastImport ? lastImport.getEnd() : 0;
      if (head.trim()) edits.push([at, at, head]);

      edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
      let out = source;
      for (const [from, to, text] of edits) out = out.slice(0, from) + text + out.slice(to);
      done(null, out);
    })
    .catch((e) => done(new Error(`${this.resourcePath}: ${e.message}`)));
};
