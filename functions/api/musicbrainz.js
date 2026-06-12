// Cloudflare Pages Function: MusicBrainz album lookup
// MusicBrainz is free, no API key, but requires a User-Agent and rate-limits to 1 req/sec.
// Cover art comes from Cover Art Archive, a sister project.

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
  const artist = url.searchParams.get('artist');
  const mbid = url.searchParams.get('mbid'); // for URL-paste refetch in Session B
  if (!title && !mbid) {
    return new Response(JSON.stringify({ error: 'title or mbid parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // Direct MBID fetch (Session B)
    if (mbid) {
      const grpUrl = `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(mbid)}?inc=artist-credits&fmt=json`;
      const gResp = await fetch(grpUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      });
      if (!gResp.ok) {
        return new Response(JSON.stringify({ error: 'MusicBrainz release-group not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      const g = await gResp.json();
      const result = {
        mbid: g.id,
        title: g.title,
        artist: (g['artist-credit'] && g['artist-credit'][0] && g['artist-credit'][0].name) || null,
        year: g['first-release-date'] ? parseInt(g['first-release-date'].substring(0, 4)) : null,
        albumType: (g['primary-type'] || 'album').toLowerCase(),
        coverUrl: `https://coverartarchive.org/release-group/${g.id}/front-500`,
      };
      // Try to fetch tracks too — don't block on failure
      let tracks = null;
      try {
        const releasesUrl = `https://musicbrainz.org/ws/2/release/?release-group=${mbid}&inc=recordings&fmt=json&limit=1`;
        const relResp = await fetch(releasesUrl, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        });
        if (relResp.ok) {
          const relData = await relResp.json();
          const release = relData.releases && relData.releases[0];
          if (release && Array.isArray(release.media)) {
            tracks = [];
            release.media.forEach(medium => {
              (medium.tracks || []).forEach(t => {
                tracks.push({
                  number: tracks.length + 1,
                  title: t.title || (t.recording && t.recording.title) || `Track ${tracks.length + 1}`,
                  durationMs: t.length || (t.recording && t.recording.length) || null,
                });
              });
            });
            result.trackCount = tracks.length;
          }
        }
      } catch (e) { /* tracks are best-effort */ }
      return new Response(JSON.stringify({ results: [result], tracks }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Build MusicBrainz Lucene-style query: prefer release-group (album-level identity)
    const escape = (s) => String(s).replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, '\\$&');
    let query = `releasegroup:"${escape(title)}"`;
    if (artist) query += ` AND artist:"${escape(artist)}"`;
    query += ' AND (primarytype:album OR primarytype:ep)';

    const searchUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'MusicBrainz upstream error: ' + resp.status }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const data = await resp.json();

    const groups = (data['release-groups'] || []).map(g => ({
      mbid: g.id,
      title: g.title,
      artist: (g['artist-credit'] && g['artist-credit'][0] && g['artist-credit'][0].name) || null,
      year: g['first-release-date'] ? parseInt(g['first-release-date'].substring(0, 4)) : null,
      albumType: (g['primary-type'] || 'album').toLowerCase(),
      coverUrl: `https://coverartarchive.org/release-group/${g.id}/front-500`,
      score: g.score,
    }));

    // For the top result, also fetch the track list
    let tracks = null;
    if (groups.length > 0) {
      try {
        const topMbid = groups[0].mbid;
        // Get the canonical release for this group, then its tracks
        // Simpler: fetch one release in the group + its recordings
        const releasesUrl = `https://musicbrainz.org/ws/2/release/?release-group=${topMbid}&inc=recordings&fmt=json&limit=1`;
        const relResp = await fetch(releasesUrl, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        });
        if (relResp.ok) {
          const relData = await relResp.json();
          const release = (relData.releases && relData.releases[0]);
          if (release && Array.isArray(release.media) && release.media.length > 0) {
            // Flatten tracks across all media (CD1, CD2, etc.) — most albums are single-disc
            tracks = [];
            release.media.forEach((medium, mi) => {
              (medium.tracks || []).forEach(t => {
                tracks.push({
                  number: tracks.length + 1,
                  title: t.title || (t.recording && t.recording.title) || `Track ${t.position || tracks.length + 1}`,
                  durationMs: t.length || (t.recording && t.recording.length) || null,
                });
              });
            });
            groups[0].trackCount = tracks.length;
          }
        }
      } catch (trackErr) {
        // Track fetch is best-effort; album result is still valid without it
      }
    }

    return new Response(JSON.stringify({ results: groups, tracks }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Lookup failed: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
