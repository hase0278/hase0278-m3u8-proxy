import https from "node:https";
import http from "node:http";
import { pipeline } from "node:stream/promises";
import httpUtils from './http.js';

// ─── Agent config ─────────────────────────────────────────────────────────────
const AGENT_CONFIG = {
  keepAlive: true,
  keepAliveMsecs: 500,    // more aggressive keep-alive probing
  maxSockets: 128,        // higher concurrency for parallel segment fetches
  maxFreeSockets: 32,     // keep more warm sockets ready
  freeSocketTimeout: 8000,// hold idle sockets longer for burst reuse
  timeout: 10000,         // tighter timeout = faster failure detection
  scheduling: "fifo",
};

const httpAgent  = new http.Agent(AGENT_CONFIG);
const httpsAgent = new https.Agent({ ...AGENT_CONFIG, rejectUnauthorized: true });
const httpsAgentInsecure = new https.Agent({ ...AGENT_CONFIG, rejectUnauthorized: false });

// Pre-built Set for O(1) blocked header lookup
const BLOCKED_HEADERS = new Set([
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "host",
]);

// Static CORS headers — allocated once, reused on every response
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

// Headers to forward from upstream — Set for O(1) lookup
const FORWARD_HEADERS = new Set([
  "content-type", "content-length", "content-range",
  "accept-ranges", "cache-control", "expires",
  "last-modified", "etag",
]);

function parseHeaders(headersParam) {
  const headers = { "User-Agent": httpUtils.userAgent };
  if (!headersParam) return headers;
  try {
    const extra = JSON.parse(decodeURIComponent(headersParam));
    for (const [k, v] of Object.entries(extra)) {
      if (!BLOCKED_HEADERS.has(k.toLowerCase())) headers[k] = v;
    }
  } catch (_) {}
  return headers;
}

// ─── Core proxy ───────────────────────────────────────────────────────────────
function proxyPipe(req, res, url, headers, {
  allowInsecureTLS = false,
  transform       = null,
  extraResHeaders = {},
} = {}) {
  return new Promise((resolve) => {
    const isHttps = url.protocol === "https:";
    const agent   = isHttps
      ? (allowInsecureTLS ? httpsAgentInsecure : httpsAgent)
      : httpAgent;

    const rangeHeader = req.headers["range"];
    const reqHeaders  = rangeHeader
      ? { ...headers, range: rangeHeader }
      : headers;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   req.method === "HEAD" ? "HEAD" : "GET",
      headers:  reqHeaders,
      agent,
      timeout:  10000,
    };

    const proto    = isHttps ? https : http;
    const proxyReq = proto.request(options, (proxyRes) => {
      // ── Build response headers ──────────────────────────────────────────
      const outHeaders = { ...CORS_HEADERS, ...extraResHeaders };

      for (const h of FORWARD_HEADERS) {
        const v = proxyRes.headers[h];
        if (v) outHeaders[h] = v;
      }

      // ── Hint the client to buffer aggressively ──────────────────────────
      // X-Content-Type-Options stops browser sniffing stalls.
      // Cache-Control: no-transform prevents gzip re-encoding by intermediaries.
      outHeaders["X-Content-Type-Options"] = "nosniff";
      if (!outHeaders["cache-control"]) {
        outHeaders["cache-control"] = "no-transform";
      }

      // ── Pass-through (binary segments: .ts / .mp4 / .key) ──────────────
      if (!transform) {
        // Disable Nagle on the *response* socket so small writes go out immediately.
        // This is the single biggest latency win for small .ts chunks.
        if (res.socket) res.socket.setNoDelay(true);

        res.writeHead(proxyRes.statusCode, outHeaders);

        pipeline(proxyRes, res)
          .catch((err) => { if (!res.destroyed) res.destroy(err); })
          .finally(resolve);

        return;
      }

      // ── M3U8 rewrite: buffer → transform → send ─────────────────────────
      // M3U8 files are tiny (~10–50 KB) so buffering is fine.
      const chunks = [];
      proxyRes.on("data",  (c) => chunks.push(c));
      proxyRes.on("end",   ()  => {
        try {
          const body = transform(Buffer.concat(chunks).toString("utf8"));
          const len  = Buffer.byteLength(body);
          outHeaders["content-length"] = String(len);
          delete outHeaders["transfer-encoding"];      // must not conflict with content-length
          outHeaders["cache-control"] = "no-cache";    // playlists must never be stale
          res.writeHead(proxyRes.statusCode, outHeaders);
          res.end(body);
        } catch (err) {
          if (!res.headersSent)  res.status(500).json({ message: err.message });
          else if (!res.destroyed) res.destroy(err);
        }
        resolve();
      });
      proxyRes.on("error", (err) => {
        if (!res.headersSent)  res.status(502).json({ message: "Upstream reset.", error: err.message });
        else if (!res.destroyed) res.destroy(err);
        resolve();
      });
    });

    // ── Upstream timeout ────────────────────────────────────────────────────
    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent)  res.status(504).json({ message: "Upstream timed out." });
      else if (!res.destroyed) res.destroy();
      resolve();
    });

    // ── Upstream error — retry once on ECONNRESET ───────────────────────────
    proxyReq.on("error", (err) => {
      if (err.code === "ECONNRESET" && !res.headersSent) {
        return proxyPipe(req, res, url, headers, { allowInsecureTLS, transform, extraResHeaders })
          .then(resolve);
      }
      if (!res.headersSent)  res.status(502).json({ message: "Upstream error.", error: err.message });
      else if (!res.destroyed) res.destroy(err);
      resolve();
    });

    if (req.method !== "GET" && req.method !== "HEAD") {
      req.pipe(proxyReq, { end: true });
    } else {
      proxyReq.end();
    }
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────
export default async function m3u8ProxyRoute(req, res) {
  if (req.method === "OPTIONS") {
    res.set({
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "range, *",
    }).sendStatus(204);
    return;
  }

  let url;
  try {
    url = new URL(req.query.url);
  } catch {
    return res.status(400).json({ message: "Invalid or missing `url` query param." });
  }

  const headersParam = req.query.headers || "";
  const headers      = parseHeaders(headersParam);

  const proxyUrl = (rawUrl) =>
    `/m3u8-proxy?url=${encodeURIComponent(rawUrl)}${headersParam ? `&headers=${encodeURIComponent(headersParam)}` : ""}`;

  try {
    const pathname = url.pathname.toLowerCase();
    const isM3u8   = pathname.endsWith(".m3u8") || pathname.endsWith(".txt");
    const isTs     = pathname.endsWith(".ts");
    const isMp4    = pathname.endsWith(".mp4");
    const isKey    = pathname.endsWith(".key");
    const isImage  = /\.(png|jpg|jpeg|gif|svg|avif|webp)(\?.*)?$/.test(pathname);

    if (isM3u8) {
      const baseDir = `${url.origin}${url.pathname.replace(/[^/]+$/, "")}`;
      const transform = (text) =>
        text.split("\n").map((line) => {
          if (line.startsWith("#EXT-X-KEY")) {
            return line.replace(/(URI=")([^"]+)(")/, (_, a, uri, c) => {
              const absolute = uri.startsWith("http") ? uri : new URL(uri, baseDir).href;
              return `${a}${proxyUrl(absolute)}${c}`;
            });
          }
          if ((line.startsWith("#") || line.trim() === "") && !line.startsWith("#EXT-X-MAP:URI=")) return line;
          if (line.startsWith("#EXT-X-MAP:URI=")) {
            const mapUri = line.split('"')[1];
            const absolute = mapUri.startsWith("http") ? mapUri : new URL(mapUri, baseDir).href;
            return line.replace(mapUri, proxyUrl(absolute));
          }
          const absolute = line.startsWith("http")
            ? line
            : new URL(line.startsWith("/") ? line : line, baseDir).href;
          return proxyUrl(absolute);
        }).join("\n");

      await proxyPipe(req, res, url, headers, {
        transform,
        extraResHeaders: { "content-type": "application/vnd.apple.mpegurl" },
      });

    } else if (isTs || isMp4 || pathname.includes("video")) {
      await proxyPipe(req, res, url, headers, { allowInsecureTLS: isMp4 });

    } else if (isKey) {
      await proxyPipe(req, res, url, headers, {
        extraResHeaders: { "content-type": "application/octet-stream" },
      });

    } else {
        console.log(`[m3u8-proxy] Unknown path: ${pathname}`);
      // images + unknown — simple passthrough
      await proxyPipe(req, res, url, headers);
    }

  } catch (err) {
    if (!res.headersSent)  res.status(500).json({ message: err.message });
    else if (!res.destroyed) res.destroy(err);
  }
}