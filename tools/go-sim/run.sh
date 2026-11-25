#!/usr/bin/env bash
# Simulate servers/home/go.js against the real IPvGO engine/AI from a bitburner-src checkout.
# usage: tools/go-sim/run.sh <tag> <games> '<go.js options JSON>'   e.g. run.sh ill5 100 '{"opponent":"Illuminati","board-size":5}'
# Env: SIM_CRIME (crime_success mult, default 1.6), SIM_SF14 (default 3), BITBURNER_SRC (default ~/Repos/bitburner-src)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/GoSim.test.ts" "$SRC/test/jest/GoSim.test.ts"
cd "$SRC"
SIM_SCRIPT="$HERE/../../servers/home/go.js" SIM_GAMES=$2 SIM_ARGS="$3" SIM_OUT="$HERE/out/$1.json" \
  npx jest test/jest/GoSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
echo "$1 done"
