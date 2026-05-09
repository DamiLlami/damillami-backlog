// POST /api/library/init
// Body: { displayName }
// Headers: X-Access-Code
// First-time claim of an issued code. Records display name and marks code as claimed.
// If the code is already claimed, just updates the display name (allows re-claim if user wants
// to change their name).

import { corsHeaders, json, err, lookupCode } from '../_shared.js';

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);
  if (request.method !== 'POST') return err('Method not allowed', 405);

  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  const record = lookup.record;

  let body;
  try { body = await request.json(); } catch (e) { return err('Invalid JSON body'); }

  const displayName = String(body.displayName || '').trim().slice(0, 80);
  if (!displayName) return err('displayName is required');

  const now = Date.now();
  const wasUnclaimed = (record.status === 'issued');

  record.displayName = displayName;
  record.lastSeenAt = now;
  if (wasUnclaimed) {
    record.status = 'claimed';
    record.claimedAt = now;
  }

  await env.MEDIA_BOOK.put(`code:${record.code}`, JSON.stringify(record));

  return json({
    success: true,
    displayName: record.displayName,
    libraryId: record.libraryId,
    isAdmin: !!record.isAdmin,
    firstClaim: wasUnclaimed,
  });
};
