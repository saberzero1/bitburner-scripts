/**Author:
 * Discord:
 * - Sphyxis
 *
 * Additional Contributers:
 * Discord:
 * - Stoneware
 * - gmcew
 * - eithel
 * - Insight (alainbryden)
 */

import {
    getConfiguration,
    instanceCount,
    log,
    getErrorInfo,
    getActiveSourceFiles,
    getNsDataThroughFile,
    formatTime,
} from "./helpers.js";
import { evaluateMove, searchMove } from "./go-search.js";
import { fastSearch } from "./go-fast.js";

const argsSchema = [
    ["cheats", true], // (Now true by default - but still an option for backwards compatibility) This is only possible if you have BN14.2
    ["disable-cheats", false], // Set to true if you want to *not* use cheats for some reason.
    ["cheat-chance-threshold", 0.8], // Don't cheat if our success chance is less than this
    ["logtime", false], // Logs time time it takes for each player to take their move
    ["runOnce", false], // Will only play one game if enabled
    ["board-size", 0], // Board size for new games (5, 7, 9 or 13). 0 = per opponent, the size with the most node power per hour (tools/go-sim)
    ["chooser", "marginal"], // "marginal": play whoever adds the most bonus per hour (tools/go-sim); "winrate": older komi x win-rate^6 weighting
    ["opponent", ""], // Always play this opponent (e.g. "Illuminati"); for testing
    ["random-opponents", false], // Pick opponents uniformly at random (old behaviour) instead of by expected value and win rate
    ["cheat-types", "rescue,twoMoves"], // Cheats to try, in order: twoMoves (capture a 2-liberty group), rescue (remove an enemy
    // stone next to our group in atari), destroyEye (destroy a true eye of a 2-liberty enemy group), repair (restore an offline node we enclose)
    ["cheat-min-capture", 2], // Only cheat (play two moves) to capture an enemy group of at least this many stones
    ["max-cheats-per-game", 3], // A failed cheat after an earlier one in the same game has a 10% chance of ejection (a loss). With
    // rescue,twoMoves, min capture 2, up to 3 cheats and threshold 0.8, tools/go-sim win rates rose e.g. Tetrads 41->84%, Illuminati 30->63%
    ["favor-factions", "Daedalus"], // While a member and before installing The Red Pill, play these factions first until Go
    // has given its maximum favour with them (win streaks add favour, up to 400k rep's worth with SF14.3). Daedalus favour
    // speeds up earning The Red Pill's rep, the long final wait of BN12 runs (tools/favor-model). "" = off.
    ["fast-search", true], // Play by UCT search with fast tactical playouts (go-fast.js) on boards up to search-max-size.
    // tools/go-sim gq_1500 vs heuristics, 5x5 node power/h: Illuminati 344k vs 184k (86% vs 45% won), Daedalus 93k vs 90k,
    // Slum Snakes 88k vs 80k, Tetrads 66k vs 60k; The Black Hand 62k vs 71k and Netburners 44k vs 55k (skipped below)
    ["fast-search-skip", "Netburners,The Black Hand"], // Opponents the heuristics already beat more cheaply
    ["fast-playouts", 1500], // Playouts per move (~0.03 s CPU on 5x5); 1000-2500 were about as good, 4000+ cost more than they won
    ["early-cheats", 2], // With fast-search: cheat (play two moves) on our first N moves of a game. tools/go-fast/match.mjs vs
    // Illuminati 5x5: 0 cheats 50% won, 1: 63%, 2: ~88% (80/80 on boards without offline nodes), 3: 89%; cheating only when
    // behind did no better than cheating early
    ["search", false], // Choose moves by Monte Carlo search on the game's own rules and AI (go-search.js). Off: live it won 28/28 but took
    // 39s per game against 4s for the heuristics (93% won), so node power per hour fell ~5x. Use with a small --search-playouts
    ["search-verify", false], // Check each heuristic move with a few playouts (go-search.js); if any is lost, search instead
    ["verify-playouts", 6], // Playouts to check a heuristic move (stops at the first loss)
    ["search-playouts", 4], // Playouts per candidate move in a search (tools/go-sim/search.sh vs Illuminati 5x5, no cheats:
    // 2: 20/30 won, 4: 29/30, 8: 29/30, 16: 30/30)
    ["search-max-size", 7], // Only search on boards up to this size (playout cost grows fast with the board)
    ["silent", false], // (Obsolete) This script used to automatically tail. Now if you want to do this, call with --tail like normal.
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** Main script entrypoint.
 * Note that to protect against "shared global memory", the entire script is wrapped in the body of the main function.
 * @param {NS} ns */
// Node power per hour by board size, from tools/go-sim (this script with its default cheats vs the game's AI, 60
// games each, at the AI's normal 200 ms/move; bonus time speeds all sizes up equally). The w0r1d_d43m0n was not simulated.
const GO_POWER_PER_HOUR = {
    Netburners: { 5: 21403, 7: 15263, 9: 15001, 13: 13463 },
    "Slum Snakes": { 5: 31446, 7: 18897, 9: 15932, 13: 14232 },
    "The Black Hand": { 5: 18012, 7: 9250, 9: 12624, 13: 14412 },
    Tetrads: { 5: 15276, 7: 10638, 9: 10580, 13: 8129 },
    Daedalus: { 5: 22955, 7: 13612, 9: 14635, 13: 12128 },
    Illuminati: { 5: 91407, 7: 8761, 9: 7527, 13: 9771 }, // 5x5 vs Illuminati has an 8x multiplier (otherwise 2x)
    "????????????": { 13: 8000 },
};
// Each faction's bonusPower (Go Constants.ts)
const GO_BONUS_POWER = { Netburners: 1.3, "Slum Snakes": 1.2, "The Black Hand": 0.9, Tetrads: 0.7, Daedalus: 1.1, Illuminati: 0.7, "????????????": 2 };

/** Cheats roll their success with new WHRNG(Player.totalPlaytime) the moment they're called, and play time only
 * changes on engine ticks (200 ms). So this temp script reads the play time, computes that roll, and calls the cheat
 * in the same tick only when it succeeds (otherwise it waits for the next tick): cheats never fail, so they can't
 * get us ejected either. Gives up (null) after ~15s without a successful tick. Constant source; values via ns.args. */
const TIMED_CHEAT =
    `await (async () => { const a = ns.args; ` +
    `const roll = (t) => { const v = (t / 1000) % 30000; return ((171 * v) % 30269 / 30269 + (172 * v) % 30307 / 30307 + (170 * v) % 30323 / 30323) % 1; }; ` +
    `for (let i = 0; i < 750; i++) { ` +
    `if (roll(ns.getPlayer().totalPlaytime) <= ns.go.cheat.getCheatSuccessChance()) return a[0] === "playTwoMoves" ? await ns.go.cheat.playTwoMoves(a[1], a[2], a[3], a[4]) ` +
    `: a[0] === "removeRouter" ? await ns.go.cheat.removeRouter(a[1], a[2]) : a[0] === "destroyNode" ? await ns.go.cheat.destroyNode(a[1], a[2]) ` +
    `: await ns.go.cheat.repairOfflineNode(a[1], a[2]); ` +
    `await ns.sleep(20); } return null; })()`;

export async function main(ns) {
    let cheats = false;
    let cheatChanceThreshold = 1.0;
    let cheatsThisGame = 0;
    let searchOptions = { on: false, verify: false, verifyPlayouts: 6, playouts: 4, maxSize: 7 };
    let searchStats = { verified: 0, searched: 0, overridden: 0 };
    let maxCheatsPerGame = 1;
    let boardSize = 13;
    let randomOpponents = false;
    let fixedOpponent = null;
    let chooser = "marginal";
    let activeSourceFiles = {};
    let cheatMinCapture = 6;
    let favorFactions = [];
    let favorFocus = []; // favorFactions we're a member of, while The Red Pill isn't installed (refreshed each game)
    let favorFocusAt = 0;
    let cheatTypes = ["twoMoves"];
    let lastStats = null; // ns.go.analysis.getStats() snapshot, to detect each game's result
    const GO_RESULTS_FILE = "/data/go-results.txt";
    let logtime = false;
    let runOnce = true;
    let silent = false;
    let currentValidMovesTurn = 0; //The turn count that the currentValidMoves is valid for
    let turn = 0;
    let START = performance.now();
    // Global variables initialized in this way get strong typing throughout
    let board = /**@returns{string[]}*/ (() => undefined)(); // The current board state
    let currentValidMoves = /**@returns{number[][]}*/ (() => undefined)(); //All valid moves for this turn
    let currentValidContestedMoves = /**@returns{number[][]}*/ (() =>
        undefined)(); //All valid moves that occupy a contested space
    let contested = /**@returns{string[]}*/ (() => undefined)();
    let validMove = /**@returns{boolean[][]}*/ (() => undefined)();
    let validLibMoves = /**@returns{number[][]}*/ (() => undefined)();
    let chains = /**@returns{number[][]}*/ (() => undefined)();
    let testBoard = /**@returns{string[]}*/ (() => [])();

    //X,O = Me, You  x, o = Anything but the other person or a blocking, "W" space is off the board, ? is anything goes
    //B is blocking(Wall or you, not empty or enemy), b is blocking but could be enemy, A is All but . (Wall, Me, You, Blank)
    //* is move here next if you can - no safeties

    const disrupt4 = [
        ["??b?", "?b.b", "b.*b", "?bb?"], //Pattern# Sphyxis - buy a turn #GREAT
        ["?bb?", "b..b", "b*Xb", "?bb?"], //Pattern# Sphyxis - buy a turn #GREAT
        ["?bb?", "b..b", "b.*b", "?bb?"], //Pattern# Sphyxis - buy a turn #GREAT
        ["??b?", "?b.b", "?b*b", "??O?"], //Pattern# Sphyxis - Sacrifice to kill an eye
        ["?bbb", "bb.b", "W.*b", "?oO?"], //Pattern# Sphyxis - 2x2 nook breatk
        ["?bbb", "bb.b", "W.*b", "?Oo?"], //Pattern# Sphyxis - 2x2 nook break
        [".bbb", "o*.b", ".bbb", "????"], //Pattern# Sphyxis - Dangling 2 break
    ];
    const disrupt5 = [
        ["?bbb?", "b.*.b", "?bbb?", "?????", "?????"], //Pattern# Sphyxis - Convert to 1 eye
        ["??OO?", "?b*.b", "?b..b", "??bb?", "?????"], //Pattern# Sphyxis - Buy time
        ["?????", "??bb?", "?b*Xb", "?boob", "??bb?"], //Pattern# Sphyxis - Buy time
        ["WWW??", "WWob?", "Wo*b?", "WWW??", "?????"], //Pattern# Sphyxis - 2x2 attack corner if possible
        ["??b??", "?b.b?", "?b*b?", "?b.A?", "??b??"], //Pattern# Sphyxis - Break two eyes into 1, buy a turn
        ["??b??", "?b.b?", "??*.b", "?b?b?", "?????"], //Pattern# Sphyxis - Break eyes, buy time
        ["?WWW?", "WoOoW", "WOO*W", "W???W", "?????"], //Block 3x3 corner
        ["?WWW?", "Wo*oW", "WOOOW", "W???W", "?????"], //Block 3x3 corner
    ];
    const def5 = [
        ["?WW??", "WW.X?", "W.XX?", "WWW??", "?????"], //Pattern# Sphyxis - Eyes in a nook
        ["WWW??", "WW.X?", "W.*X?", "WWW??", "?????"], //Pattern# Sphyxis - 2x2 corner contain #GREAT
        ["BBB??", "BB.X?", "B..X?", "BBB??", "?????"], //Pattern# Sphyxis - 2x2 corner contain #GREAT
        ["?WWW?", "W.*.W", "WXXXW", "?????", "?????"], //Take the 3x3 back corner
    ];

    // Testing
    //const opponent = ["Slum Snakes", "Tetrads", "Daedalus", "Illuminati"]
    //const opponent2 = ["????????????"]
    // Original
    const opponent = [
        "Netburners",
        "Slum Snakes",
        "The Black Hand",
        "Tetrads",
        "Daedalus",
        "Illuminati",
    ];
    const opponent2 = [
        "Netburners",
        "Slum Snakes",
        "The Black Hand",
        "Tetrads",
        "Daedalus",
        "Illuminati",
        "????????????",
    ];

    await start();

    /** @param {NS} ns */
    async function start() {
        const runOptions = getConfiguration(ns, argsSchema);
        if (!runOptions || (await instanceCount(ns)) > 1) return; // Prevent multiple instances of this script from being started, even with different args.

        logtime = runOptions.logtime;
        runOnce = runOptions.runOnce;

        const sourceFiles = await getActiveSourceFiles(ns, true);
        activeSourceFiles = sourceFiles;
        // Enable cheats if we have SF14.2 or higher (unless the user disabled cheats).
        cheats = !runOptions["disable-cheats"] && (sourceFiles[14] ?? 0) >= 2;
        cheatChanceThreshold = runOptions["cheat-chance-threshold"];
        maxCheatsPerGame = runOptions["max-cheats-per-game"];
        searchOptions = {
            fast: runOptions["fast-search"], fastSkip: String(runOptions["fast-search-skip"]).split(",").map((s) => s.trim()),
            fastPlayouts: runOptions["fast-playouts"], earlyCheats: runOptions["early-cheats"],
            on: runOptions.search, verify: runOptions["search-verify"], verifyPlayouts: runOptions["verify-playouts"],
            playouts: runOptions["search-playouts"], maxSize: runOptions["search-max-size"],
        };
        cheatMinCapture = runOptions["cheat-min-capture"];
        cheatTypes = String(runOptions["cheat-types"]).split(",").map((t) => t.trim()).filter(Boolean);
        boardSize = [5, 7, 9, 13].includes(runOptions["board-size"]) ? runOptions["board-size"] : 0;
        chooser = runOptions.chooser;
        randomOpponents = runOptions["random-opponents"];
        fixedOpponent = runOptions.opponent || null;
        favorFactions = String(runOptions["favor-factions"]).split(",").map((f) => f.trim()).filter(Boolean);
        try {
            lastStats = ns.go.analysis.getStats();
        } catch {}

        ns.disableLog("go.makeMove");

        let ranToCompletion = false;
        while (!ranToCompletion) {
            try {
                await playGo(ns);
                ranToCompletion = true;
            } catch (err) {
                log(
                    ns,
                    `WARNING: go.js Caught (and suppressed) an unexpected error:\n${getErrorInfo(err)}`,
                    false,
                    "warning",
                );
                log(
                    ns,
                    `INFO: Will sleep for 10 seconds than try playing again.`,
                    false,
                );
                await ns.sleep(10 * 1000);
            }
        }
    }

    // Ram-dodging helpers (Allows the script to only require as much RAM as its most expensive function)
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_getBoardState(ns) {
        return await getNsDataThroughFile(ns, `ns.go.getBoardState()`);
    }
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_analysis_getControlledEmptyNodes(ns) {
        return await getNsDataThroughFile(
            ns,
            `ns.go.analysis.getControlledEmptyNodes()`,
        );
    }
    /** @param {NS} ns @returns {Promise<boolean[][]>} */
    async function go_analysis_getValidMoves(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getValidMoves()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getLiberties(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getLiberties()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getChains(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getChains()`);
    }
    /** Fetch the five per-turn board lookups. One combined temp script (61.6 GB) starts one process per turn
     * instead of five, but is only used when home has that much RAM free with room to spare; otherwise (or if it
     * fails) the lookups run separately, peaking at 17.6 GB.
     * @param {NS} ns */
    async function go_getTurnData(ns) {
        const combinedRam = 61.6, headroom = 32;
        const freeHomeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
        if (freeHomeRam >= combinedRam + headroom) {
            try {
                const data = await getNsDataThroughFile(ns,
                    `[ns.go.getBoardState(), ns.go.analysis.getControlledEmptyNodes(), ns.go.analysis.getValidMoves(), ` +
                    `ns.go.analysis.getLiberties(), ns.go.analysis.getChains()]`,
                    { fName: "/Temp/go-turn-data.txt", maxRetries: 1, silent: true });
                if (Array.isArray(data) && data.length === 5) return data;
            } catch {
                // Fall through to separate lookups (RAM was taken between the check and the launch)
            }
        }
        return [
            await go_getBoardState(ns),
            await go_analysis_getControlledEmptyNodes(ns),
            await go_analysis_getValidMoves(ns),
            await go_analysis_getLiberties(ns),
            await go_analysis_getChains(ns),
        ];
    }
    /** @param {NS} ns @returns {Promise<number>} */
    async function go_cheat_getCheatSuccessChance(ns) {
        return await getNsDataThroughFile(
            ns,
            `ns.go.cheat.getCheatSuccessChance()`,
        );
    }
    /** @param {NS} ns @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
     * @returns {Promise<{type: "move" | "pass" | "gameOver";x: number;y: number;}>} */
    async function go_cheat_playTwoMoves(ns, x1, y1, x2, y2) {
        return await getNsDataThroughFile(ns, TIMED_CHEAT, "/Temp/go-timed-cheat.txt", ["playTwoMoves", x1, y1, x2, y2]);
    }
    /** @param {NS} ns @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
     * @returns {Promise<{type: "move" | "pass" | "gameOver";x: number;y: number;}>} */
    async function go_makeMove(ns, x, y) {
        return await ns.go.makeMove(x, y);
        // Note to self - I decided against ram-dodging this request because the "await" actually blocks for a long time.
        // This program spends 99% of its time waiting for makeMove to complete (which is time-throttled by the game)
        // As such, this script permantly eats 4GB of the "temporary memory reserve" left by Daemon, which
        // throws off other scripts which need to "burst" RAM utilization for only an instant.
        // Better to just consume this 4GB predictably as part of this script.
        //return await getNsDataThroughFile(ns, `await ns.go.makeMove(...ns.args)`, null, [x, y]);
    }

    /** One turn by fast search (go-fast.js): on our first early-cheats moves, two moves via a tick-timed cheat. */
    async function fastTurn(ns) {
        const komi = ns.go.getGameState().komi ?? 7.5;
        const legalOf = (rows, exclude) => {
            const moves = [];
            for (let x = 0; x < rows.length; x++)
                for (let y = 0; y < rows.length; y++)
                    if (validMove[x][y] && !(exclude && exclude.x === x && exclude.y === y)) moves.push({ x, y });
            return moves;
        };
        const yieldFn = () => ns.sleep(0);
        const opts = { playouts: searchOptions.fastPlayouts, yieldFn };
        const first = await fastSearch(board, komi, legalOf(board), opts);
        if (!first.move) {
            ns.print(`Fast search: pass (win ${(first.winRate * 100).toFixed(0)}%)`);
            return await ns.go.passTurn();
        }
        if (cheats && cheatsThisGame < searchOptions.earlyCheats && cheatsThisGame < maxCheatsPerGame) {
            const rows = board.map((r, x) => (x === first.move.x ? r.slice(0, first.move.y) + "X" + r.slice(first.move.y + 1) : r));
            const second = await fastSearch(rows, komi, legalOf(rows, first.move), opts);
            if (second.move) {
                cheatsThisGame++;
                const results = await go_cheat_playTwoMoves(ns, first.move.x, first.move.y, second.move.x, second.move.y);
                if (results) {
                    ns.print(`Fast search: cheat ${first.move.x},${first.move.y} + ${second.move.x},${second.move.y} (win ${(second.winRate * 100).toFixed(0)}%)`);
                    return results;
                }
                cheatsThisGame--; // no successful tick: play normally
            }
        }
        ns.print(`Fast search: ${first.move.x},${first.move.y} (win ${(first.winRate * 100).toFixed(0)}%, ${first.playouts} playouts)`);
        return await go_makeMove(ns, first.move.x, first.move.y);
    }

    /** @param {NS} ns */
    async function playGo(ns) {
        const startBoard = await go_getBoardState(ns);
        let inProgress = false;
        turn = 0;
        currentValidMovesTurn = -1; // (re)starting: don't trust a move list cached before a crash
        START = performance.now();
        //If we have already moved, jump the turn to 3 to get out of Opening Moves
        for (let x = 0; x < startBoard[0].length; x++) {
            for (let y = 0; y < startBoard[0].length; y++) {
                if (startBoard[x][y] === "X") {
                    inProgress = true;
                    turn = 3;
                    break;
                }
            }
            if (inProgress) break;
        }
        const currentGame = await ns.go.opponentNextTurn(false);
        checkNewGame(ns, currentGame);
        let playStyle = getStyle(ns);
        let lastResults = null; // The opponent's last response (type "pass" means they passed)
        while (true) {
            turn++;
            if (turn === 1) {
                playStyle = getStyle(ns); // A new game (possibly a different opponent) started
                await refreshFavorFocus(ns);
            }
            [board, contested, validMove, validLibMoves, chains] = await go_getTurnData(ns);
            const size = board[0].length;
            //Build a test board with walls
            let testWall = "W".repeat(size + 2);
            testBoard = [];
            testBoard.push(testWall);
            for (const b of board) testBoard.push("W" + b + "W");
            testBoard.push(testWall);
            //We have our test board

            let results;
            if (turn >= 3 && lastResults?.type === "pass") {
                const state = ns.go.getGameState();
                if (state.blackScore > state.whiteScore) {
                    ns.print(`Opponent passed and we're ahead (${state.blackScore} vs ${state.whiteScore}): passing to win`);
                    results = await ns.go.passTurn();
                    lastResults = results;
                    checkNewGame(ns, results);
                    continue;
                }
            }
            if (searchOptions.fast && size <= searchOptions.maxSize && !searchOptions.fastSkip.includes(ns.go.getOpponent())) {
                try {
                    results = await fastTurn(ns);
                } catch (err) {
                    log(ns, `WARNING: Go fast search failed, using the heuristics this turn: ${getErrorInfo(err)}`);
                }
                if (results) {
                    lastResults = results;
                    checkNewGame(ns, results);
                    continue;
                }
            }
            if (searchOptions.on && size <= searchOptions.maxSize) {
                let move;
                try {
                    move = await searchMove(ns, board, ns.go.getMoveHistory(), ns.go.getOpponent(), searchOptions.playouts);
                } catch (err) {
                    log(ns, `WARNING: Go search failed, using the heuristics this turn: ${getErrorInfo(err)}`);
                }
                if (move !== undefined) {
                    results = move ? await go_makeMove(ns, move.x, move.y) : await ns.go.passTurn();
                    lastResults = results;
                    checkNewGame(ns, results);
                    continue;
                }
            }
            if (turn < 3) results = await movePiece(ns, getOpeningMove(ns));

            if (turn >= 3) {
                switch (playStyle) {
                    case 0: //Netburners
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomCounterLib(),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(88),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibDefend(),
                            ))
                        )
                            break;
                        if (
                            (results = await moveCheat(ns))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(2, 2, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, disruptEyes())))
                            break;
                        if ((results = await movePiece(ns, getDefPattern())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(3, 3, 3, 1, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(4, 7, 3, 1, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(ns, attackGrowDragon(1)))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getDefAttack(8, 20, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomExpand())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1, false, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomStrat())))
                            break;
                        ns.print("Turn Passed");
                        results = await ns.go.passTurn();
                        break;
                    case 1: //The Black Hand
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomCounterLib(),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(88),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibDefend(),
                            ))
                        )
                            break;
                        if (
                            (results = await moveCheat(ns))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(2, 2, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, disruptEyes())))
                            break;
                        if ((results = await movePiece(ns, getDefPattern())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(3, 3, 3, 1, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(4, 7, 3, 1, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(ns, attackGrowDragon(1)))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomExpand())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1, false, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomStrat())))
                            break;
                        ns.print("Turn Passed");
                        results = await ns.go.passTurn();
                        break;
                    case 2: //Mr. Mustacio - Slum Snakes
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomCounterLib(),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(88),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibDefend(),
                            ))
                        )
                            break;
                        if (
                            (results = await moveCheat(ns))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(2, 2, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, disruptEyes())))
                            break;
                        if ((results = await movePiece(ns, getDefPattern())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(3, 3, 3, 1, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getDefAttack(4, 7, 3, 1, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(ns, attackGrowDragon(1)))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomExpand())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1, false, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomStrat())))
                            break;
                        ns.print("Turn Passed");
                        results = await ns.go.passTurn();
                        break;
                    case 3: //Daedalus
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomCounterLib(),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(88),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibDefend(),
                            ))
                        )
                            break;
                        if (
                            (results = await moveCheat(ns))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(2, 2, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, disruptEyes())))
                            break;
                        if ((results = await movePiece(ns, getDefPattern())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(3, 4, 3, 1, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getDefAttack(5, 7, 3, 2, 6),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(ns, attackGrowDragon(1)))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomExpand())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1, false, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomStrat())))
                            break;
                        ns.print("Turn Passed");
                        results = await ns.go.passTurn();
                        break;
                    case 4: //Tetrads
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomCounterLib(),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(88),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibDefend(),
                            ))
                        )
                            break;
                        if (
                            (results = await moveCheat(ns))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(2, 2, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, disruptEyes())))
                            break;
                        if ((results = await movePiece(ns, getDefPattern())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(3, 4, 3),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(5, 7, 3),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(ns, attackGrowDragon(1)))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomExpand())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1, false),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomStrat())))
                            break;
                        ns.print("Turn Passed");
                        results = await ns.go.passTurn();
                        break;
                    case 5: //Illum
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomCounterLib(),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(88),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibDefend(),
                            ))
                        )
                            break;
                        if (
                            (results = await moveCheat(ns))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(2, 2, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, disruptEyes())))
                            break;
                        if ((results = await movePiece(ns, getDefPattern())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(3, 4, 3),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(ns, attackGrowDragon(1)))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomExpand())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1, false),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomStrat())))
                            break;
                        ns.print("Turn Passed");
                        results = await ns.go.passTurn();
                        break;
                    case 6: //??????
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomCounterLib(),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(88),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibDefend(),
                            ))
                        )
                            break;
                        if (
                            (results = await moveCheat(ns))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(2, 2, 2),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, disruptEyes())))
                            break;
                        if ((results = await movePiece(ns, getDefPattern())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getAggroAttack(3, 4, 3),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getDefAttack(5, 7, 3),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(ns, attackGrowDragon(1)))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomExpand())))
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomBolster(2, 1, false),
                            ))
                        )
                            break;
                        if (
                            (results = await movePiece(
                                ns,
                                getRandomLibAttack(),
                            ))
                        )
                            break;
                        if ((results = await movePiece(ns, getRandomStrat())))
                            break;
                        ns.print("Turn Passed");
                        results = await ns.go.passTurn();
                        break;
                } //End of style switch
            } // end of turn >= 3
            lastResults = results;
            checkNewGame(ns, results);
        }
    }

    /** Append this game's result (detected from the change in ns.go.analysis.getStats) to GO_RESULTS_FILE. */
    function recordGameResult(ns) {
        try {
            const stats = ns.go.analysis.getStats();
            const opp = ns.go.getOpponent();
            const before = lastStats?.[opp] ?? { wins: 0, losses: 0 };
            const after = stats[opp] ?? { wins: 0, losses: 0 };
            lastStats = stats;
            const won = after.wins > before.wins;
            if (!won && !(after.losses > before.losses)) return; // couldn't tell
            const entry = {
                t: Date.now(),
                opp,
                size: board?.length ?? null, // last board fetched this game (getBoardState directly would cost 4 GB)
                won,
                streak: after.winStreak,
                cheats: cheatsThisGame,
                ...searchStats, // heuristic moves checked, searched, overridden by the search this game
            };
            ns.write(GO_RESULTS_FILE, JSON.stringify(entry) + "\n", "a");
            const text = ns.read(GO_RESULTS_FILE);
            if (text.length > 200_000) ns.write(GO_RESULTS_FILE, text.slice(text.indexOf("\n", text.length - 100_000) + 1), "w");
            ns.print(`${won ? "WON" : "LOST"} vs ${opp} (streak ${after.winStreak}, record ${after.wins}-${after.losses})`);
        } catch {}
    }

    /** Pick the next opponent by expected node power: difficulty multiplier (komi) x bonus usefulness x win rate^6.
     *  Win streaks multiply node power (up to 3x) and any loss drops it to 0.5x, so opponents we sometimes lose to are
     *  rarely picked. Opponents with few games are still explored. */
    /** Board size to play `opp` on: the fixed --board-size, or the size with the most node power per hour. */
    function sizeFor(opp) {
        if (boardSize) return boardSize;
        const rates = GO_POWER_PER_HOUR[opp] ?? { 13: 1 };
        return Number(Object.keys(rates).reduce((a, b) => (rates[a] >= rates[b] ? a : b)));
    }

    /** Which --favor-factions we're in (Go favour only counts for members), unless The Red Pill is installed. */
    async function refreshFavorFocus(ns) {
        if (favorFactions.length === 0 || Date.now() - favorFocusAt < 60_000) return;
        favorFocusAt = Date.now();
        try {
            const [factions, hasRedPill] = await getNsDataThroughFile(ns,
                `[ns.getPlayer().factions, ns.getResetInfo().ownedAugs.has("The Red Pill")]`,
                { fName: "/Temp/go-favor-focus.txt", silent: true });
            favorFocus = hasRedPill ? [] : favorFactions.filter((f) => factions.includes(f));
        } catch {
            favorFocus = [];
        }
    }

    /** Most rep Go win streaks convert into favour with one faction per BitNode (Go effect.ts getMaxRep). */
    function goMaxFavorRep() {
        const sf14 = activeSourceFiles[14] ?? 0;
        return sf14 >= 3 ? 400_000 : sf14 === 2 ? 300_000 : sf14 === 1 ? 200_000 : 100_000;
    }

    function chooseOpponent(ns, candidates) {
        if (fixedOpponent) return fixedOpponent;
        if (favorFocus.length > 0) {
            let goStats = {};
            try {
                goStats = ns.go.analysis.getStats();
            } catch {}
            const unfinished = favorFocus.find((f) => candidates.includes(f) && (goStats[f]?.rep ?? 0) < goMaxFavorRep());
            if (unfinished) return unfinished;
        }
        if (randomOpponents) return candidates[Math.floor(Math.random() * candidates.length)];
        const komi = { Netburners: 1.5, "Slum Snakes": 3.5, "The Black Hand": 3.5, Tetrads: 5.5, Daedalus: 5.5, Illuminati: 7.5, "????????????": 9.5 };
        // Rough usefulness of each faction's bonus to this repo's automation (hacking-related bonuses matter most)
        const usefulness = { Netburners: 0.4, "Slum Snakes": 0.5, "The Black Hand": 1, Tetrads: 0.4, Daedalus: 1, Illuminati: 1.2, "????????????": 1.2 };
        let stats = {};
        try {
            stats = ns.go.analysis.getStats();
        } catch {}
        if (chooser === "marginal") {
            // The bonus is 1 + ln(P+1) * (P+1)^0.3 * 0.002 * bonusPower (Go effect.ts), strongly diminishing in node
            // power P. Play whoever gains the most usefulness-weighted bonus per hour at their current P.
            // getStats() has no node power, only bonusPercent: invert the bonus formula (bisection on log P). The
            // multiplier is 2 with SF14 (BN14's extra GoPower x4 is ignored: it rescales every opponent alike).
            const sfMult = (activeSourceFiles[14] ?? 0) > 0 ? 2 : 1;
            const nodePower = (o) => {
                const target = (stats[o]?.bonusPercent ?? 0) / 100 / (0.002 * (GO_BONUS_POWER[o] ?? 1) * sfMult);
                if (!(target > 0)) return 0;
                let lo = 0, hi = 60; // log(P + 1)
                for (let i = 0; i < 60; i++) {
                    const mid = (lo + hi) / 2;
                    if (mid * Math.exp(0.3 * mid) < target) lo = mid;
                    else hi = mid;
                }
                return Math.exp(lo) - 1;
            };
            const value = (o) => {
                const p = nodePower(o);
                const slope = Math.pow(p + 1, -0.7) * (1 + 0.3 * Math.log(p + 1));
                const rate = (GO_POWER_PER_HOUR[o] ?? { 13: 0 })[sizeFor(o)] ?? 0;
                return (usefulness[o] ?? 1) * (GO_BONUS_POWER[o] ?? 1) * slope * rate;
            };
            return candidates.reduce((best, o) => (value(o) > value(best) ? o : best), candidates[0]);
        }
        const weights = candidates.map((o) => {
            const s = stats[o] ?? { wins: 0, losses: 0 };
            const games = s.wins + s.losses;
            const winRate = (s.wins + 1) / (games + 2); // Laplace-smoothed
            const exploration = games < 5 ? 0.5 : 0;
            return ((komi[o] ?? 5.5) + 0.5) * 0.25 * (usefulness[o] ?? 1) * (Math.pow(winRate, 6) + exploration);
        });
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < candidates.length; i++) if ((r -= weights[i]) <= 0) return candidates[i];
        return candidates[candidates.length - 1];
    }

    /** @param {NS} ns */
    function getStyle(ns) {
        switch (ns.go.getOpponent()) {
            case "Netburners":
                return 0;
            case "The Black Hand":
                return 1;
            case "Slum Snakes":
                return 2;
            case "Daedalus":
                return 3;
            case "Tetrads":
                return 4;
            case "Illuminati":
                return 5;
            default:
                return 6;
        }
    }

    /** @param {NS} ns
     * @param {{ type:"move"|"pass"|"gameOver"; x:number; y:number;}} gameInfo
     */
    function checkNewGame(ns, gameInfo) {
        if (gameInfo.type === "gameOver") {
            recordGameResult(ns);
            if (runOnce) ns.exit();
            cheatsThisGame = 0;
            searchStats = { verified: 0, searched: 0, overridden: 0 };
            try {
                const next = chooseOpponent(ns, opponent2);
                ns.go.resetBoardState(next, sizeFor(next));
            } catch {
                // (The w0r1d_d43m0n is only available after the Red Pill)
                const next = chooseOpponent(ns, opponent);
                ns.go.resetBoardState(next, sizeFor(next));
            }
            turn = 0;
            currentValidMovesTurn = -1; // turn numbers restart, so don't reuse the previous game's move list
            ns.clearLog();
        }
    }
    /** @param {NS} ns
     * @param {number} x
     * @param {number} y
     * @param {string[]} pattern
     * @returns {boolean}
     */
    function isPattern(x, y, pattern) {
        //Move the pattern around with x/y loops, check if pattern matches IF a move is placed
        //We can assume that x and y are valid moves

        const size = testBoard[0].length;
        const patterns = getAllPatterns(pattern);
        const patternSize = pattern.length;

        for (const patternCheck of patterns) {
            //cx and cy - the spots of the pattern we are checking against the test board
            //For, say a 3x3 pattern, we do a grid of 0,0 -> 2, 2
            for (let cx = (patternSize - 1) * -1; cx <= 0; cx++) {
                // We've added a wall around everything, so 0 is a wall
                if (cx + x + 1 < 0 || cx + x + 1 > size - 1) continue;
                for (let cy = (patternSize - 1) * -1; cy <= 0; cy++) {
                    //We now have a cycle that will check each section of the grid against the pattern
                    //Safety checks: We know 0,0 is safe, we were sent it, but each other section could be bad
                    if (cy + y + 1 < 0 || cy + y + 1 > size - 1) continue;
                    let count = 0;
                    let abort = false;
                    for (let px = 0; px < patternSize && !abort; px++) {
                        if (x + cx + px + 1 < 0 || x + cx + px + 1 >= size) {
                            //Don't go off grid
                            abort = true;
                            break;
                        }
                        for (let py = 0; py < patternSize && !abort; py++) {
                            if (
                                y + cy + py + 1 < 0 ||
                                y + cy + py + 1 >= size
                            ) {
                                //Are we off the map?
                                abort = true;
                                break;
                            }
                            if (
                                cx + px === 0 &&
                                cy + py === 0 &&
                                !["X", "*"].includes(patternCheck[px][py])
                            ) {
                                abort = true;
                                break;
                            }
                            if (
                                cx + px === 0 &&
                                cy + py === 0 &&
                                ["X"].includes(contested[x][y]) &&
                                patternCheck[px][py] !== "*"
                            ) {
                                abort = true;
                                break;
                            }
                            //We now have a cycles for each spot in the pattern
                            //0,0 -> 2,2 for a 3x3
                            switch (patternCheck[px][py]) {
                                case "X":
                                    if (
                                        testBoard[cx + x + 1 + px][
                                            cy + y + 1 + py
                                        ] === "X" ||
                                        (cx + px === 0 &&
                                            cy + py === 0 &&
                                            testBoard[cx + x + 1 + px][
                                                cy + y + 1 + py
                                            ] === ".")
                                    ) {
                                        count++;
                                    } else if (cx + px === 0 && cy + py === 0) {
                                        count++; // Our placement piece
                                    } else abort = true;
                                    break;
                                case "*": // Special case.  We move here next or break the test
                                    if (
                                        testBoard[cx + x + 1 + px][
                                            cy + y + 1 + py
                                        ] === "." &&
                                        cx + px === 0 &&
                                        cy + py === 0
                                    ) {
                                        count++;
                                    } else abort = true;
                                    break;
                                case "O":
                                    if (
                                        testBoard[cx + x + 1 + px][
                                            cy + y + 1 + py
                                        ] === "O"
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                                case "x":
                                    if (
                                        ["X", "."].includes(
                                            testBoard[cx + x + 1 + px][
                                                cy + y + 1 + py
                                            ],
                                        )
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                                case "o":
                                    if (
                                        ["O", "."].includes(
                                            testBoard[cx + x + 1 + px][
                                                cy + y + 1 + py
                                            ],
                                        )
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                                case "?":
                                    count++;
                                    break;
                                case ".":
                                    if (
                                        testBoard[cx + x + 1 + px][
                                            cy + y + 1 + py
                                        ] === "."
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                                case "W":
                                    if (
                                        ["W", "#"].includes(
                                            testBoard[cx + x + 1 + px][
                                                cy + y + 1 + py
                                            ],
                                        )
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                                case "B":
                                    if (
                                        ["W", "#", "X"].includes(
                                            testBoard[cx + x + 1 + px][
                                                cy + y + 1 + py
                                            ],
                                        )
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                                case "b":
                                    if (
                                        ["W", "#", "O"].includes(
                                            testBoard[cx + x + 1 + px][
                                                cy + y + 1 + py
                                            ],
                                        )
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                                case "A":
                                    if (
                                        ["W", "#", "X", "O"].includes(
                                            testBoard[cx + x + 1 + px][
                                                cy + y + 1 + py
                                            ],
                                        )
                                    )
                                        count++;
                                    else abort = true;
                                    break;
                            }
                            if (count === patternSize * patternSize)
                                return true;
                        }
                    }
                }
            }
        }
        return false;
    }
    /** @param {NS} ns
     * @param {string[]} pattern
     * @returns {string[][]} */
    function getAllPatterns(pattern) {
        const rotations = [
            pattern,
            rotate90Degrees(pattern),
            rotate90Degrees(rotate90Degrees(pattern)),
            rotate90Degrees(rotate90Degrees(rotate90Degrees(pattern))),
        ];
        return [...rotations, ...rotations.map(verticalMirror)];
    }

    //Special thanks to @gmcew for the next 2 functions!
    /** @param {NS} ns
     * @param {string[]} pattern
     * @returns {string[]} */
    function rotate90Degrees(pattern) {
        return pattern.map((val, index) =>
            pattern
                .map((row) => row[index])
                .reverse()
                .join(""),
        );
    }
    /** @param {NS} ns
     * @param {string[]} pattern
     * @returns {string[]} */
    function verticalMirror(pattern) {
        return pattern.toReversed();
    }

    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getSnakeEyes(minKilled = 5) {
        if (!cheats) return [];
        const moveOptions = [];
        const size = board[0].length;
        let highValue = 1;

        const checked = new Set();

        for (let x = 0; x < size - 1; x++)
            for (let y = 0; y < size - 1; y++) {
                if (
                    contested[x][y] === "X" ||
                    board[x][y] !== "O" ||
                    validLibMoves[x][y] !== 2 ||
                    checked.has(JSON.stringify([x, y]))
                )
                    continue;
                //Is it the enemy, with 2 libs (we can kill) and we have not checked this spot and the chain is large enough
                const chain = getChainValue(x, y, "O");
                if (chain < minKilled) continue;
                //We have a winner!  Check all it's spots and find the 2 killing blows.  Add the checked spots to the checked list so we don't recheck
                checked.add(JSON.stringify([x, y]));
                const enemySearch = new Set();
                const move1 = [];
                const move2 = [];
                enemySearch.add(JSON.stringify([x, y]));
                for (const explore of enemySearch) {
                    const [fx, fy] = JSON.parse(explore);
                    //Find your eyes
                    if (board[fx][fy] === ".") {
                        move1.length
                            ? move2.push([fx, fy])
                            : move1.push([fx, fy]);
                        checked.add(JSON.stringify([fx, fy]));
                        continue;
                    }

                    //Find more of yourself to search...
                    if (
                        fx < size - 1 &&
                        ["O", "."].includes(board[fx + 1][fy])
                    ) {
                        enemySearch.add(JSON.stringify([fx + 1, fy]));
                        checked.add(JSON.stringify([fx, fy]));
                    }
                    if (fx > 0 && ["O", "."].includes(board[fx - 1][fy])) {
                        enemySearch.add(JSON.stringify([fx - 1, fy]));
                        checked.add(JSON.stringify([fx, fy]));
                    }
                    if (fy > 0 && ["O", "."].includes(board[fx][fy - 1])) {
                        enemySearch.add(JSON.stringify([fx, fy - 1]));
                        checked.add(JSON.stringify([fx, fy]));
                    }
                    if (
                        fy < size - 1 &&
                        ["O", "."].includes(board[fx][fy + 1])
                    ) {
                        enemySearch.add(JSON.stringify([fx, fy + 1]));
                        checked.add(JSON.stringify([fx, fy]));
                    }
                } // End of searching the enemy

                if (chain > highValue) {
                    highValue = chain;
                    moveOptions.length = 0;
                    const mv1 = move1.pop();
                    const mv2 = move2.pop();
                    moveOptions.push([mv1[0], mv1[1], mv2[0], mv2[1]]);
                } else if (chain === highValue) {
                    const mv1 = move1.pop();
                    const mv2 = move2.pop();
                    moveOptions.push([mv1[0], mv1[1], mv2[0], mv2[1]]);
                }
            } // Search whole board

        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg: "SnakeEyes Cheat",
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomLibAttack(minKilled = 1) {
        const moveOptions = [];
        const size = board[0].length;
        let highValue = 1;
        // Look through all the points on the board
        const moves = getAllValidMoves(true);
        for (const [x, y] of moves) {
            if (contested[x][y] === "X" || validLibMoves[x][y] !== -1) continue;

            let count = 0;
            let chains = 0;

            //We are only checking up, down, left and right
            if (
                x > 0 &&
                board[x - 1][y] === "O" &&
                validLibMoves[x - 1][y] === 1
            ) {
                count++;
                chains += getChainValue(x - 1, y, "O");
            }
            if (
                x < size - 1 &&
                board[x + 1][y] === "O" &&
                validLibMoves[x + 1][y] === 1
            ) {
                count++;
                chains += getChainValue(x + 1, y, "O");
            }
            if (
                y > 0 &&
                board[x][y - 1] === "O" &&
                validLibMoves[x][y - 1] === 1
            ) {
                count++;
                chains += getChainValue(x, y - 1, "O");
            }
            if (
                y < size - 1 &&
                board[x][y + 1] === "O" &&
                validLibMoves[x][y + 1] === 1
            ) {
                count++;
                chains += getChainValue(x, y + 1, "O");
            }
            const enemyLibs = getSurroundLibs(x, y, "O");
            if (count === 0 || (chains < minKilled && enemyLibs <= 1)) continue;

            const result = count * chains;
            if (result > highValue) {
                moveOptions.length = 0;
                moveOptions.push([x, y]);
                highValue = result;
            } else if (result === highValue) moveOptions.push([x, y]);
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg: "Lib Attack",
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomLibDefend(savedMin = 1) {
        const moveOptions = [];
        const size = board[0].length;
        let highValue = 0;
        // Look through all the points on the board
        const moves = getAllValidMoves();
        for (const [x, y] of moves) {
            const surround = getSurroundLibs(x, y, "X");
            const myEyes = getEyeValue(x, y, "X");
            if (surround + myEyes < 2) continue; //Abort.  Let it go, let it go...

            if (validLibMoves[x][y] === -1) {
                let count = 0;
                //We are only checking up, down, left and right
                if (
                    x > 0 &&
                    validLibMoves[x - 1][y] === 1 &&
                    board[x - 1][y] === "X"
                )
                    count += getChainValue(x - 1, y, "X");
                if (
                    x < size - 1 &&
                    validLibMoves[x + 1][y] === 1 &&
                    board[x + 1][y] === "X"
                )
                    count += getChainValue(x + 1, y, "X");
                if (
                    y > 0 &&
                    validLibMoves[x][y - 1] === 1 &&
                    board[x][y - 1] === "X"
                )
                    count += getChainValue(x, y - 1, "X");
                if (
                    y < size - 1 &&
                    validLibMoves[x][y + 1] === 1 &&
                    board[x][y + 1] === "X"
                )
                    count += getChainValue(x, y + 1, "X");
                if (count === 0 || count < savedMin) continue;
                //Just HOW effective will this move be?  Counter attack if we can.
                count *= surround;

                if (count > highValue) {
                    moveOptions.length = 0;
                    moveOptions.push([x, y]);
                    highValue = count;
                } else if (count === highValue) moveOptions.push([x, y]);
            }
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg: "Lib Defend",
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomCounterLib() {
        //Advanced strategy
        //If we have a chain that's going to die, and a hanging lib attached to it
        //Find that hanging lib and kill it to save the chain
        const size = board[0].length;
        // Look through all the points on the board
        const moves = getAllValidMoves();
        const movesAvailable = new Set(); //Contains the empty squares that we are looking to see if we should take
        const friendlyToCheckForOpp = new Set();
        for (const [x, y] of moves) {
            //We are checking up, down, left and right first
            if (
                x > 0 &&
                validLibMoves[x - 1][y] === 1 &&
                board[x - 1][y] === "X"
            ) {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x - 1, y]));
            }
            if (
                x < size - 1 &&
                validLibMoves[x + 1][y] === 1 &&
                board[x + 1][y] === "X"
            ) {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x + 1, y]));
            }
            if (
                y > 0 &&
                validLibMoves[x][y - 1] === 1 &&
                board[x][y - 1] === "X"
            ) {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x, y - 1]));
            }
            if (
                y < size - 1 &&
                validLibMoves[x][y + 1] === 1 &&
                board[x][y + 1] === "X"
            ) {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x, y + 1]));
            }
        }
        //Shortcut.  While there's 1, is it THE one?
        //We know that 1 side of this is a friendly with 1 lib at risk.  Is another side the enemy?
        for (const explore of movesAvailable) {
            const [fx, fy] = JSON.parse(explore);
            if (!validMove[fx][fy]) continue;
            if (
                fx < size - 1 &&
                board[fx + 1][fy] === "O" &&
                validLibMoves[fx + 1][fy] === 1
            ) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the east",
                };
            }
            if (
                fx > 0 &&
                board[fx - 1][fy] === "O" &&
                validLibMoves[fx - 1][fy] === 1
            ) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the west",
                };
            }
            if (
                fy > 0 &&
                board[fx][fy - 1] === "O" &&
                validLibMoves[fx][fy - 1] === 1
            ) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the south",
                };
            }
            if (
                fy < size - 1 &&
                board[fx][fy + 1] === "O" &&
                validLibMoves[fx][fy + 1] === 1
            ) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the north",
                };
            }
        }
        const enemiesToSearch = new Set();
        //We have our empty chain.  Look through him to find adjoining O's that can be killed and other friendies
        for (const explore of friendlyToCheckForOpp) {
            const [fx, fy] = JSON.parse(explore);
            if (
                fx < size - 1 &&
                board[fx + 1][fy] === "O" &&
                validLibMoves[fx + 1][fy] === 1
            )
                enemiesToSearch.add(JSON.stringify([fx + 1, fy]));
            if (
                fx > 0 &&
                board[fx - 1][fy] === "O" &&
                validLibMoves[fx - 1][fy] === 1
            )
                enemiesToSearch.add(JSON.stringify([fx - 1, fy]));
            if (
                fy > 0 &&
                board[fx][fy - 1] === "O" &&
                validLibMoves[fx][fy - 1] === 1
            )
                enemiesToSearch.add(JSON.stringify([fx, fy - 1]));
            if (
                fy < size - 1 &&
                board[fx][fy + 1] === "O" &&
                validLibMoves[fx][fy + 1] === 1
            )
                enemiesToSearch.add(JSON.stringify([fx, fy + 1]));

            if (fx < size - 1 && ["X"].includes(board[fx + 1][fy]))
                friendlyToCheckForOpp.add(JSON.stringify([fx + 1, fy]));
            if (fx > 0 && ["X"].includes(board[fx - 1][fy]))
                friendlyToCheckForOpp.add(JSON.stringify([fx - 1, fy]));
            if (fy > 0 && ["X"].includes(board[fx][fy - 1]))
                friendlyToCheckForOpp.add(JSON.stringify([fx, fy - 1]));
            if (fy < size - 1 && ["X"].includes(board[fx][fy + 1]))
                friendlyToCheckForOpp.add(JSON.stringify([fx, fy + 1]));
        }

        for (const explore of enemiesToSearch) {
            const [fx, fy] = JSON.parse(explore);
            if (fx < size - 1 && board[fx + 1][fy] === "O")
                enemiesToSearch.add(JSON.stringify([fx + 1, fy]));
            if (fx > 0 && board[fx - 1][fy] === "O")
                enemiesToSearch.add(JSON.stringify([fx - 1, fy]));
            if (fy > 0 && board[fx][fy - 1] === "O")
                enemiesToSearch.add(JSON.stringify([fx, fy - 1]));
            if (fy < size - 1 && board[fx][fy + 1] === "O")
                enemiesToSearch.add(JSON.stringify([fx, fy + 1]));

            if (
                fx < size - 1 &&
                board[fx + 1][fy] === "." &&
                validMove[fx + 1][fy]
            ) {
                return {
                    coords: [fx + 1, fy],
                    msg: "Counter Lib Attack - The wind blows",
                };
            }
            if (fx > 0 && board[fx - 1][fy] === "." && validMove[fx - 1][fy]) {
                return {
                    coords: [fx - 1, fy],
                    msg: "Counter Lib Attack - The earth grows",
                };
            }
            if (fy > 0 && board[fx][fy - 1] === "." && validMove[fx][fy - 1]) {
                return {
                    coords: [fx, fy - 1],
                    msg: "Counter Lib Attack - The fire burns",
                };
            }
            if (
                fy < size - 1 &&
                board[fx][fy + 1] === "." &&
                validMove[fx][fy + 1]
            ) {
                return {
                    coords: [fx, fy + 1],
                    msg: "Counter Lib Attack - The water flows",
                };
            }
        }
        return [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomExpand() {
        const moveOptions = [];
        const size = board[0].length;
        let highValue = 0;
        // Look through all the points on the board
        const moves = getAllValidMoves(true);
        for (const [x, y] of moves) {
            const surroundLibs = getSurroundLibs(x, y, "X");
            const enemySurroundLibs = getSurroundLibs(x, y, "O");
            if (
                contested[x][y] !== "?" ||
                surroundLibs <= 2 ||
                createsLib(x, y, "X") ||
                enemySurroundLibs <= 1
            )
                continue;
            let count = 0;
            //We are only checking up, down, left and right.  Don't expand if you're surrounded by friendlies
            if (x > 0 && board[x - 1][y] === "X") count++;
            if (x < size - 1 && board[x + 1][y] === "X") count++;
            if (y > 0 && board[x][y - 1] === "X") count++;
            if (y < size - 1 && board[x][y + 1] === "X") count++;
            if (count >= 3 || count <= 0) continue;

            const surroundSpace = getSurroundSpaceFull(x, y) + 1;
            const enemySurroundChains = getChainAttack(x, y) + 1;
            const myEyes = getEyeValueFull(x, y, "X") + 1;
            const enemies = getSurroundEnemiesFull(x, y) + 1;
            const freeSpace = getFreeSpace(x, y);
            const rank =
                myEyes *
                enemySurroundLibs *
                enemies *
                enemySurroundChains *
                freeSpace *
                surroundSpace;

            if (rank > highValue) {
                moveOptions.length = 0;
                moveOptions.push([x, y]);
                highValue = rank;
            } else if (rank === highValue) moveOptions.push([x, y]);
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg: "Expansion",
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomBolster(
        libRequired,
        savedNodesMin,
        onlyContested = true,
    ) {
        const moveOptions = [];
        const size = board[0].length;
        let highValue = 1;
        // Look through all the points on the board
        const moves = getAllValidMoves();
        for (const [x, y] of moves) {
            if (
                (onlyContested && contested[x][y] !== "?") ||
                createsLib(x, y, "X")
            )
                continue;
            let right = 0;
            let left = 0;
            let up = 0;
            let down = 0;

            //We are only checking up, down, left and right
            //We are checking for linking chains of friendlies, filtering out those already checked
            let checkedChains = [];
            if (
                x < size - 1 &&
                board[x + 1][y] === "X" &&
                validLibMoves[x + 1][y] === libRequired
            ) {
                right = getChainValue(x + 1, y, "X");
                checkedChains.push(chains[x + 1][y]);
            }
            if (
                x > 0 &&
                board[x - 1][y] === "X" &&
                !checkedChains.includes(chains[x - 1][y]) &&
                validLibMoves[x - 1][y] === libRequired
            ) {
                left = getChainValue(x - 1, y, "X");
                checkedChains.push(chains[x - 1][y]);
            }
            if (
                y < size - 1 &&
                board[x][y + 1] === "X" &&
                !checkedChains.includes(chains[x][y + 1]) &&
                validLibMoves[x][y + 1] === libRequired
            ) {
                up = getChainValue(x, y + 1, "X");
                checkedChains.push(chains[x][y + 1]);
            }
            if (
                y > 0 &&
                board[x][y - 1] === "X" &&
                !checkedChains.includes(chains[x][y - 1]) &&
                validLibMoves[x][y - 1] === libRequired
            )
                down = getChainValue(x, y - 1, "X");

            let count = 0;
            let total = 0;
            if (right >= savedNodesMin) {
                count++;
                total += right;
            }
            if (left >= savedNodesMin) {
                count++;
                total += left;
            }
            if (up >= savedNodesMin) {
                count++;
                total += up;
            }
            if (down >= savedNodesMin) {
                count++;
                total += down;
            }
            if (count <= 0) continue;
            const surroundMulti = getSurroundLibSpread(x, y, "X");
            const rank = total * count * surroundMulti;
            if (rank > highValue) {
                moveOptions.length = 0;
                moveOptions.push([x, y]);
                highValue = rank;
            } else if (rank === highValue) moveOptions.push([x, y]);
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg:
                      "Bolster - Libs: " +
                      libRequired +
                      "  Nodes: " +
                      savedNodesMin +
                      "  OnlyContested: " +
                      onlyContested,
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {number} */
    function getChainValue(checkx, checky, player) {
        const size = board[0].length;
        const otherPlayer = player === "X" ? "O" : "X";
        const explored = new Set();
        if (
            contested[checkx][checky] === "?" ||
            board[checkx][checky] === otherPlayer
        )
            return 0;
        if (checkx < size - 1)
            explored.add(JSON.stringify([checkx + 1, checky]));
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
        if (checky < size - 1)
            explored.add(JSON.stringify([checkx, checky + 1]));
        let count = 1;
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore);
            if (
                contested[x][y] === "?" ||
                contested[x][y] === "#" ||
                board[x][y] === otherPlayer
            )
                continue;
            count++;
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
            if (x > 0) explored.add(JSON.stringify([x - 1, y]));
            if (y > 0) explored.add(JSON.stringify([x, y - 1]));
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
        }
        return count;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getEyeValue(checkx, checky, player) {
        const size = board[0].length;
        const otherPlayer = player === "X" ? "O" : "X";
        const explored = new Set();
        if (checkx < size - 1)
            explored.add(JSON.stringify([checkx + 1, checky]));
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
        if (checky < size - 1)
            explored.add(JSON.stringify([checkx, checky + 1]));
        let count = 0;
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore);
            if (
                contested[x][y] === "?" ||
                contested[x][y] === "#" ||
                board[x][y] === otherPlayer
            )
                continue;
            if (contested[x][y] === player) count++;
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
            if (x > 0) explored.add(JSON.stringify([x - 1, y]));
            if (y > 0) explored.add(JSON.stringify([x, y - 1]));
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
        }
        return count;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getFreeSpace(checkx, checky) {
        const size = board[0].length;
        if (contested[checkx][checky] !== "?") return 0;
        const explored = new Set();
        if (checkx < size - 1)
            explored.add(JSON.stringify([checkx + 1, checky]));
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
        if (checky < size - 1)
            explored.add(JSON.stringify([checkx, checky + 1]));
        let count = 1;
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore);
            if (["#", "X", "O"].includes(contested[x][y])) continue;
            if (contested[x][y] === "?") count++;
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
            if (x > 0) explored.add(JSON.stringify([x - 1, y]));
            if (y > 0) explored.add(JSON.stringify([x, y - 1]));
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
        }
        return count;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getEyeValueFull(checkx, checky, player) {
        const size = board[0].length;
        const otherPlayer = player === "X" ? "O" : "X";
        const explored = new Set();
        if (checkx < size - 1)
            explored.add(JSON.stringify([checkx + 1, checky]));
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
        if (checky < size - 1)
            explored.add(JSON.stringify([checkx, checky + 1]));
        if (checkx < size - 1 && checky < size - 1)
            explored.add(JSON.stringify([checkx + 1, checky + 1]));
        if (checkx > 0 && checky < size - 1)
            explored.add(JSON.stringify([checkx - 1, checky + 1]));
        if (checkx < size - 1 && checky > 0)
            explored.add(JSON.stringify([checkx + 1, checky - 1]));
        if (checkx > 0 && checky > 0)
            explored.add(JSON.stringify([checkx - 1, checky - 1]));
        let count = 0;
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore);
            if (
                contested[x][y] === "?" ||
                contested[x][y] === "#" ||
                board[x][y] === otherPlayer
            )
                continue;
            if (contested[x][y] === player) count++;
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
            if (x > 0) explored.add(JSON.stringify([x - 1, y]));
            if (y > 0) explored.add(JSON.stringify([x, y - 1]));
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
        }
        return count;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getChainAttack(x, y) {
        const size = board[0].length;
        let count = 0;
        if (x > 0 && board[x - 1][y] === "O")
            count += getChainValue(x - 1, y, "O");
        if (x < size - 1 && board[x + 1][y] === "O")
            count += getChainValue(x + 1, y, "O");
        if (y > 0 && board[x][y - 1] === "O")
            count += getChainValue(x, y - 1, "O");
        if (y < size - 1 && board[x][y + 1] === "O")
            count += getChainValue(x, y + 1, "O");

        return count;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getChainAttackFull(x, y) {
        const size = board[0].length;
        let count = 0;
        if (x < size - 1) count += getChainValue(x + 1, y, "O");
        if (x > 0) count += getChainValue(x - 1, y, "O");
        if (y > 0) count += getChainValue(x, y - 1, "O");
        if (y < size - 1) count += getChainValue(x, y + 1, "O");
        if (x < size - 1 && y < size - 1)
            count += getChainValue(x + 1, y + 1, "O");
        if (x > 0 && y < size - 1) count += getChainValue(x - 1, y + 1, "O");
        if (x < size - 1 && y > 0) count += getChainValue(x + 1, y - 1, "O");
        if (x > 0 && y > 0) count += getChainValue(x - 1, y - 1, "O");
        return count;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundSpace(x, y) {
        const size = board[0].length;
        let surround = 0;
        if (x > 0 && board[x - 1][y] === ".") surround++;
        if (x < size - 1 && board[x + 1][y] === ".") surround++;
        if (y > 0 && board[x][y - 1] === ".") surround++;
        if (y < size - 1 && board[x][y + 1] === ".") surround++;
        return surround;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundSpaceFull(startx, starty, player = "X", depth = 1) {
        const size = board[0].length;
        let surround = 0;
        for (let x = startx - depth; x <= startx + depth; x++)
            for (let y = starty - depth; y <= starty + depth; y++)
                if (
                    x >= 0 &&
                    x <= size - 1 &&
                    y >= 0 &&
                    y <= size - 1 &&
                    [".", player].includes(board[x][y])
                )
                    surround++;
        return surround;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getHeatMap(startx, starty, player = "X", depth = 2) {
        const size = board[0].length;
        let count = 1;
        for (let x = startx - depth; x <= startx + depth; x++)
            for (let y = starty - depth; y <= starty + depth; y++)
                if (
                    x >= 0 &&
                    x <= size - 1 &&
                    y >= 0 &&
                    y <= size - 1 &&
                    [".", player].includes(board[x][y])
                )
                    count +=
                        board[x][y] === player
                            ? 1.5
                            : board[x][y] === "."
                              ? 1
                              : 0;
        return count;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundLibs(x, y, player) {
        const size = board[0].length;
        let surround = 0;
        if (x > 0 && (board[x - 1][y] === "." || board[x - 1][y] === player))
            surround +=
                board[x - 1][y] === "." ? 1 : validLibMoves[x - 1][y] - 1;
        if (
            x < size - 1 &&
            (board[x + 1][y] === "." || board[x + 1][y] === player)
        )
            surround +=
                board[x + 1][y] === "." ? 1 : validLibMoves[x + 1][y] - 1;
        if (y > 0 && (board[x][y - 1] === "." || board[x][y - 1] === player))
            surround +=
                board[x][y - 1] === "." ? 1 : validLibMoves[x][y - 1] - 1;
        if (
            y < size - 1 &&
            (board[x][y + 1] === "." || board[x][y + 1] === player)
        )
            surround +=
                board[x][y + 1] === "." ? 1 : validLibMoves[x][y + 1] - 1;
        return surround;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundLibSpread(x, y, player) {
        const size = board[0].length;
        let surround = 0;
        const checks = new Set();
        if (board[x][y] === ".") checks.add(JSON.stringify([x, y]));
        else return 0;
        if (x > 0 && board[x - 1][y] === ".")
            checks.add(JSON.stringify([x - 1, y]));
        if (x < size - 1 && board[x + 1][y] === ".")
            checks.add(JSON.stringify([x + 1, y]));
        if (y > 0 && board[x][y - 1] === ".")
            checks.add(JSON.stringify([x, y - 1]));
        if (y < size - 1 && board[x][y + 1] === ".")
            checks.add(JSON.stringify([x, y + 1]));
        //Now, check the liberty values of all the checks
        for (const check of checks) {
            const [x, y] = JSON.parse(check);
            surround += getSurroundLibs(x, y, player);
        }
        return surround;
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundEnemiesFull(x, y) {
        const size = board[0].length;
        let surround = 0;
        if (x > 0 && board[x - 1][y] === "O")
            surround += getChainValue(x - 1, y, "O");
        if (x < size - 1 && board[x + 1][y] === "O")
            surround += getChainValue(x + 1, y, "O");
        if (y > 0 && board[x][y - 1] === "O")
            surround += getChainValue(x, y - 1, "O");
        if (y < size - 1 && board[x][y + 1] === "O")
            surround += getChainValue(x, y + 1, "O");

        if (x > 0 && y > 0 && board[x - 1][y - 1] === "O")
            surround += getChainValue(x - 1, y - 1, "O");
        if (x < size - 1 && y > 0 && board[x + 1][y - 1] === "O")
            surround += getChainValue(x + 1, y - 1, "O");
        if (y < size - 1 && x > 0 && board[x - 1][y + 1] === "O")
            surround += getChainValue(x - 1, y - 1, "O");
        if (y < size - 1 && x < size - 1 && board[x + 1][y + 1] === "O")
            surround += getChainValue(x + 1, y + 1, "O");

        return surround;
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomStrat() {
        const moveOptions = [];
        const moveOptions2 = [];
        const size = board[0].length;

        // Look through all the points on the board
        let bestRank = 0;
        const moves = getAllValidMoves(true);
        for (const [x, y] of moves) {
            if (!["?", "O"].includes(contested[x][y]) || createsLib(x, y, "X"))
                continue;
            let isSupport =
                (x > 0 &&
                    board[x - 1][y] === "X" &&
                    validLibMoves[x - 1][y] >= 1) ||
                (x < size - 1 &&
                    board[x + 1][y] === "X" &&
                    validLibMoves[x + 1][y] >= 1) ||
                (y > 0 &&
                    board[x][y - 1] === "X" &&
                    validLibMoves[x][y - 1] >= 1) ||
                (y < size - 1 &&
                    board[x][y + 1] === "X" &&
                    validLibMoves[x][y + 1] >= 1)
                    ? true
                    : false;
            let isAttack =
                (x > 0 &&
                    board[x - 1][y] === "O" &&
                    validLibMoves[x - 1][y] >= 2) ||
                (x < size - 1 &&
                    board[x + 1][y] === "O" &&
                    validLibMoves[x + 1][y] >= 2) ||
                (y > 0 &&
                    board[x][y - 1] === "O" &&
                    validLibMoves[x][y - 1] >= 2) ||
                (y < size - 1 &&
                    board[x][y + 1] === "O" &&
                    validLibMoves[x][y + 1] >= 2)
                    ? true
                    : false;

            const surround = getSurroundSpace(x, y);
            if (isSupport || isAttack) {
                if (surround > bestRank) {
                    moveOptions.length = 0;
                    bestRank = surround;
                    moveOptions.push([x, y]);
                } else if (surround === bestRank) {
                    moveOptions.push([x, y]);
                }
            } else {
                moveOptions2.push([x, y]);
            }
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        const randomIndex2 = Math.floor(Math.random() * moveOptions2.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg: "Random Safe",
              }
            : moveOptions2[randomIndex2]
              ? {
                    coords: moveOptions2[randomIndex2],
                    msg: "Random Unsafe",
                }
              : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getAggroAttack(
        libsMin,
        libsMax,
        minSurround = 3,
        minChain = 1,
        minFreeSpace = 0,
    ) {
        const moveOptions = [];
        const size = board[0].length;
        let highestValue = 0;
        // Look through all the points on the board
        const moves = getAllValidMoves(true);
        for (const [x, y] of moves) {
            if (createsLib(x, y, "X")) continue;
            const isAttack =
                (x > 0 &&
                    board[x - 1][y] === "O" &&
                    validLibMoves[x - 1][y] >= libsMin &&
                    validLibMoves[x - 1][y] <= libsMax) ||
                (x < size - 1 &&
                    board[x + 1][y] === "O" &&
                    validLibMoves[x + 1][y] >= libsMin &&
                    validLibMoves[x + 1][y] <= libsMax) ||
                (y > 0 &&
                    board[x][y - 1] === "O" &&
                    validLibMoves[x][y - 1] >= libsMin &&
                    validLibMoves[x][y - 1] <= libsMax) ||
                (y < size - 1 &&
                    board[x][y + 1] === "O" &&
                    validLibMoves[x][y + 1] >= libsMin &&
                    validLibMoves <= libsMax)
                    ? true
                    : false;
            const surround = getSurroundLibs(x, y, "X");
            const freeSpace = getFreeSpace(x, y);
            if (freeSpace < minFreeSpace) continue;
            if (!isAttack || surround < minSurround) continue;
            const chainAtk = getChainAttack(x, y);
            if (chainAtk < minChain) continue;
            let lowestLibs = 999;
            if (
                x > 0 &&
                board[x - 1][y] === "O" &&
                validLibMoves[x - 1][y] < lowestLibs
            )
                lowestLibs = validLibMoves[x - 1][y];
            if (
                x < size - 1 &&
                board[x + 1][y] === "O" &&
                validLibMoves[x + 1][y] < lowestLibs
            )
                lowestLibs = validLibMoves[x + 1][y];
            if (
                y > 0 &&
                board[x][y - 1] === "O" &&
                validLibMoves[x][y - 1] < lowestLibs
            )
                lowestLibs = validLibMoves[x][y - 1];
            if (
                y < size - 1 &&
                board[x][y + 1] === "O" &&
                validLibMoves[x][y + 1] < lowestLibs
            )
                lowestLibs = validLibMoves[x][y + 1];

            const enemyLibs = getSurroundLibSpread(x, y, "O");
            const startEyeValue = getEyeValue(x, y, "O");
            const eyeValue = startEyeValue > 1 ? startEyeValue : 1;
            const atk =
                (((enemyLibs * chainAtk) / eyeValue) * getHeatMap(x, y, "O")) /
                lowestLibs;
            if (atk > highestValue) {
                highestValue = atk;
                moveOptions.length = 0;
                moveOptions.push([x, y]);
            } else if (atk === highestValue) {
                highestValue = atk;
                moveOptions.push([x, y]);
            }
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg:
                      "Aggro Attack: " +
                      libsMin +
                      "/" +
                      libsMax +
                      "  Surround: " +
                      minSurround,
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getDefAttack(
        libsMin,
        libsMax,
        minSurround = 3,
        minChain = 1,
        minFreeSpace = 0,
    ) {
        const moveOptions = [];
        const size = board[0].length;
        let highestValue = 0;
        // Look through all the points on the board
        const moves = getAllValidMoves(true);
        for (const [x, y] of moves) {
            if (createsLib(x, y, "X")) continue;
            const isAttack =
                (x > 0 &&
                    board[x - 1][y] === "O" &&
                    validLibMoves[x - 1][y] >= libsMin &&
                    validLibMoves[x - 1][y] <= libsMax) ||
                (x < size - 1 &&
                    board[x + 1][y] === "O" &&
                    validLibMoves[x + 1][y] >= libsMin &&
                    validLibMoves[x + 1][y] <= libsMax) ||
                (y > 0 &&
                    board[x][y - 1] === "O" &&
                    validLibMoves[x][y - 1] >= libsMin &&
                    validLibMoves[x][y - 1] <= libsMax) ||
                (y < size - 1 &&
                    board[x][y + 1] === "O" &&
                    validLibMoves[x][y + 1] >= libsMin &&
                    validLibMoves <= libsMax)
                    ? true
                    : false;
            const surround = getSurroundLibs(x, y, "X");
            const freeSpace = getFreeSpace(x, y);
            if (freeSpace < minFreeSpace) continue;
            if (!isAttack || surround < minSurround) continue;
            const chainAtk = getChainAttack(x, y);
            if (chainAtk < minChain) continue;
            let lowestLibs = 999;
            if (
                x > 0 &&
                board[x - 1][y] === "O" &&
                validLibMoves[x - 1][y] < lowestLibs
            )
                lowestLibs = validLibMoves[x - 1][y];
            if (
                x < size - 1 &&
                board[x + 1][y] === "O" &&
                validLibMoves[x + 1][y] < lowestLibs
            )
                lowestLibs = validLibMoves[x + 1][y];
            if (
                y > 0 &&
                board[x][y - 1] === "O" &&
                validLibMoves[x][y - 1] < lowestLibs
            )
                lowestLibs = validLibMoves[x][y - 1];
            if (
                y < size - 1 &&
                board[x][y + 1] === "O" &&
                validLibMoves[x][y + 1] < lowestLibs
            )
                lowestLibs = validLibMoves[x][y + 1];

            const friendlyLibs = getSurroundLibs(x, y, "X");
            const startEyeValue = getEyeValue(x, y, "O");
            const eyeValue = startEyeValue > 1 ? startEyeValue : 1;

            const atk =
                ((((friendlyLibs * chainAtk) / eyeValue) *
                    getHeatMap(x, y, "X")) /
                    lowestLibs) *
                (getEyeValue(x, y, "X") + 1);

            if (atk > highestValue) {
                highestValue = atk;
                moveOptions.length = 0;
                moveOptions.push([x, y]);
            } else if (atk === highestValue) {
                highestValue = atk;
                moveOptions.push([x, y]);
            }
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg:
                      "Defensive Attack: " +
                      libsMin +
                      "/" +
                      libsMax +
                      "  Surround: " +
                      minSurround,
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function attackGrowDragon(requiredEyes, killLib = false) {
        const moveOptions = [];
        let highestValue = 0;
        // Look through all the points on the board
        const moves = getAllValidMoves(true);
        for (const [x, y] of moves) {
            if (contested[x][y] !== "?" || createsLib(x, y, "X")) continue;
            const surround = getSurroundEnemiesFull(x, y);
            const myLibs = getSurroundLibs(x, y, "X");
            if (surround < 1 || myLibs < 3) continue;
            const enemyLibs = getSurroundLibs(x, y, "O");
            if (enemyLibs === 1 && !killLib) continue;
            const enemyChains = getChainAttackFull(x, y);
            const myEyes = getEyeValueFull(x, y, "X");
            if (myEyes < requiredEyes) continue; // || count === 3) continue
            const result = enemyLibs * enemyChains; // surround * enemyLibs * myChains *  /*freeSpace * */ enemyEyes * enemyChains

            if (result > highestValue) {
                highestValue = result;
                moveOptions.length = 0;
                moveOptions.push([x, y]);
            } else if (result === highestValue) {
                highestValue = result;
                moveOptions.push([x, y]);
            }
        }
        // Choose one of the found moves at random
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[randomIndex]
            ? {
                  coords: moveOptions[randomIndex],
                  msg: "Attack/Grow Dragon: " + requiredEyes,
              }
            : [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getDefPattern() {
        let def = [];
        def.push(...def5);

        const moves = getAllValidMoves();
        for (const [x, y] of moves) {
            for (const pattern of def)
                if (isPattern(x, y, pattern)) {
                    const msg = ns.sprintf(
                        "Def Pattern: %s\n%s\n%s",
                        pattern.length,
                        pattern.join("\n"),
                        "---------------",
                    );
                    return {
                        coords: [x, y],
                        msg: msg,
                    };
                }
        }
        return [];
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function disruptEyes() {
        let disrupt = [];
        disrupt.push(...disrupt4);
        disrupt.push(...disrupt5);

        const moves = getAllValidMoves();
        for (const [x, y] of moves) {
            for (const pattern of disrupt)
                if (isPattern(x, y, pattern)) {
                    const msg = ns.sprintf(
                        "Eye Disruption: %s\n%s\n%s",
                        pattern.length,
                        pattern.join("\n"),
                        "---------------",
                    );
                    return {
                        coords: [x, y],
                        msg: msg,
                    };
                }
        }
        return [];
    }
    /** @param {NS} ns
     * @returns {Promise<false | {type:"move"|"pass"|"gameOver"; x:number; y:number;}} */
    async function movePiece(ns, attack) {
        if (attack.coords === undefined) return false;
        const [x, y] = attack.coords;
        if (x === undefined) return false;
        let mid = performance.now();
        ns.printf("%s", attack.msg);
        // Check the heuristic move with a few playouts on the game's own rules and AI; if one is lost, search instead
        if (searchOptions.verify && board.length <= searchOptions.maxSize) {
            try {
                const history = ns.go.getMoveHistory();
                const opponent = ns.go.getOpponent();
                searchStats.verified++;
                const safe = await evaluateMove(ns, board, history, opponent, { x, y }, searchOptions.verifyPlayouts);
                if (safe < 1) {
                    searchStats.searched++;
                    const best = await searchMove(ns, board, history, opponent, searchOptions.playouts);
                    if (best === null || best.x !== x || best.y !== y) {
                        searchStats.overridden++;
                        ns.printf("Search overrides %s,%s with %s", x, y, best ? `${best.x},${best.y}` : "pass");
                        const results = best ? await go_makeMove(ns, best.x, best.y) : await ns.go.passTurn();
                        START = performance.now();
                        return results;
                    }
                }
            } catch (err) {
                log(ns, `WARNING: Go move check failed, playing the heuristic move: ${getErrorInfo(err)}`);
            }
        }
        const results = await go_makeMove(ns, x, y);
        let END = performance.now();
        if (logtime)
            ns.printf(
                "Time: Me: %s  Them: %s",
                formatTime(ns, mid - START, true),
                formatTime(ns, END - mid, true),
            );
        START = performance.now();
        return results;
    }
    /** @param {NS} ns
     * @returns {Promise<false | {type:"move"|"pass"|"gameOver"; x:number; y:number;}} */
    // ─── Cheats other than playTwoMoves (compared per opponent with tools/go-sim) ───
    function goNeighbors(x, y) {
        const n = board.length;
        return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n);
    }
    function chainPoints(x, y) {
        const id = chains[x][y];
        const pts = [];
        for (let i = 0; i < board.length; i++) for (let j = 0; j < board.length; j++) if (chains[i][j] === id) pts.push([i, j]);
        return pts;
    }
    function chainLiberties(pts) {
        const libs = new Set();
        for (const [x, y] of pts) for (const [a, b] of goNeighbors(x, y)) if (board[a][b] === ".") libs.add(a * 100 + b);
        return [...libs].map((k) => [Math.floor(k / 100), k % 100]);
    }
    /** Empty point whose neighbours are all `color` stones or offline nodes. */
    function isTrueEye(x, y, color) {
        return board[x][y] === "." && goNeighbors(x, y).every(([a, b]) => board[a][b] === color || board[a][b] === "#");
    }
    /** rescue: our biggest group in atari (3+ stones) -> remove an adjacent enemy stone to give it a liberty. */
    function getRescueRemoval(minSize = 3) {
        let best = null;
        const seen = new Set();
        for (let x = 0; x < board.length; x++)
            for (let y = 0; y < board.length; y++) {
                if (board[x][y] !== "X" || seen.has(chains[x][y])) continue;
                seen.add(chains[x][y]);
                const pts = chainPoints(x, y);
                if (pts.length < minSize || chainLiberties(pts).length !== 1) continue;
                for (const [px, py] of pts)
                    for (const [a, b] of goNeighbors(px, py))
                        if (board[a][b] === "O" && (!best || pts.length > best.value))
                            best = { coords: [a, b], value: pts.length, msg: `Cheat: removing router ${a},${b} to save a group of ${pts.length}` };
            }
        return best;
    }
    /** destroyEye: enemy group (4+ stones) with exactly 2 liberties, one a true eye -> destroy the eye (atari). */
    function getEyeDestroy(minSize = 4) {
        let best = null;
        const seen = new Set();
        for (let x = 0; x < board.length; x++)
            for (let y = 0; y < board.length; y++) {
                if (board[x][y] !== "O" || seen.has(chains[x][y])) continue;
                seen.add(chains[x][y]);
                const pts = chainPoints(x, y);
                if (pts.length < minSize) continue;
                const libs = chainLiberties(pts);
                if (libs.length !== 2) continue;
                const eye = libs.find(([a, b]) => isTrueEye(a, b, "O"));
                if (eye && (!best || pts.length > best.value))
                    best = { coords: eye, value: pts.length, msg: `Cheat: destroying eye ${eye[0]},${eye[1]} of a group of ${pts.length}` };
            }
        return best;
    }
    /** repair: an offline node enclosed by our stones -> repair it into territory. */
    function getRepair() {
        for (let x = 0; x < board.length; x++)
            for (let y = 0; y < board.length; y++) {
                if (board[x][y] !== "#") continue;
                const nb = goNeighbors(x, y);
                if (nb.some(([a, b]) => board[a][b] === "X") && nb.every(([a, b]) => board[a][b] === "X" || board[a][b] === "#"))
                    return { coords: [x, y], msg: `Cheat: repairing offline node ${x},${y}` };
            }
        return null;
    }
    /** Run a single-point cheat if allowed. Each command string is constant (values go through ns.args). */
    async function runPointCheat(ns, kind, target) {
        if (!target || !cheats || cheatsThisGame >= maxCheatsPerGame) return false;
        const chance = await go_cheat_getCheatSuccessChance(ns);
        if (chance < cheatChanceThreshold) return false;
        cheatsThisGame++;
        try {
            const results = await getNsDataThroughFile(ns, TIMED_CHEAT, "/Temp/go-timed-cheat.txt", [kind, ...target.coords]);
            if (!results) {
                cheatsThisGame--; // no successful tick: nothing was attempted
                return false;
            }
            ns.printf("%s  Chance: %.2f%%  Result: %s", target.msg, chance * 100, results?.type);
            return results;
        } catch (err) {
            log(ns, `WARNING: ${kind} cheat failed: ${getErrorInfo(err)}`);
            return false;
        }
    }
    /** Try the configured cheats in order (--cheat-types). */
    async function moveCheat(ns) {
        for (const type of cheatTypes) {
            let results = false;
            if (type === "twoMoves") results = await moveSnakeEyes(ns, getSnakeEyes(cheatMinCapture));
            else if (type === "rescue") results = await runPointCheat(ns, "removeRouter", getRescueRemoval());
            else if (type === "destroyEye") results = await runPointCheat(ns, "destroyNode", getEyeDestroy());
            else if (type === "repair") results = await runPointCheat(ns, "repairOfflineNode", getRepair());
            if (results) return results;
        }
        return false;
    }

    async function moveSnakeEyes(ns, attack) {
        if (attack.coords === undefined || !cheats || cheatsThisGame >= maxCheatsPerGame) return false;
        const [s1x, s1y, s2x, s2y] = attack.coords;
        if (s1x === undefined) return false;
        const chance = await go_cheat_getCheatSuccessChance(ns);
        if (chance < cheatChanceThreshold) return false;
        cheatsThisGame++;
        try {
            let mid = performance.now();
            const results = await go_cheat_playTwoMoves(ns, s1x, s1y, s2x, s2y);
            if (!results) {
                cheatsThisGame--; // no successful tick: nothing was attempted
                return false;
            }
            ns.printf(
                "%s  Chance: %.2f%%  Result: %s",
                attack.msg,
                chance * 100,
                results.type,
            );
            let END = performance.now();
            if (logtime)
                ns.printf(
                    "Time: Me: %s  Them: %s",
                    formatTime(ns, mid - START, true),
                    formatTime(ns, END - mid, true),
                );
            START = performance.now();
            return results;
        } catch {
            return false;
        }
    }
    function getAllValidMoves(notMine = false) {
        if (currentValidMovesTurn === turn)
            return notMine ? currentValidContestedMoves : currentValidMoves;
        let moves = [];
        let contestedMoves = [];
        for (let x = 0; x < board[0].length; x++)
            for (let y = 0; y < board[0].length; y++) {
                if (validMove[x][y]) {
                    if (["O", "?"].includes(contested[x][y]))
                        contestedMoves.push([x, y]);
                    moves.push([x, y]);
                }
            }

        //Moves contains a randomized array of x,y
        moves = moves.sort(() => Math.random() - Math.random());
        contestedMoves = contestedMoves.sort(
            () => Math.random() - Math.random(),
        );
        currentValidMoves = moves;
        currentValidContestedMoves = contestedMoves;
        currentValidMovesTurn = turn;
        return notMine ? currentValidContestedMoves : currentValidMoves;
    }
    function createsLib(x, y, player) {
        const size = board[0].length;

        if (x > 0 && board[x - 1][y] === player && validLibMoves[x - 1][y] > 2)
            return false;
        if (
            x < size - 1 &&
            board[x + 1][y] === player &&
            validLibMoves[x + 1][y] > 2
        )
            return false;
        if (y > 0 && board[x][y - 1] === player && validLibMoves[x][y - 1] > 2)
            return false;
        if (
            y < size - 1 &&
            board[x][y + 1] === player &&
            validLibMoves[x][y + 1] > 2
        )
            return false;

        if (
            x > 0 &&
            board[x - 1][y] === player &&
            validLibMoves[x - 1][y] === 2
        )
            return true;
        if (
            x < size - 1 &&
            board[x + 1][y] === player &&
            validLibMoves[x + 1][y] === 2
        )
            return true;
        if (
            y > 0 &&
            board[x][y - 1] === player &&
            validLibMoves[x][y - 1] === 2
        )
            return true;
        if (
            y < size - 1 &&
            board[x][y + 1] === player &&
            validLibMoves[x][y + 1] === 2
        )
            return true;

        return false;
    }
    /** @returns {{coords: number[];msg: string;}} */
    function getOpeningMove() {
        const size = board[0].length;
        switch (size) {
            case 13:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2])
                    return {
                        coords: [2, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(2, 10) === 4 && validMove[2][10])
                    return {
                        coords: [2, 10],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(10, 10) === 4 && validMove[10][10])
                    return {
                        coords: [10, 10],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(10, 2) === 4 && validMove[10][2])
                    return {
                        coords: [10, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3])
                    return {
                        coords: [3, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 9) === 4 && validMove[3][9])
                    return {
                        coords: [3, 9],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(9, 9) === 4 && validMove[9][9])
                    return {
                        coords: [9, 9],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(9, 3) === 4 && validMove[9][3])
                    return {
                        coords: [9, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(4, 4) === 4 && validMove[4][4])
                    return {
                        coords: [4, 4],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(4, 8) === 4 && validMove[4][8])
                    return {
                        coords: [4, 8],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(8, 8) === 4 && validMove[8][8])
                    return {
                        coords: [8, 8],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(8, 4) === 4 && validMove[8][4])
                    return {
                        coords: [8, 4],
                        msg: "Opening Move: " + turn,
                    };
                else return getRandomStrat();
            case 9:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2])
                    return {
                        coords: [2, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(2, 6) === 4 && validMove[2][6])
                    return {
                        coords: [2, 6],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(6, 6) === 4 && validMove[6][6])
                    return {
                        coords: [6, 6],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(6, 2) === 4 && validMove[6][2])
                    return {
                        coords: [6, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3])
                    return {
                        coords: [3, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 5) === 4 && validMove[3][5])
                    return {
                        coords: [3, 5],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(5, 5) === 4 && validMove[5][5])
                    return {
                        coords: [5, 5],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(5, 3) === 4 && validMove[5][3])
                    return {
                        coords: [5, 3],
                        msg: "Opening Move: " + turn,
                    };
                else return getRandomStrat();
            case 7:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2])
                    return {
                        coords: [2, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(2, 4) === 4 && validMove[2][4])
                    return {
                        coords: [2, 4],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(4, 4) === 4 && validMove[4][4])
                    return {
                        coords: [4, 4],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(4, 2) === 4 && validMove[4][2])
                    return {
                        coords: [4, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3])
                    return {
                        coords: [3, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(1, 1) === 4 && validMove[1][1])
                    return {
                        coords: [1, 1],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(5, 1) === 4 && validMove[5][1])
                    return {
                        coords: [5, 1],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(5, 5) === 4 && validMove[5][5])
                    return {
                        coords: [5, 5],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(1, 5) === 4 && validMove[1][5])
                    return {
                        coords: [1, 5],
                        msg: "Opening Move: " + turn,
                    };
                else return getRandomStrat();
            case 5:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2])
                    return {
                        coords: [2, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3])
                    return {
                        coords: [3, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 1) === 4 && validMove[3][1])
                    return {
                        coords: [3, 1],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(1, 3) === 4 && validMove[1][3])
                    return {
                        coords: [1, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(1, 1) === 4 && validMove[1][1])
                    return {
                        coords: [1, 1],
                        msg: "Opening Move: " + turn,
                    };
                else return getRandomStrat();
            case 19:
                if (getSurroundSpace(9, 9) === 4 && validMove[9][9])
                    return {
                        coords: [9, 9],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(2, 2) === 4 && validMove[2][2])
                    return {
                        coords: [2, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(16, 2) === 4 && validMove[16][2])
                    return {
                        coords: [16, 2],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(2, 16) === 4 && validMove[2][16])
                    return {
                        coords: [2, 16],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(16, 16) === 4 && validMove[16][16])
                    return {
                        coords: [16, 16],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3])
                    return {
                        coords: [3, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(3, 15) === 4 && validMove[3][15])
                    return {
                        coords: [3, 15],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(15, 15) === 4 && validMove[15][15])
                    return {
                        coords: [15, 15],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(15, 3) === 4 && validMove[15][3])
                    return {
                        coords: [15, 3],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(4, 4) === 4 && validMove[4][4])
                    return {
                        coords: [4, 4],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(4, 14) === 4 && validMove[4][14])
                    return {
                        coords: [4, 14],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(14, 14) === 4 && validMove[14][14])
                    return {
                        coords: [14, 14],
                        msg: "Opening Move: " + turn,
                    };
                else if (getSurroundSpace(14, 4) === 4 && validMove[14][4])
                    return {
                        coords: [14, 4],
                        msg: "Opening Move: " + turn,
                    };
                else return getRandomStrat();
        }
    }
}
