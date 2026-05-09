// POST /api/admin/codes/:code/action
// Body: { action: 'rotate' | 'revoke', mode?: 'strict' | 'graceful' }
// Headers: X-Access-Code (must be admin)
//
// rotate: generates a new code pointing to the same libraryId, marks old as 'rotated'
// revoke: marks the code as revoked-strict or revoked-graceful (default strict)

import { corsHeaders, json, err, lookupCode, isAdmin, generateCode } from '../../../_shared.js';

export const onRequest = async ({ request, env, params }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);
  if (request.method !== 'POST') return err('Method not allowed', 405);

  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  if (!(await isAdmin(lookup.record, env))) return err('Admin access required', 403);

  const targetCode = params.code;
  if (!targetCode) return err('Code parameter required');

  const targetRaw = await env.MEDIA_BOOK.get(`code:${targetCode}`);
  if (!targetRaw) return err('Target code not found', 404);

  let targetRecord;
  try { targetRecord = JSON.parse(targetRaw); } catch (e) { return err('Corrupt code record', 500); }

  // Don't allow operations on the admin's own code
  if (targetRecord.isAdmin) {
    return err('Cannot rotate or revoke the admin code via API', 400);
  }

  let body = {};
  try { body = await request.json(); } catch (e) { /* allow empty */ }
  const action = body.action;
  const mode = body.mode === 'graceful' ? 'graceful' : 'strict';
  const now = Date.now();

  if (action === 'rotate') {
    // Generate a new code pointing to the same library
    let newCode;
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode(body.prefix || '');
      const existing = await env.MEDIA_BOOK.get(`code:${candidate}`);
      if (!existing) { newCode = candidate; break; }
    }
    if (!newCode) return err('Could not generate unique replacement code', 500);

    // New code inherits the user's identity (display name, library)
    await env.MEDIA_BOOK.put(`code:${newCode}`, JSON.stringify({
      libraryId: targetRecord.libraryId,
      status: targetRecord.status === 'issued' ? 'issued' : 'claimed',
      note: targetRecord.note || '',
      displayName: targetRecord.displayName || '',
      issuedAt: now,
      claimedAt: targetRecord.claimedAt,
      lastSeenAt: null,
      rotatedFrom: targetCode,
      isAdmin: false,
    }));

    // Mark old code with the chosen revoke mode (strict by default for rotation;
    // graceful if explicitly chosen so user can keep working briefly during the swap)
    targetRecord.status = mode === 'graceful' ? 'revoked-graceful' : 'revoked-strict';
    targetRecord.rotatedTo = newCode;
    targetRecord.revokedAt = now;
    await env.MEDIA_BOOK.put(`code:${targetCode}`, JSON.stringify(targetRecord));

    return json({
      success: true,
      action: 'rotate',
      mode,
      oldCode: targetCode,
      newCode,
      libraryId: targetRecord.libraryId,
      displayName: targetRecord.displayName,
    });
  }

  if (action === 'revoke') {
    targetRecord.status = mode === 'graceful' ? 'revoked-graceful' : 'revoked-strict';
    targetRecord.revokedAt = now;
    await env.MEDIA_BOOK.put(`code:${targetCode}`, JSON.stringify(targetRecord));
    return json({
      success: true,
      action: 'revoke',
      mode,
      code: targetCode,
    });
  }

  return err('Unknown action. Use "rotate" or "revoke"');
};
