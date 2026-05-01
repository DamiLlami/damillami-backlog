# DamiLlami Backlog — PWA

Your personal video game backlog tracker as an installable Progressive Web App.

Data is stored in your browser's IndexedDB (a real local database that persists indefinitely). Works fully offline after first load. Install it once and it lives on your device like a native app.

## What's inside

```
damillami-backlog/
├── index.html          ← the app
├── manifest.json       ← PWA config
├── sw.js               ← service worker (offline support)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md           ← this file
```

## Quick start: deploy to GitHub Pages (free, ~5 min)

PWAs require HTTPS. The easiest free option is GitHub Pages.

1. Create a free account at [github.com](https://github.com) if you don't have one
2. Create a new public repository — name it whatever you like (e.g. `backlog`)
3. Upload all the files from this folder to the repo root (drag-and-drop in the GitHub web UI works)
4. Go to **Settings → Pages**
5. Under "Source", pick `main` branch and `/ (root)` folder, click Save
6. Wait ~30 seconds, then visit `https://YOURUSERNAME.github.io/backlog/`
7. In Chrome/Edge, click the **install icon** in the address bar (looks like a monitor with a down arrow). On iOS Safari, tap Share → Add to Home Screen.

Your app is now installed. Launching it opens a standalone window — no browser chrome, no Claude needed.

## Other free hosting options

- **Netlify** — drag the folder onto [app.netlify.com/drop](https://app.netlify.com/drop), done in 30 seconds
- **Vercel** — `npx vercel` from the folder
- **Cloudflare Pages** — connect a GitHub repo

Any of these give you HTTPS automatically.

## Local testing (without deploying)

Service workers won't work from `file://` URLs, but `localhost` is allowed.

```bash
cd damillami-backlog
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in Chrome. You can install from there for testing, but for daily use deploy somewhere with a real URL.

## Optional: enable auto-classification

Without an API key, new games are added with no genre/year/platforms — you fill those in manually via the ✎ edit icon.

To enable automatic detection:

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Click **Settings** in the app footer
3. Paste your key and Save

The key is stored only in your browser's IndexedDB and is sent only to Anthropic's API when you add a new game. Each classification costs a fraction of a cent.

**Important**: never commit your API key to a public GitHub repo. The Settings UI keeps it local — don't paste it into the source code.

## Data backup

Use **Export backup** in the footer regularly. It downloads a JSON file with everything. **Import backup** restores from one. This is your safety net if you switch browsers, clear browser data, or want to move to a different device.

## Browser support

- **Chrome / Edge / Brave / Opera (desktop & Android)** — full support, install prompt shows in address bar
- **Safari (iOS / macOS)** — works as PWA, install via Share → Add to Home Screen
- **Firefox (desktop)** — works as a website but doesn't support installation. Mobile Firefox supports install.

## Troubleshooting

- **"Service worker registration failed"** — you're probably opening the file directly (`file://`). Use a local server or deploy to HTTPS.
- **Data disappeared after browser update** — browsers occasionally clear "uncommitted" storage. Keep an exported backup.
- **Install button doesn't appear** — already installed, or your browser doesn't support PWA install. Check chrome://apps to see installed PWAs.
