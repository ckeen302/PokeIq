#!/bin/bash
# Prepares PokéGuessr's background music (public/audio/guessr/CREDITS.md lists
# each track, its author, licence and source). For each source file:
#   - trims the silence after the music ends (so the 2.6 s crossfade overlaps
#     music, not a gap), with a short fade-out;
#   - matches loudness to -18 LUFS integrated, true peak at most -1.5 dBTP,
#     as a plain gain change (two-pass loudnorm, linear);
#   - encodes Ogg Opus 96 kbps and MP3 96 kbps (for Safari).
#
#   scripts/guessr-music/encode.sh <source> <name> [<source> <name> ...]
#
# Deep House Sunset's vocals were removed before this step with Demucs
# (htdemucs, two stems: python -m demucs --two-stems=vocals -n htdemucs <file>);
# its no_vocals.wav is the source here.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
DEST=$D/../../public/audio/guessr
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
while [ $# -ge 2 ]; do
  src=$1 name=$2; shift 2
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
  # Where the closing silence (below -50 dB for 0.5 s or more) starts, if the track ends in one.
  end=$(ffmpeg -nostdin -hide_banner -i "$src" -af silencedetect=n=-50dB:d=0.5 -f null - 2>&1 | python3 -I -c "
import sys,re
dur=float('$dur'); t=sys.stdin.read()
s=[float(x) for x in re.findall(r'silence_start: ([\d.]+)',t)]
e=[float(x) for x in re.findall(r'silence_end: ([\d.]+)',t)]
last=s[-1] if s and (len(e)<len(s) or e[-1]>=dur-0.1) else dur
print(min(dur,last+0.3))")
  fade=$(python3 -I -c "print(max(0.0, $end-1.5))")
  ffmpeg -nostdin -v error -y -i "$src" -af "atrim=0:$end,afade=t=out:st=$fade:d=1.5" -ar 48000 -c:a pcm_s24le "$TMP/$name.wav"
  m=$(ffmpeg -nostdin -hide_banner -i "$TMP/$name.wav" -af loudnorm=I=-18:TP=-1.5:LRA=20:print_format=json -f null - 2>&1 | python3 -I -c "import sys,json;t=sys.stdin.read();j=json.loads(t[t.rindex('{'):]);print(f\"measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}\")")
  ffmpeg -nostdin -v error -y -i "$TMP/$name.wav" -af "loudnorm=I=-18:TP=-1.5:LRA=20:linear=true:$m,aresample=48000" -c:a libopus -b:a 96k -vbr constrained -application audio -map_metadata -1 "$DEST/$name.ogg"
  ffmpeg -nostdin -v error -y -i "$TMP/$name.wav" -af "loudnorm=I=-18:TP=-1.5:LRA=20:linear=true:$m,aresample=44100" -c:a libmp3lame -b:a 96k -map_metadata -1 -write_xing 1 "$DEST/$name.mp3"
  for f in "$DEST/$name.ogg" "$DEST/$name.mp3"; do
    echo "$(basename "$f") $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")s $(du -k "$f" | cut -f1)KB $(ffmpeg -nostdin -hide_banner -i "$f" -af ebur128=peak=true -f null - 2>&1 | grep -E '^\s+(I:|Peak:)' | tr -s ' ' | tr '\n' ' ')"
  done
done
