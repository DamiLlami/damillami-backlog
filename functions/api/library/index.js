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
    // Optional: client-supplied lastModified for conflict detection in a future session
    if (typeof body.clientUpdatedAt === 'number') lib.clientUpdatedAt = body.clientUpdatedAt;

    await writeLibrary(record.libraryId, lib, env);
    touchCode(record, env);

    return json({ success: true, updatedAt: lib.updatedAt });
  }

  return err('Method not allowed', 405);
};
