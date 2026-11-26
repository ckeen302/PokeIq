# Pokémon Hunt: spec and contract

Pokémon Hunt is a PokéGuessr mode. Each round shows one Pokémon in one exact form (its official art and its name) and asks "Where would you catch Gible?". You drop one pin on the PokéGuessr map, scored by its distance to the nearest real spot. It plays in the same frame, map dock, 1:30 timer and score tracker as PokéGuessr (`src/components/geo/*`), and ends on the same end screen.

**Hunt v2 (2026-11-26)** rebuilt it: one pin a round, PokéGuessr's own scoring curve, only normal wild encounters in the answers, hints that cost points, the setup opened in place on PokéGuessr's landing, Classic's end screen and a Daily Hunt leaderboard. This file describes v2; NOTES.md has the history.

This file and `src/lib/hunt/types.ts` are the contract between the three agents. Changes to either go through the game agent ("pokemon hunt"). Ask in `docs/hunt/NOTES.md`.

## 1. File ownership

| Owner | Files |
| --- | --- |
| **pokemon hunt** (game, integrator) | `src/lib/hunt/**` (types, scoring, matching, share text), `src/lib/server/hunt.ts`, `src/app/api/geo/hunt/**`, `src/app/pokeguessr/hunt/**` (and its generated `[locale]` mirror), `src/components/hunt/HuntGame.tsx` and `src/components/hunt/use-*.ts` (state, timer, pins, API calls), the one-line hub entry in `src/components/geo/GeoGame.tsx`, `tests/hunt-game*.test.ts`, `scripts/e2e-hunt.mjs`, `docs/hunt/spec.md`, this contract |
| **hunt data** (accuracy) | `scripts/hunt/**`, `src/data/hunt/**` (the answer table `answers.json` and any reports), `tests/hunt-data*.test.ts` |
| **hunt design** (UI, UX) | every other file in `src/components/hunt/**` (the presentation components listed in section 6), `src/messages/hunt.ts` and `src/messages/<locale>/hunt.json` (all six languages), `docs/hunt/mocks/**` |

`docs/hunt/NOTES.md` is shared: anyone appends, nobody rewrites someone else's entry.

The game agent seeds the first version of the presentation components and the message files so the mode runs end to end on day one. From then on they belong to hunt design; the game agent asks for changes in NOTES.md rather than editing them (small compile fixes during a merge excepted, noted in NOTES.md).

## 2. Regions

`HUNT_REGIONS`: kanto, johto, hoenn, sinnoh, unova, kalos, alola, galar, paldea, kitakami.

Places in `src/data/geo.json` fold into these the way PokéGuessr already folds them (`HUNT_REGION_OF_GEO`): Sevii Islands count as Kanto; Isle of Armor and Crown Tundra as Galar; Blueberry Academy as Unova. Kitakami is its own region. It has no region map, so it only comes up in world-map modes.

A free hunt can be played on the nine regions with a map (`HUNT_MAP_REGIONS`, the `world.crops` in geo.json).

## 3. Accuracy rules (the answer table must meet all of them)

1. **Only normal wild encounters count** (v2).
   - Counted: grass (and every game's kinds of tall grass), caves, surfing, fishing with a rod, and the Pokémon seen wandering the overworld.
   - Left out: Poké Radar, DexNav, Hidden Grottoes, berry trees, Headbutt, Rock Smash, honey trees, hordes, SOS calls, Unova's rustling grass, dust clouds and rippling water, diving, ambushes, bridge shadows, swarms, Max Raids, every scripted or fixed one-off meeting (Static, Interact, the Poké Flute…), legendary and mythical Pokémon, and, as before, anything that isn't a spot on the map (Tera Raids, Hyperspace Lumiose, the Grand Underground, Friend Safari, curry, trades, eggs, events, evolution, HOME, gifts).
2. **Match by game and name, never by name alone.** "Route 1" exists in five regions. A row's versions decide its region (`VERSIONS[].regions` in `src/lib/pokemon/encounter-types.ts`); the `a` field ("Area · Region") decides the place. Legends: Z-A's districts and Wild Zones count as Lumiose City (Kalos). Legends: Arceus (Hisui) isn't on the map, so it's left out.
3. **Regional forms are separate entries** with their own answers (`52` Meowth, `52-alola` Alolan Meowth, `52-galar` Galarian Meowth). `art` always shows that exact form.
4. **An entry is only in the table if every one of its places is on the map**, so a correct pin can never score zero. (Places that are left out by rule 1 don't count against this. A real place that is missing from the map does: the Pokémon is left out.)
5. **Matching is automatic, but anything uncertain is left out, never guessed.**
6. **Blind verification** against Bulbapedia and Serebii, weighted to rare Pokémon; every mismatch fixed; tests prove every answer is a real map place in the right region for its game, with no form mix-ups.

## 4. The answer table: `src/data/hunt/answers.json`

Format: `HuntAnswerFile` in `src/lib/hunt/types.ts`. One `HuntEntry` per species and form.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-11-23",
  "entries": [
    {
      "id": "143", "dex": 143, "form": null, "name": "Snorlax", "art": 143, "slug": "snorlax",
      "regions": ["kanto", "kalos", "alola", "galar"],
      "places": [
        { "region": "kanto", "geoRegion": "Kanto", "name": "Route 12", "pin": [0.7123, 0.5012],
          "methods": [{ "versions": ["red", "blue", "yellow"], "games": "Red / Blue / Yellow", "method": "Fixed encounter" }] }
      ],
      "difficulty": 0.42,
      "regionDifficulty": { "kanto": 0.3 },
      "famous": true
    }
  ]
}
```

- `places[].geoRegion` and `places[].name` must name a pinned place in `geo.json` `world.locations` exactly (a place with a `pin`, not a building with a `parent`). The server looks the area (mask) up from there and refuses to start if one is missing.
- `pin` is copied from geo.json so tests can check the table without the server.
- `regions` equals the set of the places' regions, in `HUNT_REGIONS` order.
- `methods[].games` and `methods[].method` are the reveal's labels: "Red / Blue · Super Rod". The method names are `COUNTED_LABELS` in `scripts/hunt/rules.ts`: Grass, Cave, Surf, Old Rod, Good Rod, Super Rod, Fishing, Overworld, and Wild (a place both sources list without naming the method).
- `types`: the form's types (the type hint). `home`: the region of the games it was introduced in (a regional form's, that region), when it lives there.
- `difficulty` (0 easy – 1 hard) is measured on the world map with one pin: 1 − the share of the world map's land where a pin would score at least 60% against the nearest spot. `regionDifficulty[r]` is the same on region r's own map.
- `famous`: a famous Pokémon at the spot its home region is known for (hand-picked in `scripts/hunt/famous.ts`, each one checked against the answers). Easy deals these.
- `everywhere`: found so widely there's no real "where" (6+ regions, 13+ places, or a difficulty under 0.92). Never dealt on the world map.
- `fact`: optional English one-liner drawn from the data ("Only found in Cerulean Cave, in five different games."). Never invented. Without one, the game writes a line from the places.

Until the full table lands, `answers.json` holds the game agent's hand-checked sample (`"sample": true`). Hunt data replaces it whole.

## 5. The game

### Where it's played
- PokéGuessr's landing: the **Pokémon Hunt tile opens the hunt's setup in place**, as the Classic tile opens the solo setup (a button with `aria-expanded` and `aria-controls="hunt"`; the section is `#hunt`). `/pokeguessr#hunt` opens it too; that's where shared hunts link.
- `/pokeguessr/hunt` still shows the same setup, for old links.
- A hunt plays over the page in PokéGuessr's frame (on the page's body; the landing is inert under it).

### The setup (`HuntSetup`)
- **Daily Hunt**: the world map, the same five Pokémon for everyone each day (seed `hunt-daily:<date>`), always Normal; today's board beside it when the board's table exists.
- **Free hunt**: the map (the world, or one of the nine regions with a map), the difficulty, Play.
  - **Easy**: famous Pokémon in their home region (on a region's map, that region's own; topped up from the easiest when a region has too few).
  - **Normal**: one famous (else from the easiest third), two from the middle third, one from the hardest third, one from anywhere.
  - **Hard**: any Pokémon that can be dealt, the world map only, no hints.
- A dealt Pokémon has a real "where": a few distinct places (2 at least, unless it's famous; on a region's map 12 at most), never `everywhere` on the world map. Played easy → hard, one form of a species at most; free play avoids the player's recent Pokémon.

### A round
- The card: the art, "Where would you catch **Gible**?", a form tag, and on a region's map its name.
- **One pin**, as PokéGuessr: tap to drop it, tap again to move it. Guess (or Space) once it's down. 1:30 on the clock.
- **Hints** (`HUNT_HINTS`, `HUNT_HINT_COSTS`), each with its cost on its button: its **type** (−500), the **kind of place** (grass, caves, water, out in the open; −750), its **games** on the map played (−1,000). The server answers a hint and records it in the game's token, and takes the cost off the round's points (never below zero). Hard has none.

### Scoring (server, `src/lib/hunt/score.ts`)
- The pin scores against the **nearest real spot**: the distance to that place's area (0 inside it).
- On **PokéGuessr's own curve** (`geoCurveScore` in `src/lib/geo-curve.ts`, which PokéGuessr's grading uses too): 5,000 within half a town-map square, else `5000 · e^(−10 · d / D)`.
- D is the diagonal of the nearest spot's region's own map (`huntScales`; Kitakami, with no map, takes the mean), so a pin is scored exactly as PokéGuessr scores one on that region's map, on the world map too. On the spot is 5,000; a couple of squares off keeps most of it; the right region alone earns little.
- Then the hints' costs come off.

### Secrecy
- The client never receives places, regions or the entry list before a round is graded. A round carries only the Pokémon (id, name, art) and the hints it offers (`HuntRoundPublic`). A hint carries only its answer.
- The game state is a signed token holding a sealed plan, as PokéGuessr's.
- A hint also holds a single-use claim on the round (`<round claim>:hint:<kind>`): a guess sent with an older token that doesn't carry the hint is charged for it all the same.

### The reveal
1. The pin's dashed line draws to the nearest real spot (PokéGuessr's flag and area), then every other spot pops in region by region, tagged with its games and method ("Red / Blue · Super Rod").
2. The bar: the score, how far the pin was ("2.4 squares away"), the nearest spot, what the hints cost, a one-line fact, and the Pokédex link (`/pokemon/<slug>#encounters`).

### Results
- Classic's end screen (#367, `EndScreen`): the total out of 25,000 over the dimmed map, the bar, BREAKDOWN (the whole map with each round's pin and its numbered flag on the nearest spot, the best round green and the worst red; a round picked in the tracker frames it and brings in all its other spots) and NEXT.
- Daily: the share card (a square per round: 🟩 80%+ of 5,000, 🟨 40%+, 🟧 some, 🟥 none; never a Pokémon or a place; it links to `/pokeguessr#hunt`) and today's board with a name field.

## 6. Screens (`src/components/hunt/*`)

| Screen | Component |
| --- | --- |
| The setup (landing and `/pokeguessr/hunt`) | `HuntSetup`, inside `HuntGame` |
| A round | `HuntRound`: `HuntCard` (the Pokémon and the question) with `HuntHints`, PokéGuessr's HUD and `MapDock` |
| The reveal | `HuntReveal` |
| Results | `HuntResults` (`EndScreen`) with `HuntEndBoard` on the Daily |
| Loading, error | `HuntState` |

Test ids the e2e script relies on: `hunt-hub-entry` (the landing's tile), `hunt-setup`, `hunt-map-picker` (radios with `data-map`), `hunt-difficulty` (radios with `data-difficulty`), `hunt-play`, `hunt-play-daily`, `hunt-card`, `hunt-question`, `hunt-name`, `hunt-hints`, `hunt-hint-<kind>` (with `data-taken`) and `hunt-hint-<kind>-value`, `hunt-reveal`, `hunt-skip`, `hunt-spot` (with `data-nearest`), `hunt-found-line`, `hunt-hint-cost`, `hunt-dex-link`, `hunt-next`, `hunt-results`, `hunt-results-focus`, `hunt-again`, `hunt-share`, `hunt-share-button`, `hunt-board`, `hunt-board-row`, `hunt-end-board`, `hunt-board-name`, `hunt-board-save`. Plus PokéGuessr's `geo-shell`, `geo-map`, `geo-guess`, `geo-map-pill`, `geo-exit`, `geo-breakdown-toggle`, `geo-end-round-<n>`, `geo-flag-number`.

Messages: one namespace, `hunt` (`src/messages/hunt.ts`, `src/messages/<locale>/hunt.json`, all six languages).

## 7. API

- `POST /api/geo/hunt` `{ mode, region?, difficulty?, date?, recent?, name? }` → `HuntStartResponse`. A Daily this device has already started (its cookie) plays as practice.
- `POST /api/geo/hunt/hint` `{ token, hint, locale? }` → `{ token, hint, cost, hints }`.
- `POST /api/geo/hunt/guess` `{ token, pins: [pin], timeout? }` → `HuntGuessResponse`. Each round is graded once; an identical retry gets the same answer back. The last round of a first Daily carries a signed result for the board.
- `GET /api/geo/hunt/leaderboard?date=` → `{ available: true, rows }` or `{ available: false }`; `POST` `{ resultToken, playerName }` → `{ saved: true }`.

## 8. Tests

- `tests/hunt-game.test.ts`: scoring (PokéGuessr's curve, nearest spot, the region's scale), hint costs (on the server, and through an older token), dealing (Easy, Normal, Hard; a real "where"; the Daily the same for everyone), secrecy, the board's signed result.
- `tests/hunt-data.test.ts`: every place is a pinned map place in the right region for its versions, forms are separate, only counted methods (the rules filter), the committed table is the build's.
- `scripts/e2e-hunt.mjs`: the landing's tile and setup, Normal with a hint, Easy on a region, Hard, the Daily on a phone with its share card and board; and `E2E_ONLY=hunt` in `scripts/e2e-smoke.mjs`.

## 9. The Daily's leaderboard

One table, `hunt_daily_scores` (`supabase/migrations/0057_hunt_daily.sql`), in geo_runs's pattern: one row per game (`daily_date`, `session_id`) and per name a day, written only by the server from a signed result, with the board guards PokéGuessr's board uses (a few entries per address a day, a believable time, a Daily played again never signed). Read and written by `src/lib/server/hunt-board.ts`. Until the migration is applied (or without Supabase) the API says the board is unavailable and the setup and the end screen hide it; with local accounts and no Supabase it lives in memory.
