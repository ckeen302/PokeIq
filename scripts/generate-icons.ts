/**
 * Generates every brand asset from the single logo source
 * (src/lib/brand/logo-svg.ts):
 *   public/logo.svg, src/app/icon.svg        vector mark (header, favicon)
 *   src/app/favicon.ico                      16/32/48 tab icon (PNG entries)
 *   src/app/icon1.png                        32×32 tab icon (icon1: Next takes one file per name)
 *   src/app/apple-icon.png                   180×180 iOS home-screen icon
 *   public/icon-192.png, public/icon-512.png PWA / Android icons
 *
 * Safari doesn't take an SVG favicon for its tabs: without a raster one it
 * asks for /favicon.ico and, when that's missing, draws a letter tile. The
 * ICO and PNG keep the mark on a transparent background like the SVG; the
 * iOS and PWA icons sit on the site's dark background (iOS fills
 * transparency with black).
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

/** The bare mark at `size`, transparent: drawn large and scaled down, which stays crisper at 16px than drawing it at 16. */
function mark(size: number): Promise<Buffer> {
  return sharp(Buffer.from(LOGO_SVG), { density: 72 * 8 })
    .resize(size, size, { kernel: "lanczos3" })
    .png()
    .toBuffer();
}

/** An ICO container holding PNG images (PNG entries are read by every current browser, and by Windows since Vista). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colours
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function main() {
  fs.writeFileSync(path.join(root, "public/logo.svg"), LOGO_SVG);
  fs.writeFileSync(path.join(root, "src/app/icon.svg"), LOGO_SVG);
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map(async (size) => ({ size, png: await mark(size) })));
  fs.writeFileSync(path.join(root, "src/app/favicon.ico"), ico(pngs));
  fs.writeFileSync(path.join(root, "src/app/icon1.png"), await mark(32));
  fs.writeFileSync(path.join(root, "src/app/apple-icon.png"), await tile(180, 18));
  fs.writeFileSync(path.join(root, "public/icon-192.png"), await tile(192, 24));
  fs.writeFileSync(path.join(root, "public/icon-512.png"), await tile(512, 64));
  console.log("✓ icons generated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
