/** Dump graftable augmentations (stats, graft cost and time) and the player's state to /Temp/graft-info.txt.
 * Diagnostic for planning grafts (see graft.js). */
export async function main(ns) {
    const augs = ns.grafting.getGraftableAugmentations();
    const player = ns.getPlayer();
    const out = {
        t: Date.now(),
        money: player.money,
        city: player.city,
        entropy: player.entropy,
        hacking: player.skills.hacking,
        intelligence: player.skills.intelligence,
        mults: player.mults,
        owned: ns.singularity.getOwnedAugmentations(true),
        augs: augs.map((name) => ({
            name,
            cost: ns.grafting.getAugmentationGraftPrice(name),
            time: ns.grafting.getAugmentationGraftTime(name),
            prereqs: ns.singularity.getAugmentationPrereq(name),
            stats: Object.fromEntries(Object.entries(ns.singularity.getAugmentationStats(name)).filter(([, v]) => v !== 1)),
        })),
    };
    ns.write("/Temp/graft-info.txt", JSON.stringify(out), "w");
    ns.tprint(`graft-info: ${augs.length} graftable augmentations written to /Temp/graft-info.txt`);
}
