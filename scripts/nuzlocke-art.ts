/**
 * The Nuzlocke Tracker's form pictures the site's Pokémon art doesn't have (src/lib/nuzlocke/form-art.ts): each form's
 * Pokémon HOME render from PokéAPI's sprites, made the way scripts/sizes-art.ts makes the rest (256 px, the same
 * WebP), so they sit with them:
 *   - a form with a PokéAPI pokemon id: public/sizes/art/256/{id}.webp (its `art` id then just works);
 *   - a cosmetic form with none (East Sea Shellos, Flabébé's colours): public/tools/nuzlocke/forms/{species}-{form}.webp;
 *   - a cover's form the site's art lacks (Complete Forme Zygarde): public/tools/nuzlocke/{id}.webp.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/nuzlocke-art.ts           (missing ones only)
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/nuzlocke-art.ts --force   (every one again)
 */
import fs from "node:fs";
import path from "node:path";
import { transcodeHome } from "../src/lib/server/sizes-art";
import { COSMETIC_FORMS, FORM_ART, SHOWDOWN_DEFAULTS } from "../src/lib/nuzlocke/form-art";
import { ART_PATHS } from "../src/lib/nuzlocke/view";

const HOME = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home";
const ROOT = process.cwd();
const force = process.argv.includes("--force");

async function fetchPng(name: string | number): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${HOME}/${name}.png`).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4 || res?.status === 404) throw new Error(`HOME render ${name}: ${res?.status ?? "network error"}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function main() {
  const jobs = [
    ...[...Object.entries(FORM_ART), ...Object.entries(SHOWDOWN_DEFAULTS).map(([form, d]) => [form, d.art] as const)].map(([form, id]) => ({ form, render: id, file: path.join(ROOT, "public/sizes/art/256", `${id}.webp`) })),
    ...Object.entries(COSMETIC_FORMS).map(([form, c]) => ({ form, render: c.render, file: path.join(ROOT, "public/tools/nuzlocke/forms", `${c.render}.webp`) })),
    // The games' covers the site's art lacks (view.ts ART_PATHS).
    ...Object.entries(ART_PATHS).map(([id, src]) => ({ form: `cover ${id}`, render: Number(id), file: path.join(ROOT, "public", src) })),
  ];
  let written = 0;
  for (const job of jobs) {
    if (!force && fs.existsSync(job.file)) continue;
    fs.mkdirSync(path.dirname(job.file), { recursive: true });
    fs.writeFileSync(job.file, await transcodeHome(await fetchPng(job.render), 256));
    written++;
    console.log(`${job.form}: ${path.relative(ROOT, job.file)}`);
  }
  console.log(`${written} written; ${jobs.length} form pictures in all.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
