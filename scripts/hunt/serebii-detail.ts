/**
 * Serebii's detailed location pages (Sword / Shield with both expansions, Brilliant Diamond /
 * Shining Pearl, Let's Go), read with the Pokédex build's own parsers, for the blind check.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/hunt/serebii-detail.ts <out.json> <dex> [dex…]
 *
 * Output: { "<dex>": { "<version>": ["place", …] } }. Downloaded pages are untrusted data and
 * are only parsed as text; nothing is kept but the place names.
 */
import fs from "node:fs";
import { parseBdspDetail, parseLgpeDetail, parseSwshDetail } from "../dex/serebii";
import { LOC_PAGES, rowsFromLocPage } from "../dex/serebii-loc";

const UA = "Mozilla/5.0 (compatible; fan-site-data-check)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<{ body: string; url: string } | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
      await sleep(1000);
      if (res.status === 404) return null;
      if (res.ok) {
        // Older Serebii sections are served as Latin-1.
        const buf = Buffer.from(await res.arrayBuffer());
        const utf = buf.toString("utf8");
        return { body: utf.includes("\uFFFD") ? buf.toString("latin1") : utf, url: res.url };
      }
    } catch {
      /* retry */
    }
    await sleep(3000 * (i + 1));
  }
  return null;
}

async function main() {
  const [out, ...ids] = process.argv.slice(2);
  const result: Record<string, Record<string, string[]>> = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
  const done = ((result as unknown as Record<string, Record<string, string[]>>)._done ??= {}) as Record<string, string[]>;
  for (const id of ids.map(Number)) {
    const nnn = String(id).padStart(3, "0");
    const byVer: Record<string, Set<string>> = {};
    for (const [v, list] of Object.entries(result[id] ?? {})) byVer[v] = new Set(list);
    const put = (rows: { ver: string; loc?: string; m?: string }[]) => {
      for (const r of rows) if (r.loc && !/Max Raid|Curry|Gift|Trade/.test(r.m ?? "")) (byVer[r.ver] ??= new Set()).add(r.loc);
    };
    const did = new Set(done[id] ?? (result[id] ? ["lgpe", "swsh"] : []));
    // Gen 3 and 4 location pages (the overview pages there have no location list).
    for (const key of ["rs", "dp"] as const) {
      const pg = LOC_PAGES[key];
      if (did.has(key) || id > pg.maxId) continue;
      const page = await get(`https://www.serebii.net/${pg.dir}/location/${nnn}.shtml`);
      if (page) put(rowsFromLocPage(page.body, pg.anchors));
      did.add(key);
    }
    if (!did.has("lgpe") && (id <= 151 || id === 808 || id === 809)) {
      const lg = await get(`https://www.serebii.net/pokedex-sm/location/${nnn}.shtml`);
      if (lg) put([...parseLgpeDetail(lg.body, "letsgop", "lets-go-pikachu"), ...parseLgpeDetail(lg.body, "letsgoe", "lets-go-eevee")]);
    }
    if (!did.has("swsh") && id <= 905) {
      const sw = await get(`https://www.serebii.net/pokedex-swsh/${nnn}.shtml`);
      if (sw) {
        const loc = await get(sw.url.replace(/\/?(index\.shtml)?$/, "/") + "locations.shtml");
        if (loc)
          put([
            ...parseSwshDetail(loc.body, "sword", "sword"),
            ...parseSwshDetail(loc.body, "shiekd", "shield"),
            ...parseBdspDetail(loc.body, "bd", "brilliant-diamond"),
            ...parseBdspDetail(loc.body, "sp", "shining-pearl"),
          ]);
      }
    }
    did.add("lgpe").add("swsh");
    done[id] = [...did].sort();
    result[id] = Object.fromEntries(Object.entries(byVer).map(([v, s]) => [v, [...s].sort()]));
    fs.writeFileSync(out, JSON.stringify(result));
    console.log(id, Object.keys(result[id]).join(","));
  }
}

void main();
