import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAST_ID } from "@/lib/shiny-maker/data";

/**
 * GET /tools/favorite-pokemon-picker/shiny-parts.json: how many colour parts each species has in the Shiny Pokémon
 * Maker's data, as one digit per species (index 0 is #1, "0" where it has no data), built when the site builds. The
 * picker needs it to write a Shiny Pokémon Maker link that opens straight on a Pokémon (a design carries its part count).
 */
export const dynamic = "force-static";

export function GET() {
  let out = "";
  for (let id = 1; id <= LAST_ID; id++) {
    let n = 0;
    try {
      const file = JSON.parse(readFileSync(join(process.cwd(), "public/shiny-maker/px", `${id}.json`), "utf8")) as { parts?: unknown[] };
      n = Math.min(9, file.parts?.length ?? 0);
    } catch {
      n = 0;
    }
    out += String(n);
  }
  return Response.json({ parts: out }, { headers: { "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } });
}
