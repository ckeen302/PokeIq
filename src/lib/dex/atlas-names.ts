import "server-only";
import type { AtlasData } from "@/components/atlas/atlas-engine";
import atlas from "../../../public/atlas/atlas.json";
import { dexNames } from "./local-names";

const cache = new Map<string, Record<string, string>>();

/**
 * The World Atlas's names in the render's language (English name → official name, only where they differ), for the
 * atlas page and the globe: regions, towns, routes, landmarks and the places inside them. Null on English pages.
 */
export function atlasNames(): Record<string, string> | null {
  const names = dexNames();
  if (names.locale === "en") return null;
  let out = cache.get(names.locale);
  if (!out) {
    out = {};
    const a = atlas as unknown as AtlasData;
    const add = (english: string, local: string) => {
      if (local !== english) out![english] = local;
    };
    for (const r of a.regions) add(r.name, names.region(r.name) === r.name ? names.place(r.name) : names.region(r.name));
    for (const m of a.markers) add(m.name, names.place(m.name));
    for (const p of a.places) {
      add(p.name, names.place(p.name));
      for (const b of p.inside ?? []) add(b, names.place(b));
    }
    cache.set(names.locale, out);
  }
  return out;
}
