// Netlify Function: OMDb (Open Movie Database) lookup
// Returns metadata for movies and TV shows
// Credentials come from environment variable: OMDB_API_KEY

export default async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const title = url.searchParams.get('title');
  const type = url.searchParams.get('type'); // 'movie' or 'series' (TV)
  if (!title) {
    return new Response(JSON.stringify({ error: 'missing title param' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const key = process.env.OMDB_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'OMDb key not configured on server' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // OMDb's `t=` (title) endpoint returns a single best match with full details.
    // Including `plot=short` keeps the summary concise.
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
