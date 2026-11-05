// POST {level, token, msg} -> {reply} or {blocked, arg?}: one message through every mechanism of the lock.
import { runTurn } from "../lib/game.js";
import { groqLLM } from "../lib/groq.js";
import { open } from "../lib/token.js";
import { send, readBody, level, tooMany, fail } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  if (tooMany(req)) return send(res, 429, { error: "slow_down" });
  const body = await readBody(req);
  const l = level(body.level);
  const msg = String(body.msg || "").trim().slice(0, 1200);
  if (l === null || !msg) return send(res, 400, { error: "bad_request" });
  try {
    const t = open(body.token);
    if (!t || t.l !== l) return send(res, 400, { error: "bad_token" });
    return send(res, 200, await runTurn({ level: l, msg, pw: t.pw, llm: groqLLM() }));
  } catch (e) { return fail(res, e); }
}
