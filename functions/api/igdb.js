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
  if (!title) {
    return new Response(JSON.stringify({ error: 'missing title param' }), {
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
    const body = `search "${title.replace(/"/g, '\\"')}"; fields name, genres, platforms, first_release_date, total_rating_count; limit 5;`;
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
