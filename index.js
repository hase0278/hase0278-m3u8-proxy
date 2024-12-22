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
    try {
        const url = new URL(req.query.url);
        const headersParam = decodeURIComponent(req.query.headers || "");
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36';

        if (!url) {
            res.status(400).send({ message: "Invalid URL" });
        }

        const headers = {
            "User-Agent": userAgent
        };
        if (headersParam) {
            const additionalHeaders = JSON.parse(headersParam);
            Object.entries(additionalHeaders).forEach(([key, value]) => {
                if (!["Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"].includes(key)) {
                    headers[key] = value;
                }
            });
        }

        if(url.pathname.endsWith(".mp4")){
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        }
        else{
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
        }

        const targetResponse = await fetch(url, {
            headers: headers,
        });

        let modifiedM3u8;
        let forceHTTPS = false;
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (url.pathname.endsWith(".m3u8")) {
            modifiedM3u8 = await targetResponse.text();
            const targetUrlTrimmed = encodeURIComponent(url.origin + url.pathname.replace(/[^/]+\.m3u8$/, "").trim());
            modifiedM3u8 = modifiedM3u8.split("\n").map((line) => {
                if (line.startsWith("#") || line.trim() == '') {
                    return line;
                }
                return `/m3u8-proxy?url=${targetUrlTrimmed}${encodeURIComponent(line)}${headersParam ? `&headers=${encodeURIComponent(headersParam)}` : ""}`;
            }).join("\n");
            res.setHeader("Content-Type", targetResponse.headers.get("Content-Type") || "application/vnd.apple.mpegurl");
            res.status(200).send(modifiedM3u8 || await targetResponse.text());
        }
        else if (url.pathname.endsWith(".ts") || url.pathname.endsWith(".mp4")) {
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
                } else {
                    const proxy = http.request(options, (r) => {
                        if(url.pathname.endsWith(".mp4")){
                            r.headers["content-type"] = "video/mp4";
                            r.headers["accept-ranges"] = "bytes";
                            const fileName = req.query.filename || undefined;
                            if(fileName){
                                r.headers['content-disposition'] = `attachment; filename="${fileName}.mp4"`;
                            }
                        }
                        else{
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
                }
            } catch (e) {
                res.writeHead(500);
                res.end(e.message);
            }
        }
        else {
            res.setHeader("Content-Type", targetResponse.headers.get("Content-Type"));
            res.status(200).send(await targetResponse.text());
        }
    } catch (e) {
        console.log(e);
        res.status(500).send(e.message);
    }
});
