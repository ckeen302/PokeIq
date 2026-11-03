# PokéGuessr music and countdown sound credits

The countdown's alarm, ticks and heartbeat are short recordings released
under CC0 on OpenGameArt.org. None of it is audio from GeoGuessr or any other
game. Each licence was checked on the sound's page when it was added
(November 2026). The game layers these with sounds synthesised in the
browser (a low drone, a rising filter, the sharper ticks of the last seconds)
and falls back to fully synthesised sounds if a file fails to load.

Every file was trimmed, downmixed to mono, peak-normalised to -1 dBFS and
encoded as Ogg Vorbis with an MP3 fallback.

| File | Made from | Author | Licence | Source | Changes |
| --- | --- | --- | --- | --- | --- |
| `countdown-start.ogg` / `.mp3` | Short alarm + Air whoosh | yd; pyranostudios | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/short-alarm> (`alarm_0.ogg`); <https://opengameart.org/content/air-whoosh> (`whoosh2_0.wav`) | First second of the alarm, faded out, over one rising whoosh; mixed, normalised, re-encoded |
| `tick.ogg` / `.mp3` | Ticking clock. | bart | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/ticking-clock> (`ticks.zip`, `tick1`) | Trimmed, normalised, re-encoded |
| `tock.ogg` / `.mp3` | Ticking clock. | bart | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/ticking-clock> (`ticks.zip`, `tick2`) | Trimmed, normalised, re-encoded |
| `heartbeat.ogg` / `.mp3` | Heartbeat sounds | bart | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/heartbeat-sounds> (`heartbeat_slow.wav`) | One lub-dub cut out, normalised, re-encoded |

## Music (`music/`)

Original chiptune by independent composers, released under CC0 on
OpenGameArt.org. None of it is music from, or a cover or remix of, any
Pokémon game or GeoGuessr. Each licence was checked on the track's page when
it was added (November 2026). Loops were kept at their exact length (so they
loop without a seam), downmixed to mono, set to a common loudness with a
constant gain (about -20 LUFS for loops, -18 LUFS for stings) and encoded as
Ogg Vorbis with an MP3 fallback.

| File | Title | Author | Licence | Source | Changes |
| --- | --- | --- | --- | --- | --- |
| `music/lobby.ogg` / `.mp3` | Stage Select (Chiptune Adventures) | Juhani Junkala (SubspaceAudio) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/4-chiptunes-adventure> | Gain, mono, re-encoded |
| `music/round.ogg` / `.mp3` | 8-bit concentration loop | cosmac | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/8-bit-concentration-loop> | Gain, mono, re-encoded |
| `music/duel.ogg` / `.mp3` | Boss Fight (Chiptune Adventures) | Juhani Junkala (SubspaceAudio) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/4-chiptunes-adventure> | Gain, mono, re-encoded |
| `music/win.ogg` / `.mp3` | Win jingle | Fupi | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/win-jingle> | First 2.3 s, faded out, gain, re-encoded |
| `music/lose.ogg` / `.mp3` | Game over short jingle | Kosmo The Cat | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/game-over-short-jingle> | First 4.2 s, faded out, gain, re-encoded |
| `music/draw.ogg` / `.mp3` | Victory sting | congusbongus | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/victory-sting> | The build-up only (first 1.5 s), faded out, gain, re-encoded |
