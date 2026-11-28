/**
 * Serebii's Let's Go, Gen 8 and Gen 9 rows -> Rows for one game: detail tables (Let's Go, Sword/Shield, BD/SP) carry
 * methods, rates and levels; overview lists (Legends: Arceus, Scarlet/Violet, Legends: Z-A) carry places only.
 * Forms come from Serebii's form headings ("Galarian form"), resolved to PokéAPI forms.
 */
import type { EncounterKind } from "../../../src/lib/nuzlocke/model";
import { accent } from "./areas";
import type { SerebiiSource } from "./config";
import { formFor } from "./forms";
import { parseLevels, parseRate, type Row } from "./rows";
import { lgpeRows, svRows, swshRows, type SerebiiRow } from "./serebii";

const DLC = /^(The Teal Mask|The Indigo Disk|Isle of Armor|The Isle of Armor|Crown Tundra|The Crown Tundra|Mega Dimension|The Hidden Treasure of Area Zero)$/;
const FORM_NOTE = /^(\w+(?:-\w+)?) form$/i;

/** Detail and overview methods -> kind and label; null = not a place's encounter (raids by star level). */
function methodOf(m: string): { kind: EncounterKind; label: string } | null {
  switch (m) {
    case "Wild":
      return { kind: "wild", label: "Wild" };
    case "Static":
    case "Interact":
      return { kind: "static", label: "Static" };
    case "Max Raid":
      return null;
    case "Massive mass outbreak":
      return { kind: "wild", label: "Massive mass outbreak" };
    case "Hyperspace":
      return { kind: "wild", label: "Hyperspace" };
    case "Tera Raid":
      return null;
    case "Grass (random)":
      return { kind: "wild", label: "Grass (random)" };
    case "Wandering":
      return { kind: "wild", label: "Wanderer" };
    case "Wandering Surf":
      return { kind: "wild", label: "Wanderer (water)" };
    case "Curry":
      return { kind: "wild", label: "Curry (camp)" };
    default:
      return { kind: "wild", label: accent(m) };
  }
}

const TIME = ["Morning", "Day", "Night"];

/** Serebii's rows for a game's versions, as Rows (forms resolved). */
export async function serebiiGameRows(src: SerebiiSource, versions: string[]): Promise<{ rows: Row[]; notes: { species: number; ver: string; text: string; url: string }[] }> {
  let raw: SerebiiRow[] = [];
  if (src === "lgpe") raw = await lgpeRows();
  else if (src === "swsh") raw = (await swshRows()).detail.filter((r) => r.ver === "sword" || r.ver === "shield");
  else if (src === "bdsp") raw = (await swshRows()).detail.filter((r) => r.ver === "brilliant-diamond" || r.ver === "shining-pearl");
  else if (src === "la") raw = (await swshRows()).overview.filter((r) => r.ver === "legends-arceus");
  else if (src === "sv") raw = (await svRows()).filter((r) => r.ver === "scarlet" || r.ver === "violet");
  else if (src === "za") raw = (await svRows()).filter((r) => r.ver === "legends-za");
  const rows: Row[] = [];
  const notes: { species: number; ver: string; text: string; url: string }[] = [];
  for (const r of raw) {
    if (!versions.includes(r.ver)) continue;
    if (!r.loc) {
      if (r.x) notes.push({ species: r.species, ver: r.ver, text: r.x, url: r.url });
      continue;
    }
    const m = methodOf(r.m ?? "Wild");
    if (!m) continue;
    // "Gigantamax Raid Battles: …" (an inline label): raids by den, not a place's encounters.
    if (/label:[^·]*(Raid Battles|Dynamax)/.test(r.n ?? "")) continue;
    // Let's Go: "Grass" is Serebii's word for every walking spawn, caves too (the terrain comes from Bulbapedia's
    // table later, as for the older games); "- Rare Spawns" is a condition of the method, as Bulbapedia divides it.
    let rare = false;
    if (src === "lgpe") {
      const g = m.label.match(/^(Grass|Water|In the Sky)( - Rare Spawns)?$/);
      if (g) {
        m.label = g[1] === "Grass" ? "Walking" : g[1];
        rare = !!g[2];
      }
    }
    // Notes: a DLC heading (kept as the condition where the game's main story has the place: Zapdos on Poco Path
    // needs The Indigo Disk; Sword/Shield's DLC areas are their own places), a form heading, "or nearby"
    // (Legends: Arceus), weather…
    const parts = (r.n ?? "").split(" · ").map((x) => x.trim()).filter(Boolean);
    let formLabel: string | undefined;
    const cond: string[] = rare ? ["Rare Spawns"] : [];
    let kind = m.kind;
    let method = m.label;
    for (const p of parts) {
      if (DLC.test(p)) {
        if (src !== "swsh") cond.push(p);
        continue;
      }
      // An inline label: a form ("Paldean Form", "Combat Breed", "Pom-Pom Style"), a cosmetic form PokéAPI doesn't
      // list as a Pokémon ("East Sea", "Autumn Form": kept as the condition), or "Titan" (the former Titan, met once
      // where it was fought).
      const lab = p.match(/^label:(.+)$/)?.[1];
      if (lab === "Titan") {
        kind = "static";
        method = "Static";
        cond.push("Titan");
        continue;
      }
      if (lab) {
        if ((await formFor(r.species, lab)) === null) cond.push(lab);
        else formLabel = lab;
        continue;
      }
      const f = p.match(FORM_NOTE);
      if (f) formLabel = `${f[1]} Form`;
      else cond.push(p);
    }
    const form = await formFor(r.species, formLabel);
    // Legends: Arceus: "Spot (Area)" -> the area, with the spot as its part.
    // Scarlet/Violet's provinces as the game names them: Serebii's "South Province Area One" is "South Province (Area One)".
    let place = accent(r.loc).replace(/^(North|South|East|West) Province Area (\w+)$/, "$1 Province (Area $2)");
    let sub = r.sub;
    const la = src === "la" ? place.match(/^(.+) \(([^()]+)\)$/) : null;
    if (la) {
      sub = la[1];
      place = la[2];
    }
    const base: Row = {
      src: "serebii",
      ver: r.ver,
      place,
      ...(sub ? { sub } : {}),
      species: r.species,
      ...(form?.form ? { form: form.form, art: form.art } : {}),
      kind,
      method,
      url: r.url,
    };
    const lv = parseLevels(r.lv);
    if (lv) base.levels = lv;
    if (r.t) {
      const by = new Map<string, number[]>();
      r.t.forEach((v, i) => {
        if (v !== "—") by.set(v, [...(by.get(v) ?? []), i]);
      });
      for (const [v, idx] of by) {
        const rate = parseRate(v);
        const c = [idx.length === 3 ? "" : idx.map((i) => TIME[i]).join(", "), ...cond].filter(Boolean).join("; ");
        rows.push({ ...base, ...(rate !== undefined ? { rate } : {}), ...(c ? { cond: c } : {}) });
      }
      continue;
    }
    const rate = parseRate(r.r);
    const c = cond.join("; ");
    rows.push({ ...base, ...(rate !== undefined && kind === "wild" ? { rate } : {}), ...(c ? { cond: c } : {}) });
  }
  return { rows, notes };
}

/** Serebii's free-text notes that name a place: starters, gifts and trades ("Gift from Leon in Postwick"). */
export async function noteRow(n: { species: number; ver: string; text: string; url: string }): Promise<Row | null> {
  const r = noteRowSync({ ...n, text: n.text.replace(/, (\w+) form\b/, "") });
  const label = n.text.match(/, (\w+) form\b/)?.[1];
  if (!r || !label) return r;
  const f = await formFor(n.species, `${label} Form`);
  return f?.form ? { ...r, form: f.form, art: f.art } : r;
}

function noteRowSync(n: { species: number; ver: string; text: string; url: string }): Row | null {
  const t = n.text.replace(/\s*\(in [^)]+\)$/, "");
  const at = (kind: EncounterKind, method: string, place: string, cond?: string): Row => ({ src: "serebii", ver: n.ver, place: accent(place.trim()), species: n.species, kind, method, ...(cond ? { cond } : {}), url: n.url });
  let m = t.match(/^Starter Pokémon, from (.+)$/);
  if (m) return at("gift", "Starter", m[1]);
  m = t.match(/^Gift from (.+?)(?: \(if (\w+) picked\))?(?:, \w+ form)? in (.+)$/);
  if (m) return at("gift", "Gift", m[3], [`From ${m[1]}`, m[2] ? `If you chose ${m[2]}` : ""].filter(Boolean).join("; "));
  m = t.match(/^Gift in (.+)$/);
  if (m) return at("gift", "Gift", m[1]);
  m = t.match(/^(?:League Club )?Trade (?:with (.+?) )?in (.+?)(?:, \w+ form)?$/);
  if (m) return at("trade", "Trade", m[2], m[1] ? `With ${m[1]}` : undefined);
  m = t.match(/^Revive (Fossilized \w+) & (Fossilized \w+) in (.+)$/);
  if (m) return at("fossil", "Fossil", m[3], `${m[1]} and ${m[2]}`);
  return null;
}
