#!/usr/bin/env bash
# Go search ceiling: flat Monte Carlo black vs the real IPvGO AI (no cheats).
# usage: tools/go-sim/search.sh <tag> [opponent=Illuminati] [games=20] [rollouts=16] [size=5] [rollout-policy=Illuminati]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/SearchSim.test.ts" "$SRC/test/jest/SearchSim-$1.test.ts"
cd "$SRC"
SIM_OPPONENT="${2:-Illuminati}" SIM_GAMES="${3:-20}" SIM_ROLLOUTS="${4:-16}" SIM_SIZE="${5:-5}" SIM_ROLLOUT_POLICY="${6:-Illuminati}" \
  SIM_OUT="$HERE/out/search-$1.json" npx jest "test/jest/SearchSim-$1.test.ts" > "$HERE/out/search-$1.log" 2>&1 || true
rm -f "$SRC/test/jest/SearchSim-$1.test.ts"
python3 -c "
import json; d=json.load(open('$HERE/out/search-$1.json')); r=d['results']
print(f\"$1: {d['opponent']} {d['size']}x{d['size']} rollouts={d['rollouts']} policy={d['policy']}: won {sum(x['won'] for x in r)}/{len(r)}, mean margin {sum(x['margin'] for x in r)/len(r):.1f}\")"
