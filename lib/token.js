// A lock's password travels to the browser only inside an encrypted, tamper-proof token (AES-256-GCM).
// The key is derived from TOKEN_SECRET, or from GROQ_API_KEY when no separate secret is set.
import crypto from "node:crypto";

function key() {
  const secret = process.env.TOKEN_SECRET || process.env.GROQ_API_KEY;
  if (!secret) throw Object.assign(new Error("no token secret"), { code: "not_configured" });
  return crypto.createHash("sha256").update("seven-locks-token:" + secret).digest();
}

export function seal(data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function open(token) {
  try {
    const buf = Buffer.from(String(token), "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
  } catch (e) {
    if (e && e.code === "not_configured") throw e;
    return null;
  }
}
