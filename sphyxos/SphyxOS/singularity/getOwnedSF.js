/** @param {NS} ns */
export async function main(ns) {
  const collection = []
  try {
    for (const item of ns.getResetInfo().ownedSF) {
      const record = {
        "n": item[0],
        "lvl": item[1]
      }
      collection.push(record)
    }
  }
  catch {}
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(collection))
}