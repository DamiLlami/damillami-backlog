// Cloudflare Pages Function: iTunes Search API proxy for music albums
// Returns album metadata (title, artist, year, cover, track count).
// FREE — no API key needed. No rate limit published but be respectful.
//
// Modes:
//   ?title=X&multi=1              → list of up to 5 album candidates
//   ?itunesId=XXXX                → fetch a specific album by its collection ID
//   ?title=X                      → single best match

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normAlbum(item) {
  return {
    itunesId: item.collectionId,
    title: item.collectionName || '',
    artist: item.artistName || '',
    year: item.releaseDate ? parseInt(item.releaseDate.substring(0, 4)) : null,
    coverUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100', '600x600') : null,
    trackCount: typeof item.trackCount === 'number' ? item.trackCount : null,
    genre: item.primaryGenreName || null,
  };
}

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const itunesId = url.searchParams.get('itunesId');
  const multi = url.searchParams.get('multi') === '1';

  if (!title && !itunesId) {
    return json({ error: 'missing title or itunesId param' }, 400);
  }

  try {
    // --- Direct lookup by collection ID ---
    if (itunesId) {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(itunesId)}&entity=album`);
      if (!r.ok) return json({ error: 'iTunes lookup failed: ' + r.status }, 502);
      const data = await r.json();
      if (!data.results || data.results.length === 0) return json({ found: false });
      return json(normAlbum(data.results[0]));
    }

    // --- Search ---
    const sR = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=album&limit=${multi ? 5 : 1}`);
    if (!sR.ok) return json(multi ? { results: [] } : { found: false });
    const sData = await sR.json();
    if (!Array.isArray(sData.results) || sData.results.length === 0) {
      return json(multi ? { results: [] } : { found: false });
    }

    if (multi) {
      return json({ results: sData.results.slice(0, 5).map(normAlbum) });
    }

    // Single mode — return enriched result
    const top = normAlbum(sData.results[0]);
    top.found = true;
    return json(top);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};
