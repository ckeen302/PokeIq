# Trainers tab: data sources and coverage

`/pokedex/trainers` lists the trainers of every game we can read straight from a
[pret](https://github.com/pret) decompilation. `scripts/trainers/import.ts`
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
- **Generation V and later** (Black/White, B2W2, X/Y, ORAS, Sun/Moon, USUM,
  Let's Go, Sword/Shield, BDSP, Legends: Arceus, Scarlet/Violet): no
  decompilation, and no public, complete trainer dump we could verify. The
  known tools (pkNX, pk3DS, TrainerTyrant) read a user's own ROM; they don't
  publish data. Bulbapedia/Serebii pages are references, not a parseable,
  redistributable source. Revisit if a published dump appears.
- **Frontier Brains** (no fixed teams outside the facilities).
- **Trainer sprites**: no clearly redistributable source, so notable trainers use
  an initials portrait.

Notable trainer descriptions are our own words. Specialty types and badges match
`src/data/quiz/games/gyms.json`.
