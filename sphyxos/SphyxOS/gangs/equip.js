/** @param {NS} ns */
export async function main(ns) {
const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(1))
  const weaps = ns.ui.getGameInfo()?.versionNumber >= 44 ? weaps_new : weaps_old
  const vehicles = ns.ui.getGameInfo()?.versionNumber >= 44 ? vehicles_new : vehicles_old
  ns.gang.getMemberNames().forEach((m) => {
    augs.forEach((a) => ns.gang.purchaseEquipment(m, a))
    weaps.forEach((a) => ns.gang.purchaseEquipment(m, a))
    armors.forEach((a) => ns.gang.purchaseEquipment(m, a))
    vehicles.forEach((a) => ns.gang.purchaseEquipment(m, a))
    //rootkits.forEach((a) => ns.gang.purchaseEquipment(m, a))
  })
}

const augs = ["Bionic Arms", "Bionic Legs", "Bionic Spine", "BrachiBlades", "Nanofiber Weave", "Synthetic Heart", "Synfibril Muscle", "Graphene Bone Lacings", "BitWire", "Neuralstimulator", "DataJack"]
const weaps_new = ["Baseball Bat", "Katana", "Malorian-3516", "Hansen-HA7", "Arasaka-HJSH18", "Militech-M251s", "Nokota-D5", "Techtronika-SPT32"]
const weaps_old = ["Baseball Bat", "Katana", "Glock 18C", "P90C", "Steyr AUG", "AK-47", "M15A10 Assault Rifle", "AWM Sniper Rifle"]
const armors = ["Bulletproof Vest", "Full Body Armor", "Liquid Body Armor", "Graphene Plating Armor"]
const vehicles_new = ["Herrera Outlaw GTS", "Yaiba ASM-R250 Muramasa", "Rayfield Caliburn", "Quadra Sport R-7"]
const vehicles_old = ["Ford Flex V20", "ATX1070 Superbike", "Mercedes-Benz S9001", "White Ferrari"]
const rootkits = ["NUKE Rootkit", "Soulstealer Rootkit", "Demon Rootkit", "Hmap Node", "Jack the Ripper"]
