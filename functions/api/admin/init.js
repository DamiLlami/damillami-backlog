// POST /api/admin/init
// One-time bootstrap: creates the admin code if none exists.
// Returns the admin code in the response — SAVE IT, we never show it again.
// Subsequent calls return { alreadyInitialized: true } and don't expose the code.

import { corsHeaders, json, err, generateCode, generateLibraryId } from '../_shared.js';

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!env.MEDIA_BOOK) {
    return err('KV namespace MEDIA_BOOK is not bound. Check Cloudflare Pages settings.', 500);
  }

  if (request.method !== 'POST') {
    return err('Method not allowed', 405);
  }

  // Check if admin already exists
  const existing = await env.MEDIA_BOOK.get('admin');
  if (existing) {
    return json({ alreadyInitialized: true, message: 'Admin code already exists. Cannot reset via API.' });
  }

  // Generate the admin code and a library for the admin to use
  const adminCode = generateCode('admin');
  const libraryId = generateLibraryId();
  const now = Date.now();

  await env.MEDIA_BOOK.put('admin', JSON.stringify({
    adminCode,
    createdAt: now,
  }));

  await env.MEDIA_BOOK.put(`code:${adminCode}`, JSON.stringify({
    libraryId,
    status: 'claimed',
    note: 'Admin (master code)',
    displayName: 'Admin',
    issuedAt: now,
    claimedAt: now,
    lastSeenAt: now,
    isAdmin: true,
  }));

  await env.MEDIA_BOOK.put(`library:${libraryId}`, JSON.stringify({
    games: [],
    createdAt: now,
    updatedAt: now,
  }));

  return json({
    success: true,
    adminCode,
    libraryId,
    message: 'Admin code created. SAVE THIS — it will not be shown again.',
  });
};
