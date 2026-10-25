import namesData from "@/data/species-names.json";

/** Languages shown on an entry, in display order. Built by scripts/dex/build-names.ts from PokéAPI. */
export const NAME_LANGS = [
  { key: "ja", label: "Japanese" },
  { key: "ja-roma", label: "Rōmaji" },
  { key: "ko", label: "Korean" },
  { key: "zh-hans", label: "Chinese (Simplified)" },
  { key: "zh-hant", label: "Chinese (Traditional)" },
  { key: "fr", label: "French" },
  { key: "de", label: "German" },
  { key: "es", label: "Spanish" },
  { key: "it", label: "Italian" },
] as const;

export interface LocalizedName {
  lang: string;
  label: string;
  name: string;
}

const NAMES = namesData as Record<string, Record<string, string>>;

/** A species' name in each language, skipping languages with no recorded name. */
export function speciesNames(id: number): LocalizedName[] {
  const row = NAMES[id];
  if (!row) return [];
  return NAME_LANGS.filter((l) => row[l.key]).map((l) => ({ lang: l.key, label: l.label, name: row[l.key] }));
}
