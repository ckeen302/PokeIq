/**
 * Hunt v2's audit of the answer table: every spot against what Bulbapedia and Serebii list, and
 * what the v2 rules (only normal wild encounters, scripts/hunt/rules.ts) changed.
 *
 *   npx tsx scripts/hunt/verify-v2.ts [previous answers.json] [--out src/data/hunt/verification/v2-audit.json]
 *
 * For each entry, place and game: "both" when Bulbapedia and Serebii both list that map place for
 * that form in that game (scripts/hunt/evidence/agreed.json, built blind from the two sources by
 * make-agreed.ts), "one" when one of them does, "unchecked" when the sources don't both have a list
 * for that game, and an error when they do and neither lists it. Every place's method must be one the
 * rules count. Given the table before v2, it also lists what the rules took out and why.
 */
import fs from "node:fs";
import path from "node:path";
import answers from "../../src/data/hunt/answers.json";
import type { HuntAnswerFile, HuntEntry } from "../../src/lib/hunt/types";
import { COUNTED_LABELS } from "./rules";

type Agreed = Record<string, Record<string, Record<string, { both: [string, string | null][]; any: string[] }>>>;

export interface AuditResult {
  entries: number;
  pairs: { both: number; one: number; unchecked: number; errors: number };
  methods: Record<string, number>;
  badMethods: string[];
  errors: { id: string; version: string; place: string }[];
  changes?: { before: number; after: number; removed: { id: string; name: string; why: string }[]; added: string[]; methodsBefore: Record<string, number> };
}

export function audit(table: HuntEntry[], agreed: Agreed, before?: HuntEntry[], legendary: Set<number> = new Set()): AuditResult {
  const out: AuditResult = { entries: table.length, pairs: { both: 0, one: 0, unchecked: 0, errors: 0 }, methods: {}, badMethods: [], errors: [] };
  const counted = new Set<string>(COUNTED_LABELS);
  for (const e of table)
    for (const p of e.places)
      for (const m of p.methods) {
        out.methods[m.method] = (out.methods[m.method] ?? 0) + 1;
        if (!counted.has(m.method)) out.badMethods.push(`${e.id} ${p.name} ${m.method}`);
        for (const v of m.versions) {
          const g = agreed[String(e.dex)]?.[e.form ?? ""]?.[v];
          const key = `${p.geoRegion}|${p.name}`;
          if (!g) out.pairs.unchecked++;
          else if (g.both.some(([k]) => k === key)) out.pairs.both++;
          else if (g.any.includes(key)) out.pairs.one++;
          else {
            out.pairs.errors++;
            out.errors.push({ id: e.id, version: v, place: p.name });
          }
        }
      }
  if (before) {
    const now = new Map(table.map((e) => [e.id, e]));
    const removed = before
      .filter((e) => !now.has(e.id))
      .map((e) => {
        const methods = new Set(e.places.flatMap((p) => p.methods.map((m) => m.method)));
        const left = [...methods].filter((m) => counted.has(m) && m !== "Wild");
        return { id: e.id, name: e.name, why: legendary.has(e.dex) ? "legendary or mythical" : left.length ? `its only spots were special ones (rustling grass, bridge shadows) under a normal label (${[...methods].join(", ")})` : `only met by ${[...methods].join(", ")}` };
      });
    const methodsBefore: Record<string, number> = {};
    for (const e of before) for (const p of e.places) for (const m of p.methods) methodsBefore[m.method] = (methodsBefore[m.method] ?? 0) + 1;
    out.changes = { before: before.length, after: table.length, removed, added: table.filter((e) => !before.some((b) => b.id === e.id)).map((e) => e.id), methodsBefore };
  }
  return out;
}

if (process.argv[1]?.endsWith("verify-v2.ts")) {
  const args = process.argv.slice(2);
  const oi = args.indexOf("--out");
  const outFile = oi >= 0 ? args.splice(oi, 2)[1] : undefined;
  const before = args[0] ? (JSON.parse(fs.readFileSync(args[0], "utf8")) as HuntAnswerFile).entries : undefined;
  const agreed = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/hunt/evidence/agreed.json"), "utf8")) as { agreed: Agreed }).agreed;
  const dex = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/data/pokedex.json"), "utf8")) as { id: number; legendary: boolean; mythical: boolean }[];
  const r = audit((answers as unknown as HuntAnswerFile).entries, agreed, before, new Set(dex.filter((p) => p.legendary || p.mythical).map((p) => p.id)));
  const summary = { ...r, changes: r.changes && { ...r.changes, removed: r.changes.removed.length, added: r.changes.added.length } };
  console.log(JSON.stringify(summary, null, 1));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(r, null, 1) + "\n");
}
