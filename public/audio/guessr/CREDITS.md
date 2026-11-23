# PokéGuessr music credits

PokéGuessr's background music (on /pokeguessr and in its games) is original
music written for PokéIQ. It is not music from, or a cover, remix or
imitation of, any Pokémon game or any other game's soundtrack: it was
composed for this site, in the general mood of calm, sparse ambient piano
music, by a seeded generative script, and rendered from nothing but
mathematics (additive and FM synthesis and an algorithmic reverb). No
samples, sound fonts, loops or recordings were used, so no third-party
licence applies to it. PokéIQ releases these files under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

| File | Title | Length | What it is |
| --- | --- | --- | --- |
| `first-light.ogg` / `.mp3` | First Light | 3:30 | Soft felt piano with a quiet pad, D major, 64 bpm |
| `tide-pools.ogg` / `.mp3` | Tide Pools | 2:32 | Music box over piano and a pad, A major in three, 76 bpm |
| `long-grass.ogg` / `.mp3` | Long Grass | 2:54 | Felt piano with music-box sparkles, E-flat Lydian in three, 58 bpm |
| `harbour-lights.ogg` / `.mp3` | Harbour Lights | 3:18 | A Rhodes-style electric piano with a pad and music box, G major, 68 bpm |

## How they were made

- `scripts/guessr-music/compose.py` (Python and numpy only) writes each piece:
  a slow chord progression, a left hand of broken chords, and a sparse melody
  of short motifs that repeat, vary and answer each other, with long rests.
  The instruments are synthesised note by note (a felt piano with inharmonic
  partials, a music-box tine, a two-operator FM electric piano, a slow
  detuned pad), then placed in a generated hall reverb. Every note's tail and
  the reverb's wrap round to the start, so each file loops without a seam.
- `scripts/guessr-music/render.sh` loudness-matches each piece to -18 LUFS
  integrated (a plain gain change, true peak at most -1.5 dBTP) with ffmpeg's
  `loudnorm`, then encodes Ogg Opus at 96 kbps and MP3 at 96 kbps (for
  Safari). [FFmpeg](https://ffmpeg.org/) (LGPL/GPL) was used as a tool only.

To make them again: `python3 -I scripts/guessr-music/compose.py out &&
scripts/guessr-music/render.sh out`.
