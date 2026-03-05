/** @param {NS} ns */
export async function main(ns) {
  let result = 0
  try {
    ns.singularity.purchaseTor()
    result = 1
  }
  catch {}
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(result))
}

function dummy() { //for ram.  try/catch doesn't always calculate it
  ns.singularity.purchaseTor()
}