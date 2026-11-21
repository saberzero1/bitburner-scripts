"""Cheat-setting sweep on the weaker matchups. python3 cheats.py run <prefix> <games> | report <prefix>"""
import json, os, subprocess, sys, glob
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
import os as _os
SET = _os.environ.get("CHEAT_SET", "types")
if SET == "settings":
    MATCHUPS = [("Illuminati", 5), ("Tetrads", 5), ("Tetrads", 13), ("Daedalus", 13)]
    VARIANTS = {
        "base": {},
        "min3": {"cheat-min-capture": 3},
        "max2": {"max-cheats-per-game": 2},
        "min3_max2": {"cheat-min-capture": 3, "max-cheats-per-game": 2},
        "min2_max3_t08": {"cheat-min-capture": 2, "max-cheats-per-game": 3, "cheat-chance-threshold": 0.8},
    }
else:  # cheat types, each opponent on the board size go.js picks for it
    MATCHUPS = [("Netburners", 5), ("Slum Snakes", 5), ("The Black Hand", 13), ("Tetrads", 5), ("Daedalus", 5), ("Illuminati", 5)]
    M = {"cheat-min-capture": 2, "max-cheats-per-game": 3, "cheat-chance-threshold": 0.8}
    VARIANTS = {
        "none": {"disable-cheats": True},
        "twoMoves": {**M, "cheat-types": "twoMoves"},
        "twoMoves_min1": {**M, "cheat-types": "twoMoves", "cheat-min-capture": 1},
        "rescue": {**M, "cheat-types": "rescue"},
        "destroyEye": {**M, "cheat-types": "destroyEye"},
        "repair": {**M, "cheat-types": "repair"},
        "rescue_twoMoves": {**M, "cheat-types": "rescue,twoMoves"},
        "twoMoves_destroyEye": {**M, "cheat-types": "twoMoves,destroyEye"},
        "all": {**M, "cheat-types": "rescue,twoMoves,destroyEye,repair"},
    }
if sys.argv[1] == "run":
    pre, games = sys.argv[2], int(sys.argv[3])
    jobs = [(f"{pre}_{v}_{o.replace(' ', '')}{s}", json.dumps({"opponent": o, "board-size": s, **cfg})) for v, cfg in VARIANTS.items() for o, s in MATCHUPS]
    run = lambda j: subprocess.run([f"{HERE}/run.sh", j[0], str(games + 1), j[1]], stdout=subprocess.DEVNULL)
    with ThreadPoolExecutor(14) as ex: list(ex.map(run, jobs))
else:
    pre = sys.argv[2]
    print(f"{'variant':<20}" + "".join(f"{o[:9]+' '+str(s):>22}" for o, s in MATCHUPS) + "   (win% / power per game / cheats per game)")
    for v in VARIANTS:
        row = f"{v:<20}"
        for o, s in MATCHUPS:
            f = f"{OUT}/{pre}_{v}_{o.replace(' ', '')}{s}.json"
            if not os.path.exists(f): row += f"{'-':>22}"; continue
            r = json.load(open(f)); g = [x for x in r["games"][1:] if "won" in x and x["size"] == s]
            rows = [json.loads(l) for l in r.get("scriptResults", "").splitlines() if l.strip()]
            rows = [x for x in rows if x.get("size") == s]
            ch = sum(x.get("cheats", 0) for x in rows) / max(1, len(rows))
            row += f"{sum(x['won'] for x in g)/len(g):>10.0%} {sum(x['power'] for x in g)/len(g):>6.0f} {ch:>4.2f}"
        print(row)
