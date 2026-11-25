#!/usr/bin/env bash
# Darknet depth progress (air gap crossing) on the real network engine.
# usage: tools/dnet-sim/cross.sh <tag> [policy=depth] [anchor-policy=lab] [trials=5] [lab=4] [hours=12] [threads=1]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/CrossSim.test.ts" "$SRC/test/jest/CrossSim-$1.test.ts"
cd "$SRC"
SIM_POLICY="${2:-depth}" SIM_ANCHOR_POLICY="${3:-lab}" SIM_TRIALS="${4:-5}" SIM_LAB="${5:-4}" SIM_HOURS="${6:-12}" SIM_THREADS="${7:-1}" \
  SIM_OUT="$HERE/out/cross-$1.json" npx jest "test/jest/CrossSim-$1.test.ts" > "$HERE/out/cross-$1.log" 2>&1 || true
rm -f "$SRC/test/jest/CrossSim-$1.test.ts"
python3 "$HERE/cross-report.py" "$1"
