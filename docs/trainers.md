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
| Platinum | pret/pokeplatinum | 662 | 68 |
| HeartGold & SoulSilver | pret/pokeheartgold | 622 | 76 |

Each team has species, level, moves (custom moves from the party data, otherwise
the level-up default moveset the game computes, rebuilt from that game's own
learnsets), held item, the items the trainer uses, double battles, rematches,
rival starter variants and, for Ruby/Sapphire, which version a Team Aqua/Magma
team belongs to. Gen I gym leader / Elite Four signature moves come from the
engine tables (`LoneMoves`, `TeamMoves`, Yellow's `SpecialTrainerMoves`).

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

- **Diamond & Pearl** (pret/pokediamond has no extracted trainer data yet).
- **Generation V and later** (Black/White onward): no decompilation with trainer
  data; would need a datamined dump cross-checked by hand.
- **Frontier Brains** (no fixed teams outside the facilities).
- **Trainer sprites**: no clearly redistributable source, so notable trainers use
  an initials portrait.

Notable trainer descriptions are our own words. Specialty types and badges match
`src/data/quiz/games/gyms.json`.
