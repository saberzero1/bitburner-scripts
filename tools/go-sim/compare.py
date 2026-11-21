"""Compare opponent choosers over a fixed simulated time.
run:    python3 compare.py run <prefix> <hours> <seeds>
report: python3 compare.py report <prefix>"""
import json, os, subprocess, sys, glob, math
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
CONFIGS = {"old_winrate13": {"chooser": "winrate", "board-size": 13}, "new_marginal_auto": {"chooser": "marginal"}}
BONUS = {"Netburners": 1.3, "Slum Snakes": 1.2, "The Black Hand": 0.9, "Tetrads": 0.7, "Daedalus": 1.1, "Illuminati": 0.7}
USEFUL = {"Netburners": 0.4, "Slum Snakes": 0.5, "The Black Hand": 1, "Tetrads": 0.4, "Daedalus": 1, "Illuminati": 1.2}
WHAT = {"Netburners": "hacknet $", "Slum Snakes": "crime success", "The Black Hand": "hacking $", "Tetrads": "combat stats", "Daedalus": "rep", "Illuminati": "hack speed"}
if sys.argv[1] == "run":
    pre, hours, seeds = sys.argv[2], sys.argv[3], int(sys.argv[4])
    jobs = [(f"{pre}_{name}-{s}", json.dumps(cfg)) for name, cfg in CONFIGS.items() for s in range(1, seeds + 1)]
    def run(j):
        env = dict(os.environ, SIM_HOURS=hours)
        subprocess.run([f"{HERE}/run.sh", j[0], "999999", j[1]], stdout=subprocess.DEVNULL, env=env)
    with ThreadPoolExecutor(14) as ex: list(ex.map(run, jobs))
else:
    pre = sys.argv[2]
    eff = lambda p, o: math.log(p + 1) * (p + 1) ** 0.3 * 0.002 * BONUS[o] * 2  # x2: SF14 bonus
    for f in sorted(glob.glob(f"{OUT}/{pre}_*.json")):
        r = json.load(open(f)); st = r["finalStats"]
        bon = {o: eff(st.get(o, {}).get("nodePower", 0), o) for o in BONUS}
        weighted = sum(USEFUL[o] * bon[o] for o in BONUS)
        games = len(r["games"])
        print(f"{os.path.basename(f)[len(pre)+1:-5]:<22} {games:>5} games  weighted {weighted:.3f}  " + "  ".join(f"{WHAT[o]} +{bon[o]:.1%}" for o in BONUS))
