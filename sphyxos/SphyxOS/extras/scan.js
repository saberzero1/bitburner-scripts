/** @param {NS} ns */
export let main = (ns,c="home",l,p='') => {
  ns.tprintf(p+(l?"┣":"┗")+c);
  ns.scan(c).map((e,i,a)=>(i||(c=="home"))&&main(ns,e,i+1!=a.length,p+(l?"┃":" ")));
}