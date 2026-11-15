import {
    getHackPercent,
    getGrowThreads,
    getHackChance,
    getBNMults,
} from "SphyxOS/forms.js";

/** @param {NS} ns */
export async function main(ns) {
    const port = ns.getPortHandle(ns.pid);
    //ns.args[0] is the target, 1 is batches, 2 is threads, 3 is starthacks
    const server = ns.getServer(ns.args[0]);
    const hack_chance = getHackChance(ns, ns.args[0], server.minDifficulty);
    const weakenStrength = ns.weakenAnalyze(1);
    const hackperc = getHackPercent(ns, ns.args[0], server.minDifficulty);
    let moneytotake = 0;
    let hytotalbatches = 1;
    let hgwtotalbatches = 1;
    let hwgwtotalbatches = 1;
    let besttake = 0;
    let besth1threads = 0;
    let bestw1threads = 0;
    let bestg1threads = 0;
    let bestw2threads = 0;
    let besttype = "HGW";
    let bestratio = 0;

    for (
        let testthreads = Math.min(Math.ceil(1 / hackperc), ns.args[3]);
        testthreads <= Math.max(Math.ceil(1 / hackperc), ns.args[3]);
        testthreads++
    ) {
        moneytotake =
            hackperc * testthreads >= 1
                ? server.moneyMax - 1
                : hackperc * server.moneyMax * testthreads;
        // Hybrid hacking threads and it's security threads
        let hysechack = testthreads * 0.002; //Security added from hacking
        const hyw1threads = Math.floor(hysechack / weakenStrength); //Take out the hybrid amount - just enough
        hysechack -= hyw1threads * weakenStrength;
        // HGW hacking threads and it's security threads
        const hgwsechack = testthreads * 0.002; //Security added from hacking which will carry over
        // HWGW hacking threads and it's security threads
        let hwgwsechack = testthreads * 0.002; //Security added from hacking
        const hwgww1threads = Math.ceil(hwgwsechack / weakenStrength); //Take it all out
        //Hybrid and HGW have some security left.  HWGW does not
        const hygthreads = getGrowThreads(
            ns,
            ns.args[0],
            server.moneyMax - moneytotake,
            server.minDifficulty + hysechack,
        );
        const hgwgthreads = getGrowThreads(
            ns,
            ns.args[0],
            server.moneyMax - moneytotake,
            server.minDifficulty + hgwsechack,
        );
        const hwgwgthreads = getGrowThreads(
            ns,
            ns.args[0],
            server.moneyMax - moneytotake,
            server.minDifficulty,
        );

        moneytotake *= hack_chance;
        //Last weaken threads for the grows and remaining from hacks
        const hysecgrow = hygthreads * 0.004;
        const hgwsecgrow = hgwgthreads * 0.004;
        const hwgwsecgrow = hwgwgthreads * 0.004;

        //Get weaken threads
        const hyw2threads = Math.ceil((hysecgrow + hysechack) / weakenStrength);
        const hgww2threads = Math.ceil(
            (hgwsecgrow + hgwsechack) / weakenStrength,
        );
        const hwgww2threads = Math.ceil(hwgwsecgrow / weakenStrength);

        //Get total thread count
        const hytotalthreads =
            testthreads + hyw1threads + hygthreads + hyw2threads;
        const hgwtotalthreads = testthreads + hgwgthreads + hgww2threads;
        const hwgwtotalthreads =
            testthreads + hwgww1threads + hwgwgthreads + hwgww2threads;

        if (ns.args[2] > 0) {
            hytotalbatches =
                Math.floor(ns.args[2] / hytotalthreads) > ns.args[1] ||
                ns.args[1] < 1
                    ? 0
                    : Math.floor(ns.args[2] / hytotalthreads);
            hgwtotalbatches =
                Math.floor(ns.args[2] / hgwtotalthreads) > ns.args[1] ||
                ns.args[1] < 1
                    ? 0
                    : Math.floor(ns.args[2] / hgwtotalthreads);
            hwgwtotalbatches =
                Math.floor(ns.args[2] / hwgwtotalthreads) > ns.args[1] ||
                ns.args[1] < 1
                    ? 0
                    : Math.floor(ns.args[2] / hwgwtotalthreads);
        }

        let VALIDTEST = false;
        let hyratio = 0;
        let hgwratio = 0;
        let hwgwratio = 0;

        if (ns.args[1] === -1 && ns.args[2] === -1) {
            //Simply get the best.  Assume unlimited batches/threads
            hyratio = moneytotake / hytotalthreads;
            hgwratio = moneytotake / hgwtotalthreads;
            hwgwratio = moneytotake / hwgwtotalthreads;
        } else {
            hyratio = (moneytotake / hytotalthreads) * hytotalbatches;
            hgwratio = (moneytotake / hgwtotalthreads) * hgwtotalbatches;
            hwgwratio = (moneytotake / hwgwtotalthreads) * hwgwtotalbatches;
        }
        if (hyratio || hgwratio || hwgwratio) VALIDTEST = true;

        // Just cascade the possibilities
        let failed = 0;
        //HGW
        if (
            hgwratio > bestratio ||
            (testthreads === Math.ceil(1 / hackperc) && bestratio === 0)
        ) {
            bestratio = hgwratio;
            besttake = moneytotake;
            besth1threads = testthreads;
            bestw1threads = 0;
            bestg1threads = hgwgthreads;
            bestw2threads = hgww2threads;
            besttype = "HGW";
        } else failed++;
        //Hybrid
        if (hyratio > bestratio) {
            bestratio = hyratio;
            besttake = moneytotake;
            besth1threads = testthreads;
            bestw1threads = hyw1threads;
            bestg1threads = hygthreads;
            bestw2threads = hyw2threads;
            besttype = "Hybrid";
        } else failed++;
        //HWGW
        if (hwgwratio > bestratio) {
            // || testthreads == Math.ceil(1 / hackperc)) { //Our default for the highest possible
            bestratio = hwgwratio;
            besttake = moneytotake;
            besth1threads = testthreads;
            bestw1threads = hwgww1threads;
            bestg1threads = hwgwgthreads;
            bestw2threads = hwgww2threads;
            besttype = "HWGW";
        } else failed++;
        if (failed === 3 && VALIDTEST) break; //We are done.  Nothing better
    } // for loop to max threads

    let takemult = 1;
    try {
        const mults = getBNMults(ns);
        takemult = mults.ScriptHackMoneyGain;
    } catch {}
    //Create return object
    const record = {
        H1: besth1threads,
        W1: bestw1threads,
        G1: bestg1threads,
        W2: bestw2threads,
        Type: besttype,
        Take: besttake * takemult,
        HackP: hackperc,
        Chance: hack_chance,
    };

    ns.atExit(() => {
        port.write(record);
    });
}
