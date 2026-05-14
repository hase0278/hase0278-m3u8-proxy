import https from "node:https";
import http from "node:http";
import { pipeline } from "node:stream/promises";
import httpUtils from './http.js';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, rejectUnauthorized: true });
const httpsAgentInsecure = new https.Agent({ keepAlive: true, maxSockets: 64, rejectUnauthorized: false });

function parseHeaders(headersParam) {
    const BLOCKED = new Set([
        "access-control-allow-origin",
        "access-control-allow-methods",
        "access-control-allow-headers",
        "host",
    ]);
    const headers = { "User-Agent": httpUtils.userAgent };
    if (!headersParam) return headers;
    try {
        const extra = JSON.parse(decodeURIComponent(headersParam));
        for (const [k, v] of Object.entries(extra)) {
            if (!BLOCKED.has(k.toLowerCase())) headers[k] = v;
        }
    } catch (_) { }
    return headers;
}

function proxyPipe(req, res, url, headers, { allowInsecureTLS = false, transform = null, extraResHeaders = {} } = {}) {
    return new Promise((resolve) => {
        const isHttps = url.protocol === "https:";
        const agent = isHttps
            ? (allowInsecureTLS ? httpsAgentInsecure : httpsAgent)
            : httpAgent;

        const rangeHeader = req.headers["range"];
        const reqHeaders = {
            ...headers,
            ...(rangeHeader ? { range: rangeHeader } : {}),
        };

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: req.method === "HEAD" ? "HEAD" : "GET",
            headers: reqHeaders,
            agent,
            timeout: 15000,
        };

        const proto = isHttps ? https : http;

        const proxyReq = proto.request(options, (proxyRes) => {
            const outHeaders = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                ...extraResHeaders,
            };

            const forward = [
                "content-type", "content-length", "content-range",
                "accept-ranges", "cache-control", "expires", "last-modified", "etag",
            ];
            for (const h of forward) {
                if (proxyRes.headers[h]) outHeaders[h] = proxyRes.headers[h];
            }

            if (!transform) {
                // --- KEY FIX ---
                // pipeline() destroys BOTH streams if either side errors or closes early.
                // With plain .pipe(), an ECONNRESET on proxyRes orphans res open forever.
                res.writeHead(proxyRes.statusCode, outHeaders);
                pipeline(proxyRes, res)
                    .catch((err) => {
                        // Headers already sent — can't change status code.
                        // Destroying the socket is the only way to signal the client to stop.
                        if (!res.destroyed) {
                            res.destroy(err);
                        }
                    })
                    .finally(resolve);

            } else {
                // m3u8 rewrite: buffer text (these files are small, ~10-50 KB)
                const chunks = [];
                proxyRes.on("data", (c) => chunks.push(c));
                proxyRes.on("end", () => {
                    try {
                        const body = transform(Buffer.concat(chunks).toString("utf8"));
                        outHeaders["content-length"] = Buffer.byteLength(body).toString();
                        delete outHeaders["transfer-encoding"];
                        res.writeHead(proxyRes.statusCode, outHeaders);
                        res.end(body);
                    } catch (err) {
                        if (!res.headersSent) res.status(500).json({ message: err.message });
                        else if (!res.destroyed) res.destroy(err);
                    }
                    resolve();
                });
                proxyRes.on("error", (err) => {
                    console.error("m3u8 buffer error:", err.message);
                    if (!res.headersSent) res.status(502).json({ message: "Upstream reset.", error: err.message });
                    else if (!res.destroyed) res.destroy(err);
                    resolve();
                });
            }
        });

        proxyReq.on("timeout", () => {
            proxyReq.destroy();
            if (!res.headersSent) res.status(504).json({ message: "Upstream timed out." });
            else if (!res.destroyed) res.destroy();
            resolve();
        });

        proxyReq.on("error", (err) => {
            console.error("Proxy error:", err.message);
            if (err.code === "ECONNRESET" && !res.headersSent) {
                // Retry once with a fresh connection
                return proxyPipe(req, res, url, headers, options).then(resolve);
            }
            if (!res.headersSent) res.status(502).json({ message: "Upstream error.", error: err.message });
            else if (!res.destroyed) res.destroy(err); // <-- was silently doing nothing before
            resolve();
        });

        if (req.method !== "GET" && req.method !== "HEAD") {
            req.pipe(proxyReq, { end: true });
        } else {
            proxyReq.end();
        }
    });
}

// --- Route handler (unchanged) ---

export default async function m3u8ProxyRoute(req, res) {
    if (req.method === "OPTIONS") {
        res.set({
            "Access-Control-Allow-Origin": "*",
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
    const headers = parseHeaders(headersParam);

    const proxyUrl = (rawUrl) =>
        `/m3u8-proxy?url=${encodeURIComponent(rawUrl)}${headersParam ? `&headers=${encodeURIComponent(headersParam)}` : ""}`;

    try {
        const pathname = url.pathname.toLowerCase();
        const isMp4 = pathname.endsWith(".mp4");
        const isM3u8 = pathname.endsWith(".m3u8");
        const isTs = pathname.endsWith(".ts");
        const isKey = pathname.endsWith(".key");
        const isImage = /\.(png|jpg|jpeg|gif|svg|avif|webp)(\?.*)?$/.test(pathname);

        if (isM3u8) {
            const baseDir = `${url.origin}${url.pathname.replace(/[^/]+$/, "")}`;
            const transform = (text) => {
                return text.split("\n").map((line) => {
                    if (line.startsWith("#EXT-X-KEY")) {
                        return line.replace(/(URI=")([^"]+)(")/, (_, a, uri, c) => {
                            const absolute = uri.startsWith("http") ? uri : new URL(uri, baseDir).href;
                            return `${a}${proxyUrl(absolute)}${c}`;
                        });
                    }
                    if (line.startsWith("#") || line.trim() === "") return line;
                    const absolute = line.startsWith("http")
                        ? line
                        : new URL(line.startsWith("/") ? line : line, baseDir).href;
                    return proxyUrl(absolute);
                }).join("\n");
            };
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
        } else if (isImage) {
            await proxyPipe(req, res, url, headers);
        } else {
            await proxyPipe(req, res, url, headers);
        }
    } catch (err) {
        console.error("m3u8-proxy unhandled error:", err);
        if (!res.headersSent) res.status(500).json({ message: err.message });
        else if (!res.destroyed) res.destroy(err);
    }
}