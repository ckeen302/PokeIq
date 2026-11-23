# Pokémon Hunt: spec and contract

Pokémon Hunt is a PokéGuessr mode. Each round shows one Pokémon in one exact form (its official art, its name, and "Found in 2 regions"). You pin where you find it on the PokéGuessr world map. It plays in the same frame, map dock, 1:30 timer and score tracker as PokéGuessr (`src/components/geo/*`).

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

Region mode offers the nine regions with a map (`HUNT_MAP_REGIONS`, the `world.crops` in geo.json).

## 3. Accuracy rules (the answer table must meet all of them)

1. **Only places you can actually go count.**
   - Counted: wild encounters in grass, caves and water, fishing, Headbutt, Rock Smash, honey trees, hordes, SOS calls, overworld and wandering Pokémon, one-off fixed encounters (Mewtwo in Cerulean Cave), and Galar's Max Raid dens.
   - Left out: anything that isn't a spot on the map, such as Tera Raids, Hyperspace Lumiose, the Grand Underground, Friend Safari, curry, trades, eggs, events, evolution, HOME, and gifts (gifts are out of version 1).
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
- `methods[].games` and `methods[].method` are the reveal's labels: "Red / Blue · Super Rod". Use plain method names: Grass, Cave, Surf, Old Rod, Good Rod, Super Rod, Fishing, Headbutt, Rock Smash, Honey tree, Horde, SOS call, Overworld, Wandering, Fixed encounter, Max Raid.
- `difficulty` (0 easy – 1 hard) is measured on the world map, with the pins the round gets (`huntPinsFor`): 1 − the share of the world map's land where a pin set would score at least 60% of the round. `regionDifficulty[r]` is the same on region r's own map with one pin.
- `famous`: a memorable spot people know (hand-picked list in `scripts/hunt/`, each one checked).
- `everywhere`: found so widely the world map gives it away (for example 4+ regions and a low difficulty). Never dealt in Classic or the Daily.
- `fact`: optional English one-liner drawn from the data ("Only found in Cerulean Cave, in five different games."). Never invented. Without one, the game writes a line from the places.

Until the full table lands, `answers.json` holds the game agent's hand-checked sample (`"sample": true`). Hunt data replaces it whole.

## 5. The game

### Modes (launch)
- **Classic**: the world map, 5 rounds.
- **Region**: pick one of the nine regions with a map; 5 rounds on its map, one pin each; only that region's spots count.
- **Daily Hunt**: the world map, the same 5 rounds for everyone each UTC day (seed `hunt-daily:<date>`), a share grid like the other dailies. No leaderboard at launch (`HUNT_DAILY_LEADERBOARD = false`: see section 9).
- Legendary Hunt comes later.

### Pins
- World map: one pin per region the Pokémon is found in, at most 3 (`huntPinsFor`). With more regions the card says "Found in 7 regions: drop up to 3 pins".
- Region map: one pin.
- Tap the map to drop the next pin. Tap a pin's chip (or the pin) to pick it up and tap again to move it. Remove a pin from its chip. The pin counter shows "2 / 3". Guess is allowed with at least one pin; missing pins score 0.

### Scoring and matching (server, `src/lib/hunt/score.ts`)
- 5,000 points a round, split evenly across the round's pins (`5000 / pins` each).
- A pin's score against a region = PokéGuessr's curve to the nearest spot's area in that region: `share · e^(−10 · d / D)` (D the map diagonal, full points within half a town-map square).
- Pins are matched to distinct regions to maximise the total (every assignment is tried: at most 3 pins and 10 regions). Order never matters, and each region counts once.
- A pin "found" its region when it lands in that region (the region of the nearest place on the map, as PokéGuessr's streak reads it). "You found 2 of 3 regions" counts found pins out of the round's pins.
- Region mode is the same with one pin and only that region's spots.

### Dealing (difficulty mix)
- Classic and the Daily never deal `everywhere` entries.
- 5 rounds: 1 famous (or easiest third), 2 from the middle, 1 hard, 1 any; then ordered easy → hard. No species twice in a game.
- Region mode deals only entries that have `regionDifficulty[region]` (a spot on that region's own map), the same mix, and its reveal shows only the spots on that map (Kanto's map has no Sevii Islands, Unova's no Blueberry Academy).
- Free play avoids the player's recent Pokémon (sent from local storage, as PokéGuessr does).

### Secrecy
- The client never receives places, regions or the entry list before a round is graded. A round carries only the Pokémon (id, name, art), its region count and its pin count (`HuntRoundPublic`).
- The game state is a signed token holding a sealed plan, as PokéGuessr's.
- No place names before the reveal, anywhere the player can see or inspect (no hidden DOM, no data attributes, no prefetch).

### The reveal
1. Every real spot pops onto the map region by region, labelled with its game and method ("Red / Blue · Super Rod").
2. Each pin draws a line to its matched spot. "You found 2 of 3 regions."
3. A one-line fact, and a link to the Pokémon's "where to find" section (`/pokemon/<slug>#encounters`).

### Results
- Total out of 25,000, each round's Pokémon and score, Play again, back to PokéGuessr.
- Daily: the share grid (`HuntShareGrid`, text from `src/components/hunt/share.ts`): the title and total, then a row per round with one square per pin (🟩 80%+ of the pin's share, 🟨 40%+, 🟧 some, 🟥 none), then the link. Never a Pokémon or a place.

## 6. Screens and states (presentation components, owned by hunt design)

`HuntGame` (game agent) holds the state machine: `hub → starting → playing → grading → reveal → (playing …) → results`, the pins, the clock, local storage and the API calls. It renders hunt design's components, whose props are the contract (see each file's props interface):

| Screen | Component | Notes |
| --- | --- | --- |
| Hub entry | `HuntHubBanner` (`HuntHub.tsx`) | A wide banner over PokéGuessr's Play tiles. English only until the `hunt` messages are translated. |
| The hunt's hub | `HuntHub` | Daily, Classic, Region (with its region picker), best scores. |
| A round | `HuntRound` | The whole round screen: `HuntCard` (the Pokémon) as the picture, PokéGuessr's HUD, the `MapDock` with `HuntPinTray`. Pins are slots: `(MapPin | null)[]`, one per pin the round takes; a tap places or moves the active slot. |
| The reveal | `HuntReveal` | The whole reveal screen, map included (its pop-in clock and Skip). It binds Space and Enter itself. |
| Results | `HuntResults` | Its own `GameShell`; the Daily passes `HuntShareGrid` as children. |
| Loading, error, empty | `HuntState` | |

The share text is `src/components/hunt/share.ts` (one square per pin, coloured by its share of the round).

Test ids the e2e script relies on: `hunt-hub-entry`, `hunt-hub`, `hunt-play-classic`, `hunt-play-region`, `hunt-play-daily`, `hunt-region-picker` (radios named by region), `hunt-card`, `hunt-name`, `hunt-pin-chip-<n>` (with `data-placed`), `hunt-pin-remove-<n>`, `hunt-reveal`, `hunt-skip`, `hunt-spot`, `hunt-found-line`, `hunt-dex-link`, `hunt-next`, `hunt-results`, `hunt-results-total`, `hunt-again`, `hunt-share-grid`, `hunt-share-button`. Plus PokéGuessr's `geo-shell`, `geo-map`, `geo-guess`, `geo-dock`, `geo-map-pill`.

Messages: one namespace, `hunt` (`src/messages/hunt.ts`, `src/messages/<locale>/hunt.json`). `/pokeguessr/hunt` joins `ALL_LANGUAGES` in `src/i18n/routes.ts` once all five translations exist.

## 7. API

- `POST /api/geo/hunt` `{ mode, region?, name? }` → `HuntStartResponse`.
- `POST /api/geo/hunt/guess` `{ token, pins, timeout? }` → `HuntGuessResponse`. Each round is graded once; an identical retry gets the same answer back.

## 8. Tests

- `tests/hunt-game*.test.ts` (game): scoring, matching (order doesn't matter, each region once, optimal), dealing (no repeats, no `everywhere` in world modes, the daily is the same for everyone), secrecy (a round's JSON has no place names), share text.
- `tests/hunt-data*.test.ts` (data): every place is a pinned geo.json place in the right region for its versions, `regions` matches `places`, forms are separate and their art is that form, no excluded methods, difficulty in range.
- `scripts/e2e-hunt.mjs` (game): Classic, Region and Daily, phone and desktop; and `E2E_ONLY=hunt` in `scripts/e2e-smoke.mjs`.

## 9. The Daily's leaderboard (not built)

It would need one new table, which this project doesn't add. Until then the Daily ships without one (`HUNT_DAILY_LEADERBOARD = false`). The table it would need:

```sql
create table hunt_daily_scores (
  date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  score int not null check (score between 0 and 25000),
  rounds int[] not null,
  duration_ms int not null,
  created_at timestamptz not null default now(),
  primary key (date, user_id)
);
create index hunt_daily_scores_board on hunt_daily_scores (date, score desc, duration_ms);
```
