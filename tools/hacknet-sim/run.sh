#!/usr/bin/env bash
# Simulate daemon.js's hacknet policy with the real hacknet-upgrade-manager.js (bitburner-src checkout).
# usage: tools/hacknet-sim/run.sh <tag> <hours> <income $/s> '<tiers JSON [[payoffHours, moneyFraction],...]>' [kickstart payoff hours]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${BITBURNER_SRC:-$HOME/Repos/bitburner-src}"
mkdir -p "$HERE/out"
cp "$HERE/HacknetSim.test.ts" "$SRC/test/jest/HacknetSim.test.ts"
cd "$SRC"
SIM_PLAYER="${SIM_PLAYER:-}" SIM_CAPITAL="${SIM_CAPITAL:-1e9}" SIM_SCRIPT="$HERE/../../servers/home/hacknet-upgrade-manager.js" \
  SIM_HOURS=$2 SIM_INCOME=$3 SIM_TIERS="$4" SIM_KICKSTART="${5:-1}" SIM_OUT="$HERE/out/$1.json" \
  npx jest test/jest/HacknetSim.test.ts > "$HERE/out/$1.log" 2>&1 || true
echo "$1 done"
