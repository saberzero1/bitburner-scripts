#!/usr/bin/env bash
# Simulate sleeves' gang-karma phase on the real sleeve engine. usage: tools/sleeve-sim/run.sh <tag> '<policy JSON>'
# Env passthrough: SIM_SLEEVES, SIM_INT, SIM_EXP_MULT, SIM_PLAYER_KARMA, SIM_HOURS. Results: tools/sleeve-sim/out/<tag>.json
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/SleeveSim.test.ts" "$SRC/test/jest/SleeveSim.test.ts"
cd "$SRC"
SIM_POLICY="${2:-{\}}" SIM_OUT="$HERE/out/$1.json" npx jest test/jest/SleeveSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
echo "$1 done"
