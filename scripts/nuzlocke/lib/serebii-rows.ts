/**
 * Serebii rows (scripts/dex parsers' RawRow) -> Rows: kind, method label, rate, levels and condition in the same
 * vocabulary as PokéAPI's rows.
 */
import type { EncounterKind } from "../../../src/lib/nuzlocke/model";
import { accent } from "./areas";
import type { Row } from "./rows";
import { parseLevels, parseRate } from "./rows";
import type { SerebiiRow } from "./serebii";

const KIND: [RegExp, EncounterKind][] = [
  [/^(Static|Special encounter|Interact|Hidden Grotto)$/i, "static"],
  [/^Roaming/i, "roaming"],
  [/^Gift \(Egg\)$/i, "egg"],
  [/^Gift$/i, "gift"],
  [/^Trade$/i, "trade"],
];

/** Serebii (locMethod) label -> our label: walking terrain is left to the Bulbapedia step, like PokéAPI's. */
function label(m: string): string {
  if (/^(Grass|Cave)$/.test(m)) return "Walking";
  if (m === "Fishing") return "Fishing";
  return accent(m);
}

const TIME_NAMES = ["Morning", "Day", "Night"];

export function serebiiToRows(rs: SerebiiRow[]): Row[] {
  const out: Row[] = [];
  for (const r of rs) {
    if (!r.loc || !r.m) continue;
    // "Kanto - Roaming After Nat. Dex & If Bulbasaur Chosen": a roaming Pokémon, whatever the method cell says.
    const roaming = /roaming/i.test(`${r.loc} ${r.sub ?? ""}`);
    const kind = roaming ? "roaming" : (KIND.find(([re]) => re.test(r.m!))?.[1] ?? "wild");
    const base: Row = { src: "serebii", ver: r.ver, place: accent(r.loc), ...(r.sub ? { sub: r.sub } : {}), species: r.species, kind, method: roaming ? "Roaming" : label(r.m), url: r.url };
    const lv = parseLevels(r.lv);
    if (lv && kind !== "trade") base.levels = lv;
    const notes = r.n ? [r.n] : [];
    if (r.t) {
      // Morning / Day / Night rates: one row per distinct rate.
      const by = new Map<string, number[]>();
      r.t.forEach((v, i) => {
        if (v !== "—") by.set(v, [...(by.get(v) ?? []), i]);
      });
      for (const [v, idx] of by) {
        const rate = parseRate(v);
        const cond = [idx.length === 3 ? "" : idx.map((i) => TIME_NAMES[i]).join(", "), ...notes].filter(Boolean).join("; ");
        out.push({ ...base, ...(rate !== undefined && kind === "wild" ? { rate } : {}), ...(cond ? { cond } : {}) });
      }
      continue;
    }
    const rate = parseRate(r.r);
    const cond = notes.join("; ");
    out.push({ ...base, ...(rate !== undefined && kind === "wild" ? { rate } : {}), ...(cond ? { cond } : {}) });
  }
  return out;
}
