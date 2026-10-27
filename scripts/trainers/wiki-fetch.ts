/**
 * Polite, cached access to Bulbapedia's MediaWiki API for the Gen V–IX
 * trainer importer. Raw wikitext is cached under .data/wiki/ (gitignored) so
 * re-running the import never re-downloads a page.
 *
 * At least one second between requests; 403/429/5xx back off and retry.
 * Requests go through curl: Bulbapedia's edge answers Node's fetch (undici)
 * with 403 but serves curl with the same User-Agent.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const API = "https://bulbapedia.bulbagarden.net/w/api.php";
const UA = "PokeIQ-trainer-import/1.0 (data import for a fan Pokédex; contact cadenkeen@gmail.com)";
export const CACHE_DIR = path.join(process.cwd(), ".data/wiki");
const GAP_MS = 1100;

let last = 0;
async function politeGet(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    if (process.env.WIKI_DEBUG) console.error("GET", url.slice(0, 160));
    let status = 0;
    let body = "";
    try {
      const out = execFileSync("curl", ["-sS", "-m", "90", "-A", UA, "-H", "Accept: application/json", "-w", "\n%{http_code}", url], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      const nl = out.lastIndexOf("\n");
      status = Number(out.slice(nl + 1));
      body = out.slice(0, nl);
    } catch (e) {
      if (attempt >= 5) throw e;
    }
    if (status === 200) return body;
    if ((status === 0 || status === 403 || status === 429 || status >= 500) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${status} for ${url}`);
  }
}

const cacheFile = (kind: string, key: string) => {
  const safe = key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
  const h = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  return path.join(CACHE_DIR, kind, `${safe}-${h}.json`);
};

async function cached<T>(kind: string, key: string, load: () => Promise<T>): Promise<T> {
  const f = cacheFile(kind, key);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  const v = await load();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

export interface WikiPage {
  title: string;
  /** Null when the page doesn't exist. */
  text: string | null;
}

type RevPage = { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[] };
type RevQuery = { query: { pages: RevPage[]; normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[] } };

/**
 * Pages' wikitext, fetched 50 titles per request for any not yet cached
 * (redirects followed; the cache is keyed by the requested title).
 */
export async function wikitextMany(titles: string[]): Promise<Map<string, WikiPage>> {
  const out = new Map<string, WikiPage>();
  const todo: string[] = [];
  for (const t of new Set(titles)) {
    const f = cacheFile("page", t);
    if (fs.existsSync(f)) out.set(t, JSON.parse(fs.readFileSync(f, "utf8")) as WikiPage);
    else todo.push(t);
  }
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const q = new URLSearchParams({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: batch.join("|"), redirects: "1", format: "json", formatversion: "2" });
    const j = JSON.parse(await politeGet(`${API}?${q}`)) as RevQuery;
    const byTitle = new Map(j.query.pages.map((p) => [p.title, p]));
    const hop = (t: string, map?: { from: string; to: string }[]) => map?.find((x) => x.from === t)?.to ?? t;
    fs.mkdirSync(path.join(CACHE_DIR, "page"), { recursive: true });
    for (const t of batch) {
      const resolved = hop(hop(t, j.query.normalized), j.query.redirects);
      const p = byTitle.get(resolved);
      const page: WikiPage = { title: resolved, text: !p || p.missing || !p.revisions ? null : p.revisions[0].slots.main.content };
      fs.writeFileSync(cacheFile("page", t), JSON.stringify(page));
      out.set(t, page);
    }
    if (process.env.WIKI_DEBUG) console.error(`fetched ${Math.min(i + 50, todo.length)}/${todo.length}`);
  }
  return out;
}

/** One page's wikitext. */
export async function wikitext(title: string): Promise<WikiPage> {
  return (await wikitextMany([title])).get(title)!;
}

/** Members of a category (namespace 0 pages, or subcategories), following continuation. */
export function categoryMembers(cat: string, type: "page" | "subcat" = "page"): Promise<string[]> {
  return cached("cat", `${type}:${cat}`, async () => {
    const out: string[] = [];
    let cont: string | undefined;
    do {
      const q = new URLSearchParams({ action: "query", list: "categorymembers", cmtitle: `Category:${cat}`, cmlimit: "500", cmtype: type, format: "json", formatversion: "2" });
      if (type === "page") q.set("cmnamespace", "0");
      if (cont) q.set("cmcontinue", cont);
      const j = JSON.parse(await politeGet(`${API}?${q}`)) as { query: { categorymembers: { title: string }[] }; continue?: { cmcontinue: string } };
      out.push(...j.query.categorymembers.map((m) => m.title.replace(/^Category:/, "")));
      cont = j.continue?.cmcontinue;
    } while (cont);
    return out;
  });
}

/** Pages of a category and its subcategories, down to `depth` levels. */
export async function categoryTree(cat: string, depth = 2, skip: RegExp = /^$/): Promise<string[]> {
  const pages = new Set<string>(await categoryMembers(cat));
  if (depth > 0)
    for (const sub of await categoryMembers(cat, "subcat")) if (!skip.test(sub)) for (const p of await categoryTree(sub, depth - 1, skip)) pages.add(p);
  return [...pages];
}

/** Pages whose wikitext matches a CirrusSearch query (e.g. insource:), following continuation. */
export function searchTitles(query: string): Promise<string[]> {
  return cached("search", query, async () => {
    const out: string[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const q = new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: "500", srnamespace: "0", srprop: "", format: "json", formatversion: "2", sroffset: String(offset) });
      const j = JSON.parse(await politeGet(`${API}?${q}`)) as { query: { search: { title: string }[] }; continue?: { sroffset: number } };
      out.push(...j.query.search.map((m) => m.title));
      offset = j.continue?.sroffset;
    }
    return out;
  });
}
