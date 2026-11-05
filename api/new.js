// POST {level} -> {token}: a fresh random password for that lock, sealed so only the server can read it.
import { pickWord } from "../lib/game.js";
import { seal } from "../lib/token.js";
import { send, readBody, level, fail } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  const l = level((await readBody(req)).level);
  if (l === null) return send(res, 400, { error: "bad_level" });
  try { return send(res, 200, { token: seal({ l, pw: pickWord(l) }) }); }
  catch (e) { return fail(res, e); }
}
