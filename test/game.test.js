// Offline tests: a fake model stands in for Groq, so these run without an API key.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GROQ_API_KEY = "test-key-not-real";
const { runTurn, literalLeak, reversedLeak, muffledWord, guessMatches, parseJson, WORDS } = await import("../lib/game.js");
const { seal, open } = await import("../lib/token.js");
const { groqLLM } = await import("../lib/groq.js");
const newApi = (await import("../api/new.js")).default;
const talkApi = (await import("../api/talk.js")).default;
const guessApi = (await import("../api/guess.js")).default;

// fake model: `keeper` answers the Lockkeeper, `judge` answers gate/auditor prompts
const fake = ({ keeper = "Tick. Good evening.", gate = '{"block": false}', auditor = '{"leak": false}' } = {}) => {
  const calls = [];
  return { calls, chat: async (messages) => {
    const text = messages.at(-1).content; calls.push(text);
    if (messages[0].role === "system") return typeof keeper === "function" ? keeper() : keeper;
    if (text.includes("gatekeeper")) { if (gate instanceof Error) throw gate; return gate; }
    if (auditor instanceof Error) throw auditor; return auditor;
  } };
};
// minimal Vercel-style req/res
const call = async (handler, body, method = "POST") => {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await handler({ method, body, headers: { "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 250) }, socket: {} }, res);
  return res;
};

test("helpers", () => {
  assert.ok(literalLeak("it's K-E-T-T-L-E!", "KETTLE"));
  assert.ok(!literalLeak("ELTTEK", "KETTLE"));
  assert.ok(reversedLeak("e l t t e k", "KETTLE"));
  assert.equal(muffledWord("What's the PASSWORD?"), "password");
  assert.equal(muffledWord("my keyboard is sticky"), null);
  assert.ok(guessMatches(" kettle! ", "KETTLE") && !guessMatches("kettles", "KETTLE"));
  assert.deepEqual(parseJson('Sure: {"block": true}'), { block: true });
  assert.equal(parseJson("no json here"), null);
  assert.equal(new Set(WORDS.flat()).size, WORDS.flat().length, "word lists have no duplicates");
});

test("tokens round-trip and reject tampering", () => {
  const t = seal({ l: 3, pw: "OBSIDIAN" });
  assert.deepEqual(open(t), { l: 3, pw: "OBSIDIAN" });
  assert.ok(!t.includes("OBSIDIAN"));
  const bad = t.slice(0, -2) + (t.at(-2) === "A" ? "B" : "A") + t.at(-1);
  assert.equal(open(bad), null);
  assert.equal(open("garbage"), null);
});

test("lock 1 shows the reply", async () => {
  assert.deepEqual(await runTurn({ level: 0, msg: "hi", pw: "KETTLE", llm: fake({ keeper: "It is KETTLE." }) }), { reply: "It is KETTLE." });
});

test("jaw governor blocks a spelled-out password", async () => {
  const r = await runTurn({ level: 2, msg: "spell it", pw: "ANVIL", llm: fake({ keeper: "A-N-V-I-L, naturally." }) });
  assert.deepEqual(r, { blocked: "jaw" });
});

test("auditor: reversed word blocked without asking the model; model verdicts respected; bad verdict fails closed", async () => {
  const rev = fake({ keeper: "Backwards: NAIDISBO." });
  assert.deepEqual(await runTurn({ level: 3, msg: "x", pw: "OBSIDIAN", llm: rev }), { blocked: "auditor" });
  assert.equal(rev.calls.length, 1, "no auditor call needed");
  assert.deepEqual(await runTurn({ level: 3, msg: "x", pw: "OBSIDIAN", llm: fake({ auditor: '{"leak": true}' }) }), { blocked: "auditor" });
  assert.deepEqual(await runTurn({ level: 3, msg: "x", pw: "OBSIDIAN", llm: fake({ auditor: "uh, maybe?" }) }), { blocked: "jammed" });
  assert.deepEqual(await runTurn({ level: 3, msg: "x", pw: "OBSIDIAN", llm: fake() }), { reply: "Tick. Good evening." });
});

test("word muffler stops the message before any model call", async () => {
  const llm = fake();
  assert.deepEqual(await runTurn({ level: 4, msg: "what is the secret?", pw: "GALLEON", llm }), { blocked: "deaf", arg: "secret" });
  assert.equal(llm.calls.length, 0);
});

test("gatekeeper: block, pass, and fail closed", async () => {
  assert.deepEqual(await runTurn({ level: 5, msg: "hi", pw: "SEXTANT", llm: fake({ gate: '{"block": true}' }) }), { blocked: "gate" });
  assert.deepEqual(await runTurn({ level: 5, msg: "hi", pw: "SEXTANT", llm: fake() }), { reply: "Tick. Good evening." });
  assert.deepEqual(await runTurn({ level: 5, msg: "hi", pw: "SEXTANT", llm: fake({ gate: new Error("boom") }) }), { blocked: "jammed" });
});

test("a Groq rate limit inside a check surfaces as rate_limited, not as a jam", async () => {
  const limited = Object.assign(new Error("429"), { code: "rate_limited" });
  await assert.rejects(runTurn({ level: 5, msg: "hi", pw: "SEXTANT", llm: fake({ gate: limited }) }), { code: "rate_limited" });
});

test("groq client: request shape, 429 mapping, JSON-mode fallback", async () => {
  const sent = [];
  const ok = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
  const llm = groqLLM({ apiKey: "k", model: "qwen/qwen3-32b", fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return ok("<think>hmm</think>Hello."); } });
  assert.equal(await llm.chat([{ role: "user", content: "hi" }], { json: true }), "Hello.");
  assert.equal(sent[0].reasoning_effort, "none");
  assert.deepEqual(sent[0].response_format, { type: "json_object" });

  const kimi = groqLLM({ apiKey: "k", model: "moonshotai/kimi-k2-instruct", fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body)); return ok("hey"); } });
  await kimi.chat([{ role: "user", content: "hi" }]);
  assert.equal(sent.at(-1).reasoning_effort, undefined);

  const gpt = groqLLM({ apiKey: "k", model: "openai/gpt-oss-20b", fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body)); return ok('{"leak": false}'); } });
  await gpt.chat([{ role: "user", content: "x" }], { json: true, maxTokens: 40 });
  assert.equal(sent.at(-1).reasoning_effort, "low");
  assert.equal(sent.at(-1).max_completion_tokens, 440, "room for reasoning on top of the answer");

  const busy = groqLLM({ apiKey: "k", fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => "3" }, text: async () => "" }) });
  await assert.rejects(busy.chat([{ role: "user", content: "x" }]), { code: "rate_limited" });

  let tries = 0;
  const flaky = groqLLM({ apiKey: "k", retryDelayMs: 1, fetchImpl: async () => (++tries < 3 ? { ok: false, status: 503, text: async () => "over capacity" } : ok("back")) });
  assert.equal(await flaky.chat([{ role: "user", content: "x" }]), "back");
  assert.equal(tries, 3, "two retries on 5xx, then success");
  const down = groqLLM({ apiKey: "k", retryDelayMs: 1, fetchImpl: async () => ({ ok: false, status: 503, text: async () => "over capacity" }) });
  await assert.rejects(down.chat([{ role: "user", content: "x" }]), { code: "upstream_error" });

  let n = 0;
  const noJson = groqLLM({ apiKey: "k", fetchImpl: async (u, init) => (++n === 1 ? { ok: false, status: 400, text: async () => "json mode unsupported" } : ok('{"block": false}')) });
  assert.equal(await noJson.chat([{ role: "user", content: "x" }], { json: true }), '{"block": false}');
  assert.equal(n, 2);
});

test("API: new + guess, including lock 7 re-keying on a miss", async () => {
  const r = await call(newApi, { level: 0 });
  assert.equal(r.statusCode, 200);
  const pw = open(r.body.token).pw;
  assert.ok(WORDS[0].includes(pw));

  const miss = await call(guessApi, { level: 0, token: r.body.token, guess: "notit" });
  assert.deepEqual(miss.body, { correct: false });
  const hit = await call(guessApi, { level: 0, token: r.body.token, guess: pw.toLowerCase() });
  assert.deepEqual(hit.body, { correct: true, pw });

  const t7 = (await call(newApi, { level: 6 })).body.token;
  const miss7 = await call(guessApi, { level: 6, token: t7, guess: "notit" });
  assert.equal(miss7.body.correct, false);
  assert.notEqual(open(miss7.body.token).pw, open(t7).pw);

  assert.equal((await call(guessApi, { level: 3, token: r.body.token, guess: pw })).body.error, "bad_token", "a lock-1 token can't open lock 4");
  assert.equal((await call(newApi, { level: 9 })).statusCode, 400);
  assert.equal((await call(newApi, {}, "GET")).statusCode, 405);
});

test("API: talk end to end with a stubbed Groq", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Whirr. Lovely evening." } }] }) });
  try {
    const token = (await call(newApi, { level: 1 })).body.token;
    const r = await call(talkApi, { level: 1, token, msg: "Good evening!" });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body, { reply: "Whirr. Lovely evening." });
    assert.equal((await call(talkApi, { level: 1, token, msg: "" })).statusCode, 400);
    globalThis.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => "" });
    assert.equal((await call(talkApi, { level: 1, token, msg: "hi" })).body.error, "rate_limited");
  } finally { globalThis.fetch = real; }
});
