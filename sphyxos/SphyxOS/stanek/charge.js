/** @param {NS} ns */
export async function main(ns) {
    let frags = JSON.parse(ns.args[0]); //Send all current fragments as the arguments.  Save exec cost
    for (const frag of frags) {
        if (frag.id < 100) await ns.stanek.chargeFragment(frag.x, frag.y);
    }
    ns.writePort(ns.pid, true);
}
