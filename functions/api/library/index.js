// GET  /api/library  → { games, updatedAt, ... }
// PUT  /api/library  → body: { games }, returns { updatedAt }
// Headers: X-Access-Code
//
// GET works on graceful-revoked codes (so device can fetch a "you're revoked" notice
// or last-known data). PUT does NOT work on revoked codes of any kind.

import { corsHeaders, json, err, lookupCode, touchCode, readLibrary, writeLibrary, isAdmin } from '../_shared.js';

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);

  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  const record = lookup.record;

  if (request.method === 'GET') {
    const lib = await readLibrary(record.libraryId, env);
    if (!lib) return err('Library not found', 404);
    // Don't await touchCode — fire and forget
    touchCode(record, env);
    return json({
      library: lib,
      displayName: record.displayName,
      isAdmin: !!record.isAdmin,
      revoked: record.gracefullyRevoked ? 'graceful' : null,
    });
  }

  if (request.method === 'PUT') {
    if (record.gracefullyRevoked) {
      return err('Your code has been revoked. Saves are disabled.', 403);
    }
    let body;
    try { body = await request.json(); } catch (e) { return err('Invalid JSON body'); }

    if (!Array.isArray(body.games)) return err('games array is required');

    const lib = await readLibrary(record.libraryId, env) || { games: [], createdAt: Date.now() };
    lib.games = body.games;

    // Custom genres — user-defined additions per media type. Sync'd as part of library so
    // they carry across devices. Validate shape before storing to keep KV clean.
    if (body.customGenres && typeof body.customGenres === 'object') {
      const validTypes = ['game', 'movie', 'tv', 'book', 'album'];
      const clean = { game: [], movie: [], tv: [], book: [], album: [] };
      for (const t of validTypes) {
        if (Array.isArray(body.customGenres[t])) {
          clean[t] = body.customGenres[t]
            .filter(g => typeof g === 'string' && g.trim().length > 0 && g.trim().length < 40)
            .map(g => g.trim())
            .slice(0, 100); // hard cap, protect KV from abuse
        }
      }
      lib.customGenres = clean;
    }

    // User preferences — currently just analyticsOptOut. Stored on the library so the
    // admin analytics endpoint can read it server-side without trusting client claims.
    if (body.userPreferences && typeof body.userPreferences === 'object') {
      lib.userPreferences = {
        analyticsOptOut: !!body.userPreferences.analyticsOptOut,
      };
    }

    // Optional: client-supplied lastModified for conflict detection in a future session
    if (typeof body.clientUpdatedAt === 'number') lib.clientUpdatedAt = body.clientUpdatedAt;
    lib.updatedAt = Date.now();

    await writeLibrary(record.libraryId, lib, env);
    touchCode(record, env);

    return json({ success: true, updatedAt: lib.updatedAt });
  }

  return err('Method not allowed', 405);
};
