// GET  /api/admin/codes              → list all codes with metadata + entry counts
// POST /api/admin/codes               → body: { note?, prefix? } generate a new code
// Headers: X-Access-Code (must be admin)

import { corsHeaders, json, err, lookupCode, isAdmin, generateCode, generateLibraryId, readLibrary } from '../../_shared.js';

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);

  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  if (!(await isAdmin(lookup.record, env))) return err('Admin access required', 403);

  if (request.method === 'GET') {
    // List all keys with prefix code:
    const list = await env.MEDIA_BOOK.list({ prefix: 'code:' });
    const codes = [];
    for (const key of list.keys) {
      const code = key.name.slice('code:'.length);
      const raw = await env.MEDIA_BOOK.get(key.name);
      if (!raw) continue;
      let rec;
      try { rec = JSON.parse(raw); } catch (e) { continue; }
      // Get a quick entry count from the library
      let entryCount = null;
      const lib = await readLibrary(rec.libraryId, env);
      if (lib && Array.isArray(lib.games)) entryCount = lib.games.length;
      codes.push({
        code,
        libraryId: rec.libraryId,
        status: rec.status || 'unknown',
        note: rec.note || '',
        displayName: rec.displayName || '',
        issuedAt: rec.issuedAt || null,
        claimedAt: rec.claimedAt || null,
        lastSeenAt: rec.lastSeenAt || null,
        isAdmin: !!rec.isAdmin,
        entryCount,
      });
    }
    // Sort: admin first, then claimed by lastSeenAt desc, then issued by issuedAt desc
    codes.sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (b.isAdmin && !a.isAdmin) return 1;
      if (a.status === 'claimed' && b.status !== 'claimed') return -1;
      if (b.status === 'claimed' && a.status !== 'claimed') return 1;
      return (b.lastSeenAt || b.issuedAt || 0) - (a.lastSeenAt || a.issuedAt || 0);
    });
    return json({ codes });
  }

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (e) { /* allow empty body */ }
    const note = String(body.note || '').trim().slice(0, 200);
    const prefix = String(body.prefix || '').trim().slice(0, 12);

    // Generate code (retry up to 5 times if collision)
    let code;
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode(prefix);
      const existing = await env.MEDIA_BOOK.get(`code:${candidate}`);
      if (!existing) { code = candidate; break; }
    }
    if (!code) return err('Could not generate unique code', 500);

    const libraryId = generateLibraryId();
    const now = Date.now();

    await env.MEDIA_BOOK.put(`code:${code}`, JSON.stringify({
      libraryId,
      status: 'issued',
      note,
      displayName: '',
      issuedAt: now,
      claimedAt: null,
      lastSeenAt: null,
      isAdmin: false,
    }));

    await env.MEDIA_BOOK.put(`library:${libraryId}`, JSON.stringify({
      games: [],
      createdAt: now,
      updatedAt: now,
    }));

    return json({
      success: true,
      code,
      libraryId,
      note,
    });
  }

  return err('Method not allowed', 405);
};
