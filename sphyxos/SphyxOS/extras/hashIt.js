/** @param {NS} ns */
export async function main(ns) {
  //arg[0] is Type; money, corp, min, max, study, train, research, bbrank, bbsp, coding, favor, 
  //Target needs to be determined.  peek(3) for current hacking target
  //Will need to figure out Target for company favor - working for should do it but it's singularity
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(1))
  
  const hackTarget = ns.peek(3)
  switch (ns.args[0]) {
    case "money":
      while (ns.hacknet.spendHashes("Sell for Money", "home")) { }
      break;
    case "corp":
      while (ns.hacknet.spendHashes("Sell for Corporation Funds", "home")) { }
      break;
    case "min":
      if (hackTarget === "NULL PORT DATA") return
      if (ns.getServerMinSecurityLevel(hackTarget) === 1) break
      while (ns.hacknet.spendHashes("Reduce Minimum Security", hackTarget)) { if (ns.getServerMinSecurityLevel(hackTarget) === 1) break }
      break;
    case "max":
      if (hackTarget === "NULL PORT DATA") return
      while (ns.hacknet.spendHashes("Increase Maximum Money", hackTarget)) { }
      break;
    case "study":
      while (ns.hacknet.spendHashes("Improve Studying")) { }
      break;
    case "train":
      while (ns.hacknet.spendHashes("Improve Gym Training")) { }
      break;
    case "research":
      while (ns.hacknet.spendHashes("Exchange for Corporation Research", "home")) { }
      break;
    case "bbrank":
      while (ns.hacknet.spendHashes("Exchange for Bladeburner Rank")) { }
      break;
    case "bbsp":
      while (ns.hacknet.spendHashes("Exchange for Bladeburner SP")) { }
      break;
    case "coding":
      while (ns.hacknet.spendHashes("Generate Coding Contract", "home")) { }
      break;
    case "favor":
      let favorTarget = "home"
      try { favorTarget = ns.singularity.getCurrentWork().companyName } catch { return }
      if (favorTarget) while (ns.hacknet.spendHashes("Company Favor", favorTarget)) { }
      break;
    default:
      break;
  }
}