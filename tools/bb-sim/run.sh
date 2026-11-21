#!/usr/bin/env bash
# Simulate servers/home/bladeburner.js against the real Bladeburner engine (bitburner-src checkout).
# usage: tools/bb-sim/run.sh <tag> <hours> <starting stat level> '<bladeburner.js options JSON>'
# Env: SIM_LEVEL_MULT / SIM_RANK_MULT / SIM_SKILLCOST_MULT (defaults: BN12.73 values 0.236 / 0.236 / 4.24)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/BbSim.test.ts" "$SRC/test/jest/BbSim.test.ts"
cd "$SRC"
SIM_SLEEVE_TASKS="${SIM_SLEEVE_TASKS:-[]}" SIM_SLEEVES_FILE="${SIM_SLEEVES_FILE:-}" SIM_PLAYER="${SIM_PLAYER:-}" SIM_SCRIPT="$HERE/../../servers/home/bladeburner.js" SIM_HOURS=$2 SIM_STATS=$3 SIM_ARGS="$4" SIM_OUT="$HERE/out/$1.json" \
  npx jest test/jest/BbSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
echo "$1 done"
