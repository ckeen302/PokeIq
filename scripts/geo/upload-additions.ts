/**
 * Uploads hand-vetted screenshots for curation.json's `added`: each local file
 * is re-encoded like every other shot (encodeShot: 3D captures up to 1600 px
 * wide, WebP), optionally cropped first (to cut off a minimap), and uploaded
 * under a fresh random id with upsert off, so nothing already in the bucket is
 * ever overwritten. Prints the plan with the ids it was given.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/geo/upload-additions.ts plan.json
 *
 * plan.json: [{ "path": "local file", "game": "Sword / Shield", "crop"?: {left,top,width,height}, "id"?: set once uploaded }]
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, encodeShot } from "./bulbapedia";

interface Item {
  path: string;
  game: string;
  crop?: { left: number; top: number; width: number; height: number };
  id?: string;
}

async function main() {
  const planPath = process.argv[2];
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!planPath || !url || !key) throw new Error("usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… upload-additions.ts plan.json");
  const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Item[];
  let done = 0;
  for (const item of plan) {
    if (item.id) continue;
    const source = readFileSync(item.path);
    const { width = 0, height = 0 } = await sharp(source).metadata();
    const crop = item.crop ?? { left: 0, top: 0, width, height };
    const webp = await encodeShot(source, item.game, crop);
    const id = randomBytes(9).toString("base64url");
    const { error } = await storage.upload(`${id}.webp`, webp, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (error) {
      console.log(`  ! ${item.path}: ${error.message}`);
      continue;
    }
    item.id = id;
    done++;
    writeFileSync(planPath, JSON.stringify(plan, null, 1));
  }
  console.log(`${done} uploaded, ${plan.filter((i) => i.id).length}/${plan.length} in the plan have ids`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
