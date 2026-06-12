// GET  /api/backup  → { snapshot } | { snapshot: null }
// PUT  /api/backup  → body: { snapshot: { ts, reason, count, games } }, returns { ok, ts }
// Headers: X-Access-Code
//
// Stores ONE most-recent snapshot per library in a SEPARATE KV key (`backup:<libraryId>`),
// completely independent of the live library key (`library:<libraryId>`). This separation
// is the whole point: a corrupt or accidental write to the live library via /api/library
// can never overwrite this backup. It's an isolated point-in-time copy for recovery.
//
// We intentionally keep only the latest cloud snapshot (KV value-size friendly); richer
// history lives client-side in IndexedDB. The cloud copy exists for device-loss recovery.

import { corsHeaders, json, err, lookupCode } from '../_shared.js';

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);

  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  const record = lookup.record;
  const key = `backup:${record.libraryId}`;

  if (request.method === 'GET') {
    const raw = await env.MEDIA_BOOK.get(key);
    if (!raw) return json({ snapshot: null });
    try {
      return json({ snapshot: JSON.parse(raw) });
    } catch (e) {
      return json({ snapshot: null });
    }
  }

  if (request.method === 'PUT') {
    // Note: unlike /api/library, we allow PUT even on gracefully-revoked codes — letting a
    // revoked user still capture a backup of their own data is strictly protective.
    let body;
    try { body = await request.json(); } catch (e) { return err('Invalid JSON body'); }

    const snap = body.snapshot;
    if (!snap || !Array.isArray(snap.games)) {
      return err('snapshot.games array is required');
    }
    // Guard against absurd payloads
    if (snap.games.length > 100000) return err('snapshot too large', 413);

    const toStore = {
      ts: typeof snap.ts === 'number' ? snap.ts : Date.now(),
      reason: typeof snap.reason === 'string' ? snap.reason.slice(0, 40) : 'auto',
      count: typeof snap.count === 'number' ? snap.count : snap.games.length,
      games: snap.games,
      storedAt: Date.now(),
    };
    await env.MEDIA_BOOK.put(key, JSON.stringify(toStore));
    return json({ ok: true, ts: toStore.ts });
  }

  return err('Method not allowed', 405);
};
