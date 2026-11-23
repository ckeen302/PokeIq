/**
 * Forms: which exact form an encounter row is.
 *
 * Every Hunt entry is one exact form with its own art (rule 3). The encounter data only
 * sometimes says the form ("Galarian form" in `n`), so each row is resolved like this:
 *
 * 1. Games from before regional forms existed in the wild (Gens 1–6, Let's Go, Brilliant
 *    Diamond / Shining Pearl) only have the original form.
 * 2. A species whose regional forms all came out after the game has only its original form
 *    there (Wooper in Sword / Shield: Paldean Wooper is from Scarlet / Violet).
 * 3. A form named in the row's note is that form.
 * 4. Otherwise Bulbapedia's location table for that game decides, when every line naming
 *    the place says the form ("Route 2 (Alolan Form)"). Those per-species tables are kept
 *    in scripts/hunt/evidence/forms.json (built by scripts/hunt/bulbapedia.py).
 * 5. Anything else is uncertain: the row is listed for review and the species is left out.
 *
 * A note and Bulbapedia that disagree are uncertain too.
 */
import { normPlace } from "../../src/lib/pokemon/encounter-transform";

/** Versions where only the original form of every species is found in the wild. */
export const ORIGINAL_ONLY = new Set([
  "red", "blue", "yellow", "gold", "silver", "crystal", "ruby", "sapphire", "emerald", "firered", "leafgreen",
  "diamond", "pearl", "platinum", "heartgold", "soulsilver", "black", "white", "black-2", "white-2",
  "x", "y", "omega-ruby", "alpha-sapphire", "lets-go-pikachu", "lets-go-eevee", "brilliant-diamond", "shining-pearl",
]);

/** The regional forms that exist in each later game (a form is first seen in its own region's games). */
export const FORMS_IN_GAME: Record<string, string[]> = {
  sun: ["alola"], moon: ["alola"], "ultra-sun": ["alola"], "ultra-moon": ["alola"],
  sword: ["alola", "galar"], shield: ["alola", "galar"],
  scarlet: ["alola", "galar", "hisui", "paldea"], violet: ["alola", "galar", "hisui", "paldea"],
  "legends-za": ["alola", "galar", "hisui", "paldea"],
};

/**
 * Species left out because which form you meet depends on where you are in a way the
 * encounter data doesn't record (the art would show the wrong one at some spots).
 */
export const PLACE_DEPENDENT_FORMS: Record<number, string> = {
  412: "Burmy's cloak depends on where it's battled",
  413: "Wormadam's cloak depends on where Burmy evolved",
  422: "Shellos is West Sea or East Sea depending on the side of Mt. Coronet",
  423: "Gastrodon is West Sea or East Sea depending on the side of Mt. Coronet",
  666: "Vivillon's pattern depends on the player's real-world region",
  669: "Flabébé's flower colour depends on the flower patch",
  670: "Floette's flower colour depends on the flower patch",
  671: "Florges's flower colour depends on where Flabébé was met",
  741: "Oricorio's style depends on the island",
};

/** One regional form of a species, from src/data/about-forms.json. */
export interface FormInfo {
  /** Short form key: "alola", "galar", "hisui", "paldea", "paldea-combat"… */
  key: string;
  /** PokéAPI id for the art. */
  art: number;
  /** "Alolan Meowth". */
  name: string;
}

/** The forms a species has, keyed by about-forms' regional entries (Galarian Darmanitan's Zen Mode is a battle form, so left out). */
export function regionalForms(aboutForms: [number, number, string, string, string][]): Map<number, FormInfo[]> {
  const out = new Map<number, FormInfo[]>();
  for (const [art, dex, slug, name, kind] of aboutForms) {
    if (kind !== "regional" || slug.endsWith("-zen")) continue;
    const list = out.get(dex) ?? [];
    list.push({ key: formKeyFromSlug(slug), art, name: name.replace(/^Standard /, "") });
    out.set(dex, list);
  }
  return out;
}

const ADJECTIVE: Record<string, string> = { Alolan: "alola", Galarian: "galar", Hisuian: "hisui", Paldean: "paldea" };

function formKeyFromSlug(slug: string): string {
  const m = /-(alola|galar|hisui|paldea)(?:-(combat|blaze|aqua)-breed)?(?:-standard)?$/.exec(slug);
  if (!m) throw new Error(`regional form slug ${slug}`);
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

/**
 * The forms a label names, for a species: "Alolan form" → ["alola"]; "Kantonian Form" → [null]
 * (the original); "Paldean Form (Combat and Blaze Breeds)" → ["paldea-combat", "paldea-blaze"].
 * Undefined when the label names a form the species doesn't have.
 */
export function formsInLabel(label: string, forms: FormInfo[]): (string | null)[] | undefined {
  const m = /^(\w+)\s+[Ff]orm\b(.*)$/.exec(label.trim());
  if (!m) return undefined;
  const adj = ADJECTIVE[m[1]];
  const has = (k: string) => forms.some((f) => f.key === k);
  if (!adj || !forms.some((f) => f.key === adj || f.key.startsWith(`${adj}-`))) {
    // An adjective the species has no regional form for is its original form (Kantonian, Johtonian, Alolan Decidueye…).
    return [null];
  }
  if (has(adj)) return [adj];
  const breeds = [...m[2].matchAll(/\b(Combat|Blaze|Aqua)\b/g)].map((b) => `${adj}-${b[1].toLowerCase()}`).filter(has);
  return breeds.length ? breeds : undefined;
}

/** A Bulbapedia location line: the places it names and the forms it tags. */
export interface EvidenceSegment {
  places: string[];
  forms: string[];
  kind: "wild" | "raid" | "other";
}
export interface EvidenceEntry {
  versions: string[];
  segments: EvidenceSegment[];
}

export type FormResult = { kind: "forms"; forms: (string | null)[]; via: string } | { kind: "uncertain"; why: string };

/**
 * The form(s) one row is, in one version. `names` are the row's place as the data names it
 * and as the map names it (either may be how Bulbapedia links it).
 */
export function resolveForms(args: {
  dex: number;
  version: string;
  note: string | undefined;
  names: string[];
  forms: FormInfo[] | undefined;
  evidence: EvidenceEntry[] | undefined;
}): FormResult {
  const { version, note, names, forms, evidence } = args;
  if (!forms?.length) return { kind: "forms", forms: [null], via: "one form" };
  if (ORIGINAL_ONLY.has(version)) return { kind: "forms", forms: [null], via: "original form only in this game" };
  const exists = FORMS_IN_GAME[version];
  if (!exists) return { kind: "uncertain", why: `no form rule for ${version}` };
  if (!forms.some((f) => exists.includes(f.key.split("-")[0]))) return { kind: "forms", forms: [null], via: "its regional forms came out after this game" };
  const fromNote = (note ?? "")
    .split(" · ")
    .map((p) => formsInLabel(p, forms))
    .find((x) => x);
  const keys = new Set(names.map(normPlace));
  let tagged: (string | null)[] | undefined;
  let untagged = false;
  let seen = false;
  for (const e of evidence ?? []) {
    if (!e.versions.includes(version)) continue;
    for (const s of e.segments) {
      if (s.kind === "other" || !s.places.some((p) => keys.has(normPlace(p)))) continue;
      seen = true;
      const f = s.forms.map((l) => formsInLabel(l, forms));
      if (!f.length || f.some((x) => !x)) {
        untagged = true;
        continue;
      }
      tagged = [...new Set([...(tagged ?? []), ...f.flat() as (string | null)[]])];
    }
  }
  if (fromNote) {
    if (tagged && !fromNote.every((f) => tagged!.includes(f))) return { kind: "uncertain", why: `note says ${fmt(fromNote)}, Bulbapedia says ${fmt(tagged)}` };
    return { kind: "forms", forms: fromNote, via: "the row's note" };
  }
  if (tagged && !untagged) return { kind: "forms", forms: tagged, via: "Bulbapedia's form tag at this place" };
  if (!seen) return { kind: "uncertain", why: "no form in the row, and Bulbapedia doesn't list this place for this game" };
  return { kind: "uncertain", why: "no form in the row, and Bulbapedia doesn't tag the form at this place" };
}

const fmt = (f: (string | null)[]) => f.map((x) => x ?? "original").join(" + ");
