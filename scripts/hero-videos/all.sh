#!/usr/bin/env bash
# Records every hero clip (desktop and phone) against a production server.
#   POKEIQ_SECRET=… scripts/hero-videos/all.sh http://localhost:3000 [clip …]
# The server must run with the same POKEIQ_SECRET (the takes work out answers with it).
set -uo pipefail
base=${1:-http://localhost:3000}; shift || true
clips=("$@"); [ ${#clips[@]} -eq 0 ] && clips=(guessr pokedle connections pikadoku battle quizzes pokedex lab)
for c in "${clips[@]}"; do
  for f in desktop phone; do
    for try in 1 2 3; do
      echo "== $c $f (take $try)"
      if node scripts/hero-videos/record.mjs "$c" "$f" --base="$base" 2>&1 | tr '\r' '\n' | grep -v 'frames *$'; then
        [ -s "public/home/clips/$c-$f.mp4" ] && break
      fi
    done
    rm -rf "${HERO_OUT:-/tmp/pokeiq-hero-frames}/$c-$f"
  done
done
