/**
 * The home hero's fixed picture at the widths its <Image> asks for, as static
 * files (public/home/<name>-<width>.webp): the same resize and WebP quality
 * as Next's image optimizer, so the page looks the same and no function has
 * to make them. Run after changing src/assets/guessr/<name>.webp:
 *
 *   npx tsx scripts/hero-sizes.ts paldea
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { HERO_WIDTHS } from "../src/lib/hero-image";

async function main() {
  const name = process.argv[2] ?? "paldea";
  const src = path.join(process.cwd(), "src/assets/guessr", `${name}.webp`);
  fs.mkdirSync(path.join(process.cwd(), "public/home"), { recursive: true });
  for (const w of HERO_WIDTHS) {
    const out = await sharp(src).rotate().resize(w, undefined, { withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    fs.writeFileSync(path.join(process.cwd(), "public/home", `${name}-${w}.webp`), out);
    console.log(`${name}-${w}.webp`, out.length);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
