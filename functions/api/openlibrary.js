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
  if (!title) {
    return new Response(JSON.stringify({ error: 'title parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
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
