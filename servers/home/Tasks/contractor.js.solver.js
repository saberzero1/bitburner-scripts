import { jsonReviver, tail } from "../helpers.js";
const fUnsolvedContracts = "/Temp/unsolved-contracts.txt"; // A global, persistent array of contracts we couldn't solve, so we don't repeatedly log about them.

let heartbeat = null;

//Silly human, you can't import a typescript module into a javascript (wouldn't that be slick though?)
//import { codingContractTypesMetadata } from 'https://raw.githubusercontent.com/danielyxie/bitburner/master/src/data/codingcontracttypes.ts'

// This contract solver has the bare-minimum footprint of 1.6 GB (base) + 10 GB (ns.codingcontract.attempt)
// It does this by requiring all contract information being gathered in advance and passed in as a JSON blob argument.
// Solvers are mostly taken from source code at https://raw.githubusercontent.com/danielyxie/bitburner/master/src/data/codingcontracttypes.ts
//
// Enhancement: Solver functions are now offloaded to Web Workers for parallel execution.
// The main thread only calls ns.codingcontract.attempt() (which requires NS API access).
// Workers compute answers in parallel, dramatically improving throughput for large contract batches.

// ─── Worker Pool ────────────────────────────────────────────────────────────────
const idleWorkers = [];
const activeWorkers = [];

function getWorker() {
    if (idleWorkers.length > 0) return idleWorkers.pop();
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    return worker;
}

function terminateAllWorkers() {
    for (const worker of [...idleWorkers, ...activeWorkers]) {
        worker.terminate();
        worker.onmessage = null;
        worker.onerror = null;
    }
    idleWorkers.length = 0;
    activeWorkers.length = 0;
}

// ─── Type → Solver Function Name Mapping ────────────────────────────────────────
// Maps each contract type name to the corresponding function name inside the workerCode string.
const solverTypeMap = {
    "Find Largest Prime Factor": "solveFindLargestPrimeFactor",
    "Subarray with Maximum Sum": "solveSubarrayWithMaximumSum",
    "Total Ways to Sum": "solveTotalWaysToSum",
    "Total Ways to Sum II": "solveTotalWaysToSumII",
    "Spiralize Matrix": "solveSpiralizeMatrix",
    "Array Jumping Game": "solveArrayJumpingGame",
    "Array Jumping Game II": "solveArrayJumpingGameII",
    "Merge Overlapping Intervals": "solveMergeOverlappingIntervals",
    "Generate IP Addresses": "solveGenerateIPAddresses",
    "Algorithmic Stock Trader I": "solveAlgorithmicStockTraderI",
    "Algorithmic Stock Trader II": "solveAlgorithmicStockTraderII",
    "Algorithmic Stock Trader III": "solveAlgorithmicStockTraderIII",
    "Algorithmic Stock Trader IV": "solveAlgorithmicStockTraderIV",
    "Minimum Path Sum in a Triangle": "solveMinimumPathSumInATriangle",
    "Unique Paths in a Grid I": "solveUniquePathsInAGridI",
    "Unique Paths in a Grid II": "solveUniquePathsInAGridII",
    "Shortest Path in a Grid": "solveShortestPathInAGrid",
    "Sanitize Parentheses in Expression":
        "solveSanitizeParenthesesInExpression",
    "Find All Valid Math Expressions": "solveFindAllValidMathExpressions",
    "HammingCodes: Integer to Encoded Binary":
        "solveHammingCodesIntegerToEncodedBinary",
    "HammingCodes: Encoded Binary to Integer":
        "solveHammingCodesEncodedBinaryToInteger",
    "Proper 2-Coloring of a Graph": "solveProper2ColoringOfAGraph",
    "Compression I: RLE Compression": "solveCompressionIRLECompression",
    "Compression II: LZ Decompression": "solveCompressionIILZDecompression",
    "Compression III: LZ Compression": "solveCompressionIIILZCompression",
    "Encryption I: Caesar Cipher": "solveEncryptionICaesarCipher",
    "Encryption II: Vigenère Cipher": "solveEncryptionIIVigenereCipher",
    "Square Root": "solveSquareRoot",
    "Total Number of Primes": "solveTotalNumberOfPrimes",
    "Largest Rectangle in a Matrix": "solveLargestRectangleInAMatrix",
};

/** @param {NS} ns **/
export async function main(ns) {
    if (ns.args.length < 1)
        ns.tprint(
            "Contractor solver was incorrectly invoked without arguments.",
        );

    // Hack: Use global memory to avoid multiple instances running concurrently (without paying for ns.ps)
    if (heartbeat != null)
        if (performance.now() - heartbeat <= 1000 * 60)
            // If this variable is set, another instance is likely running!
            // If last start was more 1 minute ago, assume it blew up and isn't actually still running
            return ns.print(
                "WARNING: Another contractor appears to already be running. Ignoring request.",
            );
    heartbeat = performance.now();

    // Ensure all workers are terminated when script exits
    ns.atExit(() => terminateAllWorkers());

    try {
        let contractsDb = JSON.parse(ns.args[0]);
        const fContents = ns.read(fUnsolvedContracts);
        const notified = fContents ? JSON.parse(fContents) : [];

        // Don't spam toast notifications and console messages if there are more than 20 contracts to solve:
        const quietSolve = contractsDb.length > 20;
        let failureCount = 0;
        let solvedCount = 0;
        let inFlight = 0;
        let completed = 0;

        if (quietSolve) {
            const message = `Welcome back. There are ${contractsDb.length} contracts to solve, so we won't generate a notification for each.`;
            ns.toast(message, "success");
            ns.tprint(message);
        }

        // Dispatch all contracts to workers in parallel
        for (const contractInfo of contractsDb) {
            heartbeat = performance.now();
            const solverName = solverTypeMap[contractInfo.type];

            if (solverName == null) {
                // No solver available - handle immediately (no worker needed)
                const notice = `WARNING: No solver available for contract type "${contractInfo.type}"`;
                if (!notified.includes(contractInfo.contract) && !quietSolve) {
                    ns.tprint(
                        notice +
                            `\nContract Info: ${JSON.stringify(contractInfo)}`,
                    );
                    ns.toast(notice, "warning");
                    notified.push(contractInfo.contract);
                }
                ns.print(
                    notice + `\nContract Info: ${JSON.stringify(contractInfo)}`,
                );
                continue;
            }

            // Get a worker from the pool and dispatch
            const worker = getWorker();
            inFlight++;
            activeWorkers.push(worker);

            worker.onerror = (err) => {
                completed++;
                failureCount++;
                const notice = `ERROR: Worker error solving "${contractInfo.type}" (${contractInfo.contract} on ${contractInfo.hostname}):\n"${err.message}"`;
                if (!notified.includes(contractInfo.contract) && !quietSolve) {
                    ns.tprint(
                        notice +
                            `\nContract Info: ${JSON.stringify(contractInfo)}`,
                    );
                    ns.toast(notice, "warning");
                    notified.push(contractInfo.contract);
                }
                ns.print(
                    notice + `\nContract Info: ${JSON.stringify(contractInfo)}`,
                );
                // Return worker to idle pool
                const idx = activeWorkers.indexOf(worker);
                if (idx !== -1) activeWorkers.splice(idx, 1);
                idleWorkers.push(worker);
            };

            worker.onmessage = (msg) => {
                completed++;
                const [answer, contract, hostname, type] = msg.data;
                let notice = null;

                if (answer != null) {
                    let solvingResult = false;
                    try {
                        solvingResult = ns.codingcontract.attempt(
                            answer,
                            contract,
                            hostname,
                            { returnReward: true },
                        );
                        if (solvingResult) {
                            solvedCount++;
                            if (!quietSolve) {
                                const message = `Solved ${contract} on ${hostname} (${type}). Reward: ${solvingResult}`;
                                ns.toast(message, "success");
                                ns.tprint(message);
                            }
                        } else {
                            notice =
                                `ERROR: Wrong answer for contract type "${type}" (${contract} on ${hostname}):` +
                                `\nIncorrect Answer Given: ${JSON.stringify(answer)}`;
                        }
                    } catch (err) {
                        failureCount++;
                        let errorMessage =
                            typeof err === "string"
                                ? err
                                : err.message || JSON.stringify(err);
                        if (err?.stack) errorMessage += "\n" + err.stack;
                        notice = `ERROR: Attempt to solve contract raised an error. (Answer Given: ${JSON.stringify(answer)})\n"${errorMessage}"`;
                        // Suppress errors about missing contracts. This can happen if this script gets while another instance is already running.
                        if (
                            errorMessage.indexOf("Cannot find contract") == -1
                        ) {
                            ns.print(notice); // Still log it to the terminal in case we're debugging a fake contract.
                            notice = null;
                        }
                    }
                } else {
                    notice = `ERROR: Worker returned null answer for contract type "${type}" (${contract} on ${hostname})`;
                }

                if (notice) {
                    if (!notified.includes(contract) && !quietSolve) {
                        ns.tprint(
                            notice +
                                `\nContract Info: ${JSON.stringify({ contract, hostname, type })}`,
                        );
                        ns.toast(notice, "warning");
                        notified.push(contract);
                    }
                    // Always print errors to scripts own tail window
                    ns.print(
                        notice +
                            `\nContract Info: ${JSON.stringify({ contract, hostname, type })}`,
                    );
                }

                // Return worker to idle pool
                const idx = activeWorkers.indexOf(worker);
                if (idx !== -1) activeWorkers.splice(idx, 1);
                idleWorkers.push(worker);
            };

            // Send work to the worker: [solverFunctionName, contractData, contractFile, hostname]
            worker.postMessage([
                solverName,
                contractInfo.dataJson,
                contractInfo.contract,
                contractInfo.hostname,
            ]);

            // Backpressure: if too many contracts are in-flight, wait for some to complete
            if (inFlight - completed > 50) await ns.asleep(100);
        }

        // Wait for all in-flight workers to complete
        while (completed < inFlight) {
            heartbeat = performance.now();
            await ns.asleep(100);
        }

        // Keep tabs of failed contracts
        if (notified.length > 0)
            await ns.write(fUnsolvedContracts, JSON.stringify(notified), "w");
        // Let the user know when we're done solving a large number of contracts.
        if (quietSolve) {
            const message = `Done solving ${contractsDb.length}. ${solvedCount} succeeded, and ${failureCount} failed. See tail logs for errors.`;
            if (failureCount > 0) tail(ns);
            ns.toast(message, "success");
            ns.tprint(message);
        }
    } finally {
        heartbeat = null; // Signal that we're no longer running in case another contractor wants to start running.
        terminateAllWorkers();
    }
}

// ─── Fallback: Sequential solver (used if Web Workers are unavailable) ──────────
// This is the original findAnswer function, kept as a reference and potential fallback.
function findAnswer(contract) {
    const codingContractSolution = codingContractTypesMetadata.find(
        (codingContractTypeMetadata) =>
            codingContractTypeMetadata.name === contract.type,
    );
    return codingContractSolution
        ? codingContractSolution.solver(
              JSON.parse(contract.dataJson, jsonReviver),
          )
        : null;
}

function convert2DArrayToString(arr) {
    const components = [];
    arr.forEach(function (e) {
        let s = e.toString();
        s = ["[", s, "]"].join("");
        components.push(s);
    });
    return components.join(",").replace(/\s/g, "");
}

// Based on https://github.com/danielyxie/bitburner/blob/master/src/data/codingcontracttypes.ts
const codingContractTypesMetadata = [
    {
        name: "Find Largest Prime Factor",
        solver: function (data) {
            let fac = 2;
            let n = data;
            while (n > (fac - 1) * (fac - 1)) {
                while (n % fac === 0) {
                    n = Math.round(n / fac);
                }
                ++fac;
            }
            return n === 1 ? fac - 1 : n;
        },
    },
    {
        name: "Subarray with Maximum Sum",
        solver: function (data) {
            const nums = data.slice();
            for (let i = 1; i < nums.length; i++) {
                nums[i] = Math.max(nums[i], nums[i] + nums[i - 1]);
            }
            return Math.max.apply(Math, nums);
        },
    },
    {
        name: "Total Ways to Sum",
        solver: function (data) {
            const ways = [1];
            ways.length = data + 1;
            ways.fill(0, 1);
            for (let i = 1; i < data; ++i) {
                for (let j = i; j <= data; ++j) {
                    ways[j] += ways[j - i];
                }
            }
            return ways[data];
        },
    },
    {
        name: "Total Ways to Sum II",
        solver: function (data) {
            const n = data[0];
            const s = data[1];
            const ways = [1];
            ways.length = n + 1;
            ways.fill(0, 1);
            for (let i = 0; i < s.length; i++) {
                for (let j = s[i]; j <= n; j++) {
                    ways[j] += ways[j - s[i]];
                }
            }
            return ways[n];
        },
    },
    {
        name: "Spiralize Matrix",
        solver: function (data) {
            const spiral = [];
            const m = data.length;
            const n = data[0].length;
            let u = 0;
            let d = m - 1;
            let l = 0;
            let r = n - 1;
            let k = 0;
            while (true) {
                // Up
                for (let col = l; col <= r; col++) {
                    spiral[k] = data[u][col];
                    ++k;
                }
                if (++u > d) {
                    break;
                }
                // Right
                for (let row = u; row <= d; row++) {
                    spiral[k] = data[row][r];
                    ++k;
                }
                if (--r < l) {
                    break;
                }
                // Down
                for (let col = r; col >= l; col--) {
                    spiral[k] = data[d][col];
                    ++k;
                }
                if (--d < u) {
                    break;
                }
                // Left
                for (let row = d; row >= u; row--) {
                    spiral[k] = data[row][l];
                    ++k;
                }
                if (++l > r) {
                    break;
                }
            }

            return spiral;
        },
    },
    {
        name: "Array Jumping Game",
        solver: function (data) {
            const n = data.length;
            let i = 0;
            for (let reach = 0; i < n && i <= reach; ++i) {
                reach = Math.max(i + data[i], reach);
            }
            const solution = i === n;
            return solution ? 1 : 0;
        },
    },
    {
        name: "Array Jumping Game II",
        solver: function (data) {
            if (data[0] == 0) return "0";
            const n = data.length;
            let reach = 0;
            let jumps = 0;
            let lastJump = -1;
            while (reach < n - 1) {
                let jumpedFrom = -1;
                for (let i = reach; i > lastJump; i--) {
                    if (i + data[i] > reach) {
                        reach = i + data[i];
                        jumpedFrom = i;
                    }
                }
                if (jumpedFrom === -1) {
                    jumps = 0;
                    break;
                }
                lastJump = jumpedFrom;
                jumps++;
            }
            return jumps;
        },
    },
    {
        name: "Merge Overlapping Intervals",
        solver: function (data) {
            const intervals = data.slice();
            intervals.sort(function (a, b) {
                return a[0] - b[0];
            });
            const result = [];
            let start = intervals[0][0];
            let end = intervals[0][1];
            for (const interval of intervals) {
                if (interval[0] <= end) {
                    end = Math.max(end, interval[1]);
                } else {
                    result.push([start, end]);
                    start = interval[0];
                    end = interval[1];
                }
            }
            result.push([start, end]);
            const sanitizedResult = convert2DArrayToString(result);
            return sanitizedResult;
        },
    },
    {
        name: "Generate IP Addresses",
        solver: function (data) {
            const ret = [];
            for (let a = 1; a <= 3; ++a) {
                for (let b = 1; b <= 3; ++b) {
                    for (let c = 1; c <= 3; ++c) {
                        for (let d = 1; d <= 3; ++d) {
                            if (a + b + c + d === data.length) {
                                const A = parseInt(data.substring(0, a), 10);
                                const B = parseInt(
                                    data.substring(a, a + b),
                                    10,
                                );
                                const C = parseInt(
                                    data.substring(a + b, a + b + c),
                                    10,
                                );
                                const D = parseInt(
                                    data.substring(a + b + c, a + b + c + d),
                                    10,
                                );
                                if (
                                    A <= 255 &&
                                    B <= 255 &&
                                    C <= 255 &&
                                    D <= 255
                                ) {
                                    const ip = [
                                        A.toString(),
                                        ".",
                                        B.toString(),
                                        ".",
                                        C.toString(),
                                        ".",
                                        D.toString(),
                                    ].join("");
                                    if (ip.length === data.length + 3) {
                                        ret.push(ip);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return ret.toString(); // Answer expected is the string representation of this array
        },
    },
    {
        name: "Algorithmic Stock Trader I",
        solver: function (data) {
            let maxCur = 0;
            let maxSoFar = 0;
            for (let i = 1; i < data.length; ++i) {
                maxCur = Math.max(0, (maxCur += data[i] - data[i - 1]));
                maxSoFar = Math.max(maxCur, maxSoFar);
            }
            return maxSoFar.toString();
        },
    },
    {
        name: "Algorithmic Stock Trader II",
        solver: function (data) {
            let profit = 0;
            for (let p = 1; p < data.length; ++p) {
                profit += Math.max(data[p] - data[p - 1], 0);
            }
            return profit.toString();
        },
    },
    {
        name: "Algorithmic Stock Trader III",
        solver: function (data) {
            let hold1 = Number.MIN_SAFE_INTEGER;
            let hold2 = Number.MIN_SAFE_INTEGER;
            let release1 = 0;
            let release2 = 0;
            for (const price of data) {
                release2 = Math.max(release2, hold2 + price);
                hold2 = Math.max(hold2, release1 - price);
                release1 = Math.max(release1, hold1 + price);
                hold1 = Math.max(hold1, price * -1);
            }
            return release2.toString();
        },
    },
    {
        name: "Algorithmic Stock Trader IV",
        solver: function (data) {
            const k = data[0];
            const prices = data[1];
            const len = prices.length;
            if (len < 2) {
                return 0;
            }
            if (k > len / 2) {
                let res = 0;
                for (let i = 1; i < len; ++i) {
                    res += Math.max(prices[i] - prices[i - 1], 0);
                }
                return res;
            }
            const hold = [];
            const rele = [];
            hold.length = k + 1;
            rele.length = k + 1;
            for (let i = 0; i <= k; ++i) {
                hold[i] = Number.MIN_SAFE_INTEGER;
                rele[i] = 0;
            }
            let cur;
            for (let i = 0; i < len; ++i) {
                cur = prices[i];
                for (let j = k; j > 0; --j) {
                    rele[j] = Math.max(rele[j], hold[j] + cur);
                    hold[j] = Math.max(hold[j], rele[j - 1] - cur);
                }
            }
            return rele[k];
        },
    },
    {
        name: "Minimum Path Sum in a Triangle",
        solver: function (data) {
            const n = data.length;
            const dp = data[n - 1].slice();
            for (let i = n - 2; i > -1; --i) {
                for (let j = 0; j < data[i].length; ++j) {
                    dp[j] = Math.min(dp[j], dp[j + 1]) + data[i][j];
                }
            }
            return dp[0];
        },
    },
    {
        name: "Unique Paths in a Grid I",
        solver: function (data) {
            const n = data[0]; // Number of rows
            const m = data[1]; // Number of columns
            const currentRow = [];
            currentRow.length = n;
            for (let i = 0; i < n; i++) {
                currentRow[i] = 1;
            }
            for (let row = 1; row < m; row++) {
                for (let i = 1; i < n; i++) {
                    currentRow[i] += currentRow[i - 1];
                }
            }
            return currentRow[n - 1];
        },
    },
    {
        name: "Unique Paths in a Grid II",
        solver: function (data) {
            const obstacleGrid = [];
            obstacleGrid.length = data.length;
            for (let i = 0; i < obstacleGrid.length; ++i) {
                obstacleGrid[i] = data[i].slice();
            }
            for (let i = 0; i < obstacleGrid.length; i++) {
                for (let j = 0; j < obstacleGrid[0].length; j++) {
                    if (obstacleGrid[i][j] == 1) {
                        obstacleGrid[i][j] = 0;
                    } else if (i == 0 && j == 0) {
                        obstacleGrid[0][0] = 1;
                    } else {
                        obstacleGrid[i][j] =
                            (i > 0 ? obstacleGrid[i - 1][j] : 0) +
                            (j > 0 ? obstacleGrid[i][j - 1] : 0);
                    }
                }
            }
            return obstacleGrid[obstacleGrid.length - 1][
                obstacleGrid[0].length - 1
            ];
        },
    },
    {
        name: "Shortest Path in a Grid",
        solver: function (data) {
            //slightly adapted and simplified to get rid of MinHeap usage, and construct a valid path from potential candidates
            //MinHeap replaced by simple array acting as queue (breadth first search)
            const width = data[0].length;
            const height = data.length;
            const dstY = height - 1;
            const dstX = width - 1;

            const distance = new Array(height);
            //const prev: [[number, number] | undefined][] = new Array(height);
            const queue = [];

            for (let y = 0; y < height; y++) {
                distance[y] = new Array(width).fill(Infinity);
                //prev[y] = new Array(width).fill(undefined) as [undefined];
            }

            function validPosition(y, x) {
                return (
                    y >= 0 &&
                    y < height &&
                    x >= 0 &&
                    x < width &&
                    data[y][x] == 0
                );
            }

            // List in-bounds and passable neighbors
            function* neighbors(y, x) {
                if (validPosition(y - 1, x)) yield [y - 1, x]; // Up
                if (validPosition(y + 1, x)) yield [y + 1, x]; // Down
                if (validPosition(y, x - 1)) yield [y, x - 1]; // Left
                if (validPosition(y, x + 1)) yield [y, x + 1]; // Right
            }

            // Prepare starting point
            distance[0][0] = 0;

            //## Original version
            // queue.push([0, 0], 0);
            // // Take next-nearest position and expand potential paths from there
            // while (queue.size > 0) {
            //   const [y, x] = queue.pop() as [number, number];
            //   for (const [yN, xN] of neighbors(y, x)) {
            //     const d = distance[y][x] + 1;
            //     if (d < distance[yN][xN]) {
            //       if (distance[yN][xN] == Infinity)
            //         // Not reached previously
            //         queue.push([yN, xN], d);
            //       // Found a shorter path
            //       else queue.changeWeight(([yQ, xQ]) => yQ == yN && xQ == xN, d);
            //       //prev[yN][xN] = [y, x];
            //       distance[yN][xN] = d;
            //     }
            //   }
            // }

            //Simplified version. d < distance[yN][xN] should never happen for BFS if d != infinity, so we skip changeweight and simplify implementation
            //algo always expands shortest path, distance != infinity means a <= lenght path reaches it, only remaining case to solve is infinity
            queue.push([0, 0]);
            while (queue.length > 0) {
                const [y, x] = queue.shift();
                for (const [yN, xN] of neighbors(y, x)) {
                    if (distance[yN][xN] == Infinity) {
                        queue.push([yN, xN]);
                        distance[yN][xN] = distance[y][x] + 1;
                    }
                }
            }

            // No path at all?
            if (distance[dstY][dstX] == Infinity) return "";

            //trace a path back to start
            let path = "";
            let [yC, xC] = [dstY, dstX];
            while (xC != 0 || yC != 0) {
                const dist = distance[yC][xC];
                for (const [yF, xF] of neighbors(yC, xC)) {
                    if (distance[yF][xF] == dist - 1) {
                        path =
                            (xC == xF
                                ? yC == yF + 1
                                    ? "D"
                                    : "U"
                                : xC == xF + 1
                                  ? "R"
                                  : "L") + path;
                        [yC, xC] = [yF, xF];
                        break;
                    }
                }
            }

            return path;
        },
    },
    {
        name: "Sanitize Parentheses in Expression",
        solver: function (data) {
            let left = 0;
            let right = 0;
            const res = [];
            for (let i = 0; i < data.length; ++i) {
                if (data[i] === "(") {
                    ++left;
                } else if (data[i] === ")") {
                    left > 0 ? --left : ++right;
                }
            }

            function dfs(pair, index, left, right, s, solution, res) {
                if (s.length === index) {
                    if (left === 0 && right === 0 && pair === 0) {
                        for (let i = 0; i < res.length; i++) {
                            if (res[i] === solution) {
                                return;
                            }
                        }
                        res.push(solution);
                    }
                    return;
                }
                if (s[index] === "(") {
                    if (left > 0) {
                        dfs(pair, index + 1, left - 1, right, s, solution, res);
                    }
                    dfs(
                        pair + 1,
                        index + 1,
                        left,
                        right,
                        s,
                        solution + s[index],
                        res,
                    );
                } else if (s[index] === ")") {
                    if (right > 0)
                        dfs(pair, index + 1, left, right - 1, s, solution, res);
                    if (pair > 0)
                        dfs(
                            pair - 1,
                            index + 1,
                            left,
                            right,
                            s,
                            solution + s[index],
                            res,
                        );
                } else {
                    dfs(
                        pair,
                        index + 1,
                        left,
                        right,
                        s,
                        solution + s[index],
                        res,
                    );
                }
            }
            dfs(0, 0, left, right, data, "", res);

            return res;
        },
    },
    {
        name: "Find All Valid Math Expressions",
        solver: function (data) {
            const num = data[0];
            const target = data[1];

            function helper(res, path, num, target, pos, evaluated, multed) {
                if (pos === num.length) {
                    if (target === evaluated) {
                        res.push(path);
                    }
                    return;
                }
                for (let i = pos; i < num.length; ++i) {
                    if (i != pos && num[pos] == "0") {
                        break;
                    }
                    const cur = parseInt(num.substring(pos, i + 1));
                    if (pos === 0) {
                        helper(res, path + cur, num, target, i + 1, cur, cur);
                    } else {
                        helper(
                            res,
                            path + "+" + cur,
                            num,
                            target,
                            i + 1,
                            evaluated + cur,
                            cur,
                        );
                        helper(
                            res,
                            path + "-" + cur,
                            num,
                            target,
                            i + 1,
                            evaluated - cur,
                            -cur,
                        );
                        helper(
                            res,
                            path + "*" + cur,
                            num,
                            target,
                            i + 1,
                            evaluated - multed + multed * cur,
                            multed * cur,
                        );
                    }
                }
            }

            if (num == null || num.length === 0) {
                return [];
            }
            const result = [];
            helper(result, "", num, target, 0, 0, 0);
            return result;
        },
    },
    {
        //Taken from https://github.com/danielyxie/bitburner/blob/dev/src/utils/HammingCodeTools.ts and converted to js by Discord: H3draut3r#6722
        name: "HammingCodes: Integer to Encoded Binary",
        solver: function (value) {
            // Calculates the needed amount of parityBits 'without' the "overall"-Parity
            const HammingSumOfParity = (lengthOfDBits) =>
                lengthOfDBits == 0
                    ? 0
                    : lengthOfDBits < 3
                      ? lengthOfDBits + 1
                      : Math.ceil(Math.log2(lengthOfDBits * 2)) <=
                          Math.ceil(
                              Math.log2(
                                  1 +
                                      lengthOfDBits +
                                      Math.ceil(Math.log2(lengthOfDBits)),
                              ),
                          )
                        ? Math.ceil(Math.log2(lengthOfDBits) + 1)
                        : Math.ceil(Math.log2(lengthOfDBits));
            const data = value.toString(2).split(""); // first, change into binary string, then create array with 1 bit per index
            const sumParity = HammingSumOfParity(data.length); // get the sum of needed parity bits (for later use in encoding)
            const count = (arr, val) =>
                arr.reduce((a, v) => (v === val ? a + 1 : a), 0);
            // function count for specific entries in the array, for later use
            const build = ["x", "x", ...data.splice(0, 1)]; // init the "pre-build"
            for (let i = 2; i < sumParity; i++)
                build.push("x", ...data.splice(0, Math.pow(2, i) - 1)); // add new paritybits and the corresponding data bits (pre-building array)
            // Get the index numbers where the parity bits "x" are placed
            const parityBits = build
                .map((e, i) => [e, i])
                .filter(([e, _]) => e == "x")
                .map(([_, i]) => i);
            for (const index of parityBits) {
                const tempcount = index + 1; // set the "stepsize" for the parityBit
                const temparray = []; // temporary array to store the extracted bits
                const tempdata = [...build]; // only work with a copy of the build
                while (tempdata[index] !== undefined) {
                    // as long as there are bits on the starting index, do "cut"
                    const temp = tempdata.splice(index, tempcount * 2); // cut stepsize*2 bits, then...
                    temparray.push(...temp.splice(0, tempcount)); // ... cut the result again and keep the first half
                }
                temparray.splice(0, 1); // remove first bit, which is the parity one
                build[index] = (count(temparray, "1") % 2).toString(); // count with remainder of 2 and"toString" to store the parityBit
            } // parity done, now the "overall"-parity is set
            build.unshift((count(build, "1") % 2).toString()); // has to be done as last element
            return build.join(""); // return the build as string
        },
    },
    {
        name: "HammingCodes: Encoded Binary to Integer",
        solver: function (data) {
            //check for altered bit and decode
            const build = data.split(""); // ye, an array for working, again
            const testArray = []; //for the "truthtable". if any is false, the data has an altered bit, will check for and fix it
            const sumParity = Math.ceil(Math.log2(data.length)); // sum of parity for later use
            const count = (arr, val) =>
                arr.reduce((a, v) => (v === val ? a + 1 : a), 0);
            // the count.... again ;)
            let overallParity = build.splice(0, 1).join(""); // store first index, for checking in next step and fix the build properly later on
            testArray.push(
                overallParity == (count(build, "1") % 2).toString()
                    ? true
                    : false,
            ); // first check with the overall parity bit
            for (let i = 0; i < sumParity; i++) {
                // for the rest of the remaining parity bits we also "check"
                const tempIndex = Math.pow(2, i) - 1; // get the parityBits Index
                const tempStep = tempIndex + 1; // set the stepsize
                const tempData = [...build]; // get a "copy" of the build-data for working
                const tempArray = []; // init empty array for "testing"
                while (tempData[tempIndex] != undefined) {
                    // extract from the copied data until the "starting" index is undefined
                    const temp = [...tempData.splice(tempIndex, tempStep * 2)]; // extract 2*stepsize
                    tempArray.push(...temp.splice(0, tempStep)); // and cut again for keeping first half
                }
                const tempParity = tempArray.shift(); // and again save the first index separated for checking with the rest of the data
                testArray.push(
                    tempParity == (count(tempArray, "1") % 2).toString()
                        ? true
                        : false,
                );
                // is the tempParity the calculated data? push answer into the 'truthtable'
            }
            let fixIndex = 0; // init the "fixing" index and start with 0
            for (let i = 1; i < sumParity + 1; i++) {
                // simple binary adding for every boolean in the testArray, starting from 2nd index of it
                fixIndex += testArray[i] ? 0 : Math.pow(2, i) / 2;
            }
            build.unshift(overallParity); // now we need the "overall" parity back in it's place
            // try fix the actual encoded binary string if there is an error
            if (fixIndex > 0 && testArray[0] == false) {
                // if the overall is false and the sum of calculated values is greater equal 0, fix the corresponding hamming-bit
                build[fixIndex] = build[fixIndex] == "0" ? "1" : "0";
            } else if (testArray[0] == false) {
                // otherwise, if the the overallparity is the only wrong, fix that one
                overallParity = overallParity == "0" ? "1" : "0";
            } else if (
                testArray[0] == true &&
                testArray.some((truth) => truth == false)
            ) {
                return 0; // ERROR: There's some strange going on... 2 bits are altered? How? This should not happen
            }
            // oof.. halfway through... we fixed an possible altered bit, now "extract" the parity-bits from the build
            for (let i = sumParity; i >= 0; i--) {
                // start from the last parity down the 2nd index one
                build.splice(Math.pow(2, i), 1);
            }
            build.splice(0, 1); // remove the overall parity bit and we have our binary value
            return parseInt(build.join(""), 2); // parse the integer with redux 2 and we're done!
        },
    },
    {
        name: "Proper 2-Coloring of a Graph",
        solver: function (data) {
            // convert from edges to nodes
            const nodes = new Array(data[0]).fill(0).map(() => []);
            for (const e of data[1]) {
                nodes[e[0]].push(e[1]);
                nodes[e[1]].push(e[0]);
            }
            // solution graph starts out undefined and fills in with 0s and 1s
            const solution = new Array(data[0]).fill(undefined);
            let oddCycleFound = false;
            // recursive function for DFS
            const traverse = (index, color) => {
                if (oddCycleFound) {
                    // leave immediately if an invalid cycle was found
                    return;
                }
                if (solution[index] === color) {
                    // node was already hit and is correctly colored
                    return;
                }
                if (solution[index] === (color ^ 1)) {
                    // node was already hit and is incorrectly colored: graph is uncolorable
                    oddCycleFound = true;
                    return;
                }
                solution[index] = color;
                for (const n of nodes[index]) {
                    traverse(n, color ^ 1);
                }
            };
            // repeat run for as long as undefined nodes are found, in case graph isn't fully connected
            while (!oddCycleFound && solution.some((e) => e === undefined)) {
                traverse(solution.indexOf(undefined), 0);
            }
            if (oddCycleFound) return []; // Empty array for graphs with odd cycles (no valid 2-coloring)
            return solution;
        },
    },
    {
        name: "Compression I: RLE Compression",
        solver: function (data) {
            //original code doesn't generate an answer, but validates it, fallback to this one-liner
            return data.replace(
                /([\w])\1{0,8}/g,
                (group, chr) => group.length + chr,
            );
        },
    },
    {
        name: "Compression II: LZ Decompression",
        solver: function (compr) {
            let plain = "";

            for (let i = 0; i < compr.length; ) {
                const literal_length = compr.charCodeAt(i) - 0x30;

                if (
                    literal_length < 0 ||
                    literal_length > 9 ||
                    i + 1 + literal_length > compr.length
                ) {
                    return null;
                }

                plain += compr.substring(i + 1, i + 1 + literal_length);
                i += 1 + literal_length;

                if (i >= compr.length) {
                    break;
                }
                const backref_length = compr.charCodeAt(i) - 0x30;

                if (backref_length < 0 || backref_length > 9) {
                    return null;
                } else if (backref_length === 0) {
                    ++i;
                } else {
                    if (i + 1 >= compr.length) {
                        return null;
                    }

                    const backref_offset = compr.charCodeAt(i + 1) - 0x30;
                    if (
                        (backref_length > 0 &&
                            (backref_offset < 1 || backref_offset > 9)) ||
                        backref_offset > plain.length
                    ) {
                        return null;
                    }

                    for (let j = 0; j < backref_length; ++j) {
                        plain += plain[plain.length - backref_offset];
                    }

                    i += 2;
                }
            }

            return plain;
        },
    },
    {
        name: "Compression III: LZ Compression",
        solver: function (plain) {
            let cur_state = Array.from(Array(10), () => Array(10).fill(null));
            let new_state = Array.from(Array(10), () => Array(10));

            function set(state, i, j, str) {
                const current = state[i][j];
                if (current == null || str.length < current.length) {
                    state[i][j] = str;
                } else if (
                    str.length === current.length &&
                    Math.random() < 0.5
                ) {
                    // if two strings are the same length, pick randomly so that
                    // we generate more possible inputs to Compression II
                    state[i][j] = str;
                }
            }

            // initial state is a literal of length 1
            cur_state[0][1] = "";

            for (let i = 1; i < plain.length; ++i) {
                for (const row of new_state) {
                    row.fill(null);
                }
                const c = plain[i];

                // handle literals
                for (let length = 1; length <= 9; ++length) {
                    const string = cur_state[0][length];
                    if (string == null) {
                        continue;
                    }

                    if (length < 9) {
                        // extend current literal
                        set(new_state, 0, length + 1, string);
                    } else {
                        // start new literal
                        set(
                            new_state,
                            0,
                            1,
                            string + "9" + plain.substring(i - 9, i) + "0",
                        );
                    }

                    for (let offset = 1; offset <= Math.min(9, i); ++offset) {
                        if (plain[i - offset] === c) {
                            // start new backreference
                            set(
                                new_state,
                                offset,
                                1,
                                string +
                                    length +
                                    plain.substring(i - length, i),
                            );
                        }
                    }
                }

                // handle backreferences
                for (let offset = 1; offset <= 9; ++offset) {
                    for (let length = 1; length <= 9; ++length) {
                        const string = cur_state[offset][length];
                        if (string == null) {
                            continue;
                        }

                        if (plain[i - offset] === c) {
                            if (length < 9) {
                                // extend current backreference
                                set(new_state, offset, length + 1, string);
                            } else {
                                // start new backreference
                                set(
                                    new_state,
                                    offset,
                                    1,
                                    string + "9" + offset + "0",
                                );
                            }
                        }

                        // start new literal
                        set(new_state, 0, 1, string + length + offset);

                        // end current backreference and start new backreference
                        for (
                            let new_offset = 1;
                            new_offset <= Math.min(9, i);
                            ++new_offset
                        ) {
                            if (plain[i - new_offset] === c) {
                                set(
                                    new_state,
                                    new_offset,
                                    1,
                                    string + length + offset + "0",
                                );
                            }
                        }
                    }
                }

                const tmp_state = new_state;
                new_state = cur_state;
                cur_state = tmp_state;
            }

            let result = null;

            for (let len = 1; len <= 9; ++len) {
                let string = cur_state[0][len];
                if (string == null) {
                    continue;
                }

                string +=
                    len + plain.substring(plain.length - len, plain.length);
                if (result == null || string.length < result.length) {
                    result = string;
                } else if (
                    string.length == result.length &&
                    Math.random() < 0.5
                ) {
                    result = string;
                }
            }

            for (let offset = 1; offset <= 9; ++offset) {
                for (let len = 1; len <= 9; ++len) {
                    let string = cur_state[offset][len];
                    if (string == null) {
                        continue;
                    }

                    string += len + "" + offset;
                    if (result == null || string.length < result.length) {
                        result = string;
                    } else if (
                        string.length == result.length &&
                        Math.random() < 0.5
                    ) {
                        result = string;
                    }
                }
            }

            return result ?? "";
        },
    },
    {
        name: "Encryption I: Caesar Cipher",
        solver: function (data) {
            // data = [plaintext, shift value]
            // build char array, shifting via map and join to final results
            const cipher = [...data[0]]
                .map((a) =>
                    a === " "
                        ? a
                        : String.fromCharCode(
                              ((a.charCodeAt(0) - 65 - data[1] + 26) % 26) + 65,
                          ),
                )
                .join("");
            return cipher;
        },
    },
    {
        name: "Encryption II: Vigenère Cipher",
        solver: function (data) {
            // data = [plaintext, keyword]
            // build char array, shifting via map and corresponding keyword letter and join to final results
            const cipher = [...data[0]]
                .map((a, i) => {
                    return a === " "
                        ? a
                        : String.fromCharCode(
                              ((a.charCodeAt(0) -
                                  2 * 65 +
                                  data[1].charCodeAt(i % data[1].length)) %
                                  26) +
                                  65,
                          );
                })
                .join("");
            return cipher;
        },
    },
    {
        name: "Square Root",
        /** Uses the Newton-Raphson method to iteratively improve the guess until the answer is found.
         * @param {bigint} n */
        solver: function (n) {
            const two = BigInt(2);
            if (n < two) return n; // Square root of 1 is 1, square root of 0 is 0
            let root = n / two; // Initial guess
            let x1 = (root + n / root) / two;
            while (x1 < root) {
                root = x1;
                x1 = (root + n / root) / two;
            }
            // That's it, solved! At least, we've converged an an answer which should be as close as we can get (might be off by 1)
            // We want the answer to the "nearest integer". Check the answer on either side of the one we converged on to see what's closest
            const bigAbs = (x) => (x < 0n ? -x : x); // There's no Math.abs where we're going...
            let absDiff = bigAbs(root * root - n); // How far off we from the perfect square root
            if (absDiff == 0n)
                return root; // Note that this coding contract doesn't guarantee there's an exact integer square root
            else if (absDiff > bigAbs((root - 1n) * (root - 1n) - n))
                root = root - 1n; // Do we get a better answer by subtracting 1?
            else if (absDiff > bigAbs((root + 1n) * (root + 1n) - n))
                root = root + 1n; // Do we get a better answer by adding 1?
            // Validation: We should be able to tell if we got this right without wasting a guess. Adding/Subtracting 1 should now always be worse
            absDiff = bigAbs(root * root - n);
            if (
                absDiff > bigAbs((root - 1n) * (root - 1n) - n) ||
                absDiff > bigAbs((root + 1n) * (root + 1n) - n)
            )
                throw new Error(
                    `Square Root did not converge. Arrived at answer:\n${root} - which when squared, gives:\n${root * root} instead of\n${n}`,
                );
            return root.toString();
        },
    },
    {
        name: "Total Number of Primes",
        solver: function (data) {
            // Segmented Sieve of Eratosthenes to count primes in [low, high]
            // Based on https://github.com/bitburner-official/bitburner-src/blob/dev/src/CodingContract/contracts/TotalPrimesInRange.ts
            function simpleSieve(max) {
                const primes = [];
                const arr = Array(max);
                for (let i = 2; i * i <= max; i++) {
                    if (!arr[i]) {
                        for (let p = i * i; p <= max; p += i) {
                            arr[p] = 1;
                        }
                    }
                }
                for (let i = 2; i <= max; i++) {
                    if (!arr[i]) {
                        primes.push(i);
                    }
                }
                return primes;
            }

            let low = data[0];
            let high = data[1];
            if (low < 2) low = 2;
            let count = 0;
            const arr = Array(high - low + 1);
            const checks = simpleSieve(Math.ceil(Math.sqrt(high)));
            for (const i of checks) {
                const lim = Math.max(i, Math.ceil(low / i)) * i;
                for (let j = lim; j <= high; j += i) {
                    arr[j - low] = 1;
                }
            }
            for (let a = 0; a <= high - low; a++) {
                if (!arr[a]) {
                    ++count;
                }
            }
            return count;
        },
    },
    {
        name: "Largest Rectangle in a Matrix",
        solver: function (data) {
            // Build histograms: for each cell, count consecutive 0s upward (including current row)
            // Based on https://github.com/bitburner-official/bitburner-src/blob/dev/src/CodingContract/contracts/LargestRectangle.ts
            const rows = data.length;
            const cols = data[0].length;
            const histograms = Array.from({ length: rows }, () =>
                Array(cols).fill(0),
            );
            for (let c = 0; c < cols; c++) {
                let count = 0;
                for (let r = 0; r < rows; r++) {
                    if (data[r][c] == 0) {
                        count++;
                    } else {
                        count = 0;
                    }
                    histograms[r][c] = count;
                }
            }
            let maxArea = 0;
            let maxL = 0;
            let maxR = 0;
            let maxU = 0;
            let maxD = 0;
            for (let i = 0; i < histograms.length; i++) {
                const row = histograms[i];
                for (let j = 0; j < row.length; j++) {
                    if (row[j] == 0) continue;
                    let left = j;
                    let right = j;
                    while (row[left - 1] >= row[j]) {
                        left--;
                    }
                    while (row[right + 1] >= row[j]) {
                        right++;
                    }
                    if ((right - left + 1) * row[j] > maxArea) {
                        maxArea = (right - left + 1) * row[j];
                        maxL = left;
                        maxR = right;
                        maxU = i - row[j] + 1;
                        maxD = i;
                    }
                }
            }
            return [
                [maxU, maxL],
                [maxD, maxR],
            ];
        },
    },
];

// ─── Web Worker Code ────────────────────────────────────────────────────────────
// All solver functions are duplicated here as a template literal string that runs
// inside a Web Worker. Workers have no access to the NS API — they only compute
// answers and post results back to the main thread.
//
// The jsonReviver is included so workers can parse BigInt values from contract data.
// Each function name matches the solverTypeMap keys above.
const workerCode = `
function jsonReviver(key, value) {
    if (typeof value === "string" && /^-?[0-9]+(\\.[0-9]+)?n$/.test(value))
        return BigInt(value.slice(0, -1));
    return value;
}

function convert2DArrayToString(arr) {
    const components = [];
    arr.forEach(function (e) {
        let s = e.toString();
        s = ["[", s, "]"].join("");
        components.push(s);
    });
    return components.join(",").replace(/\\s/g, "");
}

function solveFindLargestPrimeFactor(data) {
    let fac = 2;
    let n = data;
    while (n > (fac - 1) * (fac - 1)) {
        while (n % fac === 0) {
            n = Math.round(n / fac);
        }
        ++fac;
    }
    return n === 1 ? fac - 1 : n;
}

function solveSubarrayWithMaximumSum(data) {
    const nums = data.slice();
    for (let i = 1; i < nums.length; i++) {
        nums[i] = Math.max(nums[i], nums[i] + nums[i - 1]);
    }
    return Math.max.apply(Math, nums);
}

function solveTotalWaysToSum(data) {
    const ways = [1];
    ways.length = data + 1;
    ways.fill(0, 1);
    for (let i = 1; i < data; ++i) {
        for (let j = i; j <= data; ++j) {
            ways[j] += ways[j - i];
        }
    }
    return ways[data];
}

function solveTotalWaysToSumII(data) {
    const n = data[0];
    const s = data[1];
    const ways = [1];
    ways.length = n + 1;
    ways.fill(0, 1);
    for (let i = 0; i < s.length; i++) {
        for (let j = s[i]; j <= n; j++) {
            ways[j] += ways[j - s[i]];
        }
    }
    return ways[n];
}

function solveSpiralizeMatrix(data) {
    const spiral = [];
    const m = data.length;
    const n = data[0].length;
    let u = 0;
    let d = m - 1;
    let l = 0;
    let r = n - 1;
    let k = 0;
    while (true) {
        for (let col = l; col <= r; col++) { spiral[k] = data[u][col]; ++k; }
        if (++u > d) break;
        for (let row = u; row <= d; row++) { spiral[k] = data[row][r]; ++k; }
        if (--r < l) break;
        for (let col = r; col >= l; col--) { spiral[k] = data[d][col]; ++k; }
        if (--d < u) break;
        for (let row = d; row >= u; row--) { spiral[k] = data[row][l]; ++k; }
        if (++l > r) break;
    }
    return spiral;
}

function solveArrayJumpingGame(data) {
    const n = data.length;
    let i = 0;
    for (let reach = 0; i < n && i <= reach; ++i) {
        reach = Math.max(i + data[i], reach);
    }
    return i === n ? 1 : 0;
}

function solveArrayJumpingGameII(data) {
    if (data[0] == 0) return "0";
    const n = data.length;
    let reach = 0;
    let jumps = 0;
    let lastJump = -1;
    while (reach < n - 1) {
        let jumpedFrom = -1;
        for (let i = reach; i > lastJump; i--) {
            if (i + data[i] > reach) {
                reach = i + data[i];
                jumpedFrom = i;
            }
        }
        if (jumpedFrom === -1) { jumps = 0; break; }
        lastJump = jumpedFrom;
        jumps++;
    }
    return jumps;
}

function solveMergeOverlappingIntervals(data) {
    const intervals = data.slice();
    intervals.sort(function (a, b) { return a[0] - b[0]; });
    const result = [];
    let start = intervals[0][0];
    let end = intervals[0][1];
    for (const interval of intervals) {
        if (interval[0] <= end) {
            end = Math.max(end, interval[1]);
        } else {
            result.push([start, end]);
            start = interval[0];
            end = interval[1];
        }
    }
    result.push([start, end]);
    return convert2DArrayToString(result);
}

function solveGenerateIPAddresses(data) {
    const ret = [];
    for (let a = 1; a <= 3; ++a) {
        for (let b = 1; b <= 3; ++b) {
            for (let c = 1; c <= 3; ++c) {
                for (let d = 1; d <= 3; ++d) {
                    if (a + b + c + d === data.length) {
                        const A = parseInt(data.substring(0, a), 10);
                        const B = parseInt(data.substring(a, a + b), 10);
                        const C = parseInt(data.substring(a + b, a + b + c), 10);
                        const D = parseInt(data.substring(a + b + c, a + b + c + d), 10);
                        if (A <= 255 && B <= 255 && C <= 255 && D <= 255) {
                            const ip = [A.toString(), ".", B.toString(), ".", C.toString(), ".", D.toString()].join("");
                            if (ip.length === data.length + 3) ret.push(ip);
                        }
                    }
                }
            }
        }
    }
    return ret.toString();
}

function solveAlgorithmicStockTraderI(data) {
    let maxCur = 0;
    let maxSoFar = 0;
    for (let i = 1; i < data.length; ++i) {
        maxCur = Math.max(0, (maxCur += data[i] - data[i - 1]));
        maxSoFar = Math.max(maxCur, maxSoFar);
    }
    return maxSoFar.toString();
}

function solveAlgorithmicStockTraderII(data) {
    let profit = 0;
    for (let p = 1; p < data.length; ++p) {
        profit += Math.max(data[p] - data[p - 1], 0);
    }
    return profit.toString();
}

function solveAlgorithmicStockTraderIII(data) {
    let hold1 = Number.MIN_SAFE_INTEGER;
    let hold2 = Number.MIN_SAFE_INTEGER;
    let release1 = 0;
    let release2 = 0;
    for (const price of data) {
        release2 = Math.max(release2, hold2 + price);
        hold2 = Math.max(hold2, release1 - price);
        release1 = Math.max(release1, hold1 + price);
        hold1 = Math.max(hold1, price * -1);
    }
    return release2.toString();
}

function solveAlgorithmicStockTraderIV(data) {
    const k = data[0];
    const prices = data[1];
    const len = prices.length;
    if (len < 2) return 0;
    if (k > len / 2) {
        let res = 0;
        for (let i = 1; i < len; ++i) res += Math.max(prices[i] - prices[i - 1], 0);
        return res;
    }
    const hold = [];
    const rele = [];
    hold.length = k + 1;
    rele.length = k + 1;
    for (let i = 0; i <= k; ++i) { hold[i] = Number.MIN_SAFE_INTEGER; rele[i] = 0; }
    let cur;
    for (let i = 0; i < len; ++i) {
        cur = prices[i];
        for (let j = k; j > 0; --j) {
            rele[j] = Math.max(rele[j], hold[j] + cur);
            hold[j] = Math.max(hold[j], rele[j - 1] - cur);
        }
    }
    return rele[k];
}

function solveMinimumPathSumInATriangle(data) {
    const n = data.length;
    const dp = data[n - 1].slice();
    for (let i = n - 2; i > -1; --i) {
        for (let j = 0; j < data[i].length; ++j) {
            dp[j] = Math.min(dp[j], dp[j + 1]) + data[i][j];
        }
    }
    return dp[0];
}

function solveUniquePathsInAGridI(data) {
    const n = data[0];
    const m = data[1];
    const currentRow = [];
    currentRow.length = n;
    for (let i = 0; i < n; i++) currentRow[i] = 1;
    for (let row = 1; row < m; row++) {
        for (let i = 1; i < n; i++) currentRow[i] += currentRow[i - 1];
    }
    return currentRow[n - 1];
}

function solveUniquePathsInAGridII(data) {
    const obstacleGrid = [];
    obstacleGrid.length = data.length;
    for (let i = 0; i < obstacleGrid.length; ++i) obstacleGrid[i] = data[i].slice();
    for (let i = 0; i < obstacleGrid.length; i++) {
        for (let j = 0; j < obstacleGrid[0].length; j++) {
            if (obstacleGrid[i][j] == 1) obstacleGrid[i][j] = 0;
            else if (i == 0 && j == 0) obstacleGrid[0][0] = 1;
            else obstacleGrid[i][j] = (i > 0 ? obstacleGrid[i - 1][j] : 0) + (j > 0 ? obstacleGrid[i][j - 1] : 0);
        }
    }
    return obstacleGrid[obstacleGrid.length - 1][obstacleGrid[0].length - 1];
}

function solveShortestPathInAGrid(data) {
    const width = data[0].length;
    const height = data.length;
    const dstY = height - 1;
    const dstX = width - 1;
    const distance = new Array(height);
    const queue = [];
    for (let y = 0; y < height; y++) distance[y] = new Array(width).fill(Infinity);
    function validPosition(y, x) {
        return y >= 0 && y < height && x >= 0 && x < width && data[y][x] == 0;
    }
    function neighbors(y, x) {
        const result = [];
        if (validPosition(y - 1, x)) result.push([y - 1, x]);
        if (validPosition(y + 1, x)) result.push([y + 1, x]);
        if (validPosition(y, x - 1)) result.push([y, x - 1]);
        if (validPosition(y, x + 1)) result.push([y, x + 1]);
        return result;
    }
    distance[0][0] = 0;
    queue.push([0, 0]);
    while (queue.length > 0) {
        const [y, x] = queue.shift();
        for (const [yN, xN] of neighbors(y, x)) {
            if (distance[yN][xN] == Infinity) {
                queue.push([yN, xN]);
                distance[yN][xN] = distance[y][x] + 1;
            }
        }
    }
    if (distance[dstY][dstX] == Infinity) return "";
    let path = "";
    let yC = dstY, xC = dstX;
    while (xC != 0 || yC != 0) {
        const dist = distance[yC][xC];
        for (const [yF, xF] of neighbors(yC, xC)) {
            if (distance[yF][xF] == dist - 1) {
                path = (xC == xF ? (yC == yF + 1 ? "D" : "U") : (xC == xF + 1 ? "R" : "L")) + path;
                yC = yF; xC = xF;
                break;
            }
        }
    }
    return path;
}

function solveSanitizeParenthesesInExpression(data) {
    let left = 0;
    let right = 0;
    const res = [];
    for (let i = 0; i < data.length; ++i) {
        if (data[i] === "(") ++left;
        else if (data[i] === ")") left > 0 ? --left : ++right;
    }
    function dfs(pair, index, left, right, s, solution, res) {
        if (s.length === index) {
            if (left === 0 && right === 0 && pair === 0) {
                for (let i = 0; i < res.length; i++) { if (res[i] === solution) return; }
                res.push(solution);
            }
            return;
        }
        if (s[index] === "(") {
            if (left > 0) dfs(pair, index + 1, left - 1, right, s, solution, res);
            dfs(pair + 1, index + 1, left, right, s, solution + s[index], res);
        } else if (s[index] === ")") {
            if (right > 0) dfs(pair, index + 1, left, right - 1, s, solution, res);
            if (pair > 0) dfs(pair - 1, index + 1, left, right, s, solution + s[index], res);
        } else {
            dfs(pair, index + 1, left, right, s, solution + s[index], res);
        }
    }
    dfs(0, 0, left, right, data, "", res);
    return res;
}

function solveFindAllValidMathExpressions(data) {
    const num = data[0];
    const target = data[1];
    function helper(res, path, num, target, pos, evaluated, multed) {
        if (pos === num.length) {
            if (target === evaluated) res.push(path);
            return;
        }
        for (let i = pos; i < num.length; ++i) {
            if (i != pos && num[pos] == "0") break;
            const cur = parseInt(num.substring(pos, i + 1));
            if (pos === 0) {
                helper(res, path + cur, num, target, i + 1, cur, cur);
            } else {
                helper(res, path + "+" + cur, num, target, i + 1, evaluated + cur, cur);
                helper(res, path + "-" + cur, num, target, i + 1, evaluated - cur, -cur);
                helper(res, path + "*" + cur, num, target, i + 1, evaluated - multed + multed * cur, multed * cur);
            }
        }
    }
    if (num == null || num.length === 0) return [];
    const result = [];
    helper(result, "", num, target, 0, 0, 0);
    return result;
}

function solveHammingCodesIntegerToEncodedBinary(value) {
    const HammingSumOfParity = (lengthOfDBits) =>
        lengthOfDBits == 0 ? 0
        : lengthOfDBits < 3 ? lengthOfDBits + 1
        : Math.ceil(Math.log2(lengthOfDBits * 2)) <= Math.ceil(Math.log2(1 + lengthOfDBits + Math.ceil(Math.log2(lengthOfDBits))))
            ? Math.ceil(Math.log2(lengthOfDBits) + 1)
            : Math.ceil(Math.log2(lengthOfDBits));
    const data = value.toString(2).split("");
    const sumParity = HammingSumOfParity(data.length);
    const count = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0);
    const build = ["x", "x", ...data.splice(0, 1)];
    for (let i = 2; i < sumParity; i++) build.push("x", ...data.splice(0, Math.pow(2, i) - 1));
    const parityBits = build.map((e, i) => [e, i]).filter(([e, _]) => e == "x").map(([_, i]) => i);
    for (const index of parityBits) {
        const tempcount = index + 1;
        const temparray = [];
        const tempdata = [...build];
        while (tempdata[index] !== undefined) {
            const temp = tempdata.splice(index, tempcount * 2);
            temparray.push(...temp.splice(0, tempcount));
        }
        temparray.splice(0, 1);
        build[index] = (count(temparray, "1") % 2).toString();
    }
    build.unshift((count(build, "1") % 2).toString());
    return build.join("");
}

function solveHammingCodesEncodedBinaryToInteger(data) {
    const build = data.split("");
    const testArray = [];
    const sumParity = Math.ceil(Math.log2(data.length));
    const count = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0);
    let overallParity = build.splice(0, 1).join("");
    testArray.push(overallParity == (count(build, "1") % 2).toString() ? true : false);
    for (let i = 0; i < sumParity; i++) {
        const tempIndex = Math.pow(2, i) - 1;
        const tempStep = tempIndex + 1;
        const tempData = [...build];
        const tempArray = [];
        while (tempData[tempIndex] != undefined) {
            const temp = [...tempData.splice(tempIndex, tempStep * 2)];
            tempArray.push(...temp.splice(0, tempStep));
        }
        const tempParity = tempArray.shift();
        testArray.push(tempParity == (count(tempArray, "1") % 2).toString() ? true : false);
    }
    let fixIndex = 0;
    for (let i = 1; i < sumParity + 1; i++) fixIndex += testArray[i] ? 0 : Math.pow(2, i) / 2;
    build.unshift(overallParity);
    if (fixIndex > 0 && testArray[0] == false) {
        build[fixIndex] = build[fixIndex] == "0" ? "1" : "0";
    } else if (testArray[0] == false) {
        overallParity = overallParity == "0" ? "1" : "0";
    } else if (testArray[0] == true && testArray.some((truth) => truth == false)) {
        return 0;
    }
    for (let i = sumParity; i >= 0; i--) build.splice(Math.pow(2, i), 1);
    build.splice(0, 1);
    return parseInt(build.join(""), 2);
}

function solveProper2ColoringOfAGraph(data) {
    const nodes = new Array(data[0]).fill(0).map(() => []);
    for (const e of data[1]) { nodes[e[0]].push(e[1]); nodes[e[1]].push(e[0]); }
    const solution = new Array(data[0]).fill(undefined);
    let oddCycleFound = false;
    const traverse = (index, color) => {
        if (oddCycleFound) return;
        if (solution[index] === color) return;
        if (solution[index] === (color ^ 1)) { oddCycleFound = true; return; }
        solution[index] = color;
        for (const n of nodes[index]) traverse(n, color ^ 1);
    };
    while (!oddCycleFound && solution.some((e) => e === undefined)) {
        traverse(solution.indexOf(undefined), 0);
    }
    if (oddCycleFound) return [];
    return solution;
}

function solveCompressionIRLECompression(data) {
    return data.replace(/([\\w])\\1{0,8}/g, (group, chr) => group.length + chr);
}

function solveCompressionIILZDecompression(compr) {
    let plain = "";
    for (let i = 0; i < compr.length; ) {
        const literal_length = compr.charCodeAt(i) - 0x30;
        if (literal_length < 0 || literal_length > 9 || i + 1 + literal_length > compr.length) return null;
        plain += compr.substring(i + 1, i + 1 + literal_length);
        i += 1 + literal_length;
        if (i >= compr.length) break;
        const backref_length = compr.charCodeAt(i) - 0x30;
        if (backref_length < 0 || backref_length > 9) return null;
        else if (backref_length === 0) { ++i; }
        else {
            if (i + 1 >= compr.length) return null;
            const backref_offset = compr.charCodeAt(i + 1) - 0x30;
            if ((backref_length > 0 && (backref_offset < 1 || backref_offset > 9)) || backref_offset > plain.length) return null;
            for (let j = 0; j < backref_length; ++j) plain += plain[plain.length - backref_offset];
            i += 2;
        }
    }
    return plain;
}

function solveCompressionIIILZCompression(plain) {
    let cur_state = Array.from(Array(10), () => Array(10).fill(null));
    let new_state = Array.from(Array(10), () => Array(10));
    function set(state, i, j, str) {
        const current = state[i][j];
        if (current == null || str.length < current.length) state[i][j] = str;
        else if (str.length === current.length && Math.random() < 0.5) state[i][j] = str;
    }
    cur_state[0][1] = "";
    for (let i = 1; i < plain.length; ++i) {
        for (const row of new_state) row.fill(null);
        const c = plain[i];
        for (let length = 1; length <= 9; ++length) {
            const string = cur_state[0][length];
            if (string == null) continue;
            if (length < 9) set(new_state, 0, length + 1, string);
            else set(new_state, 0, 1, string + "9" + plain.substring(i - 9, i) + "0");
            for (let offset = 1; offset <= Math.min(9, i); ++offset) {
                if (plain[i - offset] === c) set(new_state, offset, 1, string + length + plain.substring(i - length, i));
            }
        }
        for (let offset = 1; offset <= 9; ++offset) {
            for (let length = 1; length <= 9; ++length) {
                const string = cur_state[offset][length];
                if (string == null) continue;
                if (plain[i - offset] === c) {
                    if (length < 9) set(new_state, offset, length + 1, string);
                    else set(new_state, offset, 1, string + "9" + offset + "0");
                }
                set(new_state, 0, 1, string + length + offset);
                for (let new_offset = 1; new_offset <= Math.min(9, i); ++new_offset) {
                    if (plain[i - new_offset] === c) set(new_state, new_offset, 1, string + length + offset + "0");
                }
            }
        }
        const tmp_state = new_state;
        new_state = cur_state;
        cur_state = tmp_state;
    }
    let result = null;
    for (let len = 1; len <= 9; ++len) {
        let string = cur_state[0][len];
        if (string == null) continue;
        string += len + plain.substring(plain.length - len, plain.length);
        if (result == null || string.length < result.length) result = string;
        else if (string.length == result.length && Math.random() < 0.5) result = string;
    }
    for (let offset = 1; offset <= 9; ++offset) {
        for (let len = 1; len <= 9; ++len) {
            let string = cur_state[offset][len];
            if (string == null) continue;
            string += len + "" + offset;
            if (result == null || string.length < result.length) result = string;
            else if (string.length == result.length && Math.random() < 0.5) result = string;
        }
    }
    return result ?? "";
}

function solveEncryptionICaesarCipher(data) {
    const cipher = [...data[0]]
        .map((a) => a === " " ? a : String.fromCharCode(((a.charCodeAt(0) - 65 - data[1] + 26) % 26) + 65))
        .join("");
    return cipher;
}

function solveEncryptionIIVigenereCipher(data) {
    const cipher = [...data[0]]
        .map((a, i) => a === " " ? a : String.fromCharCode(((a.charCodeAt(0) - 2 * 65 + data[1].charCodeAt(i % data[1].length)) % 26) + 65))
        .join("");
    return cipher;
}

function solveSquareRoot(n) {
    const two = BigInt(2);
    if (n < two) return n;
    let root = n / two;
    let x1 = (root + n / root) / two;
    while (x1 < root) { root = x1; x1 = (root + n / root) / two; }
    const bigAbs = (x) => (x < 0n ? -x : x);
    let absDiff = bigAbs(root * root - n);
    if (absDiff == 0n) return root;
    else if (absDiff > bigAbs((root - 1n) * (root - 1n) - n)) root = root - 1n;
    else if (absDiff > bigAbs((root + 1n) * (root + 1n) - n)) root = root + 1n;
    absDiff = bigAbs(root * root - n);
    if (absDiff > bigAbs((root - 1n) * (root - 1n) - n) || absDiff > bigAbs((root + 1n) * (root + 1n) - n))
        throw new Error("Square Root did not converge");
    return root.toString();
}

function solveTotalNumberOfPrimes(data) {
    function simpleSieve(max) {
        const primes = [];
        const arr = Array(max);
        for (let i = 2; i * i <= max; i++) {
            if (!arr[i]) { for (let p = i * i; p <= max; p += i) arr[p] = 1; }
        }
        for (let i = 2; i <= max; i++) { if (!arr[i]) primes.push(i); }
        return primes;
    }
    let low = data[0];
    let high = data[1];
    if (low < 2) low = 2;
    let count = 0;
    const arr = Array(high - low + 1);
    const checks = simpleSieve(Math.ceil(Math.sqrt(high)));
    for (const i of checks) {
        const lim = Math.max(i, Math.ceil(low / i)) * i;
        for (let j = lim; j <= high; j += i) arr[j - low] = 1;
    }
    for (let a = 0; a <= high - low; a++) { if (!arr[a]) ++count; }
    return count;
}

function solveLargestRectangleInAMatrix(data) {
    const rows = data.length;
    const cols = data[0].length;
    const histograms = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let c = 0; c < cols; c++) {
        let count = 0;
        for (let r = 0; r < rows; r++) {
            if (data[r][c] == 0) count++;
            else count = 0;
            histograms[r][c] = count;
        }
    }
    let maxArea = 0;
    let maxL = 0, maxR = 0, maxU = 0, maxD = 0;
    for (let i = 0; i < histograms.length; i++) {
        const row = histograms[i];
        for (let j = 0; j < row.length; j++) {
            if (row[j] == 0) continue;
            let left = j, right = j;
            while (row[left - 1] >= row[j]) left--;
            while (row[right + 1] >= row[j]) right++;
            if ((right - left + 1) * row[j] > maxArea) {
                maxArea = (right - left + 1) * row[j];
                maxL = left; maxR = right;
                maxU = i - row[j] + 1; maxD = i;
            }
        }
    }
    return [[maxU, maxL], [maxD, maxR]];
}

// ─── Worker Message Handler ─────────────────────────────────────────────────────
// Receives: [solverFunctionName, dataJson, contractFile, hostname]
// Posts back: [answer, contractFile, hostname, contractType]
onmessage = (event) => {
    const [solverName, dataJson, contract, hostname] = event.data;
    try {
        const data = JSON.parse(dataJson, jsonReviver);
        const solver = eval(solverName);
        const answer = solver(data);
        postMessage([answer, contract, hostname, solverName]);
    } catch (err) {
        postMessage([null, contract, hostname, solverName]);
    }
};
`;
