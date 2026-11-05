// POST {level, token, guess} -> {correct, pw?} or {correct: false, token?}. Lock 7 hands back a new token on a miss.
import { guessMatches, pickWord, LOCKS } from "../lib/game.js";
import { open, seal } from "../lib/token.js";
import { send, readBody, level, tooMany, fail } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  if (tooMany(req, 30)) return send(res, 429, { error: "slow_down" });
  const body = await readBody(req);
  const l = level(body.level);
  if (l === null) return send(res, 400, { error: "bad_request" });
  try {
    const t = open(body.token);
    if (!t || t.l !== l) return send(res, 400, { error: "bad_token" });
    if (guessMatches(body.guess, t.pw)) return send(res, 200, { correct: true, pw: t.pw });
    if (LOCKS[l].defenses.includes("turning")) return send(res, 200, { correct: false, token: seal({ l, pw: pickWord(l, t.pw) }) });
    return send(res, 200, { correct: false });
  } catch (e) { return fail(res, e); }
}
