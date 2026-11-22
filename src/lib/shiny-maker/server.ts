import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { decodeSpecies, LAST_ID, type Species, type SpeciesFile } from "./data";

/** A species' English name (for titles), or null. */
export function speciesName(id: number): string | null {
  return id >= 1 && id <= LAST_ID ? getPokemon(id)?.name ?? null : null;
}

const files = new Map<number, Promise<Species>>();
/** A species' maker data from public/shiny-maker (the preview card draws from it). */
export function readSpecies(id: number): Promise<Species> {
  let p = files.get(id);
  if (!p) {
    p = readFile(join(process.cwd(), "public/shiny-maker/px", `${id}.json`), "utf8").then((s) => decodeSpecies(JSON.parse(s) as SpeciesFile));
    p.catch(() => files.delete(id));
    if (files.size > 200) files.delete(files.keys().next().value!);
    files.set(id, p);
  }
  return p;
}
