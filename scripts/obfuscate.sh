#!/usr/bin/env bash
# Obfuscates the app's own JavaScript (not the bundled Google/MIT libraries) so the APK's code is hard to read or copy.
# Usage: scripts/obfuscate.sh <www-folder>   (edits the folder in place — run it on the build copy)
set -euo pipefail
DIR="$1"
for f in app.js ai.js render.js gender.js; do
  npx --yes javascript-obfuscator@4.1.1 "$DIR/$f" --output "$DIR/$f" \
    --compact true --identifiers-prefix "z${f%.js}" --identifier-names-generator hexadecimal --rename-globals false \
    --string-array true --string-array-encoding base64 --string-array-threshold 0.75 \
    --string-array-rotate true --string-array-shuffle true --split-strings false \
    --control-flow-flattening false --dead-code-injection false --self-defending false \
    --transform-object-keys false --unicode-escape-sequence false \
    --reserved-names '^(TR|AI|ATR|ATR_lockNow|GENDER|AndroidBridge|faceapi|SelfieSegmentation)$' >/dev/null
  echo "obfuscated $f"
done
