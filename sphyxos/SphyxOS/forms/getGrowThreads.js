/** @param {NS} ns */
export function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(gthreads))

  const player = ns.getPlayer()
  const host = ns.getServer(ns.args[0])
  host.hackDifficulty = ns.args[2]
  host.moneyAvailable = ns.args[1]
  let gthreads = 0
  try {
    gthreads = ns.formulas.hacking.growThreads(host, player, host.moneyMax)
    return
  }
  catch {
    const server = host
    const targetMoney = host.moneyMax
    let startMoney = host.moneyAvailable
    const cores = 1
    const person = player
    /*
          if (!server.serverGrowth) {
            gthreads = Infinity
          }
      */
    const moneyMax = server.moneyMax ?? 1;
    const hackDifficulty = server.hackDifficulty ?? 100;

    if (startMoney < 0) startMoney = 0; // servers "can't" have less than 0 dollars on them
    if (targetMoney > moneyMax) targetMoney = moneyMax; // can't grow a server to more than its moneyMax
    if (targetMoney <= startMoney) {
      gthreads = 0; // no growth --> no threads
      return
    }
    // exponential base adjusted by security
    const adjGrowthRate = 1 + (1.03 - 1) / hackDifficulty;
    const exponentialBase = Math.min(adjGrowthRate, 1.0035); // cap growth rate

    // total of all grow thread multipliers
    const serverGrowthPercentage = server.serverGrowth / 100.0;
    const coreMultiplier = 1 + (cores - 1) / 16
    let threadMultiplier = 0
    try {
      /** @type {BitNodeMultipliers} mults */
      const mults = ns.getBitNodeMultipliers()
      threadMultiplier = serverGrowthPercentage * person.mults.hacking_grow * coreMultiplier * mults.ServerGrowthRate
    }
    catch { threadMultiplier = serverGrowthPercentage * person.mults.hacking_grow * coreMultiplier }

    const x = threadMultiplier * Math.log(exponentialBase)
    const y = startMoney * x + Math.log(targetMoney * x)
    let w;
    if (y < Math.log(2.5)) {
      const ey = Math.exp(y);
      w = (ey + (4 / 3) * ey * ey) / (1 + (7 / 3) * ey + (5 / 6) * ey * ey);
    } else {
      w = y;
      if (y > 0) w -= Math.log(y);
    }
    let cycles = w / x - startMoney;
    let bt = exponentialBase ** threadMultiplier;
    if (bt == Infinity) bt = 1e300;
    let corr = Infinity;
    // Two sided error because we do not want to get stuck if the error stays on the wrong side
    do {
      // c should be above 0 so Halley's method can't be used, we have to stick to Newton-Raphson
      let bct = bt ** cycles;
      if (bct == Infinity) bct = 1e300;
      const opc = startMoney + cycles;
      let diff = opc * bct - targetMoney;
      if (diff == Infinity) diff = 1e300;
      corr = diff / (opc * x + 1.0) / bct;
      cycles -= corr;
    } while (Math.abs(corr) >= 1);

    const fca = Math.floor(cycles);
    if (targetMoney <= (startMoney + fca) * Math.pow(exponentialBase, fca * threadMultiplier)) {
      gthreads = fca;
      return
    }
    const cca = Math.ceil(cycles);
    if (targetMoney <= (startMoney + cca) * Math.pow(exponentialBase, cca * threadMultiplier)) {
      gthreads = cca;
      return
    }
    gthreads = cca + 1;
    return
  }
}