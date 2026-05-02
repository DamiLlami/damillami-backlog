// Netlify Function: RAWG game lookup
// Proxies RAWG API requests to bypass CORS
// Credentials come from environment variable: RAWG_API_KEY

export default async (req) => {
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

  const key = process.env.RAWG_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'RAWG key not configured on server' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const apiUrl = `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(title)}&page_size=5&search_precise=true`;
    const r = await fetch(apiUrl);
    if (!r.ok) throw new Error('RAWG query failed: ' + r.status);
    const data = await r.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
