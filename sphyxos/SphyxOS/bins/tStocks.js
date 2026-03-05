import {
    hasWSEAcct,
    hasTIXAPIAccs,
    getSyms,
    getSalesGain,
    shortEnabled,
    has4SAPI,
    getmaxshares,
} from "SphyxOS/util.js";
import {
    getBidP,
    getAskP,
    getPosi,
    sellstock,
    sellshort,
    makeNewWindow,
} from "SphyxOS/util.js";
import { buyshort, buystock, getfv, getSnap, getWorth } from "SphyxOS/util.js";
import { getMoneyAvail } from "SphyxOS/util.js";

const SLEEPTM = 6000; // Default time of cycles
const MSGTICKS = 3; // How many tics will messages stay in the logs for?
const MSGTICKTM = SLEEPTM * MSGTICKS;
let SHORTS = false;
let S4DATA = false;
const SNAPS = 16;
const BUY_THREASH = 60;
const SELL_THREASH = 52;
let AUTOBUY = false;
let RESERVE = 0;
const TRANSACTION_COST = 100000; // Cost per transaction is 100k
const MIN_TRANSACTION = 10000000; // 10m
const MIN_STOCKS = 100;
const REPORT = 1000 * 60 * 60; // Every hour
let STARTWORTH = 0;
let RUNNINGTOTAL = 0;
let RUNNINGCOST = 0;
let RUNNINGBANKED = 0;
let WORKINGMONEY = 0;
let starttime = performance.now();
const HEIGHT = 400; //970
const WIDTH = 830;

const stocks = [];
const printmsgs = [];
let win;
/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.atExit(() => {
        UpdateHud();
        ns.clearPort(4);
        ns.writePort(1, 1);
        if (win) win.close();
    });
    ns.writePort(4, ns.pid);
    ns.writePort(1, 1);
    win = false;
    RESERVE = Number.isInteger(ns.args[0]) ? Number(ns.args[0]) : 0;
    await getCommands(ns);

    if (!(await hasWSEAcct(ns)) || !(await hasTIXAPIAccs(ns))) {
        ns.tprintf("WSE and TIX API Access are required to run this.");
        return;
    }
    //Initialize our master lists
    stocks.length = 0;
    printmsgs.length = 0;

    const syms = await getSyms(ns);
    for (const sym of syms) {
        let record = {
            sym: sym,
            snaps: [],
            s4forcast: 50,
            s4adjfcast: 50,
            forcast: 50,
            adjfcast: 50,
            regforcast: 50,
            regadjfcast: 50,
            posi: await getPosi(ns, sym),
            maxshares: await getmaxshares(ns, sym),
            s4volitile: 0,
            regvolitile: 0,
            volitile: 0,
            time: Date.now(),
        };
        stocks.push(record);
    }
    newMsg(ns, "Just Initialized");

    SHORTS = (await shortEnabled(ns)) === 1;
    AUTOBUY = ns.args.includes("autobuy");
    S4DATA = await has4SAPI(ns);
    STARTWORTH = 0;
    RUNNINGTOTAL = 0;
    RUNNINGCOST = 0;
    RUNNINGBANKED = 0;
    WORKINGMONEY = 0;
    await printLogs(ns, stocks);
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        UpdateHud(ns.format.number(await getWorth(ns), 3));
    else UpdateHud(ns.formatNumber(await getWorth(ns), 3));
    let count = 0;
    starttime = performance.now();

    ns.ui.openTail();
    ns.ui.resizeTail(WIDTH, HEIGHT);
    if (S4DATA) count = SNAPS; //Jump right in if we have 4s data
    let INITIALCHECKREQUIRED = true;
    while (true) {
        if (count === SNAPS) {
            printmsgs.length = 0;
            newMsg(ns, "Ready!");
            count++;
        }

        //Report!
        if (performance.now() >= starttime + REPORT) {
            starttime = performance.now();
            let endworth = await getWorth(ns);
            const combinedWorth = endworth + RUNNINGBANKED;
            if (combinedWorth > STARTWORTH) {
                if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                    ns.tprintf(
                        "INFO: Success!  After 1 hour %s turned into %s (%s%%)",
                        ns.format.number(STARTWORTH, 2),
                        ns.format.number(combinedWorth, 2),
                        ns.format.number((combinedWorth / STARTWORTH) * 100, 2),
                    );
                    newMsg(
                        ns,
                        "INFO: Success!  After 1 hour %s turned into %s (%s%%)",
                        ns.format.number(STARTWORTH, 2),
                        ns.format.number(combinedWorth, 2),
                        ns.format.number((combinedWorth / STARTWORTH) * 100, 2),
                    );
                } else {
                    ns.tprintf(
                        "INFO: Success!  After 1 hour %s turned into %s (%s%%)",
                        ns.formatNumber(STARTWORTH, 2),
                        ns.formatNumber(combinedWorth, 2),
                        ns.formatNumber((combinedWorth / STARTWORTH) * 100, 2),
                    );
                    newMsg(
                        ns,
                        "INFO: Success!  After 1 hour %s turned into %s (%s%%)",
                        ns.formatNumber(STARTWORTH, 2),
                        ns.formatNumber(combinedWorth, 2),
                        ns.formatNumber((combinedWorth / STARTWORTH) * 100, 2),
                    );
                }
            } else {
                if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                    ns.tprintf(
                        "INFO: Fail!  After 1 hour %s turned into %s (%s%%)",
                        ns.format.number(STARTWORTH, 2),
                        ns.format.number(combinedWorth, 2),
                        ns.format.number((combinedWorth / STARTWORTH) * 100, 2),
                    );
                    newMsg(
                        ns,
                        "INFO: Fail!  After 1 hour %s turned into %s (%s%%)",
                        ns.format.number(STARTWORTH, 2),
                        ns.format.number(combinedWorth, 2),
                        ns.format.number((combinedWorth / STARTWORTH) * 100, 2),
                    );
                } else {
                    ns.tprintf(
                        "INFO: Fail!  After 1 hour %s turned into %s (%s%%)",
                        ns.formatNumber(STARTWORTH, 2),
                        ns.formatNumber(combinedWorth, 2),
                        ns.formatNumber((combinedWorth / STARTWORTH) * 100, 2),
                    );
                    newMsg(
                        ns,
                        "INFO: Fail!  After 1 hour %s turned into %s (%s%%)",
                        ns.formatNumber(STARTWORTH, 2),
                        ns.formatNumber(combinedWorth, 2),
                        ns.formatNumber((combinedWorth / STARTWORTH) * 100, 2),
                    );
                }
            }
            STARTWORTH = endworth;
            RUNNINGTOTAL = 0;
            RUNNINGBANKED = 0;
        }

        //Switch to 4S if we can
        if (!S4DATA && (await has4SAPI(ns))) {
            S4DATA = true;
            newMsg(ns, "4S Data has been enabled!");
            count = SNAPS;
        }

        //Snapshot
        for (const stck of stocks) {
            const snap = await getSnap(ns, stck.sym);
            let record = {
                bidprice: snap.bidp,
                askprice: snap.askp,
                price: snap.price,
                spread: snap.askp - snap.bidp,
                time: performance.now(),
            };
            stck.snaps.push(record);
            stck.snaps.length > SNAPS ? stck.snaps.shift() : null;
        }
        //Update Forcast
        await updateForcast(ns, stocks);

        if (count >= SNAPS) {
            //Sell
            await sellItems(ns, stocks, "none");
            //Buy
            await buyItems(ns, stocks);
            if (INITIALCHECKREQUIRED) {
                STARTWORTH = await getWorth(ns); //Get our start worth after we have gone through the first buy/sell cycle.
                INITIALCHECKREQUIRED = false;
            }
        }

        if (count < SNAPS) {
            let msg = ns.sprintf("Pre-total snaps %s/%s", count, SNAPS);
            newMsg(ns, msg);
            count++;
        }
        await printLogs(ns, stocks);

        if (ns.ui.getGameInfo()?.versionNumber >= 44)
            UpdateHud(ns.format.number(await getWorth(ns)));
        else UpdateHud(ns.formatNumber(await getWorth(ns)));

        await ns.stock.nextUpdate();
        await getCommands(ns);
    } //Main while loop
}

/** @param {NS} ns */
function newMsg(ns, msg) {
    let record = {
        msg: msg,
        time: performance.now() + MSGTICKTM,
    };
    printmsgs.push(record);
}

/** @param {NS} ns */
function UpdateHud(totalWorth) {
    const doc = eval("document");
    const hook0 = doc.getElementById("overview-extra-hook-0");
    const hook1 = doc.getElementById("overview-extra-hook-1");

    try {
        const headers = [];
        const values = [];

        if (totalWorth === undefined) {
            hook0.innerText = "";
            hook1.innerText = "";
            return;
        }

        headers.push("Investments: ");
        values.push(totalWorth);

        hook0.innerText = headers.join(" \n");
        hook1.innerText = values.join("\n");
    } catch (err) {}
}

function clearLogs(ns) {
    ns.clearLog();
    if (win) win.clear();
}
function update(ns, text) {
    ns.printRaw(text);
    if (win && win.closed) {
        win = false;
        ns.writePort(1, "stocks popout off");
    }
    if (win) win.update(text);
}

/** @param {NS} ns */
async function printLogs(ns, stocks) {
    clearLogs(ns);
    //Clear the printmsgs queue so we just have fresh messages
    while (printmsgs.length > 0 && printmsgs[0].time <= performance.now())
        printmsgs.shift();

    for (const msg of printmsgs) {
        update(ns, msg.msg);
    }

    let totalpaid = 0;
    let totalvalue = 0;
    let totalshares = 0;
    let totalprofit = 0;
    //ns.printf("-----------------------------------------------------------------------")
    update(
        ns,
        ns.sprintf(
            "┌───────┬───────┬─────────┬─────────┬─────────┬──────────┬─────────┬────────┬──────┐",
        ),
    );
    update(
        ns,
        ns.sprintf(
            "│   SYM │  TYPE │  SHARES │    PAID │   VALUE │   PROFIT │ %% Change│  FCAST │ VOLI │",
        ),
    );
    update(
        ns,
        ns.sprintf(
            "├───────┼───────┼─────────┼─────────┼─────────┼──────────┼─────────┼────────┼──────┤",
        ),
    );

    for (const stk of stocks) {
        let paid = 0;
        let value = 0;
        let shares = 0;
        let profit = 0;
        let percentchange = 0;
        let type = "-----";
        if (stk.posi[0] > 0) {
            // Long position
            paid = stk.posi[0] * stk.posi[1];
            value =
                ns.ui.getGameInfo()?.versionNumber >= 44
                    ? await getSalesGain(ns, stk.sym, stk.posi[0], "L")
                    : await getSalesGain(ns, stk.sym, stk.posi[0], "long");
            shares = stk.posi[0];
            profit = value - paid;
            percentchange =
                profit > 0
                    ? (100 - (value / paid) * 100) * -1
                    : (100 - (value / paid) * 100) * -1;
            type = "Long ";
        } else if (stk.posi[2] > 0) {
            // Short position
            paid = stk.posi[2] * stk.posi[3];
            value =
                ns.ui.getGameInfo()?.versionNumber >= 44
                    ? await getSalesGain(ns, stk.sym, stk.posi[2], "S")
                    : await getSalesGain(ns, stk.sym, stk.posi[2], "short");
            shares = stk.posi[2];
            profit = value - paid;
            percentchange =
                profit > 0
                    ? (100 - (value / paid) * 100) * -1
                    : (100 - (value / paid) * 100) * -1;
            type = "Short";
        }
        totalpaid += paid;
        totalvalue += value;
        totalshares += shares;
        totalprofit += profit;

        if (ns.ui.getGameInfo()?.versionNumber >= 44)
            update(
                ns,
                ns.sprintf(
                    "│ %5s │ %4s │ %7s │ %7s │ %7s │ %8s │ %7s │ %6s │ %4s │",
                    stk.sym,
                    type,
                    shares > 0 ? ns.format.number(shares, 2) : "-------",
                    paid > 0 ? ns.format.number(paid, 2) : "-------",
                    value > 0 ? ns.format.number(value, 2) : "-------",
                    profit != 0 ? ns.format.number(profit, 2) : "--------",
                    percentchange != 0
                        ? ns.format.number(percentchange, 2)
                        : "-------",
                    ns.format.number(stk.forcast, 2),
                    ns.format.number(stk.volitile, 2),
                ),
            );
        else
            update(
                ns,
                ns.sprintf(
                    "│ %5s │ %4s │ %7s │ %7s │ %7s │ %8s │ %7s │ %6s │ %4s │",
                    stk.sym,
                    type,
                    shares > 0 ? ns.formatNumber(shares, 2) : "-------",
                    paid > 0 ? ns.formatNumber(paid, 2) : "-------",
                    value > 0 ? ns.formatNumber(value, 2) : "-------",
                    profit != 0 ? ns.formatNumber(profit, 2) : "--------",
                    percentchange != 0
                        ? ns.formatNumber(percentchange, 2)
                        : "-------",
                    ns.formatNumber(stk.forcast, 2),
                    ns.formatNumber(stk.volitile, 2),
                ),
            );
    }
    let totalpercentchange =
        totalpaid > 0
            ? (100 - ((totalvalue + RUNNINGBANKED) / totalpaid) * 100) * -1
            : 0;
    let worth = (await getWorth(ns)) + RUNNINGBANKED;
    update(
        ns,
        ns.sprintf(
            "├───────┴───────┼─────────┼─────────┼─────────┼──────────┼─────────┼────────┴──────┤",
        ),
    );
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        update(
            ns,
            ns.sprintf(
                "│Start: %8s│ %7s │ %7s │ %7s │ %8s │ %7s │Gain: %7s%% │",
                "$" + ns.format.number(STARTWORTH, 2),
                ns.format.number(totalshares, 2),
                ns.format.number(totalpaid, 2),
                ns.format.number(totalvalue, 2),
                ns.format.number(totalprofit, 2),
                ns.format.number(totalpercentchange, 2),
                STARTWORTH === 0
                    ? 0
                    : ns.format.number((worth / STARTWORTH - 1) * 100, 2),
            ),
        );
    else
        update(
            ns,
            ns.sprintf(
                "│Start: %8s│ %7s │ %7s │ %7s │ %8s │ %7s │Gain: %7s%% │",
                "$" + ns.formatNumber(STARTWORTH, 2),
                ns.formatNumber(totalshares, 2),
                ns.formatNumber(totalpaid, 2),
                ns.formatNumber(totalvalue, 2),
                ns.formatNumber(totalprofit, 2),
                ns.formatNumber(totalpercentchange, 2),
                STARTWORTH === 0
                    ? 0
                    : ns.formatNumber((worth / STARTWORTH - 1) * 100, 2),
            ),
        );
    update(
        ns,
        ns.sprintf(
            "├───────────────┴─────────┼─────────┴─────────┼──────────┴─────────┼───────────────┘",
        ),
    );
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        update(
            ns,
            ns.sprintf(
                "│Sales: %18s│Fees: %13s│Banked: %12s│",
                "$" + ns.format.number(RUNNINGTOTAL, 2),
                "$" + ns.format.number(RUNNINGCOST, 2),
                "$" + ns.format.number(RUNNINGBANKED, 2),
            ),
        );
    else
        update(
            ns,
            ns.sprintf(
                "│Sales: %18s│Fees: %13s│Banked: %12s│",
                "$" + ns.formatNumber(RUNNINGTOTAL, 2),
                "$" + ns.formatNumber(RUNNINGCOST, 2),
                "$" + ns.formatNumber(RUNNINGBANKED, 2),
            ),
        );
    const tm =
        ns.ui.getGameInfo()?.versionNumber >= 44
            ? ns.format.time(starttime + REPORT - performance.now())
            : ns.tFormat(starttime + REPORT - performance.now());
    update(
        ns,
        ns.sprintf(
            "└─────────────────────────┴───────────────────┴────────────────────┘",
        ),
    );
    update(ns, ns.sprintf("Update in: " + tm));
}

/** @param {NS} ns */
async function updateForcast(ns, stocks) {
    // Cycle through our stocks and update the forcast
    for (let stk of stocks) {
        //Update 4S forcast
        if (S4DATA) {
            const fv = await getfv(ns, stk.sym);
            stk.s4forcast = fv.forcast * 100; //await getFCast(ns, stk.sym) * 100
            stk.s4adjfcast =
                stk.s4forcast >= 50 ? stk.s4forcast : 100 - stk.s4forcast;
            stk.s4volitile = fv.vol * 100; //await getVol(ns, stk.sym) * 100
        }
        //Process the snapshot
        //We are going to track 3 values and average them out.  Price, AskPrice, BidPrice
        let price = 0;
        let totalprice = 0;
        //-----------------
        let ask = 0;
        let totalask = 0;
        //-----------------
        let bid = 0;
        let totalbid = 0;
        //-----------------
        let vol = 0;
        let bestvol = 0;
        //-----------------
        for (let i = 0; i < stk.snaps.length - 1; i++) {
            price += stk.snaps[i + 1].price - stk.snaps[i].price;
            totalprice += Math.abs(stk.snaps[i + 1].price - stk.snaps[i].price);
            ask += stk.snaps[i + 1].askprice - stk.snaps[i].askprice;
            totalask += Math.abs(
                stk.snaps[i + 1].askprice - stk.snaps[i].askprice,
            );
            bid += stk.snaps[i + 1].bidprice - stk.snaps[i].bidprice;
            totalbid += Math.abs(
                stk.snaps[i + 1].bidprice - stk.snaps[i].bidprice,
            );
            vol =
                stk.snaps[i + 1].price > stk.snaps[i].price
                    ? stk.snaps[i + 1].price / stk.snaps[i].price - 1
                    : stk.snaps[i].price / stk.snaps[i + 1].price - 1;
            vol *= 100;
            if (vol > bestvol) bestvol = vol;
        }
        if (totalprice == 0) {
            stk.regforcast = 50;
            stk.regadjfcast = 50;
            stk.regvolitile = 0;
        } else {
            let pfcast = (price / totalprice) * 50 + 50;
            let afcast = (ask / totalask) * 50 + 50;
            let bfcast = (bid / totalbid) * 50 + 50;

            stk.regforcast = (pfcast + afcast + bfcast) / 3;
            stk.regadjfcast =
                stk.regforcast >= 50 ? stk.regforcast : 100 - stk.regforcast;
            stk.regvolitile = bestvol;
        }

        if (S4DATA) {
            stk.forcast = stk.s4forcast;
            stk.adjfcast = stk.s4adjfcast;
            stk.volitile = stk.s4volitile;
        } else {
            stk.forcast = stk.regforcast;
            stk.adjfcast = stk.regadjfcast;
            stk.volitile = stk.regvolitile;
        }
    }
    stocks.sort((a, b) => {
        return a.forcast - b.forcast;
    });
}

/** @param {NS} ns */
async function sellItems(ns, stocks, arg) {
    //Send the arg of 'sell' to sell everything
    for (const stk of stocks) {
        if (
            (stk.posi[0] > 0 && stk.forcast <= SELL_THREASH) ||
            (stk.posi[0] > 0 && arg && arg == "sell")
        ) {
            // We have Longs to sell
            const sellprice = await sellstock(ns, stk.sym, stk.posi[0]);
            WORKINGMONEY += sellprice * stk.posi[0] - TRANSACTION_COST;
            RUNNINGCOST -= TRANSACTION_COST;
            RUNNINGTOTAL += sellprice * stk.posi[0] - stk.posi[0] * stk.posi[1];
            if (sellprice >= stk.posi[1]) {
                // Profit
                const profit =
                    sellprice * stk.posi[0] - stk.posi[0] * stk.posi[1];
                if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                    const msg = ns.sprintf(
                        "WARN: Selling %s long for $%s ($%s profit)",
                        stk.sym,
                        ns.format.number(sellprice * stk.posi[0], 2),
                        ns.format.number(profit, 2),
                    );
                    newMsg(ns, msg);
                } else {
                    const msg = ns.sprintf(
                        "WARN: Selling %s long for $%s ($%s profit)",
                        stk.sym,
                        ns.formatNumber(sellprice * stk.posi[0], 2),
                        ns.formatNumber(profit, 2),
                    );
                    newMsg(ns, msg);
                }
            } else {
                // Loss
                if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                    const loss =
                        sellprice * stk.posi[0] - stk.posi[0] * stk.posi[1];
                    const msg = ns.sprintf(
                        "WARN: Selling %s long for $%s ($%s loss)",
                        stk.sym,
                        ns.format.number(sellprice * stk.posi[0], 2),
                        ns.format.number(loss, 2),
                    );
                    newMsg(ns, msg);
                } else {
                    const loss =
                        sellprice * stk.posi[0] - stk.posi[0] * stk.posi[1];
                    const msg = ns.sprintf(
                        "WARN: Selling %s long for $%s ($%s loss)",
                        stk.sym,
                        ns.formatNumber(sellprice * stk.posi[0], 2),
                        ns.formatNumber(loss, 2),
                    );
                    newMsg(ns, msg);
                }
            }
            stk.posi[0] = 0;
            stk.posi[1] = 0;
        }
        if (
            (stk.posi[2] > 0 && stk.forcast >= 100 - SELL_THREASH) ||
            (stk.posi[2] > 0 && arg && arg == "sell")
        ) {
            // We have shorts to sell
            const shortsales =
                ns.ui.getGameInfo()?.versionNumber >= 44
                    ? await getSalesGain(ns, stk.sym, stk.posi[2], "S")
                    : await getSalesGain(ns, stk.sym, stk.posi[2], "short");
            WORKINGMONEY += shortsales - TRANSACTION_COST;
            RUNNINGCOST -= TRANSACTION_COST;
            const paidshort = stk.posi[2] * stk.posi[3];
            RUNNINGTOTAL += shortsales - paidshort;
            await sellshort(ns, stk.sym, stk.posi[2]);
            if (shortsales >= paidshort) {
                // Profit
                if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                    const profit = shortsales - paidshort; // - (sellprice * posi[2])
                    const msg = ns.sprintf(
                        "WARN: Selling %s short for $%s ($%s profit)",
                        stk.sym,
                        ns.format.number(shortsales, 2),
                        ns.format.number(profit, 2),
                    );
                    newMsg(ns, msg);
                } else {
                    const profit = shortsales - paidshort; // - (sellprice * posi[2])
                    const msg = ns.sprintf(
                        "WARN: Selling %s short for $%s ($%s profit)",
                        stk.sym,
                        ns.formatNumber(shortsales, 2),
                        ns.formatNumber(profit, 2),
                    );
                    newMsg(ns, msg);
                }
            } else {
                // Loss
                if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                    const loss = shortsales - paidshort; // - (sellprice * posi[2])
                    const msg = ns.sprintf(
                        "WARN: Selling %s short for $%s ($%s loss)",
                        stk.sym,
                        ns.format.number(shortsales, 2),
                        ns.format.number(loss, 2),
                    );
                    newMsg(ns, msg);
                } else {
                    const loss = shortsales - paidshort; // - (sellprice * posi[2])
                    const msg = ns.sprintf(
                        "WARN: Selling %s short for $%s ($%s loss)",
                        stk.sym,
                        ns.formatNumber(shortsales, 2),
                        ns.formatNumber(loss, 2),
                    );
                    newMsg(ns, msg);
                }
            }
            stk.posi[2] = 0;
            stk.posi[3] = 0;
        }
    } //End of Stocks
    if (arg && arg === "sell") {
        if (WORKINGMONEY < 0) {
            //Less than 0 means we spent money that we did not just take in from sales.
            const remainder = RUNNINGBANKED + WORKINGMONEY;
            if (RUNNINGBANKED > 0) {
                if (remainder > 0) {
                    //We still have money left over in banked
                    RUNNINGBANKED += WORKINGMONEY;
                }
            } else {
                //We've used up all our banked and need to split things up
                STARTWORTH -= remainder;
                RUNNINGBANKED = 0;
            }
        } else if (WORKINGMONEY > 0) RUNNINGBANKED += WORKINGMONEY;
        WORKINGMONEY = 0;
    }
}

/** @param {NS} ns */
async function buyItems(ns, stocks, arg) {
    //start off our buying spree
    let topl = stocks.length - 1;
    let botl = 0;
    let top = stocks[topl];
    let bot = stocks[botl];

    let running = true;
    while (running) {
        // Purchase loop
        let cash = 0;
        if (AUTOBUY || arg === "force") cash = await getMoneyAvail(ns, "home");
        else cash = WORKINGMONEY;
        let budget = cash - TRANSACTION_COST - RESERVE;

        top = stocks[topl];
        bot = stocks[botl];

        //Get the max shares of the stock and our position on the stock.  Do we have all the shares?  If so, skip it
        let topposi = top.posi; //await getPosi(ns, top.sym)
        let botposi = bot.posi; //await getPosi(ns, bot.sym)

        while (topposi[0] === top.maxshares || topposi[2] === top.maxshares) {
            if (topl <= 0) break;
            topl--;
            top = stocks[topl];
            topposi = top.posi; //await getPosi(ns, top.sym)
        }
        while (botposi[0] === bot.maxshares || botposi[2] === bot.maxshares) {
            if (botl >= stocks.length - 1) break;
            botl++;
            bot = stocks[botl];
            botposi = bot.posi; //await getPosi(ns, bot.sym)
        }
        top = stocks[topl];
        bot = stocks[botl];
        let max = false;
        if (SHORTS) {
            if (bot.adjfcast >= top.forcast && bot.adjfcast >= BUY_THREASH) {
                //Bottom is the way to go right now
                //buy shorts of bottom, get the next bottom
                const price = await getBidP(ns, bot.sym);
                let buying = Math.floor(budget / price);
                if (buying + botposi[0] + botposi[2] > bot.maxshares) {
                    buying = bot.maxshares - botposi[0] - botposi[2];
                    max = true;
                }
                //ns.tprintf("Shorting: Price %s  Buying %s  Total %s", price, buying, price * buying)
                if (
                    (buying >= MIN_STOCKS &&
                        price * buying >= MIN_TRANSACTION) ||
                    max
                ) {
                    const bought = await buyshort(ns, bot.sym, buying);
                    if (bought > 0) {
                        WORKINGMONEY -= bought * buying + TRANSACTION_COST;
                        RUNNINGCOST -= TRANSACTION_COST;
                        if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                            const msg = ns.sprintf(
                                "Buying %s short of %s for $%s",
                                buying,
                                bot.sym,
                                ns.format.number(bought * buying, 2),
                            );
                            newMsg(ns, msg);
                        } else {
                            const msg = ns.sprintf(
                                "Buying %s short of %s for $%s",
                                buying,
                                bot.sym,
                                ns.formatNumber(bought * buying, 2),
                            );
                            newMsg(ns, msg);
                        }
                        botl++;
                        bot.posi = await getPosi(ns, bot.sym);
                    } else {
                        const msg = ns.sprintf(
                            "Failed to buy %s Short of %s",
                            buying,
                            bot.sym,
                        );
                        newMsg(ns, msg);
                    }
                }
            } else if (top.forcast >= BUY_THREASH) {
                // Top is the way to go
                // Buy long of top, get the next top
                const price = await getAskP(ns, top.sym);
                let buying = Math.floor(budget / price);
                if (buying + topposi[0] + topposi[2] > top.maxshares) {
                    buying = top.maxshares - topposi[0] - topposi[2];
                    max = true;
                }
                //ns.tprintf("Long within short: Price %s  Buying %s  Total %s", price, buying, price * buying)
                if (
                    (buying >= MIN_STOCKS &&
                        price * buying >= MIN_TRANSACTION) ||
                    max
                ) {
                    const bought = await buystock(ns, top.sym, buying);
                    if (bought > 0) {
                        WORKINGMONEY -= bought * buying + TRANSACTION_COST;
                        RUNNINGCOST -= TRANSACTION_COST;
                        if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                            const msg = ns.sprintf(
                                "Buying %s long of %s for $%s",
                                buying,
                                top.sym,
                                ns.format.number(bought * buying, 2),
                            );
                            newMsg(ns, msg);
                        } else {
                            const msg = ns.sprintf(
                                "Buying %s long of %s for $%s",
                                buying,
                                top.sym,
                                ns.formatNumber(bought * buying, 2),
                            );
                            newMsg(ns, msg);
                        }
                        topl--;
                        top.posi = await getPosi(ns, top.sym);
                    } else {
                        const msg = ns.sprintf(
                            "Failed to buy %s long of %s",
                            buying,
                            top.sym,
                        );
                        newMsg(ns, msg);
                    }
                }
            }
        } else if (top.forcast >= BUY_THREASH) {
            //check for long buy
            const price = await getAskP(ns, top.sym);
            let buying = Math.floor(budget / price);
            if (buying + topposi[0] + topposi[2] > top.maxshares) {
                buying = top.maxshares - topposi[0] - topposi[2];
                max = true;
            }
            //ns.tprintf("Long: Price %s  Buying %s  Total %s", price, buying, price * buying)
            if (
                (buying >= MIN_STOCKS && price * buying >= MIN_TRANSACTION) ||
                max
            ) {
                const bought = await buystock(ns, top.sym, buying);
                if (bought > 0) {
                    WORKINGMONEY -= bought * buying + TRANSACTION_COST;
                    RUNNINGCOST -= TRANSACTION_COST;
                    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
                        const msg = ns.sprintf(
                            "Buying %s long of %s for $%s",
                            buying,
                            top.sym,
                            ns.format.number(bought * buying, 2),
                        );
                        newMsg(ns, msg);
                    } else {
                        const msg = ns.sprintf(
                            "Buying %s long of %s for $%s",
                            buying,
                            top.sym,
                            ns.formatNumber(bought * buying, 2),
                        );
                        newMsg(ns, msg);
                    }
                    topl--;
                    top.posi = await getPosi(ns, top.sym);
                } else {
                    const msg = ns.sprintf(
                        "Failed to buy %s long of %s",
                        buying,
                        top.sym,
                    );
                    newMsg(ns, msg);
                }
            }
        }
        if (!max) {
            running = false;
        }
    }
    if (WORKINGMONEY < 0) {
        //Less than 0 means we spent money that we did not just take in from sales.
        const remainder = RUNNINGBANKED + WORKINGMONEY;
        if (RUNNINGBANKED > 0) {
            if (remainder > 0) {
                //We still have money left over in banked
                RUNNINGBANKED += WORKINGMONEY;
            } else {
                STARTWORTH -= remainder;
                RUNNINGBANKED = 0;
            }
        } else {
            //We've used up all our banked and need to split things up
            STARTWORTH -= remainder;
            RUNNINGBANKED = 0;
        }
    } else if (WORKINGMONEY > 0) RUNNINGBANKED += WORKINGMONEY;
    WORKINGMONEY = 0; //We shave off the remainder so we don't have to worry about it not being there later
}

/** @param {NS} ns */
async function getCommands(ns) {
    let silent = false;
    while (ns.peek(13) !== "NULL PORT DATA") {
        //1-4  1: noHacknet, 2: !noHacknet, 3: buyServers, 4: !buyServers
        const result = ns.readPort(13);
        if (Number.isInteger(result)) {
            if (!silent)
                ns.tprintf(
                    "Command received.  Stocks will use a reserve of " + result,
                );
            RESERVE = result;
            continue;
        }
        switch (result) {
            case "popout":
                win = await makeNewWindow("Stocks", ns.ui.getTheme());
                if (!silent)
                    ns.tprintf("Command received.  Stocks will use a popout");
                break;
            case "nopopout":
                if (win) win.close();
                if (!silent)
                    ns.tprintf(
                        "Command received.  Stocks will not use a popout",
                    );
                break;
            case "silent":
                silent = true;
                break;
            case "buy":
                if (!silent)
                    ns.tprintf("Command received.  Stocks is purchasing now");
                await buyItems(ns, stocks, "force");
                printLogs(ns, stocks);
                break;
            case "sell":
                if (!silent)
                    ns.tprintf("Command received.  Stocks is selling now");
                await sellItems(ns, stocks, "sell");
                WORKINGMONEY = 0;
                printLogs(ns, stocks);
                break;
            case "autobuy":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Stocks will auto purchase now",
                    );
                AUTOBUY = true;
                break;
            case "autobuyoff":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Stocks will no longer auto purchase",
                    );
                AUTOBUY = false;
                break;
            case "reset":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Stocks will reset stats data",
                    );
                RUNNINGBANKED = 0;
                RUNNINGTOTAL = 0;
                STARTWORTH = await getWorth(ns);
                starttime = performance.now();
                break;
            default:
                ns.tprintf("Invalid command received in Stocks: %s", result);
                break;
        }
    }
}
