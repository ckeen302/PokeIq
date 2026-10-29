// IndexNow: tell Bing, Yandex, Seznam, Naver and the other IndexNow engines which
// URLs changed since the last submission, from a diff of the live sitemaps.
//
//   npm run indexnow                        dry run against the production site: prints what would be sent
//   npm run indexnow -- --submit            submit the changed URLs, then save the snapshot
//   npm run indexnow -- --site=https://example.com --all --submit
//
// Flags:
//   --site=<url>      site to read sitemaps from (default NEXT_PUBLIC_SITE_URL, else https://pokeiq.vercel.app)
//   --submit          actually POST to api.indexnow.org (without it nothing is sent and nothing is saved)
//   --all             submit every URL in the sitemaps, not just the diff
//   --state=<file>    snapshot of the last submitted sitemaps (default .data/indexnow-state.json, git-ignored)
//
// The key is the 32-hex-character file in public/ (<key>.txt containing the key), served at /<key>.txt.
// "Changed" = URLs that are new, removed, or whose <lastmod> moved since the snapshot.
// With no snapshot yet, every URL counts as changed (the first run submits the whole site).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10_000; // IndexNow's per-request limit

/** The IndexNow key: the name of public/<32 hex>.txt, whose content must equal it. */
export function findKey(publicDir = join(ROOT, "public")) {
  for (const f of readdirSync(publicDir)) {
    const m = /^([a-f0-9]{32})\.txt$/.exec(f);
    if (m && readFileSync(join(publicDir, f), "utf8").trim() === m[1]) return m[1];
  }
  throw new Error("No IndexNow key file (public/<32 hex chars>.txt) found");
}

/** <loc> -> <lastmod> ("" when absent) for every <url> in a sitemap XML document. */
export function parseSitemap(xml) {
  const out = new Map();
  for (const [, body] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(body)?.[1];
    if (!loc) continue;
    out.set(decode(loc), /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(body)?.[1] ?? "");
  }
  return out;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** URLs to submit: added, removed (so engines recrawl and drop them) or with a new lastmod. Sorted. */
export function diffSitemaps(previous, current) {
  const changed = new Set();
  for (const [url, mod] of current) if (!previous.has(url) || previous.get(url) !== mod) changed.add(url);
  for (const url of previous.keys()) if (!current.has(url)) changed.add(url);
  return [...changed].sort();
}

/** The request bodies for api.indexnow.org, at most BATCH URLs each. */
export function indexNowPayloads({ site, key, urls }) {
  const host = new URL(site).host;
  const own = urls.filter((u) => new URL(u).host === host);
  const out = [];
  for (let i = 0; i < own.length; i += BATCH) out.push({ host, key, keyLocation: `${site}/${key}.txt`, urlList: own.slice(i, i + BATCH) });
  return out;
}

async function text(url) {
  const res = await fetch(url, { headers: { "User-Agent": "PokeIQ-IndexNow/1.0" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Every sitemap robots.txt lists (falls back to /sitemap.xml), following sitemap indexes. */
async function readSitemaps(site) {
  const robots = await text(`${site}/robots.txt`).catch(() => "");
  const queue = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!queue.length) queue.push(`${site}/sitemap.xml`);
  const urls = new Map();
  const seen = new Set();
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    const xml = await text(next);
    for (const [, loc] of xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/g)) queue.push(decode(loc));
    for (const [u, m] of parseSitemap(xml)) urls.set(u, m);
    console.log(`  ${next}`);
  }
  return urls;
}

async function main() {
  const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
  const site = String(args.get("site") || process.env.NEXT_PUBLIC_SITE_URL || "https://pokeiq.vercel.app").replace(/\/+$/, "");
  const statePath = String(args.get("state") || join(ROOT, ".data/indexnow-state.json"));
  const submit = args.has("submit");
  const key = findKey();

  console.log(`IndexNow for ${site} (key ${key})\nSitemaps:`);
  const current = await readSitemaps(site);
  const previous = existsSync(statePath) ? new Map(Object.entries(JSON.parse(readFileSync(statePath, "utf8")))) : new Map();
  const urls = args.has("all") ? [...current.keys()].sort() : diffSitemaps(previous, current);
  console.log(`${current.size} URLs in sitemaps, ${previous.size} in the last snapshot, ${urls.length} to submit.`);
  for (const u of urls.slice(0, 20)) console.log(`  ${u}`);
  if (urls.length > 20) console.log(`  … and ${urls.length - 20} more`);

  if (!submit) {
    console.log("Dry run: nothing sent. Add --submit to send these to IndexNow.");
    return;
  }
  const keyFile = await text(`${site}/${key}.txt`).catch(() => "");
  if (keyFile.trim() !== key) throw new Error(`${site}/${key}.txt does not serve the key yet: deploy public/${key}.txt first`);
  for (const body of indexNowPayloads({ site, key, urls })) {
    const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    console.log(`POST ${body.urlList.length} URLs -> HTTP ${res.status}`);
    if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow rejected the batch: ${res.status} ${await res.text()}`);
  }
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(Object.fromEntries(current)));
  console.log(`Saved snapshot to ${statePath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
