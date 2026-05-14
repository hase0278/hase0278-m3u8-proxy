# 🎬 AnihaseAllAnime Embedded Video Player

A self-contained, embeddable HTML video player for streaming HLS (`.m3u8`) and MP4 videos. Designed to be embedded via `<iframe>` on third-party websites with support for quality selection, watch progress saving, landscape fullscreen, and cross-origin API communication.

---

## ✨ Features

| Feature | Description |
|---|---|
| **HLS & MP4 Support** | Plays adaptive HLS streams and standard MP4 files |
| **Quality Selector** | Auto, 480p, 720p, 1080p, and custom labels |
| **Watch Progress Saving** | Auto-saves to `localStorage`, resumes on next visit |
| **Landscape Fullscreen** | Optimized fullscreen behavior on mobile devices |
| **Seamless Quality Switching** | Maintains playback position when switching quality |
| **Cross-Origin API** | Communicate with the player via `postMessage` |
| **Error Handling** | User-friendly error overlay on playback failure |
| **Responsive Design** | Adapts to any container or screen size |
| **Custom Theming** | Fully themeable via CSS variables |

---

## 📦 Dependencies

All dependencies are loaded via CDN — no build step required.

| Library | Version | Purpose |
|---|---|---|
| [Video.js](https://videojs.com/) | `7.10.0` | Core video player |
| [videojs-http-streaming](https://github.com/videojs/http-streaming) | `2.14.1` | HLS playback support |
| [@silvermine/videojs-quality-selector](https://github.com/silvermine/videojs-quality-selector) | `latest` | Quality selection UI |
| [videojs-landscape-fullscreen](https://github.com/mister-ben/videojs-landscape-fullscreen) | `1.4.6` | Mobile landscape fullscreen |

---

## 🚀 Embedding the Player

Embed the player on any webpage using a standard `<iframe>`:

```html
<iframe
  src="https://your-domain.com/player.html?sources=ENCODED_JSON"
  width="800"
  height="450"
  allowfullscreen
  allow="autoplay; encrypted-media; picture-in-picture">
</iframe>
```

---

## 🔗 URL Parameters

| Parameter | Required | Description |
|---|---|---|
| `sources` | ✅ Yes | URL-encoded JSON array of source objects (see schema below) |
| `poster` | ❌ No | URL-encoded poster image URL shown before playback |
| `videoId` | ❌ No | Unique identifier for watch progress tracking |
| `startTime` | ❌ No | Start playback at a specific time (in seconds) |

---

## 📐 Source Object Schema

Each item in the `sources` array must follow this structure:

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | ✅ Yes | Full URL to the video source |
| `quality` | `string` | ❌ No | Display label (e.g., `"720p"`, `"auto"`, `"MP4"`) |
| `isM3U8` | `boolean` | ❌ No | `true` for HLS streams, `false` for MP4 |

### Example Sources Array

```json
[
  { "url": "https://example.com/auto.m3u8",   "quality": "auto", "isM3U8": true  },
  { "url": "https://example.com/720p.m3u8",   "quality": "720p", "isM3U8": true  },
  { "url": "https://example.com/1080p.m3u8",  "quality": "1080p","isM3U8": true  },
  { "url": "https://example.com/backup.mp4",  "quality": "MP4",  "isM3U8": false }
]
```

---

## 🏗️ Building the Player URL

Use JavaScript to encode the sources and construct the player URL:

```javascript
const sources = [
  { url: "https://example.com/auto.m3u8",  quality: "auto", isM3U8: true },
  { url: "https://example.com/720p.m3u8",  quality: "720p", isM3U8: true },
  { url: "https://example.com/1080p.m3u8", quality: "1080p", isM3U8: true },
  { url: "https://example.com/backup.mp4", quality: "MP4",  isM3U8: false }
];

const encoded = encodeURIComponent(JSON.stringify(sources));
const playerUrl = `https://your-domain.com/player.html?sources=${encoded}`;

// Optional parameters
const poster = encodeURIComponent("https://example.com/thumbnail.jpg");
const videoId = "my-anime-episode-1";
const startTime = 120; // seconds

const fullUrl = `${playerUrl}&poster=${poster}&videoId=${videoId}&startTime=${startTime}`;
```

---

## 💾 Watch Progress

The player automatically tracks and restores viewing progress using `localStorage`.

### How It Works

- **Auto-saves** the current playback position every **5 seconds** while playing
- **Saves on pause** and when the user navigates away from the page
- **Clears the saved position** when the video finishes (reaches the end)
- **Resumes automatically** on the next visit to the same video
- **Storage key** is derived from the `videoId` URL parameter, or falls back to a hash of the first source URL
- **Override** the resume position at any time using the `startTime` URL parameter

### Storage Key Logic

```
priority: videoId param > hash(sources[0].url)
```

---

## 📡 Cross-Origin API (postMessage)

The player supports two-way communication between the parent page and the embedded player via the [postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

### Parent → Player (Commands)

Send commands to the player from the parent page:

```javascript
const iframe = document.querySelector('iframe');

// Play the video
iframe.contentWindow.postMessage({ action: 'play' }, '*');

// Pause the video
iframe.contentWindow.postMessage({ action: 'pause' }, '*');

// Seek to a specific time (in seconds)
iframe.contentWindow.postMessage({ action: 'seek', time: 90 }, '*');

// Set quality (must match a quality label in your sources)
iframe.contentWindow.postMessage({ action: 'setQuality', quality: '720p' }, '*');

// Request current player status
iframe.contentWindow.postMessage({ action: 'getStatus' }, '*');
```

### Player → Parent (Status Response)

The player responds to `getStatus` (and may emit status updates) with:

```javascript
// Listen for messages from the player
window.addEventListener('message', (event) => {
  const { currentTime, duration, paused, quality, qualities } = event.data;
  console.log(`Time: ${currentTime}/${duration}, Paused: ${paused}`);
  console.log(`Current quality: ${quality}, Available: ${qualities}`);
});
```

| Field | Type | Description |
|---|---|---|
| `currentTime` | `number` | Current playback position in seconds |
| `duration` | `number` | Total video duration in seconds |
| `paused` | `boolean` | Whether the video is currently paused |
| `quality` | `string` | Currently selected quality label |
| `qualities` | `string[]` | All available quality labels |

---

## 🎨 Customization

### CSS Variables (Theming)

Override these CSS custom properties to match your site's branding:

```css
:root {
  --accent: #e91e63;       /* Accent / highlight color */
  --menu-bg: #1a1a2e;      /* Quality menu background */
  --menu-hover: #16213e;   /* Menu item hover background */
  --menu-active: #0f3460;  /* Active/selected menu item background */
}
```

### Player Options (JavaScript)

Core player behavior can be configured directly in the JavaScript source:

```javascript
const playerOptions = {
  autoplay: true,       // Auto-start playback
  controls: true,       // Show player controls
  loop: false,          // Loop video when finished
  muted: false,         // Start muted (required for autoplay in some browsers)
};
```

---

## 🚢 Deployment

The player is a **static HTML file** — no server, database, or backend required.

Deploy to any static hosting platform:

| Platform | Notes |
|---|---|
| [Netlify](https://netlify.com) | Drag & drop deploy, free tier |
| [Vercel](https://vercel.com) | GitHub integration, free tier |
| [GitHub Pages](https://pages.github.com) | Free for public repos |
| [AWS S3](https://aws.amazon.com/s3/) | Enable static website hosting |

---

## 🌐 Browser Support

| Browser | Minimum Version |
|---|---|
| Chrome | 60+ |
| Firefox | 55+ |
| Safari | 10+ |
| Edge | 79+ |
| iOS Safari | ✅ Supported |
| Android Chrome | ✅ Supported |

---

## ⚠️ CORS Requirements

> **Important:** Video sources must allow cross-origin requests.

Your video server must include the appropriate CORS headers:

```
Access-Control-Allow-Origin: *
```

If your CDN or server does not support CORS, use a **CORS proxy** to relay the video stream.

---

## 🔒 Security Considerations

- **Validate source URLs** on the server-side or with an allowlist before embedding
- **Use `videoId`** for consistent watch progress tracking instead of relying on URL hashes
- **Set `X-Frame-Options`** on your player page to control which domains can embed it:
  ```
  X-Frame-Options: ALLOW-FROM https://your-site.com
  ```
- **Validate `postMessage` origins** to prevent unauthorized API calls:
  ```javascript
  window.addEventListener('message', (event) => {
    if (event.origin !== 'https://trusted-parent.com') return;
    // handle event
  });
  ```

---

## 🛠️ Troubleshooting

### Video doesn't play

- ✅ Check that source URLs are publicly accessible
- ✅ Confirm CORS headers are set on the video server
- ✅ Verify `isM3U8` is set correctly (`true` for `.m3u8`, `false` for `.mp4`)
- ✅ Validate the HLS playlist by opening the `.m3u8` URL directly in a browser
- ✅ Check the browser console for network errors

### Quality selector not showing

- ✅ The quality selector only appears when **more than one source** is provided
- ✅ Ensure each source object has a unique `quality` label

### Watch progress not saving

- ✅ Check that `localStorage` is available and not blocked (e.g., private/incognito mode)
- ✅ Provide a `videoId` URL parameter for consistent storage keys across sessions
- ✅ Ensure the page origin is consistent (watch progress is origin-scoped)

---

## 📁 Project Structure

```
player.html         # Self-contained player (HTML + CSS + JS)
README.md           # This file
```

---

## 📜 License

Built for the **AnihaseAllAnime** video streaming platform.

---

*AnihaseAllAnime Embedded Video Player — Powered by Video.js*