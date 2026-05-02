// Cloudflare Pages Function: OMDb (Open Movie Database) lookup
// Returns metadata for movies and TV shows
// Credentials come from environment variable: OMDB_API_KEY

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
  const type = url.searchParams.get('type'); // 'movie' or 'series' (TV)
  if (!title) {
    return new Response(JSON.stringify({ error: 'missing title param' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const key = env.OMDB_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'OMDb key not configured on server' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const params = new URLSearchParams({
      t: title,
      plot: 'short',
      apikey: key,
    });
    if (type === 'movie' || type === 'series') params.append('type', type);

    const apiUrl = `https://www.omdbapi.com/?${params.toString()}`;
    const r = await fetch(apiUrl);
    if (!r.ok) throw new Error('OMDb query failed: ' + r.status);
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
