"use client";

import { useMemo } from "react";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import labDex from "@/messages/lab-dex";
import type { RoleKey } from "@/lib/lab-dex/roles";
import type { SortKey } from "@/lib/lab-dex/sequence";

/**
 * Every piece of the Professor's Lab's UI copy, from the site's messages
 * (src/messages/en/lab-dex.json), shaped as one object the components read.
 * (The 3D scene's own decorative labels, drawn into its screens, stay as they are.)
 */

export const GEN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"] as const;
const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const REGION_KEYS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"] as const;
const ROLE_KEYS: RoleKey[] = ["physicalSweeper", "specialSweeper", "wall", "physicalTank", "specialTank"];

type T = Translator<typeof labDex.en>;

function build(t: T) {
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
  return {
    ...plain,
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

/** The lab's copy in the page's language. */
export function useLabStrings(): LabStrings {
  const t = useT(labDex);
  return useMemo(() => build(t), [t]);
}
