// POST /api/error-log  → body: { message, loc, v, at }  (any signed-in user appends)
// GET  /api/error-log  → { errors: [...] }                (admin only — reads the log)
// Headers: X-Access-Code
//
// Stores a single rolling, capped array of recent runtime errors across all users under
// the `errorlog` KV key. Each entry carries ONLY error metadata (message, location, app
// version, timestamp) plus the reporting library's id + display name so the admin can see
// who/how widely an error is hitting. NEVER stores library contents, titles, or codes.
//
// Purpose: give the admin visibility into errors users hit, so a bug doesn't take six
// versions to discover (the login-bug lesson). De-duplicates by message+location+version,
// collapsing repeats into a count instead of flooding.

import { corsHeaders, json, err, lookupCode, isAdmin } from '../_shared.js';

const LOG_KEY = 'errorlog';
const MAX_ENTRIES = 100;

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);

  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  const record = lookup.record;

  if (request.method === 'GET') {
    // Admin-only: only the admin should see the cross-user error log.
    if (!(await isAdmin(record, env))) return err('Admin only', 403);
    const raw = await env.MEDIA_BOOK.get(LOG_KEY);
    let errors = [];
    if (raw) { try { errors = JSON.parse(raw); } catch (e) { errors = []; } }
    return json({ errors });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('Invalid JSON body'); }

    // Sanitize — bounded strings only, no personal data.
    const message = String(body.message || 'Unknown error').slice(0, 300);
    const loc = String(body.loc || '').slice(0, 200);
    const v = String(body.v || 'unknown').slice(0, 20);
    const at = typeof body.at === 'number' ? body.at : Date.now();

    const raw = await env.MEDIA_BOOK.get(LOG_KEY);
    let errors = [];
    if (raw) { try { errors = JSON.parse(raw); } catch (e) { errors = []; } }

    // Dedupe by message+loc+version+library — collapse repeats into a count.
    const dedupeKey = `${message}|${loc}|${v}|${record.libraryId}`;
    const existing = errors.find(e => e.k === dedupeKey);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastAt = at;
    } else {
      errors.push({
        k: dedupeKey,
        message, loc, v,
        firstAt: at, lastAt: at, count: 1,
        libraryId: record.libraryId,
        who: record.displayName || '(unnamed)',
      });
    }
    // Keep only the most recent MAX_ENTRIES by lastAt.
    errors.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    if (errors.length > MAX_ENTRIES) errors = errors.slice(0, MAX_ENTRIES);

    await env.MEDIA_BOOK.put(LOG_KEY, JSON.stringify(errors));
    return json({ ok: true });
  }

  return err('Method not allowed', 405);
};
