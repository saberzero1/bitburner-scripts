/**
 * Infiltration Automation Script (Rewritten for new model-based architecture)
 *
 * Automates all infiltration mini-games by directly accessing the game's
 * internal Infiltration model via React Fiber traversal. Primary strategy
 * calls onSuccess() directly; fallback solvers read model state and solve
 * each minigame algorithmically.
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
    ["auto", false], // Auto-replay infiltrations
    ["faction", ""], // Auto-accept reputation for this faction instead of money
    ["company", ""], // Auto-navigate to this company and start infiltration
    ["quiet", false], // Suppress tprint messages
    ["stop", false], // Stop running infiltration automation
    ["status", false], // Check if automation is active
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

// Module-level settings (set from args in main)
let autoMode = false;
let repFaction = "";
let targetCompany = "";
let postTimeout = null;
let infiltrationStart = 0;

// =============================================================================
//  Entry Point
// =============================================================================

/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.flags(argsSchema);
    const print = (msg) => {
        if (!args.quiet) ns.tprint(`\n${msg}\n`);
    };

    // --status: check if automation is active
    if (args.status) {
        print(
            wnd.tmrAutoInf
                ? "Automated infiltration is active"
                : "Automated infiltration is inactive",
        );
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
    targetCompany = args.company && args.company.length ? args.company : "";

    print(
        "Automated infiltration is enabled...\n" +
            "All infiltration tasks are completed automatically using direct model access.\n" +
            `Auto-replay: ${autoMode ? "ON" : "OFF"} | ` +
            `Reward: ${repFaction || "MONEY"}` +
            (targetCompany ? ` | Target: ${targetCompany}` : ""),
    );

    // IPC: write PID to port 30
    ns.writePort(30, ns.pid);

    // Wrap event listeners for trusted synthetic keyboard events (needed for fallback solvers)
    wrapEventListeners();

    // If --company is set, try navigating to the company via Singularity API first
    if (targetCompany) {
        let navigated = false;
        try {
            // Try Singularity API navigation (requires SF4)
            const locations = ns.infiltration.getPossibleLocations();
            const match = locations.find(
                (loc) => loc.name.toLowerCase() === targetCompany.toLowerCase(),
            );
            if (match) {
                // Travel to the right city first if needed
                const player = ns.getPlayer();
                if (player.city !== match.city) {
                    if (ns.singularity) {
                        ns.singularity.travelToCity(match.city);
                    }
                }
                // Navigate to the company location
                if (ns.singularity) {
                    ns.singularity.goToLocation(match.name);
                    navigated = true;
                }
            }
        } catch {
            // SF4 not available or API call failed — fall through to DOM fallback
        }

        if (!navigated) {
            // DOM fallback: click on the company on the city map
            postTimeout = setTimeout(() => {
                postTimeout = null;
                const selector = 'span[aria-label="' + targetCompany + '"]';
                const companyEle = doc.querySelector(selector);
                if (companyEle) companyEle.click();
            }, 500);
        }
    }

    // Start the main automation loop
    wnd.tmrAutoInf = setInterval(infLoop, speed);
}

// =============================================================================
//  React Fiber Traversal — Access Player.infiltration
// =============================================================================

/**
 * Find the Infiltration model instance through React's internal fiber tree.
 * Uses a multi-strategy approach for reliability:
 *
 *   Strategy 1 (Bottom-Up): Find a known infiltration DOM element, get its
 *                           fiber, walk UP via fiber.return to find props
 *                           containing the Infiltration instance.
 *
 *   Strategy 2 (Top-Down):  Walk the full fiber tree from the root downward
 *                           searching all fibers' memoizedProps, stateNode,
 *                           and hook state chains.
 *
 * The game's InfiltrationRoot.tsx reads Player.infiltration and passes it
 * as `state` prop to stage components: <StageComponent state={state} stage={state.stage} />
 *
 * Returns the Infiltration instance, or null if not currently infiltrating.
 */
function getInfiltrationState() {
    try {
        // Strategy 1: Bottom-up from infiltration-specific DOM elements.
        // This is fast and precise — start from a known UI element and walk up.
        const infil = findInfiltrationBottomUp();
        if (infil) return infil;

        // Strategy 2: Top-down full fiber tree walk from root.
        // Fallback for when no infiltration-specific DOM elements exist yet.
        return findInfiltrationTopDown();
    } catch {
        return null;
    }
}

/**
 * Strategy 1: Bottom-up fiber walk.
 * Find DOM elements unique to the infiltration UI, get their React fiber,
 * then walk UP through fiber.return to find the Infiltration instance
 * in a parent fiber's memoizedProps.
 */
function findInfiltrationBottomUp() {
    // Look for DOM elements that only exist during infiltration.
    // Each of these selectors targets something rendered by InfiltrationRoot.
    const selectors = [
        // "Cancel Infiltration" button (present during all active stages)
        "button",
        // MUI Paper elements within the infiltration Container
        'div[class*="MuiPaper"]',
        // MUI Container
        'div[class*="MuiContainer"]',
    ];

    // For each selector, find matching elements and try to walk up their fiber
    for (const selector of selectors) {
        const elements = doc.querySelectorAll(selector);
        for (const el of elements) {
            const fiber = getReactFiber(el);
            if (!fiber) continue;

            const infil = walkFiberUp(fiber);
            if (infil) return infil;
        }
    }

    return null;
}

/**
 * Strategy 2: Top-down fiber tree walk from the React root.
 * Searches the entire fiber tree using iterative DFS (avoids stack overflow).
 */
function findInfiltrationTopDown() {
    const root = doc.getElementById("root");
    if (!root) return null;

    const fiberKey = Object.keys(root).find((k) =>
        k.startsWith("__reactFiber$"),
    );
    if (!fiberKey) return null;

    const rootFiber = root[fiberKey];
    if (!rootFiber) return null;

    // Iterative DFS using an explicit stack (no depth limit, no stack overflow)
    const stack = [rootFiber];
    const visited = new WeakSet();

    while (stack.length > 0) {
        const fiber = stack.pop();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);

        // Check this fiber for the Infiltration instance
        const infil = extractInfiltrationFromFiber(fiber);
        if (infil) return infil;

        // Push sibling first (so child is processed first from stack)
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
    }

    return null;
}

/**
 * Get the React fiber attached to a DOM element.
 */
function getReactFiber(element) {
    if (!element) return null;
    const key = Object.keys(element).find(
        (k) =>
            k.startsWith("__reactFiber$") ||
            k.startsWith("__reactInternalInstance$"),
    );
    return key ? element[key] : null;
}

/**
 * Walk UP the fiber tree from a starting fiber, checking each fiber's
 * memoizedProps for the Infiltration instance. This is the most reliable
 * path since InfiltrationRoot passes `state={Player.infiltration}` as a
 * prop to its child stage components.
 */
function walkFiberUp(fiber) {
    let current = fiber;
    let steps = 0;
    while (current && steps < 100) {
        const infil = extractInfiltrationFromFiber(current);
        if (infil) return infil;
        current = current.return;
        steps++;
    }
    return null;
}

/**
 * Extract the Infiltration instance from a single fiber node.
 * Checks memoizedProps, stateNode, and the hook state chain.
 */
function extractInfiltrationFromFiber(fiber) {
    if (!fiber) return null;

    // 1. Check memoizedProps — this is where <StageComponent state={infil} /> stores it
    try {
        const props = fiber.memoizedProps;
        if (props && typeof props === "object") {
            const infil = extractInfiltration(props);
            if (infil) return infil;
        }
    } catch {
        /* ignore */
    }

    // 2. Check stateNode (class components)
    try {
        const sn = fiber.stateNode;
        if (
            sn &&
            typeof sn === "object" &&
            sn !== doc &&
            !(sn instanceof wnd.HTMLElement)
        ) {
            const infil = extractInfiltration(sn);
            if (infil) return infil;
            // Also check stateNode.state and stateNode.props (React class component pattern)
            if (sn.state) {
                const infil2 = extractInfiltration(sn.state);
                if (infil2) return infil2;
            }
            if (sn.props) {
                const infil3 = extractInfiltration(sn.props);
                if (infil3) return infil3;
            }
        }
    } catch {
        /* ignore */
    }

    // 3. Check memoizedState (hooks state chain for function components)
    try {
        let hookState = fiber.memoizedState;
        let hookCount = 0;
        while (hookState && hookCount < 20) {
            // Check lastRenderedState in the hook's update queue
            if (hookState.queue && hookState.queue.lastRenderedState) {
                const infil = extractInfiltration(
                    hookState.queue.lastRenderedState,
                );
                if (infil) return infil;
            }
            // Check the memoized value directly
            if (
                hookState.memoizedState &&
                typeof hookState.memoizedState === "object"
            ) {
                const infil = extractInfiltration(hookState.memoizedState);
                if (infil) return infil;
            }
            hookState = hookState.next;
            hookCount++;
        }
    } catch {
        /* ignore */
    }

    return null;
}

/**
 * Given an object, determine if it IS or CONTAINS the Infiltration instance.
 * The Infiltration class has distinctive properties: stage, level, maxLevel,
 * onSuccess, onFailure, results, location, startingSecurityLevel, gameIds.
 */
function extractInfiltration(obj) {
    if (!obj || typeof obj !== "object") return null;

    // Direct match: is this the Infiltration instance itself?
    if (isInfiltrationInstance(obj)) return obj;

    // Check common prop/key names where the instance might be nested
    // InfiltrationRoot passes it as: <StageComponent state={infil} stage={infil.stage} />
    // So props.state should contain the Infiltration instance.
    for (const key of ["state", "infiltration", "props", "children"]) {
        try {
            const val = obj[key];
            if (val && typeof val === "object" && isInfiltrationInstance(val)) {
                return val;
            }
        } catch {
            /* ignore getter errors */
        }
    }

    return null;
}

/**
 * Duck-type check for the Infiltration class instance.
 * Matches the signature of the Infiltration class from Infiltration.ts.
 */
function isInfiltrationInstance(obj) {
    return (
        obj &&
        typeof obj === "object" &&
        typeof obj.onSuccess === "function" &&
        typeof obj.onFailure === "function" &&
        typeof obj.level === "number" &&
        typeof obj.maxLevel === "number" &&
        obj.stage !== undefined &&
        typeof obj.results === "string"
    );
}

// =============================================================================
//  Primary Strategy: Direct onSuccess() Call
// =============================================================================

/**
 * Instantly win the current mini-game by calling onSuccess() on the
 * Infiltration model. Returns true if successful.
 */
function winGame(infiltration) {
    try {
        if (!infiltration || !infiltration.stage) return false;

        // Don't call onSuccess during intro, countdown, or victory stages
        const stageName = infiltration.stage.constructor?.name || "";
        if (
            stageName === "IntroModel" ||
            stageName === "CountdownModel" ||
            stageName === "VictoryModel"
        ) {
            return false;
        }

        // Direct win — this is the core exploit
        infiltration.onSuccess();
        return true;
    } catch {
        return false;
    }
}

// =============================================================================
//  Fallback Solvers — Model-Aware
// =============================================================================

/**
 * Solve the current minigame by reading model state and dispatching
 * the correct keystrokes. Used when direct onSuccess() fails.
 *
 * Each solver reads the stage's model properties directly and sends
 * the appropriate key press(es) to advance the game state.
 */

const fallbackSolvers = {
    /**
     * BackwardModel: Type the answer string character by character.
     * Model has: answer (string, UPPERCASE), guess (string, typed so far).
     * The answer is displayed backward in the UI but stored forward in the model.
     */
    BackwardModel(stage) {
        const nextCharIndex = stage.guess.length;
        if (nextCharIndex < stage.answer.length) {
            pressKey(stage.answer[nextCharIndex]);
        }
    },

    /**
     * BracketModel: Close brackets in reverse order.
     * Model has: left (string of opening brackets), right (string of closing typed so far).
     * Must match: [ → ], < → >, ( → ), { → }
     */
    BracketModel(stage) {
        const closingMap = { "[": "]", "<": ">", "(": ")", "{": "}" };
        const nextIndex = stage.right.length;
        // Close brackets from right to left of the opening sequence
        const openBracket = stage.left[stage.left.length - 1 - nextIndex];
        if (openBracket && closingMap[openBracket]) {
            pressKey(closingMap[openBracket]);
        }
    },

    /**
     * BribeModel: Navigate to the positive word and select it.
     * Model has: choices (string[]), index (current selection), correctIndex.
     * Navigate with arrows, space to select.
     */
    BribeModel(stage) {
        // Find the correct choice (positive word)
        if (stage.index === stage.correctIndex) {
            pressKey(" "); // Space to select
        } else if (stage.index < stage.correctIndex) {
            pressKey("ArrowUp"); // Navigate up (increases index)
        } else {
            pressKey("ArrowDown"); // Navigate down (decreases index)
        }
    },

    /**
     * CheatCodeModel: Press the matching arrow key for each code symbol.
     * Model has: code (Arrow[]), index (current position in sequence).
     * Arrow symbols: ↑ ↓ ← →
     */
    CheatCodeModel(stage) {
        const arrowToKey = {
            "↑": "ArrowUp",
            "↓": "ArrowDown",
            "←": "ArrowLeft",
            "→": "ArrowRight",
        };
        if (stage.index < stage.code.length) {
            const arrow = stage.code[stage.index];
            const key = arrowToKey[arrow];
            if (key) pressKey(key);
        }
    },

    /**
     * Cyberpunk2077Model: Navigate grid and select matching cells.
     * Model has: grid (string[][]), answers (string[]), currentAnswerIndex, x, y.
     */
    Cyberpunk2077Model(stage) {
        const targetSymbol = stage.answers[stage.currentAnswerIndex];
        if (!targetSymbol) return;

        // Find the target cell in the grid
        let targetX = -1;
        let targetY = -1;
        for (let y = 0; y < stage.grid.length; y++) {
            for (let x = 0; x < stage.grid[y].length; x++) {
                if (stage.grid[y][x] === targetSymbol) {
                    targetX = x;
                    targetY = y;
                    break;
                }
            }
            if (targetX >= 0) break;
        }

        if (targetX < 0) return;

        // Navigate to the target
        if (stage.y < targetY) {
            pressKey("ArrowDown");
        } else if (stage.y > targetY) {
            pressKey("ArrowUp");
        } else if (stage.x < targetX) {
            pressKey("ArrowRight");
        } else if (stage.x > targetX) {
            pressKey("ArrowLeft");
        } else {
            pressKey(" "); // Space to select
        }
    },

    /**
     * MinesweeperModel: During memory phase, observe. After, navigate to mines and mark them.
     * Model has: minefield (boolean[][]), answer (boolean[][]), memoryPhase (bool), x, y.
     */
    MinesweeperModel(stage) {
        // During memory phase, do nothing — just observe
        if (stage.memoryPhase) return;

        // Find the next mine that hasn't been marked yet
        let targetX = -1;
        let targetY = -1;
        for (let y = 0; y < stage.minefield.length; y++) {
            for (let x = 0; x < stage.minefield[y].length; x++) {
                if (stage.minefield[y][x] && !stage.answer[y][x]) {
                    targetX = x;
                    targetY = y;
                    break;
                }
            }
            if (targetX >= 0) break;
        }

        if (targetX < 0) return; // All mines marked (shouldn't happen — game should have ended)

        // Navigate to the mine
        if (stage.y < targetY) {
            pressKey("ArrowDown");
        } else if (stage.y > targetY) {
            pressKey("ArrowUp");
        } else if (stage.x < targetX) {
            pressKey("ArrowRight");
        } else if (stage.x > targetX) {
            pressKey("ArrowLeft");
        } else {
            pressKey(" "); // Space to mark
        }
    },

    /**
     * SlashModel: Press space when the guard is distracted (phase === 1).
     * Model has: phase (0=guarding, 1=distracted, 2=alerted).
     */
    SlashModel(stage) {
        if (stage.phase === 1) {
            pressKey(" ");
        }
    },

    /**
     * WireCuttingModel: Press number keys for the correct wires.
     * Model has: wires (Wire[]), questions (Question[]), wiresToCut (Set<number>),
     *            cutWires (boolean[]).
     * Wire indices in wiresToCut are 0-based; press keys are 1-based (1-9).
     */
    WireCuttingModel(stage) {
        // Cut all wires that should be cut and haven't been yet
        for (const wireIndex of stage.wiresToCut) {
            if (!stage.cutWires[wireIndex]) {
                pressKey(String(wireIndex + 1));
                return; // One at a time to avoid race conditions
            }
        }
    },
};

/**
 * Attempt to solve the current minigame using the fallback solver.
 * Returns true if a solver was found and executed.
 */
function solveGame(infiltration) {
    try {
        if (!infiltration || !infiltration.stage) return false;

        const stageName = infiltration.stage.constructor?.name || "";
        const solver = fallbackSolvers[stageName];

        if (solver) {
            solver(infiltration.stage);
            return true;
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
 * The wrapEventListeners() shim ensures isTrusted appears true to the game's
 * anti-automation check in InfiltrationRoot.tsx.
 */
function pressKey(keyOrCode) {
    let key = "";
    let keyCode = 0;

    if (typeof keyOrCode === "string") {
        key = keyOrCode;
        // For single characters, use the lowercase charcode
        if (key.length === 1) {
            keyCode = key.toLowerCase().charCodeAt(0);
        }
    } else if (typeof keyOrCode === "number") {
        keyCode = keyOrCode;
        key = String.fromCharCode(keyCode);
    }

    if (!key) return;

    doc.dispatchEvent(
        new KeyboardEvent("keydown", {
            key,
            keyCode,
            code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
            bubbles: true,
        }),
    );
}

// =============================================================================
//  DOM Helper Functions
// =============================================================================

/**
 * Find the first button matching text content.
 */
function findButton(text) {
    return Array.from(doc.querySelectorAll("button")).find(
        (x) => x.innerText.indexOf(text) >= 0,
    );
}

/**
 * Click a button via its React fiber onClick handler (bypasses isTrusted checks).
 */
function clickButton(btn) {
    const reactKey = Object.keys(btn).find(
        (k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"),
    );
    if (reactKey && btn[reactKey] && btn[reactKey].onClick) {
        btn[reactKey].onClick({ isTrusted: true });
    } else {
        btn.click();
    }
}

// =============================================================================
//  Main Loop
// =============================================================================

/** Tracks whether we've detected an active infiltration this session */
let isInfiltrating = false;
/** Tracks the last known stage name to detect transitions */
let lastStageName = "";

/**
 * Called every 50ms. Detects infiltration state and acts accordingly.
 */
function infLoop() {
    const infiltration = getInfiltrationState();

    if (!infiltration) {
        // Not infiltrating — check if we just finished
        if (isInfiltrating) {
            isInfiltrating = false;
            lastStageName = "";
            if (autoMode) {
                selectCompany();
            }
        }
        return;
    }

    const stage = infiltration.stage;
    if (!stage) return;

    const stageName = stage.constructor?.name || "";

    // Track stage transitions for logging
    if (stageName !== lastStageName) {
        lastStageName = stageName;
    }

    // Handle Intro screen: click Start
    if (stageName === "IntroModel") {
        if (!isInfiltrating) {
            isInfiltrating = true;
            infiltrationStart = Date.now();
            const datetime = new Date().toISOString();
            console.log(
                datetime,
                "Start automatic infiltration of",
                infiltration.location?.name || "unknown",
            );
        }
        // Click the Start button via the model
        try {
            infiltration.startInfiltration();
        } catch {
            // If direct call fails, try clicking the DOM button
            const btnStart = findButton("Start");
            if (btnStart) clickButton(btnStart);
        }
        return;
    }

    // Handle Countdown: just wait
    if (stageName === "CountdownModel") {
        if (!infiltrationStart) infiltrationStart = Date.now();
        isInfiltrating = true;
        return;
    }

    // Handle Victory: accept reward
    if (stageName === "VictoryModel") {
        acceptReward();
        return;
    }

    // Active minigame — try primary exploit first, then fallback solver
    isInfiltrating = true;
    if (!winGame(infiltration)) {
        solveGame(infiltration);
    }
}

// =============================================================================
//  Auto Mode: Reward Acceptance & Company Navigation
// =============================================================================

/**
 * Cancel any pending timeout.
 */
function cancelMyTimeout() {
    if (postTimeout) {
        clearTimeout(postTimeout);
        postTimeout = null;
    }
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

    // Accept money — click "Sell for" button
    postTimeout = setTimeout(() => {
        cancelMyTimeout();
        const btn = findButton("Sell for");
        if (btn) {
            if (infiltrationStart) {
                console.info(
                    `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec: ${btn.innerText}`,
                );
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
        let combobox = Array.from(
            doc.querySelectorAll('[role="combobox"]'),
        ).find((x) => x.innerText.indexOf("none") >= 0);
        if (!combobox) {
            combobox = Array.from(
                doc.querySelectorAll('[role="combobox"]'),
            ).find((x) => x.innerText.indexOf(repFaction) >= 0);
        }

        if (combobox) {
            const reactKey = Object.keys(combobox).find((k) =>
                k.startsWith("__reactProps$"),
            );
            if (reactKey && combobox[reactKey].onKeyDown) {
                combobox[reactKey].onKeyDown(
                    new KeyboardEvent("keydown", { key: " " }),
                );
            }

            postTimeout = setTimeout(() => {
                // Select the faction from the dropdown
                const option = Array.from(
                    doc.querySelectorAll('li[role="option"]'),
                ).find((x) => x.innerText.indexOf(repFaction) >= 0);
                if (option) option.click();

                postTimeout = setTimeout(() => {
                    // Click the "Trade for" button
                    const btn = findButton("Trade for");
                    if (btn) {
                        clickButton(btn);
                        if (infiltrationStart) {
                            console.info(
                                `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec - ${btn.innerText}`,
                                repFaction,
                            );
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
 * Uses Singularity API if available, with DOM fallback.
 */
function selectCompany() {
    if (!autoMode) return;
    cancelMyTimeout();

    // Determine which company to return to
    const company = targetCompany;
    if (!company) return;

    postTimeout = setTimeout(() => {
        postTimeout = null;

        if (infiltrationStart) {
            console.info(
                `FAILED INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec`,
            );
            infiltrationStart = 0;
        }

        // DOM fallback: click on the company in the city map
        const selector = 'span[aria-label="' + company + '"]';
        const companyEle = doc.querySelector(selector);
        if (companyEle) {
            companyEle.click();

            postTimeout = setTimeout(() => {
                postTimeout = null;
                const btn = findButton("Infiltrate Company");
                if (btn) clickButton(btn);
            }, 1000);
        }
    }, 1000);
}

// =============================================================================
//  Event Listener Wrapping (Trusted Keyboard Events)
// =============================================================================

/**
 * Wrap document event listeners so that synthetic keyboard events appear trusted.
 * This is required for the fallback mini-game solvers that use pressKey().
 *
 * The game's InfiltrationRoot.tsx checks event.isTrusted and calls
 * onFailure({ automated: true }) which deals Player.hp.current damage (instant kill).
 * This wrapper intercepts keydown listeners and patches isTrusted to true.
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
                        Object.setPrototypeOf(
                            hackedEv,
                            KeyboardEvent.prototype,
                        );
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
