import { proxy } from "SphyxOS/util.js";
/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    await ns.sleep(4); //Let the main script establish it's wait timer
    ns.atExit(() => ns.writePort(40, true));
    const doc = globalThis["document"];
    const factions = [
        ...doc.querySelectorAll(
            "#root > div > div > div > ul > div > div > div > div",
        ),
    ];
    factions.filter((e) => e.textContent.includes("Factions"))[0]?.click();
    await ns.sleep(4);
    const topButtons = [...doc.querySelectorAll("button")];
    let facButton = null;
    for (const btn of topButtons) {
        if (!btn.innerText.includes("Details")) continue;
        const gp = btn.parentElement?.parentElement;
        if (!gp) continue;
        if (gp.innerText.includes("Covenant")) {
            facButton = btn;
            break;
        }
    }
    if (!facButton) {
        throw new Error("Covenant Details button not found");
    }
    click(facButton);
    await ns.sleep(4);
    const sleeveButton = find(doc, "//button[contains(text(), 'Sleeves')]");
    click(sleeveButton);
    await ns.sleep(4);
    const purchaseButton = Array.from(doc.querySelectorAll("button")).filter(
        (b) => b.innerText.startsWith("Purchase -"),
    );
    const maxS = await maxSleeves(ns);
    const startingNum = maxS - (await proxy(ns, "sleeve.getNumSleeves"));
    for (let x = startingNum; x > 0; x--) {
        if (purchaseButton[0]) {
            const money = await proxy(ns, "getServerMoneyAvailable", "home");
            if (x === 5 && money >= 10e12) click(purchaseButton[0]);
            else if (x === 4 && money >= 100e12) click(purchaseButton[0]);
            else if (x === 3 && money >= 1e15) click(purchaseButton[0]);
            else if (x === 2 && money >= 10e15) click(purchaseButton[0]);
            else if (x === 1 && money >= 100e15) click(purchaseButton[0]);
        }
    }
    await ns.sleep(4);
    const buttons = Array.from(doc.querySelectorAll("button")).filter((b) =>
        b.innerText.startsWith("Purchase 1 memory"),
    );
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "t", altKey: true }));
    for (let x = 0; x < 100; x++) {
        for (const button of buttons) {
            click(button);
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

/** @param {NS} ns */
async function maxSleeves(ns) {
    const resetInfo = await proxy(ns, "getResetInfo");
    const sourceFiles = [];
    for (const item of resetInfo.ownedSF) {
        const record = {
            n: item[0],
            lvl: item[1],
        };
        sourceFiles.push(record);
    }
    let result = 5;
    if (resetInfo.currentNode === 10) {
        result++;
    }
    for (const sf of sourceFiles)
        if (sf.n === 10) {
            result += sf.lvl;
        }
    return result > 8 ? 8 : result;
}
