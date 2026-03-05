/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  let result = false
  ns.atExit(() => port.write(result))
  if (ns.gang.canRecruitMember()) {
    let name = names[Math.floor(Math.random() * names.length)]
    let membernames = ns.gang.getMemberNames()
    while (membernames.includes(name)) name = names[Math.floor(Math.random() * names.length)]
    //ns.printf(`INFO: Recruiting: ${name}`)
    ns.gang.recruitMember(name)
    result = true
  }
}

const names = ["Rocko", "Mike", "Jack", "Rudo", "Charmichal", "Percy", "Gloria", "Jessica", "Kelly", "Sam", "Gloria", "Sarah",
  "Jackson", "Adam", "Bob", "Carl", "Dominique", "Enrique", "Falcon", "Garry", "Helen", "Ivana", "Jeremy", "Kyle", "Lucca",
  "Max", "Nordic", "Oscar", "Paul", "Q", "Rodric", "Steve", "Trevor", "Ulfric", "Volcof", "Wilson", "Xena", "Yoril", "Z"]
