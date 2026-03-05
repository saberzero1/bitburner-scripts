/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  let result = false
  ns.atExit(() => port.write(result))

  for (let member of ns.gang.getMemberNames()) {
    const memberAscensionResult = ns.gang.getAscensionResult(member)
    if (memberAscensionResult !== undefined) {
      const ascendRequirement = calculateAscendTreshold(ns, member)
      const memberAscensionResultMultiplier = (memberAscensionResult.agi + memberAscensionResult.def + memberAscensionResult.dex + memberAscensionResult.str) / 4
      if ((memberAscensionResultMultiplier > ascendRequirement || ns.args[0])) {
        ns.gang.ascendMember(member)
        result = true
      }
    }
  }
}
/** @param {NS} ns */
function calculateAscendTreshold(ns, soldier) {
  const member = ns.gang.getMemberInformation(soldier)
  const mult = (member.agi_asc_mult + member.def_asc_mult + member.dex_asc_mult + member.str_asc_mult) / 4
  if (mult < 1.632) return 1.6326
  if (mult < 2.336) return 1.4315
  if (mult < 2.999) return 1.284
  if (mult < 3.363) return 1.2125
  if (mult < 4.253) return 1.1698
  if (mult < 4.860) return 1.1428
  if (mult < 5.455) return 1.1225
  if (mult < 5.977) return 1.0957
  if (mult < 6.496) return 1.0869
  if (mult < 7.008) return 1.0789
  if (mult < 7.519) return 1.073
  if (mult < 8.025) return 1.0673
  if (mult < 8.513) return 1.0631
  if (mult < 20) return 1.0591
  return 1.04
}
