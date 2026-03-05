/** @param {NS} ns */
export function getHackPercent(ns) {
    const port = ns.getPortHandle(ns.pid);
    ns.atExit(() => port.write(hackperc));

    const host = ns.getServer(ns.args[0]);
    host.hackDifficulty = ns.args[1];
    const player = ns.getPlayer();
    let hackperc = 0;
    try {
        hackperc = ns.formulas.hacking.hackPercent(host, player);
    } catch {
        const hackDifficulty = host.minDifficulty ?? 100;
        if (hackDifficulty >= 100) {
            hackperc = 0;
            return;
        }
        const requiredHackingSkill = host.requiredHackingSkill ?? 1e9;
        const balanceFactor = 240;
        const difficultyMult = (100 - hackDifficulty) / 100;
        const skillMult =
            (player.skills.hacking - (requiredHackingSkill - 1)) /
            player.skills.hacking;

        let percentMoneyHacked = 0;
        try {
            /** @type {BitNodeMultipliers} mults */
            const mults = ns.getBitNodeMultipliers();
            percentMoneyHacked =
                (difficultyMult *
                    skillMult *
                    player.mults.hacking_money *
                    mults.ScriptHackMoney) /
                balanceFactor;
        } catch {
            percentMoneyHacked =
                (difficultyMult * skillMult * player.mults.hacking_money) /
                balanceFactor;
        }
        hackperc = Math.min(1, Math.max(percentMoneyHacked, 0));
    }
    return;
}
