# The PokéIQ Games: music and sound credits

## Music

The fanfare and the anthem on /lab/games (and in the videos it makes) are
original music written for the Games. They are not music from, or a cover
or remix of, any Pokémon game, nor any real sporting ceremony's music.

| File | Piece |
| --- | --- |
| `fanfare.mp3` | The fanfare for each gold medal: two bars at 112 bpm in B-flat major, a rising triplet call on trumpets in thirds over horns, trombones and tuba, a timpani roll and a cymbal (6.2 s) |
| `anthem.mp3` | The anthem under each medal ceremony: four bars at 84 bpm in B-flat major, a hymn-like tune on horns and strings over a brass choir, ending on a held chord (13.6 s) |

Both were written as MIDI (`scripts/film-score/games.py`) and played with the
**MuseScore General** sound font (`MuseScore_General_Full.sf3`), which is
released under the [MIT licence](https://opensource.org/license/mit) by
S. Christian Collins (<https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/>;
the Debian package `musescore-general-soundfont` carries the licence text),
with [FluidSynth](https://www.fluidsynth.org/) (LGPL-2.1, used as a tool),
then faded, loudness-matched to -16 LUFS and encoded with ffmpeg/libmp3lame
(`scripts/film-score/games.sh`).

## Sound

The crowd bed and the applause are the Race's recordings (CC0; credited in
`public/audio/race/CREDITS.md`). Every other sound is synthesised in the browser by
`src/components/games/audio.ts`, with no recordings and no extra download:
the guns and their echo off the stands, the timing beep, thuds, a shot
landing in the turf and a javelin sticking in it, sand, the bar's clank and
its bouncing plates, splashes and dives (the plunge and the droplets), the
buzzer, whooshes, and the crowd's reactions (a crowd of synthesised voices:
cheers, a roar for a close finish, an "ooh", a groan for a foul, a missed
lift or a knocked bar).
