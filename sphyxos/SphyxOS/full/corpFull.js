const corpName = "Sphyx-Corp"
const div1 = "Family Farm" //Agriculture
const div2 = "The Bog Pit" //Chemical
const div3 = "Ciggy\'s r Us" //Tobacco
const div4 = "Bob\'s Burgers" //Restaurant
const div5 = "Brawndo" //Water Utilities
const div6 = "Fabrikator" //Computer Hardware
const div7 = "The Furnace" //Refinery
const div8 = "Diggers Inc." //Mining

const round1Money = 440e9 //b
const round2Money = 8.8e12 //t
const round3Money = 12e15 //q
let tobaccoBooster = false
const round4Money = 500e18 //Q
const ta2DB = [] //TA2 DB
const indDataDB = []
const matDataDB = []
let researchedDB = []
let hasDivDB = []
let hasOfficeDB = []
let hasWarehouseDB = []
let roundTrigger = false
let bnMults
let oldRound
let teaNeeded
let investOffer
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  ns.ui.openTail()
  ns.clearLog()
  hasDivDB = []
  researchedDB = []
  hasOfficeDB = []
  hasWarehouseDB = []
  const c = ns.corporation
  const myBN = currentBN(ns)
  bnMults = getBNMults(ns)
  const selfFund = myBN === 3 ? false : true
  while (!c.hasCorporation() && c.canCreateCorporation(selfFund) && !c.createCorporation(corpName, selfFund)) await ns.sleep(1000)

  let round = c.getInvestmentOffer().round
  teaNeeded = true
  oldRound = 0
  tobaccoBooster = false
  while (round === 1) {
    prep(ns)
    updateHud(ns)
    if (c.getDivision(div1).numAdVerts < 2)
      while (c.getDivision(div1).numAdVerts < 2) c.hireAdVert(div1)
    const nState = c.getCorporation().nextState
    if (nState === "SALE")
      sell(ns)
    if (nState === "PURCHASE") {

      if (!teaNeeded && c.getOffice(div1, "Sector-12").employeeJobs.Business > 0) {
        optimizeMats(ns)
      }
      purchase(ns)
    }
    if (nState === "START") {
      teaNeeded = teaParty(ns)
      round = checkInvest(ns)
    }
    if (nState === "EXPORT") {
      manageOffice(ns)
      warehouseUpgrade(ns)
    }
    try { c.levelUpgrade("ABC SalesBots") } catch { }
    await ns.corporation.nextUpdate()
  }
  while (round === 2) {
    prep(ns)
    updateHud(ns)
    let hasDiv2 = false
    //Set up Tobacco    
    let count = 0
    if (researchedDB["Export"])
      for (const city of cities)
        if (hasWarehouseDB[div2 + city]) count++
    if (count === 6)
      hasDiv2 = true
    while (hasDiv2 && c.getUpgradeLevel("Smart Factories") < 16 && c.getUpgradeLevelCost("Smart Factories") <= corpFunds(ns))
      c.levelUpgrade("Smart Factories")
    const nState = c.getCorporation().nextState
    if (nState === "SALE")
      sell(ns)
    if (nState === "PURCHASE") {
      basicExporImport(ns)
      purchase(ns)
      while (corpFunds(ns) > c.getHireAdVertCost(div1) && c.getHireAdVertCount(div1) < 12 && hasDiv2)
        try {
          c.hireAdVert(div1)
        } catch { }
      if (c.getHireAdVertCount(div1) < 11 && c.getMaterial(div1, "Sector-12", "Plants").stored > 200)
        try {
          c.hireAdVert(div1)
        } catch { }
      else if (hasDiv2 && c.getMaterial(div1, "Sector-12", "Plants").stored > 200)
        try {
          c.hireAdVert(div1)
        } catch { }
      if (ns.ui.getGameInfo()?.versionNumber === undefined) {
        if (!teaNeeded && c.getOffice(div1, "Sector-12").employeeJobs.Business > 0 && c.getUpgradeLevel("DreamSense") === 0)
          try { c.levelUpgrade("DreamSense") }
          catch { }
      }

    }
    if (nState === "START") {
      teaNeeded = teaParty(ns)
      round = checkInvest(ns)
    }
    if (nState === "EXPORT") {
      manageOffice(ns)
      warehouseUpgrade(ns)
      if (!teaNeeded && c.getOffice(div1, "Sector-12").employeeJobs.Business > 0) {

        while (hasDiv2 && corpFunds(ns) >= c.getUpgradeLevelCost("ABC SalesBots") && c.getUpgradeLevel("ABC SalesBots") < 30)
          c.levelUpgrade("ABC SalesBots")
        optimizeMats(ns)
      }
      while (corpFunds(ns) >= c.getUpgradeLevelCost("ABC SalesBots") && c.getUpgradeLevel("ABC SalesBots") < 10)
        c.levelUpgrade("ABC SalesBots")
    }
    await ns.corporation.nextUpdate()
  }
  while (round === 3 || round === 4) {
    prep(ns)
    updateHud(ns)
    while (c.getUpgradeLevel("Smart Factories") < 20 && c.getUpgradeLevelCost("Smart Factories") <= corpFunds(ns))
      c.levelUpgrade("Smart Factories")
    manageProducts(ns)
    spendRP(ns)
    const nState = c.getCorporation().nextState
    if (nState === "SALE")
      sell(ns)
    if (nState === "PURCHASE") {
      basicExporImport(ns)
      purchase(ns)
      if (c.getMaterial(div1, "Sector-12", "Plants").stored > 200)
        try {
          c.hireAdVert(div1)
        } catch { }
      if (ns.ui.getGameInfo()?.versionNumber === undefined) {
        if (!teaNeeded && c.getOffice(div1, "Sector-12").employeeJobs.Business > 0 && c.getUpgradeLevel("DreamSense") === 0)
          try { c.levelUpgrade("DreamSense") }
          catch { }
      }
    }
    if (nState === "START") {
      teaNeeded = teaParty(ns)
      round = checkInvest(ns)
    }
    if (nState === "EXPORT") {
      updateMisc(ns)
      manageOffice(ns)
      warehouseUpgrade(ns)
      optimizeMats(ns)
    }

    await ns.corporation.nextUpdate()
  }
  while (round === 5) {
    prep(ns)
    updateHud(ns)
    manageProducts(ns)
    spendRP(ns)
    const nState = c.getCorporation().nextState
    if (nState === "SALE")
      sell(ns)
    if (nState === "PURCHASE") {
      updateMisc(ns)
      basicExporImport(ns)
      purchase(ns)
    }
    if (nState === "START") {
      manageOffice(ns)
      teaNeeded = teaParty(ns)
    }
    if (nState === "EXPORT") {
      warehouseUpgrade(ns)
      optimizeMats(ns)
    }
    await ns.corporation.nextUpdate()
  }
}
/** @param {NS} ns */
function checkInvest(ns) {
  const c = ns.corporation
  const round = investOffer.round
  const corp = c.getCorporation()

  if (round === 1) {
    if (round1Money * bnMults.CorporationValuation < investOffer.funds + (corp.funds * bnMults.CorporationValuation) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + (corp.funds * bnMults.CorporationValuation)) {
        oldRound = investOffer.funds + (corp.funds * bnMults.CorporationValuation)
      }
      else {
        c.acceptInvestmentOffer()
        teaNeeded = true
        roundTrigger = false
        ns.tprintf("Off to round 2!")
        return 2
      }
    }
    return 1
  }
  if (round === 2) {
    let hasDiv2 = false
    //Set up Tobacco    
    let count = 0
    if (researchedDB["Export"])
      for (const city of cities)
        if (hasWarehouseDB[div2 + city]) count++
    if (count === 6)
      hasDiv2 = true
    if ((hasDiv2 && investOffer.funds + corp.funds > 30e9 && round2Money * bnMults.CorporationValuation < investOffer.funds + corp.funds) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + (Math.min(30e9, corp.funds))) {
        oldRound = investOffer.funds + (Math.min(30e9, corp.funds))
      }
      else {
        c.acceptInvestmentOffer()
        teaNeeded = true
        roundTrigger = false
        ns.tprintf("Off to round 3!")
        return 3
      }
    }
    return 2
  }
  if (round === 3) {
    if (round3Money * bnMults.CorporationValuation < (investOffer.funds * 4) + (corp.funds * bnMults.CorporationValuation)) {
      tobaccoBooster = true
    }
    if ((round3Money * bnMults.CorporationValuation < investOffer.funds + (corp.funds * bnMults.CorporationValuation)) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + (corp.funds * bnMults.CorporationValuation)) {
        oldRound = investOffer.funds + (corp.funds * bnMults.CorporationValuation)
      }
      else {
        c.acceptInvestmentOffer()
        teaNeeded = true
        roundTrigger = false
        tobaccoBooster = false
        ns.tprintf("Off to round 4!")
        return 4
      }
    }
    return 3
  }
  if (round === 4) {
    if (round4Money * bnMults.CorporationValuation < (investOffer.funds * 4) + (corp.funds * bnMults.CorporationValuation)) {
      tobaccoBooster = true
    }
    if ((round4Money * bnMults.CorporationValuation < investOffer.funds + (corp.funds * bnMults.CorporationValuation)) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + (corp.funds * bnMults.CorporationValuation)) {
        oldRound = investOffer.funds + (corp.funds * bnMults.CorporationValuation)
      }
      else {
        c.acceptInvestmentOffer()
        teaNeeded = true
        roundTrigger = false
        ns.tprintf("Off to round 5!")
        return 5
      }
    }
    return 4
  }
}
/** @param {NS} ns */
function corpFunds(ns) {
  const corp = ns.corporation.getCorporation()
  return corp.funds
}
/** @param {NS} ns */
function prep(ns) {
  const c = ns.corporation
  investOffer = c.getInvestmentOffer()
  const round = investOffer.round
  if (round >= 1) {
    if (!hasDivDB[div1]) {
      try {
        const div = c.getDivision(div1)
        hasDivDB[div1] = div
      }
      catch {
        try { c.expandIndustry("Agriculture", div1) } catch { }
        try {
          const div = c.getDivision(div1)
          hasDivDB[div1] = div
        }
        catch { }
      }
    }
    for (const city of cities) {
      if (!hasOfficeDB[div1 + city]) {
        try { c.expandCity(div1, city) } catch { }
        try {
          c.getOffice(div1, city)
          hasOfficeDB[div1 + city] = true
        }
        catch { }
      }
      if (!hasWarehouseDB[div1 + city]) {
        try { c.purchaseWarehouse(div1, city) } catch { }
        if (c.hasWarehouse(div1, city))
          hasWarehouseDB[div1 + city] = true
      }
    }
  }
  if (round >= 2) {
    if (!researchedDB["Export"]) {
      try { c.purchaseUnlock("Export") } catch { }
      if (c.hasUnlock("Export")) researchedDB["Export"] = true
    }
    if (researchedDB["Export"]) {
      if (!hasDivDB[div2]) {
        try {
          const div = c.getDivision(div2)
          hasDivDB[div2] = div
        }
        catch {
          try { c.expandIndustry("Chemical", div2) } catch { }
          try {
            const div = c.getDivision(div2)
            hasDivDB[div2] = div
          }
          catch { }
        }
      }
      if (hasDivDB[div2]) {
        for (const city of cities) {
          if (!hasOfficeDB[div2 + city]) {
            try { c.expandCity(div2, city) } catch { }
            try {
              c.getOffice(div2, city)
              hasOfficeDB[div2 + city] = true
            }
            catch { }
          }
          if (!hasWarehouseDB[div2 + city]) {
            try { c.purchaseWarehouse(div2, city) } catch { }
            if (c.hasWarehouse(div2, city))
              hasWarehouseDB[div2 + city] = true
          }
        }
      }
    }
  }
  if (round >= 3) {
    if (!researchedDB["Market Research - Demand"]) {
      try { c.purchaseUnlock("Market Research - Demand") } catch { }
      if (c.hasUnlock("Market Research - Demand"))
        researchedDB["Market Research - Demand"] = true
    }
    if (!researchedDB["Market Data - Competition"]) {
      try { c.purchaseUnlock("Market Data - Competition") } catch { }
      if (c.hasUnlock("Market Data - Competition"))
        researchedDB["Market Data - Competition"] = true
    }
    if (!hasDivDB[div3] && researchedDB["Market Research - Demand"] && researchedDB["Market Data - Competition"]) {
      try {
        const div = c.getDivision(div3)
        hasDivDB[div3] = div
      }
      catch {
        try { c.expandIndustry("Tobacco", div3) } catch { }
        try {
          const div = c.getDivision(div3)
          hasDivDB[div3] = div
        }
        catch { }
      }
    }
    if (hasDivDB[div3]) {
      for (const city of cities) {
        if (!hasOfficeDB[div3 + city]) {
          try { c.expandCity(div3, city) } catch { }
          try {
            c.getOffice(div3, city)
            hasOfficeDB[div3 + city] = true
          }
          catch { }
        }
        if (!hasWarehouseDB[div3 + city]) {
          try { c.purchaseWarehouse(div3, city) } catch { }
          if (c.hasWarehouse(div3, city))
            hasWarehouseDB[div3 + city] = true

        }
      }
    }
  }
  if (round >= 5) {
    try {
      const div = c.getDivision(div4)
      hasDivDB[div4] = div
    }
    catch {
      try { c.expandIndustry("Restaurant", div4) } catch { }
      try {
        const div = c.getDivision(div4)
        hasDivDB[div4] = div
      }
      catch { }
    }
    for (const city of cities) {
      if (!hasOfficeDB[div4 + city]) {
        try { c.expandCity(div4, city) } catch { }
        try {
          c.getOffice(div4, city)
          hasOfficeDB[div4 + city] = true
        }
        catch { }
      }
      if (!hasWarehouseDB[div4 + city]) {
        try { c.purchaseWarehouse(div4, city) } catch { }
        if (c.hasWarehouse(div4, city))
          hasWarehouseDB[div4 + city] = true
      }
    }
    if (c.getCorporation().revenue >= 1e70) {
      if (!researchedDB["Government Partnership"]) {
        try { c.purchaseUnlock("Government Partnership") } catch { }
        if (c.hasUnlock("Government Partnership"))
          researchedDB["Government Partnership"] = true
      }
      if (!researchedDB["Shady Accounting"]) {
        try { c.purchaseUnlock("Shady Accounting") } catch { }
        if (c.hasUnlock("Shady Accounting"))
          researchedDB["Shady Accounting"] = true
      }
      if (!c.getCorporation().public) c.goPublic(0)
      c.issueDividends(0.01)

      try {
        const div = c.getDivision(div5)
        hasDivDB[div5] = div
      }
      catch {
        try { c.expandIndustry("Water Utilities", div5) } catch { }
        try {
          const div = c.getDivision(div5)
          hasDivDB[div5] = div
        }
        catch { }
      }
      try {
        const div = c.getDivision(div6)
        hasDivDB[div6] = div
      }
      catch {
        try { c.expandIndustry("Computer Hardware", div6) } catch { }
        try {
          const div = c.getDivision(div6)
          hasDivDB[div6] = div
        }
        catch { }
      }
      try {
        const div = c.getDivision(div7)
        hasDivDB[div7] = div
      }
      catch {
        try { c.expandIndustry("Refinery", div7) } catch { }
        try {
          const div = c.getDivision(div7)
          hasDivDB[div7] = div
        }
        catch { }
      }
      try {
        const div = c.getDivision(div8)
        hasDivDB[div8] = div
      }
      catch {
        try { c.expandIndustry("Mining", div8) } catch { }
        try {
          const div = c.getDivision(div8)
          hasDivDB[div8] = div
        }
        catch { }
      }
      for (const city of cities) {
        //Set up divs
        const divs = [div5, div6, div7, div8]
        for (const div of divs) {
          if (!hasOfficeDB[div + city]) {
            try { c.expandCity(div, city) } catch { }
            try {
              c.getOffice(div, city)
              hasOfficeDB[div + city] = true
            }
            catch { }
          }
          if (!hasWarehouseDB[div + city]) {
            try { c.purchaseWarehouse(div, city) } catch { }
            if (c.hasWarehouse(div, city))
              hasWarehouseDB[div + city] = true
          }
        }
      }
    }
  }
}
/** @param {NS} ns */
function updateMisc(ns) {
  const c = ns.corporation
  const round = investOffer.round
  let corp = c.getCorporation()
  const mult = round === 3 ? 3 : 2.5
  let hasDiv4 = false
  let hasDiv3 = false
  let div3Count = 0
  for (const city of cities)
    if (hasWarehouseDB[div3 + city])
      div3Count++
  if (div3Count === 6) hasDiv3 = true


  let div4Count = 0
  for (const city of cities)
    if (hasWarehouseDB[div4 + city])
      div4Count++
  if (div4Count === 6) hasDiv4 = true

  if (round === 3 && !hasDiv3) return
  if (round >= 3
    && c.getUpgradeLevelCost("Wilson Analytics") < corp.funds
    && (((round >= 5)
      && (hasDiv4
        && (c.getDivision(div4).awareness < Number.MAX_VALUE
          || c.getDivision(div4).popularity < Number.MAX_VALUE)))
      || (hasDiv3
        && (c.getDivision(div3).awareness < Number.MAX_VALUE
          || c.getDivision(div3).popularity < Number.MAX_VALUE)))) {
    c.levelUpgrade("Wilson Analytics")
    corp = c.getCorporation()
  }
  while ((round === 3)
    && c.getUpgradeLevelCost("Wilson Analytics") < corpFunds(ns)
    && c.getUpgradeLevel("Wilson Analytics") < 2) {
    c.levelUpgrade("Wilson Analytics")
    corp = c.getCorporation()
  }
  if (round < 5 && c.getUpgradeLevelCost("ABC SalesBots") * mult / 2 < corp.funds) {
    c.levelUpgrade("ABC SalesBots")
    corp = c.getCorporation()
  }
  while (round >= 5 && c.getUpgradeLevelCost("ABC SalesBots") * mult / 2 < corpFunds(ns)) c.levelUpgrade("ABC SalesBots")
  corp = c.getCorporation()
  if ((round === 3 && c.getCorporation().revenue >= 8e7) || round >= 4) {
    if (c.getUpgradeLevel("Neural Accelerators") < 500 && c.getUpgradeLevelCost("Neural Accelerators") * mult < corp.funds) {
      c.levelUpgrade("Neural Accelerators")
      corp = c.getCorporation()
    }
    if (c.getUpgradeLevel("Project Insight") < 500 && c.getUpgradeLevelCost("Project Insight") * mult < corp.funds) {
      c.levelUpgrade("Project Insight")
      corp = c.getCorporation()
    }
    if (c.getUpgradeLevel("Nuoptimal Nootropic Injector Implants") < 500 && c.getUpgradeLevelCost("Nuoptimal Nootropic Injector Implants") * mult < corp.funds) {
      c.levelUpgrade("Nuoptimal Nootropic Injector Implants")
      corp = c.getCorporation()
    }
    if (c.getUpgradeLevel("FocusWires") < 500 && c.getUpgradeLevelCost("FocusWires") * mult < corp.funds) {
      c.levelUpgrade("FocusWires")
      corp = c.getCorporation()
    }
    if (c.getUpgradeLevel("Speech Processor Implants") < 500 && c.getUpgradeLevelCost("Speech Processor Implants") * mult < corp.funds) {
      c.levelUpgrade("Speech Processor Implants")
      corp = c.getCorporation()
    }
  }

  if (round >= 3 && round <= 4) {
    for (const div of industries) {
      if (!hasDivDB[div]) continue
      if (["Tobacco", "Restaurant"].includes(hasDivDB[div].type)
        && corp.funds >= c.getHireAdVertCost(div) * mult / 2
        && (c.getDivision(div).awareness < Number.MAX_VALUE || c.getDivision(div).popularity < Number.MAX_VALUE)) {
        c.hireAdVert(div)
        corp = c.getCorporation()
      }
    }
  }
  if (round === 5) {
    for (const div of industries) {
      if (!hasDivDB[div]) continue
      while (["Tobacco", "Restaurant", "Computer Hardware"].includes(hasDivDB[div].type)
        && corpFunds(ns) >= c.getHireAdVertCost(div) * mult / 2
        && (c.getDivision(div).awareness < Number.MAX_VALUE || c.getDivision(div).popularity < Number.MAX_VALUE))
        c.hireAdVert(div)
    }
  }
}
/** @param {NS} ns */
function spendRP(ns) {
  const c = ns.corporation
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    switch (hasDivDB[div].type) {
      case "Mining":
      case "Refinery":
      case "Computer Hardware":
      case "Water Utilities":
      case "Chemical":
      case "Agriculture": {
        const rp = c.getDivision(div).researchPoints
        if (!researchedDB[div + "Hi-Tech R&D Laboratory"]) {
          if (rp / 2 > c.getResearchCost(div, "Hi-Tech R&D Laboratory")) {
            c.research(div, "Hi-Tech R&D Laboratory")
            researchedDB[div + "Hi-Tech R&D Laboratory"] = true
          }
          else break
        }
        if (!researchedDB[div + "Overclock"]) {
          if (rp / 10 > c.getResearchCost(div, "Overclock")) {
            c.research(div, "Overclock")
            researchedDB[div + "Overclock"] = true
          }
          else break
        }
        if (!researchedDB[div + "Sti.mu"]) {
          if (rp / 10 > c.getResearchCost(div, "Sti.mu")) {
            c.research(div, "Sti.mu")
            researchedDB[div + "Sti.mu"] = true
          }
          else break
        }
        if (!researchedDB[div + "Automatic Drug Administration"]) {
          if (rp / 10 > c.getResearchCost(div, "Automatic Drug Administration")) {
            c.research(div, "Automatic Drug Administration")
            researchedDB[div + "Automatic Drug Administration"] = true
          }
          else break
        }
        if (!researchedDB[div + "Go-Juice"]) {
          if (rp / 10 > c.getResearchCost(div, "Go-Juice")) {
            c.research(div, "Go-Juice")
            researchedDB[div + "Go-Juice"] = true
          }
          else break
        }
        if (!researchedDB[div + "CPH4 Injections"]) {
          if (rp / 10 > c.getResearchCost(div, "CPH4 Injections")) {
            c.research(div, "CPH4 Injections")
            researchedDB[div + "CPH4 Injections"] = true
          }
          else break
        }
      }
        break
      case "Restaurant":
      case "Tobacco": {
        const rp = c.getDivision(div).researchPoints
        if (!researchedDB[div + "Hi-Tech R&D Laboratory"]) {
          if (rp / 2 > c.getResearchCost(div, "Hi-Tech R&D Laboratory")) {
            c.research(div, "Hi-Tech R&D Laboratory")
            researchedDB[div + "Hi-Tech R&D Laboratory"] = true
          }
          else break
        }
        if (!researchedDB[div + "uPgrade: Fulcrum"]) {
          if (rp / 10 > c.getResearchCost(div, "uPgrade: Fulcrum")) {
            c.research(div, "uPgrade: Fulcrum")
            researchedDB[div + "uPgrade: Fulcrum"] = true
          }
          else break
          break
        }
        /*if (!researchedDB[div + "uPgrade: Capacity.I"]) {
          if (rp / 10 > c.getResearchCost(div, "uPgrade: Capacity.I")) {
            c.research(div, "uPgrade: Capacity.I")
            researchedDB[div + "uPgrade: Capacity.I"] = true
          }
          else break
          break
        }
        if (!researchedDB[div + "uPgrade: Capacity.II"]) {
          if (rp / 10 > c.getResearchCost(div, "uPgrade: Capacity.II")) {
            c.research(div, "uPgrade: Capacity.II")
            researchedDB[div + "uPgrade: Capacity.II"] = true
          }
          else break
          break
        }
        */
        if (!researchedDB[div + "Self-Correcting Assemblers"]) {
          if (rp / 10 > c.getResearchCost(div, "Self-Correcting Assemblers")) {
            c.research(div, "Self-Correcting Assemblers")
            researchedDB[div + "Self-Correcting Assemblers"] = true
          }
          else break
          break
        }
        if (!researchedDB[div + "Drones"]) {
          if (rp / 10 > c.getResearchCost(div, "Drones")) {
            c.research(div, "Drones")
            researchedDB[div + "Drones"] = true
          }
          else break
          break
        }
        if (!researchedDB[div + "Drones - Assembly"]) {
          if (rp / 10 > c.getResearchCost(div, "Drones - Assembly")) {
            c.research(div, "Drones - Assembly")
            researchedDB[div + "Drones - Assembly"] = false
          }
          else break
          break
        }
        if (!researchedDB[div + "Drones - Transport"]) {
          if (rp / 10 > c.getResearchCost(div, "Drones - Transport")) {
            c.research(div, "Drones - Transport")
            researchedDB[div + "Drones - Transport"] = true
          }
          else break
          break
        }
      }
        break
    }
  }
}
/** @param {NS} ns */
function manageProducts(ns) {
  const c = ns.corporation
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    if (!hasDivDB[div].makesProducts) continue
    let active = 0
    let calculating = 0
    let division = c.getDivision(div)
    for (const prod of division.products) {
      if (c.getProduct(div, "Sector-12", prod).developmentProgress === 100) {
        const ta2 = ta2DB[div + "Sector-12" + prod]
        if (ta2 !== undefined && ta2.markupLimit !== 0)
          active++
        else
          calculating++
      }
    }
    //Discontinue?
    if (active + calculating === division.maxProducts && calculating <= 1) {
      let worstProd = "none"
      let worstRating = Infinity
      for (const prod of division.products) {

        if (c.getProduct(div, "Sector-12", prod).developmentProgress != 100 || getSellPrice(ns, div, "Sector-12", prod) === 0) continue
        if (getSellPrice(ns, div, "Sector-12", prod) < worstRating) {
          worstProd = prod
          worstRating = getSellPrice(ns, div, "Sector-12", prod)
        }
      }
      for (const city of cities)
        delete ta2DB[div + city + worstProd]
      c.discontinueProduct(div, worstProd)
      division = c.getDivision(div)
    }
    //Discontinue?
    else if (active + calculating === division.maxProducts) {
      let worstProd = "none"
      let worstRating = Infinity
      for (const prod of division.products) {
        const product = c.getProduct(div, "Sector-12", prod)
        if (product.developmentProgress === 100 && product.stats.quality < worstRating) {
          worstProd = prod
          worstRating = product.stats.quality
        }
      }
      for (const city of cities)
        delete ta2DB[div + city + worstProd]
      c.discontinueProduct(div, worstProd)
      division = c.getDivision(div)
    }
    let researching = false
    if (division.products.length <= division.maxProducts) {
      //Are we researching one?
      for (const prod of division.products)
        if (c.getProduct(div, "Sector-12", prod).developmentProgress < 100) {
          researching = true
          break
        }
    }
    let prodname = "none:" + Math.random()
    if (hasDivDB[div].type === "Tobacco") {
      prodname = cigaretts[Math.floor(Math.random() * cigaretts.length)]
      while (division.products.includes(prodname)) {
        prodname = cigaretts[Math.floor(Math.random() * cigaretts.length)]
      }
    }
    else if (hasDivDB[div].type === "Restaurant") {
      prodname = burgers[Math.floor(Math.random() * burgers.length)]
      while (division.products.includes(prodname)) {
        prodname = burgers[Math.floor(Math.random() * burgers.length)]
      }
    }
    else if (hasDivDB[div].type === "Computer Hardware") {
      prodname = hardwares[Math.floor(Math.random() * hardwares.length)]
      while (division.products.includes(prodname)) {
        prodname = hardwares[Math.floor(Math.random() * hardwares.length)]
      }
    }
    let active2 = 0
    for (const prod of division.products) {
      if (c.getProduct(div, "Sector-12", prod).developmentProgress === 100)
        active2++
    }
    const corp = c.getCorporation()
    if (!researching && active2 < division.maxProducts && corp.funds > 200) c.makeProduct(div, "Sector-12", prodname, corp.funds / 100, corp.funds / 100)
  }
}
//setJob is used due to migrating to 3.0.0 breakages
/** @param {NS} ns */
function setJob(ns, div, city, job, total) {
  if (ns.ui.getGameInfo()?.versionNumber >= 44) ns.corporation.setJobAssignment(div, city, job, total)
  else ns.corporation.setAutoJobAssignment(div, city, job, total)
}
function manageOffice(ns) {
  const c = ns.corporation
  const round = investOffer.round
  let hasDiv2 = false
  if (hasDivDB[div2]) {
    let cityCount = 0
    for (const city of cities) {
      if (hasWarehouseDB[div2 + city])
        cityCount++
    }
    if (cityCount === 6) hasDiv2 = true
  }
  let hasDiv3 = false
  if (hasDivDB[div3]) {
    let cityCount = 0
    for (const city of cities) {
      if (hasWarehouseDB[div3 + city]) {
        cityCount++
      }
    }
    if (cityCount === 6) hasDiv3 = true
  }

  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasOfficeDB[div + city]) continue
      switch (hasDivDB[div].type) {
        case "Agriculture":
          switch (round) {
            case 1:
              while (c.getOffice(div, city).size < 4 && c.getOfficeSizeUpgradeCost(div, city, 1) <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              if (c.getDivision(div).researchPoints < 60)
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", 1)
                setJob(div, city, "Engineer", 1)
                setJob(div, city, "Business", 1)
                setJob(div, city, "Management", 1)
              }
              break
            case 2:
              while (hasDiv2 && c.getOffice(div, city).size < 8 && c.getOfficeSizeUpgradeCost(div, city, 1) <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              if (c.getDivision(div).researchPoints < 700)
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 2.66))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                const remainder = c.getOffice(div, city).numEmployees - 1 - Math.floor(c.getOffice(div, city).numEmployees / 4) - Math.floor(c.getOffice(div, city).numEmployees / 2.66)
                setJob(div, city, "Management", remainder)
              }
              break
            case 3:
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 4))
                const left = c.getOffice(div, city).numEmployees - 1 - Math.floor(c.getOffice(div, city).numEmployees / 3) - 1 - Math.floor(c.getOffice(div, city).numEmployees / 4)
                setJob(div, city, "Research & Development", left)
              }
              if (!hasDiv3) break
              while (c.getOffice(div, city).size < 8 && c.getOfficeSizeUpgradeCost(div, city, 1) <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 4))
                const left = c.getOffice(div, city).numEmployees - 1 - Math.floor(c.getOffice(div, city).numEmployees / 3) - 1 - Math.floor(c.getOffice(div, city).numEmployees / 4)
                setJob(div, city, "Research & Development", left)
              }
              break
            case 4:
              if (c.getOffice(div, city).size < 60) c.upgradeOfficeSize(div, city, 1)
              if (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size) c.hireEmployee(div, city)
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 2))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 4))
                const left = c.getOffice(div, city).numEmployees - 1 - Math.floor(c.getOffice(div, city).numEmployees / 2) - 1 - Math.floor(c.getOffice(div, city).numEmployees / 4)
                setJob(div, city, "Research & Development", left)
              }
              break
            case 5:
              if (c.getOffice(div, city).size < 300) c.upgradeOfficeSize(div, city, 1)
              if (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size) c.hireEmployee(div, city)
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", 1)
                setJob(div, city, "Business", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 2.5))
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 2.5))
                const left = c.getOffice(div, city).numEmployees - 1 - Math.floor(c.getOffice(div, city).numEmployees / 2.5) - Math.floor(c.getOffice(div, city).numEmployees / 2.5) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Chemical":
          switch (round) {
            case 2:
              while (c.getOffice(div, city).size < 3 && c.getOfficeSizeUpgradeCost(div, city, 1) <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              if (c.getDivision(div).researchPoints < 390)
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", 1)
                setJob(div, city, "Engineer", 1)
                setJob(div, city, "Business", 1)
              }
              break
            case 3:
              if (!hasDiv3) break
              while (c.getOffice(div, city).size < 8 && c.getOfficeSizeUpgradeCost(div, city, 1) <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", Math.max(1, Math.floor(c.getOffice(div, city).numEmployees / 4)))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 4))
                const left = c.getOffice(div, city).numEmployees - Math.max(1, Math.floor(c.getOffice(div, city).numEmployees / 4)) - Math.floor(c.getOffice(div, city).numEmployees / 4) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
            case 4:
              if (c.getOffice(div, city).size < 60) c.upgradeOfficeSize(div, city, 1)
              if (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size) c.hireEmployee(div, city)
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 4))
                const left = c.getOffice(div, city).numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 4) - Math.floor(c.getOffice(div, city).numEmployees / 4) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
            case 5:
              if (c.getOffice(div, city).size < 300) c.upgradeOfficeSize(div, city, 1)
              if (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size) c.hireEmployee(div, city)
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 3))
                const office = c.getOffice(div, city)
                const left = office.numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Tobacco":
          switch (round) {
            case 3: {
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              if (city !== "Sector-12" && !tobaccoBooster)
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Business", 1)
                const office = c.getOffice(div, city)
                const left = office.numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - 1
                setJob(div, city, "Management", left)
              }
              if (!hasDiv3) break
              const corpRev = c.getCorporation().revenue
              while (c.getOffice(div, city).size < 106 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 5e8)
                while (c.getOffice(div, city).size < 116 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 1e9)
                while (c.getOffice(div, city).size < 136 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 2.5e9)
                while (c.getOffice(div, city).size < 146 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 5e9)
                while (c.getOffice(div, city).size < 156 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 10e9)
                while (c.getOffice(div, city).size < 176 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 20e9)
                while (c.getOffice(div, city).size < 200 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 50e9)
                while (c.getOffice(div, city).size < 226 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              if (city !== "Sector-12" && !tobaccoBooster)
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Business", 1)
                const office = c.getOffice(div, city)
                const left = office.numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - 1
                setJob(div, city, "Management", left)
              }
            }
              break
            case 4: {
              const corpRev = c.getCorporation().revenue
              if (c.getOffice(div, city).size < 250) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 100e9)
                while (c.getOffice(div, city).size < 270 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 200e9)
                while (c.getOffice(div, city).size < 290 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 400e9)
                while (c.getOffice(div, city).size < 320 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 1e12)
                while (c.getOffice(div, city).size < 360 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 2e12)
                while (c.getOffice(div, city).size < 380 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (corpRev > 5e12)
                while (c.getOffice(div, city).size < 380 && c.getOfficeSizeUpgradeCost(div, city, 1) * 1.5 <= corpFunds(ns)) c.upgradeOfficeSize(div, city, 1)
              if (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size) c.hireEmployee(div, city)
              resetOffice(ns, div, city)
              if (city !== "Sector-12" && !tobaccoBooster)
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Business", 1)
                const left = c.getOffice(div, city).numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - 1
                setJob(div, city, "Management", left)
              }
            }
              break
            case 5:
              while (c.getOffice(div, city).size < 1500 && corpFunds(ns) >= c.getOfficeSizeUpgradeCost(div, city, 1)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              if (city !== "Sector-12")
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                const left = c.getOffice(div, city).numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 4) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Management", left)
              }
              break
          }
          break
        case "Restaurant":
          switch (round) {
            case 5:
              while (c.getOffice(div, city).size < 1500 && corpFunds(ns) >= c.getOfficeSizeUpgradeCost(div, city, 1)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              if (city !== "Sector-12")
                setJob(div, city, "Research & Development", c.getOffice(div, city).numEmployees)
              else {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                const left = c.getOffice(div, city).numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 4) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Management", left)
              }
              break
          }
          break
        case "Water Utilities":
          switch (round) {
            case 5:
              while (c.getOffice(div, city).size < 6500 && corpFunds(ns) >= c.getOfficeSizeUpgradeCost(div, city, 1)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 3))
                const office = c.getOffice(div, city)
                const left = office.numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Computer Hardware":
          switch (round) {
            case 5:
              while (c.getOffice(div, city).size < 4500 && corpFunds(ns) >= c.getOfficeSizeUpgradeCost(div, city, 1)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 3))
                const office = c.getOffice(div, city)
                const left = office.numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Refinery":
          switch (round) {
            case 5:
              while (c.getOffice(div, city).size < 6500 && corpFunds(ns) >= c.getOfficeSizeUpgradeCost(div, city, 1)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 3))
                const office = c.getOffice(div, city)
                const left = office.numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Mining":
          switch (round) {
            case 5:
              while (c.getOffice(div, city).size < 1500 && corpFunds(ns) >= c.getOfficeSizeUpgradeCost(div, city, 1)) c.upgradeOfficeSize(div, city, 1)
              while (c.getOffice(div, city).numEmployees < c.getOffice(div, city).size && c.hireEmployee(div, city)) { }
              resetOffice(ns, div, city)
              {
                setJob(div, city, "Operations", Math.floor(c.getOffice(div, city).numEmployees / 4))
                setJob(div, city, "Business", 1)
                setJob(div, city, "Engineer", Math.floor(c.getOffice(div, city).numEmployees / 3))
                setJob(div, city, "Management", Math.floor(c.getOffice(div, city).numEmployees / 3))
                const office = c.getOffice(div, city)
                const left = office.numEmployees - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 3) - Math.floor(c.getOffice(div, city).numEmployees / 4) - 1
                setJob(div, city, "Research & Development", left)
              }
              break
          }
          break
      }
    }
  }
}
/** @param {NS} ns */
function resetOffice(ns, div, city) {
  setJob(div, city, "Operations", 0)
  setJob(div, city, "Engineer", 0)
  setJob(div, city, "Business", 0)
  setJob(div, city, "Management", 0)
  setJob(div, city, "Research & Development", 0)
  setJob(div, city, "Intern", 0)
}
/** @param {NS} ns */
function teaParty(ns) {
  const c = ns.corporation
  let needed = false
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasOfficeDB[div + city]) continue
      const office = c.getOffice(div, city)
      if (office.avgEnergy < office.maxEnergy - .5) {
        c.buyTea(div, city)
        needed = true
      }
      if (office.avgMorale < office.maxMorale - 10) {
        c.throwParty(div, city, 500000)
        needed = true
      }
      else if (office.avgMorale < office.maxMorale - 5) {
        c.throwParty(div, city, 200000)
        needed = true
      }
      else if (office.avgMorale < office.maxMorale - .5) {
        c.throwParty(div, city, 100000)
        needed = true
      }
      else if (office.avgMorale < office.maxMorale) {
        c.throwParty(div, city, 50000)
        needed = false
      }
    }
  }
  return needed
}
/** @param {NS} ns */
function purchase(ns) {
  const c = ns.corporation
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasWarehouseDB[div + city]) continue
      const smartBuy = []
      const warehouse = c.getWarehouse(div, city)
      if (!indDataDB[hasDivDB[div].type]) {
        indDataDB[hasDivDB[div].type] = c.getIndustryData(hasDivDB[div].type)
      }
      /* Process purchase of materials, not from smart supply */
      for (const [matName, mat] of Object.entries(indDataDB[hasDivDB[div].type].requiredMaterials)) {
        // Smart supply
        let buyAmt = maxMatRequired(ns, div, city, matName)

        buyAmt -= c.getMaterial(div, city, matName).stored
        if (!matDataDB[matName])
          matDataDB[matName] = c.getMaterialData(matName)
        const maxAmt = Math.floor((warehouse.size - warehouse.sizeUsed) / matDataDB[matName].size);
        buyAmt = Math.min(buyAmt, maxAmt);
        smartBuy[matName] = [buyAmt, mat];
      } //End process purchase of materials

      // Use the materials already in the warehouse if the option is on.
      for (const [matName, [buy, reqMat]] of Object.entries(smartBuy)) {
        const buyAmt = buy
        const mult = getMult(ns, div, city)
        if (mult[0] === 0) {
          c.buyMaterial(div, city, matName, 0)
          c.sellMaterial(div, city, matName, "MAX", "0")
        }
        else if (buyAmt > 0) {
          c.buyMaterial(div, city, matName, buyAmt / 10)
          c.sellMaterial(div, city, matName, 0, "MP")
        }
        else {
          c.buyMaterial(div, city, matName, 0)
          if (c.getMaterial(div, city, matName).quality <= 1) c.sellMaterial(div, city, matName, buyAmt / 10 * -1, "0")
          else c.sellMaterial(div, city, matName, buyAmt / 10 * -1, "MP")
        }
      }
    }//city
  }//div

}
/** @param {NS} ns */
function basicExporImport(ns) {
  const c = ns.corporation
  if (!researchedDB["Export"]) return
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    if (!indDataDB[hasDivDB[div].type])
      indDataDB[hasDivDB[div].type] = c.getIndustryData(hasDivDB[div].type)
    if (!indDataDB[hasDivDB[div].type].makesMaterials) continue
    for (const city of cities) {
      //We make this.  Export it
      for (const name of Object.values(indDataDB[hasDivDB[div].type].producedMaterials)) {
        if (name === "Plants") { //(IPROD+IINV/10)*(-1)   (-IPROD-IINV/10)
          try { c.cancelExportMaterial(div, city, div3, "Sector-12", name) } catch { }
          try { c.cancelExportMaterial(div, city, div3, city, name) } catch { }
          try { c.cancelExportMaterial(div, city, div2, city, name) } catch { }
          try { c.exportMaterial(div, city, div2, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
          try { c.exportMaterial(div, city, div3, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
          try { c.exportMaterial(div, city, div3, "Sector-12", name, `(IPROD+IINV/10)*(-1)`) } catch { }
        }
        else if (name === "Chemicals") {
          try { c.cancelExportMaterial(div, city, div1, city, name) } catch { }
          try { c.exportMaterial(div, city, div1, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
        }
        else if (name === "Food") {
          try { c.cancelExportMaterial(div, city, div4, "Sector-12", name) } catch { }
          try { c.cancelExportMaterial(div, city, div4, city, name) } catch { }
          try { c.exportMaterial(div, city, div4, "Sector-12", name, `(IPROD+IINV/10)*(-1)`) } catch { }
          try { c.exportMaterial(div, city, div4, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
        }
        else if (name === "Water") {
          try { c.cancelExportMaterial(div, city, div1, city, name) } catch { }
          try { c.cancelExportMaterial(div, city, div2, city, name) } catch { }
          try { c.cancelExportMaterial(div, city, div4, city, name) } catch { }
          try { c.exportMaterial(div, city, div1, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
          try { c.exportMaterial(div, city, div2, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
          try { c.exportMaterial(div, city, div4, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
        }
        else if (name === "Hardware") {
          try { c.cancelExportMaterial(div, city, div5, city, name) } catch { }
          try { c.cancelExportMaterial(div, city, div8, city, name) } catch { }
          try { c.exportMaterial(div, city, div5, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
          try { c.exportMaterial(div, city, div8, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
        }
        else if (name === "Metal") {
          try { c.cancelExportMaterial(div, city, div6, city, name) } catch { }
          try { c.exportMaterial(div, city, div6, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
        }
        else if (name === "Ore") {
          try { c.cancelExportMaterial(div, city, div7, city, name) } catch { }
          try { c.exportMaterial(div, city, div7, city, name, `(IPROD+IINV/10)*(-1)`) } catch { }
        }
      }
    }
  }
}
/** @param {NS} ns */
function optimizeMats(ns) {
  const c = ns.corporation
  const round = investOffer.round
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasWarehouseDB[div + city]) continue
      let maxProd = maxProduced(ns, div, city)
      if (round < 3) maxProd *= 1.01
      else maxProd *= 1.1
      const warehouse = c.getWarehouse(div, city)
      //[Hardware, Robots, AI Cores, Real Estate]
      const [hardware, robots, aicores, realestate] = optimizeCorpoMaterials(ns, div, warehouse.size - maxProd)
      const hardwareStored = c.getMaterial(div, city, "Hardware").stored
      if (hardwareStored === hardware) {
        c.buyMaterial(div, city, "Hardware", 0)
        c.sellMaterial(div, city, "Hardware", 0, "MP")
      }
      else if (hardwareStored < hardware) {
        if (round >= 4) c.buyMaterial(div, city, "Hardware", (hardware - hardwareStored) / 10 / 10)
        else c.buyMaterial(div, city, "Hardware", (hardware - hardwareStored) / 10)
        c.sellMaterial(div, city, "Hardware", 0, "MP")
      }
      else {
        if (round >= 4) {
          c.sellMaterial(div, city, "Hardware", (hardwareStored - hardware) / 10 / 10, "0")
        }
        else c.sellMaterial(div, city, "Hardware", (hardwareStored - hardware) / 10, "MP")
        c.buyMaterial(div, city, "Hardware", 0)
      }

      const robotsStored = c.getMaterial(div, city, "Robots").stored
      if (robotsStored === robots) {
        c.buyMaterial(div, city, "Robots", 0)
        c.sellMaterial(div, city, "Robots", 0, "MP")
      }
      else if (robotsStored < robots) {
        if (round >= 4) c.buyMaterial(div, city, "Robots", (robots - robotsStored) / 10 / 10)
        else c.buyMaterial(div, city, "Robots", (robots - robotsStored) / 10)
        c.sellMaterial(div, city, "Robots", 0, "MP")
      }
      else {
        if (round >= 4) {
          (c.sellMaterial(div, city, "Robots", (robotsStored - robots) / 10 / 10, "0"))
        }
        else c.sellMaterial(div, city, "Robots", (robotsStored - robots) / 10, "MP")
        c.buyMaterial(div, city, "Robots", 0)
      }

      const aiCoresStored = c.getMaterial(div, city, "AI Cores").stored
      if (aiCoresStored === aicores) {
        c.buyMaterial(div, city, "AI Cores", 0)
        c.sellMaterial(div, city, "AI Cores", 0, "MP")
      }
      else if (aiCoresStored < aicores) {
        if (round >= 4) c.buyMaterial(div, city, "AI Cores", (aicores - aiCoresStored) / 10 / 10)
        else c.buyMaterial(div, city, "AI Cores", (aicores - aiCoresStored) / 10)
        c.sellMaterial(div, city, "AI Cores", 0, "MP")
      }
      else {
        if (round >= 4) {
          (c.sellMaterial(div, city, "AI Cores", (aiCoresStored - aicores) / 10 / 10, "0"))
        }
        else c.sellMaterial(div, city, "AI Cores", (aiCoresStored - aicores) / 10, "MP")
        c.buyMaterial(div, city, "AI Cores", 0)
      }

      const realEstateStored = c.getMaterial(div, city, "Real Estate").stored
      if (realEstateStored === realestate) {
        c.buyMaterial(div, city, "Real Estate", 0)
        c.sellMaterial(div, city, "Real Estate", 0, "MP")
      }
      else if (realEstateStored < realestate) {
        if (round >= 4) c.buyMaterial(div, city, "Real Estate", (realestate - realEstateStored) / 10 / 10)
        else c.buyMaterial(div, city, "Real Estate", (realestate - realEstateStored) / 10)
        c.sellMaterial(div, city, "Real Estate", 0, "MP")
      }
      else {
        if (round >= 4) {
          c.sellMaterial(div, city, "Real Estate", (realEstateStored - realestate) / 10 / 10, "0")
        }
        else c.sellMaterial(div, city, "Real Estate", (realEstateStored - realestate) / 10, "MP")
        c.buyMaterial(div, city, "Real Estate", 0)
      }
    }
  }
}
function optimizeCorpoMaterials_raw(matSizes, divWeights, spaceConstraint, round) {
  let p = divWeights.reduce((a, b) => a + b, 0);
  let w = matSizes.reduce((a, b) => a + b, 0);
  let r = [];
  for (let i = 0; i < matSizes.length; ++i) {
    let m = (spaceConstraint - 500 * ((matSizes[i] / divWeights[i]) * (p - divWeights[i]) - (w - matSizes[i]))) / (p / divWeights[i]) / matSizes[i];
    if (divWeights[i] <= 0 || m < 0) {
      return optimizeCorpoMaterials_raw(matSizes.toSpliced(i, 1), divWeights.toSpliced(i, 1), spaceConstraint, round).toSpliced(i, 0, 0);
    } else {
      if (round) m = Math.round(m);
      r.push(m);
    }
  }
  return r;
}
//SpaceConstraint is how much space to dedicate to it
/** @param {NS} ns */
function optimizeCorpoMaterials(ns, div, spaceConstraint, round = true) {
  const type = hasDivDB[div].type
  if (!indDataDB[type])
    indDataDB[type] = ns.corporation.getIndustryData(type)
  let { hardwareFactor, robotFactor, aiCoreFactor, realEstateFactor } = indDataDB[type]
  if (isNaN(hardwareFactor)) hardwareFactor = 0
  if (isNaN(robotFactor)) robotFactor = 0
  if (isNaN(aiCoreFactor)) aiCoreFactor = 0
  if (isNaN(realEstateFactor)) realEstateFactor = 0

  const divWeights = [hardwareFactor, robotFactor, aiCoreFactor, realEstateFactor]
  if (!matDataDB["Hardware"])
    matDataDB["Hardware"] = ns.corporation.getMaterialData("Hardware")
  if (!matDataDB["Robots"])
    matDataDB["Robots"] = ns.corporation.getMaterialData("Robots")
  if (!matDataDB["AI Cores"])
    matDataDB["AI Cores"] = ns.corporation.getMaterialData("AI Cores")
  if (!matDataDB["Real Estate"])
    matDataDB["Real Estate"] = ns.corporation.getMaterialData("Real Estate")
  const matSizes = ["Hardware", "Robots", "AI Cores", "Real Estate"].map((mat) => matDataDB[mat].size)
  return optimizeCorpoMaterials_raw(matSizes, divWeights, spaceConstraint, round)
}
/** @param {NS} ns */
function maxProduction(ns, div, city) {
  if (!hasWarehouseDB[div + city]) return [0, 0]
  const mult = getMult(ns, div, city)
  return [10 * mult[0], 10 * mult[1]]
}
/** @param {NS} ns */
function maxMatRequired(ns, div, city, matID) {
  const c = ns.corporation
  if (!hasDivDB[div]) return 0
  if (!hasWarehouseDB[div + city]) return 0
  let productMult = 0
  if (indDataDB[hasDivDB[div].type] === undefined)
    indDataDB[hasDivDB[div].type] = c.getIndustryData(hasDivDB[div].type)
  if (indDataDB[hasDivDB[div].type].makesProducts) {
    let products = 0
    const division = c.getDivision(div)
    for (const prod of division.products)
      if (c.getProduct(div, city, prod).developmentProgress === 100)
        products++
    productMult = products
  }
  else productMult = 1

  for (const [matName, mat] of Object.entries(indDataDB[hasDivDB[div].type].requiredMaterials)) {
    if (matName !== matID) continue
    // Smart supply
    let required = 0
    const mult = getMult(ns, div, city)
    if (hasDivDB[div].makesProducts) required += 10 * mult[1] * mat * productMult
    if (indDataDB[hasDivDB[div].type].makesMaterials) required += 10 * mult[0] * mat
    return required
  } //End process purchase of materials
  return 0
}
/** @param {NS} ns */
function maxProduced(ns, div, city) {
  const c = ns.corporation
  if (!hasWarehouseDB[div + city]) return 0
  const mult = getMult(ns, div, city)
  const multMaterial = mult[0]
  const multProduct = mult[1]
  if (multMaterial === 0) return 0

  let totalSize = 0
  if (indDataDB[hasDivDB[div].type] === undefined)
    indDataDB[hasDivDB[div].type] = c.getIndustryData(hasDivDB[div].type)
  for (const [matName, matAmount] of Object.entries(indDataDB[hasDivDB[div].type].requiredMaterials)) {
    if (matDataDB[matName] === undefined)
      matDataDB[matName] = c.getMaterialData(matName)
    totalSize += maxMatRequired(ns, div, city, matName) * matDataDB[matName].size
  }
  if (indDataDB[hasDivDB[div].type].makesMaterials)
    for (const mat of indDataDB[hasDivDB[div].type].producedMaterials) {
      if (matDataDB[mat] === undefined)
        matDataDB[mat] = c.getMaterialData(mat)
      totalSize += matDataDB[mat].size * 10 * multMaterial
      totalSize += c.getMaterial(div, city, mat).stored * matDataDB[mat].size
    }
  const division = c.getDivision(div)
  for (const prod of division.products)
    if (c.getProduct(div, city, prod).developmentProgress === 100) {
      totalSize += c.getProduct(div, city, prod).size * 10 * multProduct
      totalSize += c.getProduct(div, city, prod).stored * c.getProduct(div, city, prod).size
    }
  return totalSize
}
/** @param {NS} ns */
function warehouseUpgrade(ns) {
  const c = ns.corporation
  const round = investOffer.round

  let hasDiv2 = false
  let count = 0
  for (const city of cities)
    if (hasWarehouseDB[div2 + city]) count++
  if (count === 6)
    hasDiv2 = true

  let hasDiv3 = false
  let cityCount = 0
  for (const city of cities)
    if (hasWarehouseDB[div3 + city]) cityCount++
  if (cityCount === 6) hasDiv3 = true

  while (count < 8) {
    if (round >= 3) count++
    let smartStorageIncrease = 0
    const smartStorage = c.getUpgradeLevel("Smart Storage")
    for (const div of industries) {
      if (!hasDivDB[div]) continue
      if (round === 2 && hasDivDB[div].type === "Chemical") continue
      for (const city of cities) {
        if (!hasWarehouseDB[div + city]) continue
        const warehouse = c.getWarehouse(div, city)
        let divMult = researchedDB[div + "Drones - Transport"] ? 1.5 : 1
        smartStorageIncrease += (warehouse.level * 100 * (1 + ((smartStorage + 1) * .1)) * divMult) - (warehouse.level * 100 * (1 + (smartStorage * .1)) * divMult)
      }
    }
    const funds = corpFunds(ns)
    if ((hasDiv2 && smartStorage >= 30)
      || (!hasDiv2 && smartStorage >= 10))
      smartStorageIncrease = 0

    let bestUpgradeType = "none"
    let bestUpgradeCity = "none"
    let bestUpgradeRatio = 0
    let bestAgriCity = "none"
    let bestAgriRatio = 0
    let bestChemCity = "none"
    let bestChemRatio = 0
    let bestWaterCity = "none"
    let bestWaterRatio = 0
    let bestComputerCity = "none"
    let bestComputerRatio = 0
    let bestRefineryCity = "none"
    let bestRefineryRatio = 0
    let bestMiningCity = "none"
    let bestMiningRatio = 0
    const smartUpgrade = c.getUpgradeLevelCost("Smart Storage")
    let smartRatio = smartStorageIncrease === 0 ? 0 : smartStorageIncrease / smartUpgrade

    for (const div of industries) {
      if (!hasDivDB[div]) continue
      for (const city of cities) {
        if (!hasWarehouseDB[div + city]) continue
        const warehouse = c.getWarehouse(div, city)
        const warehouseUpgrade = c.getUpgradeWarehouseCost(div, city)
        const smartStorageMult = 1 + (smartStorage * .1)
        let divMult = 1
        try { divMult = researchedDB[div + "Drones - Transport"] ? 1.5 : 1 } catch { continue }
        let warehouseIncrease = ((warehouse.level + 1) * 100 * smartStorageMult * divMult) - warehouse.size
        let warehouseRatio = warehouseIncrease / warehouseUpgrade

        if (round === 2 && (warehouse.level === 2 || !hasDiv2) && hasDivDB[div].type === "Chemical") warehouseRatio = 0 //Early break on Chemical warehouse upgrade until we get all of Chemical
        if (hasDivDB[div].type === "Agriculture" && warehouseRatio > bestAgriRatio) {
          bestAgriCity = city
          bestAgriRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Chemical" && warehouseRatio > bestChemRatio) {
          bestChemCity = city
          bestChemRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Water Utilities" && warehouseRatio > bestWaterRatio) {
          bestWaterCity = city
          bestWaterRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Computer Hardware" && warehouseRatio > bestComputerRatio) {
          bestComputerCity = city
          bestComputerRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Refinery" && warehouseRatio > bestRefineryRatio) {
          bestRefineryCity = city
          bestRefineryRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Mining" && warehouseRatio > bestMiningRatio) {
          bestMiningCity = city
          bestMiningRatio = warehouseRatio
        }
        const maxProd = maxProduction(ns, div, city)
        if (round >= 3 && hasDivDB[div].type === "Agriculture") {
          if (maxProd[0] > maxMatRequired(ns, div4, city, "Food") && maxProd[0] > (maxMatRequired(ns, div2, city, "Plants") + maxMatRequired(ns, div3, "Sector-12", "Plants")))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        if (round >= 3 && hasDivDB[div].type === "Chemical") {
          if (maxProd[0] > maxMatRequired(ns, div1, city, "Chemicals") || !hasDiv3)
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        if (round >= 5 && hasDivDB[div].type === "Water Utilities") {
          if (maxProd[0] > maxMatRequired(ns, div1, city, "Water") + maxMatRequired(ns, div2, city, "Water") + maxMatRequired(ns, div4, city, "Water"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        if (round >= 5 && hasDivDB[div].type === "Computer Hardware") {
          if (maxProd[0] > maxMatRequired(ns, div5, city, "Hardware") + maxMatRequired(ns, div8, city, "Hardware"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        if (round >= 5 && hasDivDB[div].type === "Refinery") {
          if (maxProd[0] > maxMatRequired(ns, div6, city, "Metal"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        if (round >= 5 && hasDivDB[div].type === "Mining") {
          if (maxProd[0] > maxMatRequired(ns, div7, city, "Metal"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }

        if (round === 2 && !hasDiv2 && hasDivDB[div].type === "Agriculture") {
          warehouseRatio = 0
          smartRatio = 0
        }
        if (round === 2 && hasDiv2 && warehouse.level >= 20 && hasDivDB[div].type === "Agriculture") {
          warehouseRatio = 0
          smartRatio = 0
        }
        if (round === 3 && !hasDiv3 && hasDivDB[div].type === "Agriculture") {
          warehouseRatio = 0
          smartRatio = 0
        }
        if (round === 3 && !hasDiv3 && warehouse.level >= 3 && hasDivDB[div].type === "Chemical") {
          warehouseRatio = 0
          smartRatio = 0
        }
        if (round === 3 && !hasDiv3 && hasDivDB[div].type === "Tobacco") {
          warehouseRatio = 0
          smartRatio = 0
        }
        if (round === 2 && ((hasDivDB[div].type === "Chemical" && (warehouse.level === 2 || !hasDiv2)))) {
          warehouseRatio = 0
          smartRatio = 0
        }
        if ((round >= 3) && ["Tobacco", "Restaurant"].includes(hasDivDB[div].type) && warehouse.level >= 5)
          warehouseRatio = 0
        //Round 2 - upgrade chem once
        if (round === 2 && hasDivDB[div].type === "Chemical" && warehouse.level === 1) {
          bestUpgradeType = div
          bestUpgradeCity = city
          bestUpgradeRatio = Infinity
        }
        else if (warehouseRatio > smartRatio && warehouseRatio > bestUpgradeRatio) {
          bestUpgradeType = div
          bestUpgradeCity = city
          bestUpgradeRatio = warehouseRatio
        }
        else if (smartRatio > bestUpgradeRatio) {
          bestUpgradeType = "Smart"
          bestUpgradeRatio = smartRatio
        }
      }
    }
    if (!["Smart", "none"].includes(bestUpgradeType)) {
      if (hasDivDB[bestUpgradeType].type === "Agriculture") {
        bestUpgradeCity = bestAgriCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Chemical") {
        bestUpgradeCity = bestChemCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Water Utilities") {
        bestUpgradeCity = bestWaterCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Computer Hardware") {
        bestUpgradeCity = bestComputerCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Refinery") {
        bestUpgradeCity = bestRefineryCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Mining") {
        bestUpgradeCity = bestMiningCity
      }
    }
    if (round >= 3) {
      if (bestUpgradeType === "none") break
      else if (bestUpgradeType === "Smart" && funds >= c.getUpgradeLevelCost("Smart Storage") * 1.5) {
        c.levelUpgrade("Smart Storage")
      }
      else if (bestUpgradeCity !== "none" && funds >= c.getUpgradeWarehouseCost(bestUpgradeType, bestUpgradeCity) * 1.5) {
        c.upgradeWarehouse(bestUpgradeType, bestUpgradeCity)
      }
      else break
    }
    else {
      if (bestUpgradeType === "none") break
      else if (bestUpgradeType === "Smart" && funds >= c.getUpgradeLevelCost("Smart Storage")) {
        c.levelUpgrade("Smart Storage")
      }
      else if (bestUpgradeCity !== "none" && funds >= c.getUpgradeWarehouseCost(bestUpgradeType, bestUpgradeCity)) {
        c.upgradeWarehouse(bestUpgradeType, bestUpgradeCity)
      }
      else break
    }
  }
}
/** @param {NS} ns */
function getSellPrice(ns, div, city, prod) {
  const c = ns.corporation
  const ta2 = ta2DB[div + city + prod]
  if (ta2 === undefined || ta2.markupLimit === 0) return 0
  const product = c.getProduct(div, city, prod)
  const prodMarketPrice = 5 * product.productionCost
  return (((ta2.markupLimit * Math.sqrt(1)) / Math.sqrt(1)) + prodMarketPrice) * 10
}
/** @param {NS} ns */
function sell(ns) {
  const c = ns.corporation
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    const hasMTAII = c.hasResearched(div, "Market-TA.II")
    for (const city of cities) {
      if (!hasWarehouseDB[div + city]) continue
      if (researchedDB["Market Research - Demand"] && researchedDB["Market Data - Competition"]) {
        if (indDataDB[hasDivDB[div].type] === undefined)
          indDataDB[hasDivDB[div].type] = c.getIndustryData(hasDivDB[div].type)
        if (indDataDB[hasDivDB[div].type].makesProducts) {
          const division = c.getDivision(div)
          for (const prod of division.products) {
            if (c.getProduct(div, city, prod).developmentProgress !== 100) continue
            if (c.getProduct(div, city, prod).stored === 0) continue
            //Setting Market TA II if researchedDB
            if (hasMTAII) { //I don't research it, but it could be there from manual purchase
              c.setProductMarketTA2(div, prod, true)
              c.sellProduct(div, city, prod, "MAX", "0")
              continue
            }

            let ta2 = ta2DB[div + city + prod]
            const product = c.getProduct(div, city, prod)
            if (ta2 === undefined) { //No TA2 data
              ta2DB[div + city + prod] = {
                "sellingPrice": product.rating,
                "sellingQuantity": product.stored,
                "markupLimit": 0
              }
              c.sellProduct(div, city, prod, "MAX", (product.rating).toString())
              continue
            }
            const prodMarketPrice = 5 * product.productionCost
            if (ta2.markupLimit === 0) { //Not calculated yet
              const actualSellAmount = product.actualSellAmount
              if (actualSellAmount >= ta2.sellingQuantity / 10) { // We failed to set it high enough.  Set it higher and try again
                const oldSalePrice = ta2DB[div + city + prod].sellingPrice
                ta2DB[div + city + prod].sellingPrice = oldSalePrice * 1000
                ta2DB[div + city + prod].sellingQuantity = product.stored
                c.sellProduct(div, city, prod, "MAX", (oldSalePrice * 1000).toString())
                continue
              }
              else if (actualSellAmount <= ta2.sellingQuantity / 10 * .15) { //Not enough sold, lower the price!
                const oldSalePrice = ta2DB[div + city + prod].sellingPrice
                ta2DB[div + city + prod].sellingPrice = oldSalePrice / 3
                ta2DB[div + city + prod].sellingQuantity = product.stored
                c.sellProduct(div, city, prod, "MAX", (oldSalePrice / 3).toString())
                continue
              }
              const mult = getMult(ns, div, city)
              const m = mult[1]
              const markupLimit = (ta2.sellingPrice - prodMarketPrice) * Math.sqrt(actualSellAmount / m)
              ta2DB[div + city + prod].markupLimit = markupLimit
              ta2 = ta2DB[div + city + prod]
            }
            const prodStored = product.stored
            let sellingPrice = (((ta2.markupLimit * Math.sqrt(prodStored)) / Math.sqrt(prodStored)) + prodMarketPrice) * 10
            const priceMult = product.productionAmount / prodStored
            if (priceMult !== Infinity) sellingPrice *= priceMult >= 1 ? 1 : priceMult
            if (sellingPrice < 0 || isNaN(sellingPrice)) {
              const oldSalePrice = ta2DB[div + city + prod].sellingPrice
              ta2DB[div + city + prod].sellingPrice = oldSalePrice * 10
              ta2DB[div + city + prod].sellingQuantity = prodStored
              ta2DB[div + city + prod].markupLimit = 0
              c.sellProduct(div, city, prod, "MAX", (oldSalePrice * 10).toString())
              continue
            }
            c.sellProduct(div, city, prod, "MAX", sellingPrice.toString())
          } //Products
        } //Product check
        if (indDataDB[hasDivDB[div].type].producedMaterials)
          for (const mat of indDataDB[hasDivDB[div].type].producedMaterials) {
            const material = c.getMaterial(div, city, mat)
            let exported = 0
            for (const xp of material.exports)
              exported += c.getMaterial(xp.division, xp.city, mat).importAmount
            if (material.stored === 0) continue
            //Set TA2 if we have it
            if (researchedDB[div + "Market-TA.II"]) {
              c.setMaterialMarketTA2(div, city, mat, true)
              c.sellMaterial(div, city, mat, "MAX", "0")
              continue
            }
            let ta2 = ta2DB[div + city + mat]
            if (ta2 === undefined) { //No TA2 data              
              ta2DB[div + city + mat] = {
                "sellingPrice": material.marketPrice,
                "sellingQuantity": material.stored + (exported * 10),
                "markupLimit": 0
              }
              c.sellMaterial(div, city, mat, "MAX", (material.marketPrice).toString())
              continue
            }
            const prodMarketPrice = material.marketPrice
            const mult = getMult(ns, div, city)
            const m = mult[0]
            if (ta2.markupLimit === 0) { //Not calculated yet
              const actualSellAmount = material.actualSellAmount
              if (actualSellAmount >= (ta2.sellingQuantity) / 10) { // We failed to set it high enough.  Set it higher and try again
                const oldSalePrice = ta2DB[div + city + mat].sellingPrice
                ta2DB[div + city + mat].sellingPrice = oldSalePrice * 1.2
                ta2DB[div + city + mat].sellingQuantity = material.stored + (exported * 10)
                c.sellMaterial(div, city, mat, "MAX", (oldSalePrice * 1.2).toString())
                continue
              }
              else if (actualSellAmount <= (ta2.sellingQuantity) / 10 * .1) { //Not enough sold, lower the price!
                const oldSalePrice = ta2DB[div + city + mat].sellingPrice
                ta2DB[div + city + mat].sellingPrice = oldSalePrice * .9
                ta2DB[div + city + mat].sellingQuantity = material.stored + (exported * 10)
                c.sellMaterial(div, city, mat, "MAX", (oldSalePrice * .9).toString())
                continue
              }
              const markupLimit = (ta2.sellingPrice - prodMarketPrice) * Math.sqrt(actualSellAmount / m)
              ta2DB[div + city + mat].markupLimit = markupLimit
              ta2 = ta2DB[div + city + mat]
            }
            const prodStored = material.stored
            let sellingPrice = (((ta2.markupLimit * Math.sqrt(prodStored)) / Math.sqrt(prodStored)) + prodMarketPrice) * 10
            const priceMult = (material.productionAmount - exported) / prodStored
            if (priceMult !== Infinity) sellingPrice *= priceMult >= 1 ? 1 : priceMult
            if (sellingPrice < 0 || isNaN(sellingPrice)) {
              const oldSalePrice = ta2DB[div + city + mat].sellingPrice
              ta2DB[div + city + mat].sellingPrice = oldSalePrice * 2
              ta2DB[div + city + mat].sellingQuantity = prodStored + (exported * 10)
              ta2DB[div + city + mat].markupLimit = 0
              c.sellMaterial(div, city, mat, "MAX", (oldSalePrice * 2).toString())
              continue
            }
            c.sellMaterial(div, city, mat, "MAX", sellingPrice.toString())
          }
      } //TA2
      else { // No TA2
        if (!indDataDB[hasDivDB[div].type])
          indDataDB[hasDivDB[div].type] = c.getIndustryData(hasDivDB[div].type)
        if (indDataDB[hasDivDB[div].type].producedMaterials) {
          for (const mat of indDataDB[hasDivDB[div].type].producedMaterials) {
            const material = c.getMaterial(div, city, mat)
            if (material.stored === 0) continue
            const marketPrice = material.marketPrice
            if (!matDataDB[mat])
              matDataDB[mat] = c.getMaterialData(mat)
            let price = marketPrice + (material.quality / matDataDB[mat].baseMarkup)
            const maxProd = maxProduction(ns, div, city)
            const priceMult = maxProd[0] / (material.stored)
            price *= priceMult >= 1 ? 1 : priceMult >= .6 ? priceMult : priceMult / 10
            c.sellMaterial(div, city, mat, "MAX", price)
          }
        }
      }
    }
  }
}
/** @param {NS} ns */
function getMult(ns, div, city) {
  const c = ns.corporation
  if (!hasOfficeDB[div + city]) return [0, 0]
  const office = c.getOffice(div, city)
  const operationEmployeesProduction = office.employeeProductionByJob.Operations
  const engineerEmployeesProduction = office.employeeProductionByJob.Engineer
  const managementEmployeesProduction = office.employeeProductionByJob.Management
  const totalEmployeesProduction = operationEmployeesProduction + engineerEmployeesProduction + managementEmployeesProduction;
  if (totalEmployeesProduction <= 0) return [0, 0]
  const managementFactor = 1 + managementEmployeesProduction / (1.2 * totalEmployeesProduction)
  const employeesProductionMultiplier = (Math.pow(operationEmployeesProduction, 0.4) + Math.pow(engineerEmployeesProduction, 0.3)) * managementFactor;
  const balancingMultiplier = 0.05;
  const officeMultiplierProduct = 0.5 * balancingMultiplier * employeesProductionMultiplier;
  const officeMultiplierMaterial = balancingMultiplier * employeesProductionMultiplier;

  // Multiplier from Smart Factories
  const upgradeMultiplier = 1 + (c.getUpgradeLevel("Smart Factories") * 0.03)
  // Multiplier from researches
  let researchMultiplier = 1
  researchMultiplier *=
    (researchedDB[div + "Drones - Assembly"] ? 1.2 : 1)
    * (researchedDB[div + "Self-Correcting Assemblers"] ? 1.1 : 1);
  if (hasDivDB[div].makesProducts) {
    researchMultiplier *= (researchedDB[div + "uPgrade: Fulcrum"] ? 1.05 : 1);
  }
  let multSum = 0;
  if (!indDataDB[hasDivDB[div].type])
    indDataDB[hasDivDB[div].type] = c.getIndustryData(hasDivDB[div].type)
  for (const scity of cities) {
    if (!hasWarehouseDB[div + scity]) continue
    let realestate = Math.pow(0.002 * c.getMaterial(div, scity, "Real Estate").stored + 1, indDataDB[hasDivDB[div].type].realEstateFactor)
    let hardware = Math.pow(0.002 * c.getMaterial(div, scity, "Hardware").stored + 1, indDataDB[hasDivDB[div].type].hardwareFactor)
    let robots = Math.pow(0.002 * c.getMaterial(div, scity, "Robots").stored + 1, indDataDB[hasDivDB[div].type].robotFactor)
    let aicores = Math.pow(0.002 * c.getMaterial(div, scity, "AI Cores").stored + 1, indDataDB[hasDivDB[div].type].aiCoreFactor);
    if (isNaN(realestate)) realestate = 1
    if (isNaN(hardware)) hardware = 1
    if (isNaN(robots)) robots = 1
    if (isNaN(aicores)) aicores = 1
    const cityMult =
      realestate *
      hardware *
      robots *
      aicores
    multSum += Math.pow(cityMult, 0.73);
  }
  const productionMult = multSum < 1 ? 1 : multSum
  const multMaterial = officeMultiplierMaterial * productionMult * upgradeMultiplier * researchMultiplier
  const multProduct = officeMultiplierProduct * productionMult * upgradeMultiplier * researchMultiplier
  return [multMaterial, multProduct]
}

/** @param {NS} ns */
function currentBN(ns) {
  return ns.getResetInfo().currentNode
}

/** @param {NS} ns */
function updateHud(ns) {
  ns.clearLog()
  const c = ns.corporation
  const cObj = c.getCorporation()
  const bnMults = getBNMults(ns)
  ns.printf("%s", cObj.name)
  if (ns.ui.getGameInfo()?.versionNumber >= 44) ns.printf("Funds : $%s  Profit: $%s/s", ns.format.number(cObj.funds, 3), ns.format.number(cObj.revenue - cObj.expenses, 3))
  else ns.printf("Funds : $%s  Profit: $%s/s", ns.formatNumber(cObj.funds, 3), ns.formatNumber(cObj.revenue - cObj.expenses, 3))
  const invest = investOffer
  const upgrades = c.getUpgradeLevel("Neural Accelerators")
    + c.getUpgradeLevel("Project Insight")
    + c.getUpgradeLevel("Nuoptimal Nootropic Injector Implants")
    + c.getUpgradeLevel("FocusWires")
    + c.getUpgradeLevel("Speech Processor Implants")
    + c.getUpgradeLevel("FocusWires")
  const offer = invest.round === 1 ? (round1Money * bnMults.CorporationValuation)
    : invest.round === 2 ? (round2Money * bnMults.CorporationValuation)
      : invest.round === 3 ? (round3Money * bnMults.CorporationValuation)
        : invest.round === 4 ? (round4Money * bnMults.CorporationValuation)
          : 0
  const minRound = invest.round === 2 ? "-BareMin 30b" : ""
  const produpgrades = c.getUpgradeLevel("Smart Factories") + c.getUpgradeLevel("Smart Storage")
  if (ns.ui.getGameInfo()?.versionNumber >= 44) ns.printf("Round: %s  Offer: %s FundsReq: %s  %s", invest.round, ns.format.number(invest.funds, 3), ns.format.number(offer, 3), minRound)
  else ns.printf("Round: %s  Offer: %s FundsReq: %s  %s", invest.round, ns.formatNumber(invest.funds, 3), ns.formatNumber(offer, 3), minRound)
  if (ns.ui.getGameInfo()?.versionNumber >= 44)
    ns.printf("Empl Upgrades: %s  Prod Upgrades: %s  Profit Upgrades: %s  Wilson: %s", upgrades, produpgrades, c.getUpgradeLevel("ABC SalesBots"), c.getUpgradeLevel("Wilson Analytics"))
  else
    ns.printf("Empl Upgrades: %s  Prod Upgrades: %s  Profit Upgrades: %s  Wilson: %s  Dream: %s/1", upgrades, produpgrades, c.getUpgradeLevel("ABC SalesBots"), c.getUpgradeLevel("Wilson Analytics"), c.getUpgradeLevel("DreamSense"))
  const state = cObj.nextState === "PURCHASE" ? "START"
    : cObj.nextState === "PRODUCTION" ? "PURCHASE"
      : cObj.nextState === "EXPORT" ? "PRODUCTION"
        : cObj.nextState === "SALE" ? "EXPORT"
          : "SALE"
  ns.printf("Stage: %s", state)
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    const division = c.getDivision(div)
    if (ns.ui.getGameInfo()?.versionNumber >= 44) ns.printf("-%s(%s)  Profit: $%s/s  Awareness: %s  Pop: %s", div, division.type, ns.format.number(division.lastCycleRevenue - division.lastCycleExpenses, 3), ns.format.number(division.awareness, 3), ns.format.number(division.popularity, 3))
    else ns.printf("-%s(%s)  Profit: $%s/s  Awareness: %s  Pop: %s", div, division.type, ns.formatNumber(division.lastCycleRevenue - division.lastCycleExpenses, 3), ns.formatNumber(division.awareness, 3), ns.formatNumber(division.popularity, 3))
    let wCount = 0
    let wSpace = 0
    let wSpaceUsed = 0
    let oCount = 0
    let oEmployees = 0
    let oSize = 0
    for (const city of cities) {
      if (!hasOfficeDB[div + city]) continue
      if (hasWarehouseDB[div + city]) {
        wCount++
        const warehouse = c.getWarehouse(div, city)
        wSpace += warehouse.size
        wSpaceUsed += warehouse.sizeUsed
      }
      try {
        const office = c.getOffice(div, city)
        oEmployees += office.numEmployees
        oCount++
        oSize += office.size
      }
      catch { }
    }
    if (ns.ui.getGameInfo()?.versionNumber >= 44) ns.printf("  Warehouse Space: (%s/6) %s/%s  Office Usage: (%s/6) %s/%s  Research: %s", wCount, Math.round(wSpaceUsed), Math.round(wSpace), oCount, oEmployees, oSize, ns.format.number(division.researchPoints, 3))
    else ns.printf("  Warehouse Space: (%s/6) %s/%s  Office Usage: (%s/6) %s/%s  Research: %s", wCount, Math.round(wSpaceUsed), Math.round(wSpace), oCount, oEmployees, oSize, ns.formatNumber(division.researchPoints, 3))
    if (indDataDB[hasDivDB[div].type] === undefined)
      indDataDB[hasDivDB[div].type] = c.getIndustryData(division.type)
    if (indDataDB[hasDivDB[div].type].makesProducts) {
      for (const product of division.products) {
        const prog = c.getProduct(div, "Sector-12", product).developmentProgress
        const sellPrice = getSellPrice(ns, div, "Sector-12", product)
        if (prog === 100) {
          if (sellPrice === 0) ns.printf("  Calculating - %s", product)
          else {
            if (ns.ui.getGameInfo()?.versionNumber >= 44) ns.printf("  $%s - %s", ns.format.number(getSellPrice(ns, div, "Sector-12", product), 3), product)
            else ns.printf("  $%s - %s", ns.formatNumber(getSellPrice(ns, div, "Sector-12", product), 3), product)
          }
        }
        else {
          if (ns.ui.getGameInfo()?.versionNumber >= 44) ns.printf("  %s%s - %s", ns.format.number(prog, 2), "%", product)
          else ns.printf("  %s%s - %s", ns.formatNumber(prog, 2), "%", product)
        }
      }
    }
  }
  ns.ui.renderTail()
}


/** @param {NS} ns */
function getBNMults(ns) {
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
  return mults
}


const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"]
const industries = [div1, div2, div3, div4, div5, div6, div7, div8]
const cigaretts = ["Pall Mall", "Camel", "Marlboro", "Kool", "American Spirit", "Bastos", "Philip Morris", "USA Gold", "Winston", "Backwoods Smokes", "Capstan", "Chesterfield", "Davidoff", "Maverick", "Newport", "Black Devil", "Dunhill", "Rothman\'s"]
const burgers = ["Double Bacon Cheeseburger", "Plain Hamburger", "Pickle Burger", "Onion Burger", "Turkey Burger", "Mozza Burger", "Chili Cheeseburger", "Tropical Burger", "The BLT", "Spicy Extreem Burger", "Deconstructed Burger", "Junior Delux"]
const hardwares = ["Home Entertainment Threater", "Next-Gen Graphics Card", "Portable Soldering Kit (PSK)", "Advanced Micro-Fluidics Home Kit", "xPhone MAX", "Hyper-RAM", "Superior xDisplay", "A Lamp (It's just a lamp)", "Personal Electric Transportation ULTRA"]