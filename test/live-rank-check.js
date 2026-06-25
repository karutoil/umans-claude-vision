// one-off: confirm live ranking against the real Umans catalog
const src = require("fs").readFileSync(__dirname + "/../mcp/server.js", "utf8");
const fns = src.match(/const PREFERENCE[\s\S]*?function rank\([\s\S]*?\n\}/)?.[0];
eval(fns);

fetch("https://api.code.umans.ai/v1/models/info")
  .then((r) => r.json())
  .then((d) => {
    const ranked = rank(Object.values(d)).map((m) => m.name);
    console.log("live vision order:", ranked.join(" -> "));
    console.log("GLM excluded (via-handoff != true):", !ranked.some((n) => n.includes("glm")));
    console.log("Kimi first:", /kimi/i.test(ranked[0]));
  });
