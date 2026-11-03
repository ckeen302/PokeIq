import type { MBSpecies } from "@/lib/mass-battle/types";

/**
 * Forms for the pictures: which form a FORM note (NOTE.FORM in constants.ts)
 * means for each battle species, its label, the colour of its effect, and
 * the figure it switches to (Aegislash's Blade Forme, Wishiwashi's School
 * Form, Minior's core, Eiscue's Noice Face).
 *
 * The rule mirrors formsOf in src/lib/mass-battle/damage.ts (the engine's
 * forms, form 0 first), which the page doesn't load (it carries the damage
 * calculator); tests/mass-battle-visuals.test.ts checks the two agree.
 * The other figures are the Race's form renders and relief maps (the
 * renders through /api/race/home, the baked reliefs in public/race/depth),
 * sized from their documented heights in src/data/race-forms.json.
 */

export type FormRule = "" | "stance" | "school" | "shields" | "iceface" | "protean";

export interface FormLook {
  /** What the label over the unit says ("Blade Forme", "Fire type"…). */
  label: string;
  /** The type whose colour the change flashes (capitalised). */
  type: string;
  /** Another figure for this form (a PokéAPI form id), or null for the species' own. */
  figure: number | null;
}

export interface SpeciesForms {
  rule: FormRule;
  forms: FormLook[];
  /** The form a unit starts in (Wishiwashi schools from level 20, as the engine has it). */
  initial: number;
}

/** The PokéAPI ids of the forms with a figure of their own (in src/data/race-forms.json). */
export const FORM_FIGURES = { aegislashBlade: 10026, wishiwashiSchool: 10127, miniorCore: 10136, eiscueNoice: 10185 } as const;

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : "Normal");

/** A battle species' forms, from its species, set (ability, Tera, level) and moves by slot. */
export function speciesForms(s: Pick<MBSpecies, "calc" | "types">, set: { ability: string; tera: string; level: number }, moves: { type: string }[]): SpeciesForms {
  const ab = toId(set.ability);
  const calc = s.calc;
  const own = cap(s.types[0] ?? "normal");
  const one = (rule: FormRule, a: FormLook, b: FormLook, initial = 0): SpeciesForms => ({ rule, forms: [a, b], initial });
  if (ab === "stancechange" && calc.startsWith("Aegislash")) return one("stance", { label: "Shield Forme", type: "Steel", figure: null }, { label: "Blade Forme", type: "Steel", figure: FORM_FIGURES.aegislashBlade });
  if (ab === "schooling" && calc.startsWith("Wishiwashi")) return one("school", { label: "Solo Form", type: "Water", figure: null }, { label: "School Form", type: "Water", figure: FORM_FIGURES.wishiwashiSchool }, set.level >= 20 ? 1 : 0);
  if (ab === "shieldsdown" && calc.startsWith("Minior")) return one("shields", { label: "Meteor Form", type: "Rock", figure: null }, { label: "Shields Down", type: "Rock", figure: FORM_FIGURES.miniorCore });
  if (ab === "iceface" && calc === "Eiscue") return one("iceface", { label: "Ice Face", type: "Ice", figure: null }, { label: "Noice Face", type: "Ice", figure: FORM_FIGURES.eiscueNoice });
  if ((ab === "protean" || ab === "libero") && !set.tera && moves.length) {
    return { rule: "protean", forms: [{ label: "", type: own, figure: null }, ...moves.map((m) => ({ label: `${cap(m.type)} type`, type: cap(m.type), figure: null }))], initial: 0 };
  }
  return { rule: "", forms: [{ label: "", type: own, figure: null }], initial: 0 };
}

/** A form's figure: what the scene needs to build it (a species record for its size and look, and where its files are). */
export interface FormFigure {
  /** The battle species it belongs to, and the form. */
  sp: number;
  form: number;
  species: MBSpecies;
  art: (size: 256 | 512) => string;
  relief: string;
}

interface RaceForm {
  id: number;
  species: number;
  slug: string;
  name: string;
  height: number;
  weight: number;
  types: string[];
  box: [number, number, number, number, number];
}

/** The figures a battle's form changes need (loaded with the armies, before the battle starts). */
export async function formFigures(species: MBSpecies[], forms: SpeciesForms[]): Promise<FormFigure[]> {
  const wanted = forms.some((f) => f.forms.some((l) => l.figure !== null));
  if (!wanted) return [];
  const data = (await import("@/data/race-forms.json")).default as unknown as { forms: RaceForm[] };
  const byId = new Map(data.forms.map((f) => [f.id, f]));
  const out: FormFigure[] = [];
  forms.forEach((sf, sp) => {
    sf.forms.forEach((look, form) => {
      const f = look.figure !== null ? byId.get(look.figure) : undefined;
      const base = species[sp];
      if (!f || !base || !Array.isArray(f.box) || f.box.length !== 5) return;
      out.push({
        sp,
        form,
        species: { ...base, id: f.id, slug: f.slug, name: f.name, types: f.types, m: f.height / 10, kg: f.weight / 10, box: [...f.box] as MBSpecies["box"] },
        art: (size) => `/api/race/home/${f.id}?s=${size}`,
        relief: `/race/depth/${f.id}.webp`,
      });
    });
  });
  return out;
}
