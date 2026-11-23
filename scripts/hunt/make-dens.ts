/**
 * Galar's Max Raid dens, agreed by two sources.
 *
 *   npx tsx scripts/hunt/make-dens.ts <bulbapedia parsed.json> <serebii swsh.json> [more serebii.json…]
 *
 * The encounter data has no base-game Galar dens at all, and Bulbapedia and Serebii disagree
 * on a fair number of Isle of Armor and Crown Tundra ones. So a den counts only when both
 * Bulbapedia's location table and Serebii's Pokédex page list it for that Pokémon in that
 * version. Gigantamax dens are left out (the art isn't the Gigantamax form). Writes
 * scripts/hunt/evidence/dens.json: { "<dex>": { "<form or ''>": { "sword": [places], "shield": [...] } } }
 * plus the dens only one source lists, for the review file.
 */
import fs from "node:fs";
import path from "node:path";
import aboutForms from "../../src/data/about-forms.json";
import { normPlace } from "../../src/lib/pokemon/encounter-transform";
import { FORMS_IN_GAME, formsInLabel, regionalForms, type EvidenceEntry } from "./forms";

interface SerebiiRow {
  group: string;
  game: string;
  segments: { text: string; places: string[] }[];
}

const VERSIONS = ["sword", "shield"] as const;

export function makeDens(bulba: Record<string, EvidenceEntry[] & { segments: { text?: string }[] }[]>, serebii: Record<string, SerebiiRow[]>) {
  const formsBy = regionalForms(aboutForms as unknown as [number, number, string, string, string][]);
  const dens: Record<string, Record<string, Record<string, string[]>>> = {};
  const disputed: { dex: number; form: string | null; version: string; place: string; only: "bulbapedia" | "serebii" }[] = [];
  const dexes = new Set([...Object.keys(bulba), ...Object.keys(serebii).map((k) => k.split("/")[1])]);
  for (const d of [...dexes].map(Number).sort((a, b) => a - b)) {
    const forms = formsBy.get(d);
    const hasGalarForms = !!forms?.some((f) => FORMS_IN_GAME.sword.includes(f.key.split("-")[0]));
    const ser = serebii[`pokedex-swsh/${d}`];
    if (!ser) continue;
    for (const v of VERSIONS) {
      // Bulbapedia: raid lines for this version, by form.
      const b = new Map<string | null, Set<string>>();
      let bUnsure = false;
      for (const e of bulba[String(d)] ?? []) {
        if (!e.versions.includes(v)) continue;
        for (const s of e.segments) {
          if (s.kind !== "raid" || /Gigantamax/.test((s as { text?: string }).text ?? "")) continue;
          let fs_: (string | null)[] | undefined = [null];
          if (hasGalarForms) {
            const parsed = s.forms.map((l) => formsInLabel(l, forms!));
            fs_ = parsed.length && parsed.every((x) => x) ? (parsed.flat() as (string | null)[]) : undefined;
          }
          if (!fs_) {
            bUnsure = true;
            continue;
          }
          for (const f of fs_) for (const p of s.places) if (!/^(Max Raid Battle|Gigantamax|Dynamax)/.test(p)) (b.get(f) ?? b.set(f, new Set()).get(f)!).add(p);
        }
      }
      // Serebii: "Max Raid Battles: …" lines for this version (base game and both expansions).
      const sPlaces = new Set<string>();
      const game = v === "sword" ? "Sword" : "Shield";
      for (const r of ser) {
        if (r.game !== game) continue;
        for (const s of r.segments) if (/^Max Raid Battles:/.test(s.text)) for (const p of s.places) sPlaces.add(p);
      }
      const sKeys = new Map([...sPlaces].map((p) => [normPlace(p), p]));
      const bAll = new Set<string>();
      for (const [f, set] of b) {
        const agreed = [...set].filter((p) => sKeys.has(normPlace(p))).sort();
        for (const p of set) bAll.add(normPlace(p));
        for (const p of [...set].filter((x) => !sKeys.has(normPlace(x)))) disputed.push({ dex: d, form: f, version: v, place: p, only: "bulbapedia" });
        if (agreed.length) ((dens[String(d)] ??= {})[f ?? ""] ??= {})[v] = agreed;
      }
      if (!bUnsure) for (const [k, p] of sKeys) if (!bAll.has(k)) disputed.push({ dex: d, form: null, version: v, place: p, only: "serebii" });
    }
  }
  return { dens, disputed };
}

if (process.argv[1]?.endsWith("make-dens.ts")) {
  const bulba = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const serebii: Record<string, SerebiiRow[]> = {};
  for (const f of process.argv.slice(3)) Object.assign(serebii, JSON.parse(fs.readFileSync(f, "utf8")));
  const out = makeDens(bulba, serebii);
  const file = path.join(process.cwd(), "scripts/hunt/evidence/dens.json");
  fs.writeFileSync(file, JSON.stringify({ note: "Max Raid dens both Bulbapedia and Serebii list (scripts/hunt/make-dens.ts)", dens: out.dens, disputed: out.disputed }) + "\n");
  console.log(`${Object.keys(out.dens).length} species with agreed dens, ${out.disputed.length} dens only one source lists`);
}
