// Small helpers shared by the API routes: JSON in/out, a per-visitor rate limit, and error mapping.

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) break; }
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

// Best effort: each server instance keeps its own window, which is enough to stop one tab from flooding the shared Groq quota.
const hits = new Map();
export function tooMany(req, limit = 12, windowMs = 60_000) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}

export function level(n) {
  const l = Number(n);
  return Number.isInteger(l) && l >= 0 && l <= 6 ? l : null;
}

export function fail(res, e) {
  if (e && e.code === "rate_limited") return send(res, 429, { error: "rate_limited" });
  if (e && e.code === "not_configured") return send(res, 503, { error: "not_configured" });
  console.error(e);
  return send(res, 502, { error: "upstream_error" });
}
