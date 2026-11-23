# PokéGuessr music credits

PokéGuessr's background music (on /pokeguessr and in its games) is four calm,
instrumental tracks by independent artists, released under licences that
allow free use on this site. None of it is music from, or a cover or remix of,
any Pokémon game. Each licence was checked on the track's page when it was
added (November 2026).

| File | Title | Author | Licence | Source | Changes |
| --- | --- | --- | --- | --- | --- |
| `riverside-town.ogg` / `.mp3` | 6 A.M. Riverside Town | Tad | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | <https://opengameart.org/content/6-am-riverside-town> | Trimmed the closing silence, faded out, loudness-matched, re-encoded |
| `kodama.ogg` / `.mp3` | Kodama | HoliznaCC0 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://freemusicarchive.org/music/holiznacc0/nature-spirit/kodama/> | Trimmed the closing silence, faded out, loudness-matched, re-encoded |
| `deep-house-sunset.ogg` / `.mp3` | Deep House Sunset With Wide Dynamics | Alex Morgan | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | <https://freemusicarchive.org/music/alex-morgan/electronic-dance-vol-1/deep-house-sunset-with-wide-dynamics/> | **Vocals removed** (Demucs source separation, `htdemucs` model), closing silence trimmed, faded out, loudness-matched, re-encoded |
| `lazy-afternoon.ogg` / `.mp3` | Lazy Afternoon | Purrple Cat | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | <https://freemusicarchive.org/music/purrple-cat/signs-of-life/lazy-afternoon-2/> | Trimmed the closing silence, faded out, loudness-matched, re-encoded |

Every file is matched to -18 LUFS integrated (so the music sits under the
game's sound effects) and encoded as Ogg Opus at 96 kbps with an MP3 at
96 kbps for Safari, by `scripts/guessr-music/encode.sh`.
