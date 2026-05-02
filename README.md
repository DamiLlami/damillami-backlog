# DamiLlami Backlog — PWA

Your personal video game backlog tracker as an installable Progressive Web App.

Data is stored in your browser's IndexedDB (a real local database that persists indefinitely). Works fully offline after first load. Install it once and it lives on your device like a native app.

## What's inside

```
damillami-backlog/
├── index.html               ← the app
├── manifest.json            ← PWA config
├── sw.js                    ← service worker (offline support)
├── netlify.toml             ← Netlify config + URL routing
├── netlify/
│   └── functions/
│       ├── igdb.js          ← serverless IGDB proxy
│       └── rawg.js          ← serverless RAWG proxy
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md                ← this file
```

## Quick start: deploy to Netlify (free, ~5 min)

PWAs require HTTPS. The bundle is set up to deploy to Netlify with one command, and includes the serverless functions needed for IGDB/RAWG metadata.

### Easiest path — drag and drop

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the entire `damillami-backlog` folder onto the page
3. You'll get a live HTTPS URL within seconds (e.g., `silly-otter-1234.netlify.app`)
4. In Chrome/Edge: click the install icon in the address bar. On iOS Safari: Share → Add to Home Screen.

### Deploy via GitHub (recommended for ongoing updates)

1. Create a free GitHub account, make a public repo, push these files
2. At [app.netlify.com](https://app.netlify.com), click "Add new site" → "Import existing project" → connect your GitHub repo
3. Netlify auto-deploys on every commit. Future updates = drag a new file into GitHub, wait 30 seconds, refresh the app.

## Optional: enable auto-metadata

Without auto-metadata, new games are added with no genre/year/platforms — fill them in via the ✎ edit icon. The "↻ Refetch metadata" button can backfill old entries once you've configured a source.

Three options for auto-fill:

### IGDB (best data, free, requires Netlify) — recommended

Industry-standard game database run by Twitch. Best metadata coverage by a wide margin. Free tier: 60,000 requests/month.

**Setup:**
1. Sign in at [dev.twitch.tv/console](https://dev.twitch.tv/console) → "Register Your Application"
   - Name: anything (e.g., "MyBacklog")
   - OAuth Redirect URL: `http://localhost`
   - Category: Application Integration
2. Copy the **Client ID**, click "New Secret" to generate a **Client Secret**
3. In Netlify: **Site configuration → Environment variables → Add a variable**
   - `TWITCH_CLIENT_ID` = (your client ID)
   - `TWITCH_CLIENT_SECRET` = (your client secret)
4. **Deploys → Trigger deploy** (so the function picks up the new env vars)
5. In the app: **Settings → Source → IGDB → Save**

### RAWG.io (good data, free, requires Netlify)

Simpler API. Decent data, slightly less reliable than IGDB. Free tier: 20,000 requests/month.

**Setup:**
1. Get a free key at [rawg.io/apidocs](https://rawg.io/apidocs)
2. In Netlify: add environment variable `RAWG_API_KEY`
3. Trigger redeploy
4. In the app: **Settings → Source → RAWG.io → Save**

### Claude API (works anywhere, costs cents)

Uses Anthropic's API directly from the browser — no serverless functions needed. Useful if you're hosting somewhere other than Netlify, or just want the simplest setup.

**Setup:**
1. Get a key at [console.anthropic.com](https://console.anthropic.com)
2. In the app: **Settings → Source → Claude API → paste key → Save**

The key stays only in your browser's IndexedDB and goes only to Anthropic's API. Costs a fraction of a cent per game added.

## Why are credentials server-side for IGDB/RAWG?

Both APIs **block direct browser requests** (no CORS support). The serverless functions in `netlify/functions/` handle the calls server-side and add the necessary CORS headers, so the browser can talk to them safely. As a bonus, your API credentials never touch the browser.

If you're hosting on something other than Netlify (Vercel, Cloudflare Pages, etc.), the same functions can be adapted. The cleanest cross-platform option without server work is the Claude API path.

## Data backup

Use **Export backup** in the footer regularly. It downloads a JSON file with everything. **Import backup** restores from one. This is your safety net if you switch browsers, clear browser data, or want to move to a different device.

## Browser support

- **Chrome / Edge / Brave / Opera (desktop & Android)** — full support, install prompt shows in address bar
- **Safari (iOS / macOS)** — works as PWA, install via Share → Add to Home Screen
- **Firefox (desktop)** — works as a website but doesn't support installation. Mobile Firefox supports install.

## Updating the app

When new versions are released:

- **GitHub-based deploy:** replace the changed files in your repo. Netlify auto-rebuilds.
- **Drag-and-drop deploy:** log into Netlify, find your site, Deploys tab → drag the updated folder. Same URL preserved.

The service worker has a version number that gets bumped with each release — installed PWAs will pick up the update automatically on next open.

## Troubleshooting

- **"Service worker registration failed"** — opening from `file://`. Use a local server or deploy to HTTPS.
- **"IGDB credentials not configured on server"** — env vars not set in Netlify, or you didn't redeploy after setting them. Check Site configuration → Environment variables, then Deploys → Trigger deploy.
- **Data disappeared after browser update** — keep an exported backup; browsers occasionally clear "uncommitted" storage.
- **Install button doesn't appear** — already installed, or your browser doesn't support PWA install.
