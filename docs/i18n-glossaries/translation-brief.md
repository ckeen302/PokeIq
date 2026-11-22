# Brief for the PokéIQ translation helpers (read fully before starting)

PokéIQ (Next.js 15, repo checked out in your worktree) is getting Japanese (ja), Spanish (es), French (fr), German (de)
and Italian (it). English stays at the root, unchanged; other languages are served at /<lang>/… from the same English
page modules (src/app/[locale]/** are generated mirrors — don't edit them). Your job: make every word of the files you
own come from message namespaces, and write the five translations. Read docs/i18n.md first (conventions), then study
these finished examples:
- client component: src/components/layout/MobileTabBar.tsx, src/components/home/TodaySection.tsx (useT, keys in tables)
- server component/page: src/app/privacy/page.tsx, src/app/credits/page.tsx, src/app/page.tsx (serverT, t.rich,
  generateMetadata, <ClientMessages namespaces={[…]}> around client components)
- pure lib function that returns text: src/components/home/today.ts (takes an optional translator, defaults to English
  so existing tests keep passing)
- name matching in any language: src/lib/names/fold.ts, src/lib/names/species.ts (server: speciesName/speciesAliases),
  src/components/pokedle/search.ts (NameEntry's 4th element = aliases), tests/i18n-names.test.ts
- messages: src/messages/{nav,home,site}.ts and src/messages/<locale>/*.json

## Setup in your worktree
- `cp -al /home/user/PokeIq/node_modules ./node_modules` (hard-link copy; do NOT run npm install/ci).
- Env for tests: POKEIQ_SECRET=ci-only-secret-not-used-anywhere-else POKEIQ_LOCAL_ACCOUNTS=1 POKEIQ_TCG_FIXTURE=1
- Do NOT run `next build`, `npm run build`, `next start`, dev servers or e2e: the machine has 4 cores shared by six
  helpers and the coordinator, who runs builds and compares every English page against main afterwards.
- Checks you run: `npx tsc --noEmit`, `npx eslint <your files>`, `node scripts/i18n/check-messages.mjs`,
  `npx vitest run <the tests touching your files>` (and tests/i18n-*.test.ts).

## Hard rules
1. English output must stay EXACTLY the same: same text, same markup, same element order, same attributes. Put the
   exact English text in src/messages/en/<ns>.json (JSX collapses a line break + indentation into ONE space; `&apos;`
   is `'`; `{" "}` is a space). Where old code printed `${n}` (no thousands separator) use `{n}`, not `#` (which groups:
   1,234). Plural messages in English: `{n, plural, one {# win} other {# wins}}` only where the old code grouped
   numbers (toLocaleString) — otherwise `{n, plural, one {{n} win} other {{n} wins}}`.
   Keep a component synchronous (never make a server component async just to translate: serverT is synchronous).
   Never change behaviour, styling, data, URLs or tests' expectations for English.
2. Namespaces: name them after your area (e.g. "pokedle", "pokedle-duel"). Split them by where they are used: text
   only server components show (page metadata, GameInfo how-to/FAQ, headings) goes in a server namespace; client
   components get their own namespace(s), as small as is natural, so a page's browser bundle carries only what it shows.
   Add every namespace you create to src/i18n/namespaces.ts (keep the list sorted, one per line).
3. Pages you own that render client components using your client namespaces: wrap them in
   `<ClientMessages namespaces={[…]}>` (from @/i18n/ClientMessages). Pages convert `export const metadata` to
   `export function generateMetadata(): Metadata { const t = serverT(ns); … }`.
4. Do not edit files you don't own (listed in your task). If you need something from a shared file, write it in your
   final report instead. Never edit src/app/[locale]/**, src/i18n/routes.ts, next.config.ts, CI files.
5. Text built in lib functions (results, clue labels, share text, error messages shown to players): pass a translator
   (`Translator<typeof ns.en>`, default English) or return keys/structured data the component translates.
6. Pokémon names, types, moves, abilities, items, colours, regions, locations and games shown in the UI must appear in
   the page's language using official names: species via @/lib/names/species (server) or names sent from the server
   as props; the rest from src/data/i18n/<locale>/<kind>.json (keys: English name lowercased, letters+digits only).
   Load other languages' data ONLY on the server or for the page's own language: never import all languages' data
   into a client bundle, and an English page must not load any of it. A guess box on a non-English page must accept the
   language's official names AND the English names (and for Japanese: katakana, hiragana and rōmaji, via the aliases).
7. API routes: don't change them. Error strings that come from the server can stay English for now; list them.

## Translation quality (this ships to real players)
- Natural, idiomatic, concise UI text a native player would write — not literal word-by-word translation.
  Spanish (Spain, tú), French (tu), German (du), Italian (tu), Japanese (です・ます; short game-UI phrasing; katakana
  game terms as the official Japanese games use them).
- Official Pokémon terminology per language (look terms up in src/data/i18n/<locale>/*.json): e.g. type names,
  "Pokédex" (ja ポケモン図鑑/図鑑), "Trainer" = Entrenador / Dresseur / Trainer / Allenatore / トレーナー,
  "Gym Leader" = Líder de Gimnasio / Champion d'Arène / Arenaleiter / Capopalestra / ジムリーダー, generation =
  generación / génération / Generation / generazione / 世代 (第1世代).
- Brand names never change: PokéIQ, Pokédle, PokéGuessr, Pikadoku, PokéConnections; nav-style short labels
  Wordle/Connections/Sudoku/Guessr stay as is.
- Site rules in every language: no "N things" counts in copy (e.g. never "1,025 Pokémon to guess"), no invented data,
  never the word "Olympic" (or Olímpico, olympique, olympisch, olimpico, オリンピック), and PokéGuessr must never name or
  hint at a place before the reveal. Don't fake leaderboard scores.
- Keep the length close to English for buttons/labels (UI may be tight); German/French run long — prefer shorter
  natural wording. Japanese: no spaces between words, use 、。 punctuation and full-width （） only where natural.
- Mark anything you are unsure of (especially Japanese) in your final report.

## Commits
- Commit on your worktree's branch as you finish coherent pieces. The repo's git identity is already configured;
  plain `git commit -m "Languages: <area> …"`. No Co-Authored-By or other trailers, no mention of AI.
- Don't push, don't open PRs, don't merge.

## Final report (your last message; the coordinator merges your branch)
Your branch name and last commit; namespaces created; pages that are now fully translated (English path patterns,
e.g. "/pokedle", "/pokedle/duel/*"); anything still English and why; shared-file changes you need; translations you are
unsure of; tests you added or ran and their results.

## Step 2+ additions (read: lessons from Step 1)
- FIRST in your worktree: `git reset --hard feat/i18n-shell` (worktrees are created from main, which lacks the i18n code). Only do this before you have commits of your own.
- English pages must not get heavier. The build inlines each `t("key")`'s English at the call (scripts/i18n/inline-loader.cjs) and drops the
  whole namespace from the bundle only when EVERY use of that translator can be inlined. Keep it inlinable:
  * call `t("literal.key")`, `t(cond ? "a" : "b")` or `t(\`prefix.${id}\`)` directly; `t.locale` is fine;
  * a helper that takes a translator must type its parameter exactly `Translator<typeof ns.en>` (or a type alias of it) and only call it the same way;
  * don't call `t.has`, store `t` in refs/objects/state, or pass it to anything else — that ships the whole namespace;
  * keep namespaces small and per component group; never make a page import a module it didn't import before (check `git diff main -- <file>` imports);
  * don't put several components that different pages use into one "use client" file if that drags text or code onto pages that don't show it;
  * code only other languages need (local name maps, lexicons, alias search, Intl formatting that English didn't do) must not load on English pages:
    put it behind `if (locale !== "en") import(...)`/next/dynamic, or have the server send ready-made data only to non-English pages.
- Server components and API changes: a request's language comes from `?lang=` via src/lib/server/request-lang.ts `langOf(request)` (only live languages count; English otherwise), so production English is unchanged.
- Pokédex entries and move/ability/item descriptions per language (server-only data): src/data/i18n/<locale>/texts/{species,moves,abilities,items}.json ({ id: [{text, versions}] }, newest first; species only up to Gen 8).

## Step 3 additions
- FIRST in your worktree: `git reset --hard feat/i18n-step2` (not feat/i18n-shell), only before you have commits of your own.
- More finished examples now exist: src/app/leaderboard/view.tsx (big server view, serverT + t.rich + localMap), src/components/community/QuizBests.tsx
  (server, mode names via quiz-modes, category names via a locale check), src/components/community/FriendsPanel.tsx (a lazily loaded panel that
  fetches its own language's JSON), src/lib/geo-i18n.ts (name helpers that return English untouched on English pages).
- Reference data per language is in src/data/i18n/<locale>/ (names: types, moves, abilities, items, regions, locations, games, natures, egg groups,
  colours, … — `ls` it) and texts/{species,moves,abilities,items}.json (descriptions/flavour text). Use what exists; never invent official names.
  If a name has no official translation in the data, keep the English one (don't make one up) and list it in your report.
- Pages with hundreds of generated entries (one per Pokémon, move, card, place …): in your report, for each such route say how much of a page
  becomes genuinely translated content in each language (e.g. "species page: name, genus, types, abilities, flavour text in all 5; Gen 9 species
  have no flavour text in es/fr/de/it/ja so they are mostly numbers + names"), so the coordinator can decide which language pages get indexed.
  Don't change robots/sitemap/canonical code yourself.
- Big JSON lists sent to the browser (explorers with every Pokémon/move): an English page must send exactly what it sends today. For other languages
  send the localized names from the server as props/fields (only that language), never ship all languages.

## Step 4 additions (long-form content)
- Long-form text (articles, chapters, event write-ups, theories, game/movie summaries) lives in data/lib files, not in UI messages. Translate it
  into per-language content files, e.g. src/data/i18n/<locale>/content/<area>.json keyed by the English entry's id/slug (never by position), holding
  only the translated text fields. Keep the English data files exactly as they are. Load a language's content only on the server (or via a
  dynamic import of that one language's file in the browser if a client component needs it) — English pages must not load any of it.
- Write real, fluent prose in each language (native-quality, faithful to the English facts; don't add or drop facts, dates, numbers or claims).
  Official Pokémon names for species, moves, places, games, characters (Japanese: official katakana/kanji names; e.g. Ash = サトシ, Professor Oak =
  オーキド博士, Team Rocket = ロケット団; es/fr/de/it: the official localized names — e.g. Professor Oak = Profesor Oak / Professeur Chen /
  Professor Eich / Professor Oak; Team Rocket = Team Rocket in all four). Movie titles: official localized titles where they exist (else English).
  Mark any official name you're not sure of in your report.
- UI chrome around the content (headings, buttons, labels, metadata) goes in message namespaces as in earlier steps.
- These pages are the site's SEO content: translate the page metadata (title/description) and JSON-LD text too, and say in your report which
  entries are complete in every language (the coordinator only indexes a page whose main text is fully translated).
- Very large files: work through them entry by entry and commit as you go (one commit per area per language is fine). Check every content file
  covers every id the English has (write a small test in tests/ that fails on a missing or extra id).

## Step 5 additions (Battle, share images, email/Discord)
- FIRST: `git reset --hard feat/i18n-step2` (it now contains Steps 1–4 work so far), only before you have commits of your own.
- Battle names: Pokémon, moves, abilities, items, types, natures, stats in the official names of the page's language (src/data/i18n, src/lib/dex/local.ts
  `dexLocal(locale)` server-side, or names sent from the server). Pokémon Showdown format names ("[Gen 9] Random Battle", "OU", "Ubers", tiers)
  are proper names: keep tier/format codes as they are, translate only our descriptive words around them ("Random Battle" → the language's usual
  term is fine where we print our own label). Battle log lines ("Pikachu used Thunderbolt!", "It's super effective!") should read like the official
  games in that language; write them as ICU messages with the names as arguments (Japanese games style: 「ピカチュウの 10まんボルト！」 is fine as
  ピカチュウの10まんボルト！ without the game's half-width spacing).
- The battle server (src/lib/server/battle-engine/**) and API routes: don't change behaviour. If the client builds text from protocol lines, translate
  on the client; if the server sends English sentences, list them (don't translate server-side unless it already has a `langOf(request)` path).
- Teams, sets and pokepaste import/export stay in Showdown's English format (that's an interchange format) — only display names are localized.
