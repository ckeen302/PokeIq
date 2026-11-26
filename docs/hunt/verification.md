# Pokémon Hunt: answer table verification

How the answer table (`src/data/hunt/answers.json`) was checked against Bulbapedia and Serebii, what was wrong, and how each problem was fixed at its root. The tools are in `scripts/hunt/`, and every sample and its results are in `src/data/hunt/verification/`.

## Hunt v2 (2026-11-26): only normal wild encounters

The owner asked for fair answers: a Pokémon's spots are only where a player meets it in the normal way. `scripts/hunt/rules.ts` now counts only:

- **grass** (tall grass and every game's kinds of it: Unova's dark grass, Kalos's flowers and rough terrain, Galar's swamp, Let's Go's rarer grass spawns);
- **caves**;
- **water**: surfing, and fishing with a rod (Old, Good and Super Rod; Unova's fishing spots; Alola's bubbling fishing spots; Feebas's tiles);
- **the overworld**: Pokémon seen wandering the world (Let's Go, Sword / Shield, Scarlet / Violet, Legends: Z-A).

Everything else is left out, by its method (`METHODS` maps it to `null`):

- needs a device, an item or a trick: **Poké Radar, DexNav, Hidden Grottoes, berry trees and piles, shaking trees, Headbutt, Rock Smash, honey trees, hordes, SOS calls**, Unova's **rustling grass, dust clouds and rippling water**, diving;
- **ambushes** (ground, sky, ceiling, trash cans, bushes), **bridge shadows** and other special encounters;
- **swarms** and mass outbreaks;
- **Max Raids**;
- every **scripted or fixed** one-off meeting: Static, Interact, the **Poké Flute**, the Devon Scope, the Squirt Bottle, the Wailmer Pail;
- as before: gifts, eggs, trades, events, Tera Raids, Hyperspace, the Grand Underground, Island Scan, roamers.

Two more rules came with it:

- **Legendary and mythical Pokémon are left out** (`build-lib.ts`): every meeting with one is a one-off, whatever a row calls it (Scarlet / Violet's and Legends: Z-A's rows file some under "Wild").
- **A place both sources list that the data lacks** is only added with a method the rules count. With no method named, it's added only for a Pokémon the data already has in the wild in that game (a wild spot the data missed, never a gift or a one-off), labelled "Wild". The agreement step left out 3,381 such places.

The difficulty measure now matches the one-pin game: the share of the world's land where a pin scores at least 60% against the nearest of all its spots, each on its region's own scale (the server's scoring). `everywhere` is now 6+ regions, 13+ places, or a difficulty under 0.92.

### The rebuilt table

`npx tsx scripts/hunt/build.ts`, from the same checked-in evidence (no network, nothing new added by hand):

- **548 entries (539 species)**, 14 of them regional forms. 353 can be dealt on the world map (a few distinct places and not everywhere, or famous).
- **Left out by v2:** 59 entries of the old table.
  - 43 legendary or mythical Pokémon (Articuno, Moltres, Mewtwo, Lugia, Ho-Oh, Celebi, Rayquaza, Heatran, the Tapus, the Galar and Paldea legendaries…).
  - 14 met only in Max Raids (Venusaur, Blastoise, Sirfetch'd, Mr. Rime, Runerigus, Alcremie, the fossils…).
  - 2 met only by SOS calls (Alolan Persian, Ambipom).
  - 5 whose only spots were special ones the old table filed under a normal label: rustling grass (Delcatty, Yanmega, Gliscor, Crobat) and bridge shadows (Swanna).
- **Back in the table:** 44 entries that rule 4 kept out before, because one of their spots (now left out: a Headbutt tree, a Poké Radar patch, a horde) was off the map. Among them Jigglypuff, Gengar, Voltorb, Electrode, Jynx, Hoothoot, Bronzor, Munchlax, Lucario, Haxorus and Goomy.
- **Famous (`scripts/hunt/famous.ts`):** 101 Pokémon at the spot their home region is known for (Clefairy on Mt. Moon, Gastly in Lavender Town, Ralts on Route 102, Starly on Route 201, Litwick in the Celestial Tower, Wooloo on Route 1, Lechonk in South Province (Area One)…). The old picks were nearly all one-off meetings and no longer resolve. Easy deals these.

### The v2 audit

`npx tsx scripts/hunt/verify-v2.ts <the old answers.json> --out src/data/hunt/verification/v2-audit.json` checks every place of every entry, game by game, against what Bulbapedia and Serebii list (`scripts/hunt/evidence/agreed.json`, which `make-agreed.ts` built blind from the two sources' pages):

| | Place and game pairs |
| --- | --- |
| Both sources list it | 7,916 |
| One source lists it | 320 |
| The sources don't both have a list for that game | 1,042 |
| **Neither lists it (an error)** | **0** |

Every method in the table is a counted one (Grass, Cave, Surf, Old Rod, Good Rod, Super Rod, Fishing, Overworld, and "Wild" for 9 places both sources list). The audit's file also lists what v2 took out and put back, with the reason for each.

The v1 rounds below still describe how the sources were read and matched; v2 only removes spots and Pokémon from what they checked, and puts back Pokémon whose remaining places those rounds already covered. `tests/hunt-data.test.ts` checks that the committed table is exactly what the build makes, and that no excluded method is in it.

## Before v2

### The table (v1)

- **568 entries (559 species)**, each one exact form.
- **15 regional-form entries:** Alolan Sandslash and Persian; Galarian Ponyta, Rapidash, Farfetch'd, Weezing, Mr. Mime, Corsola, Zigzagoon, Linoone, Darumaka, Darmanitan, Yamask and Stunfisk; and Hisuian Qwilfish.
- **Everything left out, with the reason, is in `src/data/hunt/review.json`:**
  - `review`: uncertain rows. Their entries are not in the table.
  - `dropped`: single places neither source confirms.
  - `missingPlaces`: real places the map doesn't have, ranked by how many Pokémon each one keeps out.
- **The biggest reason a Pokémon is left out is rule 4:** one of its real places isn't on the map. Examples are Torchlit Labyrinth, Alfornada Cavern, the Paldean seas, Brawlers' Cave, Alola's Poni Wilds, Brooklet Hill and Route 17, and Kalos Route 22. Adding those places to the map would bring many Pokémon in.

### Sources and method

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

### Rounds

| Round | Kind | Entries | Errors | What was found |
| --- | --- | --- | --- | --- |
| 1 | Automated (`sample-1`) | 159 | 6 (3.8%) | Let's Go sky spawns for Articuno and Moltres missing two routes; Impidimp in Motostoke Outskirts and Alcremie in the Crown Tundra missing; Chimchar and Piplup's Teal Mask egg gift counted as a wild spot |
| 1 | By hand (`sample-manual-1`) | 40 | 4 (10%) | Persian: an Omega Ruby / Alpha Sapphire Mirage spot read as Route 124, and Let's Go's Vermilion City Persian missing. Omanyte and Kabuto missing in the Crown Tundra. Hakamo-o's Isle of Armor den missing |
| 2 | Automated (`sample-2`) | 160 | 3 (1.9%) | Registeel in White 2 (needs Black 2's Iron Key); Coalossal and Hatterene: Gigantamax-only dens counted by my checker |
| 3 | Automated (`sample-3`), after all fixes | 160 | **0** | – |
| 1 again | By hand, after all fixes | 40 | **0** | – |
| 2 | By hand (`sample-manual-2`), fresh, after all fixes | 40 | **0** | 4 flags, none an error. Dragonite on Let's Go's Route 20, and Wobbuffet and Vanillish in Giant's Mirror, are on Serebii's detailed location pages, which the helpers didn't read (they read the summary page). Gastly's Gold / Silver / Crystal "Tin Tower" is the map's Bell Tower under its old name (alias added) |

Rounds 1 and 2 were re-run after the fixes, and both now come back with zero errors too. The hand comparison also reads Serebii's detailed location pages (`verify-manual.ts <sample> <sources> <serebii-detail.json>`). Between the rounds, 560 of the 568 entries have been checked at least once.

### Root causes and fixes

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

### Checks against Bulbapedia for the whole table

`scripts/hunt/verify-bulbapedia.ts` compares every entry, not just the samples, with Bulbapedia alone. 161 entries still differ from it in some game. In nearly all of them, Bulbapedia's summary leaves out a spot that Serebii and the data have, or lists one that Serebii doesn't (disputed). Neither counts as an error under the two-source rule.

### Decisions worth knowing

- **Mewtwo (X / Y):** Bulbapedia gives the Unknown Dungeon's location as Pokémon Village, so it counts as Pokémon Village.
- **Trophy Garden:** Bulbapedia says it's part of the Pokémon Mansion on Route 212, so it counts as the map's Pokémon Mansion.
- **Celebi in Crystal (Ilex Forest)** is kept. Bulbapedia notes the Virtual Console release has the GS Ball without an event.
- **Rows the data folded into "Most fishable water"** can't be mapped, so those fishing Pokémon are left out for now.
