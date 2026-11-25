/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    let worth = 0;
    ns.atExit(() => port.write(worth > 0 ? worth : 1));
    for (let sym of ns.stock.getSymbols()) {
        const posi = ns.stock.getPosition(sym);
        if (posi[0] > 0) {
            if (ns.ui.getGameInfo()?.versionNumber >= 44)
                worth += ns.stock.getSaleGain(sym, posi[0], "L");
            else worth += ns.stock.getSaleGain(sym, posi[0], "long");
        }
        if (posi[2] > 0) {
            if (ns.ui.getGameInfo()?.versionNumber >= 44)
                worth += ns.stock.getSaleGain(sym, posi[2], "S");
            else worth += ns.stock.getSaleGain(sym, posi[2], "short");
        }
    }
}
