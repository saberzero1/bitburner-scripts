#!/usr/bin/env bash
# Simulate servers/home/corporation.js against the real corporation engine from a bitburner-src checkout.
# usage: tools/corp-sim/run.sh <tag> <valuationMult> <divisionsMult> <softcap> <hours> '<script options JSON>'
# e.g.   tools/corp-sim/run.sh bn12_r4 0.236 0.5 0.8 72 '{"investment-rounds":4}'
# Results: tools/corp-sim/out/<tag>.json; summarize with: python3 tools/corp-sim/takeoff.py bn12
# Needs: BITBURNER_SRC (default ~/Repos/bitburner-src) with `npm ci` done. Copies the harness into its test/jest.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/CorpSim.test.ts" "$SRC/test/jest/CorpSim.test.ts"
cd "$SRC"
SIM_SCRIPT="$HERE/../../servers/home/corporation.js" SIM_MULT=$2 SIM_DIVMULT=$3 SIM_SOFTCAP=$4 SIM_HOURS=$5 SIM_ARGS="$6" \
  SIM_OUT="$HERE/out/$1.json" npx jest test/jest/CorpSim.test.ts > "$HERE/out/$1.log" 2>&1
echo "$1 done"
