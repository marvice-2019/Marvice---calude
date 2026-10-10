#!/bin/sh
# Finalise the render: pick the poster frame into brag.jpg, bake it in as frame 0
# of brag.mp4 (same frame count, same length), and bring the audio to -14 LUFS
# with a -2 dBTP ceiling (AAC adds ~0.6 dB) for social feeds. Works from the untouched render in
# work/brag-raw.mp4 so it can be re-run.
#   ./hf.sh render -o work/brag-raw.mp4 && ./poster.sh [time-in-seconds]   (default 3.0: the hook fully settled)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
AT="${1:-3.0}"
OUT="$HERE/brag.mp4"
RAW="$HERE/work/brag-raw.mp4"
POSTER="$HERE/brag.jpg"
TMP="$HERE/work/brag-final.mp4"
mkdir -p "$HERE/work"
[ -f "$RAW" ] || cp "$OUT" "$RAW"   # first run: adopt the render as the raw copy
DUR=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$RAW")

ffmpeg -y -v error -ss "$AT" -i "$RAW" -frames:v 1 -q:v 2 "$POSTER"

# Measure integrated loudness, then apply a plain gain to reach -14 LUFS with an
# oversampled brick-wall limiter at -1.5 dBTP (loudnorm's own limiter overshoots
# on short transients such as the keypresses and the bell).
M=$(ffmpeg -v info -i "$RAW" -vn -af "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/{/,/}/p')
measured() { printf '%s' "$M" | sed -n "s/.*\"$1\" *: *\"\([^\"]*\)\".*/\1/p" | head -1; }
[ -n "$(measured input_i)" ] || { echo "loudness measurement failed" >&2; printf '%s\n' "$M" >&2; exit 1; }
GAIN=$(awk -v i="$(measured input_i)" 'BEGIN{printf "%.2f", -14 - i}')
echo "measured: I=$(measured input_i) LUFS  TP=$(measured input_tp) dBTP -> gain ${GAIN} dB, limiter -2 dBTP"
AF="aresample=192000,volume=${GAIN}dB,alimiter=limit=0.794:attack=2:release=60:asc=1:level=false,aresample=48000,atrim=0:${DUR}"

ffmpeg -y -v error -i "$RAW" -i "$POSTER" \
  -filter_complex "[1:v]scale=1920:1080,format=rgb24[p];[0:v][p]overlay=enable='eq(n,0)':eof_action=pass:format=auto,format=yuv420p[v];[0:a]${AF}[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 16 -c:a aac -b:a 192k -movflags +faststart "$TMP"
mv "$TMP" "$OUT"
echo "poster: $POSTER (from ${AT}s), baked as frame 0 of $OUT; raw render kept at $RAW"
