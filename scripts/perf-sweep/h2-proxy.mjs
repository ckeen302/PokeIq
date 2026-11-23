/**
 * A local HTTP/2 (TLS) front for `next start`, so the sweep can measure with the request multiplexing and
 * prioritisation a CDN gives (next start speaks HTTP/1.1, where six connections queue everything else).
 *
 *   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj "/CN=localhost"
 *   node scripts/perf-sweep/h2-proxy.mjs <key.pem> <cert.pem> [listenPort=3443] [upstream=http://localhost:3000]
 *   node scripts/perf-sweep/measure.mjs https://localhost:3443 --profile=phone --insecure
 */
import http2 from "node:http2";
import http from "node:http";
import fs from "node:fs";

const [key, cert, port = "3443", upstream = "http://localhost:3000"] = process.argv.slice(2);
const up = new URL(upstream);
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "http2-settings", "host"]);

http2
  .createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert), allowHTTP1: false }, (req, res) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!k.startsWith(":") && !HOP.has(k)) headers[k] = v;
    headers.host = up.host;
    const p = http.request({ host: up.hostname, port: up.port, method: req.method, path: req.url, headers, agent }, (r) => {
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
      res.writeHead(r.statusCode, out);
      r.pipe(res);
    });
    p.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(p);
  })
  .listen(Number(port), () => console.log(`h2 proxy on https://localhost:${port} → ${upstream}`));
