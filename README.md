# Dami Media Book — PWA (Cloudflare Pages edition)

Your personal media tracker — games, movies, and TV shows — as an installable Progressive Web App, deployed on Cloudflare Pages.

Data is stored in your browser's IndexedDB (a real local database that persists indefinitely). Works fully offline after first load. Install it once and it lives on your device like a native app.

## What's inside

```
dami-media-book/
├── index.html               ← the app
├── app.js                   ← service worker registration + auto-update banner
├── manifest.json            ← PWA config
├── sw.js                    ← service worker (offline support)
├── _headers                 ← Cloudflare Pages cache rules
├── functions/
│   └── api/
│       ├── igdb.js          ← Pages Function: IGDB proxy (games)
│       ├── rawg.js          ← Pages Function: RAWG proxy (games)
│       └── omdb.js          ← Pages Function: OMDb proxy (movies & TV)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md                ← this file
```

The `functions/api/` directory uses Cloudflare's file-based routing — each `.js` file is automatically exposed at `/api/<filename>`. So `functions/api/igdb.js` becomes the `/api/igdb` endpoint that the browser calls.

## Deploying to Cloudflare Pages

### Via GitHub (recommended)

1. Push these files to a public GitHub repo
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**
3. Pick your repo, leave build settings empty (this is a static site — no build step needed)
4. Click "Save and Deploy"
5. You'll get a URL like `dami-media-book.pages.dev`

### Via direct upload

1. Use Cloudflare's drag-and-drop in **Workers & Pages → Create → Pages → Direct Upload**
2. Drag the entire folder
3. Same URL pattern as above

After deployment:
- Chrome/Edge: click the install icon in the address bar
- iOS Safari: Share → Add to Home Screen

## Setting environment variables

In Cloudflare's dashboard:

1. Go to your Pages project → **Settings → Environment variables**
2. Add the variables for whichever metadata sources you want (see below)
3. Important: set them for **Production**, and click **Save**
4. Trigger a redeploy: **Deployments → ⋮ on latest → Retry deployment** (env var changes only apply to new deployments)

## Auto-metadata: pick a source per media type

The app's Settings has two source pickers — one for games, one for movies/TV. Each can be configured independently.

### Games

#### IGDB — recommended

Industry-standard game database run by Twitch. Free tier: 60,000 requests/month.

1. Sign in at [dev.twitch.tv/console](https://dev.twitch.tv/console) → "Register Your Application"
   - OAuth Redirect URL: `http://localhost`
   - Category: Application Integration
2. Copy the **Client ID**, click "New Secret" for a **Client Secret**
3. In Cloudflare Pages env vars, add:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
4. Redeploy
5. In the app: **Settings → Games — Source → IGDB → Save**

#### RAWG.io

Simpler API. Free tier: 20,000 requests/month.

1. Get a free key at [rawg.io/apidocs](https://rawg.io/apidocs)
2. In Cloudflare env vars: `RAWG_API_KEY`
3. Redeploy
4. In the app: **Settings → Games — Source → RAWG.io → Save**

### Movies & TV

#### OMDb — recommended

Free Open Movie Database with **Rotten Tomatoes scores for movies** and IMDb ratings. OMDb does not provide RT scores for TV shows (this is a limitation of the OMDb data, not the app — TV shows get IMDb rating only).

1. Get a free key at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx)
2. In Cloudflare env vars: `OMDB_API_KEY`
3. Redeploy
4. In the app: **Settings → Movies & TV — Source → OMDb → Save**

### Claude API (works for either, no server config needed)

Uses Anthropic's API directly from the browser — no Cloudflare functions involved. This works on any host.

1. Get a key at [console.anthropic.com](https://console.anthropic.com)
2. In the app: **Settings → paste key → pick "Claude API" for either source → Save**

## Why are credentials server-side?

IGDB, RAWG, and OMDb all **block direct browser requests** (no CORS). The Pages Functions in `functions/api/` handle calls server-side and add CORS headers, so the browser can reach them safely. Your credentials never touch the browser.

The only exception is the Claude API path — Anthropic supports a special browser-direct flag — so its key can be entered directly in the app's Settings.

## Migrating from Netlify

If you previously deployed this on Netlify and are switching to Cloudflare:

- The old `netlify.toml` and `netlify/functions/` folder are no longer needed
- Cache rules now live in `_headers` (different syntax)
- Functions moved from `netlify/functions/*.js` to `functions/api/*.js`
- Function syntax changed from `export default async (req) => {...}` to `export const onRequest = async ({ request, env }) => {...}`
- Env vars are accessed as `env.NAME` instead of `process.env.NAME`
- Browser-side code is unchanged — `/api/igdb`, `/api/rawg`, `/api/omdb` work identically because Cloudflare auto-routes `functions/api/*` to those URLs

Re-create your environment variables in the Cloudflare dashboard with the same names.

## Browser support, data backup, troubleshooting

(See in-app Settings and Export/Import features.)

- **Chrome / Edge / Brave / Opera (desktop & Android)** — full PWA support, install prompt in address bar
- **Safari (iOS / macOS)** — works as PWA, install via Share → Add to Home Screen
- **Firefox (desktop)** — works as a website, no install support; mobile Firefox supports install

Use **Export backup** in the app footer regularly. It downloads a JSON of everything. **Import backup** restores from one. Your safety net if you switch browsers, clear data, or move to a different device.

### Troubleshooting

- **"OMDb credentials not configured on server"** → env var not set, or you didn't redeploy after setting it
- **Function returns 404** → make sure the file is at `functions/api/<name>.js` (not `functions/<name>.js`)
- **TV show has no RT score** → expected. OMDb only returns RT for movies. App shows IMDb instead.
- **Service worker registration failed** → opened from `file://`. Cloudflare deploys via HTTPS, so this only happens locally.
