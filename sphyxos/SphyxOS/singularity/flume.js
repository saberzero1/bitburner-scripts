/** @param {NS} ns */
export async function main(ns) {
    const tm = [
        ...globalThis["document"].querySelectorAll(
            "#root > div > div > div > ul > div > div > div > div",
        ),
    ];
    tm.filter((e) => e.textContent === "Terminal")[0]?.click();

    terminal("run b1t_flum3.exe");
    await ns.sleep(4);
    const button = find(
        globalThis["document"],
        "//button[contains(text(), 'BitVerse')]",
    );
    click(button);
}

function terminal(text) {
    const input = eval("document").getElementById("terminal-input");
    const handler = Object.keys(input)[1];
    input[handler].onChange({ target: { value: text } });
    input[handler].onKeyDown({ key: "Enter", preventDefault: () => null });
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
