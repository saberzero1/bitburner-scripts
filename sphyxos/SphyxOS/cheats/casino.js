import { getPlay, hasBN, travelCity, goToLoc } from "SphyxOS/util.js";

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    await ns.sleep(100);
    ns.atExit(() => {
        (ns.clearPort(10),
            ns.writePort(1, 1),
            ns.ui.closeTail(),
            ns.writePort(40, 1));
    });
    const HASBN4 = await hasBN(ns, 4, 2);

    if (ns.getMoneySources().sinceInstall?.casino >= 10e9) {
        ns.tprintf("ERROR: Already banned from the casino!");
        return;
    }
    let player = await getPlay(ns);
    // Go to Aevum if we aren't already there
    if (player.city !== "Aevum" && player.money < 2e5) {
        ns.tprintf("ERROR: Sorry, you need at least 200k to travel to Aevum.");
        return;
    }

    if (player.city !== "Aevum" && HASBN4 && !(await travelCity(ns, "Aevum"))) {
        ns.tprintf("ERROR: Failed to travel to Aevum.");
        return;
    } else if (!HASBN4 && player.city !== "Aevum") {
        ns.tprintf("INFO: Travel to Aevum for the casino.");
        return;
    }

    //Are we in Aevum?
    if (HASBN4) await goToLoc(ns, "Iker Molina Casino");
    player = await getPlay(ns);
    /*if (player.location !== "Iker Molina Casino" && player.location !== "Travel Agency") {

    ns.printf("You are here:  %s", player.location)
    return
  }*/

    let doc = eval("document");

    // Step 2 Try to start the coin flip game
    const coinflip = find(doc, "//button[contains(text(), 'coin flip')]");
    if (!coinflip) {
        ns.tprintf("ERROR: Go to the casino and rerun the script");
        ns.tprintf("ERROR: The script must click on entering coinflip");
        return;
    }
    //We have officially started!
    ns.writePort(10, ns.pid);
    ns.writePort(1, 1);
    ns.ui.openTail();
    ns.printf("Started.  Hold on!  Calulating sequence");
    click(coinflip);
    // Step 3 Find the buttons
    const tails = find(doc, "//button[contains(text(), 'Tail!')]");
    const heads = find(doc, "//button[contains(text(), 'Head!')]");
    const input = find(doc, "//input[@type='number']");
    if (!input) {
        ns.printf("FAIL: Could not get a hold of the bet amount input!");
        return;
    }

    const log = [];
    input.value = 0;
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        const event1 = { target: { value: 0 } };
        const tmp = Object.getOwnPropertyNames(input)
            .filter((p) => p.includes("__reactProps"))
            .pop();
        const prop = input[tmp];
        prop.onChange(event1);
    }

    // Step 4: Click one of the buttons
    for (let i = 0; i < 1024; i++) {
        click(tails);
        let isTails;
        let isHeads;
        if (ns.ui.getGameInfo()?.versionNumber >= 44) {
            isTails = find(doc, "//span[text() = 'Tail']");
            isHeads = find(doc, "//span[text() = 'Head']");
        } else {
            isTails = find(doc, "//p[text() = 'T']");
            isHeads = find(doc, "//p[text() = 'H']");
        }

        if (isTails) log.push("T");
        else if (isHeads) log.push("H");
        else {
            ns.printf("FAIL: Something went wrong, aborting sequence!");
            return;
        }
        //if (i % 200 === 0) await ns.sleep(0);
        await ns.sleep(0);
    }

    let loops = 0;
    input.value = 10000;
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        const event2 = { target: { value: 10000 } };
        const tmp = Object.getOwnPropertyNames(input)
            .filter((p) => p.includes("__reactProps"))
            .pop();
        const prop = input[tmp];
        prop.onChange(event2);
    }
    ns.printf("You can do something else now.");
    ns.writePort(40, 1);
    await ns.sleep(4);
    const terminal = [
        ...globalThis["document"].querySelectorAll(
            "#root > div > div > div > ul > div > div > div > div",
        ),
    ];
    terminal.filter((e) => e.textContent === "Terminal")[0]?.click();
    //globalThis["document"].dispatchEvent(new KeyboardEvent("keydown", { key: "t", altKey: true}))
    await ns.sleep(4);
    // Step 5: Execute sequence
    while (true) {
        try {
            if (log[loops % 1024] == "T") {
                click(tails);
            } else if (log[loops % 1024] == "H") {
                click(heads);
            }

            if (loops % 2000 == 0) {
                await ns.sleep(4);
            }
            loops++;
            if (ns.getMoneySources().sinceInstall.casino >= 10_000_000_000)
                return;
        } catch (e) {
            ns.tprint("FAIL: " + e);
            return;
        }
    }
}

function find(doc, xpath) {
    return doc.evaluate(
        xpath,
        doc,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
    ).singleNodeValue;
}

function click(elem) {
    elem[Object.keys(elem)[1]].onClick({ isTrusted: true });
}
