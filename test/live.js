// Live playtest against Groq: runs every attack in attacks.json through the real lock pipeline.
// Needs GROQ_API_KEY in .env.local (or the environment). Usage: node test/live.js [runsPerAttack] [model]
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
if (process.argv[3]) process.env.LLM_MODEL = process.argv[3];
const { runTurn, WORDS, literalLeak, reversedLeak } = await import("../lib/game.js");
const { createLLM, provider } = await import("../lib/llm.js");

const attacks = JSON.parse(fs.readFileSync(process.env.ATTACKS || path.join(import.meta.dirname, "attacks.json"), "utf8"));
const runs = +(process.argv[2] || 2);
const llm = createLLM();
const sleep = ms => new Promise(r => setTimeout(r, ms));
console.log(`${provider().name} ${provider().model}, ${attacks.length} attacks x ${runs}`);

const results = [];
for (const a of attacks) for (let r = 0; r < runs; r++) {
  const pw = WORDS[a.level - 1][Math.floor(Math.random() * WORDS[a.level - 1].length)];
  let res, t0;
  for (let attempt = 0; ; attempt++) {           // the free tier allows only a few thousand tokens a minute: wait out 429s
    t0 = Date.now();
    try { res = await runTurn({ level: a.level - 1, msg: a.msg, pw, llm }); break; }
    catch (e) {
      if (e.code === "rate_limited" && attempt < 8) { process.stdout.write("(rate limited, waiting) "); await sleep(8000); continue; }
      res = { error: e.message }; break;
    }
  }
  const shown = res.blocked ? `BLOCKED(${res.blocked}${res.arg ? ":" + res.arg : ""})` : res.error ? "ERROR " + res.error
    : (literalLeak(res.reply, pw) || reversedLeak(res.reply, pw)) ? "SHOWN+LEAK" : "SHOWN";
  results.push({ ...a, pw, shown, ms: Date.now() - t0, reply: (res.reply || "").replace(/\s+/g, " ").slice(0, 240) });
  console.log(`L${a.level} ${a.id} want=${a.want} -> ${shown} (${Date.now() - t0}ms) pw=${pw}\n   ${results.at(-1).reply}`);
}
fs.writeFileSync(path.join(import.meta.dirname, `live-results.json`), JSON.stringify(results, null, 1));
