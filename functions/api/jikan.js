// Cloudflare Pages Function: Jikan (MyAnimeList) anime + manga lookup
// Free, no API key required. Public rate limit is 3 req/sec, 60/min.
// Docs: https://docs.api.jikan.moe/
//
// Supports three modes:
//   ?title=X                → single best match (current behavior pattern for direct adds)
//   ?title=X&multi=1        → list of up to 5 candidate matches (used for the picker UI)
//   ?malId=12345            → fetch a specific anime by MyAnimeList ID (URL-paste refetch)
//
// `mediaType` query param ('tv' | 'movie') filters Jikan to TV or movie types respectively.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const USER_AGENT = 'DamiMediaBook/1.0 (personal media tracker)';

export const onRequest = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const malId = url.searchParams.get('malId');
  const mediaType = url.searchParams.get('mediaType') || 'tv'; // 'tv' or 'movie'
  const multi = url.searchParams.get('multi') === '1';

  if (!title && !malId) {
    return new Response(JSON.stringify({ error: 'missing title or malId param' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // --- Direct fetch by MAL ID ---
    if (malId) {
      const r = await fetch(`https://api.jikan.moe/v4/anime/${encodeURIComponent(malId)}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: 'Jikan returned ' + r.status }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const data = await r.json();
      // Jikan returns { data: {...} } for the by-id endpoint
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Search mode (both multi and single use the same endpoint) ---
    // Jikan's /anime endpoint supports type filtering: 'tv', 'movie', 'ova', 'special', 'ona', 'music'
    // For 'tv' we want broader anime TV results; for 'movie' we want only films.
    const jikanType = mediaType === 'movie' ? 'movie' : 'tv';
    const params = new URLSearchParams({
      q: title,
      type: jikanType,
      limit: '5',
      // order_by score desc gets the most-relevant anime first (helps with common titles)
      order_by: 'score',
      sort: 'desc',
    });
    const r = await fetch(`https://api.jikan.moe/v4/anime?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'Jikan returned ' + r.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const data = await r.json();
    const items = Array.isArray(data.data) ? data.data : [];

    // For multi (picker) mode, return a normalized candidate list
    if (multi) {
      const results = items.slice(0, 5).map(a => ({
        malId: a.mal_id,
        title: a.title_english || a.title,
        titleJapanese: a.title_japanese || null,
        year: a.year || (a.aired && a.aired.from ? parseInt(a.aired.from.substring(0, 4)) : null),
        coverUrl: (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || null,
        episodes: a.episodes || null,
        score: a.score || null,
        type: a.type || null, // 'TV', 'Movie', 'OVA', etc.
        status: a.status || null, // 'Finished Airing', 'Currently Airing', etc.
        studios: Array.isArray(a.studios) ? a.studios.map(s => s.name).slice(0, 2) : [],
      }));
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Single mode: return the raw best match for backward compatibility
    return new Response(JSON.stringify({ data: items[0] || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Lookup failed: ' + e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
