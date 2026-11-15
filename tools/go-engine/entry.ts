// Bundled by tools/go-engine/build.mjs into servers/home/go-engine.js: the game's real IPvGO rules and AI.
export { getMove } from "SRC/Go/boardAnalysis/goAI";
export { makeMove, passTurn, getStateCopy, getNewBoardStateFromSimpleBoard, updateChains } from "SRC/Go/boardState/boardState";
export { getAllValidMoves, simpleBoardFromBoard, boardStringFromBoard, evaluateIfMoveIsValid } from "SRC/Go/boardAnalysis/boardAnalysis";
export { getScore } from "SRC/Go/boardAnalysis/scoring";
export { Player as EnginePlayer } from "@player";
