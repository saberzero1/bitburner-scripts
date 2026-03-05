/** @param {NS} ns */
export async function main(ns) {
    let upgradeCost = -1;
    const port = ns.getPortHandle(ns.pid);
    ns.atExit(() => {
        port.write(upgradeCost);
        ns.writePort(40, true);
    });
    await ns.sleep(100);
    let count = 0;
    while (true) {
        let upgradeType = 0;
        let upgradeItem = -1;
        upgradeCost = -1;
        if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
            upgradeCost = ns.hacknet.getPurchaseNodeCost();
            upgradeType = 5;
        }
        for (let i = 0; i < ns.hacknet.numNodes(); i++) {
            if (upgradeCost == -1) {
                //Might be first one if we've purchased them all.  We need to set the cost of something.  Do so then move on
                upgradeCost = ns.hacknet.getLevelUpgradeCost(i, 1);
                upgradeType = 1;
                upgradeItem = i;
            }
            if (ns.hacknet.getLevelUpgradeCost(i, 1) < upgradeCost) {
                upgradeCost = ns.hacknet.getLevelUpgradeCost(i, 1);
                upgradeType = 1;
                upgradeItem = i;
            }
            if (ns.hacknet.getRamUpgradeCost(i, 1) < upgradeCost) {
                upgradeCost = ns.hacknet.getRamUpgradeCost(i, 1);
                upgradeType = 2;
                upgradeItem = i;
            }
            if (ns.hacknet.getCoreUpgradeCost(i, 1) < upgradeCost) {
                upgradeCost = ns.hacknet.getCoreUpgradeCost(i, 1);
                upgradeType = 3;
                upgradeItem = i;
            }
            if (ns.hacknet.getCacheUpgradeCost(i, 1) < upgradeCost) {
                upgradeCost = ns.hacknet.getCacheUpgradeCost(i, 1);
                upgradeType = 4;
                upgradeItem = i;
            }
        }

        if (upgradeCost === Number.POSITIVE_INFINITY) {
            upgradeCost = 0;
            return;
        } //We have no upgrade
        else if (ns.getServerMoneyAvailable("home") < upgradeCost) return; //We don't have enough money to purchase
        switch (upgradeType) {
            case 1:
                ns.hacknet.upgradeLevel(upgradeItem, 1);
                break;
            case 2:
                ns.hacknet.upgradeRam(upgradeItem, 1);
                break;
            case 3:
                ns.hacknet.upgradeCore(upgradeItem, 1);
                break;
            case 4:
                ns.hacknet.upgradeCache(upgradeItem, 1);
                break;
            case 5:
                const num = ns.hacknet.purchaseNode();
                if (num >= 0) {
                    const hnetNode = "hacknet-server-" + num;
                    try {
                        ns.scp("SphyxOS/basic/weaken.js", hnetNode, "home");
                        ns.scp("SphyxOS/basic/grow.js", hnetNode, "home");
                        ns.scp("SphyxOS/basic/hack.js", hnetNode, "home");
                        ns.scp("SphyxOS/util.js", hnetNode, "home");
                        ns.scp("SphyxOS/forms.js", hnetNode, "home");
                    } catch {}
                }
                break;
            default:
                return;
        }
        count++;
        if (count % 200 === 0) await ns.sleep(0);
    }
}
