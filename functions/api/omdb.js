// Cloudflare Pages Function: OMDb (Open Movie Database) lookup
// Returns metadata for movies and TV shows
// Credentials come from environment variable: OMDB_API_KEY
//
// Supports two modes:
//   ?title=X               → single best match (current behavior, used for direct adds)
//   ?title=X&multi=1       → list of up to 5 candidate matches (used for the picker UI)
//   ?imdbId=tt0123456      → fetch a specific entry by IMDb ID (used for URL-paste refetch)

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
  const multi = url.searchParams.get('multi') === '1';
  const imdbId = url.searchParams.get('imdbId'); // direct ID fetch

  if (!title && !imdbId) {
    return new Response(JSON.stringify({ error: 'missing title or imdbId param' }), {
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
    // --- Direct ID fetch ---
    if (imdbId) {
      const params = new URLSearchParams({ i: imdbId, plot: 'short', apikey: key });
      const r = await fetch(`https://www.omdbapi.com/?${params.toString()}`);
      const data = await r.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Multi (search) mode: returns a list of candidates ---
    if (multi) {
      // Use OMDb's search endpoint which returns up to 10 results (we cap at 5)
      const sParams = new URLSearchParams({ s: title, apikey: key });
      if (type === 'movie' || type === 'series') sParams.append('type', type);
      const sR = await fetch(`https://www.omdbapi.com/?${sParams.toString()}`);
      const sData = await sR.json();

      if (sData.Response === 'False' || !Array.isArray(sData.Search)) {
        return new Response(JSON.stringify({ results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // OMDb's search returns minimal info (title, year, imdbID, type, poster).
      // For the picker we don't need full details — just enough to identify the right one.
      const results = sData.Search.slice(0, 5).map(s => ({
        imdbId: s.imdbID,
        title: s.Title,
        year: s.Year ? parseInt(String(s.Year).substring(0, 4)) : null,
        type: s.Type, // 'movie' | 'series' | 'episode'
        coverUrl: (s.Poster && s.Poster !== 'N/A') ? s.Poster : null,
      }));
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Single mode (default, original behavior) ---
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
