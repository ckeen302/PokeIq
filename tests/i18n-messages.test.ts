import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import format from "icu-minify/format";

// The build compiles English messages to small functions (scripts/i18n/icu-loader.cjs); other languages, and every
// language in these tests, are read by icu-minify's formatter. Both must give exactly the same text and parts.
const loader = createRequire(import.meta.url)("../scripts/i18n/icu-loader.cjs");
const DIR = "src/messages/en";

const OPTIONS = {
  formatters: {
    getNumberFormat: (l: string, o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(l, o),
    getDateTimeFormat: (l: string, o?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(l, o),
    getPluralRules: (l: string, o?: Intl.PluralRulesOptions) => new Intl.PluralRules(l, o),
  },
  timeZone: "UTC",
};

type Node = unknown;
/** Every argument a compiled message reads, with the kind of value it needs. */
function args(nodes: Node[], out = new Map<string, string>()): Map<string, string> {
  for (const n of nodes) {
    if (!Array.isArray(n)) continue;
    const [name, type, ...rest] = n as [string, unknown, ...unknown[]];
    if (type === undefined) out.set(name, out.get(name) ?? "string");
    else if (typeof type !== "number" || type === 0) {
      out.set(name, "tag");
      args([type, ...rest], out);
    } else if (type === 1) {
      out.set(name, "select:" + Object.keys(rest[0] as object).join("|"));
      for (const b of Object.values(rest[0] as object)) if (Array.isArray(b)) args(b, out);
    } else if (type === 2 || type === 3) {
      out.set(name, "number");
      for (const b of Object.values(rest[0] as object)) if (Array.isArray(b)) args(b, out);
    } else if (type === 4) out.set(name, "number");
    else out.set(name, "date");
  }
  return out;
}

/** The value sets to try: every select branch, and numbers around each plural category. */
function samples(spec: Map<string, string>): Record<string, unknown>[] {
  let sets: Record<string, unknown>[] = [{}];
  for (const [name, kind] of spec) {
    const options: unknown[] =
      kind === "string" ? ["Ash"] : kind === "number" ? [0, 1, 2, 3, 11, 21, 1234.5] : kind === "date" ? [new Date(Date.UTC(2026, 10, 21))] : kind === "tag" ? [(c: unknown[]) => ({ tag: name, c })] : kind.slice(7).split("|");
    sets = sets.flatMap((s) => options.map((o) => ({ ...s, [name]: o })));
    if (sets.length > 400) sets = sets.slice(0, 400);
  }
  return sets;
}

describe("English messages compiled to functions", async () => {
  const compile = await loader.getCompile();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    it(`${file} formats as icu-minify does`, () => {
      const tree = JSON.parse(readFileSync(join(DIR, file), "utf8"));
      const code: string = loader.englishModule(tree, compile);
      const mod = new Function(code.replace("export default ", "return "))();
      const walk = (t: unknown, fn: unknown, path: string) => {
        if (typeof t === "string") {
          const compiled = compile(t);
          if (typeof compiled === "string") return expect(fn, path).toBe(compiled);
          for (const values of samples(args(compiled))) {
            expect((fn as (v: unknown) => unknown)(values), `${path} ${JSON.stringify(values)}`).toEqual(format(compiled, "en-US", values as never, OPTIONS as never));
          }
          return;
        }
        for (const [k, v] of Object.entries(t as object)) walk(v, (fn as Record<string, unknown>)[k], `${path}.${k}`);
      };
      walk(tree, mod, file);
    });
  }

  it("covers plurals, selects, ordinals, tags and dates", () => {
    const tree = {
      a: "Solved · {n, plural, =0 {none} one {# mistake} other {# mistakes}}",
      b: "(<page></page>){bug, select, true {, x.} other { y.}}",
      c: "<b>{n, plural, one {# <i>win</i>} other {# wins}}</b> on {d, date}",
      d: "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
    };
    const mod = new Function(loader.englishModule(tree, compile).replace("export default ", "return "))();
    for (const [k, msg] of Object.entries(tree)) {
      const compiled = compile(msg);
      for (const values of samples(args(compiled))) expect(mod[k](values)).toEqual(format(compiled, "en-US", values as never, OPTIONS as never));
    }
  });
});
