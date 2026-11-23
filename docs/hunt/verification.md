# Pokémon Hunt: answer table verification

How the answer table (`src/data/hunt/answers.json`) was checked against Bulbapedia and Serebii, what was wrong, and how each problem was fixed at its root. The tools are in `scripts/hunt/`, and every sample and its results are in `src/data/hunt/verification/`.

## The table

- **568 entries (559 species)**, each one exact form.
- **15 regional-form entries:** Alolan Sandslash and Persian; Galarian Ponyta, Rapidash, Farfetch'd, Weezing, Mr. Mime, Corsola, Zigzagoon, Linoone, Darumaka, Darmanitan, Yamask and Stunfisk; and Hisuian Qwilfish.
- **Everything left out, with the reason, is in `src/data/hunt/review.json`:**
  - `review`: uncertain rows. Their entries are not in the table.
  - `dropped`: single places neither source confirms.
  - `missingPlaces`: real places the map doesn't have, ranked by how many Pokémon each one keeps out.
- **The biggest reason a Pokémon is left out is rule 4:** one of its real places isn't on the map. Examples are Torchlit Labyrinth, Alfornada Cavern, the Paldean seas, Brawlers' Cave, Alola's Poni Wilds, Brooklet Hill and Route 17, and Kalos Route 22. Adding those places to the map would bring many Pokémon in.

## Sources and method

**Two independent sources:**
- **Bulbapedia:** each species' "Game locations" table, read through the wiki's API and parsed by `scripts/hunt/bulbapedia.py`.
- **Serebii:**
  - the Pokédex location lists for each generation (`scripts/hunt/serebii.py`);
  - the detailed location pages for Gen 3 and 4, Let's Go, Sword / Shield and BDSP (`scripts/hunt/serebii-detail.ts`).

All pages were downloaded once, politely (about one request a second per worker). They were treated as untrusted text and only parsed.

**Blind lookups.** For every sampled entry, each source's place list per game was built from that source alone, then matched to map places with the same game-aware matcher. Only then was it compared with ours.

**Two kinds of round:**
- **Automated:** `scripts/hunt/verify-sample.ts`.
- **By hand:** helpers read the Bulbapedia and Serebii pages themselves, with only the Pokémon's name. Their notes are saved (`manual-*-sources.json`) and compared by `scripts/hunt/verify-manual.ts`. This also checks my own page readers and matcher, which the automated rounds share with the build.

**What counts as an error,** per entry and game:
- a place of ours that **neither** source lists;
- a map place that **both** sources list and we don't have.

A place only one source lists is "disputed": it's recorded, not counted as an error.

**The sample.** It's drawn with a seeded generator, weighted to rare entries (one-spot Pokémon are far likelier to be picked than route regulars), and always includes every regional-form entry. Each new round excludes the entries checked in earlier rounds, so every sample is fresh.

## Rounds

| Round | Kind | Entries | Errors | What was found |
| --- | --- | --- | --- | --- |
| 1 | Automated (`sample-1`) | 159 | 6 (3.8%) | Let's Go sky spawns for Articuno and Moltres missing two routes; Impidimp in Motostoke Outskirts and Alcremie in the Crown Tundra missing; Chimchar and Piplup's Teal Mask egg gift counted as a wild spot |
| 1 | By hand (`sample-manual-1`) | 40 | 4 (10%) | Persian: an Omega Ruby / Alpha Sapphire Mirage spot read as Route 124, and Let's Go's Vermilion City Persian missing. Omanyte and Kabuto missing in the Crown Tundra. Hakamo-o's Isle of Armor den missing |
| 2 | Automated (`sample-2`) | 160 | 3 (1.9%) | Registeel in White 2 (needs Black 2's Iron Key); Coalossal and Hatterene: Gigantamax-only dens counted by my checker |
| 3 | Automated (`sample-3`), after all fixes | 160 | **0** | – |
| 1 again | By hand, after all fixes | 40 | **0** | – |
| 2 | By hand (`sample-manual-2`), fresh | 40 | see below | – |

Rounds 1 and 2 were re-run after the fixes, and both now come back with zero errors too. Between the rounds, 560 of the 568 entries have been checked at least once.

## Root causes and fixes

**Places, and when a place counts:**
- **The stored `a` field was stale.** It was built against an older map, so every row is re-matched by name inside its game's regions (`scripts/hunt/match.ts`).
- **Galar's base-game Max Raid dens were missing from the data,** and the two sources disagree on many expansion dens. A den now counts only when both sources list it (`evidence/dens.json`). Gigantamax dens are left out, because the art isn't that form.
- **Sword / Shield expansion "Wild" rows are summary lists with no method,** and some are really gifts (Cosmog, Poipole). They no longer count on their own.
- **Some rows name a sub-area that's its own map place** (Alola Route 1's Trainers' School). That place is used, but only when the row's own place matched first (the Mirage spot bug).

**Encounters left out on purpose (rule 1):**
- **Event-only encounters:** Eon Ticket, Mystic and Aurora Tickets, Member Card, Oak's Letter, Azure Flute, Liberty Pass, QR codes, the Enigma Stone, Altering Cave's Mystery Gifts, and the B2W2 Regi keys from the other version (`rules.ts` `EVENT_ONLY`).
- **Swarms and mass outbreaks:** random and short-lived, not a standing spot.

**Forms:**
- **Rows rarely say their form.** Gens 1–6, Let's Go and BDSP only have the original form in the wild. A species whose regional forms came out after the game is its original form there. Otherwise the row's note, or Bulbapedia's form tag at that place, decides. Anything unclear is left out.
- **The art would be wrong at some spots** for Burmy, Wormadam, Shellos, Gastrodon, Vivillon, the Flabébé line and Oricorio, so they're left out. So is Keldeo: Ballimere Lake's Keldeo is in its Resolute Form.

**Gaps and stray rows in the data:**
- **The data misses some real places** (Let's Go sky spawns, Crown Tundra spawns, a few fixed encounters). For every game where both sources list places, a place both list that we lack is added. Its label is the method a source names, or "Wild" (`evidence/agreed.json`, 310 places).
- **Places neither source lists are dropped:** 20 game-and-place pairs, listed in `review.json`.

**My own tools:** templates the Bulbapedia reader missed (`{{FB}}`, `{{safari}}`, `{{kal}}` and others, per-version Expansion Pass rows, HTML comments) and over-broad filters were fixed in the checker before counting. They were never "fixed" by changing answers.

## Checks against Bulbapedia for the whole table

`scripts/hunt/verify-bulbapedia.ts` compares every entry, not just the samples, with Bulbapedia alone. 161 entries still differ from it in some game. In nearly all of them, Bulbapedia's summary leaves out a spot that Serebii and the data have, or lists one that Serebii doesn't (disputed). Neither counts as an error under the two-source rule.

## Decisions worth knowing

- **Mewtwo (X / Y):** Bulbapedia gives the Unknown Dungeon's location as Pokémon Village, so it counts as Pokémon Village.
- **Trophy Garden:** Bulbapedia says it's part of the Pokémon Mansion on Route 212, so it counts as the map's Pokémon Mansion.
- **Celebi in Crystal (Ilex Forest)** is kept. Bulbapedia notes the Virtual Console release has the GS Ball without an event.
- **Rows the data folded into "Most fishable water"** can't be mapped, so those fishing Pokémon are left out for now.
