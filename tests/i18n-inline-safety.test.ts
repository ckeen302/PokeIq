// The English inliner (scripts/i18n/inline-loader.cjs) gives a translator a stub of its namespace (its name only)
// when every use of it carries its English. If one use didn't, a page would throw "Missing message" at that key
// (the English isn't there any more). This runs the loader over all of src as a build with languages live does and
// checks its output on its own terms, independently of the loader's bookkeeping: every translator made from a stub,
// and every parameter it is handed to (in this file or another), may only be called with the English the loader
// added, read for its locale, tested, listed as an effect's dependency, or used where only another language's page
// gets (behind a locale test).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const loader = require("../scripts/i18n/inline-loader.cjs");
const { getCompile } = require("../scripts/i18n/icu-loader.cjs");

const SRC = path.resolve(__dirname, "../src");
const MAKERS = /^(useT|serverT|getT|translator)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (!(dir === SRC && /^(messages|i18n)$/.test(name))) sourceFiles(full, out);
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function moduleFile(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** Names a node declares in its own scope (as the loader's own resolution, kept separate on purpose). */
function declared(node: ts.Node): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const bind = (name: ts.BindingName, decl: ts.Node) => {
    if (ts.isIdentifier(name)) out.set(name.text, decl);
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bind(el.name, ts.isIdentifier(el.name) ? el : decl);
  };
  if (ts.isFunctionLike(node)) for (const p of node.parameters) bind(p.name, p);
  const stmts = ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node) ? node.statements : null;
  for (const st of stmts ?? []) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) bind(d.name, d);
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.set(st.name.text, st);
    else if (ts.isImportDeclaration(st) && st.importClause) {
      if (st.importClause.name) out.set(st.importClause.name.text, st);
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) out.set(el.name.text, el);
    }
  }
  if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer))
    for (const d of node.initializer.declarations) bind(d.name, d);
  if (ts.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name, node.variableDeclaration);
  return out;
}
const resolve = (id: ts.Identifier): ts.Node | null => {
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    const d = declared(n).get(id.text);
    if (d) return d;
  }
  return null;
};
/** An identifier that names a value (not a property, a key, a JSX attribute's name or a type). */
const reference = (n: ts.Identifier) => {
  const p = n.parent;
  if ((ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isJsxAttribute(p) || ts.isMethodDeclaration(p)) && p.name === n)) return false;
  if (ts.isBindingElement(p) && p.propertyName === n) return false;
  if (ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isQualifiedName(p)) return false;
  if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === n && /^[a-z]/.test(n.text)) return false;
  return true;
};
const fnOf = (d: ts.Node | null | undefined) =>
  !d ? null : ts.isFunctionDeclaration(d) ? d : ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? d.initializer : null;

/** Behind a test of the page's language: code only another language's page runs (it reads that language's messages). */
function behindLocaleTest(n: ts.Node, sf: ts.SourceFile): boolean {
  const test = (e: ts.Node) => /\.locale\s*[!=]==?|[!=]==?\s*\w+\.locale|DEFAULT_LOCALE/.test(e.getText(sf));
  for (let child: ts.Node = n, p = n.parent; p; child = p, p = p.parent) {
    if (ts.isConditionalExpression(p) && child !== p.condition && test(p.condition)) return true;
    if (ts.isBinaryExpression(p) && child === p.right && test(p.left)) return true;
    if (ts.isIfStatement(p) && child !== p.expression && test(p.expression)) return true;
    if (ts.isBlock(p) || ts.isSourceFile(p))
      for (const st of p.statements) {
        if (st === child) break;
        if (ts.isIfStatement(st) && test(st.expression)) return true;
      }
  }
  return false;
}

describe("the English inliner", () => {
  it("leaves no stubbed translator a use without its English", async () => {
    const compile = await getCompile();
    const log = console.log;
    console.log = () => {};
    const registry = loader.buildRegistry(SRC, compile);
    console.log = log;
    const outputs = new Map<string, ts.SourceFile>();
    const output = (file: string) => {
      if (!outputs.has(file)) {
        const text = fs.readFileSync(file, "utf8");
        const out = loader.analyze(file, text, compile, registry, SRC, undefined, {}).out;
        outputs.set(file, ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
      }
      return outputs.get(file)!;
    };
    const problems: string[] = [];
    const checked = new Set<ts.Node>();

    /** Every reference to the translator declared by `decl` (a variable, a parameter or a destructured prop). */
    function check(decl: ts.Node, sf: ts.SourceFile, why: string) {
      if (checked.has(decl)) return;
      checked.add(decl);
      const name = (decl as ts.VariableDeclaration).name;
      if (!name || !ts.isIdentifier(name)) return void problems.push(`${why}: not a plain name`);
      const walk = (n: ts.Node) => {
        if (ts.isIdentifier(n) && n.text === name.text && n !== name && reference(n) && resolve(n) === decl) visitUse(n, sf, why);
        ts.forEachChild(n, walk);
      };
      walk(sf);
    }

    function handOver(fnDecl: ts.Node | null, index: number, sf: ts.SourceFile, why: string): boolean {
      const fn = fnOf(fnDecl);
      const param = fn?.parameters[index];
      if (!param) return false;
      if (ts.isIdentifier(param.name)) return check(param, sf, why), true;
      return false;
    }
    function importedFn(spec: ts.ImportSpecifier, from: string): [ts.Node, ts.SourceFile] | null {
      const target = moduleFile((spec.parent.parent.parent as ts.ImportDeclaration).moduleSpecifier.getText().slice(1, -1), from);
      if (!target) return null;
      const name = (spec.propertyName ?? spec.name).text;
      const seen = new Set<string>();
      const find = (file: string): [ts.Node, ts.SourceFile] | null => {
        if (seen.has(file)) return null;
        seen.add(file);
        const sf = output(file);
        for (const st of sf.statements) {
          if (ts.isFunctionDeclaration(st) && st.name?.text === name) return [st, sf];
          if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return [d, sf];
          if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
            const next = moduleFile(st.moduleSpecifier.getText().slice(1, -1), file);
            const names = st.exportClause && ts.isNamedExports(st.exportClause) ? st.exportClause.elements.map((e) => (e.propertyName ?? e.name).text) : null;
            if (next && (!names || names.includes(name))) {
              const r = find(next);
              if (r) return r;
            }
          }
        }
        return null;
      };
      return find(target);
    }

    function visitUse(n: ts.Identifier, sf: ts.SourceFile, why: string) {
      const p = n.parent;
      const where = `${path.relative(SRC, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} (${why})`;
      if (ts.isCallExpression(p) && p.expression === n) {
        if (p.arguments.length >= 3 || behindLocaleTest(n, sf)) return;
        return void problems.push(`${where}: ${p.getText(sf).slice(0, 80)} has no English`);
      }
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        if (p.name.text === "locale") return;
        if (p.name.text === "rich" && ts.isCallExpression(p.parent) && (p.parent.arguments.length >= 3 || behindLocaleTest(n, sf))) return;
        if (p.name.text === "has" && behindLocaleTest(n, sf)) return;
        return void problems.push(`${where}: ${p.parent.getText(sf).slice(0, 80)}`);
      }
      if (ts.isPrefixUnaryExpression(p)) return;
      if (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && /^use(Effect|LayoutEffect|Memo|Callback)$/.test(p.parent.expression.getText(sf))) return;
      if (ts.isCallExpression(p) && p.arguments.includes(n)) {
        const index = p.arguments.indexOf(n);
        const callee = p.expression;
        if (ts.isIdentifier(callee)) {
          const d = resolve(callee);
          if (d && ts.isImportSpecifier(d)) {
            const r = importedFn(d, sf.fileName);
            if (r && handOver(r[0], index, r[1], `${why} → ${callee.text}`)) return;
          } else if (handOver(d, index, sf, `${why} → ${callee.text}`)) return;
        }
        return void problems.push(`${where}: handed to ${p.getText(sf).slice(0, 80)}, which can't be followed`);
      }
      if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) {
        const el = p.parent.parent.parent;
        if ((ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el)) && ts.isIdentifier(el.tagName)) {
          const d = resolve(el.tagName);
          const target = d && ts.isImportSpecifier(d) ? importedFn(d, sf.fileName) : d ? [d, sf] as [ts.Node, ts.SourceFile] : null;
          const first = target && fnOf(target[0])?.parameters[0];
          const prop = p.parent.name.getText(sf);
          const binding = first && ts.isObjectBindingPattern(first.name) ? first.name.elements.find((b) => (b.propertyName ?? b.name).getText(target![1]) === prop) : undefined;
          if (binding && ts.isIdentifier(binding.name)) return void check(binding, target![1], `${why} → <${el.tagName.text} ${prop}>`);
        }
        return void problems.push(`${where}: passed as a prop that can't be followed`);
      }
      problems.push(`${where}: ${p.getText(sf).slice(0, 80)}`);
    }

    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("@/messages/")) continue;
      const sf = output(file);
      if (!sf.text.includes("__i18nNs_")) continue;
      const visit = (n: ts.Node) => {
        const init = ts.isVariableDeclaration(n) || ts.isParameter(n) ? n.initializer : undefined;
        const call = init && (ts.isAwaitExpression(init) ? init.expression : init);
        if (call && ts.isCallExpression(call) && MAKERS.test(call.expression.getText(sf)) && call.arguments[0] && /^__i18nNs_/.test(call.arguments[0].getText(sf)))
          check(n, sf, `${path.relative(SRC, file)}: ${(n as ts.VariableDeclaration).name.getText(sf)}`);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
