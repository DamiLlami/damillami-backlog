// Cloudflare Pages Function: Open Library book lookup
// Open Library is free, requires no API key, but asks for a User-Agent
// so they can contact us if there's an issue.

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
  const author = url.searchParams.get('author');
  const workKey = url.searchParams.get('workKey'); // e.g., "/works/OL27448W" — for URL-paste refetch
  if (!title && !workKey) {
    return new Response(JSON.stringify({ error: 'title or workKey parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // Direct fetch by work key (used by URL-paste refetch in Session B)
    if (workKey) {
      // Normalize key: ensure leading slash
      const key = workKey.startsWith('/') ? workKey : '/' + workKey;
      const wResp = await fetch(`https://openlibrary.org${key}.json`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!wResp.ok) {
        return new Response(JSON.stringify({ error: 'Open Library work not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      const work = await wResp.json();
      // Author name needs a separate fetch from /authors/<key>.json
      let authorName = null;
      if (Array.isArray(work.authors) && work.authors.length > 0) {
        const authorRef = work.authors[0].author && work.authors[0].author.key;
        if (authorRef) {
          try {
            const aResp = await fetch(`https://openlibrary.org${authorRef}.json`, {
              headers: { 'User-Agent': USER_AGENT },
            });
            if (aResp.ok) {
              const aData = await aResp.json();
              authorName = aData.name || null;
            }
          } catch (e) { /* ignore — we still have the title */ }
        }
      }
      const result = {
        key: work.key,
        title: work.title,
        author: authorName,
        year: (work.first_publish_date && parseInt(work.first_publish_date.match(/\d{4}/)?.[0])) || null,
        subjects: Array.isArray(work.subjects) ? work.subjects.slice(0, 10) : [],
        coverUrl: (Array.isArray(work.covers) && work.covers[0])
          ? `https://covers.openlibrary.org/b/id/${work.covers[0]}-L.jpg`
          : null,
        pageCount: null, // not available on works, only on editions
      };
      return new Response(JSON.stringify({ results: [result] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Build the search query — combine title + author if both given
    const q = author ? `${title} ${author}` : title;
    const apiUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,isbn`;

    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'Open Library upstream error: ' + resp.status }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const data = await resp.json();
    const docs = (data.docs || []).map(d => ({
      key: d.key,
      title: d.title,
      author: Array.isArray(d.author_name) && d.author_name.length ? d.author_name[0] : null,
      year: d.first_publish_year || null,
      pageCount: d.number_of_pages_median || null,
      subjects: Array.isArray(d.subject) ? d.subject.slice(0, 10) : [],
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
      isbn: Array.isArray(d.isbn) && d.isbn.length ? d.isbn[0] : null,
    }));
    return new Response(JSON.stringify({ results: docs }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Lookup failed: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
