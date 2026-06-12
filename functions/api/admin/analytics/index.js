// GET /api/admin/analytics → admin-only per-user aggregate stats
//
// Returns a list of users with aggregate counts and breakdowns. Users who have set
// userPreferences.analyticsOptOut = true are excluded entirely (returned with just
// { displayName, optedOut: true } so the admin can see SOMEONE has opted out without
// seeing their data). No titles, ratings, or notes are ever returned — only counts.

import { corsHeaders, json, err, lookupCode, isAdmin, readLibrary } from '../../_shared.js';

export const onRequest = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== 'GET') return err('Method not allowed', 405);
  if (!env.MEDIA_BOOK) return err('KV namespace not bound', 500);

  const lookup = await lookupCode(request, env);
  if (lookup.error) return err(lookup.error, lookup.status);
  if (!(await isAdmin(lookup.record, env))) return err('Admin access required', 403);

  // List all codes — same pattern as /api/admin/codes
  const list = await env.MEDIA_BOOK.list({ prefix: 'code:' });
  const users = [];
  let totalEntries = 0;
  let totalActiveUsers = 0;
  const globalMediaTypeCounts = { game: 0, movie: 0, tv: 0, book: 0, album: 0 };
  const globalGenreCounts = {};
  let optedOutCount = 0;

  for (const key of list.keys) {
    const code = key.name.slice('code:'.length);
    const raw = await env.MEDIA_BOOK.get(key.name);
    if (!raw) continue;
    let rec;
    try { rec = JSON.parse(raw); } catch (e) { continue; }

    // Skip revoked codes entirely from analytics — they're not active users
    if (rec.status === 'revoked-strict' || rec.status === 'revoked-graceful') continue;

    const lib = await readLibrary(rec.libraryId, env);
    const games = (lib && Array.isArray(lib.games)) ? lib.games : [];
    const userPrefs = (lib && lib.userPreferences) || {};
    const optedOut = !!userPrefs.analyticsOptOut;

    // If user opted out, return only a stub entry — admin can see they exist but not data
    if (optedOut) {
      optedOutCount++;
      users.push({
        code,
        displayName: rec.displayName || '(unclaimed)',
        isAdmin: !!rec.isAdmin,
        status: rec.status || 'unknown',
        optedOut: true,
      });
      continue;
    }

    // Compute per-user stats
    const mediaTypeCounts = { game: 0, movie: 0, tv: 0, book: 0, album: 0 };
    const statusCounts = { backlog: 0, 'in-progress': 0, played: 0 };
    const genreCounts = {};
    let totalRatings = 0;
    let ratingSum = 0;
    let entriesAddedLast30d = 0;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    for (const g of games) {
      const mt = g.mediaType || 'game';
      if (mt in mediaTypeCounts) mediaTypeCounts[mt]++;
      if (mt in globalMediaTypeCounts) globalMediaTypeCounts[mt]++;
      // Three-status bucket: backlog / in-progress / played. Unknown values fall through
      // to backlog for backwards compat with libraries created before in-progress existed.
      let bucket = 'backlog';
      if (g.status === 'played') bucket = 'played';
      else if (g.status === 'in-progress') bucket = 'in-progress';
      statusCounts[bucket]++;
      if (g.genre && typeof g.genre === 'string') {
        genreCounts[g.genre] = (genreCounts[g.genre] || 0) + 1;
        globalGenreCounts[g.genre] = (globalGenreCounts[g.genre] || 0) + 1;
      }
      // Aggregate rating stats (just counts and average — no per-title detail)
      if (typeof g.rating === 'number' && g.rating > 0) {
        totalRatings++;
        ratingSum += g.rating;
      }
      // Recent activity: if addedAt is within last 30 days
      if (typeof g.addedAt === 'number' && g.addedAt > thirtyDaysAgo) {
        entriesAddedLast30d++;
      }
    }

    // Top 3 genres for this user
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    totalEntries += games.length;
    if (games.length > 0) totalActiveUsers++;

    users.push({
      code,
      displayName: rec.displayName || '(unclaimed)',
      isAdmin: !!rec.isAdmin,
      status: rec.status || 'unknown',
      claimedAt: rec.claimedAt || null,
      lastSeenAt: rec.lastSeenAt || null,
      entryCount: games.length,
      mediaTypeCounts,
      statusCounts,
      topGenres,
      avgRating: totalRatings > 0 ? +(ratingSum / totalRatings).toFixed(1) : null,
      ratedCount: totalRatings,
      entriesAddedLast30d,
      optedOut: false,
    });
  }

  // Sort: admin first, then by entry count desc, then alphabetical
  users.sort((a, b) => {
    if (a.isAdmin && !b.isAdmin) return -1;
    if (b.isAdmin && !a.isAdmin) return 1;
    if (a.optedOut && !b.optedOut) return 1;
    if (b.optedOut && !a.optedOut) return -1;
    const ca = a.entryCount || 0;
    const cb = b.entryCount || 0;
    if (ca !== cb) return cb - ca;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  // Global top genres across all (non-opted-out) users
  const globalTopGenres = Object.entries(globalGenreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return json({
    users,
    summary: {
      totalUsers: users.length,
      activeUsers: totalActiveUsers,
      optedOutCount,
      totalEntries,
      mediaTypeBreakdown: globalMediaTypeCounts,
      topGenres: globalTopGenres,
      generatedAt: Date.now(),
    },
  });
};
