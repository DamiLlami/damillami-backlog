# Dami Media Book — PWA

Your personal media tracker — games, movies, and TV shows — as an installable Progressive Web App.

Data is stored in your browser's IndexedDB (a real local database that persists indefinitely). Works fully offline after first load. Install it once and it lives on your device like a native app.

## What's inside

```
dami-media-book/
├── index.html               ← the app
├── app.js                   ← service worker registration + auto-update banner
├── manifest.json            ← PWA config
├── sw.js                    ← service worker (offline support)
├── netlify.toml             ← Netlify config + URL routing
├── netlify/
│   └── functions/
│       ├── igdb.js          ← serverless IGDB proxy (games)
│       ├── rawg.js          ← serverless RAWG proxy (games)
│       └── omdb.js          ← serverless OMDb proxy (movies & TV)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md                ← this file
```

## Quick start: deploy to Netlify (free, ~5 min)

PWAs require HTTPS. The bundle is set up to deploy to Netlify with one command, and includes the serverless functions needed for IGDB/RAWG/OMDb metadata.

### Easiest path — drag and drop

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the entire `dami-media-book` folder onto the page
3. You'll get a live HTTPS URL within seconds (e.g., `silly-otter-1234.netlify.app`)
4. In Chrome/Edge: click the install icon in the address bar. On iOS Safari: Share → Add to Home Screen.

### Deploy via GitHub (recommended for ongoing updates)

1. Create a free GitHub account, make a public repo, push these files
2. At [app.netlify.com](https://app.netlify.com), click "Add new site" → "Import existing project" → connect your GitHub repo
3. Netlify auto-deploys on every commit. Future updates = drag a new file into GitHub, wait 30 seconds, refresh the app.

## Auto-metadata: pick a source per media type

Settings has two source pickers — one for games, one for movies/TV. Each can be configured independently.

### Games (Settings → 🎮 Games — Source)

#### IGDB — recommended

Industry-standard game database run by Twitch. Best metadata coverage. Free tier: 60,000 requests/month.

1. Sign in at [dev.twitch.tv/console](https://dev.twitch.tv/console) → "Register Your Application"
   - Name: anything (e.g., "MyBacklog")
   - OAuth Redirect URL: `http://localhost`
   - Category: Application Integration
2. Copy the **Client ID**, click "New Secret" to generate a **Client Secret**
3. In Netlify: **Site configuration → Environment variables → Add a variable**
   - `TWITCH_CLIENT_ID` = (your client ID)
   - `TWITCH_CLIENT_SECRET` = (your client secret)
4. **Deploys → Trigger deploy** (so the function picks up the new env vars)
5. In the app: **Settings → Games — Source → IGDB → Save**

#### RAWG.io

Simpler API. Decent data, slightly less reliable than IGDB. Free tier: 20,000 requests/month.

1. Get a free key at [rawg.io/apidocs](https://rawg.io/apidocs)
2. In Netlify: add environment variable `RAWG_API_KEY`
3. Trigger redeploy
4. In the app: **Settings → Games — Source → RAWG.io → Save**

### Movies & TV (Settings → 🎬 Movies & 📺 TV — Source)

#### OMDb — recommended

Free Open Movie Database with **Rotten Tomatoes scores for movies** and IMDb ratings for everything. Note: OMDb only provides RT scores for movies — TV shows get IMDb rating only (this is a limitation of the OMDb data, not the app).

1. Get a free key at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx)
   - Free tier: 1,000 requests/day
   - Patreon tier: $1/month for 100k requests/day
2. In Netlify: add environment variable `OMDB_API_KEY`
3. Trigger redeploy
4. In the app: **Settings → Movies & TV — Source → OMDb → Save**

### Claude API (works for either, anywhere)

Uses Anthropic's API directly from the browser — no serverless functions needed. Useful if you're hosting somewhere other than Netlify, or if a primary source isn't returning what you need.

1. Get a key at [console.anthropic.com](https://console.anthropic.com)
2. In the app: **Settings → paste key → pick "Claude API" for either source → Save**

The key stays only in your browser's IndexedDB and is sent only to Anthropic's API. Costs a fraction of a cent per item added.

## What you get from each source

| Source | Genre | Year | Platforms | Summary | RT Score | IMDb |
|--------|-------|------|-----------|---------|----------|------|
| IGDB (games) | ✅ | ✅ | ✅ | — | — | — |
| RAWG (games) | ✅ | ✅ | ✅ | — | — | — |
| OMDb (movies) | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| OMDb (TV) | ✅ | ✅ | — | ✅ | — | ✅ |
| Claude API (any) | ✅ | ✅ | ✅ (games) | ✅ | ✅* | ✅* |

\* Claude estimates RT and IMDb from training data — directional but not always exact. OMDb is the source of truth for verified scores.

## Why are credentials server-side for IGDB/RAWG/OMDb?

All three APIs **block direct browser requests** (no CORS support). The serverless functions in `netlify/functions/` handle calls server-side and add the necessary CORS headers. As a bonus, your API credentials never touch the browser.

If you're hosting on something other than Netlify (Vercel, Cloudflare Pages, etc.), the same functions can be adapted. The cleanest cross-platform option without server work is the Claude API path.

## Features at a glance

- **Three media types** — games, movies, TV — each with its own genre list and metadata source
- **Auto-metadata** with sync-issue detection (pulsing copper dot on cards that failed to fetch)
- **Inline rating** (1–10 scale, click without opening a modal)
- **Click any title** to see the full summary, scores, and source attribution
- **Two-level filters** — by media type (Games / Movies / TV / All) and by genre
- **Refresh Metadata** button (top right) — bulk re-fetches everything that's missing data
- **Offline-first** — works without internet after first load
- **Auto-update banner** — installed PWAs detect new versions and prompt for refresh
- **Export/Import backup** — JSON files you can stash anywhere

## Data backup

Use **Export backup** in the footer regularly. It downloads a JSON file with everything. **Import backup** restores from one. This is your safety net if you switch browsers, clear browser data, or move to a different device.

## Browser support

- **Chrome / Edge / Brave / Opera (desktop & Android)** — full support, install prompt shows in address bar
- **Safari (iOS / macOS)** — works as PWA, install via Share → Add to Home Screen
- **Firefox (desktop)** — works as a website but doesn't support installation. Mobile Firefox supports install.

## Updating the app

When new versions are released:

- **GitHub-based deploy:** replace the changed files in your repo. Netlify auto-rebuilds.
- **Drag-and-drop deploy:** log into Netlify, find your site, Deploys tab → drag the updated folder. Same URL preserved.

The service worker has a version number (`APP_VERSION` in `sw.js`) that gets bumped with each release — installed PWAs will detect this on next open and show the update banner.

## Troubleshooting

- **"Service worker registration failed"** — opening from `file://`. Use a local server or deploy to HTTPS.
- **"OMDb credentials not configured on server"** — env var not set in Netlify, or you didn't redeploy after setting it.
- **TV show has no RT score** — expected. OMDb only returns RT for movies. The app shows IMDb rating instead.
- **Sync dot keeps appearing** — title may be misspelled or too obscure for the source. Click the dot for retry/fill-in options, or try a different source.
- **Data disappeared after browser update** — keep an exported backup; browsers occasionally clear "uncommitted" storage.
- **Install button doesn't appear** — already installed, or your browser doesn't support PWA install.
