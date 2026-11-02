import sharp from "sharp";
import geo from "@/data/geo.json";
import blur from "@/data/geo-shot-blur.json";
import retired from "@/data/geo-retired.json";
import { previewUrl } from "@/lib/server/geo";
import { buildGlobeShotIndex, publicShotOf, type GlobeLocationInput } from "@/lib/globe/shots";

/**
 * GET /guessr/globe/shots.json — the globe's hover pictures: atlas label to
 * the screenshots its Pokédex place pages already show (see
 * src/lib/globe/shots.ts for the rules that keep PokéGuessr's answers
 * secret). Built once at build time; the globe fetches it only once someone
 * reaches for a label.
 */
export const dynamic = "force-static";

const LOCATIONS = (geo as unknown as { world: { locations: GlobeLocationInput[] } }).world.locations;
const BLUR = blur as Record<string, string>;

/**
 * A round's placeholder is the 8-pixel WebP in geo-shot-blur.json; the globe
 * gets a 6-pixel re-encode of it, so the string never matches a round's.
 */
async function placeholders(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = LOCATIONS.map(publicShotOf).flatMap((s) => (s && BLUR[s.id] ? [s.id] : []));
  await Promise.all(
    ids.map(async (id) => {
      try {
        const buf = await sharp(Buffer.from(BLUR[id], "base64")).resize(6).webp({ quality: 40 }).toBuffer();
        out.set(id, `data:image/webp;base64,${buf.toString("base64")}`);
      } catch {
        // no placeholder: the picture fades in on its own
      }
    }),
  );
  return out;
}

export async function GET() {
  const ph = await placeholders();
  const index = buildGlobeShotIndex(LOCATIONS, {
    preview: previewUrl,
    placeholder: (id) => ph.get(id),
    skip: new Set(retired as string[]),
  });
  return Response.json(index, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
