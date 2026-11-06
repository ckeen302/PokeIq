# The Story of Pokémon: music and sound credits

## Score

The music on /lab/pokemon-story (and in the videos it makes) is an original
score written for this film. It is not music from, or a cover or remix of,
any Pokémon game. It is one theme (a leitmotif) in D major at 84 bpm, in a
24-bar form (the theme, a bridge, the theme again), arranged six ways. Every
arrangement has the same key, tempo and length, so they are true stems of one
piece and the film plays them together, mixing them per chapter: curious on
celesta and music box at the start, eight-bit in the Game Boy years, warm on
strings and horn in the middle, the full orchestra at each big moment, and
solo piano at the close. A held chord rises under each slow-motion moment.

| File | Arrangement |
| --- | --- |
| `theme-piano.mp3` | Solo piano: the theme over broken chords (the bed) |
| `theme-curious.mp3` | Celesta, music box, pizzicato strings, harp and flute |
| `theme-chip.mp3` | Chiptune: square lead and arpeggio, pulse bass, noise hats |
| `theme-band.mp3` | Light band: kit, shaker, bass, strummed steel and nylon guitars |
| `theme-warm.mp3` | Strings, cello, clarinet and French horn |
| `theme-full.mp3` | Full orchestra: violins, trumpet, horns, trombones, choir, timpani, glockenspiel, cymbals |
| `theme-hold.mp3` | The held chord for slow motion: strings, choir, high violins, celesta |

The score was written as MIDI and played with the **MuseScore General** sound
font (MuseScore_General_HQ, v0.2.1), which is released under the
[MIT licence](https://opensource.org/license/mit) by S. Christian Collins
(<https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/>; the
Debian package `musescore-general-soundfont` carries the licence text). Parts
of it are public domain or CC0: its ensemble strings are from Versilian
Studios Chamber Orchestra 2 Community Edition by Sam Gossner, Simon Dalzell
and Elan Hickler ([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
<https://github.com/sgossner/VSCO-2-CE>), its open crash samples from the
Versilian Community Sample Library (CC0, <https://github.com/sgossner/VCSL>),
its drumline samples by S. Christian Collins and Amir Oosman (CC0), and its
grand piano from a verified public-domain AKAI S5000 set. The rest derives
from the Fluid (R3) GM sound font by Frank Wen (MIT). Rendered with
FluidSynth (LGPL; used as a tool, not distributed). Encoded as 48–64 kbps
MP3 (loudness-matched stems).

## Sound

The ambience (fields, crickets, rooms, an arcade, a cinema, crowds, a
stadium, rain, the sea, a city, space, underwater, a hall) and every hit and
piece of foley (impacts, chimes, whooshes, paper, a pen, cartridge clicks, a
link cable, footsteps, cards, a TV) are synthesised in the browser at play
time (src/lib/film-sound/). No recordings are used.
