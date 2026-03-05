/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  const test = ns.singularity.stopAction()
  ns.atExit(() => port.write(test))
}