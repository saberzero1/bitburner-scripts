/** @param {NS} ns */
export async function main(ns) {
  let port = ns.getPortHandle(ns.pid)
  const results = await ns.go.cheat.playTwoMoves(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])
  ns.atExit(() => port.write(results))
}