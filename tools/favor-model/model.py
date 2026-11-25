"""Time to The Red Pill's Daedalus reputation, with the game's favour formulas (src/Faction/formulas/favor.ts).
Rep gain is base_rate * (1 + favour/100). Time unit: hours of grinding the full requirement at favour 0 (T0).
Policies: plain grind; Go favour first (400k rep-equivalent with SF14.3, applied at once); soft resets that turn the
rep earned so far into favour, each costing `overhead` hours (rejoining Daedalus, rebuilding stats).
usage: python3 tools/favor-model/model.py [T0 hours, default 13] [overhead hours, default 0.75]"""
import math, sys

LOG102 = 0.019802627296179712
rep_to_favor = lambda r: math.log1p(r / 25000) / LOG102
favor_to_rep = lambda f: 25000 * math.expm1(LOG102 * f)

T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 13.0
OVERHEAD = float(sys.argv[2]) if len(sys.argv) > 2 else 0.75
R = 1.0  # requirement (normalised); base rate 1/T0 per hour
REP_SCALE = 2.5e6 * 1.02 ** 74  # absolute requirement at BN12.74, only for the favour formula

def best(favor_rep, resets_left):
    """Min hours to reach R starting from rep 0 with `favor_rep` (favour as total-rep equivalent, absolute)."""
    f = rep_to_favor(favor_rep)
    straight = T0 * R / (1 + f / 100)
    if resets_left == 0:
        return straight, []
    best_t, best_plan = straight, []
    for i in range(1, 100):
        x = R * i / 100  # rep fraction earned before the reset
        t_before = T0 * x / (1 + f / 100)
        t_after, plan = best(favor_rep + x * REP_SCALE, resets_left - 1)
        t = t_before + OVERHEAD + t_after
        if t < best_t:
            best_t, best_plan = t, [round(x, 3)] + plan
    return best_t, best_plan

print(f"T0 {T0}h (grind at favour 0), reset overhead {OVERHEAD}h, requirement {REP_SCALE / 1e6:.1f}m rep")
for go in (0, 4e5):
    for k in (0, 1, 2, 3):
        t, plan = best(go, k)
        print(f"  Go favour {'yes' if go else 'no '}  up to {k} soft resets: {t:5.2f}h  resets at rep fractions {plan}")
