// Cloudflare Pages Function: TMDb (The Movie Database) lookup
// Returns metadata for movies and TV shows.
// Credentials come from environment variable: TMDB_API_KEY
//   (a v3 API key from https://www.themoviedb.org/settings/api)
//
// Supports three modes, matching the OMDb proxy's shape so the client can treat
// sources uniformly:
//   ?title=X&type=movie&multi=1   → list of up to 5 candidate matches (picker UI)
//   ?title=X&type=tv&multi=1      → same, for TV
//   ?tmdbId=123&type=movie        → fetch a specific entry by TMDb ID (enrichment / URL refetch)
//   ?title=X&type=movie           → single best match (legacy direct-add path)
//
// TMDb specifics handled here:
//   - separate /search/movie and /search/tv endpoints (no combined typed search like OMDb)
//   - poster_path is a relative path; we prefix the image CDN base to build a full URL
//   - details come from /movie/{id} or /tv/{id}; genres are an array of {id,name}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// TMDb serves images from this CDN. w500 is a good poster width for cards/pickers.
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Normalize TMDb's 'movie' vs 'tv'. The client sends type=movie|series|tv.
function normType(type) {
  if (type === 'tv' || type === 'series') return 'tv';
  return 'movie';
}

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const type = normType(url.searchParams.get('type'));
  const multi = url.searchParams.get('multi') === '1';
  const tmdbId = url.searchParams.get('tmdbId');

  if (!title && !tmdbId) {
    return json({ error: 'missing title or tmdbId param' }, 400);
  }

  const key = env.TMDB_API_KEY;
  if (!key) {
    return json({ error: 'TMDb key not configured on server' }, 500);
  }

  try {
    // --- Direct ID fetch (enrichment) ---
    if (tmdbId) {
      const r = await fetch(`https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}?api_key=${key}`);
      if (!r.ok) return json({ error: 'TMDb detail query failed: ' + r.status }, 502);
      const d = await r.json();
      // Return a normalized shape the client maps in fetchByCandidateId.
      const releaseDate = d.release_date || d.first_air_date || '';
      return json({
        tmdbId: d.id,
        title: d.title || d.name || '',
        year: releaseDate ? parseInt(releaseDate.substring(0, 4)) : null,
        genre: (Array.isArray(d.genres) && d.genres.length) ? d.genres[0].name : null,
        summary: d.overview || '',
        coverUrl: d.poster_path ? IMG_BASE + d.poster_path : null,
        voteAverage: typeof d.vote_average === 'number' ? d.vote_average : null,
        totalSeasons: (type === 'tv' && typeof d.number_of_seasons === 'number') ? d.number_of_seasons : null,
        mediaType: type,
      });
    }

    // --- Multi (search) mode: list of candidates ---
    if (multi) {
      const sR = await fetch(`https://api.themoviedb.org/3/search/${type}?api_key=${key}&query=${encodeURIComponent(title)}&include_adult=false`);
      if (!sR.ok) return json({ results: [] });
      const sData = await sR.json();
      if (!Array.isArray(sData.results)) return json({ results: [] });
      const results = sData.results.slice(0, 5).map(s => {
        const releaseDate = s.release_date || s.first_air_date || '';
        return {
          tmdbId: s.id,
          title: s.title || s.name || '',
          year: releaseDate ? parseInt(releaseDate.substring(0, 4)) : null,
          type,
          coverUrl: s.poster_path ? IMG_BASE + s.poster_path : null,
        };
      });
      return json({ results });
    }

    // --- Single mode (default) ---
    const sR = await fetch(`https://api.themoviedb.org/3/search/${type}?api_key=${key}&query=${encodeURIComponent(title)}&include_adult=false`);
    if (!sR.ok) return json({ error: 'TMDb search failed: ' + sR.status }, 502);
    const sData = await sR.json();
    if (!Array.isArray(sData.results) || sData.results.length === 0) {
      return json({ found: false });
    }
    const top = sData.results[0];
    // Fetch full details for genres/summary
    const dR = await fetch(`https://api.themoviedb.org/3/${type}/${top.id}?api_key=${key}`);
    const d = dR.ok ? await dR.json() : top;
    const releaseDate = d.release_date || d.first_air_date || top.release_date || top.first_air_date || '';
    return json({
      found: true,
      tmdbId: d.id || top.id,
      title: d.title || d.name || top.title || top.name || '',
      year: releaseDate ? parseInt(releaseDate.substring(0, 4)) : null,
      genre: (Array.isArray(d.genres) && d.genres.length) ? d.genres[0].name : null,
      summary: d.overview || top.overview || '',
      coverUrl: (d.poster_path || top.poster_path) ? IMG_BASE + (d.poster_path || top.poster_path) : null,
      voteAverage: typeof d.vote_average === 'number' ? d.vote_average : null,
      totalSeasons: (type === 'tv' && typeof d.number_of_seasons === 'number') ? d.number_of_seasons : null,
      mediaType: type,
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};
