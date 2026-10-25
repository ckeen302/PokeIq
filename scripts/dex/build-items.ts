/**
 * Build src/data/items.json (mainline-game items) from PokéAPI.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/dex/build-items.ts
 *
 * Raw responses are cached under $DEX_RAW/items (default <repo>/.cache/dex-raw/items)
 * so reruns are offline. Requests are paced (4 in flight, 60 ms apart).
 */
import fs from "node:fs";
import path from "node:path";
import pokedex from "../../src/data/pokedex.json";
import { buildItem, isMainline, keepItem, type ItemRecord, type RawItem, type RawMachine } from "../../src/lib/dex/items-build";

const RAW = path.join(process.env.DEX_RAW ?? path.join(process.cwd(), ".cache", "dex-raw"), "items");
const OUT = path.join(process.cwd(), "src", "data", "items.json");
fs.mkdirSync(RAW, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cached<T>(kind: string, key: string, url: string): Promise<T> {
  const file = path.join(RAW, `${kind}-${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": "pokeiq-dex-build" } });
    if (res.ok) {
      const text = await res.text();
      fs.writeFileSync(file, text);
      await sleep(60);
      return JSON.parse(text) as T;
    }
    if (attempt >= 4) throw new Error(`${res.status} ${url}`);
    await sleep(1000 * (attempt + 1));
  }
}

async function pool<T, R>(list: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < list.length) {
        const k = i++;
        out[k] = await fn(list[k]);
      }
    })
  );
  return out;
}

async function main() {
  const index = await cached<{ results: { name: string }[] }>("index", "all", "https://pokeapi.co/api/v2/item?limit=5000");
  console.log(`index: ${index.results.length} items`);
  const names = [...new Set(index.results.map((r) => r.name))];
  const raws = await pool(names, 4, (n) => cached<RawItem>("item", n, `https://pokeapi.co/api/v2/item/${n}`));
  const mainline = raws.filter(isMainline);
  console.log(`mainline: ${mainline.length}`);

  const known = new Set((pokedex as { slug: string }[]).map((p) => p.slug));
  const records: ItemRecord[] = [];
  let machineFetches = 0;
  for (const raw of mainline) {
    const machines = await pool(raw.machines ?? [], 4, (m) => {
      machineFetches++;
      const id = m.machine.url.split("/").filter(Boolean).pop()!;
      return cached<RawMachine>("machine", id, m.machine.url);
    });
    const rec = buildItem(raw, machines, known);
    if (keepItem(rec)) records.push(rec);
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(records));
  console.log(`machines fetched: ${machineFetches}`);
  console.log(`wrote ${records.length} items, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, with holders: ${records.filter((r) => r.held.length).length}, machines: ${records.filter((r) => r.machines.length).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
