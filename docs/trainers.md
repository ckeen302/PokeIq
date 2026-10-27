# Trainers tab: data sources and coverage

`/pokedex/trainers` lists the trainers of every main-series game from Red and
Blue to Scarlet and Violet (Legends: Arceus and Legends: Z-A are out of scope).
Generation I–IV come straight from a [pret](https://github.com/pret)
decompilation; Generation V–IX come from Bulbapedia (see below). `scripts/trainers/import.ts`
builds one compact file per game in `src/data/trainers/` (see the header of
that script for the clone commands). Every species, move and item is resolved
against our Pokédex data, and the import aborts on anything it can't resolve.

## Coverage

| Game | Source | Teams | Places |
| --- | --- | ---: | ---: |
| Red & Blue | pret/pokered | 352 | 42 |
| Yellow | pret/pokeyellow | 343 | 42 |
| Gold & Silver | pret/pokegold | 439 | 70 |
| Crystal | pret/pokecrystal | 473 | 73 |
| Ruby & Sapphire | pret/pokeruby | 624 | 54 |
| Emerald | pret/pokeemerald | 826 | 54 |
| FireRed & LeafGreen | pret/pokefirered | 604 | 60 |
| Diamond & Pearl | pret/pokediamond | 487 | 63 |
| Platinum | pret/pokeplatinum | 662 | 68 |
| HeartGold & SoulSilver | pret/pokeheartgold | 622 | 76 |
| Black & White | Bulbapedia | 472 | 62 |
| Black 2 & White 2 | Bulbapedia | 671 | 74 |
| X & Y | Bulbapedia | 435 | 63 |
| Omega Ruby & Alpha Sapphire | Bulbapedia | 771 | 68 |
| Sun & Moon | Bulbapedia | 350 | 62 |
| Ultra Sun & Ultra Moon | Bulbapedia | 450 | 67 |
| Let's Go, Pikachu! & Eevee! | Bulbapedia | 520 | 65 |
| Sword & Shield (+ Isle of Armor, Crown Tundra) | Bulbapedia | 238 | 49 |
| Brilliant Diamond & Shining Pearl | Bulbapedia | 651 | 69 |
| Scarlet & Violet (+ Teal Mask, Indigo Disk) | Bulbapedia | 486 | 70 |

Each team has species, level, moves (custom moves from the party data, otherwise
the level-up default moveset the game computes, rebuilt from that game's own
learnsets), held item, the items the trainer uses, double battles, rematches,
rival starter variants and, for Ruby/Sapphire, which version a Team Aqua/Magma
team belongs to. Gen I gym leader / Elite Four signature moves come from the
engine tables (`LoneMoves`, `TeamMoves`, Yellow's `SpecialTrainerMoves`).

## Diamond & Pearl

pret/pokediamond now ships the trainer table as JSON (`files/poketool/trainer/trdata.json`),
but map events and scripts are still compiled binaries, so
`scripts/trainers/diamond-pearl.ts` reads them directly: trainer objects run
script `3000 + id − 1`, and scripted battles are command `0x00E5` (or tag
battle `0x02A0`) directly followed by the battle-result check. Checks made
before shipping:

- Places: 399 of the 403 trainers that also appear in Platinum (same class and
  name) stand in the same area; the other 4 are naming only ("Cafe"/"Café", the
  Eterna Galactic building filed under Eterna City).
- Teams: all eight Gym Leaders match Serebii's Diamond/Pearl gym page (one
  level differs: Volkner's Octillery is Lv 47 in the game data, 48 on Serebii);
  the Elite Four and Cynthia match published DP guides (e.g. Cynthia's
  Spiritomb Lv 61 … Garchomp Lv 66); Barry's starter variants follow the same
  pattern as Platinum.

## What is left out, on purpose

- **Unused parties.** A team counts only when a map script or map object battles
  it (rematches inherit the first battle's place). Leftover parties no script
  loads are dropped.
- **Battle facilities.** Battle Tower/Frontier, Trainer Hill, Trainer Tower and
  the Battleground's random draws build their opponents at run time.
- **Partners.** Teams that fight beside the player (Dawn/Lucas, Cheryl & co.,
  HGSS partner battles) are not opponents.
- **Abilities, natures, IVs.** Gen I–IV parties don't set them directly (they
  come from a seeded personality value), so we don't show them.
- **Player-named rivals** (Blue, Silver, Barry, the FRLG rival) have no fixed
  name in the data; they appear as "Rival" and link to their notable page.

## Not covered yet

- **Diamond & Pearl Vs. Seeker rematches.** The rematch table isn't decompiled
  yet, so only first battles are listed.
- **Legends: Arceus and Legends: Z-A** (deliberately out of scope).
- **Frontier Brains** (no fixed teams outside the facilities).
- **Trainer sprites**: no clearly redistributable source, so notable trainers use
  an initials portrait.

## Generation V–IX (Bulbapedia)

There are no complete decompilations of the 3DS/Switch games, so
`scripts/trainers/wiki-import.ts` reads Bulbapedia's location pages through the
MediaWiki API (`action=query&prop=revisions`, 50 titles per request, ≥1.1 s
between requests, back-off on 403/429/5xx). Requests go through `curl`: the
site answers Node's `fetch` with 403 but serves curl with the same
User-Agent. Raw wikitext is cached in `.data/wiki/` (gitignored), so
re-running costs nothing:

    npx tsx scripts/trainers/wiki-import.ts [game…]   # writes src/data/trainers/<game>.json
    npx tsx scripts/trainers/crosscheck.ts [game…]    # Serebii cross-check + fixture

How a page is read (`wiki-parse.ts`, `wiki-import.ts`):

- Pages: every page in each region's `<Region> locations` category tree
  (gyms, sub-areas, Isle of Armor, Crown Tundra, Kitakami and Blueberry
  Academy included), plus `Pokémon League (Alola)/Title Defense`.
- Teams: `{{Party}}` … `{{Pokémon}}` … `{{Party/end}}` blocks (full sets:
  level, item, ability, moves, Tera Type, form) and `{{Trainerentry}}` rows
  (species, level, item). `{{Party/2}}` gives two opponents in one battle.
- Game: a `{{Party}}`'s own `game` code wins; otherwise the section heading
  ("Pokémon Black 2 and White 2", "Generation VIII"); otherwise the page's
  per-game category (`Black and White locations` …), the codes of the other
  parties on the page, or the sprite tag (`Spr B2W2 …`). Unheaded pages in
  Kanto, Hoenn and Sinnoh belong to the Gen I–IV games and are skipped.
- Versions, rematches, sub-areas: `{{trainerdiv}}` labels ("Black 2",
  "Rematch", "South section", "Requires Surf") and headings; Pokémon captioned
  "Scarlet"/"Violet" inside a party split it into two version teams.
  Rival starter variants come from `{{PlayerChoice}}` captions (the wiki
  captions only the first of a side-by-side pair; the other is inferred from
  the species that variant uses elsewhere).
- Left out: anime/manga/spin-off sections, Easy and Challenge Mode parties
  (B2W2 keeps Normal Mode, including `{{tt|11|Normal Mode}}` levels),
  partners fighting beside the player (back sprites, or introduced as a
  partner just above the box), battle facilities with random opponents
  (Battle Subway, Maison, Tree, Tower, Royal Dome, Chateau, PWT, Battle
  Agency …), Max Raids/Dens, Tera Raids, Titan and Star Barrage auto-battles.
- Moves: rows list no moves. For Black/White and B2W2 we rebuild the
  level-up default moveset from PokeAPI's per-version-group learnsets
  (`.data/pokeapi/pokemon_moves.csv`) and mark it "Level-up moveset"; the
  Serebii check agrees with ~95% of those teams (the rest are trainers with
  custom sets the wiki doesn't list, mostly Veterans). For Gen VI–IX many
  generic trainers have explicit, often 2–3-move sets in the game data that
  the wiki omits, so those rows show no moves instead of a guess.
- Ability (`ab`), Tera Type (`tt`) and named forms (`fn`) are stored when the
  wiki lists them; IDs are `AREA-CLASS_NAME[-n]`.

### Cross-check (Serebii)

`scripts/trainers/crosscheck.ts` parses the trainer tables on Serebii's
PokéEarth page for every area we have plus each game's Gym / Elite Four
pages, matches them to our teams (same trainer, same species), compares
levels, moves and held items, and writes `tests/fixtures/trainers-verified.json`
(every notable team both sources agree on + 40 fixed route trainers per game),
which the tests hold the committed data to. Disagreements go to
`.data/trainers-crosscheck.txt`. Last run:

| Game | Matched | Levels agree | Moves agree | Items agree |
| --- | ---: | ---: | ---: | ---: |
| Black & White | 453 | 453 | 430/453 | 62/62 |
| Black 2 & White 2 | 580 | 573 | 529/580 | 75/79 |
| X & Y | 318 | 292 | 10/12 | 8/9 |
| Omega Ruby & Alpha Sapphire | 690 | 688 | 8/8 | 61/61 |
| Sun & Moon | 320 | 319 | 75/77 | 60/60 |
| Ultra Sun & Ultra Moon | 420 | 417 | 99/102 | 86/88 |
| Let's Go | 417 | 414 | 161/163 | – |
| Sword & Shield | 220 | 218 | 98/99 | 11/11 |
| BDSP | 555 | 552 | 67/76 | 256/261 |
| Scarlet & Violet | 447 | 444 | 75/76 | 130/133 |

Known disagreements, where we keep Bulbapedia (its tables are transcribed
from the game data): X & Y route trainers where Serebii gives every Pokémon
the team's top level (e.g. Youngster Jacob 11/13 vs 13/13) and the Kiloude
City rival rematch; party order (Serebii lists some Gym teams in a different
order, e.g. Grant's Amaura/Tyrunt); the Striaton triplets' Lillipup and
monkeys, where Serebii lists four moves and Bulbapedia two; and BW/B2W2
level-up defaults for trainers with custom sets (Veterans).

Notable trainer descriptions are our own words. Specialty types and badges match
`src/data/quiz/games/gyms.json`.
