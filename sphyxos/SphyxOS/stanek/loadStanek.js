import { proxy } from "SphyxOS/util.js"
/** @param {NS} ns */
export async function main(ns) {
  const fileLocation = "/SphyxOSUserData/stanekLoadouts/"
  const defaultFileLocation = "/SphyxOS/stanek/loadouts/"
  await proxy(ns, "stanek.acceptGift")
  const useDefaults = ns.args.includes("default") ? true : false
  const files = ns.ls("home", fileLocation).map(m => [m.substring(fileLocation.length - 1), fileLocation])
  if (useDefaults) {
    const defaultFiles = ns.ls("home", defaultFileLocation).map(m => [m.substring(defaultFileLocation.length - 1), defaultFileLocation])
    files.push(...defaultFiles)
  }
  let usableFiles = []
  for (const testFile of files) {
    //const testFile = file.substring(12)
    const [width, hight, ...fileName] = testFile[0].substring(0, testFile[0].length - 4).split("x")
    if (width <= ns.stanek.giftWidth() && hight <= ns.stanek.giftHeight())
      usableFiles.push([width + "x" + hight + "x" + fileName.join("x"), testFile[1]])
  }
  usableFiles = usableFiles.sort((a, b) => {
    const [width, height] = a[0].split("x")
    const [width2, height2] = b[0].split("x")
    return (width2 + height2) - (width + height)
  })
  const selectable = []
  for (const usableFile of usableFiles) {
    selectable.push(usableFile[0])
  }
  const chosen = await ns.prompt("Choose your loadout", { type: "select", choices: selectable.sort((a, b) => b[0] > a[0]) })
  if (chosen === "") {
    ns.toast("Canceled out.  Nothing changed.", "error", 3000)
    ns.exit()
  }
  else {
    ns.stanek.clearGift()
    let prefix = "/SphyxOSUserData/stanekLoadouts/"
    for (const file of usableFiles) {
      if (chosen === file[0]) {
        prefix = file[1]
        break
      }
    }
    await proxy(ns, "scp", prefix + chosen + ".txt", ns.self().server, "home")
    const file = JSON.parse(ns.read(prefix + chosen + ".txt"))
    for (const frag of file) {
      //.x, .y, .rotation, .id
      await proxy(ns, "stanek.placeFragment", frag.x, frag.y, frag.rotation, frag.id)
    }
    ns.toast("SUCCESS: Stanek loaded from " + prefix + chosen + ".txt", "success", 3000);
  }
}
