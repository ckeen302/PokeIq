/**
 * Server-HTML audit: what a crawler that does not run JavaScript (ChatGPT, Claude and Perplexity's crawlers, and
 * Google's first pass) sees on each kind of page.
 *
 *   npm run build && npm start -- -p 3000
 *   node scripts/seo/server-html-audit.mjs [baseUrl=http://localhost:3000] [--only=pokemon,moves] [--json=out.json] [--md] [--rendered]
 *
 * For each example page it fetches the HTML the server sends (no JavaScript runs) and reports:
 *   - h1, <title>, meta description and canonical: present or not
 *   - words: the visible text's word count (scripts, styles and the React payload left out)
 *   - links: internal <a href> anchors (unique targets)
 *   - content: the strings a searcher wants from that page (a Pokémon's types, stats and evolutions; a move's power
 *     and effect; a game's how-to-play), each looked for in the visible text; and the links a list page must carry
 *     (every Pokémon, move, ability, item, place), each looked for as a real <a href>.
 * A page passes when all four head tags are there, it has words, and every expected string and link is found.
 *
 * --rendered also opens each page in Chromium, lets it hydrate, and checks the same strings there. A string missing
 * from the server HTML but present after hydration is content only JavaScript shows; one missing from both is behind
 * a pop-up, a tab or scrolling on the live page too (or a wrong expectation in this file). It also reports coverage:
 * the share of the words on the hydrated page's <main> that the server HTML already has, and a sample of the rest.
 *
 * Text inside hidden elements counts: crawlers read it, and content behind a closed tab or a "show more" is meant to
 * be in the HTML even when it is collapsed on screen. Text that exists only in the React payload
 * (self.__next_f.push(...)) does not count: crawlers that do not run scripts never see it as page text.
 */
import fs from "node:fs";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes("=") ? a.slice(name.length + 3) : true;
};
const BASE = (argv.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const ONLY = String(flag("only", "")).split(",").filter(Boolean);
const JSON_OUT = flag("json", "");
const MD = flag("md", false);
const RENDERED = flag("rendered", false);

/**
 * label: the route type (several examples can share one); path; text: strings the visible text must contain;
 * links: hrefs that must be real anchors; minLinks: the least number of distinct links with a prefix
 * (for "every entry is linked" checks on list pages).
 */
export const ROUTES = [
  // Home, hubs and games
  { label: "home", path: "/", text: ["Pokédle", "PokéGuessr", "Pokédex"], links: ["/pokedle", "/pokeguessr", "/pokedex", "/quiz"] },
  { label: "daily", path: "/daily", text: ["Daily"] },
  { label: "game:pokedle", path: "/pokedle", text: ["How to play", "Type the name of a Pokémon and submit it as your guess"] },
  { label: "game:pokeguessr", path: "/pokeguessr", text: ["How to play", "Look at the in-game view you are given"] },
  { label: "game:pokeguessr-streak", path: "/pokeguessr/streak", text: ["streak"] },
  { label: "game:pokeguessr-globe", path: "/pokeguessr/globe", text: ["Every region, on one world", "click a region to fly there"] },
  { label: "game:pokeconnections", path: "/pokeconnections", text: ["How to play", "Select four and submit them as a group"] },
  { label: "game:pokeconnections-community", path: "/pokeconnections/community", text: ["puzzle"] },
  { label: "game:pokeconnections-create", path: "/pokeconnections/create", text: ["puzzle"] },
  { label: "game:pikadoku", path: "/pikadoku", text: ["How to play", "You have 9 guesses (PP) in a daily"] },
  { label: "game:iq-test", path: "/iq-test", text: ["IQ"] },
  { label: "quiz hub", path: "/quiz", links: ["/quiz/whos-that-pokemon", "/quiz/pokemon-cry-quiz", "/quiz/name-em-all"] },
  { label: "quiz", path: "/quiz/whos-that-pokemon", text: ["silhouette"] },
  { label: "quiz", path: "/quiz/pokemon-cry-quiz", text: ["cry"] },
  { label: "quiz", path: "/quiz/gen-1-pokemon-quiz", text: ["Kanto"] },
  { label: "quiz:name-em-all", path: "/quiz/name-em-all", links: ["/quiz/name-em-all/gen-1"] },
  { label: "quiz:name-em-all-category", path: "/quiz/name-em-all/gen-1", text: ["Kanto"] },
  { label: "quiz:name-em-all-daily", path: "/quiz/name-em-all/daily", text: ["daily"] },
  { label: "quiz:which-pokemon", path: "/quiz/which-pokemon", text: ["Which Pokémon"] },
  { label: "quiz:which-pokemon-result", path: "/quiz/which-pokemon/mr-mime", text: ["Mr. Mime", "Psychic", "Fairy"] },
  { label: "battle hub", path: "/battle", links: ["/battle/play", "/battle/teams", "/battle/calc"] },
  { label: "battle", path: "/battle/play", text: ["battle"] },
  { label: "battle", path: "/battle/teams", text: ["team"] },
  { label: "battle", path: "/battle/calc", text: ["damage"] },
  { label: "battle", path: "/battle/lab", text: ["battle"] },
  { label: "battle", path: "/battle/factory", text: ["Factory", "Win seven in a row to clear a round"] },
  { label: "battle", path: "/battle/tower", text: ["Tower", "bring six and pick three after seeing your opponent's team"] },
  { label: "battle", path: "/battle/watch", text: ["battle"] },
  { label: "battle", path: "/battle/replays", text: ["replay"] },
  { label: "battle", path: "/battle/ladder", text: ["ladder"] },
  { label: "battle", path: "/battle/tournaments", text: ["tournament"] },
  { label: "leaderboard", path: "/leaderboard", text: ["Leaderboard"] },
  { label: "atlas", path: "/atlas", text: ["Kanto"] },
  { label: "tools hub", path: "/tools", links: ["/tools/shiny-maker", "/tools/pokeball-maker", "/tools/tier-list", "/tools/favorite-pokemon-picker"] },
  { label: "tool", path: "/tools/shiny-maker", text: ["shiny"] },
  { label: "tool", path: "/tools/pokeball-maker", text: ["Poké Ball"] },
  { label: "tool", path: "/tools/favorite-pokemon-picker", text: ["favorite Pokémon of every type", "How it works"] },
  { label: "tool:tier-list", path: "/tools/tier-list", links: ["/tools/tier-list/starters"] },
  { label: "tool:tier-list-template", path: "/tools/tier-list/starters", text: ["starter"] },
  { label: "rooms", path: "/rooms", text: ["room"] },
  { label: "users", path: "/users", text: ["trainer"] },
  { label: "static", path: "/privacy", text: ["privacy"] },
  { label: "static", path: "/credits", text: ["Pokémon"] },
  { label: "static", path: "/feedback", text: ["feedback"] },

  // Pokédex: species (a regular one, a regional-form one, long and punctuated names)
  {
    label: "pokemon",
    path: "/pokemon/pikachu",
    // Also what sits behind the page's tabs and "show more": TM moves, older games' places, older Pokédex entries.
    text: ["Pikachu", "Electric", "Mouse Pokémon", "Static", "Lightning Rod", "Pichu", "Raichu", "Thunderbolt", "320", "Thunder Punch", "Viridian Forest", "cause lightning storms"],
    links: ["/pokemon/raichu", "/pokemon/pichu", "/pokedex/types/electric", "/pokedex/abilities/static", "/pokedex/moves/thunderbolt", "/pokedex/moves/thunder-punch"],
  },
  { label: "pokemon", path: "/pokemon/vulpix", text: ["Vulpix", "Fire", "Ninetales", "Alolan", "Ice", "Flash Fire", "Drought", "Hypnosis", "Pokémon Mansion"], links: ["/pokemon/ninetales"] },
  { label: "pokemon", path: "/pokemon/crabominable", text: ["Crabominable", "Fighting", "Ice", "Crabrawler", "Hyper Cutter"], links: ["/pokemon/crabrawler"] },
  { label: "pokemon", path: "/pokemon/mr-mime", text: ["Mr. Mime", "Psychic", "Fairy", "Mime Jr.", "Mr. Rime"], links: ["/pokemon/mime-jr", "/pokemon/mr-rime"] },
  { label: "pokemon", path: "/pokemon/pecharunt", text: ["Pecharunt", "Poison", "Ghost", "Poison Puppeteer"] },
  {
    label: "pokedex list",
    path: "/pokedex",
    text: ["Bulbasaur"],
    links: ["/pokemon/bulbasaur", "/pokemon/mewtwo", "/pokemon/pecharunt"],
    minLinks: { prefix: "/pokemon/", n: 1025 },
  },
  { label: "pokedex study", path: "/pokedex/study", text: ["Pokédex"] },

  // Moves, abilities, items, places (lists and entries, long names)
  { label: "moves list", path: "/pokedex/moves", links: ["/pokedex/moves/thunderbolt", "/pokedex/moves/zippy-zap"], minLinks: { prefix: "/pokedex/moves/", n: 900 } },
  { label: "move", path: "/pokedex/moves/thunderbolt", text: ["Thunderbolt", "Electric", "Special", "90", "100", "15", "paralyze", "Pikachu"], links: ["/pokemon/pikachu"] },
  { label: "move", path: "/pokedex/moves/10-000-000-volt-thunderbolt", text: ["10,000,000 Volt Thunderbolt", "195"] },
  { label: "move", path: "/pokedex/moves/u-turn", text: ["U-turn", "Bug", "70", "switch"] },
  { label: "abilities list", path: "/pokedex/abilities", links: ["/pokedex/abilities/levitate"], minLinks: { prefix: "/pokedex/abilities/", n: 280 } },
  { label: "ability", path: "/pokedex/abilities/levitate", text: ["Levitate", "Ground", "Bronzong"], links: ["/pokemon/bronzong"] },
  { label: "items list", path: "/pokedex/items", links: ["/pokedex/items/leftovers", "/pokedex/items/master-ball"], minLinks: { prefix: "/pokedex/items/", n: 1150 } },
  { label: "item", path: "/pokedex/items/leftovers", text: ["Leftovers", "1/16", "Snorlax"] },
  { label: "item", path: "/pokedex/items/choice-scarf", text: ["Choice Scarf", "Speed"] },
  { label: "places list", path: "/pokedex/places", links: ["/pokedex/places/aether-house-alola"], minLinks: { prefix: "/pokedex/places/", n: 1050 } },
  { label: "place", path: "/pokedex/places/cobalt-coastlands-hisui", text: ["Cobalt Coastlands", "Hisui"] },
  { label: "types list", path: "/pokedex/types", links: ["/pokedex/types/fire", "/pokedex/types/fairy"] },
  { label: "type", path: "/pokedex/types/fire", text: ["Fire", "Water", "Grass", "Charizard"], links: ["/pokemon/charizard"] },
  { label: "type", path: "/pokedex/types/fairy", text: ["Fairy", "Dragon", "Steel", "Poison"] },
  { label: "natures", path: "/pokedex/natures", text: ["Adamant", "Modest", "Timid", "Jolly"] },

  // Trainers, games, movies, TCG, timeline, theories, sizes
  { label: "trainers hub", path: "/pokedex/trainers", links: ["/pokedex/trainers/red-blue"] },
  { label: "trainers game", path: "/pokedex/trainers/red-blue", text: ["Mt. Moon", "Brock"], links: ["/pokedex/trainers/red-blue/mt-moon"] },
  { label: "trainers area", path: "/pokedex/trainers/crystal/route-42", text: ["Route 42"] },
  { label: "trainer (notable)", path: "/pokedex/trainers/notable/brock", text: ["Brock", "Onix", "Geodude"] },
  { label: "video games list", path: "/pokedex/games", links: ["/pokedex/games/legends-z-a"] },
  { label: "video game", path: "/pokedex/games/legends-z-a", text: ["Legends: Z-A", "Lumiose"] },
  { label: "movies list", path: "/pokedex/movies", links: ["/pokedex/movies/mewtwo-strikes-back"] },
  { label: "movie", path: "/pokedex/movies/mewtwo-strikes-back", text: ["Mewtwo", "1998"] },
  { label: "tcg hub", path: "/pokedex/tcg", links: ["/pokedex/tcg/sv1"] },
  { label: "tcg set", path: "/pokedex/tcg/sv1", text: ["Scarlet & Violet"] },
  { label: "tcg card", path: "/pokedex/tcg/card/base1-1", text: ["Alakazam", "Damage Swap", "80"] },
  { label: "timeline", path: "/pokedex/timeline", text: ["Red", "Green", "1996"] },
  { label: "timeline entry", path: "/pokedex/timeline/red-green", text: ["Red", "Green", "1996"] },
  { label: "theories list", path: "/pokedex/theories", links: ["/pokedex/theories/cubone-wears-its-mothers-skull"] },
  { label: "theory", path: "/pokedex/theories/cubone-wears-its-mothers-skull", text: ["Cubone", "skull"] },
  { label: "sizes", path: "/pokedex/sizes", text: ["Pikachu"] },
  { label: "sizes item", path: "/pokedex/sizes/quagsire", text: ["Quagsire"] },
  { label: "sizes compare", path: "/pokedex/sizes/compare", text: ["compare"] },
  { label: "sizes preset", path: "/pokedex/sizes/starters", text: ["Bulbasaur"] },

  // Lab, story and history
  { label: "lab hub", path: "/lab", links: ["/lab/pokedex", "/lab/world-history", "/lab/pokemon-story"] },
  { label: "lab pokedex", path: "/lab/pokedex", text: ["Professor's Lab", "bring any Pokémon onto the holo-table"] },
  { label: "story hub", path: "/lab/pokemon-story", links: ["/lab/pokemon-story/cable"] },
  { label: "story chapter", path: "/lab/pokemon-story/cable", text: ["cable"] },
  { label: "history hub", path: "/lab/world-history", links: ["/lab/world-history/alola"] },
  { label: "history chapter", path: "/lab/world-history/alola", text: ["Alola"] },
  { label: "mass battle", path: "/lab/mass-battle", links: ["/lab/mass-battle/pikachu-vs-snorlax"] },
  { label: "mass battle preset", path: "/lab/mass-battle/pikachu-vs-snorlax", text: ["Pikachu", "Snorlax"] },
];

// ---------------------------------------------------------------------------------------------------------------
// A small HTML reader: enough to pull the head tags, the visible text and the anchors out of a page.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "template", "noscript", "textarea", "title", "svg"]);
const BLOCK = /^(address|article|aside|blockquote|br|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|button|label|option)$/;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", times: "×", middot: "·" };
export const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** { title, description, canonical, robots, h1s, text, links } from a page's HTML. */
export function readHtml(html) {
  const out = { title: "", description: "", canonical: "", robots: "", h1s: [], links: [], text: "", tokens: "" };
  const text = [];
  const tokens = [];
  let h1 = null;
  let a = null;
  const re = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m;
  const push = (s) => {
    if (!s) return;
    const t = decode(s);
    text.push(t);
    tokens.push(t, " ");
    if (h1 !== null) h1 += t;
    if (a !== null) a.text += t;
  };
  while ((m = re.exec(html))) {
    push(html.slice(last, m.index));
    last = re.lastIndex;
    if (!m[2]) continue; // comment
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!close && RAW.has(tag) && !/\/\s*$/.test(m[3])) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      const inner = end < 0 ? "" : html.slice(last, end);
      if (tag === "title" && !out.title) out.title = decode(inner).trim();
      last = re.lastIndex = end < 0 ? html.length : html.indexOf(">", end) + 1;
      continue;
    }
    if (close) {
      if (tag === "h1" && h1 !== null) {
        out.h1s.push(h1.replace(/\s+/g, " ").trim());
        h1 = null;
      }
      if (tag === "a" && a) {
        out.links.push(a);
        a = null;
      }
      if (BLOCK.test(tag)) push(" ");
      continue;
    }
    const at = attrs(m[3]);
    if (tag === "meta" && at.name === "description" && !out.description) out.description = at.content ?? "";
    if (tag === "meta" && at.name === "robots" && !out.robots) out.robots = at.content ?? "";
    if (tag === "link" && (at.rel ?? "").split(/\s+/).includes("canonical") && !out.canonical) out.canonical = at.href ?? "";
    if (tag === "h1") h1 = "";
    if (tag === "a" && at.href !== undefined) a = { href: at.href, text: "" };
    if (tag === "img" && at.alt) push(` ${at.alt} `);
    if (BLOCK.test(tag) || VOID.has(tag)) push(" ");
  }
  push(html.slice(last));
  out.text = text.join("").replace(/\s+/g, " ").trim();
  out.tokens = tokens.join("");
  return out;
}

/** The path of an internal href (same site), without query or hash; null for other sites and non-page links. */
function internalPath(href, base) {
  if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return null;
  try {
    const u = new URL(href, base + "/");
    const site = new URL(base);
    if (u.host !== site.host && !/(^|\.)playpokeiq\.com$/.test(u.host)) return null;
    return u.pathname.replace(/\/$/, "") || "/";
  } catch {
    return null;
  }
}

/** The distinct words of a text (lower case, letters and digits only), for comparing server and hydrated text. */
const words = (s) => [...new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))];

const norm = (s) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");

export function audit(route, html, base) {
  const r = readHtml(html);
  const paths = new Set(r.links.map((l) => internalPath(l.href, base)).filter(Boolean));
  const text = norm(r.text);
  const missingText = (route.text ?? []).filter((s) => !text.includes(norm(s)));
  const missingLinks = (route.links ?? []).filter((l) => !paths.has(l));
  let listed = null;
  if (route.minLinks) listed = [...paths].filter((p) => p.startsWith(route.minLinks.prefix) && p.length > route.minLinks.prefix.length).length;
  const words = r.text ? r.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  const listOk = !route.minLinks || listed >= route.minLinks.n;
  const head = { h1: r.h1s.length > 0, title: !!r.title, description: !!r.description, canonical: !!r.canonical };
  const content = missingText.length === 0 && missingLinks.length === 0 && listOk;
  return {
    label: route.label,
    path: route.path,
    ...head,
    h1Text: r.h1s[0] ?? "",
    h1Count: r.h1s.length,
    noindex: /noindex/i.test(r.robots),
    words,
    links: paths.size,
    listed,
    listNeeded: route.minLinks?.n ?? null,
    missingText,
    missingLinks,
    content,
    pass: head.h1 && head.title && head.description && head.canonical && words > 0 && content,
  };
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; PokeIQ-server-html-audit/1.0)", accept: "text/html" }, redirect: "follow" });
  return { status: res.status, html: await res.text() };
}

async function renderedCheck(routes) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const out = new Map();
  for (const route of routes) {
    try {
      await page.goto(BASE + route.path, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(1500);
      const { text, main, hrefs } = await page.evaluate(() => ({
        text: document.body.innerText + " " + document.body.textContent,
        // Every visible text node in <main>, each its own word boundary (as the server side's tokens are).
        main: (() => {
          const root = document.querySelector("main") ?? document.body;
          const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const parts = [];
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const el = n.parentElement;
            if (!el || el.closest("script,style,noscript")) continue;
            if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) continue;
            parts.push(n.textContent);
          }
          return parts.join(" ");
        })(),
        hrefs: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
      }));
      const t = norm(text);
      const paths = new Set(hrefs.map((h) => internalPath(h, BASE)).filter(Boolean));
      out.set(route.path, { mainWords: words(main), missingText: (route.text ?? []).filter((s) => !t.includes(norm(s))), missingLinks: (route.links ?? []).filter((l) => !paths.has(l)) });
    } catch (e) {
      out.set(route.path, { error: String(e).slice(0, 120) });
    }
  }
  await browser.close();
  return out;
}

const yes = (b) => (b ? "✓" : "✗");

function markdown(rows) {
  const lines = ["| Route | Page | h1 | title | desc | canonical | words | links | main content |", "|---|---|---|---|---|---|---|---|---|"];
  for (const r of rows) {
    if (r.error) {
      lines.push(`| ${r.label} | \`${r.path}\` | | | | | | | error: ${r.error} |`);
      continue;
    }
    const missing = [...r.missingText.map((s) => `"${s}"`), ...r.missingLinks.map((l) => `→${l}`)];
    const list = r.listNeeded ? ` (${r.listed}/${r.listNeeded} entries linked)` : "";
    const content = r.content ? `✓${list}` : `✗ missing ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` +${missing.length - 4}` : ""}${list}`;
    lines.push(`| ${r.label} | \`${r.path}\` | ${yes(r.h1)} | ${yes(r.title)} | ${yes(r.description)} | ${yes(r.canonical)} | ${r.words} | ${r.links} | ${content} |`);
  }
  return lines.join("\n");
}

async function main() {
  const routes = ROUTES.filter((r) => !ONLY.length || ONLY.some((o) => r.label.includes(o) || r.path === o));
  const rows = [];
  for (const route of routes) {
    try {
      const { status, html } = await fetchHtml(BASE + route.path);
      if (status !== 200) {
        rows.push({ label: route.label, path: route.path, error: `HTTP ${status}`, pass: false });
        continue;
      }
      const row = audit(route, html, BASE);
      if (RENDERED) Object.defineProperty(row, "serverWords", { value: words(readHtml(html).tokens), enumerable: false });
      rows.push(row);
    } catch (e) {
      rows.push({ label: route.label, path: route.path, error: String(e).slice(0, 120), pass: false });
    }
  }
  if (RENDERED) {
    const rendered = await renderedCheck(routes);
    for (const r of rows) {
      r.rendered = rendered.get(r.path);
      if (!r.rendered?.mainWords || r.error) continue;
      // Coverage: the share of the words on the hydrated page's <main> that the server HTML already has.
      const server = new Set(r.serverWords);
      const missing = r.rendered.mainWords.filter((w) => !server.has(w));
      r.coverage = r.rendered.mainWords.length ? Math.round((100 * (r.rendered.mainWords.length - missing.length)) / r.rendered.mainWords.length) : 100;
      r.clientOnly = missing.slice(0, 25);
      delete r.rendered.mainWords;
    }
  }

  if (MD) console.log(markdown(rows));
  else {
    for (const r of rows) {
      if (r.error) {
        console.log(`✗ ${r.path.padEnd(48)} ${r.error}`);
        continue;
      }
      const head = ["h1", "title", "description", "canonical"].filter((k) => !r[k]);
      const list = r.listNeeded ? ` list ${r.listed}/${r.listNeeded}` : "";
      const notes = [head.length && `no ${head.join(", ")}`, r.missingText.length && `missing text ${JSON.stringify(r.missingText)}`, r.missingLinks.length && `missing links ${JSON.stringify(r.missingLinks)}`].filter(Boolean);
      console.log(`${r.pass ? "✓" : "✗"} ${r.path.padEnd(48)} words ${String(r.words).padStart(6)} links ${String(r.links).padStart(5)}${list}${r.noindex ? " noindex" : ""}${notes.length ? "  " + notes.join("; ") : ""}`);
      if (r.rendered) {
        const rd = r.rendered;
        if (rd.error) console.log(`    rendered: ${rd.error}`);
        else if (rd.missingText.length || rd.missingLinks.length) console.log(`    not on the hydrated page as it first loads either (behind a pop-up, a tab or scrolling; or a wrong expectation): ${JSON.stringify([...rd.missingText, ...rd.missingLinks])}`);
        if (r.coverage !== undefined && r.coverage < 100) console.log(`    hydrated <main> words in the server HTML: ${r.coverage}%; only after hydration: ${r.clientOnly.join(" ")}`);
      }
    }
    const failed = rows.filter((r) => !r.pass).length;
    console.log(`\n${rows.length - failed}/${rows.length} pages pass`);
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
