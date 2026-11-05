// Local preview: serves public/ and the api/ routes on http://localhost:3000. Reads GROQ_API_KEY from .env.local if present.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = import.meta.dirname;
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname.match(/^\/api\/(new|talk|guess)$/);
  if (route) return (await import(`./api/${route[1]}.js`)).default(req, res);
  const file = path.join(root, "public", url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(3000, () => console.log("Seven Locks on http://localhost:3000" + (process.env.GROQ_API_KEY ? "" : "  (no GROQ_API_KEY yet: the Lockkeeper can't talk)")));
