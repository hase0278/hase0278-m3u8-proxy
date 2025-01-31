import https from "node:https";
import http from "node:http";
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';


const app = express();
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server Listening on PORT:", PORT);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'html', 'playground.html'));
});

app.get("/m3u8-proxy", async (req, res) => {
    let responseSent = false;

    const safeSendResponse = (statusCode, data) => {
        try {
            if (!responseSent) {
                responseSent = true;
                res.status(statusCode).send(data);
            }
        }
        catch (err) {

        }
    };
    try {
        const url = new URL(req.query.url);
        const headersParam = decodeURIComponent(req.query.headers || "");

        if (!url) {
            safeSendResponse(400, { message: "Invalid URL" });
        }

        const headers = {
            "User-Agent": httpUtils.userAgent
        };
        if (headersParam) {
            const additionalHeaders = JSON.parse(headersParam);
            Object.entries(additionalHeaders).forEach(([key, value]) => {
                if (!["Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"].includes(key)) {
                    headers[key] = value;
                }
            });
        }
        if (url.pathname.endsWith(".mp4")) {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        }
        else {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
        }
        const targetResponse = await fetch(url, {
            headers: headers,
        });

        let modifiedM3u8;
        let forceHTTPS = false;
        if (url.pathname.endsWith(".m3u8") || targetResponse.headers.get('content-type')?.includes("mpegURL")) {
            modifiedM3u8 = await targetResponse.text();
            const targetUrlTrimmed = `${url.origin}${url.pathname.replace(/[^/]+\.m3u8$/, "").trim()}`;
            modifiedM3u8 = modifiedM3u8.split("\n").map((line) => {
                if (line.startsWith("#EXT-X-KEY")) {
                    // Regex to extract and replace URI
                    const uriRegex = /(URI=")([^"]+)(")/;

                    // Extract the current URI
                    const match = line.match(uriRegex);
                    if(match){
                        return line.replace(match[2], `/m3u8-proxy?url=${encodeURIComponent(match[2])}${headersParam ? `&headers=${encodeURIComponent(headersParam)}` : ""}`);
                    }
                }
                if (line.startsWith("#") || line.trim() == '') {
                    return line;
                }
                let finalUrl = undefined;
                if (line.startsWith("http://") || line.startsWith("https://")) {
                    finalUrl = line;
                }
                else if (line.startsWith('/')) {
                    if (targetUrlTrimmed.endsWith('/')) {
                        finalUrl = `${targetUrlTrimmed}${line.replace('/', '')}`;
                    }
                    else {
                        finalUrl = `${targetUrlTrimmed}/${line.replace('/', '')}`;
                    }
                }
                else {
                    if (targetUrlTrimmed.endsWith('/')) {
                        finalUrl = `${targetUrlTrimmed}${line}`;
                    }
                    else {
                        finalUrl = `${targetUrlTrimmed}/${line}`;
                    }
                }
                return `/m3u8-proxy?url=${encodeURIComponent(finalUrl)}${headersParam ? `&headers=${encodeURIComponent(headersParam)}` : ""}`;
            }).join("\n");
            res.status(200)
                .set('Access-Control-Allow-Origin', '*')
                .set('Content-Type', targetResponse.headers.get("Content-Type") || "application/vnd.apple.mpegurl")
                .send(modifiedM3u8 || await targetResponse.text());
        }
        else if(url.pathname.endsWith(".key")) {
            // Get the binary data of the key
            const keyData = await targetResponse.arrayBuffer();
            res.setHeader("Content-Type", targetResponse.headers.get("Content-Type") || "application/octet-stream");
            res.setHeader("Content-Length", targetResponse.headers.get("Content-Length") || 0);
            safeSendResponse(200, Buffer.from(keyData));
        }
        else if (url.pathname.includes('videos') ||url.pathname.endsWith(".ts") || url.pathname.endsWith(".mp4") || targetResponse.headers.get('content-type')?.includes("video")) {
            if (req.query.url.startsWith("https://")) {
                forceHTTPS = true;
            }

            const uri = new URL(url);

            // Options
            // It might be worth adding ...req.headers to the headers object, but once I did that
            // the code broke and I receive errors such as "Cannot access direct IP" or whatever.
            const options = {
                hostname: uri.hostname,
                port: uri.port,
                path: uri.pathname + uri.search,
                method: req.method,
                headers: headers,
                timeout: 10000
            };

            // Proxy request and pipe to client
            try {
                if (forceHTTPS) {
                    const proxy = https.request(options, (r) => {
                        if (url.pathname.endsWith(".mp4")) {
                            r.headers["content-type"] = "video/mp4";
                            r.headers["accept-ranges"] = "bytes";
                            const fileName = req.query.filename || undefined;
                            if (fileName) {
                                r.headers['content-disposition'] = `attachment; filename="${fileName}.mp4"`;
                            }
                        }
                        else {
                            r.headers["content-type"] = "video/mp2t";
                        }
                        r.headers["Access-Control-Allow-Origin"] = "*";
                        res.writeHead(r.statusCode ?? 200, r.headers);

                        r.pipe(res, {
                            end: true,
                        });
                    });

                    req.pipe(proxy, {
                        end: true,
                    });
                    proxy.on('timeout', () => {
                        safeSendResponse(504, { message: "Request timed out." });
                        proxy.destroy();
                    });

                    proxy.on('error', (err) => {
                        console.error('Proxy request error:', err.message);
                        safeSendResponse(500, { message: "Proxy failed.", error: err.message });
                    });
                } else {
                    const proxy = http.request(options, (r) => {
                        if (url.pathname.endsWith(".mp4")) {
                            r.headers["content-type"] = "video/mp4";
                            r.headers["accept-ranges"] = "bytes";
                            const fileName = req.query.filename || undefined;
                            if (fileName) {
                                r.headers['content-disposition'] = `attachment; filename="${fileName}.mp4"`;
                            }
                        }
                        else {
                            r.headers["content-type"] = "video/mp2t";
                        }
                        r.headers["Access-Control-Allow-Origin"] = "*";
                        res.writeHead(r.statusCode ?? 200, r.headers);

                        r.pipe(res, {
                            end: true,
                        });
                    });
                    proxy.on('timeout', () => {
                        safeSendResponse(504, { message: "Request timed out." });
                        proxy.destroy();
                    });

                    proxy.on('error', (err) => {
                        console.error('Proxy request error:', err.message);
                        safeSendResponse(500, { message: "Proxy failed.", error: err.message });
                    });
                    req.pipe(proxy, {
                        end: true,
                    });
                }
            } catch (e) {
                res.writeHead(500);
                res.end(e.message);
            }
        }
        else {
            res.setHeader("Content-Type", targetResponse.headers.get("Content-Type"));
            res.setHeader("Content-Length", targetResponse.headers.get("Content-Length") || 0);
            safeSendResponse(200, await targetResponse.text());
        }
    } catch (e) {
        console.log(e);
        safeSendResponse(500, { message: e.message });
    }
});
