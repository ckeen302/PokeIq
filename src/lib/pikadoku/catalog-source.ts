import { allCategories } from "./categories";
import { FAMILY_LETTER, type PdkCatalogRow } from "./catalog";

/** The committed catalog's rows, built from the categories themselves (server, scripts and tests only). */
export function catalogRows(): PdkCatalogRow[] {
  return allCategories().map((c) => [c.id, c.label, FAMILY_LETTER[c.family], c.classic ? 1 : 0]);
}
