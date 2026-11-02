# Race credits

PokéIQ Stadium on /pokedex/race is drawn by the page itself: the track and
its markings, the stands, roof, floodlight masts, crowd, screens, boards and
timing equipment are procedural and original. Nothing is taken from any
Pokémon game, and no Olympic marks are used.

## Textures (Poly Haven, CC0 1.0)

Downloaded at 1K from <https://polyhaven.com> and converted to WebP.
Licence: <https://creativecommons.org/publicdomain/zero/1.0/>.

| Files | Asset | Author |
| --- | --- | --- |
| `tex/rubberized_track_*` | [Rubberized Track](https://polyhaven.com/a/rubberized_track) | Charlotte Baglioni |
| `/sizes/tex/leafy_grass_*` (shared with Sizes) | [Leafy Grass](https://polyhaven.com/a/leafy_grass) | Charlotte Baglioni |

## Sound

See [`/audio/race/CREDITS.md`](/audio/race/CREDITS.md): crowd recordings
from OpenGameArt.org under CC0. The starter's gun, footfalls, crowd roar,
stadium reverb and timing beep are synthesised in the browser.

## Pokémon figures

The runners are built from the Pokémon HOME renders served by PokéAPI's
sprites repository, on the relief figures of /pokedex/sizes. Depth for the
forms Sizes doesn't show (`depth/*.webp`) was estimated with Depth Anything
V2 Small (Apache-2.0) by `scripts/race-depth.ts`.

## The model

Top speed is scaled from base Speed (100 Speed = 10 m/s); Pokémon have no
official real-world speeds. Acceleration follows Furusawa, Hill and
Parkinson's sprint model (Proc. R. Soc. B, 1927); stride and gait follow
R. McNeill Alexander's dynamic similarity ("Estimates of speeds of
dinosaurs", Nature 261, 1976). Stats from PokéAPI.
