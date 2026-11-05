// Calls Groq's OpenAI-compatible chat API. The key comes from the GROQ_API_KEY environment variable and never leaves the server.

const URL = "https://api.groq.com/openai/v1/chat/completions";
export const MODEL = process.env.GROQ_MODEL || "qwen/qwen3-32b";

const clean = t => String(t).replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

export function groqLLM({ apiKey = process.env.GROQ_API_KEY, model = MODEL, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Object.assign(new Error("GROQ_API_KEY is not set"), { code: "not_configured" });
  let jsonMode = true;
  async function chat(messages, { json = false, temperature = 0.7, maxTokens = 256 } = {}) {
    const body = { model, messages, temperature, max_completion_tokens: maxTokens };
    if (/qwen3/i.test(model)) body.reasoning_effort = "none";   // answer directly, no hidden thinking
    if (json && jsonMode) body.response_format = { type: "json_object" };
    const res = await fetchImpl(URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (res.status === 429) throw Object.assign(new Error("Groq rate limit"), { code: "rate_limited", retryAfter: res.headers.get("retry-after") });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (body.response_format && res.status === 400) { jsonMode = false; return chat(messages, { json, temperature, maxTokens }); }
      throw Object.assign(new Error(`Groq ${res.status}: ${detail.slice(0, 200)}`), { code: "upstream_error" });
    }
    const data = await res.json();
    return clean(data.choices?.[0]?.message?.content || "");
  }
  return { chat, model };
}
