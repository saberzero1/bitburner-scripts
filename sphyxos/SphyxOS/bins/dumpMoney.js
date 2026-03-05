import {
    getBestFavor,
    getBestRep,
    getPlay,
    getAugsFromFaction,
    getOwnedAugs,
    purchaseAug,
    upgHomeRam,
} from "SphyxOS/util.js";
import {
    getReputationFromDonation,
    getGangFaction,
    getFactionFav,
    getFacRep,
    donateToFac,
    proxy,
} from "SphyxOS/util.js";
/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.atExit(() => ns.writePort(40, true));
    const FAVOR = await proxy(ns, "getFavorToDonate");
    const player = await getPlay(ns);
    const factions = player.factions;
    let gangFaction = await getGangFaction(ns);
    let bought = true;
    while (bought) {
        bought = false;
        for (const faction of factions) {
            const purchased = await getOwnedAugs(ns, true);
            /**@type {String[]} purchasable */
            let purchasable = await getAugsFromFaction(ns, faction);
            purchasable = purchasable
                .filter(
                    (p) => !purchased.includes(p) && p !== "NeuroFlux Governor",
                )
                .sort(
                    (a, b) =>
                        ns.singularity.getAugmentationPrice(b) -
                        ns.singularity.getAugmentationPrice(a),
                );
            for (const aug of purchasable) {
                //If we cant buy it and we have enough favor to donate, donate enough to get it
                let buy = await purchaseAug(ns, faction, aug);
                if (buy) bought = true;
                if (
                    !buy &&
                    (await getFactionFav(ns, faction)) >= FAVOR &&
                    faction !== gangFaction &&
                    faction !== "Bladeburners" &&
                    faction !== "Church of the Machine God" &&
                    faction !== "Shadows of Anarchy"
                ) {
                    if (
                        ns.singularity.getAugmentationPrice(aug) >
                        ns.getServerMoneyAvailable("home")
                    )
                        break; //If we can't afford the augment, stop donating
                    const donate = await getReputationFromDonation(ns, 1e6); //Rep for donating 1e6 dollars
                    const rep = await getFacRep(ns, faction);
                    const targetrep = ns.singularity.getAugmentationRepReq(aug);
                    if (
                        !(await donateToFac(
                            ns,
                            faction,
                            Math.min(
                                ((targetrep - rep) / donate) * 1e6 + 1000,
                                ns.getServerMoneyAvailable("home") - 1000000,
                            ),
                        ))
                    )
                        break;
                    buy = await purchaseAug(ns, faction, aug);
                    if (buy) bought = true;
                }
            } //End of pNoNFG
        } //End of factions
    } //End of While

    const bestRep = await getBestRep(ns); ///Has faction ahd rep attributes
    //First round of neuroflux - targetted at the best reputation place we have, filtering out gang and Bladeburners
    if (bestRep.rep > 0)
        while (await purchaseAug(ns, bestRep.faction, "NeuroFlux Governor")) {}
    //Donation round
    const bestFavor = await getBestFavor(ns); //Has faction and favor attributes
    if (bestFavor.favor >= FAVOR) {
        while (true) {
            await purchaseAug(ns, bestFavor.faction, "NeuroFlux Governor"); //Buy it
            const donate = await getReputationFromDonation(ns, 1e6); //Rep for donating 1e6 dollars
            const rep = await getFacRep(ns, bestFavor.faction);
            const targetRep =
                ns.singularity.getAugmentationRepReq("NeuroFlux Governor");
            if (
                ns.singularity.getAugmentationPrice("NeuroFlux Governor") >
                ns.getServerMoneyAvailable("home")
            )
                break;
            if (rep >= targetRep) continue; //We have enough rep, continue
            if (
                !(await donateToFac(
                    ns,
                    bestFavor.faction,
                    Math.min(
                        ((targetRep - rep) / donate) * 1e6 + 1000,
                        Math.max(
                            0,
                            ns.getServerMoneyAvailable("home") - 1000000,
                        ),
                    ),
                ))
            ) {
                await donateToFac(
                    ns,
                    bestFavor.faction,
                    ns.getServerMoneyAvailable("home") - 1000000,
                );
                break;
            }
        }
    }
    //Ram Upgrading Round
    while (await upgHomeRam(ns)) {}
}
