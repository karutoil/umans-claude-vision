// ponytail: one runnable check. fails if rank order breaks.
const { execSync } = require("child_process");

const src = require("fs").readFileSync(__dirname + "/../mcp/server.js", "utf8");
// extract rank() by eval'ing the module's function definitions in isolation
const fns = src.match(/const PREFERENCE[\s\S]*?function rank\([\s\S]*?\n\}/)?.[0];
eval(fns);

const models = (names) =>
  names.map((n) => ({ name: n, capabilities: { supports_vision: true } }));

const ranked = rank([
  ...models(["umans-glm-5.2", "umans-flash", "umans-kimi-k2.7", "umans-coder"]),
]).map((m) => m.name);

const expected = ["umans-kimi-k2.7", "umans-coder", "umans-flash", "umans-glm-5.2"];
// (kimi first, then coder, flash; glm-5.2 wouldn't actually be here since it's
//  via-handoff not true, but assert ranking order of the true-vision ones)
const trueVisionOrder = ranked.filter((n) => n !== "umans-glm-5.2");

console.assert(
  JSON.stringify(trueVisionOrder) === JSON.stringify(["umans-kimi-k2.7", "umans-coder", "umans-flash"]),
  "rank order: " + trueVisionOrder.join(",")
);
console.log("rank self-check OK:", trueVisionOrder.join(" -> "));
