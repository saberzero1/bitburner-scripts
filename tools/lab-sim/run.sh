#!/usr/bin/env bash
# Labyrinth search strategies on the game's maze generator. usage: tools/lab-sim/run.sh <tag> [W H mazes offset]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/LabSim.test.ts" "$SRC/test/jest/LabSim.test.ts"
cd "$SRC"
SIM_W=${2:-60} SIM_H=${3:-40} SIM_MAZES=${4:-200} SIM_OFFSET=${5:-3} SIM_OUT="$HERE/out/$1.json" npx jest test/jest/LabSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
cat "$HERE/out/$1.json"
