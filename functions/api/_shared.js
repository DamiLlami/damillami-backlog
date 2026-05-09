// Shared helpers for the cloud-sync API endpoints.
// All endpoints require the MEDIA_BOOK KV namespace binding.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
};

// Standard JSON response with CORS headers
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export function err(message, status = 400) {
  return json({ error: message }, status);
}

// Generate a memorable but secure code: word-XXXX-XXXX
// Uses 8 random hex chars (32 bits) per segment which gives ~10^15 possible codes —
// vastly too many to brute force.
const ADJECTIVES = ['swift', 'misty', 'nova', 'echo', 'lunar', 'solar', 'cobalt', 'sage', 'amber', 'ivory', 'crimson', 'ember', 'frost', 'velvet', 'onyx', 'jade'];

export function generateCode(prefix) {
  const adj = prefix && /^[a-z0-9]+$/i.test(prefix)
    ? prefix.toLowerCase().slice(0, 12)
    : ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${adj}-${rand(2)}-${rand(2)}`;
}

export function generateLibraryId() {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `lib_${rand}`;
}

// Look up the access code from the request header. Returns the code record from KV
// (with .code field added) or null if missing/invalid/revoked.
export async function lookupCode(request, env) {
  const code = request.headers.get('X-Access-Code');
  if (!code) return { error: 'No access code provided', status: 401 };

  const raw = await env.MEDIA_BOOK.get(`code:${code}`);
  if (!raw) return { error: 'Invalid access code', status: 401 };

  let record;
  try { record = JSON.parse(raw); } catch (e) { return { error: 'Corrupt code record', status: 500 }; }

  if (record.status === 'revoked-strict') {
    return { error: 'This code has been revoked', status: 403, revoked: 'strict' };
  }
  if (record.status === 'revoked-graceful') {
    // Graceful: read still works (so the device can fetch a final "you're revoked" message)
    // but writes are blocked. We mark it on the record for the endpoint to decide.
    record.gracefullyRevoked = true;
  }

  record.code = code;
  return { record };
}

// Verify the requesting code is the admin code
export async function isAdmin(record, env) {
  if (!record) return false;
  const adminRaw = await env.MEDIA_BOOK.get('admin');
  if (!adminRaw) return false;
  let admin;
  try { admin = JSON.parse(adminRaw); } catch (e) { return false; }
  return admin.adminCode === record.code;
}

// Update the lastSeenAt timestamp on a code record (fire-and-forget; non-blocking)
export async function touchCode(record, env) {
  try {
    record.lastSeenAt = Date.now();
    await env.MEDIA_BOOK.put(`code:${record.code}`, JSON.stringify(record));
  } catch (e) { /* swallow — purely a usage tracker */ }
}

export async function readLibrary(libraryId, env) {
  const raw = await env.MEDIA_BOOK.get(`library:${libraryId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export async function writeLibrary(libraryId, data, env) {
  data.updatedAt = Date.now();
  await env.MEDIA_BOOK.put(`library:${libraryId}`, JSON.stringify(data));
  return data;
}
