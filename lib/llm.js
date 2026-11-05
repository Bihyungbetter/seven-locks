// The Lockkeeper's model, behind one OpenAI-compatible chat API. Keys come from environment variables and never leave the server.
// OPENAI_API_KEY set -> OpenAI (default gpt-5.4-mini). Otherwise GROQ_API_KEY -> Groq (default openai/gpt-oss-20b).
// LLM_MODEL (or the older GROQ_MODEL) overrides the model.

const PROVIDERS = {
  openai: { url: "https://api.openai.com/v1/chat/completions", keyVar: "OPENAI_API_KEY", model: "gpt-5.4-mini" },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", keyVar: "GROQ_API_KEY", model: "openai/gpt-oss-20b" },
};

export function provider(env = process.env) {
  const name = env.OPENAI_API_KEY ? "openai" : "groq";
  const p = PROVIDERS[name];
  return { name, url: p.url, apiKey: env[p.keyVar], model: env.LLM_MODEL || env.GROQ_MODEL || p.model };
}

const clean = t => String(t).replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

// Per-model request tweaks so every model answers directly and is never cut off mid-thought.
export function tune(model, body, maxTokens) {
  if (/qwen3/i.test(model)) body.reasoning_effort = "none";
  else if (/gpt-oss/i.test(model)) {                 // can't switch reasoning off: keep it short and leave room for it
    body.reasoning_effort = "low";
    body.include_reasoning = false;
    body.max_completion_tokens = maxTokens + 400;
  } else if (/^gpt-5/i.test(model)) body.reasoning_effort = "none";
  return body;
}

export function createLLM({ url, apiKey, model, fetchImpl = fetch, retryDelayMs = 600 } = provider()) {
  if (!apiKey) throw Object.assign(new Error("no API key is set"), { code: "not_configured" });
  let jsonMode = true;
  async function chat(messages, { json = false, temperature = 0.7, maxTokens = 256 } = {}) {
    const body = tune(model, { model, messages, temperature, max_completion_tokens: maxTokens }, maxTokens);
    if (json && jsonMode) body.response_format = { type: "json_object" };
    // providers answer 5xx ("over capacity") now and then; retry twice with a short backoff before giving up
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (res.status < 500 || attempt >= 2) break;
      await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
    if (res.status === 429) throw Object.assign(new Error("rate limit"), { code: "rate_limited" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (body.response_format && res.status === 400) { jsonMode = false; return chat(messages, { json, temperature, maxTokens }); }
      throw Object.assign(new Error(`${model} ${res.status}: ${detail.slice(0, 200)}`), { code: "upstream_error" });
    }
    const data = await res.json();
    return clean(data.choices?.[0]?.message?.content || "");
  }
  return { chat, model };
}
