/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  let mults;
  try { mults = ns.getBitNodeMultipliers() }
  catch {
    const resetInfo = ns.getResetInfo()
    let record = {
      "AgilityLevelMultiplier": 1,
      "AugmentationMoneyCost": 1,
      "AugmentationRepCost": 1,
      "BladeburnerRank": 1,
      "BladeburnerSkillCost": 1,
      "CharismaLevelMultiplier": 1,
      "ClassGymExpGain": 1,
      "CodingContractMoney": 1,
      "CompanyWorkExpGain": 1,
      "CompanyWorkMoney": 1,
      "CompanyWorkRepGain": 1,
      "CorporationValuation": 1,
      "CrimeExpGain": 1,
      "CrimeMoney": 1,
      "CrimeSuccessRate": 1,
      "DaedalusAugsRequirement": 30,
      "DefenseLevelMultiplier": 1,
      "DexterityLevelMultiplier": 1,
      "FactionPassiveRepGain": 1,
      "FactionWorkExpGain": 1,
      "FactionWorkRepGain": 1,
      "FourSigmaMarketDataApiCost": 1,
      "FourSigmaMarketDataCost": 1,
      "GangSoftcap": 1,
      "GangUniqueAugs": 1,
      "GoPower": 1,
      "HackExpGain": 1,
      "HackingLevelMultiplier": 1,
      "HackingSpeedMultiplier": 1,
      "HacknetNodeMoney": 1,
      "HomeComputerRamCost": 1,
      "InfiltrationMoney": 1,
      "InfiltrationRep": 1,
      "ManualHackMoney": 1,
      "PurchasedServerCost": 1,
      "PurchasedServerSoftcap": 1,
      "PurchasedServerLimit": 1,
      "PurchasedServerMaxRam": 1,
      "FavorToDonateToFaction": 1, //New
      "RepToDonateToFaction": 1, //Old
      "ScriptHackMoney": 1,
      "ScriptHackMoneyGain": 1,
      "ServerGrowthRate": 1,
      "ServerMaxMoney": 1,
      "ServerStartingMoney": 1,
      "ServerStartingSecurity": 1,
      "ServerWeakenRate": 1,
      "StrengthLevelMultiplier": 1,
      "StaneksGiftPowerMultiplier": 1,
      "StaneksGiftExtraSize": 0,
      "WorldDaemonDifficulty": 1,
      "CorporationSoftcap": 1,
      "CorporationDivisions": 1
    }
    switch (resetInfo.currentNode) {
      case 1:
        break
      case 2:
        record.HackingLevelMultiplier = 0.8
        record.ServerGrowthRate = 0.8
        record.ServerStartingMoney = 0.4
        record.PurchasedServerSoftcap = 1.3
        record.CrimeMoney = 3
        record.FactionPassiveRepGain = 0
        record.FactionWorkRepGain = 0.5
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.9
        record.InfiltrationMoney = 3
        record.StaneksGiftPowerMultiplier = 2
        record.StaneksGiftExtraSize = -6
        record.WorldDaemonDifficulty = 5
        break
      case 3:
        record.HackingLevelMultiplier = 0.8
        record.ServerGrowthRate = 0.2
        record.ServerMaxMoney = 0.04
        record.ServerStartingMoney = 0.2
        record.HomeComputerRamCost = 1.5
        record.PurchasedServerCost = 2
        record.PurchasedServerSoftcap = 1.3
        record.CompanyWorkMoney = 0.25
        record.CrimeMoney = 0.25
        record.HacknetNodeMoney = 0.25
        record.ScriptHackMoney = 0.2
        record.FavorToDonateToFaction = 0.5 //New
        record.RepToDonateToFaction = 0.5 //Old
        record.AugmentationMoneyCost = 3
        record.AugmentationRepCost = 3
        record.GangSoftcap = 0.9
        record.GangUniqueAugs = 0.5
        record.StaneksGiftPowerMultiplier = 0.75
        record.StaneksGiftExtraSize = -2
        record.WorldDaemonDifficulty = 2
        break
      case 4:
        record.ServerMaxMoney = 0.1125
        record.ServerStartingMoney = 0.75
        record.PurchasedServerSoftcap = 1.2
        record.CompanyWorkMoney = 0.1
        record.CrimeMoney = 0.2
        record.HacknetNodeMoney = 0.05
        record.ScriptHackMoney = 0.2
        record.ClassGymExpGain = 0.5
        record.CompanyWorkExpGain = 0.5
        record.CrimeExpGain = 0.5
        record.FactionWorkExpGain = 0.5
        record.HackExpGain = 0.4
        record.FactionWorkRepGain = 0.75
        record.GangUniqueAugs = 0.5
        record.StaneksGiftPowerMultiplier = 1.5
        record.StaneksGiftExtraSize = 0
        record.WorldDaemonDifficulty = 3
        break
      case 5:
        record.ServerStartingSecurity = 2
        record.ServerStartingMoney = 0.5
        record.PurchasedServerSoftcap = 1.2
        record.CrimeMoney = 0.5
        record.HacknetNodeMoney = 0.2
        record.ScriptHackMoney = 0.15
        record.HackExpGain = 0.5
        record.AugmentationMoneyCost = 2
        record.InfiltrationMoney = 1.5
        record.InfiltrationRep = 1.5
        record.CorporationValuation = 0.75
        record.CorporationDivisions = 0.75
        record.GangUniqueAugs = 0.5
        record.StaneksGiftPowerMultiplier = 1.3
        record.StaneksGiftExtraSize = 0
        record.WorldDaemonDifficulty = 1.5
        break
      case 6:
        record.HackingLevelMultiplier = 0.35
        record.ServerMaxMoney = 0.2
        record.ServerStartingMoney = 0.5
        record.ServerStartingSecurity = 1.5
        record.PurchasedServerSoftcap = 2
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 0.75
        record.HacknetNodeMoney = 0.2
        record.ScriptHackMoney = 0.75
        record.HackExpGain = 0.25
        record.InfiltrationMoney = 0.75
        record.CorporationValuation = 0.2
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.8
        record.GangSoftcap = 0.7
        record.GangUniqueAugs = 0.2
        record.DaedalusAugsRequirement = 35
        record.StaneksGiftPowerMultiplier = 0.5
        record.StaneksGiftExtraSize = 2
        record.WorldDaemonDifficulty = 2
        break
      case 7:
        record.HackingLevelMultiplier = 0.35
        record.ServerMaxMoney = 0.2
        record.ServerStartingMoney = 0.5
        record.ServerStartingSecurity = 1.5
        record.PurchasedServerSoftcap = 2
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 0.75
        record.HacknetNodeMoney = 0.2
        record.ScriptHackMoney = 0.5
        record.HackExpGain = 0.25
        record.AugmentationMoneyCost = 3
        record.InfiltrationMoney = 0.75
        record.FourSigmaMarketDataCost = 2
        record.FourSigmaMarketDataApiCost = 2
        record.CorporationValuation = 0.2
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.8
        record.BladeburnerRank = 0.6
        record.BladeburnerSkillCost = 2
        record.GangSoftcap = 0.7
        record.GangUniqueAugs = 0.2
        record.DaedalusAugsRequirement = 35
        record.StaneksGiftPowerMultiplier = 0.9
        record.StaneksGiftExtraSize = -1
        record.WorldDaemonDifficulty = 2
        break
      case 8:
        record.PurchasedServerSoftcap = 4
        record.CompanyWorkMoney = 0
        record.CrimeMoney = 0
        record.HacknetNodeMoney = 0
        record.ManualHackMoney = 0
        record.ScriptHackMoney = 0.3
        record.ScriptHackMoneyGain = 0
        record.CodingContractMoney = 0
        record.FavorToDonateToFaction = 0 //New
        record.RepToDonateToFaction = 0 //Old
        record.InfiltrationMoney = 0
        record.CorporationValuation = 0
        record.CorporationSoftcap = 0
        record.CorporationDivisions = 0
        record.BladeburnerRank = 0
        record.GangSoftcap = 0
        record.GangUniqueAugs = 0
        record.StaneksGiftExtraSize = -99
        break
      case 9:
        record.HackingLevelMultiplier = 0.5
        record.StrengthLevelMultiplier = 0.45
        record.DefenseLevelMultiplier = 0.45
        record.DexterityLevelMultiplier = 0.45
        record.AgilityLevelMultiplier = 0.45
        record.CharismaLevelMultiplier = 0.45
        record.ServerMaxMoney = 0.01
        record.ServerStartingMoney = 0.1
        record.ServerStartingSecurity = 2.5
        record.HomeComputerRamCost = 5
        record.PurchasedServerLimit = 0
        record.CrimeMoney = 0.5
        record.ScriptHackMoney = 0.1
        record.HackExpGain = 0.05
        record.FourSigmaMarketDataCost = 5
        record.FourSigmaMarketDataApiCost = 4
        record.CorporationValuation = 0.5
        record.CorporationSoftcap = 0.75
        record.CorporationDivisions = 0.8
        record.BladeburnerRank = 0.9
        record.BladeburnerSkillCost = 1.2
        record.GangSoftcap = 0.8
        record.GangUniqueAugs = 0.25
        record.StaneksGiftPowerMultiplier = 0.5
        record.StaneksGiftExtraSize = 2
        record.WorldDaemonDifficulty = 2
        break
      case 10:
        record.HackingLevelMultiplier = 0.35
        record.StrengthLevelMultiplier = 0.4
        record.DefenseLevelMultiplier = 0.4
        record.DexterityLevelMultiplier = 0.4
        record.AgilityLevelMultiplier = 0.4
        record.CharismaLevelMultiplier = 0.4
        record.HomeComputerRamCost = 1.5
        record.PurchasedServerCost = 5
        record.PurchasedServerSoftcap = 1.1
        record.PurchasedServerLimit = 0.6
        record.PurchasedServerMaxRam = 0.5
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 0.5
        record.HacknetNodeMoney = 0.5
        record.ManualHackMoney = 0.5
        record.ScriptHackMoney = 0.5
        record.CodingContractMoney = 0.5
        record.AugmentationMoneyCost = 5
        record.AugmentationRepCost = 2
        record.InfiltrationMoney = 0.5
        record.CorporationValuation = 0.5
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.9
        record.BladeburnerRank = 0.8
        record.GangSoftcap = 0.9
        record.GangUniqueAugs = 0.25
        record.StaneksGiftPowerMultiplier = 0.75
        record.StaneksGiftExtraSize = -3
        record.WorldDaemonDifficulty = 2
        break
      case 11:
        record.HackingLevelMultiplier = 0.6
        record.ServerGrowthRate = 0.2
        record.ServerMaxMoney = 0.01
        record.ServerStartingMoney = 0.1
        record.ServerWeakenRate = 2
        record.PurchasedServerSoftcap = 2
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 3
        record.HacknetNodeMoney = 0.1
        record.CodingContractMoney = 0.25
        record.HackExpGain = 0.5
        record.AugmentationMoneyCost = 2
        record.InfiltrationMoney = 2.5
        record.InfiltrationRep = 2.5
        record.FourSigmaMarketDataCost = 4
        record.FourSigmaMarketDataApiCost = 4
        record.CorporationValuation = 0.1
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.9
        record.GangUniqueAugs = 0.75
        record.WorldDaemonDifficulty = 1.5
        break
      case 12:
        const sourceFiles = []
        for (const item of ns.getResetInfo().ownedSF) {
          const record = {
            "n": item[0],
            "lvl": item[1]
          }
          sourceFiles.push(record)
        }
        let SF12LVL = 1
        for (const sf of sourceFiles) {
          if (sf.n === 12) {
            SF12LVL = sf.lvl + 1
            break
          }
        }
        const inc = Math.pow(1.02, SF12LVL)
        const dec = 1 / inc

        record.DaedalusAugsRequirement = Math.floor(Math.min(record.DaedalusAugsRequirement + inc, 40))
        record.HackingLevelMultiplier = dec
        record.StrengthLevelMultiplier = dec
        record.DefenseLevelMultiplier = dec
        record.DexterityLevelMultiplier = dec
        record.AgilityLevelMultiplier = dec
        record.CharismaLevelMultiplier = dec
        record.ServerGrowthRate = dec
        record.ServerMaxMoney = dec * dec
        record.ServerStartingMoney = dec
        record.ServerWeakenRate = dec
        record.ServerStartingSecurity = 1.5
        record.HomeComputerRamCost = inc
        record.PurchasedServerCost = inc
        record.PurchasedServerSoftcap = inc
        record.PurchasedServerLimit = dec
        record.PurchasedServerMaxRam = dec
        record.CompanyWorkMoney = dec
        record.CrimeMoney = dec
        record.HacknetNodeMoney = dec
        record.ManualHackMoney = dec
        record.ScriptHackMoney = dec
        record.CodingContractMoney = dec
        record.ClassGymExpGain = dec
        record.CompanyWorkExpGain = dec
        record.CrimeExpGain = dec
        record.FactionWorkExpGain = dec
        record.HackExpGain = dec
        record.FactionPassiveRepGain = dec
        record.FactionWorkRepGain = dec
        record.FavorToDonateToFaction = inc
        record.AugmentationMoneyCost = inc
        record.AugmentationRepCost = inc
        record.InfiltrationMoney = dec
        record.InfiltrationRep = dec
        record.FourSigmaMarketDataCost = inc
        record.FourSigmaMarketDataApiCost = inc
        record.CorporationValuation = dec
        record.CorporationSoftcap = 0.8
        record.CorporationDivisions = 0.5
        record.BladeburnerRank = dec
        record.BladeburnerSkillCost = inc
        record.GangSoftcap = 0.8
        record.GangUniqueAugs = dec
        record.StaneksGiftPowerMultiplier = inc
        record.StaneksGiftExtraSize = inc
        record.WorldDaemonDifficulty = inc
        break
      case 13:
        record.HackingLevelMultiplier = 0.25
        record.StrengthLevelMultiplier = 0.7
        record.DefenseLevelMultiplier = 0.7
        record.DexterityLevelMultiplier = 0.7
        record.AgilityLevelMultiplier = 0.7
        record.PurchasedServerSoftcap = 1.6
        record.ServerMaxMoney = 0.3375
        record.ServerStartingMoney = 0.75
        record.ServerStartingSecurity = 3
        record.CompanyWorkMoney = 0.4
        record.CrimeMoney = 0.4
        record.HacknetNodeMoney = 0.4
        record.ScriptHackMoney = 0.2
        record.CodingContractMoney = 0.4
        record.ClassGymExpGain = 0.5
        record.CompanyWorkExpGain = 0.5
        record.CrimeExpGain = 0.5
        record.FactionWorkExpGain = 0.5
        record.HackExpGain = 0.1
        record.FactionWorkRepGain = 0.6
        record.FourSigmaMarketDataCost = 10
        record.FourSigmaMarketDataApiCost = 10
        record.CorporationValuation = 0.001
        record.CorporationSoftcap = 0.4
        record.CorporationDivisions = 0.4
        record.BladeburnerRank = 0.45
        record.BladeburnerSkillCost = 2
        record.GangSoftcap = 0.3
        record.GangUniqueAugs = 0.1
        record.StaneksGiftPowerMultiplier = 2
        record.StaneksGiftExtraSize = 1
        record.WorldDaemonDifficulty = 3
        break
      case 14:
        record.GoPower = 4
        record.HackingLevelMultiplier = 0.4
        record.HackingSpeedMultiplier = 0.3
        record.ServerMaxMoney = 0.7
        record.ServerStartingMoney = 0.5
        record.ServerStartingSecurity = 1.5
        record.CrimeMoney = 0.75
        record.CrimeSuccessRate = 0.4
        record.HacknetNodeMoney = 0.25
        record.ScriptHackMoney = 0.3
        record.StrengthLevelMultiplier = 0.5
        record.DexterityLevelMultiplier = 0.5
        record.AgilityLevelMultiplier = 0.5
        record.AugmentationMoneyCost = 1.5
        record.InfiltrationMoney = 0.75
        record.FactionWorkRepGain = 0.2
        record.CompanyWorkRepGain = 0.2
        record.CorporationValuation = 0.4
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.8
        record.BladeburnerRank = 0.6
        record.BladeburnerSkillCost = 2
        record.GangSoftcap = 0.7
        record.GangUniqueAugs = 0.4
        record.StaneksGiftPowerMultiplier = 0.5
        record.StaneksGiftExtraSize = -1
        record.WorldDaemonDifficulty = 5
        break
    }
    mults = record
  }
  ns.atExit(() => port.write(mults))
}
