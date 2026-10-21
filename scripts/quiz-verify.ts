/**
 * Re-checks the Mainline Games and Pokémon Anime quiz data against the
 * Bulbapedia page each row cites.
 *
 *   npm run verify:quiz -- [--only games|anime] [--json out.json]
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/quiz-verify.ts [...]
 *
 * NODE_USE_ENV_PROXY=1 is required where outbound traffic goes through a
 * proxy (HTTPS_PROXY): without it Node's fetch ignores the proxy and
 * Bulbapedia answers with a Cloudflare 403. The npm script sets it, and the
 * script refuses to run without it when HTTPS_PROXY is set.
 *
 * For every data-table row and hand-written question it fetches the cited
 * page (rendered text, cached on disk), and checks that the facts the
 * question relies on are stated there: the leader, their town, type and
 * Badge on a Gym Leader's page; the opponent on a league page; the answer
 * plus the question's context words for hand-written questions.
 *
 * Bulbapedia is the source of record. When it can't be reached (it sits
 * behind a bot challenge that sometimes blocks scripted requests), the same
 * page title is looked up on the Pokémon Wiki (Fandom) instead and the check
 * is reported as such, never silently passed. Requests are sequential and
 * spaced to at most 2 per second.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ROMAN, type HandwrittenRow } from "../src/engines/trivia/bank";
import { GAMES_TABLES } from "../src/engines/trivia/games";
import { ANIME_TABLES } from "../src/engines/trivia/anime";
import GAMES_HANDWRITTEN from "../src/data/quiz/games/handwritten.json";
import ANIME_HANDWRITTEN from "../src/data/quiz/anime/handwritten.json";

const UA = "PokeIQ-quiz-verify/1.0 (https://pokeiq.vercel.app; cadenkeen@gmail.com)";
const BULBAPEDIA = "https://bulbapedia.bulbagarden.net/w/api.php";
const FANDOM = "https://pokemon.fandom.com/api.php";
const CACHE = process.env.QUIZ_VERIFY_CACHE ?? join(tmpdir(), "pokeiq-quiz-verify");
const GAP_MS = 550;

type Wiki = "bulbapedia" | "fandom";
interface Page {
  wiki: Wiki;
  title: string;
  text: string;
}
interface Check {
  bank: "games" | "anime";
  label: string;
  source: string;
  /** Every one must appear on the page (case-insensitive; multi-word terms may match word by word). */
  terms: string[];
}

// ---------------------------------------------------------------------------
// Fetching (polite, cached)
// ---------------------------------------------------------------------------

let last = 0;
async function politeFetch(url: string): Promise<Response | null> {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;|&rsquo;|’/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&eacute;/g, "é")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
}

async function parsePage(api: string, wiki: Wiki, title: string): Promise<Page | null> {
  const res = await politeFetch(
    `${api}?${new URLSearchParams({ action: "parse", page: title, prop: "text", redirects: "1", format: "json", formatversion: "2" })}`
  );
  if (!res || !res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
  const body = (await res.json()) as { parse?: { title: string; text: string } };
  return body.parse ? { wiki, title: body.parse.title, text: htmlToText(body.parse.text) } : null;
}

/** Parse a page through the cache (misses are cached too, so reruns stay cheap). */
async function cachedParse(api: string, wiki: Wiki, title: string): Promise<Page | null> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, createHash("sha1").update(`${wiki}:${title}`).digest("hex") + ".json");
  if (existsSync(file)) return (JSON.parse(readFileSync(file, "utf8")) as { page: Page | null }).page;
  const page = await parsePage(api, wiki, title);
  // A Bulbapedia miss may be the bot challenge, not a missing page: only cache its hits.
  if (page || wiki === "fandom") writeFileSync(file, JSON.stringify({ page }));
  return page;
}

async function fandomSearch(query: string, limit = 5): Promise<string[]> {
  const res = await politeFetch(
    `${FANDOM}?${new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: String(limit), format: "json", formatversion: "2" })}`
  );
  if (!res || !res.ok) return [];
  const body = (await res.json()) as { query?: { search?: { title: string }[] } };
  return body.query?.search?.map((s) => s.title) ?? [];
}

/** The page's subject in a word or two: "Ash's Aipom" → "Aipom", "Blue (game)" → "Blue". */
const subject = (title: string) => title.replace(/\s*\(.*\)$/, "").replace(/^.*'s /, "");

/** Articles the Pokémon Wiki files under another name. */
const FANDOM_ALIASES: Record<string, string> = {
  "Pokémon Black 2 and White 2 Versions": "Pokémon Black Version 2 and Pokémon White Version 2",
  "Damage category": "Physical move",
  M20: "MS020: Pokémon the Movie: I Choose You!",
};

/** Where the Pokémon Wiki keeps the same article, most likely first. */
function fandomTitles(title: string): string[] {
  const out = [FANDOM_ALIASES[title] ?? title, title.replace(/\s*\((game|anime)\)$/, ""), title.replace(/^Pokémon (?!the Series)/, ""), title.replace(/–/g, "-")];
  // "Pokémon Sun and Moon" / "… Versions" → "Pokémon Sun and Pokémon Moon", "Pokémon Ruby Version and Pokémon Sapphire Version".
  const game = title.match(/^Pokémon (.+) and (.+?)( Versions)?$/);
  if (game) out.push(game[3] ? `Pokémon ${game[1]} Version and Pokémon ${game[2]} Version` : `Pokémon ${game[1]} and Pokémon ${game[2]}`);
  return [...new Set(out)];
}

/** Episode and movie codes: Bulbapedia's EP039 / M02 are the wiki's TB039 / MS002. */
function fandomCodePrefix(title: string): string | null {
  const ep = title.match(/^EP(\d{3})$/);
  if (ep) return `TB${ep[1]}`;
  const movie = title.match(/^M(\d{2})$/);
  return movie ? `MS0${movie[1]}` : null;
}

const memo = new Map<string, Promise<Page | null>>();
let bulbapediaBlocked = false;

function getPage(title: string): Promise<Page | null> {
  if (!memo.has(title)) memo.set(title, loadPage(title));
  return memo.get(title)!;
}

async function loadPage(title: string): Promise<Page | null> {
  if (!bulbapediaBlocked) {
    const page = await cachedParse(BULBAPEDIA, "bulbapedia", title);
    if (page) return page;
    // A challenge page (HTML, 403) rather than a missing article: stop asking for this run.
    const probe = await politeFetch(`${BULBAPEDIA}?action=query&meta=siteinfo&format=json`);
    if (probe?.ok) return null;
    bulbapediaBlocked = true;
    console.warn("! Bulbapedia is not answering scripted requests right now; falling back to the Pokémon Wiki (Fandom).");
  }
  for (const t of fandomTitles(title)) {
    const page = await cachedParse(FANDOM, "fandom", t);
    if (page) return page;
  }
  const code = fandomCodePrefix(title);
  const hits = (await fandomSearch(code ?? subject(title), 10)).filter((h) => !h.includes("/"));
  const hit = hits.find((h) => (code ? h.startsWith(code) : h.toLowerCase().includes(subject(title).toLowerCase())));
  return hit ? cachedParse(FANDOM, "fandom", hit) : null;
}

/**
 * Fallback only: the Pokémon Wiki splits some Bulbapedia articles differently
 * (the Elite Four's Flint vs. Brock's father). Look for another article about
 * the same subject that states every term.
 */
async function corroborate(title: string, terms: string[]): Promise<Page | null> {
  const name = subject(title).toLowerCase();
  const hits = await fandomSearch(`${subject(title)} ${terms.map((t) => t.split("||")[0]).join(" ")}`);
  for (const hit of hits.filter((h) => h.toLowerCase().includes(name) && !h.includes("/"))) {
    const page = await cachedParse(FANDOM, "fandom", hit);
    if (page && terms.every((t) => stated(page.text, t))) return page;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const titleOf = (url: string) => decodeURIComponent(url.replace("https://bulbapedia.bulbagarden.net/wiki/", "")).replace(/_/g, " ");
const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'");
const STOP = new Set(["and", "or", "the", "a", "an", "of", "to", "in", "from", "with", "pokemon"]);

/** A term is stated if it appears verbatim, or (multi-word) every significant word does. */
function stated(text: string, term: string): boolean {
  if (term.includes("||")) return term.split("||").some((alt) => stated(text, alt));
  const t = norm(text);
  const clean = norm(term).replace(/^"|"$/g, "").replace(/[!?."]+$/g, "");
  if (t.includes(clean)) return true;
  const words = clean.split(/[^a-z0-9'-]+/).filter((w) => w.length >= 2 && !STOP.has(w));
  return words.length > 1 && words.every((w) => t.includes(w));
}

const g = GAMES_TABLES as Record<string, Record<string, unknown>[]>;
const word = (game: string) => game.replace(/^Pokémon:? /, "").split(/,| and /)[0].trim();

/** The answer (unless it's a phrase written for the quiz) plus the question's own context words. */
function handwrittenTerms(r: HandwrittenRow): string[] {
  const phrase = r.answer.split(" ").length > 3;
  return [...(phrase ? [] : [r.answer]), ...(r.verify ?? [])];
}

function gameChecks(): Check[] {
  const out: Check[] = [];
  const add = (label: string, source: string, terms: (string | undefined)[]) =>
    out.push({ bank: "games", label, source, terms: terms.filter((t): t is string => !!t) });
  for (const r of g.gyms) add(`gym ${r.leader} (${r.game})`, r.source as string, [r.leader as string, (r.place as string).replace(/ (City|Town|Island|Mountain)$/, ""), r.type as string, r.badge as string]);
  for (const r of g["elite-four"]) add(`E4 ${r.member} (${r.game})`, r.source as string, [r.member as string, r.type as string, "Elite Four"]);
  for (const r of g.champions) add(`champion ${r.champion} (${r.game})`, r.source as string, [r.champion as string, "Champion", word(r.game as string)]);
  for (const r of g.professors) add(`professor ${r.professor}`, r.source as string, [(r.professor as string).replace("Professor ", ""), word(r.game as string)]);
  for (const r of g.starters) add(`starters ${r.game}`, r.source as string, [r.grass as string, r.fire as string, r.water as string, word(r.game as string)]);
  for (const r of g["box-art"]) add(`box art ${r.game}`, r.source as string, [r.pokemon as string]);
  for (const r of g.exclusives) add(`exclusives ${r.a}/${r.b}`, r.source as string, [...(r.onlyA as string[]), ...(r.onlyB as string[]), "exclusive"]);
  for (const r of g.villains) add(`villain ${r.team}`, r.source as string, [r.team as string, (r.leader as string).replace("Chairman ", "")]);
  for (const r of g["team-star"]) add(`Team Star ${r.boss}`, r.source as string, [r.boss as string, r.type as string, r.squad as string]);
  for (const r of g.mechanics) add(`mechanic ${r.name}`, r.source as string, [`Generation ${ROMAN[r.gen as number]}||${word(r.games as string)}`]);
  for (const r of g.regions) add(`region ${r.region}`, r.source as string, [(r.basis as string).replace(/^the /, "")]);
  for (const r of g.places) add(`place ${r.place}`, r.source as string, [r.region as string]);
  for (const r of g.games) add(`game ${r.title}`, r.source as string, [r.region as string, r.askGen ? `Generation ${ROMAN[r.gen as number]}` : undefined]);
  for (const r of GAMES_HANDWRITTEN as HandwrittenRow[]) add(`q ${r.id}`, r.source, handwrittenTerms(r));
  return out;
}

function animeChecks(): Check[] {
  const out: Check[] = [];
  for (const r of ANIME_TABLES.leagues as Record<string, unknown>[]) {
    out.push({ bank: "anime", label: `league ${r.league}`, source: r.source as string, terms: [r.opponent as string, "Ash"] });
  }
  for (const r of ANIME_HANDWRITTEN as HandwrittenRow[]) {
    out.push({ bank: "anime", label: `q ${r.id}`, source: r.source, terms: handwrittenTerms(r) });
  }
  return out;
}

async function main() {
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
    console.error("Set NODE_USE_ENV_PROXY=1 (or use `npm run verify:quiz`): Node's fetch only uses HTTPS_PROXY with it.");
    process.exit(2);
  }
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
  const checks = [...(only !== "anime" ? gameChecks() : []), ...(only !== "games" ? animeChecks() : [])];
  const results: { check: Check; wiki: Wiki | null; page?: string; missing: string[] }[] = [];

  for (const check of checks) {
    let page = await getPage(titleOf(check.source));
    let missing = page ? check.terms.filter((t) => !stated(page!.text, t)) : check.terms;
    if (missing.length && bulbapediaBlocked) {
      const other = await corroborate(titleOf(check.source), check.terms);
      if (other) [page, missing] = [other, []];
    }
    results.push({ check, wiki: page?.wiki ?? null, page: page?.title, missing });
    const mark = !page ? "??" : missing.length ? "XX" : "ok";
    console.log(`${mark} [${page?.wiki ?? "unreachable"}] ${check.bank} ${check.label}${missing.length ? ` — not found: ${missing.join(" | ")}` : ""}`);
  }

  const by = (f: (r: (typeof results)[number]) => boolean) => results.filter(f).length;
  console.log("\nSummary");
  console.log(`  checks:              ${results.length}`);
  console.log(`  passed (Bulbapedia): ${by((r) => r.wiki === "bulbapedia" && !r.missing.length)}`);
  console.log(`  passed (Fandom):     ${by((r) => r.wiki === "fandom" && !r.missing.length)}`);
  console.log(`  terms not found:     ${by((r) => !!r.wiki && r.missing.length > 0)}`);
  console.log(`  page unreachable:    ${by((r) => !r.wiki)}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results.map((r) => ({ ...r.check, wiki: r.wiki, page: r.page, missing: r.missing })), null, 1));
  process.exitCode = results.some((r) => r.missing.length) ? 1 : 0;
}

void main();
