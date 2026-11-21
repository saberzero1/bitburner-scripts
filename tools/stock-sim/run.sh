#!/usr/bin/env bash
# Simulate servers/home/stockmaster.js against the real stock market (bitburner-src checkout).
# usage: tools/stock-sim/run.sh <tag> <hours> <capital> <4s: 0|1> '<stockmaster.js options JSON>'
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/StockSim.test.ts" "$SRC/test/jest/StockSim.test.ts"
cd "$SRC"
SIM_SCRIPT="$HERE/../../servers/home/stockmaster.js" SIM_HOURS=$2 SIM_CAPITAL=$3 SIM_4S=$4 SIM_ARGS="$5" SIM_OUT="$HERE/out/$1.json" \
  npx jest test/jest/StockSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
echo "$1 done"
