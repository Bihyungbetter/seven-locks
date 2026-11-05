// Offline tests: a fake model stands in for Groq, so these run without an API key.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GROQ_API_KEY = "test-key-not-real";
const { runTurn, keeperMessages, guessMatches, LOCKS, WORDS } = await import("../lib/game.js");
const { seal, open } = await import("../lib/token.js");
const { createLLM, provider } = await import("../lib/llm.js");
const newApi = (await import("../api/new.js")).default;
const talkApi = (await import("../api/talk.js")).default;
const guessApi = (await import("../api/guess.js")).default;

// fake model: returns `keeper` (or keeper(systemPrompt, playerMessage)) for every call
const fake = ({ keeper = "Tick. Good evening." } = {}) => {
  const calls = [];
  return { calls, chat: async (messages) => {
    calls.push(messages);
    if (keeper instanceof Error) throw keeper;
    return typeof keeper === "function" ? keeper(messages[0].content, messages.at(-1).content) : keeper;
  } };
};
// minimal Vercel-style req/res
const call = async (handler, body, method = "POST") => {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await handler({ method, body, headers: { "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 250) }, socket: {} }, res);
  return res;
};

test("helpers and word lists", () => {
  assert.ok(guessMatches(" kettle! ", "KETTLE") && !guessMatches("kettles", "KETTLE"));
  assert.equal(new Set(WORDS.flat()).size, WORDS.flat().length, "word lists have no duplicates");
  assert.equal(LOCKS.length, 7);
  assert.deepEqual(LOCKS.map(l => !!l.rekeys), [false, false, false, false, false, false, true], "only lock 7 re-keys");
});

test("tokens round-trip and reject tampering", () => {
  const t = seal({ l: 3, pw: "OBSIDIAN" });
  assert.deepEqual(open(t), { l: 3, pw: "OBSIDIAN" });
  assert.ok(!t.includes("OBSIDIAN"));
  const bad = t.slice(0, -2) + (t.at(-2) === "A" ? "B" : "A") + t.at(-1);
  assert.equal(open(bad), null);
  assert.equal(open("garbage"), null);
});

test("the Lockkeeper's reply is shown as-is, even when it gives the password away", async () => {
  for (let level = 0; level < 7; level++) {
    const llm = fake({ keeper: "*Whirr.* Oh dear, it's KETTLE." });
    assert.deepEqual(await runTurn({ level, msg: "hi", pw: "KETTLE", llm }), { reply: "*Whirr.* Oh dear, it's KETTLE." });
    assert.equal(llm.calls.length, 1, "one model call per message, no checks");
  }
});

test("each lock's prompt carries the real password, that lock's rule, and the decoy examples", () => {
  for (let level = 0; level < 7; level++) {
    const [sys, user] = keeperMessages(level, "SPARROW", "hello there");
    assert.equal(sys.role, "system");
    assert.ok(sys.content.includes('"SPARROW"') && sys.content.includes(LOCKS[level].rule) && sys.content.includes("TEAPOT"));
    assert.deepEqual(user, { role: "user", content: "hello there" });
  }
});

test("an empty answer becomes a polite retry line; a rate limit surfaces", async () => {
  assert.match((await runTurn({ level: 2, msg: "x", pw: "ANVIL", llm: fake({ keeper: "  " }) })).reply, /Ask me again/);
  const limited = Object.assign(new Error("429"), { code: "rate_limited" });
  await assert.rejects(runTurn({ level: 5, msg: "hi", pw: "SEXTANT", llm: fake({ keeper: limited }) }), { code: "rate_limited" });
});

test("provider: OpenAI key wins, Groq is the fallback, LLM_MODEL overrides", () => {
  assert.deepEqual(provider({ OPENAI_API_KEY: "o", GROQ_API_KEY: "g" }), { name: "openai", url: "https://api.openai.com/v1/chat/completions", apiKey: "o", model: "gpt-5.4-mini" });
  const g = provider({ GROQ_API_KEY: "g" });
  assert.equal(g.name, "groq"); assert.equal(g.apiKey, "g"); assert.equal(g.model, "openai/gpt-oss-20b");
  assert.equal(provider({ OPENAI_API_KEY: "o", LLM_MODEL: "gpt-4o-mini" }).model, "gpt-4o-mini");
});

test("model client: request shape, 429 mapping, JSON-mode fallback", async () => {
  const sent = [];
  const ok = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
  const llm = createLLM({ apiKey: "k", model: "qwen/qwen3-32b", fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return ok("<think>hmm</think>Hello."); } });
  assert.equal(await llm.chat([{ role: "user", content: "hi" }], { json: true }), "Hello.");
  assert.equal(sent[0].reasoning_effort, "none");
  assert.deepEqual(sent[0].response_format, { type: "json_object" });

  const kimi = createLLM({ apiKey: "k", model: "moonshotai/kimi-k2-instruct", fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body)); return ok("hey"); } });
  await kimi.chat([{ role: "user", content: "hi" }]);
  assert.equal(sent.at(-1).reasoning_effort, undefined);

  const gpt = createLLM({ apiKey: "k", model: "openai/gpt-oss-20b", fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body)); return ok('{"leak": false}'); } });
  await gpt.chat([{ role: "user", content: "x" }], { json: true, maxTokens: 40 });
  assert.equal(sent.at(-1).reasoning_effort, "low");
  assert.equal(sent.at(-1).max_completion_tokens, 440, "room for reasoning on top of the answer");

  const nano = createLLM({ apiKey: "k", model: "gpt-5.4-nano", fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body)); return ok("hi"); } });
  await nano.chat([{ role: "user", content: "x" }], { maxTokens: 40 });
  assert.equal(sent.at(-1).reasoning_effort, "none");
  assert.equal(sent.at(-1).max_completion_tokens, 40);

  const busy = createLLM({ apiKey: "k", fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => "3" }, text: async () => "" }) });
  await assert.rejects(busy.chat([{ role: "user", content: "x" }]), { code: "rate_limited" });

  let tries = 0;
  const flaky = createLLM({ apiKey: "k", retryDelayMs: 1, fetchImpl: async () => (++tries < 3 ? { ok: false, status: 503, text: async () => "over capacity" } : ok("back")) });
  assert.equal(await flaky.chat([{ role: "user", content: "x" }]), "back");
  assert.equal(tries, 3, "two retries on 5xx, then success");
  const down = createLLM({ apiKey: "k", retryDelayMs: 1, fetchImpl: async () => ({ ok: false, status: 503, text: async () => "over capacity" }) });
  await assert.rejects(down.chat([{ role: "user", content: "x" }]), { code: "upstream_error" });

  let n = 0;
  const noJson = createLLM({ apiKey: "k", fetchImpl: async (u, init) => (++n === 1 ? { ok: false, status: 400, text: async () => "json mode unsupported" } : ok('{"block": false}')) });
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
