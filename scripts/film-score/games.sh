#!/bin/bash
# The Games' fanfare and anthem: MIDI from games.py, played with FluidSynth and
# MuseScore General, faded, loudness-matched and encoded to MP3 in public/audio/games.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
SF=/usr/share/sounds/sf3/MuseScore_General_Full.sf3
OUT=$D/out-games
DEST=$D/../../public/audio/games
mkdir -p "$OUT" "$DEST"
python3 -I "$D/games.py" "$OUT"
for n in fanfare anthem; do
  fluidsynth -ni -q -g 0.5 -r 44100 -o synth.reverb.active=1 -o synth.reverb.room-size=0.86 -o synth.reverb.damp=0.3 -o synth.reverb.width=1.0 -o synth.reverb.level=0.8 -o synth.chorus.active=0 -F "$OUT/$n.raw.wav" "$SF" "$OUT/games-$n.mid" >/dev/null 2>&1
  case $n in fanfare) len=6.2 ;; anthem) len=13.6 ;; esac
  # Trim to length with a fade on the reverb tail; -16 LUFS; air on top.
  ffmpeg -v error -y -i "$OUT/$n.raw.wav" -af "atrim=0:$len,afade=t=out:st=$(python3 -I -c "print($len-1.4)"):d=1.4,highpass=f=30,treble=g=1.5:f=6000" "$OUT/$n.f.wav"
  m=$(ffmpeg -hide_banner -i "$OUT/$n.f.wav" -af loudnorm=I=-16:TP=-1.5:LRA=14:print_format=json -f null - 2>&1 | python3 -I -c "import sys,json;t=sys.stdin.read();j=json.loads(t[t.rindex('{'):]);print(f\"measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}\")")
  ffmpeg -v error -y -i "$OUT/$n.f.wav" -af "loudnorm=I=-16:TP=-1.5:LRA=14:linear=true:$m,aresample=44100" -c:a libmp3lame -b:a 160k "$DEST/$n.mp3"
  echo "$n $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DEST/$n.mp3")"
done
rm -rf "$OUT"
