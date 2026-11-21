#!/usr/bin/env bash
# Darknet password solver benchmark against the real darknet engine (bitburner-src checkout).
# usage: tools/dnet-sim/run.sh <tag> [trials=10] [difficulties=2,8,16,30] [models=all]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/DnetSim.test.ts" "$SRC/test/jest/DnetSim.test.ts"
cd "$SRC"
SIM_PROBE="$HERE/../../servers/home/Remote/darknet-probe.js" SIM_TRIALS="${2:-10}" SIM_DIFFICULTIES="${3:-2,8,16,30}" \
  SIM_MODELS="${4:-}" SIM_OUT="$HERE/out/$1.json" npx jest test/jest/DnetSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
echo "$1 done"
