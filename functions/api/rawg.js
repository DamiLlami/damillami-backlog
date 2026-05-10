// Cloudflare Pages Function: RAWG game lookup
// Proxies RAWG API requests to bypass CORS
// Credentials come from environment variable: RAWG_API_KEY

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const multi = url.searchParams.get('multi') === '1';
  const rawgId = url.searchParams.get('rawgId');
  if (!title && !rawgId) {
    return new Response(JSON.stringify({ error: 'missing title or rawgId param' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const key = env.RAWG_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'RAWG key not configured on server' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Direct ID fetch (used by URL-paste refetch in Session B)
    if (rawgId) {
      const apiUrl = `https://api.rawg.io/api/games/${encodeURIComponent(rawgId)}?key=${encodeURIComponent(key)}`;
      const r = await fetch(apiUrl);
      if (!r.ok) throw new Error('RAWG query failed: ' + r.status);
      const data = await r.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiUrl = `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(title)}&page_size=5&search_precise=true`;
    const r = await fetch(apiUrl);
    if (!r.ok) throw new Error('RAWG query failed: ' + r.status);
    const data = await r.json();

    // Multi mode returns wrapped candidate list
    if (multi) {
      const results = (data.results || []).slice(0, 5).map(g => ({
        rawgId: g.id,
        title: g.name,
        year: g.released ? parseInt(g.released.substring(0, 4)) : null,
        coverUrl: g.background_image || null,
        rating: g.rating || null,
      }));
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
