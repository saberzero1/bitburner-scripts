// Everything outside the Go rules/AI: inert. Any export is a no-op function that is also an empty object.
const noop = function () { return undefined; };
const handler = { get: (_t, k) => (k === "__esModule" ? true : k === "default" ? proxy : proxy), apply: () => undefined };
const proxy = new Proxy(noop, handler);
module.exports = proxy;
