import { printProfit } from "SphyxOS/util.js";
import {
    getHackPercent,
    getHckTime,
    getGrowThreads,
    getHackChance,
} from "SphyxOS/forms.js";
let weakenStrength = 0.05;
/** @param {NS} ns **/
export async function main(ns) {
    /** @type {Server[]} servers */
    const servers = getServers(ns);
    const first = ns.args[0];
    const player = ns.getPlayer();
    weakenStrength = ns.weakenAnalyze(1);
    let bestratio = 0;
    let bestsec = Infinity;
    let bestserver;
    for (const server of servers) {
        if (
            server.minDifficulty === 100 ||
            server.requiredHackingSkill > player.skills.hacking ||
            !server.hasAdminRights ||
            server.hostname === "home" ||
            server.moneyMax === 0 ||
            server.purchasedByPlayer
        )
            continue;
        const batchinfo = getHackP(ns, server, -1, -1, 1);
        const hchance = getHackChance(
            ns,
            server.hostname,
            server.minDifficulty,
        );
        const hackingTime = getHckTime(
            ns,
            server.hostname,
            server.minDifficulty,
        );

        //Weaken time at minimal difficulty
        let weaktime = hackingTime * 4;
        weaktime = weaktime === 0 ? 4 : weaktime;
        const totalthreads =
            batchinfo.H1 + batchinfo.G1 + batchinfo.W2 + batchinfo.W1;
        const ratio = printProfit(
            ns,
            weaktime,
            batchinfo.Take,
            1,
            totalthreads,
            hchance,
        );

        if (first && server.hackDifficulty - server.minDifficulty < bestsec) {
            bestsec = server.hackDifficulty - server.minDifficulty;
            bestratio = ratio;
            bestserver = server;
        } else if (
            first &&
            server.hackDifficulty - server.minDifficulty === bestsec &&
            ratio > bestratio
        ) {
            bestsec = server.hackDifficulty - server.minDifficulty;
            bestratio = ratio;
            bestserver = server;
        } else if (!first && ratio > bestratio) {
            bestratio = ratio;
            bestserver = server;
        }
    }
    const port = ns.getPortHandle(ns.pid);
    ns.atExit(() => port.write(bestserver));
}

/** @param {NS} ns */
export function getServers(ns) {
    const serverList = new Set(["home"]);
    for (const server of serverList) {
        for (const connection of ns.scan(server)) {
            serverList.add(connection);
        }
    }
    const serverDetails = [];
    for (const server of serverList) {
        serverDetails.push(ns.getServer(server));
    }
    return serverDetails;
}
/** @param {NS} ns */
function getHackP(ns, server, batches, threads, starthacks) {
    const hack_chance = getHackChance(
        ns,
        server.hostname,
        server.minDifficulty,
    );
    const hackperc = getHackPercent(ns, server.hostname, server.minDifficulty);
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
        let testthreads = starthacks;
        testthreads <= Math.min(Math.ceil(1 / hackperc), starthacks);
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
            server.hostname,
            server.moneyMax - moneytotake,
            server.minDifficulty + hysechack,
        );
        const hgwgthreads = getGrowThreads(
            ns,
            server.hostname,
            server.moneyMax - moneytotake,
            server.minDifficulty + hgwsechack,
        );
        const hwgwgthreads = getGrowThreads(
            ns,
            server.hostname,
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

        if (threads > 0) {
            hytotalbatches =
                Math.floor(threads / hytotalthreads) > batches || batches < 1
                    ? 0
                    : Math.floor(threads / hytotalthreads);
            hgwtotalbatches =
                Math.floor(threads / hgwtotalthreads) > batches || batches < 1
                    ? 0
                    : Math.floor(threads / hgwtotalthreads);
            hwgwtotalbatches =
                Math.floor(threads / hwgwtotalthreads) > batches || batches < 1
                    ? 0
                    : Math.floor(threads / hwgwtotalthreads);
        }

        let VALIDTEST = false;
        let hyratio = 0;
        let hgwratio = 0;
        let hwgwratio = 0;

        if (batches === -1 && threads === -1) {
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
        if (hgwratio > bestratio) {
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
        if (
            hwgwratio > bestratio ||
            (testthreads === Math.min(Math.ceil(1 / hackperc), starthacks) &&
                bestratio === 0)
        ) {
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
        const mults = ns.getBitNodeMultipliers();
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
    return record;
}
