/**
 * Generates every brand asset from the single logo source
 * (src/lib/brand/logo-svg.ts):
 *   public/logo.svg, src/app/icon.svg        vector mark (header, favicon)
 *   src/app/apple-icon.png                   180×180 iOS home-screen icon
 *   public/icon-192.png, public/icon-512.png PWA / Android icons
 *
 *   npm run icons
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { LOGO_SVG } from "../src/lib/brand/logo-svg";

const root = process.cwd();
const BG = { r: 8, g: 7, b: 26, alpha: 1 };

async function tile(size: number, padding: number): Promise<Buffer> {
  const mark = await sharp(Buffer.from(LOGO_SVG))
    .resize(size - padding * 2, size - padding * 2)
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: mark, left: padding, top: padding }])
    .png()
    .toBuffer();
}

async function main() {
  fs.writeFileSync(path.join(root, "public/logo.svg"), LOGO_SVG);
  fs.writeFileSync(path.join(root, "src/app/icon.svg"), LOGO_SVG);
  fs.writeFileSync(path.join(root, "src/app/apple-icon.png"), await tile(180, 18));
  fs.writeFileSync(path.join(root, "public/icon-192.png"), await tile(192, 24));
  fs.writeFileSync(path.join(root, "public/icon-512.png"), await tile(512, 64));
  console.log("✓ icons generated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
