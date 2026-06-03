// Push notification management endpoints.
//
// POST /api/push?action=subscribe   — body: { subscription }  → stores push sub in KV
// POST /api/push?action=unsubscribe — removes push sub from KV
// POST /api/push?action=send        — admin+secret: triggers reminder check for all users
// GET  /api/push                    — returns { subscribed: bool } for the authed user
//
// Headers: X-Access-Code (for subscribe/unsubscribe/get)
// Headers: X-Push-Secret (for send — matches PUSH_CRON_SECRET env var)

import { corsHeaders, json, err, lookupCode, isAdmin } from './_shared.js';
import { sendPushNotification } from './_push-utils.js';

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // --- Send reminders (cron-triggered or admin-triggered) ---
  if (request.method === 'POST' && action === 'send') {
    // Authenticate: either admin access code OR a secret token for the cron
    const pushSecret = request.headers.get('X-Push-Secret') || url.searchParams.get('secret');
    const isSecretValid = env.PUSH_CRON_SECRET && pushSecret === env.PUSH_CRON_SECRET;

    let isAdminUser = false;
    if (!isSecretValid) {
      const lookup = await lookupCode(request, env);
      if (!lookup.error) isAdminUser = await isAdmin(lookup.record, env);
    }
    if (!isSecretValid && !isAdminUser) return err('Unauthorized', 403);

    // Iterate all push subscriptions and check reminder conditions
    const results = await sendReminders(env);
    return json({ ok: true, sent: results.sent, checked: results.checked, errors: results.errors });
  }

  // All other actions need auth
  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  const record = lookup.record;
  const pushKey = `push:${record.libraryId}`;

  // --- GET: check if subscribed + return VAPID public key ---
  if (request.method === 'GET') {
    const raw = await env.MEDIA_BOOK.get(pushKey);
    return json({
      subscribed: !!raw,
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    });
  }

  if (request.method !== 'POST') return err('Method not allowed', 405);

  // --- Subscribe ---
  if (action === 'subscribe') {
    let body;
    try { body = await request.json(); } catch (e) { return err('Invalid JSON body'); }
    if (!body.subscription || !body.subscription.endpoint) return err('subscription.endpoint required');
    await env.MEDIA_BOOK.put(pushKey, JSON.stringify({
      subscription: body.subscription,
      subscribedAt: Date.now(),
      libraryId: record.libraryId,
      displayName: record.displayName || '',
    }));
    return json({ ok: true });
  }

  // --- Unsubscribe ---
  if (action === 'unsubscribe') {
    await env.MEDIA_BOOK.delete(pushKey);
    return json({ ok: true });
  }

  return err('Unknown action', 400);
};

// --- Reminder logic ---
// Checks each user with a push subscription against reminder conditions,
// sends a push if any trigger. Returns stats.
async function sendReminders(env) {
  const stats = { checked: 0, sent: 0, errors: 0 };

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { ...stats, errors: 1, errorMessage: 'VAPID keys not configured' };
  }

  // List all push: keys
  const listResult = await env.MEDIA_BOOK.list({ prefix: 'push:' });
  const pushKeys = listResult.keys || [];

  const DAY = 86400000;
  const now = Date.now();

  for (const keyObj of pushKeys) {
    stats.checked++;
    try {
      const pushRaw = await env.MEDIA_BOOK.get(keyObj.name);
      if (!pushRaw) continue;
      const pushData = JSON.parse(pushRaw);
      if (!pushData.subscription || !pushData.libraryId) continue;

      // Read the user's library
      const libRaw = await env.MEDIA_BOOK.get(`library:${pushData.libraryId}`);
      if (!libRaw) continue;
      const lib = JSON.parse(libRaw);
      const games = Array.isArray(lib.games) ? lib.games : [];
      if (games.length === 0) continue;

      // Evaluate conditions (same as in-app reminders)
      const inProgress = games.filter(g => {
        const s = (g.status || '').toLowerCase();
        return s === 'in-progress' || s === 'playing' || s === 'watching' || s === 'reading' || s === 'listening';
      });
      const backlog = games.filter(g => {
        const s = (g.status || '').toLowerCase();
        return s === 'backlog';
      });
      const completed = games.filter(g => {
        const s = (g.status || '').toLowerCase();
        return s === 'played' || s === 'completed' || s === 'watched' || s === 'read' || s === 'listened';
      });

      let notification = null;

      // 1. Stale in-progress (7+ days untouched)
      const stale = inProgress.filter(g => {
        const last = g.updatedAt || g.startedAt || g.addedAt || 0;
        return (now - last) > 7 * DAY;
      });
      if (stale.length > 0) {
        const names = stale.slice(0, 2).map(g => g.title).join(', ');
        notification = {
          title: '📌 Time to catch up?',
          body: `${names}${stale.length > 2 ? ' and ' + (stale.length - 2) + ' more' : ''} haven't been updated in over a week.`,
          url: '/',
        };
      }

      // 2. Big backlog, nothing in progress
      if (!notification && inProgress.length === 0 && backlog.length >= 5) {
        notification = {
          title: '📚 Your backlog misses you',
          body: `${backlog.length} things waiting — time to start something new?`,
          url: '/',
        };
      }

      // 3. Unrated completed items
      if (!notification) {
        const unrated = completed.filter(g => !g.rating || g.rating === 0);
        if (unrated.length >= 5) {
          notification = {
            title: '⭐ Rate your favorites',
            body: `${unrated.length} completed items without a rating — a few taps makes recommendations better.`,
            url: '/',
          };
        }
      }

      // Don't send if we already sent recently (check a lastNotified timestamp)
      if (notification && pushData.lastNotified && (now - pushData.lastNotified) < DAY) {
        continue; // already notified within the last 24h
      }

      if (notification) {
        const result = await sendPushNotification(pushData.subscription, notification, env);
        if (result.ok || result.status === 201) {
          stats.sent++;
          // Record when we last notified so we don't spam
          pushData.lastNotified = now;
          await env.MEDIA_BOOK.put(keyObj.name, JSON.stringify(pushData));
        } else if (result.status === 410 || result.status === 404) {
          // Subscription expired or invalid — clean it up
          await env.MEDIA_BOOK.delete(keyObj.name);
        } else {
          stats.errors++;
        }
      }
    } catch (e) {
      stats.errors++;
    }
  }

  return stats;
}
