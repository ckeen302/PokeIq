#!/bin/bash
# Render each stem with FluidSynth, keep the second pass (a seamless loop
# that carries the first pass's reverb tails), normalise and encode.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
SF=/usr/share/sounds/sf3/MuseScore_General_Full.sf3
OUT=$D/out
STORY_LOOP=68.571429
WORLD_LOOP=82.285714
render() { # mid wav
  fluidsynth -ni -q -g 0.5 -r 44100 -o synth.reverb.active=1 -o synth.reverb.room-size=0.82 -o synth.reverb.damp=0.35 -o synth.reverb.width=1.0 -o synth.reverb.level=0.75 -o synth.chorus.active=0 -F "$2" "$SF" "$1" >/dev/null 2>&1
}
for f in "$OUT"/*.mid; do
  n=$(basename "$f" .mid)
  render "$f" "$OUT/$n.raw.wav"
  case $n in
    story-hold|world-hold) one=1; len=11.5 ;;
    story-*) one=0; len=$STORY_LOOP ;;
    world-*) one=0; len=$WORLD_LOOP ;;
  esac
  # -18 LUFS stems (the film's code sets their relative levels); a gentle high shelf for air.
  ffmpeg -v error -y -i "$OUT/$n.raw.wav" -af "highpass=f=28,treble=g=1.5:f=6000" "$OUT/$n.f.wav"
  python3 -I "$D/loopcut.py" "$OUT/$n.f.wav" "$OUT/$n.cut.wav" "$len" "$one"
  m=$(ffmpeg -hide_banner -i "$OUT/$n.cut.wav" -af loudnorm=I=-18:TP=-2:LRA=20:print_format=json -f null - 2>&1 | python3 -I -c "import sys,json;t=sys.stdin.read();j=json.loads(t[t.rindex('{'):]);print(f\"measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}\")")
  ffmpeg -v error -y -i "$OUT/$n.cut.wav" -af "loudnorm=I=-18:TP=-2:LRA=20:linear=true:$m,aresample=44100" "$OUT/$n.wav"
  echo "$n $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$n.wav")"
done
