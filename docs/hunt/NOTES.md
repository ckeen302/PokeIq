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
