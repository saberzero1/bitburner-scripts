// The Go singleton: storedCycles (AI wait); currentGame is only read for highlight sizes
export const Go: any = { storedCycles: 0, currentGame: { board: new Array(5), previousBoards: [] }, previousGame: null, stats: {}, moveOrCheatViaApi: false };
export const GoEvents: any = { emit: () => {}, subscribe: () => () => {} };
export const getEmptyHighlightedPoints = (size: number) => Array.from({ length: size }, () => Array.from({ length: size }, () => null));
