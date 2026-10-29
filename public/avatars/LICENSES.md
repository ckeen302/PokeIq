# Trainer avatar assets

The 3D trainer avatars (`src/components/trainer3d/`) use **no third-party 3D
models, textures or animations**. Every part is our own work:

| What | Source | Licence |
| --- | --- | --- |
| Trainer body, face, hair, hats, clothes, bags, gloves, shoes | Built at runtime from three.js primitives (spheres, capsules, lathes, cones, rounded boxes) in `src/components/trainer3d/model.ts` | Original to PokéIQ (same licence as the site's code) |
| Poses (idle, wave, battle stance) and the Poké Ball toss | Procedural joint angles in `model.ts` | Original to PokéIQ |
| Poké Ball held by the trainer and on the belt | Procedural three.js geometry (red/white halves, black band, button) in `model.ts` | Original to PokéIQ |
| Small portraits next to names | Inline SVG drawn in `src/components/avatar/TrainerPortrait.tsx` | Original to PokéIQ |
| three.js renderer (already a site dependency) | https://github.com/mrdoob/three.js | MIT |
| Partner Pokémon sprites | The animated sprites the site already shows elsewhere (PokéAPI sprites repository, Pokémon Showdown sprites), loaded the same way as `src/lib/battle/sprites.ts` | As credited in the site footer |

Nothing is downloaded for the trainer itself, so the avatar adds no asset
weight beyond the code (three.js plus about 20 KB of builder code, loaded only
on pages that show a 3D trainer).

The trainers are inspired by the general idea of a Pokémon trainer (caps,
backpacks, jackets, a Poké Ball belt). They are not copies of any official
character design, and no Nintendo, Game Freak or Creatures models were used.

CC0 packs considered (Kenney "Mini Characters", Quaternius character packs)
were not used: building the parts in code made every item swappable and
recolourable with zero download size. If a CC0 pack is added later, record its
name, URL, author and licence file here.
