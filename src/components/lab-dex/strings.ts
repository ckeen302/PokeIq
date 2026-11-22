"use client";

import { createContext, useContext, useMemo } from "react";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import labDex from "@/messages/lab-dex";
import type { RoleKey } from "@/lib/lab-dex/roles";
import type { SortKey } from "@/lib/lab-dex/sequence";
import type { LabLocal } from "@/lib/lab-dex/types";

/**
 * Every piece of the Professor's Lab's UI copy, from the site's messages
 * (src/messages/en/lab-dex.json), shaped as one object the components read.
 * (The 3D scene's decorative wall screens, sci-fi set dressing with made-up readouts, stay as they are; the
 * caption round the holo-table, which names the Pokémon on it, is in the page's language.)
 */

export const GEN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"] as const;
const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const REGION_KEYS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"] as const;
const ROLE_KEYS: RoleKey[] = ["physicalSweeper", "specialSweeper", "wall", "physicalTank", "specialTank"];

type T = Translator<typeof labDex.en>;

/** What the scene draws in another language: the caption round the holo-table (English pages draw their own). */
export interface LabWords {
  idle: string;
  total: string;
  type: (id: string) => string;
}

function build(t: T, local: LabLocal | undefined) {
  const plain = Object.fromEntries(
    (["brand", "loading", "noWebgl", "searchLabel", "searchPlaceholder", "clearSearch", "notInView", "showAll", "noMatch", "noSearchMatch", "reset", "filters", "allTypes", "types", "typesHint", "gen", "legends", "final", "forms", "formsHint", "sortBy", "sortAsc", "sortDesc", "specimen", "scanComplete", "materialising", "biometrics", "height", "weight", "region", "entry", "abilities", "hidden", "evolution", "noEvolution", "matchups", "weakTo", "resists", "immune", "baseStats", "roles", "total", "bestRole", "rolesNote", "rolesNoteForms", "openInDex", "prev", "next", "hint", "hintTouch", "stage", "stageRole", "sheetHandle", "sheetClose", "close", "done"] as const).map((k) => [k, t(k)])
  ) as Record<"brand" | "loading" | "noWebgl" | "searchLabel" | "searchPlaceholder" | "clearSearch" | "notInView" | "showAll" | "noMatch" | "noSearchMatch" | "reset" | "filters" | "allTypes" | "types" | "typesHint" | "gen" | "legends" | "final" | "forms" | "formsHint" | "sortBy" | "sortAsc" | "sortDesc" | "specimen" | "scanComplete" | "materialising" | "biometrics" | "height" | "weight" | "region" | "entry" | "abilities" | "hidden" | "evolution" | "noEvolution" | "matchups" | "weakTo" | "resists" | "immune" | "baseStats" | "roles" | "total" | "bestRole" | "rolesNote" | "rolesNoteForms" | "openInDex" | "prev" | "next" | "hint" | "hintTouch" | "stage" | "stageRole" | "sheetHandle" | "sheetClose" | "close" | "done", string>;
  const stats = STAT_KEYS.map((k) => t(`stats.${k}`));
  const roles = Object.fromEntries(ROLE_KEYS.map((k) => [k, { name: t(`role.${k}.name`), formula: t(`role.${k}.formula`) }])) as Record<RoleKey, { name: string; formula: string }>;
  const sorts: Record<SortKey, string> = {
    id: t("sort.id"),
    name: t("sort.name"),
    bst: t("sort.bst"),
    hp: stats[0],
    atk: stats[1],
    def: stats[2],
    spa: stats[3],
    spd: stats[4],
    spe: stats[5],
    ...(Object.fromEntries(ROLE_KEYS.map((k) => [k, roles[k].name])) as Record<RoleKey, string>),
  };
  const caption: LabWords | false = t.locale !== "en" && { idle: t("captionIdle"), total: t("total"), type: (id: string) => local?.types[id] ?? id };
  return {
    ...plain,
    locale: t.locale,
    /** A height or weight to one decimal, as the page's language writes it. */
    dec: (n: number) => (t.locale === "en" ? n.toFixed(1) : n.toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })),
    caption,
    /** A type's name on this page (English pages: none, so callers show the id as before). */
    typeName: (id: string): string | undefined => local?.types[id],
    genN: (n: string) => t("genN", { n }),
    top: (n: number) => t("top", { n }),
    bottom: (n: number) => t("bottom", { n }),
    prevNamed: (name: string) => t("prevNamed", { name }),
    nextNamed: (name: string) => t("nextNamed", { name }),
    announce: (name: string, no: string, types: string) => t("announce", { name, no, types }),
    evoJump: (name: string) => t("evoJump", { name }),
    statLabels: stats,
    statShort: STAT_KEYS.map((k) => t(`statsShort.${k}`)),
    regions: REGION_KEYS.map((k) => t(`regions.${k}`)),
    regionByName: { Alolan: t("regions.alola"), Galarian: t("regions.galar"), Hisuian: t("regions.hisui"), Paldean: t("regions.paldea") } as Record<string, string>,
    roleText: roles,
    sorts,
  };
}

export type LabStrings = ReturnType<typeof build>;

/** A page in another language's type names (from the server); English pages have none. */
export const LabLocalContext = createContext<LabLocal | undefined>(undefined);

/** The lab's copy in the page's language. */
export function useLabStrings(): LabStrings {
  const t = useT(labDex);
  const local = useContext(LabLocalContext);
  return useMemo(() => build(t, local), [t, local]);
}
