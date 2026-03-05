import { proxy } from "SphyxOS/util.js";
/** @param {NS} ns */
export async function main(ns) {
    let frags = await proxy(ns, "stanek.activeFragments");
    if (frags.length === 0) {
        ns.toast("Please select a loadout first", "error", 3000);
        ns.exit();
    }
    const stanekLocation = "/SphyxOSUserData/stanekLoadouts/";
    const defaultFileLocation = "/SphyxOS/stanek/loadouts/";
    let file;
    let defaultFile;
    while (true) {
        const name = await ns.prompt("Please name your loadout", {
            type: "text",
        });
        file =
            stanekLocation +
            ns.stanek.giftWidth() +
            "x" +
            ns.stanek.giftHeight() +
            "x" +
            name +
            ".txt";
        defaultFile =
            defaultFileLocation +
            ns.stanek.giftWidth() +
            "x" +
            ns.stanek.giftHeight() +
            "x" +
            name +
            ".txt";
        if (name === "") {
            ns.toast("Canceled out.  Save aborted.", "error", 3000);
            ns.exit();
        } else if (
            ns.fileExists(file, "home") ||
            ns.fileExists(defaultFile, "home")
        ) {
            ns.toast("File exists. Please chose a new name", "error", 3000);
        } else break;
    }
    for (let i = 0; i < frags.length; ++i) {
        let { x, y, rotation, id } = frags[i];
        frags[i] = { x: x, y: y, rotation: rotation, id: id };
    }
    ns.write(file, JSON.stringify(frags), "w");
    ns.toast("SUCCESS: Stanek Loadout saved to " + file, "success", 3000);
}
