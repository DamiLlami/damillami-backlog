// Netlify Function: IGDB game lookup
// Handles Twitch OAuth and proxies IGDB API requests
// Credentials come from environment variables (set in Netlify dashboard):
//   TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(clientId, clientSecret) {
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 60_000) return cachedToken;

  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
  const r = await fetch(url, { method: 'POST' });
  if (!r.ok) throw new Error('Twitch auth failed: ' + r.status);
  const data = await r.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in * 1000);
  return cachedToken;
}

export default async (req) => {
  // Allow CORS for browser calls
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const title = url.searchParams.get('title');
  if (!title) {
    return new Response(JSON.stringify({ error: 'missing title param' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
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
