// Renders the install assets from public/logo.svg: a maskable icon (logo inside the 80% safe zone)
// and iOS launch screens (logo centred on the dark theme colour). Run: node scripts/gen-pwa-assets.mjs
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BG = "#08071a";
const svg = readFileSync("public/logo.svg", "utf8");
const logo = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// [width, height, device-width, device-height, ratio] (portrait), common iPhones.
const IPHONES = [
  [1290, 2796, 430, 932, 3], [1179, 2556, 393, 852, 3], [1284, 2778, 428, 926, 3], [1170, 2532, 390, 844, 3],
  [1125, 2436, 375, 812, 3], [1242, 2688, 414, 896, 3], [828, 1792, 414, 896, 2], [750, 1334, 375, 667, 2],
];

const browser = await chromium.launch();
const shot = async (w, h, scale) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:${BG};display:grid;place-items:center;width:${w}px;height:${h}px"><img src="${logo}" style="width:${Math.round(Math.min(w, h) * scale)}px"></body>`);
  const buf = await page.screenshot({ type: "png" });
  await page.close();
  return buf;
};
writeFileSync("public/icon-maskable-512.png", await shot(512, 512, 0.6));
writeFileSync("public/icon-maskable-192.png", await shot(192, 192, 0.6));
mkdirSync("public/splash", { recursive: true });
const links = [];
for (const [w, h, dw, dh, r] of IPHONES) {
  writeFileSync(`public/splash/iphone-${w}x${h}.png`, await shot(w, h, 0.32));
  links.push({ w, h, dw, dh, r });
}
writeFileSync("src/lib/splash-screens.json", JSON.stringify(links.map(({ w, h, dw, dh, r }) => ({ href: `/splash/iphone-${w}x${h}.png`, media: `(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)` })), null, 2) + "\n");
await browser.close();
