#!/usr/bin/env bash
# A contact sheet of a clip: sheet.sh clip.mp4 out.jpg [cols] [rows] [tile-width]
set -euo pipefail
in=$1; out=$2; cols=${3:-4}; rows=${4:-3}; tw=${5:-480}
n=$((cols * rows))
frames=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$in")
step=$(( (frames + n - 1) / n ))
ffmpeg -y -v error -i "$in" -vf "select='not(mod(n\,$step))',scale=$tw:-2,drawtext=text='%{n}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5,tile=${cols}x${rows}:padding=4:color=0x222222" -frames:v 1 -q:v 3 "$out"
