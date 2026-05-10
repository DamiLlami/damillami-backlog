// Cloudflare Pages Function: IGDB game lookup
// Handles Twitch OAuth and proxies IGDB API requests
// Credentials come from environment variables (set in Cloudflare Pages dashboard):
//   TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET
//
// Note: unlike Netlify Functions, Cloudflare Pages Functions are stateless across
// invocations on the edge. Each request may hit a different worker, so we cannot
// reliably cache the OAuth token in-memory between invocations. We mint a fresh
// token per request — this is fine within IGDB's rate limits (4 req/sec/client).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getAccessToken(clientId, clientSecret) {
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
  const r = await fetch(url, { method: 'POST' });
  if (!r.ok) throw new Error('Twitch auth failed: ' + r.status);
  const data = await r.json();
  return data.access_token;
}

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const multi = url.searchParams.get('multi') === '1';
  const igdbId = url.searchParams.get('igdbId');
  if (!title && !igdbId) {
    return new Response(JSON.stringify({ error: 'missing title or igdbId param' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'IGDB credentials not configured on server' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);
    let body;
    if (igdbId) {
      // Direct ID fetch (used by URL-paste refetch in Session B)
      body = `where id = ${parseInt(igdbId)}; fields name, summary, genres, platforms, first_release_date, total_rating_count, cover.image_id, franchise.name, collection.name; limit 1;`;
    } else {
      // Search by title — return up to 5 for picker, single for direct add
      const limit = multi ? 5 : 5; // we always fetched 5; client picks best when not multi
      body = `search "${title.replace(/"/g, '\\"')}"; fields name, genres, platforms, first_release_date, total_rating_count, cover.image_id, franchise.name, collection.name; limit ${limit};`;
    }
    const r = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
    });
    if (!r.ok) throw new Error('IGDB query failed: ' + r.status);
    const games = await r.json();

    // Convert cover image_id to a usable thumbnail URL
    // t_cover_big = 264x374, plenty for our small thumbnail
    for (const g of games) {
      if (g.cover && g.cover.image_id) {
        g.coverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
      }
    }

    // For multi mode, wrap in a results object so the picker has a consistent shape
    // across all 5 sources. Single mode keeps the legacy shape (raw array).
    if (multi) {
      const results = games.map(g => ({
        igdbId: g.id,
        title: g.name,
        year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        coverUrl: g.coverUrl || null,
        franchise: (g.franchise && g.franchise.name) || (g.collection && g.collection.name) || null,
      }));
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(games), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
