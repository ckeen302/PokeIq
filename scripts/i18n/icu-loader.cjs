// Webpack loader for src/messages/**/*.json: compiles every ICU message string to icu-minify's compact arrays at
// build time, so the browser needs only icu-minify's ~1 KB formatter (never an ICU parser). Plain text stays a plain
// string, so a namespace weighs what its English text did inline. The same transform runs in vitest
// (vitest.config.ts) through compileTree.
"use strict";

let compilePromise;
const getCompile = () => (compilePromise ??= import("icu-minify/compile").then((m) => m.default));

function compileTree(tree, compile, path = []) {
  if (typeof tree === "string") {
    try {
      return compile(tree);
    } catch (e) {
      throw new Error(`Bad ICU message at ${path.join(".")}: ${e.message}`);
    }
  }
  if (tree === null || typeof tree !== "object" || Array.isArray(tree)) throw new Error(`Messages must be strings or objects (at ${path.join(".")})`);
  return Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, compileTree(v, compile, [...path, k])]));
}

module.exports = function icuLoader(source) {
  const done = this.async();
  getCompile()
    .then((compile) => done(null, JSON.stringify(compileTree(JSON.parse(source), compile))))
    .catch((e) => done(new Error(`${this.resourcePath}: ${e.message}`)));
};
module.exports.compileTree = compileTree;
module.exports.getCompile = getCompile;
