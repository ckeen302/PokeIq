# Pokémon Hunt: team notes

A dated log for the three agents: requests, decisions and questions. Append new entries at the bottom of the log, newest last. Read it every time you sync. The contract is `docs/hunt/spec.md` and `src/lib/hunt/types.ts`.

Branches: integration `feat/pokemon-hunt`; data on `hunt/data`; design on `hunt/ui`. Merge `feat/pokemon-hunt` into your branch when you sync. The game agent merges yours in often.

## Log

### 2026-11-23 · pokemon hunt (game agent)

- Created `feat/pokemon-hunt` from main with the spec, the types and these notes.
- **Decisions:**
  - Regions fold the way PokéGuessr already folds them: Sevii → Kanto, Isle of Armor and Crown Tundra → Galar, Blueberry Academy → Unova. Kitakami is its own region (world map only: it has no region map).
  - A pin "found" its region when it lands in that region (the nearest place's region, as PokéGuessr's streak reads it). Scoring is the PokéGuessr curve to the nearest spot's area, `5000 / pins` per pin, pins matched to regions optimally.
  - The Daily Hunt starts today (`HUNT_DAILY_FROM`), runs on the world map and has no leaderboard (no new tables). The table it would need is in spec section 9.
  - Every round is timed at 1:30, like PokéGuessr's Daily.
  - The page is `/pokeguessr/hunt`, the API is `/api/geo/hunt` and `/api/geo/hunt/guess`, and the message namespace is `hunt`.
- **For hunt data:**
  - `src/data/hunt/answers.json` holds my hand-checked sample for now (`"sample": true`, 11 entries, including `52-alola` for a form test). It's yours: replace it whole with the real table in the same format.
  - Things I noticed while building the sample:
    - Many rows have no `a` field, but the place is pinned on the map under the same name in the version's region (Ballimere Lake, Timeless Woods, Route 9 Galar). Matching name + version region recovers them.
    - Z-A rows say "Bleu District", "Wild Zone 15", "Lysandre Labs", "The Sewers…", which count as Lumiose City.
    - Gen 7 Meowth rows carry no form note, but they're Alolan. Sword/Shield Route 4 Meowth is Galarian. So form notes can't be trusted to be present: forms need a per-game rule (a regional form is the only one found in its home games), not just the `n` note.
    - Mewtwo's X/Y spot (Unknown Dungeon) isn't on the map. Under rule 4 it's left out unless you can show it's inside a mapped place (it's reached from Pokémon Village). Your call: write down what you decide here.
  - Methods outside the brief's counted list that appear in the data: Poké Radar, Hidden Grotto, Island Scan, "Rare Spawns", Poké Flute (that one is the Snorlax fixed encounter). Please decide each one and write it down here.
- **For hunt design:** I'm seeding first versions of `HuntCard`, `HuntSetup`, `HuntRoundCard`, `HuntPinBar`, `HuntRevealPanel`, `HuntResults` and `src/messages/{hunt.ts,<locale>/hunt.json}` so the mode runs end to end. Once they're on the branch they're yours. The props in spec section 6 are the contract; the test ids listed there are what e2e uses.

### 2026-11-23 · hunt design (UI and UX)

- **I'm taking the presentation files now**, so please don't seed them: `HuntCard`, `HuntSetup`, `HuntRoundCard`, `HuntPinBar`, `HuntRevealPanel`, `HuntResults`, and `src/messages/{hunt.ts,<locale>/hunt.json}`. They follow the spec's names, props and test ids. If you've already written seeds, push them anyway and I'll merge mine over them. Extra parts I'm adding: `HuntState` (loading, error, empty), `map-marks.tsx` (pins and spot flags drawn on the map).
- **The map can now draw multiple pins.** I added optional props to `GeoMap`. Existing screens don't use them, so nothing changes for them.
  - `picks: (MapPin | null)[]`, `activePick: number`, `onPickSelect(i)`: numbered pins in the pin colours. Tapping on or right next to a placed pin calls `onPickSelect` instead of `onPick`, so players can pick a pin up from the map itself, not only from its chip. Pass `picks` instead of `pick`.
  - `spots` and `links`: the reveal's flags, each with a "game · method" tag, and each pin's dashed line to its spot. Both pop in after a delay.
- **Request for HuntGame: let `HuntRevealPanel` draw the whole reveal screen.** The map's pop-in timing and the panel's score count-up share one clock, and Skip has to stop both. So the panel needs to own the map as well. I'd like these props added, on top of the spec's:
  - `region: GeoRegionInfo`: the map that was played.
  - `round: HuntRoundPublic`: for the art, name and form.
  - `scores: number[]`: every round's score, this one last, for the score tracker.
  - `modeLine: string`: the line under the round number in the notch.
  - `onExit(): void`.

  Please also **don't bind Space or Enter during the reveal.** The panel does that itself: the first press skips the animation, the next one goes to the next round.
- The round itself is GameShell + `HuntRoundCard` as the picture + `MapDock` with `HuntPinBar` as `extra`, as the spec says. Please copy PokéGuessr's round layout from `GeoGame.tsx`'s `guessViewOf`. It covers desktop (notch, CountdownPill, ScoreTracker / RoundReadout) and phone (HudDials, RoundBadge, bottom-bar tools).
- `HuntPinBar` handles keys 1–3 (pick a pin) and Delete/Backspace (remove the picked one) itself. Pins are numbered by slot. With the spec's `placed: number` props, removing a middle pin shifts the later ones down. That works fine.

### 2026-11-23 · hunt data (accuracy)

- **First full table is on `hunt/data`** (`src/data/hunt/answers.json`, built by `npx tsx scripts/hunt/build.ts`). Verification against Bulbapedia and Serebii is in progress; results will go in `docs/hunt/verification.md`. Everything left out, with the reason, is in `src/data/hunt/review.json`.
- **How a row becomes an answer** (code in `scripts/hunt/`):
  - Versions decide the regions (`rules.ts` `VERSION_REGIONS`, same as `VERSIONS[].regions`). I don't trust the stored `a` field: it was built against an older map. I re-match every row by name inside the version's regions. Steps: exact name, then the name without a "(sub-area)", then a short hand-checked alias table, then without "Sea " ("Sea Route 41"), then without a region prefix ("Johto Safari Zone"). Two hits at any step = uncertain, so the Pokémon is left out.
  - A building (a place with `parent`) counts as its parent's pinned place (Kitakami Hall → Mossui Town, White Forest → Black City / White Forest, Ramanas Park → Route 221), so every answer is a pinned place.
  - Legends: Z-A: every place outside Hyperspace is Lumiose City. Legends: Arceus: left out.
- **Method decisions** (`rules.ts` `METHODS`):
  - Counted: Poké Radar (grass on that route), Hidden Grotto (a fixed spot), "Rare Spawns" (LGPE grass and sky spawns), DexNav (grass), Swarms, Berry trees (like Headbutt), the XY and SwSh ambushes (Overworld), Poké Flute, Devon Scope, Squirt Bottle and Wailmer Pail (all "Fixed encounter").
  - Left out: Island Scan (a once-a-day scan, not a spot), the Gen 4 dual-slot rows, roamers (a whole region, no one spot), Ultra Space, Pal Park.
  - Max Raid counts only in Sword / Shield.
  - An unknown method label makes the row uncertain.
- **Mewtwo:** X/Y's Unknown Dungeon is a cave inside Pokémon Village, so it counts as Pokémon Village. I'm checking this against Bulbapedia during verification and will drop it if it doesn't hold.
- **Forms** (`forms.ts`):
  - Gens 1–6, Let's Go and BDSP only have the original form in the wild.
  - A species whose regional forms all came out after the game is its original form there (Wooper in Sword / Shield).
  - Otherwise the row's note decides, or Bulbapedia's form tag at that place in that game (kept in `scripts/hunt/evidence/forms.json`).
  - No tag, or a note that disagrees with Bulbapedia, makes the row uncertain, and that Pokémon's forms are left out.
  - Paldean Tauros is three entries: `128-paldea-combat`, `128-paldea-blaze`, `128-paldea-aqua`.
  - Left out because the form depends on the spot in a way the data doesn't record: Burmy, Wormadam, Shellos, Gastrodon, Vivillon, the Flabébé line, Oricorio.
- **Difficulty** (`difficulty.ts`): "land" is every 28 px map square within two squares of any place's area. For each region r of an entry, s_r = the share of land within 60% scoring distance of one of its spots in r. World difficulty = 1 − the mean of the p largest s_r, with p = `huntPinsFor`, because each pin has to find its own region. Region difficulty = 1 − s on that region's crop, with one pin. Values cluster around 0.89–0.97 because one spot covers a small part of the world, so deal by rank (thirds), not by fixed cut-offs.
- **`everywhere`:** 6+ regions, or 4+ regions with difficulty under 0.91.
- **For pokemon hunt (game):**
  - The Kanto crop holds only `Kanto`, so Sevii Islands spots aren't on the Kanto region map. The Unova crop also leaves out Blueberry Academy. `regionDifficulty` only has a region when the entry has a spot on that crop. Please deal Region mode only from entries that have `regionDifficulty[region]`, and draw only spots inside the crop.
  - Rule 4 is strict, and the map is missing real places: Torchlit Labyrinth, Alfornada Cavern, the Paldean seas, Brawlers' Cave, Alola Routes 4, 6 and 17, Kalos Routes 2, 3 and 22, and Hoenn's sea Routes 107, 129 and 131. Each one keeps Pokémon out of the table. The ranked list is `missingPlaces` in `review.json`, for whoever owns the map.
  - Rows the data folded into "Most fishable water" (Gen 1–7 fishing in many places) can't be mapped, so those fishing Pokémon are left out for now.

### 2026-11-23 · pokemon hunt (game agent), after the first merges

- Merged `hunt/ui` and `hunt/data` into `feat/pokemon-hunt`.
- **Design:** I took your components as they are and deleted my seeds (`HuntSetup`, `HuntRoundCard`, `HuntPinBar`, `HuntRevealPanel`, my `src/lib/hunt/share.ts`). I also dropped my `delay`/`caption` additions to `GeoMap` in favour of your `picks`/`spots`/`links`.
  - Your requested `HuntReveal` props are all wired (region, round art, scores, modeLine, onExit). I don't bind Space/Enter during the reveal. Space hunts during a round, as PokéGuessr's Guess does.
  - Spec section 6 now lists your real component names and test ids. `scripts/e2e-hunt.mjs` uses them, so please keep these stable: `hunt-hub-entry`, `hunt-play-*`, the region radios inside `hunt-region-picker`, `hunt-card`, `hunt-pin-chip-<n>` with `data-placed`, `hunt-skip`, `hunt-spot`, `hunt-found-line`, `hunt-next`, `hunt-results-total`, `hunt-share-grid`, `hunt-share-button`.
  - The server now sends each spot's `methods: { games, method }[]` alongside `labels`. `HuntGame` turns a spot into one `HuntRevealSpot`, with its games joined by " / " and its methods by ", ". If you'd rather have one row per game and method, tell me and I'll pass the list through.
  - **Translations:** your `en/hunt.json` replaced my keys, so I removed my five translations (they no longer matched). The page is English-only (not in `ALL_LANGUAGES`), and the hub banner only shows on English pages until you add `de/es/fr/it/ja` hunt.json. Then add `/pokeguessr/hunt` to `ALL_LANGUAGES` and drop the `t.locale === "en"` check in `GeoGame.tsx`, or ask me to.
  - The page title and description use `name` and `hub.tagline`. Add `meta.title`/`meta.description` if you want different ones, and I'll switch.
  - A form tag: `HuntRoundPublic` has no separate form label. The name already carries the form ("Alolan Meowth"). If you want `form` for the tag, I can add the entry's form to the round.
- **Data:** Region mode now follows your request. It deals only entries with `regionDifficulty[region]` and reveals only the spots on that region's crop (tested for all nine maps). Please add `tests/hunt-data*.test.ts` when you can. My `tests/hunt-game.test.ts` already checks that every place in the table is a pinned map place (`huntTableProblems()` is empty).


### 2026-11-23 · pokemon hunt (game agent): first e2e pass

- `scripts/e2e-hunt.mjs` passes locally on a production build: Classic (with pin move, remove and pick-up), Region (Galar), and the Daily on a phone (share grid, same Daily for two players). It also runs from `E2E_ONLY=hunt node scripts/e2e-smoke.mjs`.
- **For hunt design:**
  - **Found ticks disagree.** In `HuntReveal`, a region gets a ✓ when any pin scored against one of its spots. The server's "found" means the pin landed in that region. So a pin in the sea next to Paldea shows ✓ Paldea next to "No regions found this time". Please add `found: boolean` to `HuntRevealPin` and tick from it. The server already sends it per pin, and I'll pass it through as soon as the field exists.
  - Some parts are drawn twice (phone and wide copies), for example `hunt-found-line`, `hunt-next` and `hunt-dex-link`. That's fine. e2e picks the visible one.
- **For hunt data:** the fallback fact ("Every Capsakid in the wild lives in one region.") is weak. If you can add a `fact` per entry from the data (only spot, first game, rarest method), the reveal gets much better.
