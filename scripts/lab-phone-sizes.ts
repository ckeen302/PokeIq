/**
 * The 3D Lab's screenshots as phones take them (public/lab/phone/<name>.webp):
 * 828 px wide, a phone screen's width at 2x, with the same resize and WebP
 * quality as Next's image optimizer. A phone's card is drawn about 360 CSS px
 * wide, so the 1280 px originals (bigger screens resize those) were mostly
 * bytes a phone throws away. Run after changing a screenshot in public/lab:
 *
 *   npx tsx scripts/lab-phone-sizes.ts
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

/** A phone screen's width at 2x (and one of Next's image widths). */
const LAB_PHONE_WIDTH = 828;

async function main() {
  const dir = path.join(process.cwd(), "public/lab");
  fs.mkdirSync(path.join(dir, "phone"), { recursive: true });
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".webp"))) {
    const out = await sharp(path.join(dir, file)).resize(LAB_PHONE_WIDTH, undefined, { withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    fs.writeFileSync(path.join(dir, "phone", file), out);
    console.log(`phone/${file}`, out.length);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
