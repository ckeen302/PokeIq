// Webpack loader for src/messages/**/*.json, run at build time so the browser never parses ICU:
// - English (src/messages/en): each message becomes a tiny JavaScript function (plain text stays a string), so
//   English pages need no message formatter at all and weigh what their inline text did.
// - Other languages: each message becomes icu-minify's compact arrays, read by its ~1 KB formatter. Those files only
//   travel to the browser inside a page in that language (src/i18n/ClientMessages.tsx).
// vitest runs compileTree (arrays) for every file; tests/i18n-messages.test.ts checks that every English function
// formats exactly as icu-minify does.
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

// icu-minify's compiled node types (icu-minify/dist/.../types): # and the typed arguments.
const POUND = 0, SELECT = 1, PLURAL = 2, ORDINAL = 3, NUMBER = 4, DATE = 5, TIME = 6;

/**
 * JavaScript for one compiled English message: `(v)=>…`, `v` being the values. Without <tags> it gives a string;
 * with them, a flat array of parts (each tag is the function of that name in `v`, called with its own flat parts),
 * exactly as icu-minify's formatter would. Helpers in scope: N (a number as en-US writes it), O (the en-US ordinal
 * category), F (the date format), M and A (merged parts).
 */
function codegen(nodes, path, used = new Set(), H = HELPERS) {
  const parts = findTags(nodes);
  const value = (name) => `v[${JSON.stringify(name)}]`;
  // Several nodes: joined with + (string mode) or as array elements (parts mode).
  const join = (ns, pound) => ns.map((n) => node(n, pound)).join(parts ? "," : "+") || '""';
  // A branch of a choice: a string expression, or (parts mode) an array of parts.
  const branch = (b, pound) => {
    const ns = typeof b === "string" || b === POUND ? [b] : b;
    return parts ? `[${join(ns, pound)}]` : `(${join(ns, pound)})`;
  };
  // A choice between branches: an expression, spread in parts mode so the parts stay flat.
  const choice = (cases, other, pound) => {
    const expr = `(${cases.map(([cond, b]) => `${cond}?${branch(b, pound)}:`).join("")}${branch(other, pound)})`;
    return parts ? `...${expr}` : expr;
  };
  function node(n, pound) {
    if (typeof n === "string") return JSON.stringify(n);
    if (n === POUND) {
      if (!pound) throw new Error(`# outside a plural at ${path}`);
      used.add("N");
      return `${H.N}(${pound})`;
    }
    const [name, type, ...rest] = n;
    if (type === undefined) return `String(${value(name)})`;
    // A tag: its children are the rest of the node.
    if (typeof type !== "number" || type === POUND) {
      used.add("M");
      return `${value(name)}(${H.A}(${H.M}([${[type, ...rest].map((c) => node(c, pound)).join(",")}])))`;
    }
    const v = value(name);
    if (type === SELECT) {
      const opts = rest[0];
      const cases = Object.keys(opts).filter((k) => k !== "other").map((k) => [`String(${v})===${JSON.stringify(k)}`, opts[k]]);
      return choice(cases, opts.other, pound);
    }
    if (type === PLURAL || type === ORDINAL) {
      const opts = rest[0];
      const exact = Object.keys(opts).filter((k) => k.startsWith("=")).map((k) => [`${v}===${Number(k.slice(1))}`, opts[k]]);
      const cats = Object.keys(opts).filter((k) => !k.startsWith("=") && k !== "other");
      // English cardinals: "one" is exactly 1 and every other number is "other"; ordinals ask Intl.
      const named = type === PLURAL ? (cats.includes("one") ? [[`${v}===1`, opts.one]] : []) : cats.map((k) => (used.add("O"), [`${H.O}(${v})===${JSON.stringify(k)}`, opts[k]]));
      return choice([...exact, ...named], opts.other, v);
    }
    // Named styles need formats the site doesn't define (src/i18n/catalog.ts), as icu-minify itself would refuse.
    if (rest[0] !== undefined) throw new Error(`Unsupported style "${rest[0]}" at ${path}: format the value before passing it`);
    if (type === NUMBER) return used.add("N"), `${H.N}(${v})`;
    if (type === DATE || type === TIME) return used.add("F"), `${H.F}({timeZone:"UTC"}).format(${v})`;
    throw new Error(`Unknown compiled node at ${path}: ${JSON.stringify(n)}`);
  }
  if (parts) used.add("M");
  return parts ? `(v)=>${H.M}([${join(nodes, undefined)}])` : `(v)=>${join(nodes, undefined)}`;
}

/** Whether a compiled message has a <tag> anywhere (then it formats to parts, not a string). */
function findTags(nodes) {
  for (const n of nodes) {
    if (!Array.isArray(n)) continue;
    const [, type, ...rest] = n;
    if (type === undefined) continue;
    if (typeof type !== "number" || type === POUND) return true;
    if ((type === SELECT || type === PLURAL || type === ORDINAL) && Object.values(rest[0]).some((b) => Array.isArray(b) && findTags(b))) return true;
  }
  return false;
}

/** The names the generated code calls its helpers by (the inline loader gives them its own). */
const HELPERS = { N: "N", O: "O", F: "F", M: "M", A: "A" };

/** The helpers' definitions, for the ones a module's messages use. */
function helperCode(used, H = HELPERS) {
  const head = [];
  if (used.has("N")) head.push(`const ${H.N}=(n)=>n.toLocaleString("en-US");`);
  if (used.has("O")) head.push(`let ${H.O}_;const ${H.O}=(n)=>(${H.O}_??=new Intl.PluralRules("en-US",{type:"ordinal"})).select(n);`);
  if (used.has("F")) head.push(`let ${H.F}_;const ${H.F}=(x)=>(${H.F}_??=new Intl.DateTimeFormat("en-US",x));`);
  // Parts, merged exactly as icu-minify's formatter does: adjacent strings joined, empty strings dropped, a lone part
  // on its own (M); a tag's children always as an array (A).
  if (used.has("M")) head.push(`const ${H.M}=(a)=>{if(!a.length)return"";const r=[];let s="";for(const x of a)typeof x==="string"?(s+=x):(s&&(r.push(s),(s="")),r.push(x));if(s)r.push(s);return r.length===1?r[0]:r};const ${H.A}=(x)=>(Array.isArray(x)?x:[x]);`);
  return head.join("");
}

/** One English message as JavaScript: a string literal, or a function of the values. */
function englishMessage(text, compile, path, used, H) {
  const c = compile(text);
  return typeof c === "string" ? JSON.stringify(c) : codegen(c, path, used, H);
}

/** An English messages file as a JavaScript module: plain text as strings, every other message as a function. */
function englishModule(tree, compile) {
  const used = new Set();
  const emit = (t, path) => {
    if (typeof t === "string") return englishMessage(t, compile, path.join("."), used);
    if (t === null || typeof t !== "object" || Array.isArray(t)) throw new Error(`Messages must be strings or objects (at ${path.join(".")})`);
    return `{${Object.entries(t).map(([k, v]) => `${JSON.stringify(k)}:${emit(v, [...path, k])}`).join(",")}}`;
  };
  const body = emit(tree, []);
  return `${helperCode(used)}export default ${body};`;
}

const ENGLISH = /[\\/]src[\\/]messages[\\/]en[\\/][^\\/]+\.json$/;

module.exports = function icuLoader(source) {
  const done = this.async();
  getCompile()
    .then((compile) => {
      const tree = JSON.parse(source);
      done(null, ENGLISH.test(this.resourcePath) ? englishModule(tree, compile) : JSON.stringify(compileTree(tree, compile)));
    })
    .catch((e) => done(new Error(`${this.resourcePath}: ${e.message}`)));
};
module.exports.compileTree = compileTree;
module.exports.getCompile = getCompile;
module.exports.englishModule = englishModule;
module.exports.codegen = codegen;
module.exports.englishMessage = englishMessage;
module.exports.helperCode = helperCode;
