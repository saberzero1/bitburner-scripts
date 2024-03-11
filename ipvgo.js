import {
    log, disableLogs, getFilePath, getConfiguration, formatNumberShort, formatRam,
    getNsDataThroughFile, waitForProcessToComplete, getActiveSourceFiles, instanceCount, unEscapeArrayArgs
} from './helpers.js'

// Default sripts called at startup and shutdown of ipvgo
const defaultStartupScript = getFilePath('daemon.js');
const defaultStartupArgs = ['--reserved-ram', 1E100];
const defaultCompletionScript = getFilePath('daemon.js');
const defaultCompletionArgs = [];

const argsSchema = [
    ['reserved-ram', 32], // Don't use this RAM
    ['reserved-ram-ideal', 64], // Leave this amount of RAM free if it represents less than 5% of available RAM
    //['max-charges', 120], // Stop charging when all fragments have this many charges (diminishing returns - num charges is ^0.07 )
    // By default, starting an augmentation with stanek.js will still spawn daemon.js, but will instruct it not to schedule any hack cycles against home by 'reserving' all its RAM
    // TODO: Set these defaults in some way that the user can explicitly specify that they want to run **no** startup script and **no** completion script
    ['on-startup-script', null], // (Defaults in code) Spawn this script when stanek is launched WARNING: This argument may go away in the future since autopilot.js will orchestrate stanek
    ['on-startup-script-args', []], // Args for the above (Defaults in code) WARNING: This argument may go away in the future since autopilot.js will orchestrate stanek 
    // When stanek completes, it will run daemon.js again (which will terminate the initial ram-starved daemon that is running)
    ['on-completion-script', null], // (Default in code) Spawn this script when max-charges is reached
    ['on-completion-script-args', []], // (Default in code) Optional args to pass to the script when launched
    ['no-tail', false], // By default, keeps a tail window open, because it's pretty important to know when this script is running (can't use home for anything else)
    ['reputation-threshold', 0.2], // By default, if we are this close to the rep needed for an unowned stanek upgrade (e.g. "Stanek's Gift - Serenity"), we will keep charging despite the 'max-charges' setting
];

const goOpponents = ["Netburners", "Slum Snakes", "The Black Hand", "Daedalus", "Illuminati", "w0r1d_d43m0n"];

// https://github.com/bitburner-official/bitburner-src/blob/4d5401f62e5c7a8080c6ddbbc74d0a2259759fdb/src/Go/effects/effect.ts#L112-L123
// Optimal strategy seems to be to get a 8 loss streak, then get a 8 win streak.

// https://github.com/bitburner-official/bitburner-src/tree/dev/src/Go/boardAnalysis
// First option: grab the game's board analysis and always grab the best move.
// Possibly check all moves and play the most optimal, if performance allows it.

// Check if there is a cap to winning bonus.
// If there is, stop playing after a max bonus.
// If there is not, keep playing.

// Determine what the optimal opponent is based on current bonuses.
// Possibly keep track of current winstreak per opponent.

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

let options, currentServer, sf4Level;

/** @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    disableLogs(ns, ['sleep', 'run', 'getServerMaxRam', 'getServerUsedRam'])

    let result;

    do {
        const board = ns.go.getBoardState();
        const validMoves = ns.go.analysis.getValidMoves();

        const [growX, growY] = getGrowMove(board, validMoves);
        const [randX, randY] = getRandomMove(board, validMoves);
        // Try to pick a grow move, otherwise choose a random move
        const x = growX ?? randX;
        const y = growY ?? randY;

        if (x === undefined) {
            // Pass turn if no moves are found
            result = await ns.go.passTurn();
        } else {
            // Play the selected move
            result = await ns.go.makeMove(x, y);
        }

        await ns.sleep(100);
    } while (result?.type !== "gameOver" && result?.type !== "pass");

    // After the opponent passes, end the game by passing as well
    await ns.go.passTurn();
}

/**
 * Choose one of the empty points on the board at random to play
 */
const getRandomMove = (board, validMoves) => {
    const moveOptions = [];
    const size = board[0].length;

    // Look through all the points on the board
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            // Make sure the point is a valid move
            const isValidMove = validMoves[x][y];
            // Leave some spaces to make it harder to capture our pieces
            const isNotReservedSpace = x % 2 || y % 2;

            if (isValidMove && isNotReservedSpace) {
                moveOptions.push([x, y]);
            }
        }
    }

    // Choose one of the found moves at random
    const randomIndex = Math.floor(Math.random() * moveOptions.length);
    return moveOptions[randomIndex] ?? [];
};

/**
 * Choose a point connected to a friendly stone to play
 */
const getGrowMove = (board, validMoves) => {
    const moveOptions = [];
    const size = board[0].length;

    // Look through all the points on the board
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            // make sure the move is valid
            const isValidMove = validMoves[x][y];
            // Leave some open spaces to make it harder to capture our pieces
            const isNotReservedSpace = x % 2 || y % 2;

            // Make sure we are connected to a friendly piece
            const neighbors = getNeighbors(board, x, y);
            const hasFriendlyNeighbor = neighbors.includes("X");

            if (isValidMove && isNotReservedSpace && hasFriendlyNeighbor) {
                moveOptions.push([x, y]);
            }
        }
    }

    // Choose one of the found moves at random
    const randomIndex = Math.floor(Math.random() * moveOptions.length);
    return moveOptions[randomIndex] ?? [];
};

/**
 * Find all adjacent points in the four connected directions
 */
const getNeighbors = (board, x, y) => {
    const north = board[x + 1]?.[y];
    const east = board[x][y + 1];
    const south = board[x - 1]?.[y];
    const west = board[x]?.[y - 1];

    return [north, east, south, west];
};
