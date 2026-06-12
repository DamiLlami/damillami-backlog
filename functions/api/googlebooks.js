// Cloudflare Pages Function: Google Books API lookup
// Returns metadata for books (title, author, year, cover, description, page count).
// Works WITHOUT an API key (basic rate ~1000 req/day).
// Optional: set GOOGLE_BOOKS_API_KEY in env vars for higher limits.
//
// Modes (mirrors the OMDb/TMDb proxy shape):
//   ?title=X&multi=1              → list of up to 5 candidate matches (picker)
//   ?googleBooksId=XXXX           → fetch a specific volume by its Google Books ID
//   ?title=X                      → single best match (legacy direct-add path)

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

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

function coverUrl(imageLinks) {
  if (!imageLinks) return null;
  // Prefer thumbnail, strip the zoom/edge params for a cleaner image
  const url = imageLinks.thumbnail || imageLinks.smallThumbnail || null;
  if (!url) return null;
  // Upgrade to HTTPS and use zoom=1 for reasonable quality
  return url.replace('http://', 'https://').replace(/&?zoom=\d+/, '') + '&zoom=1';
}

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const volumeId = url.searchParams.get('googleBooksId');
  const multi = url.searchParams.get('multi') === '1';

  if (!title && !volumeId) {
    return json({ error: 'missing title or googleBooksId param' }, 400);
  }

  const key = env.GOOGLE_BOOKS_API_KEY || '';
  const keyParam = key ? `&key=${key}` : '';

  try {
    // --- Direct volume fetch by ID ---
    if (volumeId) {
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(volumeId)}?${keyParam.replace(/^&/, '')}`);
      if (!r.ok) return json({ error: 'Google Books detail query failed: ' + r.status }, 502);
      const d = await r.json();
      const vi = d.volumeInfo || {};
      return json({
        googleBooksId: d.id,
        title: vi.title || '',
        author: Array.isArray(vi.authors) ? vi.authors.join(', ') : null,
        year: extractYear(vi.publishedDate),
        genre: Array.isArray(vi.categories) && vi.categories.length ? vi.categories[0] : null,
        summary: vi.description || '',
        coverUrl: coverUrl(vi.imageLinks),
        pageCount: typeof vi.pageCount === 'number' ? vi.pageCount : null,
      });
    }

    // --- Multi (search) mode ---
    if (multi) {
      const sR = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&maxResults=5&printType=books${keyParam}`);
      if (!sR.ok) return json({ results: [] });
      const sData = await sR.json();
      if (!Array.isArray(sData.items)) return json({ results: [] });
      const results = sData.items.slice(0, 5).map(item => {
        const vi = item.volumeInfo || {};
        return {
          googleBooksId: item.id,
          title: vi.title || '',
          author: Array.isArray(vi.authors) ? vi.authors.join(', ') : null,
          year: extractYear(vi.publishedDate),
          coverUrl: coverUrl(vi.imageLinks),
        };
      });
      return json({ results });
    }

    // --- Single mode ---
    const sR = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&maxResults=1&printType=books${keyParam}`);
    if (!sR.ok) return json({ error: 'Google Books search failed: ' + sR.status }, 502);
    const sData = await sR.json();
    if (!Array.isArray(sData.items) || sData.items.length === 0) return json({ found: false });
    const top = sData.items[0];
    const vi = top.volumeInfo || {};
    return json({
      found: true,
      googleBooksId: top.id,
      title: vi.title || '',
      author: Array.isArray(vi.authors) ? vi.authors.join(', ') : null,
      year: extractYear(vi.publishedDate),
      genre: Array.isArray(vi.categories) && vi.categories.length ? vi.categories[0] : null,
      summary: vi.description || '',
      coverUrl: coverUrl(vi.imageLinks),
      pageCount: typeof vi.pageCount === 'number' ? vi.pageCount : null,
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};
