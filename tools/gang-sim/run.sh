#!/usr/bin/env bash
# Simulate servers/home/gangs.js against the real gang engine (bitburner-src checkout).
# usage: tools/gang-sim/run.sh <tag> <hours> <income $/s> '<gangs.js options JSON>'
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/GangSim.test.ts" "$SRC/test/jest/GangSim.test.ts"
cd "$SRC"
SIM_4S="${SIM_4S:-0}" SIM_SCRIPT="$HERE/../../servers/home/gangs.js" SIM_HOURS=$2 SIM_INCOME=$3 SIM_ARGS="$4" SIM_OUT="$HERE/out/$1.json" \
  npx jest test/jest/GangSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
echo "$1 done"
