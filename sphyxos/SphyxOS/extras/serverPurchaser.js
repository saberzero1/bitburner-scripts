/** @param {NS} ns */
export async function main(ns) {
    let upgradecost = 1e150;
    const port = ns.getPortHandle(ns.pid);
    ns.atExit(() => port.write(upgradecost));

    const startRam = 2;
    // Iterator we'll use for our loop
    let i = ns.getPurchasedServers().length;
    if (ns.getPurchasedServerLimit() === 0) return;

    //Buy the base servers
    while (i < ns.getPurchasedServerLimit()) {
        // Check if we have enough money to purchase a server
        if (
            ns.getServerMoneyAvailable("home") >=
            ns.getPurchasedServerCost(startRam)
        ) {
            const server =
                i >= 10
                    ? ns.purchaseServer("pserv-" + i, startRam)
                    : ns.purchaseServer("pserv-0" + i, startRam);
            ns.scp("SphyxOS/basic/weaken.js", server, "home");
            ns.scp("SphyxOS/basic/grow.js", server, "home");
            ns.scp("SphyxOS/basic/hack.js", server, "home");
            ns.scp("SphyxOS/util.js", server, "home");
            ns.scp("SphyxOS/forms.js", server, "home");
            i++;
        } else {
            upgradecost = ns.getPurchasedServerCost(startRam);
            return;
        }
    }

    const servers = ns.getPurchasedServers();
    while (true) {
        //Cycle through every server.  Check each attribute for cost of upgrade
        //Upgrade the cheapest.  Keep upgrading indefinitally
        let upgradeitem = "";
        let ramupgrade = 0;
        upgradecost = 1e150;

        //Check all servers
        for (const server of servers) {
            //Get the cheapest one and document it
            if (
                ns.getPurchasedServerUpgradeCost(
                    server,
                    ns.getServerMaxRam(server) * 2,
                ) < upgradecost
            ) {
                upgradecost = ns.getPurchasedServerUpgradeCost(
                    server,
                    ns.getServerMaxRam(server) * 2,
                );
                upgradeitem = server;
                ramupgrade = ns.getServerMaxRam(server) * 2;
            }
        }
        //upgrade the server if we can
        if (ns.getServerMoneyAvailable("home") >= upgradecost)
            ns.upgradePurchasedServer(upgradeitem, ramupgrade);
        else {
            upgradecost =
                upgradecost === Number.POSITIVE_INFINITY ? 0 : upgradecost;
            return;
        }
    }
}
