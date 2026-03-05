/**
 * Infiltration Automation Script
 *
 * Automates all infiltration mini-games using a React Fiber exploit as the
 * primary strategy, with full fallback solvers for every mini-game type.
 *
 * Usage:
 *   run infiltration.js                     -- Enable automation, solve games when you visit infiltration
 *   run infiltration.js --auto              -- Auto-replay: accept reward and restart after each run
 *   run infiltration.js --auto --faction BitRunners  -- Auto-replay, claim rep for BitRunners
 *   run infiltration.js --company "Four Sigma"       -- Auto-navigate to company and start
 *   run infiltration.js --stop              -- Stop the automation
 *   run infiltration.js --status            -- Check if automation is active
 *
 * Adapted from SphyxOS autoInfil.js by Sphyxis & Dihelvid.
 */

const argsSchema = [
    ["auto", false],        // Auto-replay infiltrations
    ["faction", ""],        // Auto-accept reputation for this faction instead of money
    ["company", ""],        // Auto-navigate to this company and start infiltration
    ["quiet", false],       // Suppress tprint messages
    ["stop", false],        // Stop running infiltration automation
    ["status", false],      // Check if automation is active
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

// =============================================================================
//  Configuration & Globals
// =============================================================================

// Speed of the main loop interval, in milliseconds
const speed = 50;

// RAM-saving trick: avoid ns API usage after main() exits
const wnd = eval("window");
const doc = wnd["document"];

// Infiltration state tracking
const state = {
    company: "",
    lastCompany: "",
    started: false,
    game: {},
};

// Module-level settings (set from args in main)
let autoMode = false;
let repFaction = "";
let postTimeout = null;
let infiltrationStart = 0;

// List of positive adjectives for the "nice guard" game
const NICE_WORDS = [
    "affectionate", "agreeable", "bright", "charming", "creative",
    "determined", "energetic", "friendly", "funny", "generous",
    "polite", "likable", "diplomatic", "helpful", "giving",
    "kind", "hardworking", "patient", "dynamic", "loyal",
    "based", "straightforward",
];

// =============================================================================
//  Mini-Game Definitions (Fallback Solvers)
// =============================================================================

const infiltrationGames = [
    {
        name: "type it backward",
        init(screen) {
            const lines = getLines(getEl(screen, "p"));
            state.game.data = lines[0].split("").reverse();
        },
        play() {
            if (!state.game.data || !state.game.data.length) {
                delete state.game.data;
                return;
            }
            pressKey(state.game.data.shift());
        },
    },
    {
        name: "type it",
        init(screen) {
            const lines = getLines(getEl(screen, "p"));
            state.game.data = lines[0].split("");
        },
        play() {
            if (!state.game.data || !state.game.data.length) {
                delete state.game.data;
                return;
            }
            pressKey(state.game.data.shift());
        },
    },
    {
        name: "enter the code",
        init() {
            state.game.position = 0;
        },
        play(screen) {
            const h4 = getEl(screen, "h4");
            const code = h4[1].textContent;
            const arrowMap = { "↑": "w", "↓": "s", "←": "a", "→": "d" };
            const key = arrowMap[code[state.game.position]];
            if (key) pressKey(key);
            state.game.position++;
        },
    },
    {
        name: "close the brackets",
        init(screen) {
            const data = getLines(getEl(screen, "p"));
            const brackets = data.join("").split("");
            const closingMap = { "<": ">", "(": ")", "{": "}", "[": "]" };
            state.game.data = [];
            for (let i = brackets.length - 1; i >= 0; i--) {
                const closing = closingMap[brackets[i]];
                if (closing) state.game.data.push(closing);
            }
        },
        play() {
            if (!state.game.data || !state.game.data.length) {
                delete state.game.data;
                return;
            }
            pressKey(state.game.data.shift());
        },
    },
    {
        name: "attack after the sentinel drops his guard and is distracted",
        init() {
            state.game.data = "wait";
        },
        play(screen) {
            const data = getLines(getEl(screen, "h4"));
            if ("attack" === state.game.data) {
                pressKey(" ");
                state.game.data = "done";
            }
            // Attack in next frame — instant attack sometimes fails
            if ("wait" === state.game.data && data.indexOf("Distracted!") !== -1) {
                state.game.data = "attack";
            }
        },
    },
    {
        name: "say something nice about the guard",
        init() {},
        play(screen) {
            const word = getLines(getEl(screen, "h5"))[1];
            if (NICE_WORDS.indexOf(word) !== -1) {
                pressKey(" ");
            } else {
                pressKey("w");
            }
        },
    },
    {
        name: "remember all the mines",
        init(screen) {
            const rows = getEl(screen, "p");
            const gridSize = detectGridSize(rows.length);
            if (!gridSize) return;
            state.game.data = [];
            let index = 0;
            for (let y = 0; y < gridSize[1]; y++) {
                state.game.data[y] = [];
                for (let x = 0; x < gridSize[0]; x++) {
                    state.game.data[y].push(rows[index].children.length > 0);
                    index++;
                }
            }
        },
        play() {},
    },
    {
        name: "mark all the mines",
        init() {
            state.game.x = 0;
            state.game.y = 0;
            state.game.cols = state.game.data[0].length;
            state.game.dir = 1;
        },
        play() {
            let { data, x, y, cols, dir } = state.game;
            if (data[y][x]) {
                pressKey(" ");
                data[y][x] = false;
            }
            x += dir;
            if (x < 0 || x >= cols) {
                x = Math.max(0, Math.min(cols - 1, x));
                y++;
                dir *= -1;
                pressKey("s");
            } else {
                pressKey(dir > 0 ? "d" : "a");
            }
            state.game.data = data;
            state.game.x = x;
            state.game.y = y;
            state.game.dir = dir;
        },
    },
    {
        name: "match the symbols",
        init(screen) {
            const data = getLines(getEl(screen, "h5 span"));
            const rows = getLines(getEl(screen, "p"));
            const gridSize = detectGridSize(rows.length);
            if (!gridSize) return;
            const keypad = [];
            let index = 0;
            for (let i = 0; i < gridSize[1]; i++) {
                keypad[i] = [];
                for (let j = 0; j < gridSize[0]; j++) {
                    keypad[i].push(rows[index]);
                    index++;
                }
            }
            const targets = [];
            for (let i = 0; i < data.length; i++) {
                const symbol = data[i].trim();
                for (let j = 0; j < keypad.length; j++) {
                    const k = keypad[j].indexOf(symbol);
                    if (k !== -1) {
                        targets.push([j, k]);
                        break;
                    }
                }
            }
            state.game.data = targets;
            state.game.x = 0;
            state.game.y = 0;
        },
        play() {
            const target = state.game.data[0];
            if (!target) return;
            let { x, y } = state.game;
            const [toY, toX] = target;
            if (toY < y) { y--; pressKey("w"); }
            else if (toY > y) { y++; pressKey("s"); }
            else if (toX < x) { x--; pressKey("a"); }
            else if (toX > x) { x++; pressKey("d"); }
            else { pressKey(" "); state.game.data.shift(); }
            state.game.x = x;
            state.game.y = y;
        },
    },
    {
        name: "cut the wires with the following properties",
        init(screen) {
            const numberHack = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
            const colors = {
                "red": "red",
                "white": "white",
                "blue": "blue",
                "rgb(255, 193, 7)": "yellow",
            };
            const wireColor = { red: [], white: [], blue: [], yellow: [] };
            const instructions = [];
            for (const child of screen.children) instructions.push(child);
            const wiresData = instructions.pop();
            instructions.shift();
            const instructionLines = getLines(instructions);
            const samples = getEl(wiresData, "p");
            let wireCount = 0;
            for (let i = 0; i < samples.length; i++) {
                if (numberHack.includes(samples[i].innerText)) wireCount++;
                else break;
            }
            let index = 0;
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < wireCount; j++) {
                    const node = samples[index];
                    const color = colors[node.style.color];
                    if (color) wireColor[color].push(j + 1);
                    index++;
                }
            }
            const wires = [];
            for (const line of instructionLines) {
                const lower = line.trim().toLowerCase();
                if (!lower || lower.length < 10) continue;
                if (lower.indexOf("cut wires number") !== -1) {
                    const parts = lower.split(/(number\s*|\.)/);
                    wires.push(parseInt(parts[2]));
                }
                if (lower.indexOf("cut all wires colored") !== -1) {
                    const parts = lower.split(/(colored\s*|\.)/);
                    const color = parts[2];
                    if (wireColor[color]) {
                        wireColor[color].forEach((num) => wires.push(num));
                    }
                }
            }
            state.game.data = [...new Set(wires)];
        },
        play() {
            const wire = state.game.data;
            if (!wire) return;
            for (let i = 0; i < wire.length; i++) {
                pressKey(wire[i].toString());
            }
        },
    },
];

// =============================================================================
//  Entry Point
// =============================================================================

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(argsSchema);
    const print = (msg) => { if (!args.quiet) ns.tprint(`\n${msg}\n`); };

    // --status: check if automation is active
    if (args.status) {
        print(wnd.tmrAutoInf
            ? "Automated infiltration is active"
            : "Automated infiltration is inactive");
        return;
    }

    // Stop existing instance if running
    if (wnd.tmrAutoInf) {
        print("Stopping automated infiltration...");
        clearInterval(wnd.tmrAutoInf);
        delete wnd.tmrAutoInf;
        ns.clearPort(30);
        ns.writePort(1, 1);
    }

    // --stop: just stop and exit
    if (args.stop) {
        setTimeout(() => {
            const btn = findButton("Cancel");
            if (btn) clickButton(btn);
        }, 1000);
        return;
    }

    // Apply settings
    autoMode = args.auto;
    repFaction = args.faction && args.faction.length ? args.faction : "";

    print(
        "Automated infiltration is enabled...\n" +
        "When you visit the infiltration screen of any company, all tasks are completed automatically.\n" +
        `Auto-replay: ${autoMode ? "ON" : "OFF"} | ` +
        `Reward: ${repFaction || "MONEY"}`
    );

    // IPC: write PID to port 30
    ns.writePort(30, ns.pid);
    endInfiltration();

    // Wrap event listeners for trusted synthetic keyboard events
    wrapEventListeners();

    // Start the main automation loop
    wnd.tmrAutoInf = setInterval(infLoop, speed);

    // If --company is set, navigate to the company and start infiltration
    if (args.company) {
        state.lastCompany = args.company;
        postTimeout = setTimeout(() => {
            postTimeout = null;
            const btn = findButton("Infiltrate Company");
            if (btn) clickButton(btn);
        }, 1000);
    }
}

// =============================================================================
//  DOM Helper Functions
// =============================================================================

/**
 * Query DOM elements relative to the game container.
 */
function getEl(parent, selector) {
    let prefix = ":scope";

    if ("string" === typeof parent) {
        selector = parent;
        parent = doc;
        prefix = ".MuiBox-root>.MuiBox-root>.MuiBox-root";
        if (!doc.querySelectorAll(prefix).length) {
            prefix = ".MuiBox-root>.MuiBox-root>.MuiGrid-root";
        }
        if (!doc.querySelectorAll(prefix).length) {
            prefix = ".MuiContainer-root>.MuiPaper-root";
        }
        if (!doc.querySelectorAll(prefix).length) {
            return [];
        }
    }

    const parts = selector.split(",").map((item) => `${prefix} ${item}`);
    return parent.querySelectorAll(parts.join(","));
}

/**
 * Extract text content from a list of elements.
 */
function getLines(elements) {
    const lines = [];
    for (let i = 0; i < elements.length; i++) {
        lines.push(elements[i].textContent);
    }
    return lines;
}

/**
 * Find the first button matching text content.
 */
function findButton(text) {
    return Array.from(doc.querySelectorAll("button"))
        .find((x) => x.innerText.indexOf(text) >= 0);
}

/**
 * Click a button via its React fiber onClick handler (bypasses isTrusted checks).
 */
function clickButton(btn) {
    const reactKey = Object.keys(btn).find((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
    if (reactKey && btn[reactKey] && btn[reactKey].onClick) {
        btn[reactKey].onClick({ isTrusted: true });
    } else {
        btn.click();
    }
}

/**
 * Detect grid dimensions from total cell count.
 */
function detectGridSize(count) {
    const sizes = {
        9: [3, 3], 12: [3, 4], 16: [4, 4],
        20: [4, 5], 25: [5, 5], 30: [5, 6], 36: [6, 6],
    };
    return sizes[count] || null;
}

// =============================================================================
//  React Fiber Exploit (Primary Strategy)
// =============================================================================

/**
 * Instantly win the current mini-game by calling onSuccess via React Fiber.
 * Returns true if successful, false if the exploit fails.
 */
function winGame() {
    try {
        const screen = doc.querySelectorAll(".MuiContainer-root")[0];
        if (!screen) return false;
        const fiberKey = Object.keys(screen).find((k) => k.startsWith("__reactFiber$"));
        if (!fiberKey) return false;
        const fiber = screen[fiberKey];
        for (const child of fiber.memoizedProps.children) {
            if (child && child.props && child.props.onSuccess) {
                child.props.onSuccess();
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

// =============================================================================
//  Keyboard Input
// =============================================================================

/**
 * Dispatch a synthetic keyboard event on the document.
 */
function pressKey(keyOrCode) {
    let keyCode = 0;
    let key = "";

    if ("string" === typeof keyOrCode && keyOrCode.length > 0) {
        key = keyOrCode.toLowerCase().slice(0, 1);
        keyCode = key.charCodeAt(0);
    } else if ("number" === typeof keyOrCode) {
        keyCode = keyOrCode;
        key = String.fromCharCode(keyCode);
    }

    if (!keyCode || key.length !== 1) return;

    doc.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode }));
}

// =============================================================================
//  Main Loop
// =============================================================================

/**
 * Called every 50ms. Detects infiltration state and acts accordingly.
 */
function infLoop() {
    if (!state.started) {
        waitForStart();
    } else {
        playGame();
    }
}

/**
 * Wait for the user to reach the infiltration start screen, then click Start.
 */
function waitForStart() {
    if (state.started) return;

    const h4 = getEl("h4");
    if (!h4.length) return;

    const title = h4[0].textContent;
    if (title.indexOf("Infiltrating") !== 0) return;

    const btnStart = findButton("Start");
    if (!btnStart) return;

    state.company = title.substr(13);
    state.lastCompany = title.substr(13);
    state.started = true;

    const datetime = new Date().toISOString();
    console.log(datetime, "Start automatic infiltration of", state.company);
    btnStart.click();
}

/**
 * Identify the current mini-game and solve it.
 */
function playGame() {
    const screens = doc.querySelectorAll(".MuiContainer-root");

    if (!screens.length) {
        endInfiltration();
        selectCompany();
        return;
    }

    if (screens[0].children.length < 3) {
        // Check for successful infiltration — accept reward if auto mode
        if (!postTimeout) {
            const successText = screens[0].children[1]?.children[0]?.innerText;
            if (successText === "Infiltration successful!") {
                acceptReward();
            }
        }
        return;
    }

    const screen = screens[0].children[2];
    const h4 = screen.children;

    if (!h4.length) {
        endInfiltration();
        return;
    }

    const title = h4[0].textContent.trim().toLowerCase().split(/[!.(]/)[0];

    if ("infiltration successful" === title) {
        endInfiltration();
        return;
    }

    if ("get ready" === title) {
        if (!infiltrationStart) infiltrationStart = Date.now();
        return;
    }

    // Primary strategy: React Fiber exploit
    if (winGame()) return;

    // Fallback: use manual game solver
    const game = infiltrationGames.find((g) => g.name === title);
    if (game) {
        if (state.game.current !== title) {
            state.game.current = title;
            game.init(screen);
        }
        game.play(screen);
    } else {
        console.error("Unknown infiltration game:", title);
    }
}

// =============================================================================
//  Auto Mode: Reward Acceptance & Company Navigation
// =============================================================================

/**
 * Reset infiltration state.
 */
function endInfiltration() {
    state.company = "";
    state.started = false;
    state.game = {};
}

/**
 * Accept the infiltration reward (money or faction rep).
 */
function acceptReward() {
    if (!autoMode) return;
    if (postTimeout) return;

    cancelMyTimeout();

    if (repFaction && repFaction.length) {
        acceptReputation();
        return;
    }

    // Accept money
    postTimeout = setTimeout(() => {
        cancelMyTimeout();
        const btn = findButton("Sell for");
        if (btn) {
            if (infiltrationStart) {
                console.info(`SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec: ${btn.innerText}`);
                infiltrationStart = 0;
            }
            clickButton(btn);
        }
        selectCompany();
    }, 1000);
}

/**
 * Accept reputation reward for the configured faction.
 */
function acceptReputation() {
    cancelMyTimeout();

    postTimeout = setTimeout(() => {
        postTimeout = null;

        // Open the faction dropdown
        let combobox = Array.from(doc.querySelectorAll("[role=\"combobox\"]"))
            .find((x) => x.innerText.indexOf("none") >= 0);
        if (!combobox) {
            combobox = Array.from(doc.querySelectorAll("[role=\"combobox\"]"))
                .find((x) => x.innerText.indexOf(repFaction) >= 0);
        }

        if (combobox) {
            const reactKey = Object.keys(combobox).find((k) => k.startsWith("__reactProps$"));
            if (reactKey && combobox[reactKey].onKeyDown) {
                combobox[reactKey].onKeyDown(new KeyboardEvent("keydown", { key: " " }));
            }

            postTimeout = setTimeout(() => {
                // Select the faction from the dropdown
                const option = Array.from(doc.querySelectorAll("li[role=\"option\"]"))
                    .find((x) => x.innerText.indexOf(repFaction) >= 0);
                if (option) option.click();

                postTimeout = setTimeout(() => {
                    // Click the "Trade for" button
                    const btn = findButton("Trade for");
                    if (btn) {
                        clickButton(btn);
                        if (infiltrationStart) {
                            console.info(`SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec - ${btn.innerText}`, repFaction);
                            infiltrationStart = 0;
                        }
                    }
                    selectCompany();
                }, 500);
            }, 1000);
        }
    }, 1000);
}

/**
 * Navigate back to the company and start a new infiltration (auto mode only).
 */
function selectCompany() {
    if (!autoMode) return;
    cancelMyTimeout();

    postTimeout = setTimeout(() => {
        postTimeout = null;

        const selector = "span[aria-label=\"" + state.lastCompany + "\"]";
        const companyEle = doc.querySelector(selector);
        if (companyEle) {
            if (infiltrationStart) {
                console.info(`FAILED INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec`);
                infiltrationStart = 0;
            }
            companyEle.click();

            postTimeout = setTimeout(() => {
                postTimeout = null;
                const btn = findButton("Infiltrate Company");
                if (btn) clickButton(btn);
            }, 1000);
        }
    }, 1000);
}

/**
 * Cancel any pending timeout.
 */
function cancelMyTimeout() {
    if (postTimeout) {
        clearTimeout(postTimeout);
        postTimeout = null;
    }
}

// =============================================================================
//  Event Listener Wrapping (Trusted Keyboard Events)
// =============================================================================

/**
 * Wrap document event listeners so that synthetic keyboard events appear trusted.
 * This is required for the fallback mini-game solvers that use pressKey().
 */
function wrapEventListeners() {
    if (!doc._addEventListener) {
        doc._addEventListener = doc.addEventListener;

        doc.addEventListener = function (type, callback, options) {
            if (options === undefined) options = false;
            let handler = false;

            if ("keydown" === type) {
                handler = function (...args) {
                    if (!args[0].isTrusted) {
                        const hackedEv = {};
                        for (const key in args[0]) {
                            if ("isTrusted" === key) {
                                hackedEv.isTrusted = true;
                            } else if ("function" === typeof args[0][key]) {
                                hackedEv[key] = args[0][key].bind(args[0]);
                            } else {
                                hackedEv[key] = args[0][key];
                            }
                        }
                        Object.setPrototypeOf(hackedEv, KeyboardEvent.prototype);
                        args[0] = hackedEv;
                    }
                    return callback.apply(callback, args);
                };
                for (const prop in callback) {
                    if ("function" === typeof callback[prop]) {
                        handler[prop] = callback[prop].bind(callback);
                    } else {
                        handler[prop] = callback[prop];
                    }
                }
            }

            if (!this.eventListeners) this.eventListeners = {};
            if (!this.eventListeners[type]) this.eventListeners[type] = [];

            this.eventListeners[type].push({
                listener: callback,
                useCapture: options,
                wrapped: handler,
            });

            return this._addEventListener(type, handler || callback, options);
        };
    }

    if (!doc._removeEventListener) {
        doc._removeEventListener = doc.removeEventListener;

        doc.removeEventListener = function (type, callback, options) {
            if (options === undefined) options = false;

            if (!this.eventListeners) this.eventListeners = {};
            if (!this.eventListeners[type]) this.eventListeners[type] = [];

            for (let i = 0; i < this.eventListeners[type].length; i++) {
                if (
                    this.eventListeners[type][i].listener === callback &&
                    this.eventListeners[type][i].useCapture === options
                ) {
                    if (this.eventListeners[type][i].wrapped) {
                        callback = this.eventListeners[type][i].wrapped;
                    }
                    this.eventListeners[type].splice(i, 1);
                    break;
                }
            }

            if (this.eventListeners[type].length === 0) {
                delete this.eventListeners[type];
            }

            return this._removeEventListener(type, callback, options);
        };
    }
}
