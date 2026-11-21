"""Run and/or summarize a Go sweep.
run:     python3 sweep.py run <prefix> <games> [opponents...]   (all board sizes 5/7/9/13)
report:  python3 sweep.py report <prefix>"""
import json, os, subprocess, sys, glob, statistics
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
OPP = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"]
if sys.argv[1] == "run":
    pre, games = sys.argv[2], sys.argv[3]
    opps = sys.argv[4:] or OPP
    jobs = [(f"{pre}_{o.replace(' ', '')}_{s}", json.dumps({"opponent": o, "board-size": s})) for o in opps for s in (5, 7, 9, 13)]
    run = lambda j: subprocess.run([f"{HERE}/run.sh", j[0], str(int(games) + 1), j[1]], stdout=subprocess.DEVNULL)
    with ThreadPoolExecutor(14) as ex: list(ex.map(run, jobs))
else:
    def cheat_rate(r, size):
        rows = [json.loads(l) for l in r.get("scriptResults", "").splitlines() if l.strip()]
        rows = [x for x in rows if x.get("size") == size]
        return sum(x.get("cheats", 0) for x in rows) / len(rows) if rows else float("nan")
    pre = sys.argv[2]
    print(f"{'opponent':<15}{'size':>5}{'games':>6}{'win%':>7}{'power/game':>11}{'sim s/game':>11}{'power/hour':>11}{'wins/hour':>10}{'cheats/g':>9}")
    for f in sorted(glob.glob(f"{OUT}/{pre}_*.json")):
        r = json.load(open(f)); g = [x for x in r["games"] if "error" not in x][1:]  # first game: leftover board
        want = r["args"]["board-size"]; g = [x for x in g if x["size"] == want]
        if not g: print(os.path.basename(f), "no games", r["games"][:1]); continue
        sec = sum(x["ms"] for x in g) / 1000; wins = sum(x["won"] for x in g)
        print(f"{r['args']['opponent']:<15}{want:>5}{len(g):>6}{wins/len(g):>7.0%}{statistics.mean(x['power'] for x in g):>11.1f}{sec/len(g):>11.1f}{sum(x['power'] for x in g)/sec*3600:>11.0f}{wins/sec*3600:>10.1f}{cheat_rate(r, want):>9.2f}")
