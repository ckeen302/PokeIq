#!/bin/bash
# Turns compose.py's raw renders into PokéGuessr's music files: loudness-matched
# to -18 LUFS integrated (true peak at most -1.5 dBTP, a plain gain change so
# the dynamics stay as written), then Ogg Opus and MP3 (for Safari) at 96 kbps.
#
#   python3 -I compose.py out && ./render.sh out
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
IN=${1:-$D/out}
DEST=$D/../../public/audio/guessr
mkdir -p "$DEST"
for raw in "$IN"/*.f32; do
  n=$(basename "$raw" .f32)
  ffmpeg -v error -y -f f32le -ar 44100 -ac 2 -i "$raw" "$IN/$n.wav"
  m=$(ffmpeg -hide_banner -i "$IN/$n.wav" -af loudnorm=I=-18:TP=-1.5:LRA=20:print_format=json -f null - 2>&1 | python3 -I -c "import sys,json;t=sys.stdin.read();j=json.loads(t[t.rindex('{'):]);print(f\"measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}\")")
  ffmpeg -v error -y -i "$IN/$n.wav" -af "loudnorm=I=-18:TP=-1.5:LRA=20:linear=true:$m,aresample=48000" -c:a libopus -b:a 96k -vbr constrained -application audio -map_metadata -1 "$DEST/$n.ogg"
  ffmpeg -v error -y -i "$IN/$n.wav" -af "loudnorm=I=-18:TP=-1.5:LRA=20:linear=true:$m,aresample=44100" -c:a libmp3lame -b:a 96k -map_metadata -1 -write_xing 1 "$DEST/$n.mp3"
  for f in "$DEST/$n.ogg" "$DEST/$n.mp3"; do
    echo "$(basename "$f") $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")s $(du -k "$f" | cut -f1)KB $(ffmpeg -hide_banner -i "$f" -af ebur128=peak=true -f null - 2>&1 | grep -E '^\s+(I:|Peak:)' | tr -s ' ' | tr '\n' ' ')"
  done
done
