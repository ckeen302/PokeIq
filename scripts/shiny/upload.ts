/**
 * Uploads the generated shiny-quiz images to the public Supabase bucket
 * `shiny` (never overwriting: upsert is off, an existing file counts as done).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/shiny/upload.ts <webpDir> [limit]
 *
 * With a limit it uploads only that many files and checks each public URL loads.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import answers from "../../src/data/shiny/answers.json";

const BUCKET = "shiny";

async function main() {
  const [dir, limitArg] = process.argv.slice(2);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dir || !url || !key) throw new Error("usage: upload.ts <webpDir> [limit]; needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const storage = createClient(url, key, { auth: { persistSession: false } }).storage;
  const { data: bucket } = await storage.getBucket(BUCKET);
  if (!bucket) {
    const { error } = await storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ["image/webp"] });
    if (error) throw new Error(`create bucket: ${error.message}`);
  }
  const names = Object.values(answers.sets as Record<string, string[][]>).flat(2);
  const todo = limitArg ? names.slice(0, Number(limitArg)) : names;
  let done = 0, existed = 0, next = 0;
  async function worker() {
    while (next < todo.length) {
      const name = todo[next++];
      const body = await readFile(path.join(dir, `${name}.webp`));
      for (let attempt = 0; ; attempt++) {
        const { error } = await storage.from(BUCKET).upload(`${name}.webp`, body, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
        if (!error) break;
        if (/exist|duplicate/i.test(error.message)) { existed++; break; }
        if (attempt >= 4) throw new Error(`upload ${name}: ${error.message}`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
      if (limitArg) {
        const res = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${name}.webp`);
        if (!res.ok || res.headers.get("content-type") !== "image/webp") throw new Error(`public URL for ${name}: ${res.status} ${res.headers.get("content-type")}`);
      }
      if (++done % 500 === 0) console.log(`${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`uploaded ${done - existed}, already there ${existed}, of ${todo.length}${limitArg ? " (all public URLs load)" : ""}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
