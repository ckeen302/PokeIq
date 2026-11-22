import "server-only";
import type { Translator } from "@/i18n/catalog";
import type trainersNs from "@/messages/trainers";
import type { DexNames } from "@/lib/dex/local-names";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import type { AreaKind } from "./format";
import type { NotableRole } from "./notable";
import type { TrainerTeam } from "./types";

/**
 * The Trainers pages' words in the render's language (server only): roles, area kinds, battle tags ("Rematch 2",
 * "If you chose Piplup", "Requires Surf"), form names and level ranges. Trainer classes, trainer names, badges and the
 * notable trainers' summaries have no official names in the repo's data, so they stay as the games print them in English.
 * On an English page everything comes back exactly as before.
 */

export type TrainersT = Translator<typeof trainersNs.en>;

const ROLE_KEYS = {
  "Gym Leader": "gymLeader",
  "Elite Four": "eliteFour",
  "Trial Captain": "trialCaptain",
  Kahuna: "kahuna",
  Champion: "champion",
  Rival: "rival",
  Trainer: "trainer",
  Villain: "villain",
  Admin: "admin",
} as const satisfies Record<NotableRole, keyof typeof trainersNs.en.roles>;

export const roleName = (t: TrainersT, role: NotableRole) => t(`roles.${ROLE_KEYS[role]}`);
export const roleHeading = (t: TrainersT, role: NotableRole) => t(`headings.${ROLE_KEYS[role]}`);

const KIND_KEYS = { Routes: "routes", "Towns & cities": "towns", "Places & dungeons": "places" } as const satisfies Record<AreaKind, keyof typeof trainersNs.en.kinds>;
export const kindName = (t: TrainersT, kind: AreaKind) => t(`kinds.${KIND_KEYS[kind]}`);

const SPECIES_ID = new Map(POKEDEX.map((p) => [p.name, p.id]));

const FIXED_TAGS = {
  "After becoming Champion": "afterChampion",
  "Before the Hall of Fame": "beforeHof",
  "After the Hall of Fame": "afterHof",
  "Post-game": "postGame",
  "First visit": "firstVisit",
  "First battle": "firstBattle",
  Rematch: "rematch",
} as const satisfies Record<string, keyof typeof trainersNs.en.team>;

/** A battle's tag in the language; tags the site has no words for ("After speaking with Kagetora") stay English. */
export function tagName(t: TrainersT, names: DexNames, tag: string): string {
  if (t.locale === "en") return tag;
  if (tag in FIXED_TAGS) return t(`team.${FIXED_TAGS[tag as keyof typeof FIXED_TAGS]}`);
  const rematch = /^Rematch (\d+)$/.exec(tag);
  if (rematch) return t("team.rematchN", { n: rematch[1] });
  const chose = /^If you chose (.+)$/.exec(tag);
  if (chose) {
    const id = SPECIES_ID.get(chose[1]);
    return id ? t("team.chose", { pokemon: names.species(id, chose[1]) }) : tag;
  }
  const requires = /^Requires (.+)$/.exec(tag);
  if (requires) {
    const either = requires[1].includes(" or ");
    const parts = requires[1].split(either ? " or " : " and ");
    const local = parts.map((p) => names.move(p));
    if (local.some((p, i) => p === parts[i])) return tag;
    return t("team.requires", { what: new Intl.ListFormat(t.locale, { type: either ? "disjunction" : "conjunction" }).format(local) });
  }
  return tag;
}

/** A tab's label: the battle's tag, else "First battle" / "Battle 2". */
export const battleLabel = (t: TrainersT, names: DexNames, team: Pick<TrainerTeam, "tag">, i: number) =>
  team.tag ? tagName(t, names, team.tag) : i === 0 ? t("team.firstBattle") : t("team.battle", { n: i + 1 });

const FORM_KEYS = {
  "Sandy Cloak": "sandyCloak",
  "Trash Cloak": "trashCloak",
  "East Sea": "eastSea",
  "Alolan Form": "alolanForm",
  "Galarian Form": "galarianForm",
  "Hisuian Form": "hisuianForm",
  "Paldean Form": "paldeanForm",
} as const satisfies Record<string, keyof typeof trainersNs.en.forms>;

/** A form's name ("Sandy Cloak", "Form 2", "Alolan Form"); others the sources print stay English. */
export function formLabel(t: TrainersT, name: string): string {
  if (t.locale === "en") return name;
  if (name in FORM_KEYS) return t(`forms.${FORM_KEYS[name as keyof typeof FORM_KEYS]}`);
  const n = /^Form (\d+)$/.exec(name);
  return n ? t("forms.form", { n: n[1] }) : name;
}

/** "Lv 12" or "Lv 10–14". */
export function levelText(t: TrainersT, team: { lv: number }[]): string {
  const lo = Math.min(...team.map((m) => m.lv));
  const hi = Math.max(...team.map((m) => m.lv));
  return lo === hi ? t("team.lv", { lv: lo }) : t("team.lvRange", { lo, hi });
}
