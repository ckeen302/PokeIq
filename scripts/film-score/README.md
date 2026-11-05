# Film scores

The source of the two films' original scores (public/audio/pokemon-story/theme-*.mp3
and public/audio/world-history/theme-*.mp3).

- `score.py` writes each stem as MIDI: one theme per film, arranged as stems of the
  same 24-bar piece (same key, tempo and length), plus a held chord for slow motion.
- `render.sh` plays them with FluidSynth and the MuseScore General sound font
  (`apt install fluidsynth musescore-general-soundfont`), keeps the middle of three
  passes so each stem loops seamlessly (`loopcut.py`, needs numpy), and loudness-matches
  the stems to -18 LUFS. Encode with ffmpeg/libmp3lame as listed in the CREDITS.md files.

    python3 -I score.py out && ./render.sh
