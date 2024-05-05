import {
	log,
	disableLogs,
	getFilePath,
	getConfiguration,
	formatNumberShort,
	formatRam,
	getNsDataThroughFile,
	waitForProcessToComplete,
	getActiveSourceFiles,
	instanceCount,
	unEscapeArrayArgs,
} from "./helpers.js";

// Default sripts called at startup and shutdown of ipvgo
const defaultStartupScript = getFilePath("daemon.js");
const defaultStartupArgs = ["--reserved-ram", 1e100];
const defaultCompletionScript = getFilePath("daemon.js");
const defaultCompletionArgs = [];

const argsSchema = [
	["enable-cheats", true] // Enable cheats.
	["reserved-ram", 32], // Don't use this RAM
	["reserved-ram-ideal", 64], // Leave this amount of RAM free if it represents less than 5% of available RAM
	//['max-charges', 120], // Stop charging when all fragments have this many charges (diminishing returns - num charges is ^0.07 )
	// By default, starting an augmentation with stanek.js will still spawn daemon.js, but will instruct it not to schedule any hack cycles against home by 'reserving' all its RAM
	// TODO: Set these defaults in some way that the user can explicitly specify that they want to run **no** startup script and **no** completion script
	["on-startup-script", null], // (Defaults in code) Spawn this script when stanek is launched WARNING: This argument may go away in the future since autopilot.js will orchestrate stanek
	["on-startup-script-args", []], // Args for the above (Defaults in code) WARNING: This argument may go away in the future since autopilot.js will orchestrate stanek
	// When stanek completes, it will run daemon.js again (which will terminate the initial ram-starved daemon that is running)
	["on-completion-script", null], // (Default in code) Spawn this script when max-charges is reached
	["on-completion-script-args", []], // (Default in code) Optional args to pass to the script when launched
	["no-tail", false], // By default, keeps a tail window open, because it's pretty important to know when this script is running (can't use home for anything else)
	["reputation-threshold", 0.2], // By default, if we are this close to the rep needed for an unowned stanek upgrade (e.g. "Stanek's Gift - Serenity"), we will keep charging despite the 'max-charges' setting
];

const interval = 1000; // Update (tick) this often to check on game and make a move.
const goOpponents = [
	"Netburners",
	"Slum Snakes",
	"The Black Hand",
	"Daedalus",
	"Illuminati",
	"w0r1d_d43m0n",
];
let goWinStreak = [0, 0, 0, 0, 0, 0];

let goGameActive = false;

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

let CHEATS = false;
let STYLE = 0;
const REPEAT = true;
let currentValidMovesTurn = 0; //The turn count that the currentValidMoves is valid for
let currentValidMoves; //All valid moves for this turn
let turn = 0;
/** @param {NS} ns */
export async function main(ns) {
	const runOptions = getConfiguration(ns, argsSchema);
	if (!runOptions || (await instanceCount(ns)) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
	options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
	disableLogs(ns, ["sleep", "run", "getServerMaxRam", "getServerUsedRam"]);
	/*ns.write("goLog.txt","Starting log at "+Date.now()+"\n","w")
	  ns.tail()
	  ns.disableLog("ALL")*/
	const ownedSourceFiles = await getActiveSourceFiles(ns, false);
	CHEATS = (ownedSourceFiles[14] || 0) >= 2;
	if (CHEATS)
		ns.print("IPvGO Cheating Enabled!")
	else
		ns.print("IPvGO Cheating Disabled!")
	const startBoard = ns.go.getBoardState();
	let inProgress = false;
	turn = 0;
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
	getStyle(ns);

	while (true) {
		await ns.sleep(1);
		turn++;
		const board = ns.go.getBoardState();
		const contested = ns.go.analysis.getControlledEmptyNodes();
		const validMove = ns.go.analysis.getValidMoves();
		const validLibMoves = ns.go.analysis.getLiberties();
		const chains = ns.go.analysis.getChains();
		const size = board[0].length;
		//Build a test board with walls
		const testBoard = [];
		let testWall = "";
		let results;
		if (size === 13) testWall = "WWWWWWWWWWWWWWW";
		else if (size === 9) testWall = "WWWWWWWWWWW";
		else if (size === 7) testWall = "WWWWWWWWW";
		else if (size === 19) testWall = "WWWWWWWWWWWWWWWWWWWWW";
		else testWall = "WWWWWWW";
		testBoard.push(testWall);
		for (const b of board) testBoard.push("W" + b + "W");
		testBoard.push(testWall);
		//We have our test board

		if (turn < 3)
			// || (size === 19 && turn < 4))
			results = await movePiece(
				ns,
				getOpeningMove(ns, board, validMove, validLibMoves, contested),
				board,
				testBoard,
				validMove,
				validLibMoves,
				contested,
				chains
			);

		if (turn >= 3) {
			switch (STYLE) {
				case 0: // The Black Hand, Slum Snakes and Netburners
					if (
						(results =
							(await movePiece(
								ns,
								getRandomCounterLib(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									88
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibDefend(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									2,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								disruptEyes(ns, board, testBoard, validMove, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getDefPattern(
									ns,
									board,
									testBoard,
									validLibMoves,
									validMove,
									contested,
									5
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									3,
									3,
									1,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomBolster(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									chains,
									2,
									1
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									4,
									3,
									1,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									5,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									6,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									7,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								attackGrowDragon(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									1
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									8,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									9,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									10,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									11,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									12,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									13,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomBolster(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									chains,
									2,
									1,
									false
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomExpand(ns, board, validMove, validLibMoves, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomStrat(ns, board, validMove, validLibMoves, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					results = await ns.go.passTurn();
					break;
				case 1: //Mr. Mustacio - Slum Snakes
					results = await ns.go.passTurn();
					break;
				case 2: //Daedelus
					if (
						(results =
							(await movePiece(
								ns,
								getRandomCounterLib(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									88
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibDefend(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									2,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								disruptEyes(ns, board, testBoard, validMove, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getDefPattern(
									ns,
									board,
									testBoard,
									validLibMoves,
									validMove,
									contested,
									5
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									3,
									3,
									1,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									4,
									3,
									1,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomBolster(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									chains,
									2,
									1
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									5,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									6,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									7,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								attackGrowDragon(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									1
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									8,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									9,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									10,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									11,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									12,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									13,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomBolster(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									chains,
									2,
									1,
									false
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomExpand(ns, board, validMove, validLibMoves, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomStrat(ns, board, validMove, validLibMoves, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					results = await ns.go.passTurn();
					break;
				case 3:
					results = await ns.go.passTurn();
					break;
				case 4:
					results = await ns.go.passTurn();
					break;
				case 5: //Daedelus replaced case 5
					if (
						(results =
							(await movePiece(
								ns,
								getRandomCounterLib(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									88
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibDefend(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									2,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								disruptEyes(ns, board, testBoard, validMove, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getDefPattern(
									ns,
									board,
									testBoard,
									validLibMoves,
									validMove,
									contested,
									5
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									3,
									3,
									1,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									4,
									3,
									1,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomBolster(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									chains,
									2,
									1
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									5,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									6,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									7,
									3,
									2,
									6
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								attackGrowDragon(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									1
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									8,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									9,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									10,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									11,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									12,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									13,
									3,
									2
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomBolster(
									ns,
									board,
									validMove,
									validLibMoves,
									contested,
									chains,
									2,
									1,
									false
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomExpand(ns, board, validMove, validLibMoves, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomLibAttack(
									ns,
									board,
									validMove,
									validLibMoves,
									contested
								),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					if (
						(results =
							(await movePiece(
								ns,
								getRandomStrat(ns, board, validMove, validLibMoves, contested),
								board,
								testBoard,
								validMove,
								validLibMoves,
								contested,
								chains
							)) !== undefined)
					)
						break;
					results = await ns.go.passTurn();
					break;
			} //End of style switch
		} // end of turn >= 3

		if (results?.type === "gameOver") {
			if (!REPEAT) return;
			try {
				ns.go.resetBoardState(
					opponent2[Math.floor(Math.random() * opponent2.length)],
					13
				);
			} catch {
				ns.go.resetBoardState(
					opponent[Math.floor(Math.random() * opponent.length)],
					13
				);
			}
			inProgress = false;
			turn = 0;
			ns.clearLog();
			getStyle(ns);
		}
	}
}

/** @param {NS} ns */
function getStyle(ns) {
	const facing = ns.go.getOpponent();
	switch (facing) {
		case "The Black Hand":
		case "Netburners":
		case "Slum Snakes":
			STYLE = 0;
			break;
		case "Tetrads":
			STYLE = 5;
			break;
		case "Daedelus":
			STYLE = 2;
			break;
		case "Illuminati":
			STYLE = 5;
			break;
		default:
			STYLE = 5;
	}
}

/** @param {NS} ns */
function isPattern(ns, x, y, pattern, testBoard, validMove, contested, id) {
	//Move the pattern around with x/y loops, check if pattern matches IF a move is placed
	//We can assume that x and y are valid moves
	if (!validMove[x][y]) return false;

	const size = testBoard[0].length;
	let patterns;
	const patternSize = pattern.length;
	switch (patternSize) {
		case 3:
			patterns = getAll3by3Patterns(pattern);
			break;
		case 4:
			patterns = getAll4by4Patterns(pattern);
			break;
		case 5:
			patterns = getAll5by5Patterns(pattern);
			break;
		case 6:
			patterns = getAll6by6Patterns(pattern);
			break;
		case 7:
			patterns = getAll7by7Patterns(pattern);
			break;
	}

	for (const patternCheck of patterns) {
		//cx and cy - the spots of the pattern we are checking against the test board
		//For, say a 3x3 pattern, we do a grid of 0,0 -> 2, 2
		for (let cx = (patternSize - 1) * -1; cx <= 0; cx++) {
			// We've added a wall around everything, so 0 is a wall
			if (cx + x + 1 < 0 || cx + x + 1 > size - 1) continue;
			for (let cy = (patternSize - 1) * -1; cy <= 0 - 1; cy++) {
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
						if (y + cy + py + 1 < 0 || y + cy + py + 1 >= size) {
							//Are we off the map?
							abort = true;
							break;
						}
						if (
							cx + px === 0 &&
							cy + py === 0 &&
							!["X", "*"].includes(patternCheck[px][0][py])
						) {
							abort = true;
							break;
						}
						if (
							cx + px === 0 &&
							cy + py === 0 &&
							["X"].includes(contested[x][y]) &&
							patternCheck[px][0][py] !== "*"
						) {
							abort = true;
							break;
						}
						//We now have a cycles for each spot in the pattern
						//0,0 -> 2,2 for a 3x3
						switch (patternCheck[px][0][py]) {
							case "X":
								if (
									testBoard[cx + x + 1 + px][cy + y + 1 + py] === "X" ||
									(cx + px === 0 &&
										cy + py === 0 &&
										testBoard[cx + x + 1 + px][cy + y + 1 + py] === ".")
								) {
									count++;
								} else if (cx + px === 0 && cy + py === 0) {
									count++; // Our placement piece
								} else abort = true;
								break;
							case "*": // Special case.  We move here next or break the test
								if (
									testBoard[cx + x + 1 + px][cy + y + 1 + py] === "." &&
									cx + px === 0 &&
									cy + py === 0
								) {
									count++;
								} else abort = true;
								break;
							case "O":
								if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === "O")
									count++;
								else abort = true;
								break;
							case "x":
								if (
									["X", "."].includes(
										testBoard[cx + x + 1 + px][cy + y + 1 + py]
									)
								)
									count++;
								else abort = true;
								break;
							case "o":
								if (
									["O", "."].includes(
										testBoard[cx + x + 1 + px][cy + y + 1 + py]
									)
								)
									count++;
								else abort = true;
								break;
							case "?":
								count++;
								break;
							case ".":
								if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === ".")
									count++;
								else abort = true;
								break;
							case "W":
								if (
									["W", "#"].includes(
										testBoard[cx + x + 1 + px][cy + y + 1 + py]
									)
								)
									count++;
								else abort = true;
								break;
							case "B":
								if (
									["W", "#", "X"].includes(
										testBoard[cx + x + 1 + px][cy + y + 1 + py]
									)
								)
									count++;
								else abort = true;
								break;
							case "b":
								if (
									["W", "#", "O"].includes(
										testBoard[cx + x + 1 + px][cy + y + 1 + py]
									)
								)
									count++;
								else abort = true;
								break;
							case "A":
								if (
									["W", "#", "X", "O"].includes(
										testBoard[cx + x + 1 + px][cy + y + 1 + py]
									)
								)
									count++;
								else abort = true;
								break;
						}
						if (count === patternSize * patternSize) {
							ns.printf("Pattern: " + id);
							ns.printf("%s", pattern.join("\n"));
							ns.printf("-----------------");
							return true;
						}
					}
				}
			}
		}
	}
	return false;
}

/** @param {NS} ns */
function getAll3by3Patterns(pattern) {
	const rotations = [
		pattern,
		rotate90Degrees3(pattern),
		rotate90Degrees3(rotate90Degrees3(pattern)),
		rotate90Degrees3(rotate90Degrees3(rotate90Degrees3(pattern))),
	];
	const mirrored = [...rotations, ...rotations.map(verticalMirror3)];
	return [...mirrored, ...mirrored.map(horizontalMirror3)];
}
/** @param {NS} ns */
function getAll4by4Patterns(pattern) {
	const rotations = [
		pattern,
		rotate90Degrees4(pattern),
		rotate90Degrees4(rotate90Degrees4(pattern)),
		rotate90Degrees4(rotate90Degrees4(rotate90Degrees4(pattern))),
	];
	const mirrored = [...rotations, ...rotations.map(verticalMirror4)];
	return [...mirrored, ...mirrored.map(horizontalMirror4)];
}
/** @param {NS} ns */
function getAll5by5Patterns(pattern) {
	const rotations = [
		pattern,
		rotate90Degrees5(pattern),
		rotate90Degrees5(rotate90Degrees5(pattern)),
		rotate90Degrees5(rotate90Degrees5(rotate90Degrees5(pattern))),
	];
	const mirrored = [...rotations, ...rotations.map(verticalMirror5)];
	return [...mirrored, ...mirrored.map(horizontalMirror5)];
}
/** @param {NS} ns */
function getAll6by6Patterns(pattern) {
	const rotations = [
		pattern,
		rotate90Degrees6(pattern),
		rotate90Degrees6(rotate90Degrees6(pattern)),
		rotate90Degrees6(rotate90Degrees6(rotate90Degrees6(pattern))),
	];
	const mirrored = [...rotations, ...rotations.map(verticalMirror6)];
	return [...mirrored, ...mirrored.map(horizontalMirror6)];
}
/** @param {NS} ns */
function getAll7by7Patterns(pattern) {
	const rotations = [
		pattern,
		rotate90Degrees7(pattern),
		rotate90Degrees7(rotate90Degrees7(pattern)),
		rotate90Degrees7(rotate90Degrees7(rotate90Degrees7(pattern))),
	];
	const mirrored = [...rotations, ...rotations.map(verticalMirror7)];
	return [...mirrored, ...mirrored.map(horizontalMirror7)];
}
/** @param {NS} ns */
function rotate90Degrees3(pattern) {
	return [
		[`${pattern[2][0][0]}${pattern[1][0][0]}${pattern[0][0][0]}`],
		[`${pattern[2][0][1]}${pattern[1][0][1]}${pattern[0][0][1]}`],
		[`${pattern[2][0][2]}${pattern[1][0][2]}${pattern[0][0][2]}`],
	];
}
/** @param {NS} ns */
function rotate90Degrees4(pattern) {
	return [
		[
			`${pattern[3][0][0]}${pattern[2][0][0]}${pattern[1][0][0]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[3][0][1]}${pattern[2][0][1]}${pattern[1][0][1]}${pattern[0][0][1]}`,
		],
		[
			`${pattern[3][0][2]}${pattern[2][0][2]}${pattern[1][0][2]}${pattern[0][0][2]}`,
		],
		[
			`${pattern[3][0][3]}${pattern[2][0][3]}${pattern[1][0][3]}${pattern[0][0][3]}`,
		],
	];
}
/** @param {NS} ns */
function rotate90Degrees5(pattern) {
	return [
		[
			`${pattern[4][0][0]}${pattern[3][0][0]}${pattern[2][0][0]}${pattern[1][0][0]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[4][0][1]}${pattern[3][0][1]}${pattern[2][0][1]}${pattern[1][0][1]}${pattern[0][0][1]}`,
		],
		[
			`${pattern[4][0][2]}${pattern[3][0][2]}${pattern[2][0][2]}${pattern[1][0][2]}${pattern[0][0][2]}`,
		],
		[
			`${pattern[4][0][3]}${pattern[3][0][3]}${pattern[2][0][3]}${pattern[1][0][3]}${pattern[0][0][3]}`,
		],
		[
			`${pattern[4][0][4]}${pattern[3][0][4]}${pattern[2][0][4]}${pattern[1][0][4]}${pattern[0][0][4]}`,
		],
	];
}
/** @param {NS} ns */
function rotate90Degrees6(pattern) {
	return [
		[
			`${pattern[5][0][0]}${pattern[4][0][0]}${pattern[3][0][0]}${pattern[2][0][0]}${pattern[1][0][0]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[5][0][1]}${pattern[4][0][1]}${pattern[3][0][1]}${pattern[2][0][1]}${pattern[1][0][1]}${pattern[0][0][1]}`,
		],
		[
			`${pattern[5][0][2]}${pattern[4][0][2]}${pattern[3][0][2]}${pattern[2][0][2]}${pattern[1][0][2]}${pattern[0][0][2]}`,
		],
		[
			`${pattern[5][0][3]}${pattern[4][0][3]}${pattern[3][0][3]}${pattern[2][0][3]}${pattern[1][0][3]}${pattern[0][0][3]}`,
		],
		[
			`${pattern[5][0][4]}${pattern[4][0][4]}${pattern[3][0][4]}${pattern[2][0][4]}${pattern[1][0][4]}${pattern[0][0][4]}`,
		],
		[
			`${pattern[5][0][5]}${pattern[4][0][5]}${pattern[3][0][5]}${pattern[2][0][5]}${pattern[1][0][5]}${pattern[0][0][5]}`,
		],
	];
}
/** @param {NS} ns */
function rotate90Degrees7(pattern) {
	return [
		[
			`${pattern[6][0][0]}${pattern[5][0][0]}${pattern[4][0][0]}${pattern[3][0][0]}${pattern[2][0][0]}${pattern[1][0][0]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[6][0][1]}${pattern[5][0][1]}${pattern[4][0][1]}${pattern[3][0][1]}${pattern[2][0][1]}${pattern[1][0][1]}${pattern[0][0][1]}`,
		],
		[
			`${pattern[6][0][2]}${pattern[5][0][2]}${pattern[4][0][2]}${pattern[3][0][2]}${pattern[2][0][2]}${pattern[1][0][2]}${pattern[0][0][2]}`,
		],
		[
			`${pattern[6][0][3]}${pattern[5][0][3]}${pattern[4][0][3]}${pattern[3][0][3]}${pattern[2][0][3]}${pattern[1][0][3]}${pattern[0][0][3]}`,
		],
		[
			`${pattern[6][0][4]}${pattern[5][0][4]}${pattern[4][0][4]}${pattern[3][0][4]}${pattern[2][0][4]}${pattern[1][0][4]}${pattern[0][0][4]}`,
		],
		[
			`${pattern[6][0][5]}${pattern[5][0][5]}${pattern[4][0][5]}${pattern[3][0][5]}${pattern[2][0][5]}${pattern[1][0][5]}${pattern[0][0][5]}`,
		],
		[
			`${pattern[6][0][6]}${pattern[5][0][6]}${pattern[4][0][6]}${pattern[3][0][6]}${pattern[2][0][6]}${pattern[1][0][6]}${pattern[0][0][6]}`,
		],
	];
}
/** @param {NS} ns */
function verticalMirror3(pattern) {
	return [pattern[2], pattern[1], pattern[0]];
}
/** @param {NS} ns */
function verticalMirror4(pattern) {
	return [pattern[3], pattern[2], pattern[1], pattern[0]];
}
/** @param {NS} ns */
function verticalMirror5(pattern) {
	return [pattern[4], pattern[3], pattern[2], pattern[1], pattern[0]];
}
/** @param {NS} ns */
function verticalMirror6(pattern) {
	return [
		pattern[5],
		pattern[4],
		pattern[3],
		pattern[2],
		pattern[1],
		pattern[0],
	];
}
/** @param {NS} ns */
function verticalMirror7(pattern) {
	return [
		pattern[6],
		pattern[5],
		pattern[4],
		pattern[3],
		pattern[2],
		pattern[1],
		pattern[0],
	];
}

/** @param {NS} ns */
function horizontalMirror3(pattern) {
	return [
		[`${pattern[0][0][2]}${pattern[0][0][1]}${pattern[0][0][0]}`],
		[`${pattern[1][0][2]}${pattern[1][0][1]}${pattern[1][0][0]}`],
		[`${pattern[2][0][2]}${pattern[2][0][1]}${pattern[2][0][0]}`],
	];
}
/** @param {NS} ns */
function horizontalMirror4(pattern) {
	return [
		[
			`${pattern[0][0][3]}${pattern[0][0][2]}${pattern[0][0][1]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[1][0][3]}${pattern[1][0][2]}${pattern[1][0][1]}${pattern[1][0][0]}`,
		],
		[
			`${pattern[2][0][3]}${pattern[2][0][2]}${pattern[2][0][1]}${pattern[2][0][0]}`,
		],
		[
			`${pattern[3][0][3]}${pattern[3][0][2]}${pattern[3][0][1]}${pattern[3][0][0]}`,
		],
	];
}
/** @param {NS} ns */
function horizontalMirror5(pattern) {
	return [
		[
			`${pattern[0][0][4]}${pattern[0][0][3]}${pattern[0][0][2]}${pattern[0][0][1]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[1][0][4]}${pattern[1][0][3]}${pattern[1][0][2]}${pattern[1][0][1]}${pattern[1][0][0]}`,
		],
		[
			`${pattern[2][0][4]}${pattern[2][0][3]}${pattern[2][0][2]}${pattern[2][0][1]}${pattern[2][0][0]}`,
		],
		[
			`${pattern[3][0][4]}${pattern[3][0][3]}${pattern[3][0][2]}${pattern[3][0][1]}${pattern[3][0][0]}`,
		],
		[
			`${pattern[4][0][4]}${pattern[4][0][3]}${pattern[4][0][2]}${pattern[4][0][1]}${pattern[4][0][0]}`,
		],
	];
}
/** @param {NS} ns */
function horizontalMirror6(pattern) {
	return [
		[
			`${pattern[0][0][5]}${pattern[0][0][4]}${pattern[0][0][3]}${pattern[0][0][2]}${pattern[0][0][1]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[1][0][5]}${pattern[1][0][4]}${pattern[1][0][3]}${pattern[1][0][2]}${pattern[1][0][1]}${pattern[1][0][0]}`,
		],
		[
			`${pattern[2][0][5]}${pattern[2][0][4]}${pattern[2][0][3]}${pattern[2][0][2]}${pattern[2][0][1]}${pattern[2][0][0]}`,
		],
		[
			`${pattern[3][0][5]}${pattern[3][0][4]}${pattern[3][0][3]}${pattern[3][0][2]}${pattern[3][0][1]}${pattern[3][0][0]}`,
		],
		[
			`${pattern[4][0][5]}${pattern[4][0][4]}${pattern[4][0][3]}${pattern[4][0][2]}${pattern[4][0][1]}${pattern[4][0][0]}`,
		],
		[
			`${pattern[5][0][5]}${pattern[5][0][4]}${pattern[5][0][3]}${pattern[5][0][2]}${pattern[5][0][1]}${pattern[5][0][0]}`,
		],
	];
}
/** @param {NS} ns */
function horizontalMirror7(pattern) {
	return [
		[
			`${pattern[0][0][6]}${pattern[0][0][5]}${pattern[0][0][4]}${pattern[0][0][3]}${pattern[0][0][2]}${pattern[0][0][1]}${pattern[0][0][0]}`,
		],
		[
			`${pattern[1][0][6]}${pattern[1][0][5]}${pattern[1][0][4]}${pattern[1][0][3]}${pattern[1][0][2]}${pattern[1][0][1]}${pattern[1][0][0]}`,
		],
		[
			`${pattern[2][0][6]}${pattern[2][0][5]}${pattern[2][0][4]}${pattern[2][0][3]}${pattern[2][0][2]}${pattern[2][0][1]}${pattern[2][0][0]}`,
		],
		[
			`${pattern[3][0][6]}${pattern[3][0][5]}${pattern[3][0][4]}${pattern[3][0][3]}${pattern[3][0][2]}${pattern[3][0][1]}${pattern[3][0][0]}`,
		],
		[
			`${pattern[4][0][6]}${pattern[4][0][5]}${pattern[4][0][4]}${pattern[4][0][3]}${pattern[4][0][2]}${pattern[4][0][1]}${pattern[4][0][0]}`,
		],
		[
			`${pattern[4][0][6]}${pattern[5][0][5]}${pattern[5][0][4]}${pattern[5][0][3]}${pattern[5][0][2]}${pattern[5][0][1]}${pattern[5][0][0]}`,
		],
		[
			`${pattern[4][0][6]}${pattern[6][0][5]}${pattern[6][0][4]}${pattern[6][0][3]}${pattern[6][0][2]}${pattern[6][0][1]}${pattern[6][0][0]}`,
		],
	];
}

/** @param {NS} ns */
function getRandomLibAttack(
	ns,
	board,
	validMoves,
	validLibMoves,
	contested,
	minKilled = 1
) {
	const moveOptions = [];
	const size = board[0].length;
	let highValue = 1;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		if (contested[x][y] === "X" || validLibMoves[x][y] !== -1) continue;

		let count = 0;
		let chains = 0;

		//We are only checking up, down, left and right
		if (x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] === 1) {
			count++;
			chains += getChainValue(x - 1, y, board, contested, "O");
		}
		if (
			x < size - 1 &&
			board[x + 1][y] === "O" &&
			validLibMoves[x + 1][y] === 1
		) {
			count++;
			chains += getChainValue(x + 1, y, board, contested, "O");
		}
		if (y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] === 1) {
			count++;
			chains += getChainValue(x, y - 1, board, contested, "O");
		}
		if (
			y < size - 1 &&
			board[x][y + 1] === "O" &&
			validLibMoves[x][y + 1] === 1
		) {
			count++;
			chains += getChainValue(x, y + 1, board, contested, "O");
		}
		const enemyLibs = getSurroundLibs(x, y, board, validLibMoves, "O");
		if (count === 0 || (chains < minKilled && enemyLibs <= 1)) continue;
		//const space = enemyLibs <= 2 ? 1 : enemyLibs - 1
		const result = count * chains; // * space
		if (result > highValue) {
			moveOptions.length = 0;
			moveOptions.push([x, y]);
			highValue = result;
		} else if (result === highValue) moveOptions.push([x, y]);
	}
	// Choose one of the found moves at random
	const randomIndex = Math.floor(Math.random() * moveOptions.length);
	if (moveOptions[randomIndex]) ns.print("Lib Attack");
	return moveOptions[randomIndex] ?? [];
}
/** @param {NS} ns */
function getRandomLibDefend(
	ns,
	board,
	validMoves,
	validLibMoves,
	contested,
	savedMin = 1
) {
	const moveOptions = [];
	const size = board[0].length;
	let highValue = 0;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		const surround = getSurroundLibs(x, y, board, validLibMoves, "X");
		const myEyes = getEyeValue(x, y, board, contested, "X");
		if (surround + myEyes < 2) continue; //Abort.  Let it go, let it go...

		if (validLibMoves[x][y] === -1) {
			let count = 0;
			//We are only checking up, down, left and right
			if (x > 0 && validLibMoves[x - 1][y] === 1 && board[x - 1][y] === "X")
				count += getChainValue(x - 1, y, board, contested, "X");
			if (
				x < size - 1 &&
				validLibMoves[x + 1][y] === 1 &&
				board[x + 1][y] === "X"
			)
				count += getChainValue(x + 1, y, board, contested, "X");
			if (y > 0 && validLibMoves[x][y - 1] === 1 && board[x][y - 1] === "X")
				count += getChainValue(x, y - 1, board, contested, "X");
			if (
				y < size - 1 &&
				validLibMoves[x][y + 1] === 1 &&
				board[x][y + 1] === "X"
			)
				count += getChainValue(x, y + 1, board, contested, "X");
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
	if (moveOptions[randomIndex]) ns.print("Lib Defend");
	return moveOptions[randomIndex] ?? [];
}
/** @param {NS} ns */
function getRandomCounterLib(ns, board, validMoves, validLibMoves) {
	//Advanced strategy
	//If we have a chain that's going to die, and a hanging lib attached to it
	//Find that hanging lib and kill it to save the chain
	const size = board[0].length;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	const movesAvailable = new Set(); //Contains the empty squares that we are looking to see if we should take
	const friendlyToCheckForOpp = new Set();
	for (const [x, y] of moves) {
		//We are checking up, down, left and right first
		if (x > 0 && validLibMoves[x - 1][y] === 1 && board[x - 1][y] === "X") {
			movesAvailable.add(JSON.stringify([x, y]));
			friendlyToCheckForOpp.add(JSON.stringify([x - 1, y]));
			break;
		}
		if (
			x < size - 1 &&
			validLibMoves[x + 1][y] === 1 &&
			board[x + 1][y] === "X"
		) {
			movesAvailable.add(JSON.stringify([x, y]));
			friendlyToCheckForOpp.add(JSON.stringify([x + 1, y]));
			break;
		}
		if (y > 0 && validLibMoves[x][y - 1] === 1 && board[x][y - 1] === "X") {
			movesAvailable.add(JSON.stringify([x, y]));
			friendlyToCheckForOpp.add(JSON.stringify([x, y - 1]));
			break;
		}
		if (
			y < size - 1 &&
			validLibMoves[x][y + 1] === 1 &&
			board[x][y + 1] === "X"
		) {
			movesAvailable.add(JSON.stringify([x, y]));
			friendlyToCheckForOpp.add(JSON.stringify([x, y + 1]));
			break;
		}
	}
	//Shortcut.  While there's 1, is it THE one?
	//We know that 1 side of this is a friendly with 1 lib at risk.  Is another side the enemy?
	//This will likely be picked up by Lib Defend
	for (const explore of movesAvailable) {
		const [fx, fy] = JSON.parse(explore);
		if (!validMoves[fx][fy]) continue;
		if (
			fx < size - 1 &&
			board[fx + 1][fy] === "O" &&
			validLibMoves[fx + 1][fy] === 1
		) {
			ns.print("Counter Lib Attack - Fist of the east");
			return [fx, fy];
		}
		if (
			fx > 0 &&
			board[fx - 1][fy] === "O" &&
			validLibMoves[fx - 1][fy] === 1
		) {
			ns.print("Counter Lib Attack - Fist of the west");
			return [fx, fy];
		}
		if (
			fy > 0 &&
			board[fx][fy - 1] === "O" &&
			validLibMoves[fx][fy - 1] === 1
		) {
			ns.print("Counter Lib Attack - Fist of the south");
			return [fx, fy];
		}
		if (
			fy < size - 1 &&
			board[fx][fy + 1] === "O" &&
			validLibMoves[fx][fy + 1] === 1
		) {
			ns.print("Counter Lib Attack - Fist of the north");
			return [fx, fy];
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
		if (fx > 0 && board[fx - 1][fy] === "O" && validLibMoves[fx - 1][fy] === 1)
			enemiesToSearch.add(JSON.stringify([fx - 1, fy]));
		if (fy > 0 && board[fx][fy - 1] === "O" && validLibMoves[fx][fy - 1] === 1)
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

		if (fx < size - 1 && board[fx + 1][fy] === "." && validMoves[fx + 1][fy]) {
			ns.print("Counter Lib Attack - The wind blows");
			return [fx + 1, fy];
		}
		if (fx > 0 && board[fx - 1][fy] === "." && validMoves[fx - 1][fy]) {
			ns.print("Counter Lib Attack - The earth grows");
			return [fx - 1, fy];
		}
		if (fy > 0 && board[fx][fy - 1] === "." && validMoves[fx][fy - 1]) {
			ns.print("Counter Lib Attack - The fire burns");
			return [fx, fy - 1];
		}
		if (fy < size - 1 && board[fx][fy + 1] === "." && validMoves[fx][fy + 1]) {
			ns.print("Counter Lib Attack - The water flows");
			return [fx, fy + 1];
		}
	}
	return [];
}
/** @param {NS} ns */
function getRandomExpand(ns, board, validMoves, validLibMoves, contested) {
	const moveOptions = [];
	const size = board[0].length;
	let highValue = 0;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		const surroundLibs = getSurroundLibs(x, y, board, validLibMoves, "X");
		const enemySurroundLibs = getSurroundLibs(x, y, board, validLibMoves, "O");
		if (
			contested[x][y] !== "?" ||
			surroundLibs <= 2 ||
			createsLib(x, y, board, validLibMoves, "X") ||
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

		const surroundSpace = getSurroundSpaceFull(x, y, board) + 1;
		const enemySurroundChains = getChainAttack(x, y, board, contested) + 1;
		const myEyes = getEyeValueFull(x, y, board, contested, "X") + 1;
		const enemies = getSurroundEnemiesFull(x, y, board, contested) + 1;
		const freeSpace = getFreeSpace(x, y, board, contested);
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
	if (moveOptions[randomIndex]) ns.print("Expansion");
	return moveOptions[randomIndex] ?? [];
}
/** @param {NS} ns */
function getRandomBolster(
	ns,
	board,
	validMoves,
	validLibMoves,
	contested,
	chains,
	libRequired,
	savedNodesMin,
	onlyContested = true
) {
	const moveOptions = [];
	const size = board[0].length;
	let highValue = 1;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		if (
			(onlyContested && contested[x][y] !== "?") ||
			createsLib(x, y, board, validLibMoves, "X")
		)
			continue;
		const surround = getSurroundLibs(x, y, board, validLibMoves, "X");
		if (surround <= 2) continue;
		let right = 0;
		let left = 0;
		let up = 0;
		let down = 0;

		//We are only checking up, down, left and right
		//We are checking for linking chains of friendlies, filtering out those already checked
		let checkedChains = [];
		if (
			x + 1 < size - 1 &&
			board[x + 1][y] === "X" &&
			validLibMoves[x + 1][y] === libRequired
		) {
			right = getChainValue(x + 1, y, board, contested, "X");
			checkedChains.push(chains[x + 1][y]);
		}
		if (
			x - 1 >= 0 &&
			board[x - 1][y] === "X" &&
			!checkedChains.includes(chains[x - 1][y]) &&
			validLibMoves[x - 1][y] === libRequired
		) {
			left = getChainValue(x - 1, y, board, contested, "X");
			checkedChains.push(chains[x - 1][y]);
		}
		if (
			y + 1 < size - 1 &&
			board[x][y + 1] === "X" &&
			!checkedChains.includes(chains[x][y + 1]) &&
			validLibMoves[x][y + 1] === libRequired
		) {
			up = getChainValue(x, y + 1, board, contested, "X");
			checkedChains.push(chains[x][y + 1]);
		}
		if (
			y - 1 >= 0 &&
			board[x][y - 1] === "X" &&
			!checkedChains.includes(chains[x][y - 1]) &&
			validLibMoves[x][y - 1] === libRequired
		)
			down = getChainValue(x, y - 1, board, contested, "X");

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
		const surroundMulti = getSurroundLibSpread(x, y, board, validLibMoves, "X");
		const rank = total * count * surroundMulti; // * surroundChains
		if (rank > highValue) {
			moveOptions.length = 0;
			moveOptions.push([x, y]);
			highValue = rank;
		} else if (rank === highValue) moveOptions.push([x, y]);
	}
	// Choose one of the found moves at random
	const randomIndex = Math.floor(Math.random() * moveOptions.length);
	if (moveOptions[randomIndex])
		ns.print(
			"Bolster - Libs: " +
			libRequired +
			"  Nodes: " +
			savedNodesMin +
			"  OnlyContested: " +
			onlyContested
		);
	return moveOptions[randomIndex] ?? [];
}

/** @param {NS} ns */
function getChainValue(checkx, checky, board, contested, player) {
	const size = board[0].length;
	const otherPlayer = player === "X" ? "O" : "X";
	const explored = new Set();
	if (
		contested[checkx][checky] === "?" ||
		board[checkx][checky] === otherPlayer
	)
		return 0;
	if (checkx + 1 < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
	if (checkx - 1 >= 0) explored.add(JSON.stringify([checkx - 1, checky]));
	if (checky - 1 >= 0) explored.add(JSON.stringify([checkx, checky - 1]));
	if (checky + 1 < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
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
		if (x + 1 < size - 1) explored.add(JSON.stringify([x + 1, y]));
		if (x - 1 >= 0) explored.add(JSON.stringify([x - 1, y]));
		if (y - 1 >= 0) explored.add(JSON.stringify([x, y - 1]));
		if (y + 1 < size - 1) explored.add(JSON.stringify([x, y + 1]));
	}
	return count;
}

/** @param {NS} ns */
function getEyeValue(checkx, checky, board, contested, player) {
	const size = board[0].length;
	const otherPlayer = player === "X" ? "O" : "X";
	const explored = new Set();
	if (checkx + 1 < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
	if (checkx - 1 >= 0) explored.add(JSON.stringify([checkx - 1, checky]));
	if (checky - 1 >= 0) explored.add(JSON.stringify([checkx, checky - 1]));
	if (checky + 1 < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
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
		if (x + 1 < size - 1) explored.add(JSON.stringify([x + 1, y]));
		if (x - 1 >= 0) explored.add(JSON.stringify([x - 1, y]));
		if (y - 1 >= 0) explored.add(JSON.stringify([x, y - 1]));
		if (y + 1 < size - 1) explored.add(JSON.stringify([x, y + 1]));
	}
	return count;
}

/** @param {NS} ns */
function getFreeSpace(checkx, checky, board, contested) {
	const size = board[0].length;
	if (contested[checkx][checky] !== "?") return 0;
	const explored = new Set();
	if (checkx + 1 < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
	if (checkx - 1 >= 0) explored.add(JSON.stringify([checkx - 1, checky]));
	if (checky - 1 >= 0) explored.add(JSON.stringify([checkx, checky - 1]));
	if (checky + 1 < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
	let count = 1;
	for (const explore of explored) {
		const [x, y] = JSON.parse(explore);
		if (["#", "X", "O"].includes(contested[x][y])) continue;
		if (contested[x][y] === "?") count++;
		if (x + 1 < size - 1) explored.add(JSON.stringify([x + 1, y]));
		if (x - 1 >= 0) explored.add(JSON.stringify([x - 1, y]));
		if (y - 1 >= 0) explored.add(JSON.stringify([x, y - 1]));
		if (y + 1 < size - 1) explored.add(JSON.stringify([x, y + 1]));
	}
	return count;
}
/** @param {NS} ns */
function getEyeValueFull(checkx, checky, board, contested, player) {
	const size = board[0].length;
	const otherPlayer = player === "X" ? "O" : "X";
	const explored = new Set();
	if (checkx + 1 < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
	if (checkx - 1 >= 0) explored.add(JSON.stringify([checkx - 1, checky]));
	if (checky - 1 >= 0) explored.add(JSON.stringify([checkx, checky - 1]));
	if (checky + 1 < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
	if (checkx + 1 < size - 1 && checky + 1 < size - 1)
		explored.add(JSON.stringify([checkx + 1, checky + 1]));
	if (checkx - 1 >= 0 && checky + 1 < size - 1)
		explored.add(JSON.stringify([checkx - 1, checky + 1]));
	if (checkx + 1 < size - 1 && checky - 1 > 0)
		explored.add(JSON.stringify([checkx + 1, checky - 1]));
	if (checkx - 1 >= 0 && checky - 1 >= 0)
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
		if (x + 1 < size - 1) explored.add(JSON.stringify([x + 1, y]));
		if (x - 1 >= 0) explored.add(JSON.stringify([x - 1, y]));
		if (y - 1 >= 0) explored.add(JSON.stringify([x, y - 1]));
		if (y + 1 < size - 1) explored.add(JSON.stringify([x, y + 1]));
	}
	return count;
}
/** @param {NS} ns */
function getChainAttack(x, y, board, contested) {
	const size = board[0].length;
	let count = 0;
	if (x > 0 && board[x - 1][y] === "O")
		count += getChainValue(x - 1, y, board, contested, "O");
	if (x < size - 1 && board[x + 1][y] === "O")
		count += getChainValue(x + 1, y, board, contested, "O");
	if (y > 0 && board[x][y - 1] === "O")
		count += getChainValue(x, y - 1, board, contested, "O");
	if (y < size - 1 && board[x][y + 1] === "O")
		count += getChainValue(x, y + 1, board, contested, "O");

	return count;
}
/** @param {NS} ns */
function getChainAttackFull(x, y, board, contested) {
	const size = board[0].length;
	let count = 0;
	if (x + 1 < size - 1) count += getChainValue(x + 1, y, board, contested, "O");
	if (x - 1 >= 0) count += getChainValue(x - 1, y, board, contested, "O");
	if (y - 1 >= 0) count += getChainValue(x, y - 1, board, contested, "O");
	if (y + 1 < size - 1) count += getChainValue(x, y + 1, board, contested, "O");
	if (x + 1 < size - 1 && y + 1 < size - 1)
		count += getChainValue(x + 1, y + 1, board, contested, "O");
	if (x - 1 >= 0 && y + 1 < size - 1)
		count += getChainValue(x - 1, y + 1, board, contested, "O");
	if (x + 1 < size - 1 && y - 1 > 0)
		count += getChainValue(x + 1, y - 1, board, contested, "O");
	if (x - 1 >= 0 && y - 1 >= 0)
		count += getChainValue(x - 1, y - 1, board, contested, "O");
	return count;
}
/** @param {NS} ns */
function getChainSupport(x, y, board, contested) {
	const size = board[0].length;
	let count = 0;
	if (x > 0 && board[x - 1][y] === "X")
		count += getChainValue(x - 1, y, board, contested, "X");
	if (x < size - 1 && board[x + 1][y] === "X")
		count += getChainValue(x + 1, y, board, contested, "X");
	if (y > 0 && board[x][y - 1] === "X")
		count += getChainValue(x, y - 1, board, contested, "X");
	if (y < size - 1 && board[x][y + 1] === "X")
		count += getChainValue(x, y + 1, board, contested, "X");
	return count;
}
/** @param {NS} ns */
function getSurroundSpace(x, y, board) {
	const size = board[0].length;
	let surround = 0;
	if (x - 1 > 0 && board[x - 1][y] === ".") surround++;
	if (x + 1 < size - 1 && board[x + 1][y] === ".") surround++;
	if (y - 1 > 0 && board[x][y - 1] === ".") surround++;
	if (y + 1 < size - 1 && board[x][y + 1] === ".") surround++;
	return surround;
}

/** @param {NS} ns */
function getSurroundSpaceFull(startx, starty, board, player = "X", depth = 1) {
	const size = board[0].length;
	let surround = 0;
	for (let x = startx - depth; x <= startx + depth; x++)
		for (let y = starty - depth; y <= starty + depth; y++)
			if (
				x > 0 &&
				x < size - 1 &&
				y > 0 &&
				y < size - 1 &&
				[".", player].includes(board[x][y])
			)
				surround++;
	return surround;
}

/** @param {NS} ns */
function getHeatMap(startx, starty, board, player = "X", depth = 2) {
	const size = board[0].length;
	let count = 1;
	for (let x = startx - depth; x <= startx + depth; x++)
		for (let y = starty - depth; y <= starty + depth; y++)
			if (
				x > 0 &&
				x < size - 1 &&
				y > 0 &&
				y < size - 1 &&
				[".", player].includes(board[x][y])
			)
				count += board[x][y] === player ? 1.5 : board[x][y] === "." ? 1 : 0;
	return count;
}

/** @param {NS} ns */
function getSurroundLibs(x, y, board, validLibMoves, player) {
	const size = board[0].length;
	let surround = 0;
	if (x > 0 && (board[x - 1][y] === "." || board[x - 1][y] === player))
		surround += board[x - 1][y] === "." ? 1 : validLibMoves[x - 1][y] - 1;
	if (x < size - 1 && (board[x + 1][y] === "." || board[x + 1][y] === player))
		surround += board[x + 1][y] === "." ? 1 : validLibMoves[x + 1][y] - 1;
	if (y > 0 && (board[x][y - 1] === "." || board[x][y - 1] === player))
		surround += board[x][y - 1] === "." ? 1 : validLibMoves[x][y - 1] - 1;
	if (y < size - 1 && (board[x][y + 1] === "." || board[x][y + 1] === player))
		surround += board[x][y + 1] === "." ? 1 : validLibMoves[x][y + 1] - 1;
	return surround;
}

/** @param {NS} ns */
function getSurroundLibSpread(x, y, board, validLibMoves, player) {
	const size = board[0].length;
	let surround = 0;
	const checks = new Set();
	if (board[x][y] === ".") checks.add(JSON.stringify([x, y]));
	else return 0;
	if (x > 0 && board[x - 1][y] === ".") checks.add(JSON.stringify([x - 1, y]));
	if (x < size - 1 && board[x + 1][y] === ".")
		checks.add(JSON.stringify([x + 1, y]));
	if (y > 0 && board[x][y - 1] === ".") checks.add(JSON.stringify([x, y - 1]));
	if (y < size - 1 && board[x][y + 1] === ".")
		checks.add(JSON.stringify([x, y + 1]));
	//Now, check the liberty values of all the checks
	for (const check of checks) {
		const [x, y] = JSON.parse(check);
		surround += getSurroundLibs(x, y, board, validLibMoves, player);
	}
	return surround;
}

/** @param {NS} ns */
function getSurroundEnemiesFull(x, y, board, contested) {
	const size = board[0].length;
	let surround = 0;
	if (x > 0 && board[x - 1][y] === "O")
		surround += getChainValue(x - 1, y, board, contested, "O");
	if (x < size - 1 && board[x + 1][y] === "O")
		surround += getChainValue(x + 1, y, board, contested, "O");
	if (y > 0 && board[x][y - 1] === "O")
		surround += getChainValue(x, y - 1, board, contested, "O");
	if (y < size - 1 && board[x][y + 1] === "O")
		surround += getChainValue(x, y + 1, board, contested, "O");

	if (x > 0 && y > 0 && board[x - 1][y - 1] === "O")
		surround += getChainValue(x - 1, y - 1, board, contested, "O");
	if (x < size - 1 && y > 0 && board[x + 1][y - 1] === "O")
		surround += getChainValue(x + 1, y - 1, board, contested, "O");
	if (y < size - 1 && x > 0 && board[x - 1][y + 1] === "O")
		surround += getChainValue(x - 1, y - 1, board, contested, "O");
	if (y < size - 1 && x < size - 1 && board[x + 1][y + 1] === "O")
		surround += getChainValue(x + 1, y + 1, board, contested, "O");

	return surround;
}

/** @param {NS} ns */
function getRandomStrat(ns, board, validMoves, validLibMoves, contested) {
	const moveOptions = [];
	const moveOptions2 = [];
	const size = board[0].length;

	// Look through all the points on the board
	let bestRank = 0;
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		if (
			!["?", "O"].includes(contested[x][y]) ||
			createsLib(x, y, board, validLibMoves, "X")
		)
			continue;
		let isSupport =
			(x > 0 && board[x - 1][y] === "X" && validLibMoves[x - 1][y] >= 1) ||
				(x < size - 1 &&
					board[x + 1][y] === "X" &&
					validLibMoves[x + 1][y] >= 1) ||
				(y > 0 && board[x][y - 1] === "X" && validLibMoves[x][y - 1] >= 1) ||
				(y < size - 1 && board[x][y + 1] === "X" && validLibMoves[x][y + 1] >= 1)
				? true
				: false;
		let isAttack =
			(x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] >= 2) ||
				(x < size - 1 &&
					board[x + 1][y] === "O" &&
					validLibMoves[x + 1][y] >= 2) ||
				(y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] >= 2) ||
				(y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] >= 2)
				? true
				: false;

		const surround = getSurroundSpace(x, y, board);
		if (isSupport || isAttack) {
			if (surround > bestRank) {
				moveOptions.length = 0;
				bestRank = surround;
				moveOptions.push([x, y]);
			} else if (surround === bestRank) {
				moveOptions.push([x, y]);
			}
		} else if (validMoves[x][y]) {
			moveOptions2.push([x, y]);
		}
	}
	// Choose one of the found moves at random
	const randomIndex = Math.floor(Math.random() * moveOptions.length);
	const randomIndex2 = Math.floor(Math.random() * moveOptions2.length);
	moveOptions[randomIndex]
		? ns.print("Random Safe")
		: ns.print("Random Unsafe");
	return moveOptions[randomIndex]
		? moveOptions[randomIndex]
		: moveOptions2[randomIndex2]
			? moveOptions2[randomIndex2]
			: [];
}

/** @param {NS} ns */
function getRandomAttack(
	ns,
	board,
	validMoves,
	validLibMoves,
	contested,
	libs,
	minSurround = 3,
	minChain = 1,
	minFreeSpace = 0,
	safe = false
) {
	const moveOptions = [];
	const size = board[0].length;
	let highestValue = 0;
	let surround = 0;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		if (
			validLibMoves[x][y] !== -1 ||
			createsLib(x, y, board, validLibMoves, "X")
		)
			continue;
		const isAttack =
			(x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] === libs) ||
				(x < size - 1 &&
					board[x + 1][y] === "O" &&
					validLibMoves[x + 1][y] === libs) ||
				(y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] === libs) ||
				(y < size - 1 &&
					board[x][y + 1] === "O" &&
					validLibMoves[x][y + 1] === libs)
				? true
				: false;
		surround = getSurroundLibs(x, y, board, validLibMoves, "X");
		const freeSpace = getFreeSpace(x, y, board, contested);
		if (freeSpace < minFreeSpace) continue;
		if (!isAttack || surround < minSurround) continue;
		const chainAtk = getChainAttack(x, y, board, contested);
		if (chainAtk < minChain) continue;
		const enemyLibs = getSurroundLibSpread(x, y, board, validLibMoves, "O");
		const atk =
			((enemyLibs * chainAtk) /
				(getEyeValue(x, y, board, contested, "O") + 1)) *
			getHeatMap(x, y, board, "O");
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
	if (moveOptions[randomIndex])
		ns.print("Random Attack: " + libs + "  Surround: " + minSurround);
	return moveOptions[randomIndex] ?? [];
}

/** @param {NS} ns */
function getSpecialAttack(
	ns,
	board,
	validMoves,
	validLibMoves,
	contested,
	minLibs
) {
	const moveOptions = [];
	const size = board[0].length;
	let highestValue = 0;
	let surround = 0;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		if (
			validLibMoves[x][y] !== -1 ||
			createsLib(x, y, board, validLibMoves, "X")
		)
			continue;
		const isAttack =
			(x > 0 && board[x - 1][y] === "O") ||
				(x < size - 1 && board[x + 1][y] === "O") ||
				(y > 0 && board[x][y - 1] === "O") ||
				(y < size - 1 && board[x][y + 1] === "O")
				? true
				: false;
		surround = getSurroundLibs(x, y, board, validLibMoves, "X");
		if (
			!isAttack ||
			surround < minLibs ||
			getSurroundLibs(x, y, board, validLibMoves, "O") === 1
		)
			continue;
		const chainAtk = getChainAttack(x, y, board, contested);
		if (chainAtk < 1) continue;

		const enemyLibs = getSurroundLibSpread(x, y, board, validLibMoves, "O");
		const atk =
			(enemyLibs * chainAtk * (getEyeValue(x, y, board, contested, "X") + 1)) /
			(getEyeValue(x, y, board, contested, "O") + 1);
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
	if (moveOptions[randomIndex]) ns.print("Special Attack: " + surround);
	return moveOptions[randomIndex] ?? [];
}

/** @param {NS} ns */
function attackGrowDragon(
	ns,
	board,
	validMoves,
	validLibMoves,
	contested,
	requiredEyes,
	killLib = false
) {
	const moveOptions = [];
	let highestValue = 0;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		if (contested[x][y] !== "?" || createsLib(x, y, board, validLibMoves, "X"))
			continue;
		const surround = getSurroundEnemiesFull(x, y, board, contested);
		const myLibs = getSurroundLibs(x, y, board, validLibMoves, "X");
		if (surround < 1 || myLibs < 3) continue;
		const enemyLibs = getSurroundLibs(x, y, board, validLibMoves, "O");
		if (enemyLibs === 1 && !killLib) continue;
		const enemyChains = getChainAttackFull(x, y, board, contested);
		const myEyes = getEyeValueFull(x, y, board, contested, "X");
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
	if (moveOptions[randomIndex]) ns.print("Attack/Grow Dragon: " + requiredEyes);
	return moveOptions[randomIndex] ?? [];
}

/** @param {NS} ns */
function attackDragon(
	ns,
	board,
	validMoves,
	validLibMoves,
	contested,
	requiredEyes
) {
	const moveOptions = [];
	let highestValue = 1;
	// Look through all the points on the board
	const moves = getAllValidMoves(board, validMoves);
	for (const [x, y] of moves) {
		if (
			!validMoves[x][y] ||
			contested[x][y] !== "?" ||
			getFreeSpace(x, y, board, contested) <= 9
		)
			continue;
		const theirEyes = getEyeValueFull(x, y, board, contested, "O");
		if (theirEyes === 0) continue;
		const surround = getSurroundLibs(x, y, board, validLibMoves, "X");
		const myEyes = getEyeValue(x, y, board, contested, "X") + 1;
		if (
			!validMoves[x][y] ||
			theirEyes < requiredEyes ||
			surround <= 3 ||
			myEyes < 1
		)
			continue;
		const myChains = getChainSupport(x, y, board, contested);
		const result = theirEyes * surround * myEyes * myChains;

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
	if (moveOptions[randomIndex]) ns.print("Attack Dragon: " + requiredEyes);
	return moveOptions[randomIndex] ?? [];
}

/** @param {NS} ns */
function getDefPattern(
	ns,
	board,
	testBoard,
	validLibMoves,
	validMove,
	contested,
	width
) {
	let def;
	switch (width) {
		case 3:
			def = def3;
			break;
		case 4:
			def = def4;
			break;
		case 5:
			def = def5;
			break;
		case 6:
			def = def6;
			break;
		case 7:
			def = def7;
			break;
	}
	const moves = getAllValidMoves(board, validMove);
	for (const [x, y] of moves) {
		for (const pattern of def)
			if (
				isPattern(
					ns,
					x,
					y,
					pattern,
					testBoard,
					validMove,
					contested,
					"Def Pattern: " + width
				)
			)
				return [x, y];
	}
	return [];
}
/** @param {NS} ns */
function getEyeBlockPattern(
	ns,
	board,
	testBoard,
	validLibMoves,
	validMove,
	contested
) {
	let eyeBlocks = [];
	eyeBlocks.push(...eyeBlock5);

	const moves = getAllValidMoves(board, validMove);
	for (const [x, y] of moves) {
		for (const pattern of eyeBlocks)
			if (
				isPattern(
					ns,
					x,
					y,
					pattern,
					testBoard,
					validMove,
					contested,
					"EyeBlock Pattern: "
				)
			)
				return [x, y];
	}
	return [];
}
/** @param {NS} ns */
function getExpandPattern(
	ns,
	board,
	testBoard,
	validLibMoves,
	validMove,
	contested
) {
	let expand = [];
	expand.push(...expand7);
	expand.push(...expand5);
	expand.push(...expand4);
	expand.push(...expand3);

	const moves = getAllValidMoves(board, validMove);
	for (const [x, y] of moves) {
		for (const pattern of expand)
			if (
				isPattern(
					ns,
					x,
					y,
					pattern,
					testBoard,
					validMove,
					contested,
					"Expand Pattern: " + pattern.length
				)
			)
				return [x, y];
	}
	return [];
}
/** @param {NS} ns */
function disruptEyes(ns, board, testBoard, validMove, contested) {
	let disrupt = [];
	disrupt.push(...disrupt4);
	disrupt.push(...disrupt5);

	const moves = getAllValidMoves(board, validMove);
	for (const [x, y] of moves) {
		for (const pattern of disrupt)
			if (
				isPattern(
					ns,
					x,
					y,
					pattern,
					testBoard,
					validMove,
					contested,
					"Eye Disruption: " + pattern.length
				)
			)
				return [x, y];
	}
	return [];
}

/** @param {NS} ns */
async function movePiece(
	ns,
	coords,
	board,
	testBoard,
	validMove,
	validLibMoves,
	contested,
	chains
) {
	const [x, y] = coords;
	if (x === undefined) return undefined;
	if (CHEATS) {
			try {
				const chance = ns.go.cheat.getCheatSuccessChance()
				if (chance < .7) return ns.go.makeMove(x, y)
				//let [rndx, rndy] = getRandomBolster(ns, board, validMove, validLibMoves, contested, chains, 2, 1)
				//if (rndx === undefined || (rndx === x && rndy === y)) [rndx, rndy] = getRandomBolster(ns, board, validMove, validLibMoves, contested, chains, 3, 1)
				let [rndx, rndy] = getRandomAttack(ns, board, validMove, validLibMoves, contested, 2, 2)
				if (rndx === undefined || (rndx === x && rndy === y)) [rndx, rndy] = getRandomAttack(ns, board, validMove, validLibMoves, contested, 3, 3, 1)
				if (rndx === undefined || (rndx === x && rndy === y)) [rndx, rndy] = getRandomAttack(ns, board, validMove, validLibMoves, contested, 4, 3, 1)
				if (rndx === undefined || (rndx === x && rndy === y)) [rndx, rndy] = getExpandPattern(ns, board, testBoard, validLibMoves, validMove, contested)
				if (rndx === undefined || (rndx === x && rndy === y)) [rndx, rndy] = getRandomExpand(ns, board, validMove, validLibMoves, contested)
				if (rndx !== undefined && (rndx !== x && rndy !== y)) {
					ns.print("Cheater!")
					return await ns.go.cheat.playTwoMoves(x, y, rndx, rndy)
				}
				else return await ns.go.makeMove(x, y)
			}
			catch {
				return await ns.go.makeMove(x, y)
			}
	}
	//else return await ns.go.makeMove(x, y)
	else {
		ns.write("goLog.txt", "Ready to make move at " + Date.now() + "\n", "a");
		let rvar = await ns.go.makeMove(x, y);
		ns.write(
			"goLog.txt",
			"Opponent finished move at " + Date.now() + "\n",
			"a"
		);
		return rvar;
	}
}

function getAllValidMoves(board, validMove) {
	if (currentValidMovesTurn === turn) return currentValidMoves;
	let moves = [];
	for (let x = 0; x < board[0].length; x++)
		for (let y = 0; y < board[0].length; y++)
			if (validMove[x][y]) moves.push([x, y]);
	//Moves contains a randomized array of x,y
	moves = moves.sort(() => Math.random() - Math.random());
	currentValidMoves = moves;
	currentValidMovesTurn = turn;
	return currentValidMoves;
}

function createsLib(x, y, board, validLibMoves, player) {
	const size = board[0].length;
	if (x > 0 && board[x - 1][y] === player && validLibMoves[x - 1][y] > 2)
		return false;
	if (x < size - 1 && board[x + 1][y] === player && validLibMoves[x + 1][y] > 2)
		return false;
	if (y > 0 && board[x][y - 1] === player && validLibMoves[x][y - 1] > 2)
		return false;
	if (y < size - 1 && board[x][y + 1] === player && validLibMoves[x][y + 1] > 2)
		return false;

	if (x > 0 && board[x - 1][y] === player) return true;
	if (x < size - 1 && board[x + 1][y] === player) return true;
	if (y > 0 && board[x][y - 1] === player) return true;
	if (y < size - 1 && board[x][y + 1] === player) return true;
	return false;
}

function getOpeningMove(ns, board, validMove, validLibMoves, contested) {
	const size = board[0].length;
	ns.print("Opening Move: " + turn);
	switch (size) {
		case 13:
			if (getSurroundSpace(2, 2, board) === 4 && validMove[2][2]) return [2, 2];
			else if (getSurroundSpace(2, 10, board) === 4 && validMove[2][10])
				return [2, 10];
			else if (getSurroundSpace(10, 10, board) === 4 && validMove[10][10])
				return [10, 10];
			else if (getSurroundSpace(10, 2, board) === 4 && validMove[10][2])
				return [10, 2];
			else if (getSurroundSpace(3, 3, board) === 4 && validMove[3][3])
				return [3, 3];
			else if (getSurroundSpace(3, 9, board) === 4 && validMove[3][9])
				return [3, 9];
			else if (getSurroundSpace(9, 9, board) === 4 && validMove[9][9])
				return [9, 9];
			else if (getSurroundSpace(9, 3, board) === 4 && validMove[9][3])
				return [9, 3];
			else if (getSurroundSpace(4, 4, board) === 4 && validMove[4][4])
				return [4, 4];
			else if (getSurroundSpace(4, 8, board) === 4 && validMove[4][8])
				return [4, 8];
			else if (getSurroundSpace(8, 8, board) === 4 && validMove[8][8])
				return [8, 8];
			else if (getSurroundSpace(8, 4, board) === 4 && validMove[8][4])
				return [8, 4];
			else
				return getRandomStrat(ns, board, validMove, validLibMoves, contested);
		case 9:
			if (getSurroundSpace(2, 2, board) === 4 && validMove[2][2]) return [2, 2];
			else if (getSurroundSpace(2, 6, board) === 4 && validMove[2][6])
				return [2, 6];
			else if (getSurroundSpace(6, 6, board) === 4 && validMove[6][6])
				return [6, 6];
			else if (getSurroundSpace(6, 2, board) === 4 && validMove[6][2])
				return [6, 2];
			else if (getSurroundSpace(3, 3, board) === 4 && validMove[3][3])
				return [3, 3];
			else if (getSurroundSpace(3, 5, board) === 4 && validMove[3][5])
				return [3, 5];
			else if (getSurroundSpace(5, 5, board) === 4 && validMove[5][5])
				return [5, 5];
			else if (getSurroundSpace(5, 3, board) === 4 && validMove[5][3])
				return [5, 3];
			else
				return getRandomStrat(ns, board, validMove, validLibMoves, contested);
		case 7:
			if (getSurroundSpace(2, 2, board) === 4 && validMove[2][2]) return [2, 2];
			else if (getSurroundSpace(2, 4, board) === 4 && validMove[2][4])
				return [2, 4];
			else if (getSurroundSpace(4, 4, board) === 4 && validMove[4][4])
				return [4, 4];
			else if (getSurroundSpace(4, 2, board) === 4 && validMove[4][2])
				return [4, 2];
			else if (getSurroundSpace(3, 3, board) === 4 && validMove[3][3])
				return [3, 3];
			else if (getSurroundSpace(1, 1, board) === 4 && validMove[1][1])
				return [1, 1];
			else if (getSurroundSpace(5, 1, board) === 4 && validMove[5][1])
				return [5, 1];
			else if (getSurroundSpace(5, 5, board) === 4 && validMove[5][5])
				return [5, 5];
			else if (getSurroundSpace(1, 5, board) === 4 && validMove[1][5])
				return [1, 5];
			else
				return getRandomStrat(ns, board, validMove, validLibMoves, contested);
		case 5:
			if (getSurroundSpace(2, 2, board) === 4 && validMove[2][2]) return [2, 2];
			else if (getSurroundSpace(3, 3, board) === 4 && validMove[3][3])
				return [3, 3];
			else if (getSurroundSpace(3, 1, board) === 4 && validMove[3][1])
				return [3, 1];
			else if (getSurroundSpace(1, 3, board) === 4 && validMove[1][3])
				return [1, 3];
			else if (getSurroundSpace(1, 1, board) === 4 && validMove[1][1])
				return [1, 1];
			else
				return getRandomStrat(ns, board, validMove, validLibMoves, contested);
		case 19:
			if (getSurroundSpace(10, 10, board) === 4 && validMove[10][10])
				return [10, 10];
			else if (getSurroundSpace(2, 2, board) === 4 && validMove[2][2])
				return [2, 2];
			else if (getSurroundSpace(16, 2, board) === 4 && validMove[16][2])
				return [16, 2];
			else if (getSurroundSpace(2, 16, board) === 4 && validMove[2][16])
				return [2, 16];
			else if (getSurroundSpace(16, 16, board) === 4 && validMove[16][16])
				return [16, 16];
			else if (getSurroundSpace(3, 3, board) === 4 && validMove[3][3])
				return [3, 3];
			else if (getSurroundSpace(3, 15, board) === 4 && validMove[3][15])
				return [3, 15];
			else if (getSurroundSpace(15, 15, board) === 4 && validMove[15][15])
				return [15, 15];
			else if (getSurroundSpace(15, 3, board) === 4 && validMove[15][3])
				return [15, 3];
			else if (getSurroundSpace(4, 4, board) === 4 && validMove[4][4])
				return [4, 4];
			else if (getSurroundSpace(4, 14, board) === 4 && validMove[4][14])
				return [4, 14];
			else if (getSurroundSpace(14, 14, board) === 4 && validMove[14][14])
				return [14, 14];
			else if (getSurroundSpace(14, 4, board) === 4 && validMove[14][4])
				return [14, 4];
			else
				return getRandomStrat(ns, board, validMove, validLibMoves, contested);
	}
}

//X,O = Me, You  x, o = Anything but the other person or a blocking, "W" space is off the board, ? is anything goes
//B is blocking(Wall or you, not empty or enemy), b is blocking but could be enemy, A is All but . (Wall, Me, You, Blank)
//* is move here next if you can - no safeties

const disrupt4 = [
	[["??b?"], ["?b.b"], ["b.*b"], ["?bb?"]], //Pattern# Sphyxis - buy a turn #GREAT
	[["?bb?"], ["b..b"], ["b*Xb"], ["?bb?"]], //Pattern# Sphyxis - buy a turn #GREAT
	[["?bb?"], ["b..b"], ["b.*b"], ["?bb?"]], //Pattern# Sphyxis - buy a turn #GREAT
	[["??b?"], ["?b.b"], ["?b*b"], ["??O?"]], //Pattern# Sphyxis - Sacrifice to kill an eye
	[["?bbb"], ["bb.b"], ["W.*b"], ["?oO?"]], //Pattern# Sphyxis - 2x2 nook breatk
	[["?bbb"], ["bb.b"], ["W.*b"], ["?Oo?"]], //Pattern# Sphyxis - 2x2 nook break
	[[".bbb"], ["o*.b"], [".bbb"], ["????"]], //Pattern# Sphyxis - Dangling 2 break
	//[["??b?"], ["?b.b"], ["??*?"], ["????"]], //Pattern# Testing - Disrupt Eye Formation
];
const disrupt5 = [
	[["?bbb?"], ["b.*.b"], ["?bbb?"], ["?????"], ["?????"]], //Pattern# Sphyxis - Convert to 1 eye
	[["??OO?"], ["?b*.b"], ["?b..b"], ["??bb?"], ["?????"]], //Pattern# Sphyxis - Buy time
	[["?????"], ["??bb?"], ["?b*Xb"], ["?boob"], ["??bb?"]], //Pattern# Sphyxis - Buy time
	[["WWW??"], ["WWob?"], ["Wo*b?"], ["WWW??"], ["?????"]], //Pattern# Sphyxis - 2x2 attack corner if possible
	[["??b??"], ["?b.b?"], ["?b*b?"], ["?b.A?"], ["??b??"]], //Pattern# Sphyxis - Break two eyes into 1, buy a turn
	[["??b??"], ["?b.b?"], ["??*.b"], ["?b?b?"], ["?????"]], //Pattern# Sphyxis - Break eyes, buy time
	[["?WWW?"], ["WoOoW"], ["WOO*W"], ["W???W"], ["?????"]], //Block 3x3 corner
	[["?WWW?"], ["Wo*oW"], ["WOOOW"], ["W???W"], ["?????"]], //Block 3x3 corner
];

const def3 = [
	[["xXx"], ["x.x"], ["xxx"]], //Pattern# Sphyxis - Bolster Eyes
	[["?X?"], ["XOX"], ["XOX"]], // Cap
	[["OX?"], ["OOX"], ["OX?"]], // Cap 2
	[["OX?"], ["OOX"], ["OX?"]], // Cap 2
];

const def4 = [
	[["?BBB"], ["BB.B"], ["W..B"], ["?.*?"]], //Pattern# Sphyxis - 2x2 nook #GREAT
	[["?BBB"], ["BB.B"], ["W..B"], ["?*x?"]], //Pattern# Sphyxis - 2x2 nook #GREAT
	[[".BBB"], ["x*.B"], [".BBB"], ["????"]], //Pattern# Sphyxis - Dangling 2
	[[".X.O"], ["O*XO"], [".X.O"], ["????"]], //Pattern# Make Proper Eye
];

const def5 = [
	[["?WW??"], ["WW.X?"], ["W.XX?"], ["WWW??"], ["?????"]], //Pattern# Sphyxis - Eyes in a nook
	[["WWW??"], ["WW.X?"], ["W.*X?"], ["WWW??"], ["?????"]], //Pattern# Sphyxis - 2x2 corner contain #GREAT
	[["BBB??"], ["BB.X?"], ["B..X?"], ["BBB??"], ["?????"]], //Pattern# Sphyxis - 2x2 corner contain #GREAT
	[["?WWW?"], ["W.*.W"], ["WXXXW"], ["?????"], ["?????"]], //Take the 3x3 back corner
];

const def6 = [
	[["?...??"], ["??.bb."], ["?.XXXb"], ["??*bb."], ["?...??"], ["??????"]], //Pattern# Sphyxis - Avoid net!
];
const def7 = [
	[
		["BBBBBBB"],
		["......B"],
		["......B"],
		[".X*...B"],
		[".OOX..B"],
		["......B"],
		["......B"],
	], //Pattern# joseki
	[
		["???????"],
		["???X???"],
		["??XOX??"],
		["?XOOOX?"],
		[".OOOOO."],
		["???????"],
		["???????"],
	], //7x7 net
	[
		["???????"],
		["???X???"],
		["??XOX??"],
		["?XOOOX?"],
		["XOOOOO."],
		["???????"],
		["???????"],
	], //7x7 net
	[
		["???????"],
		["???X???"],
		["??XOX??"],
		["?XOOOX?"],
		["XOOOOOX"],
		["?????X?"],
		["???????"],
	], //7x7 net
	[
		["???????"],
		["???X???"],
		["??XOX??"],
		["?XOOOX?"],
		["XOOOOOX"],
		["?X?X?X?"],
		["???????"],
	], //7x7 net
	[
		["???????"],
		["???X???"],
		["??XOX??"],
		["?XOOOX?"],
		["XOOOOOX"],
		["?X?X?X?"],
		["??X????"],
	], //7x7 net
	[
		["???x???"],
		["??xXx??"],
		["?xxOxx?"],
		["xxOoOxx"],
		["?xxOxx?"],
		["??xxx??"],
		["???x???"],
	], //Pattern# Sphyxis - Star Net
	[
		["???x???"],
		["??xxx??"],
		["?xxOXx?"],
		["xxOoOxx"],
		["?xxOxx?"],
		["??xxx??"],
		["???x???"],
	], //Pattern# Sphyxis - Star Net
];

const eyeBlock5 = [
	[["?????"], ["??*??"], ["?b.b?"], ["??b??"], ["?????"]], //Stop line progression
];

const expand3 = [[["..."], [".X."], ["..."]]];

const expand4 = [
	//[["WWW?"], ["...?"], [".X.?"], ["...?"]], //Wall Spotted
];

const expand5 = [
	[["??.??"], ["?...?"], ["..X.."], ["?...?"], ["??.??"]], //Open Area
	[["?????"], ["xxx.?"], ["xX.X."], ["xxx.?"], ["?????"]], //Pattern# Sphyxis - Expand Sideways
	[["xxxo?"], ["xx.Xo"], ["x.Xo?"], ["xX???"], ["?.???"]], //Checker
];
const expand7 = [
	//[["?.?????"], [".X..???"], ["?.?..??"], ["?..X.??"], ["??...??"], ["???????"], ["???????"]], //Open Area
];

// Testing
//const opponent = ["Tetrads"]
//const opponent2 = ["Tetrads"]

// Original
const opponent = [
  /*"Netburners", */ "Slum Snakes",
	"The Black Hand",
	"Tetrads",
	"Daedalus",
	"Illuminati",
];
const opponent2 = [
  /*"Netburners", */ "Slum Snakes",
	"The Black Hand",
	"Tetrads",
	"Daedalus",
	"Illuminati",
	"????????????",
];
