# M3U8 Proxy

A lightweight Node.js proxy for HLS (`.m3u8`) streams that injects custom headers and bypasses CORS restrictions entirely in pure JavaScript.

Useful for streams that require headers such as `Referer`, `Origin`, `User-Agent`, or authenticated requests that browsers normally block.

---

## Features

* Proxy `.m3u8` playlists
* Proxy `.ts` segments automatically
* Inject custom request headers
* CORS-enabled responses
* Pure JavaScript implementation
* Simple deployment to Node.js or Vercel

---

## How It Works

1. Client requests `/m3u8-proxy`
2. Proxy fetches the target `.m3u8` using custom headers
3. Playlist URLs are rewritten to route back through the proxy
4. TS/media segments are proxied with CORS support

This allows HLS players to load protected streams directly in the browser.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/hase0278/hase0278-m3u8-proxy.git
cd hase0278-m3u8-proxy
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file:

```env
PORT=3030
```

### 4. Build the project

```bash
npm run build
```

### 5. Start the server

```bash
npm start
```

Server will run on:

```text
http://localhost:3030
```

---

## Usage

### Endpoint

```text
GET /m3u8-proxy
```

### Query Parameters

| Parameter | Required | Description                  |
| --------- | -------- | ---------------------------- |
| `url`     | Yes      | Target `.m3u8` URL           |
| `headers` | No       | JSON-encoded request headers |

---

## Example Request

```text
http://localhost:3030/m3u8-proxy?url=https%3A%2F%2Fexample.com%2Fplaylist.m3u8&headers=%7B%22Referer%22%3A%22https%3A%2F%2Fexample-site.com%22%7D
```

### Decoded Values

#### URL

```text
https://example.com/playlist.m3u8
```

#### Headers

```json
{
  "Referer": "https://example-site.com"
}
```

---

## Example with Fetch

```js
const params = new URLSearchParams({
  url: "https://example.com/playlist.m3u8",
  headers: JSON.stringify({
    Referer: "https://example-site.com"
  })
});

const proxyUrl = `http://localhost:3030/m3u8-proxy?${params}`;

console.log(proxyUrl);
```

---

## Environment Variables

| Variable | Default | Description      |
| -------- | ------- | ---------------- |
| `PORT`   | `3030`  | HTTP server port |

---

## Instant Deployment

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/hase0278/hase0278-m3u8-proxy)

---

## Example Use Cases

* Browser-based HLS players
* Anime/movie streaming frontends
* IPTV dashboards
* Embedded video players
* Streams protected by referer validation
* Circumventing restrictive CORS policies for legitimate playback

---

## Credits

* TS proxy inspiration from:
  [Eltik/M3U8-Proxy](https://github.com/Eltik/M3U8-Proxy?utm_source=chatgpt.com)

* Original Cloudflare Worker implementation inspired by:
  [Gratenes/m3u8CloudflareWorkerProxy](https://github.com/Gratenes/m3u8CloudflareWorkerProxy?utm_source=chatgpt.com)
