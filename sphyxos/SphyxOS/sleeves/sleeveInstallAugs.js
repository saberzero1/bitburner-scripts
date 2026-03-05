/** @param {NS} ns */
export async function main(ns) {
    /** @param {NS} ns */
    let port = ns.getPortHandle(ns.pid);
    ns.atExit(() => port.write(1));

    for (let slv = 0; slv < ns.sleeve.getNumSleeves(); slv++) {
        const augs = ns.sleeve.getSleevePurchasableAugs(slv);
        augs.forEach((a) => {
            try {
                ns.sleeve.purchaseSleeveAug(slv, a.name);
            } catch {}
        });
    }
}
