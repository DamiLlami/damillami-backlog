// ═══════════════════════════════════════
// APP VERSION — stamped at deploy time
// ═══════════════════════════════════════
const APP_VERSION = '2026-06-29-D';
console.log('%c📚 Salena Bookshelf ' + APP_VERSION + ' loaded', 'color:#D4967A;font-weight:bold;font-size:13px');

// Flag checked by the update banner — true while a save is actively writing,
// prevents reloading mid-write. Declared at top so every function can reference it safely.
let _saveInProgress = false;

// ═══════════════════════════════════════
// STORAGE KEYS — frozen, never rename
// ═══════════════════════════════════════
const SK_BOOKS        = 'salena_books_v1';
const SK_THEME_VARS   = 'salena_theme_v2';
const SK_SAVED_THEMES = 'salena_saved_themes_v2';
const SK_STYLE        = 'salena_style_v1';
const SK_CUSTOM_AE    = 'salena_custom_aesthetics_v1';
const SK_VIEW         = 'salena_view_v1';
const SK_NAV          = 'salena_nav_v1';
const SK_MANGA_VIEW   = 'salena_manga_view_v1';
const SK_CUSTOM_BOOKENDS = 'salena_custom_bookends_v1';
const SK_SHELF        = 'salena_shelf_v1';
const SK_MANGA        = 'salena_manga_v1';
const SK_AUTOSAVE     = 'salena_autosave_v1';
const SK_SHELF_ORDER  = 'salena_shelf_order_v1';
const SK_BOOK_API     = 'salena_book_api_v1';

// ── ALL_SETTINGS_KEYS: single authoritative list for export/import ────
// Add any new settings storage key here — it is automatically included
// in both exportSettings() and exportFullBackup().
const ALL_SETTINGS_KEYS = [
  SK_THEME_VARS, SK_SAVED_THEMES, SK_STYLE, SK_CUSTOM_AE,
  SK_VIEW, SK_NAV, SK_MANGA_VIEW, SK_SHELF, SK_CUSTOM_BOOKENDS,
];

const IDB_DB_NAME     = 'SalenaFontsDB';
const IDB_STORE       = 'fonts';
const API_URL         = 'https://salena-bookshelf-api.damillami.workers.dev';
const APP_TOKEN       = 'salena2026bookshelf'; // matches APP_TOKEN set in Worker dashboard

// ── Google Books API Key ─────────────────────────────────────────────
// Get a free key at: console.cloud.google.com → Enable Books API → Credentials
// Paste your key between the quotes below, then redeploy.
const GOOGLE_BOOKS_KEY = 'AIzaSyAQIN8bygf9mI4ZYn7RkF6x6nSx7MlENdA';

// Appends API key to any Google Books URL if a key is configured
function getBookApiConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(SK_BOOK_API) || '{}');
    return {
      useGoogle:  stored.useGoogle  !== false, // default on
      useOpenLib: stored.useOpenLib !== false, // default on
      googleKey:  stored.googleKey  || GOOGLE_BOOKS_KEY,
    };
  } catch { return { useGoogle: true, useOpenLib: true, googleKey: GOOGLE_BOOKS_KEY }; }
}
function saveBookApiConfig(cfg) { localStorage.setItem(SK_BOOK_API, JSON.stringify(cfg)); }

function gbUrl(base) {
  const key = (window._runtimeGbKey !== undefined ? window._runtimeGbKey : null)
    || getBookApiConfig().googleKey
    || GOOGLE_BOOKS_KEY;
  return key ? `${base}&key=${key}` : base;
}

const useCloud = () => !!API_URL;

// ═══════════════════════════════════════
// INDEXEDDB — custom font storage
// ═══════════════════════════════════════
let idb = null;

function openIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_DB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: 'name' });
    r.onsuccess = e => { idb = e.target.result; res(idb); };
    r.onerror = rej;
  });
}
function idbPut(rec) {
  return new Promise((res, rej) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(rec).onsuccess = () => res();
    tx.onerror = rej;
  });
}
function idbGetAll() {
  return new Promise((res, rej) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = rej;
  });
}
function idbDelete(name) {
  return new Promise((res, rej) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(name).onsuccess = () => res();
    tx.onerror = rej;
  });
}
function injectFF(f) {
  const id = 'ff-' + f.name.replace(/\s/g, '_');
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = `@font-face{font-family:'${f.name}';src:url('${f.dataUrl}');font-display:swap;}`;
  document.head.appendChild(s);
}

let customFonts = [];

async function loadCustomFonts() {
  try {
    const all = await idbGetAll();
    customFonts = all;
    all.forEach(f => injectFF(f));
  } catch (e) { console.warn('IDB load failed', e); }
}

async function uploadFont(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = async ev => {
      const name = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      const rec = { name, dataUrl: ev.target.result, fileName: file.name };
      injectFF(rec);
      await idbPut(rec);
      if (!customFonts.find(f => f.name === name)) customFonts.push(rec);
      showToast(`"${name}" uploaded!`);
      res(name);
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

async function deleteCustomFont(name) {
  await idbDelete(name);
  customFonts = customFonts.filter(f => f.name !== name);
  const el = document.getElementById('ff-' + name.replace(/\s/g, '_'));
  if (el) el.remove();
  showToast(`"${name}" removed.`);
  renderFonts();
}

// ═══════════════════════════════════════
// GOOGLE BOOKS API
// ═══════════════════════════════════════
let searchDebounce = null;

function debounceSearch(q) {
  clearTimeout(searchDebounce);
  if (q.length < 2) return;
  searchDebounce = setTimeout(() => doSearch(q), 350);
}

// ── PARALLEL MULTI-SOURCE BOOK SEARCH ──────────────────────────────────────
// Fires Google Books + Open Library simultaneously, merges & deduplicates,
// renders as soon as any source resolves (no waiting for the slowest one).

async function doSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  const el = document.getElementById('search-results');
  el.innerHTML = `<div style="text-align:center;padding:28px;color:#8a7060;font-style:italic;font-size:.85rem">✨ Searching…</div>`;

  // Build fetch promises for each source — each resolves to a normalised items[]
  const sources = [
    ...(getBookApiConfig().useGoogle  ? [fetchGoogleBooks(q)]  : []),
    ...(getBookApiConfig().useOpenLib ? [fetchOpenLibrary(q)] : []),
  ];

  // Render the first source that comes back with results (usually ~200–400 ms faster)
  let rendered = false;
  const allItems = [];

  const results = await Promise.allSettled(
    sources.map(p => p.then(items => {
      if (items.length && !rendered) {
        rendered = true;
        renderBookResults(items, el);
      }
      return items;
    }))
  );

  // After all settle, merge everything and re-render with full combined list
  results.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });
  const merged = dedupeBooks(allItems);
  if (merged.length) {
    renderBookResults(merged, el);
  } else if (!rendered) {
    el.innerHTML = `<div style="text-align:center;padding:36px 20px;color:#b0988a;font-family:var(--font-display)">
      <div style="font-size:1.8rem;margin-bottom:8px">📭</div>
      <div>No results found. Try a different title or author.</div>
    </div>`;
  }
}

async function fetchGoogleBooks(q) {
  try {
    const url = gbUrl(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books&orderBy=relevance`);
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data.items) return [];
    return data.items.map(item => {
      const v = item.volumeInfo || {};
      return {
        _id:     item.id,
        _source: 'Google Books',
        _score:  v.averageRating || 0,
        volumeInfo: {
          title:         v.title || '',
          authors:       v.authors || [],
          pageCount:     v.pageCount || 0,
          categories:    v.categories || [],
          imageLinks:    v.imageLinks || {},
          description:   v.description || '',
          publishedDate: v.publishedDate || '',
          averageRating: v.averageRating || 0,
          subtitle:      v.subtitle || '',
          publisher:     v.publisher || '',
          industryIdentifiers: v.industryIdentifiers || [],
          // Pass through structured series data — key for series detection
          seriesInfo:    item.seriesInfo || v.seriesInfo || null,
        }
      };
    });
  } catch { return []; }
}

async function fetchOpenLibrary(q) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=key,title,author_name,cover_i,first_publish_year,number_of_pages_median,subject,series,ratings_average`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data.docs) return [];
    return data.docs.map(doc => {
      const coverId = doc.cover_i;
      const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '';
      return {
        _id:     doc.key,
        _source: 'Open Library',
        _score:  doc.ratings_average || 0,
        volumeInfo: {
          title:         doc.title || '',
          authors:       doc.author_name || [],
          pageCount:     doc.number_of_pages_median || 0,
          categories:    doc.subject ? doc.subject.slice(0, 3) : [],
          imageLinks:    coverId ? { thumbnail: coverUrl } : {},
          description:   '',
          publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : '',
          averageRating: doc.ratings_average || 0,
          subtitle:      '',
          publisher:     '',
          _series:       (doc.series && doc.series[0]) || null,
          industryIdentifiers: [],
        }
      };
    });
  } catch { return []; }
}

function dedupeBooks(items) {
  // Prefer the entry with a cover + higher score when titles match
  const seen = new Map();
  items.forEach(item => {
    const key = (item.volumeInfo.title || '').toLowerCase().trim().slice(0, 40);
    const existing = seen.get(key);
    if (!existing) { seen.set(key, item); return; }
    const hasCover  = !!(item.volumeInfo.imageLinks?.thumbnail);
    const hadCover  = !!(existing.volumeInfo.imageLinks?.thumbnail);
    const betterScore = (item._score || 0) > (existing._score || 0);
    if ((hasCover && !hadCover) || betterScore) seen.set(key, item);
  });
  return Array.from(seen.values());
}

// Search result cache — avoids embedding JSON in onclick attributes
// which breaks on apostrophes, quotes, and special characters in metadata
let _searchResultCache = [];

function renderBookResults(items, el) {
  if (!items.length) return;
  _searchResultCache = items; // store by reference, access by index
  el.innerHTML = items.map((item, idx) => {
    const v = item.volumeInfo || {};
    const cover = bestCover(v);
    const series = v._series || detectSeries(v);
    const avgRating = v.averageRating ? `⭐ ${parseFloat(v.averageRating).toFixed(1)}` : '';
    const pages = v.pageCount ? `${v.pageCount} pp` : '';
    const yr = v.publishedDate ? v.publishedDate.slice(0,4) : '';
    const src = item._source || '';
    const coverEl = cover
      ? `<img class="src-cover" src="${cover}" alt="" onerror="this.outerHTML='<div class=src-cover-ph>${esc((v.title||'').slice(0,22))}</div>'"/>`
      : `<div class="src-cover-ph">${esc((v.title||'').slice(0,22))}</div>`;
    // Use index — safe regardless of any characters in the metadata
    return `<div class="search-result-card" onclick="selectResult(${idx})">
      ${coverEl}
      <div class="src-info">
        <div class="src-title">${esc(v.title||'Unknown title')}</div>
        <div class="src-author">${esc((v.authors||['Unknown author']).join(', '))}${yr ? ` · ${yr}` : ''}</div>
        <div class="src-meta">
          ${series ? `<span class="src-badge src-series-badge">📖 ${esc(series)}</span>` : ''}
          ${pages ? `<span class="src-badge src-pages-badge">${pages}</span>` : ''}
          ${avgRating ? `<span class="src-badge src-rating-badge">${avgRating}</span>` : ''}
          ${(v.categories||[]).slice(0,1).map(c=>`<span class="src-badge src-pages-badge">${esc(c)}</span>`).join('')}
          <span class="src-badge" style="background:var(--cream);color:#aaa;border:1px solid var(--border)">${esc(src)}</span>
        </div>
        ${v.description ? `<div class="src-desc">${esc(stripHtml(v.description))}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function bestCover(v) {
  const imgs = v.imageLinks || {};
  const raw = imgs.extraLarge || imgs.large || imgs.medium || imgs.thumbnail || imgs.smallThumbnail || '';
  if (!raw) return '';
  // Clean Google Books URLs + upgrade Open Library thumbnails from -M to -L size
  return raw.replace('&edge=curl', '').replace('http:', 'https:').replace('-M.jpg', '-L.jpg');
}

// ── SERIES DETECTION — multi-strategy ──────────────────────────────
// Strategy 1: Google Books seriesInfo structured field (most reliable)
// Strategy 2: Title/subtitle parenthetical pattern matching
// Strategy 3: Subtitle keyword detection
// Strategy 4: Open Library subject tags (used in OL results)
function detectSeries(v) {
  // S1: Google Books seriesInfo — structured, authoritative
  if (v.seriesInfo && v.seriesInfo.bookSeries && v.seriesInfo.bookSeries.length) {
    return v.seriesInfo.bookSeries[0].series?.title || null;
  }

  const title    = v.title || '';
  const subtitle = v.subtitle || '';
  const combined = (title + ' ' + subtitle).trim();

  // S2: Parenthetical patterns — "(Series Name, #N)" "(Series Name Book N)" "(Series Name #N)"
  const paren = combined.match(/\(([^,)]+)[,\s]+#?\d+\)/)
    || combined.match(/\(([^)]+)\s+[Bb]ook\s+\d+\)/)
    || combined.match(/\(([^)]+)\s+#\d+\)/)
    || combined.match(/\(([^)]+),\s*[Vv]ol\.?\s*\d+\)/);
  if (paren) return paren[1].trim();

  // S3: Subtitle keyword hints  — "Book 2 of the X Series"
  const seriesOf = subtitle.match(/[Bb]ook\s+\d+\s+(?:of|in)\s+(?:the\s+)?(.+?)(?:\s+[Ss]eries)?$/);
  if (seriesOf) return seriesOf[1].trim();

  // S4: "A [Series Name] Novel/Story"
  const aNovel = subtitle.match(/^[Aa]n?\s+(.+?)\s+[Nn]ovel/);
  if (aNovel) return aNovel[1].trim();

  // S5: subtitle alone signals series position
  if (subtitle && subtitle.match(/book\s+\d+|#\d+|vol\.?\s*\d+/i)) return title;

  // S6: Open Library _series field (pre-populated in OL results)
  if (v._series) return v._series;

  return null;
}

function detectSeriesNum(v) {
  // S1: Google Books seriesInfo
  if (v.seriesInfo && v.seriesInfo.bookDisplayNumber) {
    return parseInt(v.seriesInfo.bookDisplayNumber) || null;
  }

  const combined = (v.title || '') + ' ' + (v.subtitle || '');

  const m = combined.match(/#(\d+)\)/)
    || combined.match(/[Bb]ook\s+(\d+)\)?/)
    || combined.match(/,\s*(\d+)\)/)
    || combined.match(/[Vv]ol\.?\s*(\d+)/);
  if (m) return parseInt(m[1]);
  return null;
}

function stripHtml(s) { return (s || '').replace(/<[^>]+>/g, ''); }
function esc(s) { return (s || '').toString().replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function selectResult(idxOrJson) {
  // Accept either an index (new) or a JSON string (legacy fallback)
  let item;
  if (typeof idxOrJson === 'number') {
    item = _searchResultCache[idxOrJson];
  } else {
    try { item = JSON.parse(idxOrJson); } catch { return; }
  }
  if (!item) return;
  closeModal('search-modal');
  openAddModal(item, null);
}

// ═══════════════════════════════════════
// ADD / EDIT BOOK MODAL
// ═══════════════════════════════════════
let editingId = null;
let addRating = 0;
let addRatingScale = 5;
let pendingItem = null;

function openBookSearch() {
  const inp = document.getElementById('book-search-input');
  // Pull whatever is in the library filter bar and carry it into the search modal
  const libEl = document.getElementById('lib-search');
  const libQuery = (libEl.value || '').trim();
  // Pre-fill the search input with the library bar value
  inp.value = libQuery;
  // Clear the library filter so the grid doesn't show empty state behind the modal
  libEl.value = '';
  renderLibrary();
  const hasQuery = libQuery.length > 0;
  if (!hasQuery) {
    document.getElementById('search-results').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#b0988a;font-family:var(--font-display)">
        <div style="font-size:2rem;margin-bottom:8px">🔍</div>
        <div style="font-size:.88rem">Type to search your next read</div>
      </div>`;
  }
  document.getElementById('search-modal').classList.add('open');
  if (hasQuery) {
    // Fire the search immediately — no second click needed
    setTimeout(() => doSearch(libQuery), 80);
  } else {
    setTimeout(() => inp.focus(), 120);
  }
}

document.getElementById('book-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch(e.target.value);
});

function openAddModal(googleItem, editBook) {
  editingId = editBook ? editBook.id : null;
  addRating = editBook ? (editBook.rating || 0) : 0;
  addRatingScale = editBook ? (editBook.ratingScale || 5) : 5;
  pendingItem = googleItem || null;

  const v = googleItem ? (googleItem.volumeInfo || {}) : {};
  const b = editBook || {};

  const title     = b.title     || v.title || '';
  const author    = b.author    || (v.authors ? v.authors.join(', ') : '');
  const cover     = b.coverUrl  || bestCover(v) || '';
  const pages     = b.pageCount || v.pageCount || '';
  const genre     = b.genre     || (v.categories ? v.categories[0] : '');
  const series    = b.series    || detectSeries(v) || '';
  const seriesNum = b.seriesNum || detectSeriesNum(v) || '';
  const status    = b.status    || 'tbr';
  const notes     = b.notes     || '';
  const isbn      = b.isbn      || (v.industryIdentifiers ? (v.industryIdentifiers.find(x => x.type === 'ISBN_13') || {}).identifier || '' : '');
  const dateF     = b.dateFinished ? b.dateFinished.split('T')[0] : '';
  const dateS     = b.dateStarted  ? b.dateStarted.split('T')[0]  : '';

  document.getElementById('add-modal-title').textContent = editingId ? 'Edit Book' : 'Add Book';

  const seriesNotice = (series && !editingId)
    ? `<div class="series-notice">📖 <strong>${esc(series)}</strong> series detected — after saving, we'll add the other books in this series to your shelf, greyed out until you claim them.</div>`
    : '';

  document.getElementById('add-modal-body').innerHTML = `
    ${seriesNotice}
    ${cover ? `<div style="text-align:center;margin-bottom:14px"><img src="${esc(cover)}" style="height:120px;border-radius:10px;box-shadow:0 4px 16px var(--shadow)" onerror="this.style.display='none'"/></div>` : ''}
    <div class="form-group"><label>Title *</label><input type="text" id="f-title" value="${esc(title)}" placeholder="Book title"/></div>
    <div class="form-group"><label>Author</label><input type="text" id="f-author" value="${esc(author)}" placeholder="Author name"/></div>
    <div class="form-group"><label>Series</label><input type="text" id="f-series" value="${esc(series)}" placeholder="Series name (if any)"/></div>
    <div class="form-group"><label>Book # in Series</label><input type="number" id="f-series-num" value="${seriesNum}" placeholder="e.g. 1" min="1"/></div>
    <div class="form-group"><label>Genre</label>
      <select id="f-genre">
        <option value="">— Select genre —</option>
        ${['Fantasy','Romance','Mystery','Thriller','Sci-Fi','Historical Fiction','Literary Fiction','Non-Fiction','Self-Help','Biography','Horror','Young Adult','Other']
          .map(g => `<option ${genre === g ? 'selected' : ''}>${g}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Page Count</label><input type="number" id="f-pages" value="${pages}" placeholder="e.g. 342" min="1"/></div>
    <div class="form-group"><label>Status</label>
      <select id="f-status">
        <option value="tbr" ${status==='tbr'?'selected':''}>📚 To Be Read</option>
        <option value="reading" ${status==='reading'?'selected':''}>📖 Currently Reading</option>
        <option value="read" ${status==='read'?'selected':''}>✅ Read</option>
        <option value="dnf" ${status==='dnf'?'selected':''}>❌ Did Not Finish</option>
        <option value="wishlist" ${status==='wishlist'?'selected':''}>🎁 Wishlist</option>
      </select>
    </div>
    <div class="form-group"><label>Date Started (optional)</label><input type="date" id="f-date-started" value="${dateS}"/></div>
    <div class="form-group"><label>Date Finished (optional)</label><input type="date" id="f-date-finished" value="${dateF}"/></div>
    <div class="form-group">
      <label>Rating</label>
      <div class="rating-scale-toggle">
        <button class="scale-opt ${addRatingScale===5?'active':''}" onclick="setRatingScale(5)">★ 1–5 Stars</button>
        <button class="scale-opt ${addRatingScale===10?'active':''}" onclick="setRatingScale(10)">🔢 1–10 Scale</button>
      </div>
      <div id="rating-picker-ui"></div>
    </div>
    <div class="form-group"><label>Review &amp; Notes</label><textarea id="f-notes" placeholder="Your thoughts — what you loved, what stood out, favourite quotes…">${esc(notes)}</textarea></div>
    <div class="form-group"><label>Cover Image URL</label><input type="text" id="f-cover" value="${esc(cover)}" placeholder="Auto-filled from search"/></div>
    <div class="form-group"><label>ISBN</label><input type="text" id="f-isbn" value="${esc(isbn)}" placeholder="Optional"/></div>
    <div class="row-btns" style="margin-top:6px">
      <button class="btn btn-primary" onclick="saveBook()">💾 Save Book</button>
      <button class="btn btn-ghost" onclick="closeModal('add-modal')">Cancel</button>
    </div>`;

  renderRatingPicker();
  document.getElementById('add-modal').classList.add('open');
}

function setRatingScale(n) {
  addRatingScale = n;
  document.querySelectorAll('.scale-opt').forEach(b => {
    b.classList.toggle('active', b.textContent.includes(n === 5 ? '5' : '10'));
  });
  if (addRating > 5 && n === 5) addRating = 5;
  renderRatingPicker();
}

function renderRatingPicker() {
  const el = document.getElementById('rating-picker-ui');
  if (!el) return;
  if (addRatingScale === 5) {
    el.innerHTML = `<div style="display:flex;gap:6px">${[1,2,3,4,5].map(i =>
      `<span class="star-pick ${addRating >= i ? 'lit' : ''}" onclick="setAddRating(${i})">★</span>`
    ).join('')}</div>`;
  } else {
    el.innerHTML = `<div class="ten-scale">${Array.from({length:10},(_,i)=>i+1).map(i =>
      `<button class="ten-btn ${addRating===i?'active':''}" onclick="setAddRating(${i})">${i}</button>`
    ).join('')}</div>`;
  }
}

function setAddRating(v) { addRating = v; renderRatingPicker(); }

async function saveBook() {
  const title = (document.getElementById('f-title').value || '').trim();
  if (!title) { showToast('Please enter a title.'); return; }

  const status    = document.getElementById('f-status').value;
  const existing  = editingId ? books.find(b => b.id === editingId) : null;
  const dateF     = document.getElementById('f-date-finished').value;
  const dateS     = document.getElementById('f-date-started').value;
  const series    = document.getElementById('f-series').value.trim();
  const seriesNum = parseInt(document.getElementById('f-series-num').value) || null;

  const bd = {
    id:           editingId || genId(),
    title,
    author:       document.getElementById('f-author').value.trim(),
    genre:        document.getElementById('f-genre').value,
    series,
    seriesNum,
    pageCount:    parseInt(document.getElementById('f-pages').value) || 0,
    status,
    coverUrl:     document.getElementById('f-cover').value.trim(),
    isbn:         document.getElementById('f-isbn').value.trim(),
    notes:        document.getElementById('f-notes').value.trim(),
    currentPage:  existing ? existing.currentPage || 0 : 0,
    rating:       addRating,
    ratingScale:  addRatingScale,
    dateAdded:    existing ? existing.dateAdded : new Date().toISOString(),
    dateStarted:  dateS ? new Date(dateS).toISOString() : (existing ? existing.dateStarted : null),
    dateFinished: dateF
      ? new Date(dateF).toISOString()
      : (status === 'read' && !(existing && existing.dateFinished) ? new Date().toISOString() : (existing ? existing.dateFinished : null)),
    googleId:     pendingItem ? pendingItem.id : (existing ? existing.googleId : null),
    isGhost:      false,
  };

  console.log('[saveBook] useCloud()=', useCloud(), 'API_URL=', API_URL, 'editingId=', editingId);

  if (editingId) {
    const idx = books.findIndex(b => b.id === editingId);
    if (idx > -1) books[idx] = bd;
    // Always save to localStorage first
    saveLocal();
    if (useCloud()) {
      try { await apiFetch(`/api/books/${bd.id}`, { method: 'PUT', body: JSON.stringify(bd) }); }
      catch(e) { console.error('[saveBook] cloud PUT failed:', e); showToast('⚠️ Saved locally — cloud sync failed.'); }
    }
  } else {
    books.unshift(bd);
    // Always save to localStorage first — data is never lost even if cloud fails
    saveLocal();
    if (useCloud()) {
      try { await apiFetch('/api/books', { method: 'POST', body: JSON.stringify(bd) }); }
      catch(e) { console.error('[saveBook] cloud POST failed:', e); showToast('⚠️ Saved locally — cloud sync failed. Will retry next time.'); }
    }
  }

  // Clear filter bar and close modal immediately so she can see the book appear
  const libEl = document.getElementById('lib-search');
  if (libEl) libEl.value = '';
  closeModal('add-modal');
  renderLibrary();
  showToast(editingId ? 'Book updated!' : `"${title}" added to your shelf!`);

  // Capture state before clearing — enrichment needs these references
  const itemForEnrichment   = pendingItem;
  const seriesForEnrichment = series || null;
  const isNewBook           = !editingId;
  editingId = null;
  pendingItem = null;
  addRating = 0;

  // Series enrichment is now manual only — use 🔍 Find Series on the book detail modal.
  // This keeps saves fast and gives full control over which books get series companions.
}

// ═══════════════════════════════════════
// SERIES ENRICHMENT — multi-source
// ═══════════════════════════════════════
// Master coordinator — runs all strategies in sequence
async function enrichSeriesData(savedBook, knownSeriesName, googleItem) {
  let seriesName = knownSeriesName || null;
  const log = [];

  showToast('🔍 Searching for series information…');

  // ── S1: seriesInfo on the normalized volumeInfo ─────────────────────
  if (!seriesName && googleItem) {
    const vi = googleItem.volumeInfo || {};
    const si = vi.seriesInfo || googleItem.seriesInfo || null;
    if (si && si.bookSeries && si.bookSeries[0]) {
      seriesName = (si.bookSeries[0].series && si.bookSeries[0].series.title) || null;
    }
    log.push(`S1 seriesInfo → ${seriesName || 'null'}`);
  }

  // ── S2: title/subtitle pattern detection ────────────────────────────
  if (!seriesName && googleItem && googleItem.volumeInfo) {
    seriesName = detectSeries(googleItem.volumeInfo) || null;
    log.push(`S2 detectSeries → ${seriesName || 'null'}`);
  }

  // ── S3: Open Library search → then fetch Work JSON for series ───────
  if (!seriesName && getBookApiConfig().useOpenLib !== false) {
    showToast('🔍 Checking Open Library…', 4000);
    try {
      const q   = encodeURIComponent(savedBook.title + ' ' + savedBook.author);
      const url = `https://openlibrary.org/search.json?q=${q}&limit=3&fields=title,series,subject,author_name,key`;
      const r   = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        const docs = d.docs || [];
        log.push(`S3 OL search docs: ${docs.length}`);
        for (const doc of docs) {
          // Check search-level series first (sometimes present)
          if (doc.series && doc.series.length) {
            seriesName = doc.series[0];
            log.push(`S3 search-level series hit: ${seriesName}`);
            break;
          }
          // Fetch the Work object — series is reliably stored here
          if (doc.key) {
            try {
              const wr = await fetch(`https://openlibrary.org${doc.key}.json`);
              if (wr.ok) {
                const w = await wr.json();
                log.push(`S3 Work keys: ${Object.keys(w).join(', ')}`);
                if (w.series && w.series.length) {
                  seriesName = w.series[0];
                  log.push(`S3 Work.series hit: ${seriesName}`);
                  break;
                }
                // Check subjects for "X Series" pattern
                const sub = (w.subjects || []).find(s => /series/i.test(s));
                if (sub) {
                  seriesName = sub.replace(/series/i, '').replace(/[\s,]+$/, '').trim();
                  log.push(`S3 Work subject hit: ${seriesName}`);
                  break;
                }
              }
            } catch(we) { log.push(`S3 Work fetch error: ${we.message}`); }
          }
        }
      } else { log.push(`S3 OL HTTP ${r.status}`); }
    } catch(e) { log.push(`S3 OL error: ${e.message}`); }
    log.push(`S3 result → ${seriesName || 'null'}`);
  }

  // ── S4: Google Books ISBN lookup — bypasses rate limits on search ────
  // ISBN is stored on the book when added from Google Books
  if (!seriesName) {
    showToast('🔍 Checking Google Books by ISBN…', 4000);
    await new Promise(res => setTimeout(res, 800)); // brief pause after S3
    // Pull ISBN from saved book record OR from the raw google item volumeInfo
    const identifiers = (googleItem && googleItem.volumeInfo && googleItem.volumeInfo.industryIdentifiers) || [];
    const isbn = savedBook.isbn
      || identifiers.find(x => x.type === 'ISBN_13')?.identifier
      || identifiers.find(x => x.type === 'ISBN_10')?.identifier
      || null;
    if (isbn) {
      try {
        const url = gbUrl(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1&langRestrict=en`);
        const r   = await fetch(url);
        log.push(`S4 ISBN lookup HTTP ${r.status}`);
        if (r.ok) {
          const d = await r.json();
          const item = (d.items || [])[0];
          if (item) {
            const v  = item.volumeInfo || {};
            const si = item.seriesInfo || v.seriesInfo || null;
            if (si && si.bookSeries && si.bookSeries[0]) {
              seriesName = (si.bookSeries[0].series && si.bookSeries[0].series.title) || null;
              log.push(`S4 ISBN seriesInfo hit: ${seriesName}`);
            }
            if (!seriesName) {
              seriesName = detectSeries(v) || null;
              log.push(`S4 ISBN detectSeries: ${seriesName}`);
            }
          }
        }
      } catch(e) { log.push(`S4 ISBN error: ${e.message}`); }
    } else { log.push('S4 skipped — no ISBN stored'); }
    log.push(`S4 result → ${seriesName || 'null'}`);
  }

  // ── S5: Google Books inauthor search with rate-limit delay ──────────
  if (!seriesName) {
    showToast('🔍 Searching Google Books by author…', 4000);
    await new Promise(res => setTimeout(res, 1200));
    try {
      const lastName = (savedBook.author || '').split(' ').pop();
      const q   = encodeURIComponent(`inauthor:"${lastName}""`);
      const url = gbUrl(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=15&printType=books&orderBy=relevance&langRestrict=en`);
      const r   = await fetch(url);
      log.push(`S5 GB inauthor HTTP ${r.status}`);
      if (r.ok) {
        const d = await r.json();
        const items = d.items || [];
        log.push(`S5 GB items: ${items.length}`);
        for (const item of items) {
          const v  = item.volumeInfo || {};
          const si = item.seriesInfo || v.seriesInfo || null;
          if (si && si.bookSeries && si.bookSeries[0]) {
            const name = (si.bookSeries[0].series && si.bookSeries[0].series.title) || null;
            if (name) { seriesName = name; log.push(`S5 seriesInfo hit: ${name} on "${v.title}"`); break; }
          }
          const det = detectSeries(v);
          if (det) { seriesName = det; log.push(`S5 detectSeries hit: ${det} on "${v.title}"`); break; }
        }
      }
    } catch(e) { log.push(`S5 GB error: ${e.message}`); }
    log.push(`S5 result → ${seriesName || 'null'}`);
  }

  // ── S6: Open Library editions for the work — last resort ────────────
  if (!seriesName && getBookApiConfig().useOpenLib !== false) {
    showToast('🔍 Checking Open Library editions…', 4000);
    try {
      const q   = encodeURIComponent(savedBook.title);
      const url = `https://openlibrary.org/search.json?q=${q}&author=${encodeURIComponent((savedBook.author||'').split(' ').pop())}&limit=1&fields=key,series,title`;
      const r   = await fetch(url);
      if (r.ok) {
        const d    = await r.json();
        const doc  = (d.docs || [])[0];
        log.push(`S6 OL title-author doc: ${JSON.stringify(doc?.series)}`);
        if (doc && doc.key) {
          const er = await fetch(`https://openlibrary.org${doc.key}/editions.json?limit=5`);
          if (er.ok) {
            const ed  = await er.json();
            const entries = ed.entries || ed.docs || [];
            log.push(`S6 editions: ${entries.length}`);
            for (const e of entries) {
              if (e.series && e.series.length) {
                seriesName = e.series[0];
                log.push(`S6 edition series hit: ${seriesName}`);
                break;
              }
            }
          }
        }
      }
    } catch(e) { log.push(`S6 OL editions error: ${e.message}`); }
    log.push(`S6 result → ${seriesName || 'null'}`);
  }

  // ── S7 (via Worker): Hardcover GraphQL proxy ──────────────────────
  // Hardcover has purpose-built series data. Direct browser calls are CORS-blocked,
  // but the Worker proxy at /api/series forwards requests server-side.
  if (!seriesName && useCloud()) {
    showToast('🔍 Checking Hardcover series database…', 4000);
    try {
      const safeTitle = (savedBook.title || '').replace(/"/g, '');
      const query = {
        query: `{ books(where: {title: {_ilike: "${safeTitle}"}}, limit: 5) {
          title
          book_series { series { name } position }
          contributions { author { name } }
        }}`
      };
      const r = await apiFetch('/api/series', { method: 'POST', body: JSON.stringify(query) });
      const rows = (r && r.data && r.data.books) || [];
      const lastName = (savedBook.author || '').split(' ').pop().toLowerCase();
      for (const bk of rows) {
        const authOk = !lastName || (bk.contributions || []).some(c =>
          ((c.author && c.author.name) || '').toLowerCase().includes(lastName));
        const bs = bk.book_series && bk.book_series[0];
        if (bs && bs.series && bs.series.name && authOk) {
          seriesName = bs.series.name;
          log.push(`S7 Hardcover hit: ${seriesName}`);
          break;
        }
      }
    } catch(e) { log.push(`S7 Hardcover error: ${e.message}`); }
    log.push(`S7 result → ${seriesName || 'null'}`);
  }

  // ── Final diagnostic log ─────────────────────────────────────────────
  console.group(`%c[Series Enrichment] "${savedBook.title}"`, 'color:#9B7E9E;font-weight:bold;font-size:13px');
  log.forEach(l => console.log(l));
  console.log('%cFINAL series name:', 'font-weight:bold', seriesName);
  console.groupEnd();

  // Sanity-check the detected series name
  if (seriesName) {
    const junk = ['βιβλίο','book','books','novel','novels','fiction','series','manga','comic',
                  'volume','volumes','edition','anthology','collection','classics'];
    const sLower = seriesName.toLowerCase().trim();
    if (sLower.length < 4 || junk.includes(sLower) || /^[^a-zA-Z]*$/.test(seriesName)) {
      console.log('[Series] Rejected junk series name:', seriesName);
      seriesName = null;
    }
  }

  if (!seriesName) {
    console.log('[Series] All strategies exhausted — no series found for:', savedBook.title);
    showToast(`No series found automatically — open the book and tap 📖 Set Series to enter it manually.`, 6000);
    return;
  }

  showToast(`📚 "${seriesName}" found! Counting volumes…`, 5000);

  // ── S7: Google Books series volume count ─────────────────────────────
  // Query Google Books for all volumes in the series and note the highest
  // book number found — use this to generate stubs for any gaps
  let knownSeriesCount = 0;
  try {
    const q   = encodeURIComponent(`"${seriesName}" inauthor:"${(savedBook.author||'').split(' ').pop()}"`);
    const url = gbUrl(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=40&printType=books&langRestrict=en`);
    const r   = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      for (const item of (d.items || [])) {
        const si = item.seriesInfo || (item.volumeInfo || {}).seriesInfo;
        if (si && si.bookDisplayNumber) {
          const n = parseInt(si.bookDisplayNumber);
          if (n > knownSeriesCount) knownSeriesCount = n;
        }
        // Also check title/subtitle for book numbers
        const num = detectSeriesNum(item.volumeInfo || {});
        if (num && num > knownSeriesCount) knownSeriesCount = num;
      }
      log.push(`S7 Google Books series count: ${knownSeriesCount}`);
    }
  } catch(e) { log.push(`S7 count error: ${e.message}`); }

  showToast(`📚 "${seriesName}"${knownSeriesCount > 1 ? ` (${knownSeriesCount} books)` : ''} — fetching companions…`, 6000);

  // Backfill series onto the saved book
  if (!savedBook.series) {
    const idx = books.findIndex(b => b.id === savedBook.id);
    if (idx > -1) { books[idx].series = seriesName; savedBook.series = seriesName; saveLocal(); renderLibrary(); }
  }

  // ── Companion fetch — parallel ───────────────────────────────────────
  const companionFetches = [fetchCompanionsFromGoogle(seriesName, savedBook)];
  if (getBookApiConfig().useOpenLib !== false) {
    companionFetches.push(fetchCompanionsFromOpenLibrary(seriesName, savedBook));
  }
  const companionResults = await Promise.allSettled(companionFetches);

  const allGhosts = [];
  companionResults.forEach(r => {
    if (r.status === 'fulfilled') allGhosts.push(...r.value);
  });
  // Dedupe by title
  const seenT   = new Set();
  const seenNum = new Set();
  // Track series numbers already owned
  books.filter(b => b.series === seriesName && !b.isGhost).forEach(b => {
    if (b.seriesNum) seenNum.add(b.seriesNum);
  });
  const ghosts = allGhosts.filter(g => {
    const k = g.title.toLowerCase().trim();
    if (seenT.has(k)) return false;
    seenT.add(k);
    if (g.seriesNum) seenNum.add(g.seriesNum);
    return true;
  });

  // ── Targeted lookup: for any known book numbers still missing, search specifically ──
  // "Dungeon Crawler Carl book 3 inauthor:Dinniman" → real title, real cover
  if (knownSeriesCount > 1) {
    const lastName = (savedBook.author || '').split(' ').pop();
    for (let n = 1; n <= knownSeriesCount; n++) {
      const alreadyOwned = books.find(b => b.series === seriesName && b.seriesNum === n && !b.isGhost);
      const alreadyFound = seenNum.has(n);
      if (!alreadyOwned && !alreadyFound) {
        try {
          const q   = encodeURIComponent(`"${seriesName}" book ${n} inauthor:"${lastName}"`);
          const url = gbUrl(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&printType=books&langRestrict=en`);
          const r   = await fetch(url);
          if (r.ok) {
            const d = await r.json();
            for (const item of (d.items || [])) {
              const v       = item.volumeInfo || {};
              const t       = (v.title || '').trim();
              const itemNum = detectSeriesNum(Object.assign({}, v, { seriesInfo: item.seriesInfo || null }));
              // Verify author matches
              const authorParts = (savedBook.author || '').toLowerCase().split(/\s+/).filter(p => p.length > 2);
              const authorOk    = authorParts.length === 0
                || (v.authors || []).some(a => authorParts.some(p => a.toLowerCase().includes(p)));
              if (!authorOk) continue;
              // Only accept if it's a real distinct title (not same as what we have)
              const titleKey = t.toLowerCase();
              if (t && !seenT.has(titleKey)) {
                const ghost = _buildGhost(t, v, item.id, seriesName, savedBook);
                ghost.seriesNum = itemNum || n; // use detected num or requested num
                ghosts.push(ghost);
                seenT.add(titleKey);
                seenNum.add(n);
                break; // found one for this number — move on
              }
            }
          }
          // Brief rate-limit pause between targeted lookups
          await new Promise(res => setTimeout(res, 300));
        } catch(e) { /* skip missing books silently */ }
      }
    }
  }

  ghosts.sort((a, b) => (a.seriesNum || 99) - (b.seriesNum || 99));
  console.log('[Series] Final companions:', ghosts.map(g => g.title + ' #' + g.seriesNum));

  if (ghosts.length) {
    openSeriesReviewModal(seriesName, ghosts, savedBook);
  } else {
    showToast(`Series "${seriesName}" found but no companion books located.`);
  }
}

// ── Series Companion Review Modal ─────────────────────────────────────
// Called after enrichment — shows all found companions with cover + metadata
// User picks which to keep before anything is saved
// Store candidates in a module-level variable so srConfirm can read them
// safely without embedding JSON in an onclick attribute (breaks on apostrophes/quotes)
let _srCandidates = [];

function openSeriesReviewModal(seriesName, candidates, sourceBook) {
  _srCandidates = candidates; // store for srConfirm to read directly
  document.getElementById('series-review-title').textContent = `📖 "${seriesName}" — Review Companions`;

  const rows = candidates.map((g, i) => {
    const cover = g.coverUrl
      ? `<img src="${esc(g.coverUrl)}"
           style="width:56px;height:80px;object-fit:cover;border-radius:7px;flex-shrink:0;
                  box-shadow:2px 3px 8px var(--shadow);display:block;"
           onerror="this.style.display='none'"/>`
      : `<div style="width:56px;height:80px;border-radius:7px;flex-shrink:0;
                    background:linear-gradient(135deg,var(--blush-light),var(--mauve-light));
                    display:flex;align-items:center;justify-content:center;
                    font-size:.58rem;text-align:center;padding:4px;
                    font-family:var(--font-display);color:var(--ink);line-height:1.2;">
           ${esc(g.title.slice(0,24))}
         </div>`;

    return `<div class="series-review-row" id="srr-${i}"
      style="display:flex;align-items:center;gap:13px;padding:11px 14px;
             border-radius:11px;border:1.5px solid var(--border);
             background:var(--card-bg);cursor:pointer;transition:all .18s;"
      onclick="srToggleRow(${i})">
      <input type="checkbox" class="series-review-cb" id="srcb-${i}" data-idx="${i}" checked
        onclick="event.stopPropagation()"
        onchange="srRowChange(${i},this.checked)"
        style="width:20px;height:20px;flex-shrink:0;cursor:pointer;accent-color:var(--btn-primary-bg);"/>
      ${cover}
      <div style="flex:1;min-width:0;">
        <div style="font-family:var(--font-display);font-size:.92rem;font-weight:600;
                    line-height:1.3;margin-bottom:5px;color:var(--ink);">
          ${esc(g.title)}
        </div>
        <div style="font-size:.76rem;color:#8a7060;font-style:italic;margin-bottom:5px;">
          ${esc(g.author || '')}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
          ${g.seriesNum ? `<span class="src-badge src-series-badge">Book #${g.seriesNum}</span>` : ''}
          ${g.pageCount ? `<span class="src-badge src-pages-badge">${g.pageCount} pp</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('series-review-body').innerHTML = `
    <p style="font-size:.82rem;color:#8a7060;line-height:1.6;margin-bottom:14px;">
      Found <strong>${candidates.length} book${candidates.length>1?'s':''}</strong> in the
      <strong style="font-family:var(--font-display)">${esc(seriesName)}</strong> series.
      Uncheck anything that doesn't belong, then tap <strong>Add Selected</strong>.
      Added books will appear greyed out on your shelf until you mark them as owned.
    </p>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:.74rem;color:#8a7060;font-weight:700;">
        <span id="sr-sel-count">${candidates.length}</span> of ${candidates.length} selected
      </span>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-xs" onclick="srToggleAll(true)">Select All</button>
        <button class="btn btn-ghost btn-xs" onclick="srToggleAll(false)">Deselect All</button>
      </div>
    </div>
    <div id="series-review-list"
      style="display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;
             margin-bottom:18px;padding-right:2px;">
      ${rows}
    </div>
    <div class="row-btns">
      <button class="btn btn-primary" onclick="srConfirm()">
        ✅ Add Selected
      </button>
      <button class="btn btn-ghost" onclick="closeModal('series-review-modal')">Skip</button>
    </div>`;

  document.getElementById('series-review-modal').classList.add('open');
}

function srRowChange(i, checked) {
  const row = document.getElementById('srr-' + i);
  if (row) {
    row.style.opacity    = checked ? '1'   : '0.35';
    row.style.filter     = checked ? 'none': 'grayscale(0.8)';
    row.style.background = checked ? 'var(--card-bg)' : 'var(--cream)';
  }
  // Update selected count
  const total   = document.querySelectorAll('.series-review-cb').length;
  const selCount = [...document.querySelectorAll('.series-review-cb')].filter(c=>c.checked).length;
  const el = document.getElementById('sr-sel-count');
  if (el) el.textContent = selCount;
}

function srToggleRow(i) {
  const cb = document.getElementById('srcb-' + i);
  if (!cb) return;
  cb.checked = !cb.checked;
  srRowChange(i, cb.checked);
}

function srToggleAll(checked) {
  document.querySelectorAll('.series-review-cb').forEach(cb => {
    cb.checked = checked;
    srRowChange(parseInt(cb.dataset.idx), checked);
  });
}

function srConfirm() {
  const candidates = _srCandidates || [];
  const selected = [];
  document.querySelectorAll('.series-review-cb').forEach(cb => {
    if (cb.checked) selected.push(candidates[parseInt(cb.dataset.idx)]);
  });

  if (!selected.length) {
    closeModal('series-review-modal');
    showToast('No companions added.');
    return;
  }

  selected.forEach(g => books.push(g));
  saveLocal();
  closeModal('series-review-modal');
  renderLibrary();
  showToast(`${selected.length} companion book${selected.length > 1 ? 's' : ''} added to your shelf! 📚`);
}


async function fetchCompanionsFromGoogle(seriesName, sourceBook) {
  const seenTitles = new Set();
  const ghosts = [];
  const authorParts = (sourceBook.author || '').toLowerCase().split(/\s+/).filter(p => p.length > 2);
  const lastName    = authorParts[authorParts.length - 1] || '';
  const prefix      = seriesName.toLowerCase().slice(0, 8);

  // Build multiple query strategies — run ALL of them and merge results
  // Google Books caps at 40 results per call; using different query angles
  // ensures we surface all books in a long series like Dungeon Crawler Carl
  const queries = [
    `"${seriesName}"`,                                          // exact series name
    seriesName,                                                 // unquoted series name
    `inauthor:"${lastName}" "${seriesName}"`,                   // author + series
    `inauthor:"${lastName}" ${seriesName}`,                     // author + unquoted
  ];

  for (const q of queries) {
    try {
      const url = gbUrl(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=40&printType=books&orderBy=relevance&langRestrict=en`);
      const r   = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      if (!d.items) continue;

      for (const item of d.items) {
        const v = item.volumeInfo || {};
        const t = (v.title || '').trim();
        if (!t) continue;

        // Skip already-owned books (exact title match)
        if (books.find(b => b.title.toLowerCase() === t.toLowerCase())) continue;

        // Skip titles we've already queued from earlier queries (dedupe by title)
        const tKey = t.toLowerCase();
        if (seenTitles.has(tKey)) continue;

        // Author must match
        const authorOk = authorParts.length === 0
          || (v.authors || []).some(a => authorParts.some(p => a.toLowerCase().includes(p)));
        if (!authorOk) continue;

        // At least one series signal required: seriesInfo, title contains series name,
        // subtitle contains series name, or result was returned from series search
        const sName    = detectSeries(Object.assign({}, v, { seriesInfo: item.seriesInfo || null }));
        const seriesOk = (sName || '').toLowerCase().includes(prefix)
          || t.toLowerCase().includes(prefix)
          || (v.subtitle || '').toLowerCase().includes(prefix)
          || item.seriesInfo != null;
        if (!seriesOk) continue;

        seenTitles.add(tKey);
        ghosts.push(_buildGhost(t, v, item.id, seriesName, sourceBook));
      }
    } catch(e) { console.warn('[Series] Google companion fetch error on query:', q, e.message); }
  }
  return ghosts;
}

// ── Companion fetch: Open Library ────────────────────────────────────
async function fetchCompanionsFromOpenLibrary(seriesName, sourceBook) {
  const ghosts = [];
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(seriesName)}&limit=20&fields=key,title,author_name,cover_i,number_of_pages_median,series`;
    const r   = await fetch(url);
    if (!r.ok) return ghosts;
    const d = await r.json();
    if (!d.docs) return ghosts;
    const prefix   = seriesName.toLowerCase().slice(0, 6);
    const lastName = (sourceBook.author || '').split(' ').pop().toLowerCase();
    for (const doc of d.docs) {
      const t = (doc.title || '').trim();
      if (!t) continue;
      if (books.find(b => b.title.toLowerCase() === t.toLowerCase())) continue;
      const inSeries  = (doc.series || []).some(s => s.toLowerCase().includes(prefix))
        || t.toLowerCase().includes(prefix);
      // Author match REQUIRED — must be same author, not just any book with series-like name
      const authorParts2 = (sourceBook.author || '').toLowerCase().split(/\s+/).filter(p => p.length > 2);
      const authorOk = authorParts2.length === 0
        || (doc.author_name || []).some(a => authorParts2.some(p => a.toLowerCase().includes(p)));
      if (!authorOk) continue; // reject immediately if author doesn't match
      if (!inSeries) continue; // also require series signal
      const coverId   = doc.cover_i;
      const coverUrl  = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '';
      ghosts.push(_buildGhost(t, {
        authors:    doc.author_name || [],
        pageCount:  doc.number_of_pages_median || 0,
        imageLinks: coverId ? { thumbnail: coverUrl } : {},
      }, doc.key, seriesName, sourceBook));
    }
  } catch(e) { console.warn('[Series] OL companion fetch error:', e.message); }
  return ghosts;
}

// ── Ghost builder ─────────────────────────────────────────────────────
function _buildGhost(title, v, sourceId, seriesName, sourceBook) {
  return {
    id:           genId(),
    title,
    author:       (v.authors || []).join(', ') || sourceBook.author || '',
    genre:        sourceBook.genre || '',
    series:       seriesName,
    seriesNum:    detectSeriesNum(v),
    pageCount:    v.pageCount || 0,
    status:       'tbr',
    coverUrl:     bestCover(v),
    isbn:         '',
    notes:        '',
    currentPage:  0,
    rating:       0,
    ratingScale:  5,
    dateAdded:    new Date().toISOString(),
    dateStarted:  null,
    dateFinished: null,
    googleId:     (typeof sourceId === 'string' && sourceId.startsWith('/')) ? null : sourceId,
    isGhost:      true,
  };
}
// Manual series lookup — callable from detail modal on any existing book
async function manualFindSeries(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  closeModal('detail-modal');

  const syntheticItem = {
    id: b.googleId || null,
    volumeInfo: {
      title:      b.title,
      subtitle:   '',
      authors:    b.author ? [b.author] : [],
      seriesInfo: null,
    }
  };

  await enrichSeriesData(b, b.series || null, syntheticItem);

  // If still no series on the book after enrichment, offer manual entry
  const updated = books.find(x => x.id === id);
  if (!updated || updated.series) return; // enrichment worked — done

  openManualSeriesEntry(id);
}

function openManualSeriesEntry(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;

  // Inject a small inline modal — reuse the detail modal slot
  document.getElementById('detail-content').innerHTML = `
    <div style="padding:22px 20px 26px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-family:var(--font-display);font-size:1.05rem;color:var(--ink)">📖 Set Series Manually</div>
        <button class="modal-close" onclick="closeModal('detail-modal')">✕</button>
      </div>
      <p style="font-size:.8rem;color:#8a7060;line-height:1.6;margin-bottom:16px">
        APIs couldn't find series data for <strong>${esc(b.title)}</strong>.<br>
        Enter the series name and number below — ghost companions will be fetched using it.
      </p>
      <div class="form-group">
        <label>Series Name</label>
        <input type="text" id="ms-series" placeholder="e.g. Threads That Bind"
          value="${esc(b.series || '')}"
          style="width:100%;padding:9px 13px;border:1.5px solid var(--border);border-radius:10px;font-family:var(--font-body);font-size:.88rem;background:var(--card-bg);color:var(--ink);outline:none"/>
      </div>
      <div class="form-group">
        <label>Book # in Series</label>
        <input type="number" id="ms-num" placeholder="e.g. 2" min="1" value="${b.seriesNum || ''}"
          style="width:100%;padding:9px 13px;border:1.5px solid var(--border);border-radius:10px;font-family:var(--font-body);font-size:.88rem;background:var(--card-bg);color:var(--ink);outline:none"/>
      </div>
      <div class="row-btns" style="margin-top:6px">
        <button class="btn btn-primary" onclick="applyManualSeries('${id}')">💾 Save &amp; Find Companions</button>
        <button class="btn btn-ghost" onclick="closeModal('detail-modal')">Cancel</button>
      </div>
    </div>`;

  document.getElementById('detail-modal').classList.add('open');
  setTimeout(() => document.getElementById('ms-series')?.focus(), 100);
}

async function applyManualSeries(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;

  const seriesName = (document.getElementById('ms-series')?.value || '').trim();
  const seriesNum  = parseInt(document.getElementById('ms-num')?.value) || null;

  if (!seriesName) { showToast('Please enter a series name.'); return; }

  // Apply to the book
  b.series    = seriesName;
  b.seriesNum = seriesNum;
  saveLocal();
  closeModal('detail-modal');
  renderLibrary();
  showToast(`📚 Series set — searching for companions…`);

  // Now fetch companions using the user-provided series name
  const [gRes, olRes] = await Promise.allSettled([
    fetchCompanionsFromGoogle(seriesName, b),
    fetchCompanionsFromOpenLibrary(seriesName, b),
  ]);

  const allGhosts = [
    ...(gRes.status  === 'fulfilled' ? gRes.value  : []),
    ...(olRes.status === 'fulfilled' ? olRes.value : []),
  ];
  const seenT  = new Set();
  const ghosts = allGhosts.filter(g => {
    const k = g.title.toLowerCase().trim();
    if (seenT.has(k)) return false;
    seenT.add(k);
    return true;
  });

  console.log('[Manual Series] companions found:', ghosts.map(g => g.title));

  if (ghosts.length) {
    ghosts.forEach(g => books.push(g));
    saveLocal();
    renderLibrary();
    showToast(`"${seriesName}" — ${ghosts.length} companion book${ghosts.length > 1 ? 's' : ''} added! 📚`);
  } else {
    showToast(`Series saved. No companion books found in APIs yet — they may not be catalogued.`);
  }
}

// ═══════════════════════════════════════
// GHOST BOOK DETAIL — claim or remove
// ═══════════════════════════════════════
function claimGhost(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;

  // Show a proper detail card for the ghost book with claim/remove options
  document.getElementById('detail-content').innerHTML = `
    ${b.coverUrl
      ? `<img src="${esc(b.coverUrl)}" class="detail-cover" alt="${esc(b.title)}"
             onerror="this.outerHTML='<div class=detail-cover-ph>${esc(b.title)}</div>'">`
      : `<div class="detail-cover-ph">${esc(b.title)}</div>`}
    <div style="padding:16px 18px 24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div class="detail-title">${esc(b.title)}</div>
        <button class="modal-close" onclick="closeModal('detail-modal')">✕</button>
      </div>
      <div class="detail-author">${esc(b.author || 'Unknown author')}</div>
      ${b.series
        ? `<div class="detail-series">📖 ${esc(b.series)}${b.seriesNum ? ' · Book #' + b.seriesNum : ''}</div>`
        : ''}
      <div class="detail-row" style="margin-bottom:12px">
        <span class="status-badge status-tbr">📖 Series Companion</span>
        ${b.pageCount ? `<span style="font-size:.72rem;color:#8a7060">${b.pageCount} pages</span>` : ''}
      </div>
      <div style="background:var(--cream);border-radius:10px;padding:11px 14px;
                  font-size:.82rem;color:#8a7060;line-height:1.6;margin-bottom:18px;
                  border:1px solid var(--border)">
        This book is part of a series on your shelf but hasn't been added to your
        collection yet. Add it when you're ready to read or track it.
      </div>
      <div class="divider"></div>
      <div class="form-group">
        <label>Add as</label>
        <select id="ghost-status">
          <option value="tbr">📚 To Be Read</option>
          <option value="reading">📖 Currently Reading</option>
          <option value="read">✅ Already Read</option>
        </select>
      </div>
      <div class="row-btns" style="margin-top:6px">
        <button class="btn btn-primary" onclick="confirmClaimGhost('${b.id}')">
          ✅ Add to My Shelf
        </button>
        <button class="btn btn-ghost" onclick="closeModal('detail-modal')">
          Not Now
        </button>
        <button class="btn btn-sm" style="background:#f0e0e0;color:#8a3030"
          onclick="removeGhost('${b.id}')">
          🗑 Remove
        </button>
      </div>
    </div>`;

  document.getElementById('detail-modal').classList.add('open');
}

function confirmClaimGhost(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  const status = document.getElementById('ghost-status')?.value || 'tbr';
  b.isGhost = false;
  b.status  = status;
  if (status === 'read' && !b.dateFinished) b.dateFinished = new Date().toISOString();
  saveLocal();
  closeModal('detail-modal');
  renderLibrary();
  showToast(`"${b.title}" added to your shelf!`);
}

function removeGhost(id) {
  if (!confirm('Remove this book from your shelf?')) return;
  books = books.filter(b => b.id !== id);
  saveLocal();
  closeModal('detail-modal');
  renderLibrary();
  showToast('Book removed.');
}

// ═══════════════════════════════════════
// VIEW TOGGLE
// ═══════════════════════════════════════
// Default view is 'shelf'. If the user has never explicitly set a preference,
// or if they had 'grid' from before the default changed, migrate to 'shelf' once.
let currentView = (() => {
  const stored = localStorage.getItem(SK_VIEW);
  const migrated = localStorage.getItem('salena_view_migrated_v1');
  if (!stored || (stored === 'grid' && !migrated)) {
    // First time, or pre-migration: set shelf as default
    localStorage.setItem(SK_VIEW, 'shelf');
    localStorage.setItem('salena_view_migrated_v1', '1');
    return 'shelf';
  }
  return stored;
})();

function setView(v) {
  currentView = v;
  localStorage.setItem(SK_VIEW, v);
  document.getElementById('vbtn-grid').classList.toggle('active', v === 'grid');
  document.getElementById('vbtn-shelf').classList.toggle('active', v === 'shelf');
  document.getElementById('vbtn-overview').classList.toggle('active', v === 'overview');
  document.getElementById('grid-view').style.display      = v === 'grid'     ? 'block' : 'none';
  document.getElementById('shelf-view').style.display     = v === 'shelf'    ? 'block' : 'none';
  document.getElementById('overview-view').style.display  = v === 'overview' ? 'block' : 'none';
  if (v === 'shelf') {
    // rAF ensures the shelf-view container has a computed width before we render spines into it
    requestAnimationFrame(() => renderShelf());
  } else {
    renderLibrary();
  }
}

// ═══════════════════════════════════════
// LIBRARY — CARD GRID
// ═══════════════════════════════════════
let books = [];
let activeFilter = 'all';

function renderLibrary() {
  if (currentView === 'shelf')    { renderShelf(); return; }
  if (currentView === 'overview') { renderShelfOverview(); return; }
  const q = (document.getElementById('lib-search').value || '').toLowerCase();
  const filtered = books.filter(b => {
    // Wishlist books only show on the Wishlist tab, not in main library
    if (b.status === 'wishlist') return false;
    // Ghost books show under "All" and "TBR" filter
    const statusMatch = activeFilter === 'all'
      || (b.isGhost && activeFilter === 'tbr')
      || (!b.isGhost && b.status === activeFilter);
    const textMatch = !q
      || b.title.toLowerCase().includes(q)
      || (b.author || '').toLowerCase().includes(q)
      || (b.genre || '').toLowerCase().includes(q)
      || (b.series || '').toLowerCase().includes(q);
    return statusMatch && textMatch;
  });

  const grid  = document.getElementById('book-grid');
  const empty = document.getElementById('lib-empty');
  if (!filtered.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = filtered.map(bookCardHTML).join('');
}

function bookCardHTML(b) {
  const pct = b.pageCount && b.currentPage ? Math.min(100, Math.round(b.currentPage / b.pageCount * 100)) : 0;
  const sm = { tbr:'status-tbr', reading:'status-reading', read:'status-read', dnf:'status-dnf', wishlist:'status-wishlist' };
  const sl = { tbr:'To Read', reading:'Reading', read:'Read', dnf:'DNF' };
  const isGhost = b.isGhost;
  const cov = b.coverUrl
    ? `<img class="book-cover" src="${esc(b.coverUrl)}" alt="${esc(b.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="book-cover-placeholder" style="display:none">${esc(b.title)}</div>`
    : `<div class="book-cover-placeholder">${esc(b.title)}</div>`;
  const click = isGhost ? `claimGhost('${b.id}')` : `openDetail('${b.id}')`;
  return `<div class="book-card${isGhost ? ' ghost-card' : ''}" onclick="${click}">
    ${cov}
    <div class="book-info">
      ${b.series ? `<div class="series-pill">${esc(b.series)}${b.seriesNum ? ' #' + b.seriesNum : ''}</div>` : ''}
      <div class="book-title">${esc(b.title)}</div>
      <div class="book-author">${esc(b.author || '')}</div>
      ${isGhost
        ? `<span class="status-badge status-tbr">📖 Series</span>`
        : `<span class="status-badge ${sm[b.status] || 'status-tbr'}">${sl[b.status] || 'TBR'}</span>`}
      ${b.status === 'reading' && b.pageCount
        ? `<div class="progress-wrap"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-label">${pct}%</div></div>`
        : ''}
    </div>
  </div>`;
}

function setFilter(el, s) {
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  activeFilter = s;
  renderLibrary();
}

// ═══════════════════════════════════════
// BOOKSHELF VIEW — 3D spines
// ═══════════════════════════════════════
// 15-colour spine palette covering common book cover hues
const SPINE_PALETTES = [
  ['#8B2635','#C94040'],['#1B4F72','#2980B9'],['#1D6A4A','#27AE60'],
  ['#6B2D8B','#9B59B6'],['#D35400','#E67E22'],['#2C3E50','#5D6D7E'],
  ['#7D6608','#C6A804'],['#922B21','#E74C3C'],['#154360','#2471A3'],
  ['#0B5345','#148F77'],['#512E5F','#7D3C98'],['#4A235A','#884EA0'],
  ['#1A5276','#1F618D'],['#784212','#B7770D'],['#212F3C','#34495E'],
];

function spineColors(book, idx) {
  return SPINE_PALETTES[idx % SPINE_PALETTES.length];
}


// ── Shelf display order ───────────────────────────────────────────────
// Stores an ordered array of book IDs for the standalone (non-series) books.
// Series books always appear grouped and sorted by seriesNum — not draggable.
function getShelfOrder() {
  try { return JSON.parse(localStorage.getItem(SK_SHELF_ORDER) || '[]'); } catch { return []; }
}
function saveShelfOrder(ids) {
  localStorage.setItem(SK_SHELF_ORDER, JSON.stringify(ids));
}

// Apply stored order to the standalones list
function applyShelfOrder(standalones) {
  const order = getShelfOrder();
  if (!order.length) return standalones;
  const map = new Map(standalones.map(b => [b.id, b]));
  const ordered = order.map(id => map.get(id)).filter(Boolean);
  // Append any books not yet in the order (newly added)
  const inOrder = new Set(order);
  standalones.forEach(b => { if (!inOrder.has(b.id)) ordered.push(b); });
  return ordered;
}


// ── Shelf drag-to-reorder ─────────────────────────────────────────────
// Only standalone (non-series) books are draggable.
// Series books stay grouped and sorted by number.
let _dragBookId  = null;
let _dragOverId  = null;

function shelfDragStart(e) {
  _dragBookId = e.currentTarget.dataset.bookId;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}

function shelfDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  const overId = target.dataset.bookId;
  if (overId && overId !== _dragBookId && overId !== _dragOverId) {
    _dragOverId = overId;
    // Visual indicator — shift the target slightly
    document.querySelectorAll('.draggable-spine').forEach(s => s.classList.remove('drag-over'));
    target.classList.add('drag-over');
  }
}

function shelfDrop(e) {
  e.preventDefault();
  const dropId = e.currentTarget.dataset.bookId;
  if (!_dragBookId || !dropId || _dragBookId === dropId) return;

  // Get current standalone order
  const standalones = books.filter(b => !b.series && !b.isGhost);
  let order = getShelfOrder();

  // Seed order from current standalones if empty
  if (!order.length) order = standalones.map(b => b.id);

  // Ensure all standalones are represented
  const inOrder = new Set(order);
  standalones.forEach(b => { if (!inOrder.has(b.id)) order.push(b.id); });

  // Move dragBookId to position of dropId
  const fromIdx = order.indexOf(_dragBookId);
  const toIdx   = order.indexOf(dropId);
  if (fromIdx === -1 || toIdx === -1) return;

  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, _dragBookId);

  saveShelfOrder(order);
  renderShelf();
}

function shelfDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.draggable-spine').forEach(s => {
    s.classList.remove('drag-over');
  });
  _dragBookId  = null;
  _dragOverId  = null;
}


// ═══════════════════════════════════════════════════════════════════
// SHELF OVERVIEW — zoomed-out thumbnail of all shelves
// ═══════════════════════════════════════════════════════════════════
function renderShelfOverview() {
  const el = document.getElementById('overview-view');
  if (!el) return;

  const cfg = getShelfConfig();
  const q   = (document.getElementById('lib-search').value || '').toLowerCase();
  const all = books.filter(b =>
    b.status !== 'wishlist' && (
      !q || b.title.toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q) ||
      (b.series || '').toLowerCase().includes(q)
    )
  );

  if (!all.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📚</div>
      <h3>Your shelf is empty</h3></div>`;
    return;
  }

  // Build same row structure as renderShelf
  const seriesMap  = {};
  const standalones = [];
  all.forEach(b => {
    if (b.series) {
      if (!seriesMap[b.series]) seriesMap[b.series] = [];
      seriesMap[b.series].push(b);
    } else { standalones.push(b); }
  });
  Object.values(seriesMap).forEach(arr =>
    arr.sort((a, b) => (a.seriesNum || 99) - (b.seriesNum || 99))
  );

  const BOOKS_PER_ROW = 14;
  const sections = [];
  Object.entries(seriesMap).forEach(([name, arr]) => sections.push({ label: name, books: arr }));
  if (standalones.length) sections.push({ label: '', books: applyShelfOrder(standalones) });

  const rows = [];
  let rowBuf = [], rowLabel = '';
  const flush = label => {
    if (!rowBuf.length) return;
    rows.push({ label: label || rowLabel, books: [...rowBuf] });
    rowBuf = []; rowLabel = '';
  };
  sections.forEach(sec => {
    if (rowBuf.length && rowBuf.length + sec.books.length > BOOKS_PER_ROW) flush(rowLabel);
    if (sec.label) rowLabel = sec.label;
    sec.books.forEach(b => {
      rowBuf.push(b);
      if (rowBuf.length >= BOOKS_PER_ROW) flush(rowLabel);
    });
  });
  flush(rowLabel);

  // Render each row as a clickable thumbnail card
  const cards = rows.map((row, rowIdx) => {
    // Mini spines — fixed narrow width regardless of page count
    const miniSpines = row.books.map(b => {
      const [c1, c2] = seriesColorFromTitle(b.series || b.title);
      const bg = b.coverUrl
        ? `background:url('${esc(b.coverUrl)}') center/cover no-repeat,${c1}`
        : `background:linear-gradient(90deg,${c1},${c2})`;
      const opacity = b.isGhost ? 'opacity:.45;' : '';
      return `<div style="width:12px;height:60px;flex-shrink:0;border-radius:1px;
                          ${bg};${opacity}
                          box-shadow:1px 0 2px rgba(0,0,0,.3)"></div>`;
    }).join('');

    const label = row.label
      ? `<div style="font-size:.62rem;font-weight:700;color:#8a7060;text-transform:uppercase;
                     letter-spacing:.05em;margin-bottom:4px;white-space:nowrap;overflow:hidden;
                     text-overflow:ellipsis">📚 ${esc(row.label)}</div>`
      : `<div style="font-size:.62rem;color:#b0988a;margin-bottom:4px">Mixed</div>`;

    return `<div class="shelf-overview-card" onclick="zoomToShelfRow(${rowIdx})"
      title="Click to zoom into this shelf">
      ${label}
      <div style="background:linear-gradient(180deg,var(--shelf-bg-top),var(--shelf-bg-bot));
                  border-radius:4px 4px 0 0;padding:8px 8px 0;
                  display:flex;gap:2px;align-items:flex-end;min-height:76px;
                  overflow:hidden">
        ${miniSpines}
      </div>
      <div style="height:8px;background:linear-gradient(180deg,var(--shelf-wood),var(--shelf-wood-dark));
                  border-radius:0 0 4px 4px;
                  box-shadow:0 2px 4px rgba(0,0,0,.3)"></div>
      <div style="font-size:.6rem;color:#b0988a;text-align:center;margin-top:4px">
        ${row.books.length} book${row.books.length !== 1 ? 's' : ''}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:12px 0 4px;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:.78rem;color:#8a7060">
        ${rows.length} shelf${rows.length !== 1 ? 'ves' : ''} · ${all.length} books total
      </div>
      <div style="font-size:.72rem;color:#b0988a">tap any shelf to zoom in</div>
    </div>
    <div class="shelf-overview-grid">${cards}</div>`;
}

// Zoom from overview into a specific shelf row
function zoomToShelfRow(rowIdx) {
  setView('shelf');
  // After shelf renders, scroll to the target row
  requestAnimationFrame(() => {
    const sections = document.querySelectorAll('#shelf-view .shelf-section');
    if (sections[rowIdx]) {
      sections[rowIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight flash
      sections[rowIdx].style.transition = 'box-shadow .3s';
      sections[rowIdx].style.boxShadow  = '0 0 0 3px var(--accent)';
      setTimeout(() => { sections[rowIdx].style.boxShadow = ''; }, 1200);
    }
  });
}

function renderShelf() {
  const el = document.getElementById('shelf-view');
  const q = (document.getElementById('lib-search').value || '').toLowerCase();
  const all = books.filter(b =>
    !q || b.title.toLowerCase().includes(q)
       || (b.author || '').toLowerCase().includes(q)
       || (b.series || '').toLowerCase().includes(q)
  );

  if (!all.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📚</div><h3>Your shelf is empty</h3><p>Tap <strong>+ Add</strong> to start cataloguing your books.</p></div>`;
    document.getElementById('lib-empty').style.display = 'none';
    return;
  }
  document.getElementById('lib-empty').style.display = 'none';

  // Group: series first (sorted by number), then standalones
  const seriesMap = {};
  const standalones = [];
  all.forEach(b => {
    if (b.series) {
      if (!seriesMap[b.series]) seriesMap[b.series] = [];
      seriesMap[b.series].push(b);
    } else {
      standalones.push(b);
    }
  });
  Object.values(seriesMap).forEach(arr => arr.sort((a,b) => (a.seriesNum || 99) - (b.seriesNum || 99)));

  // Flatten into chunks of ≤14 per shelf row
  const BOOKS_PER_ROW = 14;
  const sections = [];
  Object.entries(seriesMap).forEach(([name, arr]) => sections.push({ label: name, books: arr }));
  if (standalones.length) sections.push({ label: '', books: applyShelfOrder(standalones) });

  let rows = [];
  let rowBuf = [];
  let rowLabel = '';

  const flushRow = label => {
    if (!rowBuf.length) return;
    rows.push({ label: label || rowLabel, books: [...rowBuf] });
    rowBuf = [];
    rowLabel = '';
  };

  sections.forEach(sec => {
    if (rowBuf.length && rowBuf.length + sec.books.length > BOOKS_PER_ROW) flushRow(rowLabel);
    if (sec.label) rowLabel = sec.label;
    sec.books.forEach(b => {
      rowBuf.push(b);
      if (rowBuf.length >= BOOKS_PER_ROW) flushRow(rowLabel);
    });
  });
  flushRow(rowLabel);

  const shelfTypeCls = 'shelf-type-' + (getShelfConfig().shelfType || 'freestanding');
  let globalIdx = 0;
  el.innerHTML = `<div class="${shelfTypeCls}">${rows.map(row => buildShelfRow(row.books, row.label, globalIdx += row.books.length)).join('')}</div>`;
}

function buildShelfRow(rowBooks, label, startIdx) {
  const spines = rowBooks.map((b, i) => {
    const isGhost = b.isGhost;
    const [c1, c2] = spineColors(b, startIdx - rowBooks.length + i);
    // Thickness proportional to page count (30–52px)
    const thick = Math.max(16, Math.min(32, Math.round((b.pageCount || 280) / 20)));
    const titleFull  = b.title; // no truncation — full title always shown
    const authorShort = (b.author || '').split(',')[0].replace(/\b\w+\.\s*/, '').trim();
    // Dynamic font size: inverse of title length, clamped to readable range
    const titleLen   = titleFull.length;
    const titleFSize = titleLen <= 8  ? '.72rem'
                     : titleLen <= 16 ? '.64rem'
                     : titleLen <= 24 ? '.56rem'
                     : titleLen <= 34 ? '.50rem'
                     :                  '.44rem';
    const click = isGhost ? `claimGhost('${b.id}')` : `openDetail('${b.id}')`;
    const tooltipParts = [b.title];
    if (b.series) tooltipParts.push(`(${b.series}${b.seriesNum ? ' #' + b.seriesNum : ''})`);
    if (isGhost) tooltipParts.push('· click to add');
    // Cover art IS the spine — gradient only as no-cover fallback
    const bgStyle = b.coverUrl
      ? `background:${c1};`
      : `background:linear-gradient(90deg,${c1} 0%,${c2} 55%,${c1} 100%);`;
    const fallbackBg = `background:linear-gradient(90deg,${c1},${c2})`;
    const isDraggable = !b.series && !isGhost;
    return `<div class="book-spine${isGhost ? ' ghost-spine' : ''}${isDraggable ? ' draggable-spine' : ''}"
      onclick="${click}"
      style="${bgStyle}width:${thick}px;"
      title="${esc(tooltipParts.join(' '))}${isDraggable ? ' · drag to reorder' : ''}"
      ${isDraggable ? `draggable="true" data-book-id="${b.id}"
        ondragstart="shelfDragStart(event)"
        ondragover="shelfDragOver(event)"
        ondrop="shelfDrop(event)"
        ondragend="shelfDragEnd(event)"` : ''}>
      ${b.coverUrl
        ? `<img class="spine-cover-img" src="${esc(b.coverUrl)}" alt="" onerror="this.parentElement.style.cssText='${fallbackBg};width:${thick}px;';this.remove()"/>`
        : ''}
      <div class="spine-title" style="font-size:${titleFSize}">${esc(titleFull)}</div>
      <div class="spine-author">${esc(authorShort)}</div>
      ${b.series && b.seriesNum ? `<div class="spine-num">#${b.seriesNum}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="shelf-section" style="width:100%;display:block;">
    ${label ? `<div class="shelf-section-label">📖 ${esc(label)}</div>` : ''}
    <div class="shelf-row-wrap">
      <div class="shelf-row">
        ${spines}
        <div class="shelf-add-btn" onclick="openBookSearch()" title="Add a book">＋</div>
      </div>
    </div>
    <div class="shelf-plank" style="width:100%;"></div>
  </div>`;
}

// ═══════════════════════════════════════
// BOOK DETAIL MODAL
// ═══════════════════════════════════════
function openDetail(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;

  const pct = b.pageCount && b.currentPage ? Math.min(100, Math.round(b.currentPage / b.pageCount * 100)) : 0;
  const sm  = { tbr:'status-tbr', reading:'status-reading', read:'status-read', dnf:'status-dnf' };
  const sl  = { tbr:'To Be Read', reading:'Currently Reading', read:'Read', dnf:'Did Not Finish' };
  const dateF = b.dateFinished ? new Date(b.dateFinished).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) : '';
  const dateS = b.dateStarted  ? new Date(b.dateStarted ).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) : '';

  document.getElementById('detail-content').innerHTML = `
    ${b.coverUrl
      ? `<img src="${esc(b.coverUrl)}" class="detail-cover" alt="${esc(b.title)}" onerror="this.outerHTML='<div class=detail-cover-ph>${esc(b.title)}</div>'">`
      : `<div class="detail-cover-ph">${esc(b.title)}</div>`}
    <div style="padding:16px 18px 22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px">
        <div class="detail-title">${esc(b.title)}</div>
        <button class="modal-close" onclick="closeModal('detail-modal')">✕</button>
      </div>
      <div class="detail-author">${esc(b.author || 'Unknown author')}</div>
      ${b.series ? `<div class="detail-series">📖 ${esc(b.series)}${b.seriesNum ? ' · Book #' + b.seriesNum : ''}</div>` : ''}
      <div class="detail-row">
        <span class="status-badge ${sm[b.status] || 'status-tbr'}">${sl[b.status] || 'TBR'}</span>
        ${b.genre ? `<span class="status-badge status-tbr">${esc(b.genre)}</span>` : ''}
        ${b.pageCount ? `<span style="font-size:.72rem;color:#8a7060">${b.pageCount} pages</span>` : ''}
      </div>
      ${b.status === 'reading' && b.pageCount
        ? `<div class="progress-wrap" style="margin-bottom:12px">
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            <div class="progress-label">${pct}% · page ${b.currentPage || 0} of ${b.pageCount}</div>
           </div>` : ''}
      ${dateS ? `<div style="font-size:.74rem;color:#8a7060;margin-bottom:3px">📅 Started: ${dateS}</div>` : ''}
      ${dateF ? `<div style="font-size:.74rem;color:#8a7060;margin-bottom:10px">✅ Finished: ${dateF}</div>` : ''}
      <div class="divider"></div>
      ${b.rating ? `<div style="margin-bottom:12px">
        <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;letter-spacing:.05em;text-transform:uppercase;margin-bottom:5px">Rating</div>
        ${renderRatingDisplay(b.rating, b.ratingScale || 5)}
      </div>` : ''}
      ${b.notes ? `<div style="margin-bottom:12px">
        <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;letter-spacing:.05em;text-transform:uppercase;margin-bottom:5px">Review &amp; Notes</div>
        <div class="review-box">${esc(b.notes)}</div>
      </div>` : ''}
      <div class="divider"></div>
      ${b.status === 'reading' ? `
        <div class="form-group">
          <label>Current Page</label>
          <div style="display:flex;gap:8px">
            <input type="number" id="d-page" value="${b.currentPage || 0}" min="0" max="${b.pageCount || 9999}"
              style="width:110px;padding:7px 10px;border:1.5px solid var(--border);border-radius:9px;font-family:var(--font-body);background:var(--card-bg);color:var(--ink);outline:none;font-size:.88rem"/>
            <button class="btn btn-sage btn-sm" onclick="updPage('${id}')">Save</button>
          </div>
        </div>` : ''}
      <div class="form-group"><label>Status</label>
        <select id="d-status" onchange="updStatus('${id}',this.value)">
          <option value="tbr" ${b.status==='tbr'?'selected':''}>📚 To Be Read</option>
          <option value="reading" ${b.status==='reading'?'selected':''}>📖 Currently Reading</option>
          <option value="read" ${b.status==='read'?'selected':''}>✅ Read</option>
          <option value="dnf" ${b.status==='dnf'?'selected':''}>❌ Did Not Finish</option>
          <option value="wishlist" ${b.status==='wishlist'?'selected':''}>🎁 Wishlist</option>
        </select>
      </div>
      <div style="font-size:.68rem;color:#b0988a;margin-bottom:13px">
        Added ${new Date(b.dateAdded).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}
      </div>
      <div class="row-btns">
        <button class="btn btn-ghost btn-sm" onclick="closeModal('detail-modal');openAddModal(null,books.find(x=>x.id==='${id}'))">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="manualFindSeries('${id}')" title="Auto-search all sources for series — opens manual entry if APIs fail">🔍 Find Series</button>
        <button class="btn btn-ghost btn-sm" onclick="closeModal('detail-modal');openManualSeriesEntry('${id}')" title="Set series name manually and fetch companions">📖 Set Series</button>
        <button class="btn btn-sm" style="background:#f0e0e0;color:#8a3030" onclick="delBook('${id}')">🗑 Remove</button>
      </div>
    </div>`;

  document.getElementById('detail-modal').classList.add('open');
}

function renderRatingDisplay(rating, scale) {
  if (!rating) return '<span style="color:#b0988a;font-size:.82rem;font-style:italic">Not rated</span>';
  if (scale === 10) {
    return `<div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:1.4rem;font-weight:700;color:var(--btn-primary-bg);font-family:var(--font-display)">${rating}</span>
      <span style="font-size:.78rem;color:#8a7060">/ 10</span>
      <span style="font-size:.85rem;letter-spacing:1px">${'★'.repeat(Math.round(rating / 2))}${'☆'.repeat(5 - Math.round(rating / 2))}</span>
    </div>`;
  }
  return `<div style="display:flex;align-items:center;gap:4px">
    ${[1,2,3,4,5].map(i => `<span style="font-size:1.1rem;color:${rating>=i?'#E8A838':'#d4c0a0'}">★</span>`).join('')}
    <span style="font-size:.78rem;color:#8a7060;margin-left:4px">${rating}/5</span>
  </div>`;
}

// ═══════════════════════════════════════
// CURRENTLY READING
// ═══════════════════════════════════════
function renderCurrently() {
  const list  = document.getElementById('currently-list');
  const empty = document.getElementById('currently-empty');
  const reading = books.filter(b => b.status === 'reading' && !b.isGhost);
  if (!reading.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  list.innerHTML = reading.map(b => {
    const pct = b.pageCount && b.currentPage ? Math.min(100, Math.round(b.currentPage / b.pageCount * 100)) : 0;
    const cov = b.coverUrl
      ? `<img src="${esc(b.coverUrl)}" style="width:62px;height:93px;object-fit:cover;border-radius:9px;flex-shrink:0;box-shadow:2px 2px 8px var(--shadow)" onerror="this.style.display='none'"/>`
      : `<div style="width:62px;height:93px;border-radius:9px;background:linear-gradient(135deg,var(--blush-light),var(--mauve-light));display:flex;align-items:center;justify-content:center;font-size:.6rem;text-align:center;padding:4px;flex-shrink:0;font-family:var(--font-display)">${esc(b.title)}</div>`;
    return `<div class="reading-card" onclick="openDetail('${b.id}')">
      ${cov}
      <div style="flex:1">
        <div style="font-family:var(--font-display);font-size:.93rem;font-weight:600;margin-bottom:2px;line-height:1.2">${esc(b.title)}</div>
        <div style="font-size:.72rem;color:#8a7060;margin-bottom:2px;font-style:italic">${esc(b.author || '')}</div>
        ${b.series ? `<div style="font-size:.68rem;color:var(--accent);margin-bottom:6px;font-weight:700">${esc(b.series)}</div>` : ''}
        <div class="progress-track" style="margin-bottom:4px"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div style="font-size:.68rem;color:#8a7060;margin-bottom:9px">${pct}% · page ${b.currentPage || 0} of ${b.pageCount || '?'}</div>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();quickPage('${b.id}')">Update Page</button>
      </div>
    </div>`;
  }).join('');
}

function quickPage(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  const p = prompt(`Current page for "${b.title}"? (of ${b.pageCount || '?'})`, b.currentPage || '');
  if (p === null) return;
  b.currentPage = parseInt(p) || 0;
  if (!useCloud()) saveLocal();
  else apiFetch(`/api/books/${id}`, { method: 'PUT', body: JSON.stringify(b) }).catch(() => {});
  renderCurrently();
  renderLibrary();
  showToast('Progress updated!');
}

// ═══════════════════════════════════════
// STATS
// ═══════════════════════════════════════
function renderStats() {
  const real = books.filter(b => !b.isGhost);
  const read  = real.filter(b => b.status === 'read');
  const rated = read.filter(b => b.rating);
  const avg   = rated.length
    ? (rated.reduce((s, b) => s + (b.ratingScale === 10 ? b.rating / 2 : b.rating), 0) / rated.length).toFixed(1)
    : '—';
  const yr = read.filter(b => b.dateFinished && new Date(b.dateFinished).getFullYear() === new Date().getFullYear()).length;

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${real.length}</div><div class="stat-label">Total Books</div></div>
    <div class="stat-card"><div class="stat-num">${read.length}</div><div class="stat-label">Books Read</div></div>
    <div class="stat-card"><div class="stat-num">${yr}</div><div class="stat-label">Read This Year</div></div>
    <div class="stat-card"><div class="stat-num">${avg}</div><div class="stat-label">Avg Rating</div></div>`;

  const gm = {};
  real.forEach(b => { if (b.genre) gm[b.genre] = (gm[b.genre] || 0) + 1; });
  const gs = Object.entries(gm).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const gEl = document.getElementById('genre-section');
  if (gs.length) {
    gEl.style.display = 'block';
    const mx = gs[0][1];
    document.getElementById('genre-bars').innerHTML = gs.map(([g, c]) =>
      `<div class="genre-row"><div class="genre-name">${esc(g)}</div><div class="genre-track"><div class="genre-fill" style="width:${Math.round(c/mx*100)}%"></div></div><div class="genre-count">${c}</div></div>`
    ).join('');
  } else gEl.style.display = 'none';
}

// ═══════════════════════════════════════
// CORE CRUD + HELPERS
// ═══════════════════════════════════════
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (APP_TOKEN) headers['X-App-Token'] = APP_TOKEN;
  const r = await fetch(API_URL + path, { headers, ...opts });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function loadBooks() {
  // localStorage is ALWAYS primary — load it first, always
  try {
    const raw = localStorage.getItem(SK_BOOKS);
    books = JSON.parse(raw) || [];
  } catch(e) { books = []; }

  // If localStorage has data, we're done — use it
  if (books.length > 0) {
    console.log('[loadBooks] Loaded', books.length, 'books from localStorage');
    return;
  }

  // localStorage empty — try cloud as recovery source
  if (useCloud()) {
    try {
      const cloudBooks = await apiFetch('/api/books');
      if (Array.isArray(cloudBooks) && cloudBooks.length > 0) {
        books = cloudBooks;
        // Restore cloud data back to localStorage
        localStorage.setItem(SK_BOOKS, JSON.stringify(books));
        console.log('[loadBooks] Restored', books.length, 'books from cloud to localStorage');
      }
    } catch(e) {
      console.warn('[loadBooks] Cloud recovery failed:', e.message);
    }
  }
}

function saveLocal() {
  _saveInProgress = true;
  try {
    localStorage.setItem(SK_BOOKS, JSON.stringify(books));
  } catch(e) {
    console.error('[saveLocal] localStorage write failed:', e);
    showToast('⚠️ Could not save — storage may be full.');
    _saveInProgress = false;
    return;
  }
  writeAutosave();
  _saveInProgress = false;
  // Background cloud sync — never blocks, never fails the save
  if (useCloud()) {
    apiFetch('/api/books/bulk', { method: 'POST', body: JSON.stringify({ books }) })
      .catch(e => console.warn('[Cloud] books sync failed:', e.message));
  }
}

// Sync a single book to cloud in background — fire and forget
function syncBookToCloud(b) {
  if (!useCloud()) return;
  apiFetch(`/api/books/${b.id}`, { method: 'PUT', body: JSON.stringify(b) })
    .catch(e => console.warn('[Cloud] Book sync failed:', e.message));
}

function showSection(name, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'stats')    renderStats();
  if (name === 'currently') renderCurrently();
  if (name === 'manga')    setMangaView(currentMangaView);
  if (name === 'wishlist') renderWishlist();
}

async function updPage(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  b.currentPage = parseInt(document.getElementById('d-page').value) || 0;
  if (useCloud()) apiFetch(`/api/books/${id}`, { method: 'PUT', body: JSON.stringify(b) }).catch(() => {});
  else saveLocal();
  renderLibrary(); renderCurrently(); openDetail(id);
  showToast('Progress updated!');
}

async function updStatus(id, v) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  b.status = v;
  b.isGhost = false;
  if (v === 'read' && !b.dateFinished) b.dateFinished = new Date().toISOString();
  if (useCloud()) apiFetch(`/api/books/${id}`, { method: 'PUT', body: JSON.stringify(b) }).catch(() => {});
  else saveLocal();
  renderLibrary(); renderCurrently(); openDetail(id);
  showToast('Status updated!');
}

async function delBook(id) {
  if (!confirm('Remove this book from your shelf?')) return;
  books = books.filter(b => b.id !== id);
  if (useCloud()) {
    try { await apiFetch(`/api/books/${id}`, { method: 'DELETE' }); }
    catch { showToast('Delete failed.'); return; }
  } else saveLocal();
  renderLibrary(); renderCurrently();
  closeModal('detail-modal');
  showToast('Book removed.');
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Settings Backup / Restore ─────────────────────────────────────────
// Exports ALL localStorage keys + metadata in one JSON file.
// Safe to import on any device — restores theme, shelf, nav, custom bookends,
// custom aesthetics, saved themes. Does NOT include books/manga (use exportJSON).
function exportSettings() {
  const SETTINGS_KEYS = ALL_SETTINGS_KEYS;
  const payload = {
    _meta: {
      exportedAt: new Date().toISOString(),
      app: "Salena's Bookshelf",
      version: 1,
      type: 'settings',
    },
    settings: {},
  };
  SETTINGS_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) payload.settings[k] = v; // store raw strings
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `salenas-bookshelf-settings-${new Date().toISOString().slice(0,10)}.json`,
  });
  a.click();
  showToast('Settings exported!');
}

function importSettings(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const payload = JSON.parse(ev.target.result);
      if (payload._meta?.type !== 'settings') throw new Error('Not a settings file');
      const knownKeys = new Set(ALL_SETTINGS_KEYS);
      let restored = 0, skipped = 0;
      Object.entries(payload.settings).forEach(([k, v]) => {
        if (knownKeys.has(k) || k.startsWith('salena_')) {
          localStorage.setItem(k, v);
          restored++;
        } else {
          console.warn('[Import] Skipped unknown key:', k);
          skipped++;
        }
      });
      showToast(`Settings restored (${restored} keys)${skipped ? ' — ' + skipped + ' skipped' : ''} — reloading…`, 2000);
      setTimeout(() => window.location.reload(), 1800);
    } catch(err) {
      showToast('Settings import failed: ' + err.message);
    }
  };
  r.readAsText(f);
}

// Full backup — books + manga + all settings in one file
function exportFullBackup() {
  const SETTINGS_KEYS = ALL_SETTINGS_KEYS;
  const settings = {};
  SETTINGS_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) settings[k] = v;
  });
  const payload = {
    _meta: {
      exportedAt: new Date().toISOString(),
      app: "Salena's Bookshelf",
      version: 1,
      type: 'full-backup',
    },
    settings,
    books: books,
    manga: manga,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `salenas-bookshelf-full-backup-${new Date().toISOString().slice(0,10)}.json`,
  });
  a.click();
  showToast('Full backup exported!');
}

function importFullBackup(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const payload = JSON.parse(ev.target.result);
      if (!['full-backup'].includes(payload._meta?.type)) throw new Error('Not a full backup file');
      // Restore settings — validate keys
      const knownKeys = new Set(ALL_SETTINGS_KEYS);
      Object.entries(payload.settings || {}).forEach(([k, v]) => {
        if (knownKeys.has(k) || k.startsWith('salena_')) localStorage.setItem(k, v);
        else console.warn('[Restore] Skipped unknown key:', k);
      });
      // Restore books + manga
      if (Array.isArray(payload.books)) localStorage.setItem(SK_BOOKS, JSON.stringify(payload.books));
      if (Array.isArray(payload.manga)) localStorage.setItem(SK_MANGA, JSON.stringify(payload.manga));
      showToast('Full backup restored — reloading…', 2000);
      setTimeout(() => window.location.reload(), 1800);
    } catch(err) {
      showToast('Restore failed: ' + err.message);
    }
  };
  r.readAsText(f);
}

function exportJSON() {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(books, null, 2)], { type: 'application/json' })),
    download: `salenas-bookshelf-${new Date().toISOString().slice(0,10)}.json`
  });
  a.click(); showToast('Exported!');
}

function exportCSV() {
  const h = ['title','author','genre','series','seriesNum','status','pageCount','currentPage','rating','ratingScale','dateAdded','dateStarted','dateFinished','notes'];
  const rows = [h.join(','), ...books.map(b => h.map(k => `"${(b[k]||'').toString().replace(/"/g,'""')}"`).join(','))];
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })),
    download: `salenas-bookshelf-${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click(); showToast('CSV exported!');
}

function importJSON(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw 0;
      books = imported; saveLocal(); renderLibrary();
      showToast(`${books.length} books imported!`);
    } catch { showToast('Import failed — invalid file.'); }
  };
  r.readAsText(f);
}

async function migrateToCloud() {
  if (!useCloud()) { showToast('Set API_URL in app.js first.'); return; }

  const btn = document.querySelector('[onclick="migrateToCloud()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Migrating…'; }

  try {
    // Push all books
    showToast('☁️ Uploading books…', 4000);
    const bRes = await apiFetch('/api/books/bulk', {
      method: 'POST',
      body: JSON.stringify({ books })
    });

    // Push all manga
    showToast('☁️ Uploading manga…', 4000);
    const mRes = await apiFetch('/api/manga/bulk', {
      method: 'POST',
      body: JSON.stringify({ manga })
    });

    // Push all settings
    showToast('☁️ Uploading settings…', 4000);
    const settings = {};
    ALL_SETTINGS_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) settings[k] = v;
    });
    await apiFetch('/api/settings/bulk', {
      method: 'POST',
      body: JSON.stringify({ settings })
    });

    showToast(`✅ Migration complete! ${bRes.count || 0} books, ${mRes.count || 0} manga uploaded.`, 6000);
    if (btn) { btn.textContent = '✅ Done'; }
  } catch(e) {
    console.error('[Migrate]', e);
    showToast('Migration failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Migrate to Cloud'; }
  }
}

function showToast(msg, duration) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  const _dur = duration
    || (msg.startsWith('🔍') || msg.startsWith('📚') ? 5000 : 2800);
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), _dur);
}

// Close modals on backdrop click
document.querySelectorAll('.modal-overlay').forEach(o =>
  o.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); })
);



// ═══════════════════════════════════════════════════════════════════
// SHELF APPEARANCE SETTINGS
// ═══════════════════════════════════════════════════════════════════

const SHELF_WOOD_PRESETS = [
  { name:'Classic Oak',    wood:'#8B5E3C', dark:'#6B3F1E', label:'🟤' },
  { name:'Walnut',         wood:'#5C3A1E', dark:'#3B2008', label:'🟫' },
  { name:'Birch',          wood:'#C8A97E', dark:'#A07850', label:'🪵' },
  { name:'Ebony',          wood:'#2C1A0E', dark:'#180E04', label:'⬛' },
  { name:'Whitewash',      wood:'#E8DDD0', dark:'#C8B8A0', label:'🤍' },
  { name:'Cherry',         wood:'#7B3327', dark:'#551A10', label:'🍒' },
  { name:'Pine',           wood:'#B8924A', dark:'#8C6830', label:'🌿' },
  { name:'Mahogany',       wood:'#6B2D2D', dark:'#4A1818', label:'🔴' },
  { name:'Ash Gray',       wood:'#8A8A7A', dark:'#5A5A4E', label:'🩶' },
  { name:'Midnight Blue',  wood:'#1A2840', dark:'#0E1820', label:'🌑' },
  { name:'Forest Green',   wood:'#2D4A2D', dark:'#1A2E1A', label:'🌲' },
  { name:'Rose Gold',      wood:'#B07878', dark:'#7A4848', label:'🌸' },
];

const SHELF_BG_PRESETS = [
  { name:'Warm Shadow',  top:'rgba(80,40,10,.04)',  bot:'rgba(80,40,10,.11)' },
  { name:'Deep Shadow',  top:'rgba(20,10,5,.08)',   bot:'rgba(20,10,5,.22)' },
  { name:'Cool Gray',    top:'rgba(60,60,80,.04)',  bot:'rgba(60,60,80,.12)' },
  { name:'No Shadow',    top:'rgba(0,0,0,.0)',      bot:'rgba(0,0,0,.04)' },
  { name:'Warm Glow',    top:'rgba(255,200,100,.06)', bot:'rgba(200,120,40,.14)' },
  { name:'Purple Haze',  top:'rgba(80,40,120,.05)', bot:'rgba(80,40,120,.14)' },
];

function getShelfConfig() {
  try {
    const s = JSON.parse(localStorage.getItem(SK_SHELF));
    if (s) return s;
  } catch {}
  return {
    woodPreset:       'Classic Oak',
    customWood:       '#8B5E3C',
    customWoodDark:   '#6B3F1E',
    bgPreset:         'Warm Shadow',
    plankH:           24,
    spineH:           175,
    showGrain:        true,
    spinesPerRow:     18,
    allowShelfSharing: true,
    bookendStyle:     'minimal',
    dividerStyle:     'gap',
    shelfType:        'freestanding',
  };
}

function saveShelfConfig(cfg) {
  localStorage.setItem(SK_SHELF, JSON.stringify(cfg));
}

function applyShelfConfig(cfg) {
  // Route through setCSSVar so _cssVarCache stays in sync
  const bg = SHELF_BG_PRESETS.find(b => b.name === cfg.bgPreset) || SHELF_BG_PRESETS[0];
  const grain = cfg.showGrain
    ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='100'%3E%3Cline x1='2' y1='0' x2='2' y2='100' stroke='rgba(0,0,0,.07)' stroke-width='1'/%3E%3C/svg%3E")`
    : 'none';
  setCSSVar('--shelf-wood',      cfg.customWood     || '#8B5E3C');
  setCSSVar('--shelf-wood-dark', cfg.customWoodDark || '#6B3F1E');
  setCSSVar('--shelf-plank-h',   (cfg.plankH || 24) + 'px');
  setCSSVar('--shelf-spine-h',   (cfg.spineH || 175) + 'px');
  setCSSVar('--shelf-bg-top',    bg.top);
  setCSSVar('--shelf-bg-bot',    bg.bot);
  setCSSVar('--shelf-grain',     grain);
}

function loadShelfConfig() {
  applyShelfConfig(getShelfConfig());
}

function renderSearchSettings() {
  const cfg = getBookApiConfig();
  return `
    <div class="section-heading">🔍 Book Search Sources</div>
    <p style="font-size:.78rem;color:#8a7060;margin-bottom:12px;line-height:1.6">
      Choose which sources are queried when you search for a book.
      Both are enabled by default and results are merged automatically.
    </p>

    <div class="nav-setting-row">
      <div>
        <div style="font-size:.82rem;font-weight:700;color:var(--ink)">🔍 Google Books</div>
        <div style="font-size:.7rem;color:#b0988a">Best for covers, metadata, and series info</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="api-toggle-google" ${cfg.useGoogle!==false?'checked':''}
          onchange="bookApiToggle('useGoogle',this.checked)"/>
        <span class="toggle-track"></span>
      </label>
    </div>

    <div class="nav-setting-row" style="margin-bottom:16px">
      <div>
        <div style="font-size:.82rem;font-weight:700;color:var(--ink)">📖 Open Library</div>
        <div style="font-size:.7rem;color:#b0988a">Good fallback for older and indie titles</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="api-toggle-openlib" ${cfg.useOpenLib!==false?'checked':''}
          onchange="bookApiToggle('useOpenLib',this.checked)"/>
        <span class="toggle-track"></span>
      </label>
    </div>

    <div class="divider"></div>
    <div class="section-heading">🔑 Google Books API Key</div>
    <p style="font-size:.78rem;color:#8a7060;margin-bottom:10px;line-height:1.6">
      A free API key removes rate limits and improves series detection.
      Changes take effect immediately — no redeploy needed.
    </p>
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <input type="text" id="gb-api-key-input" value="${esc(cfg.googleKey||'')}"
        placeholder="AIzaSy..."
        style="flex:1;padding:9px 13px;border:1.5px solid var(--border);border-radius:10px;
               font-family:var(--font-body);font-size:.84rem;background:var(--card-bg);
               color:var(--ink);outline:none"/>
      <button class="btn btn-primary btn-sm" onclick="saveGbApiKey()">💾 Save Key</button>
    </div>
    <div style="font-size:.7rem;color:#b0988a;line-height:1.6">
      Get a free key: <strong>console.cloud.google.com</strong> → Enable Books API → Credentials → API Key
    </div>

    <div class="divider"></div>
    <div class="section-heading">🧪 Test Search</div>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input type="text" id="api-test-query" placeholder="e.g. Dungeon Crawler Carl"
        style="flex:1;padding:9px 13px;border:1.5px solid var(--border);border-radius:10px;
               font-family:var(--font-body);font-size:.84rem;background:var(--card-bg);
               color:var(--ink);outline:none"/>
      <button class="btn btn-sage btn-sm" onclick="runApiTest()">Test</button>
    </div>
    <div id="api-test-result" style="font-size:.76rem;color:#8a7060;min-height:24px;line-height:1.6"></div>
  `;
}

async function runApiTest() {
  const q = (document.getElementById('api-test-query')?.value || '').trim();
  const out = document.getElementById('api-test-result');
  if (!q) { out.textContent = 'Enter a search term first.'; return; }
  out.textContent = '⏳ Testing…';
  const cfg = getBookApiConfig();
  const results = [];
  if (cfg.useGoogle !== false) {
    try {
      const r = await fetch(gbUrl(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3&printType=books`));
      const d = await r.json();
      results.push(`Google Books: ${r.ok ? (d.items||[]).length + ' results (HTTP '+r.status+')' : 'HTTP ' + r.status}`);
    } catch(e) { results.push('Google Books: ERROR — ' + e.message); }
  } else { results.push('Google Books: disabled'); }
  if (cfg.useOpenLib !== false) {
    try {
      const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=3`);
      const d = await r.json();
      results.push(`Open Library: ${r.ok ? (d.docs||[]).length + ' results (HTTP '+r.status+')' : 'HTTP ' + r.status}`);
    } catch(e) { results.push('Open Library: ERROR — ' + e.message); }
  } else { results.push('Open Library: disabled'); }
  out.innerHTML = results.map(r => `<div>${r}</div>`).join('');
}

function renderShelfSettings() {
  const cfg = getShelfConfig();

  const woodChips = SHELF_WOOD_PRESETS.map(p => {
    const isSel = cfg.woodPreset === p.name;
    return `<div onclick="shelfSetWoodPreset('${p.name}')"
      title="${p.name}"
      style="width:44px;height:44px;border-radius:10px;cursor:pointer;
        background:linear-gradient(135deg,${p.wood},${p.dark});
        border:3px solid ${isSel ? 'var(--btn-primary-bg)' : 'transparent'};
        box-shadow:${isSel ? '0 0 0 2px var(--accent)' : '0 2px 6px rgba(0,0,0,.2)'};
        display:flex;align-items:center;justify-content:center;
        font-size:.55rem;color:rgba(255,255,255,.7);font-weight:700;
        transition:transform .15s;" title="${p.name}">
      <span style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:.48rem;opacity:.8">${p.name.slice(0,8)}</span>
    </div>`;
  }).join('');

  const bgChips = SHELF_BG_PRESETS.map(p => {
    const isSel = cfg.bgPreset === p.name;
    return `<div onclick="shelfSetBgPreset('${p.name}')"
      style="padding:5px 10px;border-radius:8px;cursor:pointer;font-size:.7rem;font-weight:700;
        border:2px solid ${isSel ? 'var(--btn-primary-bg)' : 'var(--border)'};
        background:var(--${isSel?'blush-light':'cream'});color:var(--ink);
        font-family:var(--font-body);transition:all .15s;">${p.name}</div>`;
  }).join('');

  return `
    <p style="font-size:.76rem;color:#8a7060;margin-bottom:14px;line-height:1.5">
      Customise every detail of the bookshelf — wood, shadows, spine size, and grain texture.
    </p>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">🪵 Wood Colour</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px">${woodChips}</div>
    <div style="display:flex;gap:10px;margin-bottom:16px;align-items:center">
      <div style="flex:1">
        <div style="font-size:.68rem;color:#8a7060;margin-bottom:4px">Custom Top Colour</div>
        <div class="color-swatch-btn" id="sw-wood" style="background:${cfg.customWood};width:36px;height:36px;border-radius:9px">
          <input type="color" value="${cfg.customWood}" oninput="shelfCustomWood('top',this.value)"/>
        </div>
      </div>
      <div style="flex:1">
        <div style="font-size:.68rem;color:#8a7060;margin-bottom:4px">Custom Dark Edge</div>
        <div class="color-swatch-btn" id="sw-wood-dark" style="background:${cfg.customWoodDark};width:36px;height:36px;border-radius:9px">
          <input type="color" value="${cfg.customWoodDark}" oninput="shelfCustomWood('dark',this.value)"/>
        </div>
      </div>
    </div>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">🌑 Shelf Background</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${bgChips}</div>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">📏 Dimensions</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div>
        <div style="font-size:.68rem;color:#8a7060;margin-bottom:4px">Spine Height <span id="spine-h-val">${cfg.spineH}</span>px</div>
        <input type="range" min="120" max="260" value="${cfg.spineH}" step="5"
          oninput="shelfSetSpineH(this.value)"
          style="width:100%;accent-color:var(--btn-primary-bg)"/>
      </div>
      <div>
        <div style="font-size:.68rem;color:#8a7060;margin-bottom:4px">Plank Height <span id="plank-h-val">${cfg.plankH}</span>px</div>
        <input type="range" min="10" max="48" value="${cfg.plankH}" step="2"
          oninput="shelfSetPlankH(this.value)"
          style="width:100%;accent-color:var(--btn-primary-bg)"/>
      </div>
    </div>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">✨ Details</div>
    <div class="nav-setting-row" style="margin-bottom:8px">
      <span style="font-size:.82rem;font-weight:700;flex:1;font-family:var(--font-display)">Wood Grain Texture</span>
      <label class="toggle-switch">
        <input type="checkbox" ${cfg.showGrain ? 'checked' : ''} onchange="shelfToggleGrain(this.checked)"/>
        <span class="toggle-track"></span>
      </label>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-primary btn-sm" onclick="applyAndRenderShelf()">✅ Apply to Shelf</button>
      <button class="btn btn-sage btn-sm" onclick="refreshMangaCovers()">🔄 Refresh Cover Cache</button>
      <button class="btn btn-ghost btn-sm" onclick="shelfReset()">↺ Reset Shelf</button>
    </div>

    <div class="divider"></div>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">📐 Layout</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:.68rem;color:#8a7060;margin-bottom:4px">Spines per shelf <span id="spr-val">${cfg.spinesPerRow||18}</span></div>
        <input type="range" min="8" max="28" value="${cfg.spinesPerRow||18}" step="1"
          oninput="shelfSetSpinesPerRow(this.value)"
          style="width:100%;accent-color:var(--btn-primary-bg)"/>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;justify-content:flex-end">
        <div class="nav-setting-row" style="margin:0">
          <span style="font-size:.76rem;font-weight:700;flex:1">Share shelf between titles</span>
          <label class="toggle-switch">
            <input type="checkbox" ${(cfg.allowShelfSharing!==false)?'checked':''} onchange="shelfToggleSharing(this.checked)"/>
            <span class="toggle-track"></span>
          </label>
        </div>
      </div>
    </div>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">🗄️ Shelf Type</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px">
      ${[
        { id:'freestanding', label:'Freestanding',  icon:'🗄️', desc:'Classic stacked rows' },
        { id:'cube',         label:'Cube/Modular',  icon:'⬜', desc:'Individual cubbies' },
        { id:'ladder',       label:'Ladder',        icon:'🪜', desc:'Leaning with rails' },
        { id:'corner',       label:'Corner',        icon:'📐', desc:'Angled join accent' },
        { id:'etagere',      label:'Étagère',       icon:'🏺', desc:'Open frame, thin shelves' },
        { id:'barrister',    label:'Barrister',     icon:'🏛️', desc:'Stacked glass cases' },
        { id:'secretary',    label:'Secretary',     icon:'📜', desc:'Enclosed writing desk' },
      ].map(t => {
        const active = (cfg.shelfType || 'freestanding') === t.id;
        return `<button onclick="shelfSetType('${t.id}')"
          style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;
            padding:9px 12px;border-radius:10px;cursor:pointer;text-align:left;
            border:2px solid ${active ? 'var(--btn-primary-bg)' : 'var(--border)'};
            background:${active ? 'var(--blush-light)' : 'var(--cream)'};
            font-family:var(--font-body);transition:all .15s">
          <span style="font-size:.88rem">${t.icon} <strong style="font-size:.76rem;color:var(--ink)">${t.label}</strong></span>
          <span style="font-size:.64rem;color:#8a7060">${t.desc}</span>
        </button>`;
      }).join('')}
    </div>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">🔖 Bookends <span style="font-weight:400;font-size:.66rem;color:#b0988a">(global default — override per-series in manga edit)</span></div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px">
      ${['none','minimal','bracket','dragon','sakura','moon','hikaru'].map(s => {
        const labels = {none:'None',minimal:'Wood',bracket:'Bracket',dragon:'🐉 Dragon',sakura:'🌸 Sakura',moon:'🌙 Moon','hikaru':'🪲 Hikaru'};
        const isSel = (cfg.bookendStyle||'minimal') === s;
        return `<button onclick="shelfSetBookend('${s}')"
          style="padding:5px 12px;border-radius:8px;cursor:pointer;font-size:.72rem;font-weight:700;
            border:2px solid ${isSel?'var(--btn-primary-bg)':'var(--border)'};
            background:${isSel?'var(--blush-light)':'var(--cream)'};color:var(--ink);
            font-family:var(--font-body);transition:all .15s">${labels[s]}</button>`;
      }).join('')}
    </div>
    ${(() => {
      const customs = getCustomBookends();
      const customBtns = customs.map(c => {
        const isSel = (cfg.bookendStyle||'minimal') === c.id;
        return `<button onclick="shelfSetBookend('${c.id}')"
          style="padding:5px 12px;border-radius:8px;cursor:pointer;font-size:.72rem;font-weight:700;
            border:2px solid ${isSel?'var(--btn-primary-bg)':'var(--accent)'};
            background:${isSel?'var(--blush-light)':'var(--mauve-light)'};color:var(--ink);
            font-family:var(--font-body);transition:all .15s">✨ ${esc(c.name)}</button>
         <button onclick="openCustomBookendEditor('${c.id}')"
          style="padding:5px 8px;border-radius:8px;cursor:pointer;font-size:.68rem;
            border:1px solid var(--border);background:var(--cream);color:#8a7060;
            font-family:var(--font-body)">✏️</button>`;
      }).join('');
      return customs.length
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${customBtns}</div>`
        : '';
    })()}
    <button class="btn btn-ghost btn-sm" onclick="openCustomBookendEditor(null)" style="margin-bottom:14px">
      ✏️ Create Custom Bookend
    </button>

    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:9px">📏 Series Dividers</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px">
      ${['none','gap','line','marker','color'].map(s => {
        const labels = {none:'None',gap:'Space',line:'Line',marker:'Wood Peg',color:'Color Match'};
        const isSel = (cfg.dividerStyle||'gap') === s;
        return `<button onclick="shelfSetDivider('${s}')"
          style="padding:5px 12px;border-radius:8px;cursor:pointer;font-size:.72rem;font-weight:700;
            border:2px solid ${isSel?'var(--btn-primary-bg)':'var(--border)'};
            background:${isSel?'var(--blush-light)':'var(--cream)'};color:var(--ink);
            font-family:var(--font-body);transition:all .15s">${labels[s]}</button>`;
      }).join('')}
    </div>

    <div style="margin-top:4px;border-radius:12px;overflow:hidden;border:1px solid var(--border)">
      <div style="font-size:.68rem;color:#8a7060;padding:6px 10px;background:var(--cream);font-weight:700;text-transform:uppercase;letter-spacing:.05em">Live Preview</div>
      <div style="background:linear-gradient(180deg,var(--shelf-bg-top),var(--shelf-bg-bot));padding:12px 16px 0;display:flex;gap:3px;align-items:flex-end">
        ${buildBookends(cfg.bookendStyle||'minimal',cfg)[0]}
        ${['Fantasy','Romance','Mystery'].map((t,i) => {
          const h = ((t.charCodeAt(0)*7+i*37)%360);
          return `<div style="width:28px;height:80px;border-radius:3px 0 0 3px;background:linear-gradient(90deg,hsl(${h},55%,28%),hsl(${h},50%,45%));box-shadow:2px 0 4px rgba(0,0,0,.3)"></div>`;
        }).join('')}
        ${buildShelfDivider(cfg.dividerStyle||'gap','hsl(200,55%,28%)')}
        ${['Thriller','Sci-Fi'].map((t,i) => {
          const h = ((t.charCodeAt(0)*7+(i+3)*37)%360);
          return `<div style="width:28px;height:80px;border-radius:3px 0 0 3px;background:linear-gradient(90deg,hsl(${h},55%,28%),hsl(${h},50%,45%));box-shadow:2px 0 4px rgba(0,0,0,.3)"></div>`;
        }).join('')}
        ${buildBookends(cfg.bookendStyle||'minimal',cfg)[1]}
      </div>
      <div style="height:var(--shelf-plank-h,24px);background:linear-gradient(180deg,var(--shelf-wood),var(--shelf-wood-dark));box-shadow:0 4px 10px rgba(0,0,0,.3)"></div>
    </div>`;
}

function shelfSetWoodPreset(name) {
  const p = SHELF_WOOD_PRESETS.find(x => x.name === name);
  if (!p) return;
  const cfg = getShelfConfig();
  cfg.woodPreset = name;
  cfg.customWood = p.wood;
  cfg.customWoodDark = p.dark;
  saveShelfConfig(cfg);
  applyShelfConfig(cfg);
  _refreshShelfPanel();
}

function shelfCustomWood(side, val) {
  const cfg = getShelfConfig();
  if (side === 'top') { cfg.customWood = val; document.getElementById('sw-wood').style.background = val; }
  else { cfg.customWoodDark = val; document.getElementById('sw-wood-dark').style.background = val; }
  cfg.woodPreset = 'Custom';
  saveShelfConfig(cfg);
  applyShelfConfig(cfg);
}

function shelfSetBgPreset(name) {
  const cfg = getShelfConfig();
  cfg.bgPreset = name;
  saveShelfConfig(cfg);
  applyShelfConfig(cfg);
  _refreshShelfPanel();
}

function shelfSetSpineH(v) {
  const cfg = getShelfConfig();
  cfg.spineH = parseInt(v);
  saveShelfConfig(cfg);
  applyShelfConfig(cfg);
  const el = document.getElementById('spine-h-val');
  if (el) el.textContent = v;
}

function shelfSetPlankH(v) {
  const cfg = getShelfConfig();
  cfg.plankH = parseInt(v);
  saveShelfConfig(cfg);
  applyShelfConfig(cfg);
  const el = document.getElementById('plank-h-val');
  if (el) el.textContent = v;
}

function shelfToggleGrain(on) {
  const cfg = getShelfConfig();
  cfg.showGrain = on;
  saveShelfConfig(cfg);
  applyShelfConfig(cfg);
}


function shelfSetSpinesPerRow(v) {
  const cfg = getShelfConfig(); cfg.spinesPerRow = parseInt(v);
  saveShelfConfig(cfg); applyShelfConfig(cfg); _refreshShelfPanel();
  const el = document.getElementById('spr-val'); if (el) el.textContent = v;
}
function shelfToggleSharing(on) {
  const cfg = getShelfConfig(); cfg.allowShelfSharing = on;
  saveShelfConfig(cfg); applyShelfConfig(cfg); _refreshShelfPanel();
}
function shelfSetBookend(style) {
  const cfg = getShelfConfig(); cfg.bookendStyle = style;
  saveShelfConfig(cfg); applyShelfConfig(cfg); _refreshShelfPanel();
}
function shelfSetDivider(style) {
  const cfg = getShelfConfig(); cfg.dividerStyle = style;
  saveShelfConfig(cfg); applyShelfConfig(cfg); _refreshShelfPanel();
}
// Apply current shelf config to both the shelf CSS vars and re-render the shelf
function shelfSetType(t) {
  const cfg = getShelfConfig();
  cfg.shelfType = t;
  saveShelfConfig(cfg);
  applyShelfConfig(cfg);
  // Re-render both shelves so change is immediate
  if (typeof renderShelf === 'function') renderShelf();
  if (typeof renderMangaShelf === 'function' && currentMangaView === 'shelf') {
    requestAnimationFrame(() => renderMangaShelf());
  }
  _refreshShelfPanel();
}

function applyAndRenderShelf() {
  const cfg = getShelfConfig();
  applyShelfConfig(cfg);
  if (typeof renderMangaShelf === 'function' && currentMangaView === 'shelf') {
    requestAnimationFrame(() => renderMangaShelf());
  }
  if (typeof renderShelf === 'function' && currentView === 'shelf') {
    requestAnimationFrame(() => renderShelf());
  }
  showToast('Shelf settings applied!');
}
function shelfReset() {
  const def = { woodPreset:'Classic Oak', customWood:'#8B5E3C', customWoodDark:'#6B3F1E', bgPreset:'Warm Shadow', plankH:24, spineH:175, showGrain:true, spinesPerRow:18, allowShelfSharing:true, bookendStyle:'minimal', dividerStyle:'gap', shelfType:'freestanding' };
  saveShelfConfig(def);
  applyShelfConfig(def);
  _refreshShelfPanel();
  showToast('Shelf reset to default.');
}

function _refreshShelfPanel() {
  const p = document.getElementById('sp-shelf');
  if (p && p.classList.contains('active')) p.innerHTML = renderShelfSettings();
}

function bookApiToggle(field, val) {
  const cfg = getBookApiConfig();
  cfg[field] = val;
  saveBookApiConfig(cfg);
  showToast(`${field === 'useGoogle' ? 'Google Books' : 'Open Library'} ${val ? 'enabled' : 'disabled'}.`);
}

function saveGbApiKey() {
  const key = (document.getElementById('gb-api-key-input')?.value || '').trim();
  const cfg = getBookApiConfig();
  cfg.googleKey = key;
  saveBookApiConfig(cfg);
  // Update the runtime constant so searches use the new key immediately
  window._runtimeGbKey = key;
  showToast(key ? '✅ Google Books API key saved.' : 'API key cleared — using default.');
}

function initApiSettingsUI() {
  // renderSearchSettings() reads live from getBookApiConfig() each time it renders
  // so no separate init pass is needed — this is a no-op kept for compatibility
}

function refreshMangaCovers() {
  // Clear all cached volume covers and re-render the shelf fresh
  Object.keys(_mangaVolCovers).forEach(k => delete _mangaVolCovers[k]);
  showToast('Cover cache cleared — rebuilding shelf…');
  if (currentMangaView === 'shelf') {
    requestAnimationFrame(() => renderMangaShelf());
  }
}

// ═══════════════════════════════════════════════════════════════════
// NAV SETTINGS — modular tab order, visibility, placement
// ═══════════════════════════════════════════════════════════════════
const NAV_TABS_DEFAULT = [
  { id:'library',   label:'Library',     icon:'📚', visible:true },
  { id:'currently', label:'Reading Now', icon:'📖', visible:true },
  { id:'stats',     label:'Stats',       icon:'📊', visible:true },
  { id:'manga',     label:'Manga',       icon:'🗾', visible:true },
  { id:'wishlist',  label:'Wishlist',    icon:'🎁', visible:true },
  { id:'data',      label:'Data',        icon:'💾', visible:true },
];
const NAV_POS_DEFAULT = 'top'; // 'top' or 'bottom'

function getNavConfig() {
  try {
    const s = JSON.parse(localStorage.getItem(SK_NAV));
    if (s && s.tabs && s.tabs.length) {
      // Migrate: add any tabs from defaults that aren't in stored config
      const storedIds = new Set(s.tabs.map(t => t.id));
      NAV_TABS_DEFAULT.forEach(def => {
        if (!storedIds.has(def.id)) {
          // Insert before 'data' tab
          const dataIdx = s.tabs.findIndex(t => t.id === 'data');
          if (dataIdx > -1) s.tabs.splice(dataIdx, 0, { ...def });
          else s.tabs.push({ ...def });
        }
      });
      return s;
    }
  } catch {}
  return { tabs: JSON.parse(JSON.stringify(NAV_TABS_DEFAULT)), position: NAV_POS_DEFAULT };
}
function saveNavConfig(cfg) { localStorage.setItem(SK_NAV, JSON.stringify(cfg)); }

function applyNavConfig() {
  const cfg = getNavConfig();
  const nav = document.querySelector('nav');
  const body = document.body;

  // Position
  if (cfg.position === 'bottom') {
    nav.classList.add('nav-bottom');
    body.classList.add('nav-at-bottom');
  } else {
    nav.classList.remove('nav-bottom');
    body.classList.remove('nav-at-bottom');
  }

  // Rebuild tab buttons
  const visible = cfg.tabs.filter(t => t.visible);
  nav.innerHTML = visible.map((t, i) =>
    `<button class="tab${i===0?' active':''}" onclick="showSection('${t.id}',this)">${t.icon} ${t.label}</button>`
  ).join('');

  // Make sure first visible section is active
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  if (visible.length) {
    const firstId = 'sec-' + visible[0].id;
    const el = document.getElementById(firstId);
    if (el) el.classList.add('active');
  }
}

function renderNavSettings() {
  const cfg = getNavConfig();
  const tabRows = cfg.tabs.map((t, i) => `
    <div class="nav-setting-row" id="navrow-${t.id}" draggable="true"
      ondragstart="navDragStart(event,'${t.id}')"
      ondragover="event.preventDefault()"
      ondrop="navDrop(event,'${t.id}')">
      <span class="nav-drag-handle" title="Drag to reorder">⠿</span>
      <span class="nav-setting-icon">${t.icon}</span>
      <span class="nav-setting-label">${t.label}</span>
      <label class="toggle-switch" title="${t.visible ? 'Visible — click to hide' : 'Hidden — click to show'}">
        <input type="checkbox" ${t.visible ? 'checked' : ''} onchange="navToggleTab('${t.id}',this.checked)"/>
        <span class="toggle-track"></span>
      </label>
    </div>`).join('');

  const posOpts = ['top','bottom'].map(p =>
    `<button class="scale-opt ${cfg.position===p?'active':''}" onclick="navSetPosition('${p}')">${p === 'top' ? '⬆️ Top' : '⬇️ Bottom'}</button>`
  ).join('');

  return `
    <p style="font-size:.76rem;color:#8a7060;margin-bottom:12px;line-height:1.5">
      Show/hide tabs and drag to reorder. Changes apply immediately.
    </p>
    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Position</div>
    <div style="display:flex;gap:8px;margin-bottom:16px">${posOpts}</div>
    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Tabs</div>
    <div id="nav-tab-rows">${tabRows}</div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="navReset()">↺ Reset to Default</button>`;
}

// Drag-and-drop reorder
let _navDragId = null;
function navDragStart(e, id) { _navDragId = id; e.dataTransfer.effectAllowed = 'move'; }
function navDrop(e, targetId) {
  if (!_navDragId || _navDragId === targetId) return;
  const cfg = getNavConfig();
  const from = cfg.tabs.findIndex(t => t.id === _navDragId);
  const to   = cfg.tabs.findIndex(t => t.id === targetId);
  const [moved] = cfg.tabs.splice(from, 1);
  cfg.tabs.splice(to, 0, moved);
  saveNavConfig(cfg);
  applyNavConfig();
  // Re-render the nav settings panel
  const panel = document.getElementById('sp-nav');
  if (panel && panel.classList.contains('active')) panel.innerHTML = renderNavSettings();
}
function navToggleTab(id, visible) {
  const cfg = getNavConfig();
  const t = cfg.tabs.find(x => x.id === id);
  if (t) t.visible = visible;
  saveNavConfig(cfg);
  applyNavConfig();
}
function navSetPosition(pos) {
  const cfg = getNavConfig();
  cfg.position = pos;
  saveNavConfig(cfg);
  applyNavConfig();
  const panel = document.getElementById('sp-nav');
  if (panel && panel.classList.contains('active')) panel.innerHTML = renderNavSettings();
}
function navReset() {
  saveNavConfig({ tabs: JSON.parse(JSON.stringify(NAV_TABS_DEFAULT)), position: NAV_POS_DEFAULT });
  applyNavConfig();
  const panel = document.getElementById('sp-nav');
  if (panel && panel.classList.contains('active')) panel.innerHTML = renderNavSettings();
  showToast('Nav reset to default.');
}

// ═══════════════════════════════════════
// STYLE STUDIO
// ═══════════════════════════════════════
const BUILTIN_AESTHETICS = [
  {
    id:'cozy', name:'Cozy Library', sub:'Warm & timeless', banner:'☕', bannerBg:'#FDF8F2',
    quote:'your reading life, all in one place',
    fonts:{ display:'Playfair Display', body:'Lato', accent:'Dancing Script' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="10" y="10" width="22" height="30" rx="3" fill="#EDD5C6" opacity=".9"/><rect x="12" y="12" width="18" height="26" rx="2" fill="#D4967A" opacity=".7"/><rect x="14" y="16" width="10" height="1.5" rx="1" fill="white" opacity=".7"/><rect x="14" y="20" width="12" height="1.5" rx="1" fill="white" opacity=".5"/><path d="M32 15 Q38 10 44 15 L44 38 Q38 33 32 38 Z" fill="#9B7E9E" opacity=".85"/><text x="6" y="12" font-size="7" opacity=".8">✦</text><rect x="31" y="15" width="2" height="16" rx="1" fill="#EDD5C6" opacity=".8"/></svg>`,
    vars:{'--paper':'#FDF8F2','--ink':'#2C2416','--cream':'#F5EDE0','--border':'#E3D4C3','--card-bg':'#ffffff','--header-bg':'#2C2416','--header-text':'#FDF8F2','--header-sub':'#EDD5C6','--nav-bg':'#F5EDE0','--tab-active':'#D4967A','--btn-primary-bg':'#D4967A','--btn-primary-text':'#ffffff','--btn-sage-bg':'#8FAF8A','--progress-fill':'#D4967A','--accent':'#9B7E9E','--blush-light':'#EDD5C6','--mauve-light':'#DDD0DF','--badge-tbr-bg':'#D4E5D2','--badge-tbr-text':'#3d6b3a','--badge-reading-bg':'#FFF3CD','--badge-reading-text':'#7a5800','--badge-read-bg':'#EDD5C6','--badge-read-text':'#8a3a1a','--badge-dnf-bg':'#f0e0e0','--badge-dnf-text':'#8a3030','--card-radius':'14px','--pill-radius':'24px'}
  },
  {
    id:'cottagecore', name:'Cottagecore', sub:'Floral & whimsical', banner:'🌸', bannerBg:'#fce4ec',
    quote:'lost in pages & wildflowers',
    fonts:{ display:'Libre Baskerville', body:'Quicksand', accent:'Dancing Script' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><text x="7" y="20" font-size="10">🌸</text><text x="36" y="15" font-size="8">🌿</text><rect x="17" y="15" width="18" height="25" rx="3" fill="#f48fb1" opacity=".7"/><rect x="19" y="17" width="14" height="21" rx="2" fill="#fce4ec" opacity=".9"/><rect x="21" y="21" width="7" height="1.5" rx="1" fill="#c2185b" opacity=".5"/><rect x="26" y="15" width="2" height="13" rx="1" fill="#f48fb1"/><text x="37" y="42" font-size="9">🌼</text></svg>`,
    vars:{'--paper':'#fff8f9','--ink':'#3d1a2e','--cream':'#fce4ec','--border':'#f8bbd0','--card-bg':'#ffffff','--header-bg':'#7b1e44','--header-text':'#fff8f9','--header-sub':'#f8bbd0','--nav-bg':'#fce4ec','--tab-active':'#c2185b','--btn-primary-bg':'#c2185b','--btn-primary-text':'#ffffff','--btn-sage-bg':'#81c784','--progress-fill':'#e91e8c','--accent':'#7b1e44','--blush-light':'#f8bbd0','--mauve-light':'#fce4ec','--badge-tbr-bg':'#c8e6c9','--badge-tbr-text':'#1b5e20','--badge-reading-bg':'#fff9c4','--badge-reading-text':'#7a5800','--badge-read-bg':'#f8bbd0','--badge-read-text':'#880e4f','--badge-dnf-bg':'#ffe0e0','--badge-dnf-text':'#8a3030','--card-radius':'16px','--pill-radius':'24px'}
  },
  {
    id:'darkacademia', name:'Dark Academia', sub:'Moody & literary', banner:'🕯️', bannerBg:'#2c2010',
    quote:'dust, candlelight & old stories',
    fonts:{ display:'Cormorant Garamond', body:'Lato', accent:'EB Garamond' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="10" y="8" width="32" height="38" rx="2" fill="#3d2b1a" opacity=".9"/><rect x="14" y="14" width="16" height="2" rx="1" fill="#d4a96a" opacity=".7"/><rect x="14" y="19" width="20" height="1.5" rx="1" fill="#d4a96a" opacity=".4"/><rect x="24" y="10" width="2" height="20" rx="1" fill="#d4a96a" opacity=".5"/><rect x="38" y="28" width="5" height="12" rx="1" fill="#f5e6c8" opacity=".9"/><ellipse cx="40.5" cy="26" rx="2" ry="3" fill="#ff9800" opacity=".7"/></svg>`,
    vars:{'--paper':'#1a1208','--ink':'#e8dcc8','--cream':'#2c2010','--border':'#4a3820','--card-bg':'#241a0c','--header-bg':'#0e0a04','--header-text':'#e8dcc8','--header-sub':'#a08858','--nav-bg':'#1a1208','--tab-active':'#d4a96a','--btn-primary-bg':'#8b6914','--btn-primary-text':'#f5e6c8','--btn-sage-bg':'#4a6741','--progress-fill':'#d4a96a','--accent':'#8b1a1a','--blush-light':'#3d2a14','--mauve-light':'#2a1a0a','--badge-tbr-bg':'#1a2e1a','--badge-tbr-text':'#8bc34a','--badge-reading-bg':'#3d2e10','--badge-reading-text':'#ffcc80','--badge-read-bg':'#3d1a0a','--badge-read-text':'#ff8a65','--badge-dnf-bg':'#2a1010','--badge-dnf-text':'#ef9a9a','--card-radius':'6px','--pill-radius':'4px'}
  },
  {
    id:'softglam', name:'Soft Glam', sub:'Clean & rose gold', banner:'✨', bannerBg:'#fff0f3',
    quote:'elegance is a state of mind',
    fonts:{ display:'Playfair Display', body:'Josefin Sans', accent:'Satisfy' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="14" y="13" width="17" height="25" rx="4" fill="#b0838a" opacity=".6"/><rect x="15" y="14" width="15" height="23" rx="3" fill="#f8bbd0" opacity=".85"/><text x="33" y="19" font-size="11">✨</text><text x="35" y="34" font-size="8">💫</text><rect x="21" y="13" width="2.5" height="16" rx="1.2" fill="#f48fb1" opacity=".85"/></svg>`,
    vars:{'--paper':'#fff8fa','--ink':'#2a1020','--cream':'#fce8ee','--border':'#f0c8d4','--card-bg':'#ffffff','--header-bg':'#c4687a','--header-text':'#fff8fa','--header-sub':'#fce8ee','--nav-bg':'#fce8ee','--tab-active':'#b5485c','--btn-primary-bg':'#c4687a','--btn-primary-text':'#ffffff','--btn-sage-bg':'#c4a882','--progress-fill':'#c4687a','--accent':'#8a4a5a','--blush-light':'#f8d0da','--mauve-light':'#f0d8e8','--badge-tbr-bg':'#d4e8d4','--badge-tbr-text':'#2e5e2e','--badge-reading-bg':'#fff8d4','--badge-reading-text':'#6a4e00','--badge-read-bg':'#f8d0da','--badge-read-text':'#8a1a30','--badge-dnf-bg':'#ffe0e4','--badge-dnf-text':'#8a2030','--card-radius':'20px','--pill-radius':'30px'}
  },
  {
    id:'kawaii', name:'Pastel Kawaii', sub:'Cute & dreamy', banner:'🦋', bannerBg:'#f3e8ff',
    quote:'reading is magic ✨',
    fonts:{ display:'Quicksand', body:'Nunito', accent:'Pacifico' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="22" fill="#f3e8ff" opacity=".45"/><text x="3" y="18" font-size="11">🦋</text><text x="36" y="13" font-size="9">⭐</text><rect x="16" y="13" width="17" height="24" rx="8" fill="#ce93d8" opacity=".6"/><rect x="18" y="15" width="13" height="20" rx="6" fill="#f3e8ff" opacity=".9"/></svg>`,
    vars:{'--paper':'#fdf8ff','--ink':'#2a1040','--cream':'#f3e8ff','--border':'#ddb8f0','--card-bg':'#ffffff','--header-bg':'#7c3aed','--header-text':'#fdf8ff','--header-sub':'#ddb8f0','--nav-bg':'#f3e8ff','--tab-active':'#a855f7','--btn-primary-bg':'#a855f7','--btn-primary-text':'#ffffff','--btn-sage-bg':'#f472b6','--progress-fill':'#a855f7','--accent':'#ec4899','--blush-light':'#fce7f3','--mauve-light':'#f3e8ff','--badge-tbr-bg':'#d1fae5','--badge-tbr-text':'#065f46','--badge-reading-bg':'#fef9c3','--badge-reading-text':'#713f12','--badge-read-bg':'#fce7f3','--badge-read-text':'#9d174d','--badge-dnf-bg':'#fee2e2','--badge-dnf-text':'#991b1b','--card-radius':'22px','--pill-radius':'30px'}
  },
  {
    id:'midnight', name:'Midnight Library', sub:'Dark & mysterious', banner:'🌙', bannerBg:'#0f0e17',
    quote:'best read after midnight',
    fonts:{ display:'Cinzel', body:'Josefin Sans', accent:'Satisfy' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="22" fill="#1a1a2e" opacity=".8"/><text x="31" y="17" font-size="11">🌙</text><text x="7" y="13" font-size="7" fill="white" opacity=".8">✦</text><rect x="11" y="16" width="17" height="24" rx="2" fill="#16213e" opacity=".9"/><rect x="13" y="18" width="13" height="20" rx="1" fill="#0f3460" opacity=".8"/><rect x="15" y="22" width="6" height="1.5" rx="1" fill="#e94560" opacity=".7"/><rect x="19" y="16" width="2" height="13" rx="1" fill="#e94560" opacity=".6"/></svg>`,
    vars:{'--paper':'#0f0e17','--ink':'#fffffe','--cream':'#1a1a2e','--border':'#2a2a3e','--card-bg':'#1a1a2e','--header-bg':'#0a0a12','--header-text':'#fffffe','--header-sub':'#a7a9be','--nav-bg':'#0f0e17','--tab-active':'#ff8906','--btn-primary-bg':'#ff8906','--btn-primary-text':'#0f0e17','--btn-sage-bg':'#3da9fc','--progress-fill':'#ff8906','--accent':'#e53170','--blush-light':'#2a1a2e','--mauve-light':'#1a1a3e','--badge-tbr-bg':'#1a2e1a','--badge-tbr-text':'#90d4a0','--badge-reading-bg':'#2e2a1a','--badge-reading-text':'#ffd580','--badge-read-bg':'#2e1a1a','--badge-read-text':'#ff9a9a','--badge-dnf-bg':'#2a1a2a','--badge-dnf-text':'#c0a0c0','--card-radius':'10px','--pill-radius':'8px'}
  },
  {
    id:'lavender', name:'Lavender Dream', sub:'Soft purple haze', banner:'💜', bannerBg:'#f3e8ff',
    quote:'drift away on every page',
    fonts:{ display:'Cormorant Garamond', body:'Nunito', accent:'Dancing Script' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="20" fill="#ede7f6" opacity=".5"/><text x="3" y="18" font-size="10">💜</text><rect x="14" y="13" width="17" height="25" rx="4" fill="#7c4dcc" opacity=".6"/><rect x="16" y="15" width="13" height="21" rx="3" fill="#f3e8ff" opacity=".9"/><rect x="22" y="13" width="2.5" height="14" rx="1.2" fill="#ce93d8" opacity=".9"/><text x="39" y="42" font-size="9">🌙</text></svg>`,
    vars:{'--paper':'#faf7ff','--ink':'#2a1f3d','--cream':'#ede7f6','--border':'#cdb8e8','--card-bg':'#ffffff','--header-bg':'#4a1a8a','--header-text':'#faf7ff','--header-sub':'#d4b8f0','--nav-bg':'#ede7f6','--tab-active':'#7c4dcc','--btn-primary-bg':'#7c4dcc','--btn-primary-text':'#ffffff','--btn-sage-bg':'#ab47bc','--progress-fill':'#7c4dcc','--accent':'#ec407a','--blush-light':'#e1d0f5','--mauve-light':'#ede7f6','--badge-tbr-bg':'#d4b8f0','--badge-tbr-text':'#4a1a8a','--badge-reading-bg':'#fff9c4','--badge-reading-text':'#7a5800','--badge-read-bg':'#e8d5f8','--badge-read-text':'#5c1f99','--badge-dnf-bg':'#ffd0d8','--badge-dnf-text':'#8a1030','--card-radius':'18px','--pill-radius':'28px'}
  },

  // ── ANIME THEMES ──────────────────────────────────────────────────

  {
    id:'demonslayer', name:'Demon Slayer', sub:'Taisho era & flame', banner:'🔥', bannerBg:'#1a0505',
    quote:"no matter how many people you may lose, you have no choice but to go on living",
    fonts:{ display:'Cinzel', body:'Josefin Sans', accent:'Satisfy' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#1a0505"/><path d="M28 8 L32 20 L44 20 L34 28 L38 40 L28 32 L18 40 L22 28 L12 20 L24 20 Z" fill="#e8321a" opacity=".85"/><path d="M28 12 L31 20 L40 20 L33 25 L36 34 L28 29 L20 34 L23 25 L16 20 L25 20 Z" fill="#ffb347" opacity=".6"/><text x="38" y="14" font-size="9">🔥</text></svg>`,
    vars:{'--paper':'#0d0505','--ink':'#f5e6d0','--cream':'#1a0808','--border':'#4a1a08','--card-bg':'#1a0808','--header-bg':'#0a0202','--header-text':'#f5e6d0','--header-sub':'#e8a87a','--nav-bg':'#0d0505','--tab-active':'#e8321a','--btn-primary-bg':'#e8321a','--btn-primary-text':'#f5e6d0','--btn-sage-bg':'#c4860a','--progress-fill':'#ffb347','--accent':'#ffb347','--blush-light':'#2a1008','--mauve-light':'#1a0808','--badge-tbr-bg':'#1a2e1a','--badge-tbr-text':'#90d4a0','--badge-reading-bg':'#3d1a08','--badge-reading-text':'#ffb347','--badge-read-bg':'#2e0a0a','--badge-read-text':'#ff8a65','--badge-dnf-bg':'#1a0808','--badge-dnf-text':'#e8a87a','--card-radius':'4px','--pill-radius':'4px'}
  },

  {
    id:'attackontitan', name:'Attack on Titan', sub:'Beyond the walls', banner:'⚔️', bannerBg:'#0e1a0e',
    quote:"if you win, you live. if you lose, you die. if you don't fight, you can't win.",
    fonts:{ display:'Cinzel', body:'Lato', accent:'EB Garamond' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#0e1a0e"/><rect x="10" y="10" width="36" height="36" rx="2" fill="#1a2e1a" opacity=".9"/><polygon points="28,12 44,44 12,44" fill="none" stroke="#8bc34a" stroke-width="2" opacity=".8"/><circle cx="28" cy="32" r="8" fill="none" stroke="#8bc34a" stroke-width="1.5" opacity=".6"/><line x1="28" y1="12" x2="28" y2="44" stroke="#8bc34a" stroke-width="1" opacity=".4"/><line x1="12" y1="44" x2="44" y2="44" stroke="#8bc34a" stroke-width="1" opacity=".4"/></svg>`,
    vars:{'--paper':'#0e1a0e','--ink':'#e8f0e0','--cream':'#1a2e1a','--border':'#2a4a2a','--card-bg':'#1a2e1a','--header-bg':'#080e08','--header-text':'#e8f0e0','--header-sub':'#8bc34a','--nav-bg':'#0e1a0e','--tab-active':'#8bc34a','--btn-primary-bg':'#4a7a1a','--btn-primary-text':'#e8f0e0','--btn-sage-bg':'#2a5a2a','--progress-fill':'#8bc34a','--accent':'#c5a028','--blush-light':'#1a2e1a','--mauve-light':'#0e1a0e','--badge-tbr-bg':'#1a2e1a','--badge-tbr-text':'#8bc34a','--badge-reading-bg':'#2a3a10','--badge-reading-text':'#c5e080','--badge-read-bg':'#1a2e0a','--badge-read-text':'#a5d060','--badge-dnf-bg':'#2a1a0a','--badge-dnf-text':'#d4a060','--card-radius':'2px','--pill-radius':'3px'}
  },

  {
    id:'frieren', name:"Frieren: Beyond Journey's End", sub:'A thousand years of magic', banner:'🧝', bannerBg:'#0a1220',
    quote:"that's why I want to know more about him, even just a little",
    fonts:{ display:'Cormorant Garamond', body:'Lato', accent:'EB Garamond' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#0a1220"/><circle cx="28" cy="20" r="10" fill="#1a2840" stroke="#7ab8f0" stroke-width="1" opacity=".9"/><text x="22" y="25" font-size="12">🧝</text><path d="M18 32 Q28 28 38 32 Q38 44 28 46 Q18 44 18 32Z" fill="#1a2840" opacity=".7"/><circle cx="20" cy="10" r="2" fill="#7ab8f0" opacity=".5"/><circle cx="44" cy="18" r="1.5" fill="#a0d0ff" opacity=".4"/><circle cx="38" cy="8" r="1" fill="#c0e8ff" opacity=".5"/><circle cx="10" cy="22" r="1" fill="#7ab8f0" opacity=".3"/></svg>`,
    vars:{'--paper':'#070e1a','--ink':'#d0e8ff','--cream':'#0a1220','--border':'#1a2840','--card-bg':'#0a1220','--header-bg':'#040810','--header-text':'#d0e8ff','--header-sub':'#7ab8f0','--nav-bg':'#070e1a','--tab-active':'#5a9ad4','--btn-primary-bg':'#2a5a8a','--btn-primary-text':'#d0e8ff','--btn-sage-bg':'#1a4a6a','--progress-fill':'#7ab8f0','--accent':'#c8a8f0','--blush-light':'#0a1828','--mauve-light':'#0a1020','--badge-tbr-bg':'#0a1828','--badge-tbr-text':'#7ab8f0','--badge-reading-bg':'#181028','--badge-reading-text':'#c8a8f0','--badge-read-bg':'#0a1828','--badge-read-text':'#a0d4ff','--badge-dnf-bg':'#1a0a28','--badge-dnf-text':'#d4a8f0','--card-radius':'12px','--pill-radius':'20px'}
  },

  {
    id:'jujutsu', name:'Jujutsu Kaisen', sub:'Cursed energy & blue', banner:'🌀', bannerBg:'#05080f',
    quote:"I'll show you what it means to have the stronger cursed technique",
    fonts:{ display:'Cinzel', body:'Nunito', accent:'Satisfy' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#05080f"/><circle cx="28" cy="28" r="18" fill="none" stroke="#4488ff" stroke-width="1.5" opacity=".6"/><circle cx="28" cy="28" r="10" fill="#0a1428" opacity=".9"/><path d="M28 10 L30 26 L28 28 L26 26 Z" fill="#4488ff" opacity=".7"/><path d="M46 28 L30 30 L28 28 L30 26 Z" fill="#ff4444" opacity=".7"/><path d="M28 46 L26 30 L28 28 L30 30 Z" fill="#4488ff" opacity=".5"/><path d="M10 28 L26 26 L28 28 L26 30 Z" fill="#ff4444" opacity=".5"/><circle cx="28" cy="28" r="3" fill="#88aaff" opacity=".9"/></svg>`,
    vars:{'--paper':'#05080f','--ink':'#e0e8ff','--cream':'#0a1020','--border':'#1a2440','--card-bg':'#0a1020','--header-bg':'#020408','--header-text':'#e0e8ff','--header-sub':'#4488ff','--nav-bg':'#05080f','--tab-active':'#4488ff','--btn-primary-bg':'#1a44cc','--btn-primary-text':'#e0e8ff','--btn-sage-bg':'#cc1a1a','--progress-fill':'#4488ff','--accent':'#ff4444','--blush-light':'#0a1428','--mauve-light':'#0a0814','--badge-tbr-bg':'#0a1428','--badge-tbr-text':'#4488ff','--badge-reading-bg':'#280a0a','--badge-reading-text':'#ff8888','--badge-read-bg':'#0a1428','--badge-read-text':'#88aaff','--badge-dnf-bg':'#1a0a0a','--badge-dnf-text':'#ff6666','--card-radius':'6px','--pill-radius':'6px'}
  },

  {
    id:'spiritedaway', name:'Spirited Away', sub:'The spirit bathhouse', banner:'🏮', bannerBg:'#1a0a20',
    quote:"once you've met someone you never really forget them",
    fonts:{ display:'Quicksand', body:'Nunito', accent:'Pacifico' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#1a0a20"/><rect x="20" y="8" width="16" height="28" rx="2" fill="#8b1a1a" opacity=".8"/><rect x="22" y="10" width="12" height="24" rx="1" fill="#c4302a" opacity=".7"/><rect x="18" y="34" width="20" height="4" rx="1" fill="#d4902a" opacity=".8"/><rect x="16" y="36" width="24" height="12" rx="2" fill="#8b1a1a" opacity=".6"/><circle cx="28" cy="14" r="3" fill="#ffcc44" opacity=".9"/><text x="10" y="16" font-size="8">🏮</text><text x="40" y="30" font-size="8">🏮</text></svg>`,
    vars:{'--paper':'#120810','--ink':'#ffe8c0','--cream':'#1a0a20','--border':'#3a1a30','--card-bg':'#1a0a20','--header-bg':'#0a0410','--header-text':'#ffe8c0','--header-sub':'#ffcc44','--nav-bg':'#120810','--tab-active':'#c4302a','--btn-primary-bg':'#8b1a1a','--btn-primary-text':'#ffe8c0','--btn-sage-bg':'#2a5a3a','--progress-fill':'#ffcc44','--accent':'#d4902a','--blush-light':'#2a0a18','--mauve-light':'#1a0a20','--badge-tbr-bg':'#1a2a1a','--badge-tbr-text':'#90d490','--badge-reading-bg':'#2a1a08','--badge-reading-text':'#ffcc44','--badge-read-bg':'#2a0808','--badge-read-text':'#ff9090','--badge-dnf-bg':'#1a0a18','--badge-dnf-text':'#d490d0','--card-radius':'10px','--pill-radius':'16px'}
  },

  // ── BOOK-INSPIRED THEMES ───────────────────────────────────────────

  {
    id:'harrypotter', name:'Hogwarts Library', sub:'Spells & candlelight', banner:'⚡', bannerBg:'#0e0a18',
    quote:"books are a kind of magic only the open-minded can appreciate",
    fonts:{ display:'Cinzel', body:'Lato', accent:'EB Garamond' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#0e0a18"/><path d="M28 10 L30 14 L28 12 L26 14 Z" fill="#f0c040" stroke="#f0c040" stroke-width="1"/><rect x="14" y="16" width="28" height="28" rx="2" fill="#1a1430" opacity=".9"/><rect x="16" y="18" width="24" height="24" rx="1" fill="#0e0a18" opacity=".8"/><rect x="20" y="24" width="16" height="1.5" rx="1" fill="#f0c040" opacity=".6"/><rect x="20" y="28" width="12" height="1.5" rx="1" fill="#f0c040" opacity=".4"/><rect x="20" y="32" width="14" height="1.5" rx="1" fill="#f0c040" opacity=".3"/><path d="M26 8 L28 4 L30 8 Z" fill="#f0c040" opacity=".8"/></svg>`,
    vars:{'--paper':'#0e0a18','--ink':'#f0e8d0','--cream':'#1a1430','--border':'#2a2048','--card-bg':'#1a1430','--header-bg':'#080610','--header-text':'#f0e8d0','--header-sub':'#c8a840','--nav-bg':'#0e0a18','--tab-active':'#c8a840','--btn-primary-bg':'#5a1a8a','--btn-primary-text':'#f0e8d0','--btn-sage-bg':'#1a5a1a','--progress-fill':'#c8a840','--accent':'#c8a840','--blush-light':'#1a1040','--mauve-light':'#100a28','--badge-tbr-bg':'#1a2a1a','--badge-tbr-text':'#90d490','--badge-reading-bg':'#2a1a08','--badge-reading-text':'#ffcc80','--badge-read-bg':'#1a0a2a','--badge-read-text':'#c090ff','--badge-dnf-bg':'#2a0808','--badge-dnf-text':'#ff9090','--card-radius':'6px','--pill-radius':'8px'}
  },

  {
    id:'prideandprejudice', name:'Regency Romance', sub:'Jane Austen & drawing rooms', banner:'🌹', bannerBg:'#f5f0e8',
    quote:"it is a truth universally acknowledged",
    fonts:{ display:'Cormorant Garamond', body:'Lato', accent:'Dancing Script' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#f5f0e8"/><rect x="14" y="12" width="20" height="28" rx="3" fill="#c4a882" opacity=".7"/><rect x="16" y="14" width="16" height="24" rx="2" fill="#f5f0e8" opacity=".9"/><rect x="19" y="20" width="10" height="1" rx=".5" fill="#8a6840" opacity=".5"/><rect x="19" y="23" width="8" height="1" rx=".5" fill="#8a6840" opacity=".4"/><text x="35" y="22" font-size="11">🌹</text><path d="M34 30 Q40 26 44 32" stroke="#c4a882" stroke-width="1.5" fill="none" opacity=".6"/></svg>`,
    vars:{'--paper':'#faf6ee','--ink':'#2a1a0a','--cream':'#f0e8d8','--border':'#d4c0a0','--card-bg':'#ffffff','--header-bg':'#5a3a1a','--header-text':'#faf6ee','--header-sub':'#d4c0a0','--nav-bg':'#f0e8d8','--tab-active':'#8a4a30','--btn-primary-bg':'#8a4a30','--btn-primary-text':'#faf6ee','--btn-sage-bg':'#6a8a4a','--progress-fill':'#8a4a30','--accent':'#c4507a','--blush-light':'#f0d8c8','--mauve-light':'#e8d8e0','--badge-tbr-bg':'#d8e8d0','--badge-tbr-text':'#2a4a2a','--badge-reading-bg':'#f8e8c8','--badge-reading-text':'#5a3a08','--badge-read-bg':'#f0d8c8','--badge-read-text':'#6a2a18','--badge-dnf-bg':'#f0d8d8','--badge-dnf-text':'#6a1818','--card-radius':'12px','--pill-radius':'20px'}
  },

  {
    id:'neverendingstory', name:'The Neverending Story', sub:'Fantastica & Auryn', banner:'🐉', bannerBg:'#0a0e18',
    quote:"turn the page",
    fonts:{ display:'Cinzel', body:'Quicksand', accent:'Pacifico' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#0a0e18"/><path d="M28 14 C20 14 14 20 14 28 C14 36 20 42 28 42 C36 42 42 36 42 28 C42 20 36 14 28 14" stroke="#d4a840" stroke-width="2" fill="none" opacity=".8"/><path d="M28 14 C36 14 42 20 42 28" stroke="#8a2a2a" stroke-width="2" fill="none" opacity=".8"/><circle cx="28" cy="28" r="6" fill="#1a1428" stroke="#d4a840" stroke-width="1" opacity=".9"/><circle cx="28" cy="28" r="3" fill="#d4a840" opacity=".6"/></svg>`,
    vars:{'--paper':'#0a0e18','--ink':'#e8d8b0','--cream':'#121828','--border':'#2a2a3e','--card-bg':'#121828','--header-bg':'#060810','--header-text':'#e8d8b0','--header-sub':'#d4a840','--nav-bg':'#0a0e18','--tab-active':'#d4a840','--btn-primary-bg':'#8a2a2a','--btn-primary-text':'#e8d8b0','--btn-sage-bg':'#1a4a6a','--progress-fill':'#d4a840','--accent':'#d4a840','--blush-light':'#1a1020','--mauve-light':'#0e0818','--badge-tbr-bg':'#0a1428','--badge-tbr-text':'#80c0e0','--badge-reading-bg':'#1a1008','--badge-reading-text':'#d4a840','--badge-read-bg':'#1a0808','--badge-read-text':'#e08080','--badge-dnf-bg':'#100a18','--badge-dnf-text':'#c0a0e0','--card-radius':'50px','--pill-radius':'50px'}
  },

  {
    id:'stardust', name:'Stardust', sub:'Fallen stars & fairy markets', banner:'⭐', bannerBg:'#08061a',
    quote:"if there's one thing I've learned, it's this: wherever you go, there you are",
    fonts:{ display:'Cormorant Garamond', body:'Nunito', accent:'Dancing Script' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#08061a"/><circle cx="28" cy="24" r="10" fill="#1a1438" opacity=".8"/><path d="M28 14 L30 20 L28 18 L26 20 Z" fill="#f0d060" opacity=".9"/><circle cx="28" cy="24" r="4" fill="#f0d060" opacity=".5"/><circle cx="14" cy="12" r="1" fill="#e0c8f0" opacity=".6"/><circle cx="44" cy="10" r="1.5" fill="#f0d060" opacity=".5"/><circle cx="40" cy="36" r="1" fill="#e0c8f0" opacity=".4"/><circle cx="10" cy="32" r="1" fill="#f0d060" opacity=".3"/><circle cx="48" cy="42" r="1" fill="#e0c8f0" opacity=".5"/><path d="M20 38 Q28 32 36 38" stroke="#e0c8f0" stroke-width="1" fill="none" opacity=".4"/></svg>`,
    vars:{'--paper':'#08061a','--ink':'#e8e0ff','--cream':'#100e28','--border':'#201c3e','--card-bg':'#100e28','--header-bg':'#040210','--header-text':'#e8e0ff','--header-sub':'#f0d060','--nav-bg':'#08061a','--tab-active':'#a060e0','--btn-primary-bg':'#6030b0','--btn-primary-text':'#e8e0ff','--btn-sage-bg':'#206080','--progress-fill':'#f0d060','--accent':'#f0d060','--blush-light':'#180e2a','--mauve-light':'#100818','--badge-tbr-bg':'#0a1428','--badge-tbr-text':'#80d0f0','--badge-reading-bg':'#1a1008','--badge-reading-text':'#f0d060','--badge-read-bg':'#180e2a','--badge-read-text':'#d0a0f0','--badge-dnf-bg':'#1a0818','--badge-dnf-text':'#f0a0c0','--card-radius':'20px','--pill-radius':'30px'}
  },

  // ── POP CULTURE THEMES ─────────────────────────────────────────────

  {
    id:'strangerthings', name:'Stranger Things', sub:'The Upside Down', banner:'🔦', bannerBg:'#020408',
    quote:"mornings are for coffee and contemplation",
    fonts:{ display:'Cinzel', body:'Josefin Sans', accent:'Satisfy' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#020408"/><text x="14" y="34" font-size="28" opacity=".8">🔦</text><circle cx="34" cy="16" r="6" fill="none" stroke="#cc0000" stroke-width="1.5" opacity=".7"/><path d="M28 16 L34 10 M34 10 L40 16 M34 10 L34 4" stroke="#cc0000" stroke-width="1" opacity=".5"/><circle cx="14" cy="12" r="1" fill="#cc0000" opacity=".4"/><circle cx="44" cy="40" r="1" fill="#cc0000" opacity=".3"/></svg>`,
    vars:{'--paper':'#020408','--ink':'#e0d0c0','--cream':'#080c10','--border':'#1a1a28','--card-bg':'#080c10','--header-bg':'#010204','--header-text':'#e0d0c0','--header-sub':'#cc3300','--nav-bg':'#020408','--tab-active':'#cc3300','--btn-primary-bg':'#aa2200','--btn-primary-text':'#e0d0c0','--btn-sage-bg':'#1a3a1a','--progress-fill':'#cc3300','--accent':'#cc3300','--blush-light':'#100808','--mauve-light':'#080410','--badge-tbr-bg':'#0a1a0a','--badge-tbr-text':'#80d080','--badge-reading-bg':'#1a0a04','--badge-reading-text':'#ffa060','--badge-read-bg':'#1a0404','--badge-read-text':'#ff8080','--badge-dnf-bg':'#0a0414','--badge-dnf-text':'#a080c0','--card-radius':'0px','--pill-radius':'2px'}
  },

  {
    id:'gameofthrones', name:'Westeros', sub:'Fire & blood', banner:'👑', bannerBg:'#0e0a04',
    quote:"when you play the game of thrones, you win or you die",
    fonts:{ display:'Cinzel', body:'Lato', accent:'EB Garamond' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#0e0a04"/><path d="M28 8 L32 18 L44 18 L34 25 L38 36 L28 29 L18 36 L22 25 L12 18 L24 18 Z" fill="#c8920a" opacity=".7"/><path d="M28 12 L31 19 L40 19 L33 24 L36 32 L28 27 L20 32 L23 24 L16 19 L25 19 Z" fill="#8a1a1a" opacity=".6"/><text x="22" y="28" font-size="10">👑</text></svg>`,
    vars:{'--paper':'#0e0a04','--ink':'#e8d8b0','--cream':'#1a1408','--border':'#3a2a10','--card-bg':'#1a1408','--header-bg':'#060400','--header-text':'#e8d8b0','--header-sub':'#c8920a','--nav-bg':'#0e0a04','--tab-active':'#c8920a','--btn-primary-bg':'#8a1a1a','--btn-primary-text':'#e8d8b0','--btn-sage-bg':'#1a3a1a','--progress-fill':'#c8920a','--accent':'#c8920a','--blush-light':'#1a1008','--mauve-light':'#100808','--badge-tbr-bg':'#0a1a0a','--badge-tbr-text':'#90d490','--badge-reading-bg':'#1a1004','--badge-reading-text':'#c8920a','--badge-read-bg':'#1a0808','--badge-read-text':'#ff9090','--badge-dnf-bg':'#100810','--badge-dnf-text':'#c090c0','--card-radius':'4px','--pill-radius':'4px'}
  },

  {
    id:'thewitcher', name:'The Witcher', sub:'Toss a coin', banner:'🐺', bannerBg:'#0a100a',
    quote:"evil is evil — lesser, greater, middling — it's all the same",
    fonts:{ display:'Cinzel', body:'Lato', accent:'Satisfy' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#0a100a"/><circle cx="28" cy="24" r="12" fill="#141e14" stroke="#c8c0a0" stroke-width="1" opacity=".8"/><path d="M22 20 L28 12 L34 20" stroke="#c8c0a0" stroke-width="1.5" fill="none" opacity=".7"/><circle cx="28" cy="24" r="4" fill="#c8c0a0" opacity=".3"/><path d="M24 28 L28 34 L32 28" stroke="#c8c0a0" stroke-width="1" fill="none" opacity=".5"/><text x="38" y="42" font-size="10">🐺</text></svg>`,
    vars:{'--paper':'#0a100a','--ink':'#d8d0b0','--cream':'#121810','--border':'#2a3020','--card-bg':'#121810','--header-bg':'#060a06','--header-text':'#d8d0b0','--header-sub':'#c8c0a0','--nav-bg':'#0a100a','--tab-active':'#c8a840','--btn-primary-bg':'#3a5a1a','--btn-primary-text':'#d8d0b0','--btn-sage-bg':'#1a3a4a','--progress-fill':'#c8a840','--accent':'#c8a840','--blush-light':'#141c10','--mauve-light':'#0e140e','--badge-tbr-bg':'#0e1c0e','--badge-tbr-text':'#90d090','--badge-reading-bg':'#1c1808','--badge-reading-text':'#d8c080','--badge-read-bg':'#1a1c10','--badge-read-text':'#b0c890','--badge-dnf-bg':'#1c0e0e','--badge-dnf-text':'#d09090','--card-radius':'4px','--pill-radius':'6px'}
  },

  {
    id:'lotr', name:'Middle Earth', sub:'One book to rule them all', banner:'💍', bannerBg:'#080e04',
    quote:"not all those who wander are lost",
    fonts:{ display:'Cinzel', body:'Lato', accent:'EB Garamond' },
    illus:`<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="56" fill="#080e04"/><path d="M28 8 Q44 8 44 28 Q44 48 28 48 Q12 48 12 28 Q12 8 28 8Z" fill="none" stroke="#c8a840" stroke-width="1.5" opacity=".6"/><path d="M28 14 Q38 14 38 28 Q38 42 28 42 Q18 42 18 28 Q18 14 28 14Z" fill="#0e1808" opacity=".8"/><circle cx="28" cy="28" r="6" fill="none" stroke="#c8a840" stroke-width="1" opacity=".5"/><text x="34" y="18" font-size="9">💍</text><circle cx="16" cy="14" r="2" fill="#60a840" opacity=".4"/><circle cx="42" cy="40" r="2" fill="#60a840" opacity=".4"/></svg>`,
    vars:{'--paper':'#080e04','--ink':'#e0d8b8','--cream':'#101808','--border':'#2a3818','--card-bg':'#101808','--header-bg':'#040800','--header-text':'#e0d8b8','--header-sub':'#a0c870','--nav-bg':'#080e04','--tab-active':'#c8a840','--btn-primary-bg':'#3a5a1a','--btn-primary-text':'#e0d8b8','--btn-sage-bg':'#1a4a2a','--progress-fill':'#c8a840','--accent':'#c8a840','--blush-light':'#101c08','--mauve-light':'#0c1808','--badge-tbr-bg':'#0e1c0a','--badge-tbr-text':'#a0d870','--badge-reading-bg':'#1c1804','--badge-reading-text':'#d8c060','--badge-read-bg':'#0e1c08','--badge-read-text':'#88c060','--badge-dnf-bg':'#1c0c04','--badge-dnf-text':'#d09060','--card-radius':'2px','--pill-radius':'4px'}
  },
];

const DISPLAY_FONTS = [
  { family:'Playfair Display', preview:'A Tale of Ink & Pages' },
  { family:'Cormorant Garamond', preview:'Elegance in Every Line' },
  { family:'Libre Baskerville', preview:'Classic Bookseller Charm' },
  { family:'Cinzel', preview:'ANCIENT LETTERS REVIVED' },
  { family:'Quicksand', preview:'Soft and Rounded Beauty' },
  { family:'EB Garamond', preview:'Timeless Scholar Type' },
];
const BODY_FONTS = [
  { family:'Lato', preview:'Clean, readable, modern' },
  { family:'Nunito', preview:'Friendly and rounded' },
  { family:'Josefin Sans', preview:'Geometric and elegant' },
  { family:'Quicksand', preview:'Soft and approachable' },
];
const ACCENT_FONTS = [
  { family:'Dancing Script', preview:'A flourish of romance' },
  { family:'Satisfy', preview:'Effortlessly chic' },
  { family:'Pacifico', preview:'Carefree and bold' },
  { family:'EB Garamond', preview:'Italics for the soul' },
];
const COLOR_FIELDS = [
  { key:'--paper', label:'Page BG' },{ key:'--ink', label:'Text' },
  { key:'--cream', label:'Secondary BG' },{ key:'--card-bg', label:'Card BG' },
  { key:'--border', label:'Borders' },{ key:'--header-bg', label:'Header BG' },
  { key:'--header-text', label:'Header Text' },{ key:'--nav-bg', label:'Nav BG' },
  { key:'--tab-active', label:'Active Tab' },{ key:'--btn-primary-bg', label:'Primary Btn' },
  { key:'--btn-primary-text', label:'Btn Text' },{ key:'--btn-sage-bg', label:'Secondary Btn' },
  { key:'--progress-fill', label:'Progress Bar' },{ key:'--accent', label:'Accent' },
  { key:'--badge-tbr-bg', label:'TBR Badge BG' },{ key:'--badge-tbr-text', label:'TBR Text' },
  { key:'--badge-reading-bg', label:'Reading BG' },{ key:'--badge-reading-text', label:'Reading Text' },
  { key:'--badge-read-bg', label:'Read BG' },{ key:'--badge-read-text', label:'Read Text' },
];
const ICON_EMOJIS = ['📚','📖','🌸','🕯️','✨','🦋','🌊','🌿','🌙','💜','☕','🌈','⭐','🌺','🍂','❄️','🔮','🌻','🦚','🏰','🌷','🍵','🎀','✦','🪄','🌟','🦄'];

// Style state
let activeAesthetic = 'cozy';
let activeFonts = { display:'Playfair Display', body:'Lato', accent:'Dancing Script' };

// In-memory CSS variable cache — single source of truth.
// Avoids relying on getComputedStyle which has timing/cascade issues.
const _cssVarCache = {};

function getCSSVar(k) {
  // Return cached value first, fall back to computed style
  return _cssVarCache[k] !== undefined
    ? _cssVarCache[k]
    : getComputedStyle(document.documentElement).getPropertyValue(k).trim();
}
function setCSSVar(k, v) {
  _cssVarCache[k] = v;
  document.documentElement.style.setProperty(k, v);
}
function applyVars(vars) {
  Object.entries(vars).forEach(([k, v]) => setCSSVar(k, v));
}
function applyFonts(f) {
  activeFonts = { ...activeFonts, ...f };
  setCSSVar('--font-display', `'${activeFonts.display}',serif`);
  setCSSVar('--font-body',    `'${activeFonts.body}',sans-serif`);
  setCSSVar('--font-accent',  `'${activeFonts.accent}',cursive`);
}
function getAllAesthetics() { return [...BUILTIN_AESTHETICS, ...getCustomAesthetics()]; }
function getCustomAesthetics() { try { return JSON.parse(localStorage.getItem(SK_CUSTOM_AE)) || []; } catch { return []; } }
function saveCustomAesthetics(a) { localStorage.setItem(SK_CUSTOM_AE, JSON.stringify(a)); }

function applyAesthetic(id) {
  const a = getAllAesthetics().find(x => x.id === id);
  if (!a) return;
  activeAesthetic = id;
  applyVars(a.vars);
  if (a.fonts) applyFonts(a.fonts);
  document.getElementById('header-illus').innerHTML = a.illus || '📚';
  document.getElementById('header-sub').textContent  = a.quote || 'your reading life, all in one place';
  persistStyle();
}

function getCurrentVars() {
  // Reads from in-memory cache — always accurate, no timing dependency
  const v = {};
  COLOR_FIELDS.forEach(f => { v[f.key] = getCSSVar(f.key); });
  ['--blush-light','--mauve-light','--card-radius','--pill-radius'].forEach(k => { v[k] = getCSSVar(k); });
  return v;
}

function persistStyle() {
  localStorage.setItem(SK_STYLE, JSON.stringify({ aesthetic: activeAesthetic, fonts: activeFonts }));
  localStorage.setItem(SK_THEME_VARS, JSON.stringify(getCurrentVars()));
  writeAutosave();
  // Background cloud sync of settings
  if (useCloud()) {
    const settings = {};
    ALL_SETTINGS_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) settings[k] = v;
    });
    apiFetch('/api/settings/bulk', { method: 'POST', body: JSON.stringify({ settings }) })
      .catch(() => {});
  }
}

function loadStyle() {
  try {
    const vars = JSON.parse(localStorage.getItem(SK_THEME_VARS));
    if (vars) applyVars(vars);
    const s = JSON.parse(localStorage.getItem(SK_STYLE));
    if (s) {
      activeAesthetic = s.aesthetic || 'cozy';
      activeFonts = s.fonts || activeFonts;
      applyFonts(activeFonts);
      const a = getAllAesthetics().find(x => x.id === activeAesthetic);
      if (a) {
        document.getElementById('header-illus').innerHTML = a.illus || '📚';
        document.getElementById('header-sub').textContent  = a.quote || '';
      }
    }
  } catch(e) {
    console.warn('[Style] loadStyle failed:', e);
  }
}

async function recoverSettingsFromCloud() {
  // Called in init when localStorage has no theme/settings
  // Pulls settings back from D1 and restores them
  if (!useCloud()) return;
  try {
    const cloudSettings = await apiFetch('/api/settings');
    if (cloudSettings && Object.keys(cloudSettings).length > 0) {
      Object.entries(cloudSettings).forEach(([k, v]) => localStorage.setItem(k, v));
      console.log('[Settings] Recovered', Object.keys(cloudSettings).length, 'settings from cloud');
      loadStyle();        // re-apply theme
      applyNavConfig();   // re-apply nav
      loadShelfConfig();  // re-apply shelf
    }
  } catch(e) {
    console.warn('[Settings] Cloud recovery failed:', e.message);
  }
}

function getSavedThemes() { try { return JSON.parse(localStorage.getItem(SK_SAVED_THEMES)) || []; } catch { return []; } }
function setSavedThemes(t) { localStorage.setItem(SK_SAVED_THEMES, JSON.stringify(t)); }

let activeSubTab = 'aesthetics';

function openSettings() {
  renderSubPanel(activeSubTab);
  document.getElementById('settings-modal').classList.add('open');
}

function switchTopTab(tab, el) {
  document.querySelectorAll('.studio-top-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.studio-top-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const panelId = tab === 'themes' ? 'stp-themes' : 'stp-app';
  document.getElementById(panelId).classList.add('active');
  // When opening App Settings, render the nav panel immediately
  if (tab === 'app') {
    const p = document.getElementById('sp-nav');
    if (p) p.innerHTML = renderNavSettings();
  }
}

function switchSubTab(tab, el) {
  activeSubTab = tab;
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('sp-' + tab).classList.add('active');
  renderSubPanel(tab);
}

function renderSubPanel(tab) {
  if (tab === 'aesthetics') renderAesthetics();
  else if (tab === 'create')     renderCreate();
  else if (tab === 'fonts')      renderFonts();
  else if (tab === 'colors')     renderColors();
  else if (tab === 'saved')      renderSaved();
  else if (tab === 'nav')        { const p=document.getElementById('sp-nav'); if(p) p.innerHTML=renderNavSettings(); }
  else if (tab === 'shelf')      { const p=document.getElementById('sp-shelf'); if(p) p.innerHTML=renderShelfSettings(); }
  else if (tab === 'search')     { const p=document.getElementById('sp-search'); if(p) p.innerHTML=renderSearchSettings(); }
}

function renderAesthetics() {
  const all = getAllAesthetics();
  const chips = all.map(a => {
    const isCustom = !BUILTIN_AESTHETICS.find(b => b.id === a.id);
    return `<div class="aesthetic-chip ${activeAesthetic === a.id ? 'selected' : ''}" onclick="applyAesthetic('${a.id}');renderAesthetics()">
      ${isCustom ? '<div class="chip-badge">custom</div>' : ''}
      <div class="aesthetic-chip-icon" style="background:${a.bannerBg || '#f5f0eb'}">
        ${a.illus
          ? `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center">${a.illus}</div>`
          : `<span style="font-size:1.8rem">${a.banner || '📚'}</span>`}
      </div>
      <div class="aesthetic-chip-body" style="background:${a.vars?.['--paper']||'#fff'};color:${a.vars?.['--ink']||'#222'}">
        <div class="aesthetic-chip-name" style="font-family:'${a.fonts?.display||'Playfair Display'}',serif">${esc(a.name)}</div>
        <div class="aesthetic-chip-sub">${esc(a.sub || '')}</div>
      </div>
    </div>`;
  }).join('');

  const customs = getCustomAesthetics();
  const editSection = customs.length ? `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
    ${customs.map((a,i) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;background:var(--cream);border-radius:9px;padding:7px 10px;border:1px solid var(--border)">
      <span style="font-size:.82rem;font-weight:700;flex:1;font-family:var(--font-display)">${esc(a.name)}</span>
      <button class="btn btn-ghost btn-xs" onclick="openEditCA(${i})">✏️</button>
      <button class="btn btn-xs" style="background:#f0e0e0;color:#8a3030" onclick="deleteCA(${i})">✕</button>
    </div>`).join('')}
  </div>` : '';

  document.getElementById('sp-aesthetics').innerHTML = `
    <p style="font-size:.76rem;color:#8a7060;margin-bottom:11px;line-height:1.5">Pick an aesthetic to set the full look — fonts, colours, icon, everything.</p>
    <div class="aesthetic-grid">${chips}</div>${editSection}`;
}

function renderCreate() {
  const customs = getCustomAesthetics();
  document.getElementById('sp-create').innerHTML = `
    <p style="font-size:.76rem;color:#8a7060;margin-bottom:12px;line-height:1.5">Design your own aesthetic — pick colours, icon, and a custom quote.</p>
    <button class="btn btn-primary btn-sm" onclick="openNewCA()">✏️ Create New Aesthetic</button>
    ${customs.length === 0 ? `<p style="font-size:.76rem;color:#b0988a;font-style:italic;margin-top:10px">No custom aesthetics yet.</p>` : ''}`;
}

function renderFonts() {
  const mkSection = (label, fonts, cur, fn) => `
    <div class="font-category">
      <div class="font-category-label">${label}</div>
      <div class="font-grid">
        ${[...fonts, ...customFonts.map(f => ({ family:f.name, preview:'My uploaded font ✦', custom:true }))].map(f =>
          `<div class="font-option ${cur===f.family?'selected':''}" onclick="${fn}('${f.family.replace(/'/g,"\\'")}')">
            <div class="font-option-preview" style="font-family:'${f.family}',serif">${esc(f.preview)}</div>
            <div class="font-option-meta">${esc(f.family)}${f.custom ? ' · uploaded' : ''}</div>
          </div>`
        ).join('')}
      </div>
    </div>`;

  const tags = customFonts.map(f =>
    `<span class="custom-font-tag"><span style="font-family:'${f.name}'">${esc(f.name)}</span><span class="tag-del" onclick="deleteCustomFont('${esc(f.name)}')">✕</span></span>`
  ).join('');

  document.getElementById('sp-fonts').innerHTML = `
    <div class="font-upload-zone" onclick="document.getElementById('ffi').click()">
      <div style="font-size:1.6rem">🔤</div>
      <div style="font-size:.82rem;font-weight:700;color:var(--ink);margin-top:4px">Upload a Custom Font</div>
      <p>.ttf · .otf · .woff · .woff2 — stored in IndexedDB, survives redeployments</p>
      <input type="file" id="ffi" accept=".ttf,.otf,.woff,.woff2" style="display:none" onchange="handleFU(event)"/>
    </div>
    ${customFonts.length ? `<div style="margin-bottom:12px">${tags}</div>` : ''}
    ${mkSection('Display / Headings', DISPLAY_FONTS, activeFonts.display, 'setDF')}
    ${mkSection('Body Text', BODY_FONTS, activeFonts.body, 'setBF')}
    ${mkSection('Accent / Subtitle', ACCENT_FONTS, activeFonts.accent, 'setAF')}`;
}

async function handleFU(e) {
  const f = e.target.files[0]; if (!f) return;
  try { await uploadFont(f); renderFonts(); }
  catch { showToast('Font upload failed.'); }
  e.target.value = '';
}
function setDF(f) { activeFonts.display = f; setCSSVar('--font-display', `'${f}',serif`); persistStyle(); renderFonts(); showToast('Display font updated!'); }
function setBF(f) { activeFonts.body    = f; setCSSVar('--font-body',    `'${f}',sans-serif`); persistStyle(); renderFonts(); showToast('Body font updated!'); }
function setAF(f) { activeFonts.accent  = f; setCSSVar('--font-accent',  `'${f}',cursive`); persistStyle(); renderFonts(); showToast('Accent font updated!'); }

function renderColors() {
  const pickers = COLOR_FIELDS.map(f => {
    const hex = rgbToHex(getCSSVar(f.key) || '#888888');
    const sid = 'sw_' + f.key.replace(/--/g,'').replace(/-/g,'_');
    return `<div class="color-row">
      <label>${esc(f.label)}</label>
      <div class="color-swatch-btn" style="background:${hex}" id="${sid}">
        <input type="color" value="${hex}" data-var="${f.key}" oninput="liveColor(this)" onchange="liveColor(this)"/>
      </div>
    </div>`;
  }).join('');

  document.getElementById('sp-colors').innerHTML = `
    <p style="font-size:.75rem;color:#8a7060;margin-bottom:11px;line-height:1.5">Click any swatch to change it — the app updates live.</p>
    <div class="color-pickers-grid">${pickers}</div>
    <div class="divider"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input type="text" id="tni" placeholder="Name this colour scheme…" style="flex:1;min-width:110px;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;font-family:var(--font-body);font-size:.84rem;background:var(--card-bg);color:var(--ink);outline:none"/>
      <button class="btn btn-primary btn-sm" onclick="saveCT()">💾 Save</button>
      <button class="btn btn-ghost btn-sm" onclick="resetDef()">↺ Reset</button>
    </div>`;
}

function liveColor(input) {
  const v = input.dataset.var, val = input.value;
  setCSSVar(v, val);
  const sid = 'sw_' + v.replace(/--/g,'').replace(/-/g,'_');
  const sw = document.getElementById(sid);
  if (sw) sw.style.background = val;
  persistStyle();
}

function saveCT() {
  const name = (document.getElementById('tni').value || '').trim();
  if (!name) { showToast('Enter a name first.'); return; }
  const t = getSavedThemes();
  t.push({ name, vars: getCurrentVars(), fonts: { ...activeFonts }, aesthetic: activeAesthetic });
  setSavedThemes(t);
  showToast(`"${name}" saved!`);
  renderSaved();
}

function resetDef() { applyAesthetic('cozy'); renderColors(); showToast('Reset to Cozy Library!'); }

function renderSaved() {
  const t = getSavedThemes();
  const list = t.length
    ? t.map((th, i) => `<div class="saved-theme-row">
        <div class="saved-theme-swatches">
          ${['--header-bg','--btn-primary-bg','--paper','--accent'].map(k =>
            `<div class="saved-theme-swatch" style="background:${th.vars?.[k]||'#888'}"></div>`
          ).join('')}
        </div>
        <div class="saved-theme-name">${esc(th.name)}</div>
        <div class="saved-theme-actions">
          <button class="btn btn-primary btn-xs" onclick="applyS(${i})">Apply</button>
          <button class="btn btn-xs" style="background:#f0e0e0;color:#8a3030" onclick="delS(${i})">✕</button>
        </div>
      </div>`).join('')
    : `<p style="font-size:.77rem;color:#b0988a;font-style:italic">No saved themes yet. Customise your colours and save here.</p>`;

  document.getElementById('sp-saved').innerHTML = `
    <p style="font-size:.76rem;color:#8a7060;margin-bottom:11px;line-height:1.5">Your saved colour + font combinations.</p>
    <div class="saved-themes-list">${list}</div>`;
}

function applyS(i) {
  const t = getSavedThemes()[i]; if (!t) return;
  applyVars(t.vars);
  if (t.fonts) applyFonts(t.fonts);
  if (t.aesthetic) activeAesthetic = t.aesthetic;
  persistStyle();
  renderSubPanel(activeSubTab);
  showToast(`"${t.name}" applied!`);
}
function delS(i) {
  const t = getSavedThemes();
  const n = t[i]?.name || 'Theme';
  t.splice(i, 1); setSavedThemes(t);
  renderSaved();
  showToast(`"${n}" deleted.`);
}

function rgbToHex(c) {
  if (!c) return '#888888';
  c = c.trim();
  if (c.startsWith('#')) return c.length === 4 ? '#'+c[1]+c[1]+c[2]+c[2]+c[3]+c[3] : c.slice(0,7);
  const m = c.match(/\d+/g);
  if (!m || m.length < 3) return '#888888';
  return '#' + [m[0],m[1],m[2]].map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}

// ═══════════════════════════════════════
// CUSTOM AESTHETIC BUILDER
// ═══════════════════════════════════════
let caState = { name:'', sub:'', quote:'', bannerBg:'#f5ede0', topColor:'#3a2a14', bottomColor:'#D4967A', emoji:'📚', editIdx:-1 };

function buildCustomIllus(top, bot, emoji) {
  return `<svg width="56" height="56" viewBox="0 0 56 56" fill="none"><rect x="0" y="0" width="56" height="28" fill="${top}"/><rect x="0" y="28" width="56" height="28" fill="${bot}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="22">${emoji}</text></svg>`;
}

function openNewCA() {
  caState = { name:'', sub:'', quote:'', bannerBg:'#f5ede0', topColor:'#3a2a14', bottomColor:'#D4967A', emoji:'📚', editIdx:-1 };
  document.getElementById('ca-modal-title').textContent = '✏️ Create Aesthetic';
  renderCAModal();
  document.getElementById('create-aesthetic-modal').classList.add('open');
}

function openEditCA(i) {
  const a = getCustomAesthetics()[i];
  caState = { name:a.name, sub:a.sub||'', quote:a.quote||'', bannerBg:a.bannerBg||'#f5ede0', topColor:a.topColor||'#3a2a14', bottomColor:a.bottomColor||'#D4967A', emoji:a.banner||'📚', editIdx:i };
  document.getElementById('ca-modal-title').textContent = '✏️ Edit Aesthetic';
  renderCAModal();
  document.getElementById('create-aesthetic-modal').classList.add('open');
}

function renderCAModal() {
  const illus = buildCustomIllus(caState.topColor, caState.bottomColor, caState.emoji);
  const emojiOpts = ICON_EMOJIS.map(e =>
    `<span class="emoji-opt ${caState.emoji === e ? 'selected' : ''}" onclick="caSetEmoji('${e}')">${e}</span>`
  ).join('');

  document.getElementById('ca-modal-body').innerHTML = `
    <div class="icon-preview-wrap"><div class="icon-preview-canvas" id="ca-preview">${illus}</div></div>
    <div class="form-group"><label>Aesthetic Name *</label><input type="text" id="ca-name" value="${esc(caState.name)}" placeholder="e.g. Cherry Blossom" oninput="caState.name=this.value"/></div>
    <div class="form-group"><label>Subtitle</label><input type="text" id="ca-sub" value="${esc(caState.sub)}" placeholder="e.g. dreamy & floral" oninput="caState.sub=this.value"/></div>
    <div class="form-group"><label>Header Quote</label><input type="text" id="ca-quote" value="${esc(caState.quote)}" placeholder="e.g. every page blooms" oninput="caState.quote=this.value"/></div>
    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;letter-spacing:.05em;text-transform:uppercase;margin-bottom:7px">Icon Colours</div>
    <div class="color-split-row">
      <label>Top Half</label>
      <div class="color-swatch-btn" id="ca-top-sw" style="background:${caState.topColor}">
        <input type="color" value="${caState.topColor}" oninput="caState.topColor=this.value;caUpdatePreview();document.getElementById('ca-top-sw').style.background=this.value"/>
      </div>
    </div>
    <div class="color-split-row">
      <label>Bottom Half</label>
      <div class="color-swatch-btn" id="ca-bot-sw" style="background:${caState.bottomColor}">
        <input type="color" value="${caState.bottomColor}" oninput="caState.bottomColor=this.value;caUpdatePreview();document.getElementById('ca-bot-sw').style.background=this.value"/>
      </div>
    </div>
    <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Center Icon</div>
    <div class="emoji-picker-row">${emojiOpts}</div>
    <div class="row-btns">
      <button class="btn btn-primary" onclick="saveCA()">💾 Save Aesthetic</button>
      <button class="btn btn-ghost" onclick="closeModal('create-aesthetic-modal')">Cancel</button>
    </div>`;
}

function caSetEmoji(e) {
  caState.emoji = e;
  document.querySelectorAll('#ca-modal-body .emoji-opt').forEach(el => el.classList.toggle('selected', el.textContent === e));
  caUpdatePreview();
}

function caUpdatePreview() {
  const p = document.getElementById('ca-preview');
  if (p) p.innerHTML = buildCustomIllus(caState.topColor, caState.bottomColor, caState.emoji);
}

function saveCA() {
  const name = (document.getElementById('ca-name').value || '').trim();
  if (!name) { showToast('Please enter a name.'); return; }
  const customs = getCustomAesthetics();
  const ae = {
    id:         caState.editIdx >= 0 ? customs[caState.editIdx].id : 'custom_' + Date.now(),
    name,
    sub:        caState.sub,
    quote:      caState.quote,
    banner:     caState.emoji,
    bannerBg:   caState.bannerBg,
    topColor:   caState.topColor,
    bottomColor:caState.bottomColor,
    illus:      buildCustomIllus(caState.topColor, caState.bottomColor, caState.emoji),
    fonts:      { ...activeFonts },
    vars:       getCurrentVars(),
  };
  if (caState.editIdx >= 0) {
    customs[caState.editIdx] = ae;
  } else {
    customs.push(ae);
  }
  saveCustomAesthetics(customs);
  closeModal('create-aesthetic-modal');
  showToast(`"${name}" ${caState.editIdx >= 0 ? 'updated' : 'created'}!`);
  renderAesthetics();
  renderCreate();
}

function deleteCA(i) {
  const customs = getCustomAesthetics();
  const name = customs[i]?.name || 'Aesthetic';
  if (!confirm(`Delete "${name}"?`)) return;
  customs.splice(i, 1);
  saveCustomAesthetics(customs);
  renderAesthetics();
  renderCreate();
  showToast(`"${name}" deleted.`);
}


// ═══════════════════════════════════════════════════════════════════
// MANGA — Jikan (MyAnimeList) API · No key required
// ═══════════════════════════════════════════════════════════════════

// Returns the best available display title for a manga entry:
// English title when it exists and differs from the romanized title, else romanized.
function displayTitle(m) {
  const en = (m.titleEn || '').trim();
  const raw = (m.title || '').trim();
  return (en && en.toLowerCase() !== raw.toLowerCase()) ? en : raw;
}
let manga = [];
let activeMangaFilter = 'all';
let editingMangaId = null;
let mangaRating = 0;
let mangaRatingScale = 10;

async function loadManga() {
  // localStorage is ALWAYS primary
  const raw = localStorage.getItem(SK_MANGA);
  console.log('[loadManga] SK_MANGA raw length:', raw ? raw.length : 'NULL — key does not exist');
  try {
    manga = JSON.parse(raw) || [];
    console.log('[loadManga] Parsed', manga.length, 'entries:', manga.map(m=>m.title));
  } catch(e) {
    console.error('[loadManga] Parse error:', e);
    manga = [];
  }
  // One-time migration
  let migrated = false;
  manga.forEach(m => {
    if (!Array.isArray(m.ownedVols)) {
      const upTo = m.currentVol || 0;
      m.ownedVols = upTo > 0 ? Array.from({ length: upTo }, (_, i) => i + 1) : [];
      migrated = true;
    }
  });
  if (migrated) {
    console.log('[loadManga] Migration triggered — re-saving');
    saveManga();
  }

  // If localStorage empty, try cloud recovery
  if (manga.length === 0 && useCloud()) {
    try {
      const cloudManga = await apiFetch('/api/manga');
      if (Array.isArray(cloudManga) && cloudManga.length > 0) {
        manga = cloudManga;
        localStorage.setItem(SK_MANGA, JSON.stringify(manga));
        console.log('[loadManga] Restored', manga.length, 'manga from cloud to localStorage');
      }
    } catch(e) {
      console.warn('[loadManga] Cloud recovery failed:', e.message);
    }
  }
}
function saveManga() {
  _saveInProgress = true;
  try {
    localStorage.setItem(SK_MANGA, JSON.stringify(manga));
  } catch(e) {
    console.error('[saveManga] localStorage write failed:', e.name, e.message);
    showToast('⚠️ Could not save — storage may be full.');
    _saveInProgress = false;
    return;
  }
  writeAutosave();
  _saveInProgress = false;
  // Background cloud sync
  if (useCloud()) {
    apiFetch('/api/manga/bulk', { method: 'POST', body: JSON.stringify({ manga }) })
      .catch(e => console.warn('[Cloud] manga sync failed:', e.message));
  }
}

// ── SEARCH ──────────────────────────────────────────────────────────
let mangaDebounce = null;
function debounceMangaSearch(q) {
  clearTimeout(mangaDebounce);
  if (q.length < 2) return;
  mangaDebounce = setTimeout(() => doMangaSearch(q), 350);
}

async function doMangaSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  const el = document.getElementById('manga-search-results');
  el.innerHTML = `<div style="text-align:center;padding:28px;color:#8a7060;font-style:italic;font-size:.85rem">✨ Searching MyAnimeList…</div>`;

  // Jikan v4 — free, no auth, rate limit 3 req/s. Retry once on failure.
  const url = `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(q)}&limit=15&order_by=popularity&sort=asc`;
  let resp, lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) {
        el.innerHTML = `<div style="text-align:center;padding:28px;color:#8a7060;font-style:italic;font-size:.85rem">⏳ Retrying…</div>`;
        await new Promise(r => setTimeout(r, 1200));
      }
      resp = await fetch(url);
      if (resp.status === 429) {
        // Rate limited — wait and retry
        lastError = 'Rate limited (429)';
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (!resp.ok) { lastError = `Jikan HTTP ${resp.status}`; break; }
      const data = await resp.json();
      if (!data.data || !data.data.length) {
        el.innerHTML = `<div style="text-align:center;padding:36px 20px;color:#b0988a;font-family:var(--font-display)">
          <div style="font-size:1.8rem;margin-bottom:8px">📭</div>
          <div>No manga found. Try a different title.</div>
        </div>`;
        return;
      }
      renderMangaResults(data.data, el);
      return; // success
    } catch(e) {
      lastError = e.message;
    }
  }

  // Both attempts failed
  el.innerHTML = `<div style="text-align:center;padding:28px;color:#b0988a;font-family:var(--font-display)">
    <div style="font-size:1.8rem;margin-bottom:8px">📡</div>
    <div style="font-size:.88rem;margin-bottom:6px">MyAnimeList search unavailable.</div>
    <div style="font-size:.74rem;color:#c0a090">${lastError || 'Check connection'}</div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px"
      onclick="doMangaSearch('${q.replace(/'/g, "\'")}')">↺ Try Again</button>
  </div>`;
}

// Cache keyed by index — avoids inline JSON serialisation which breaks on special chars
const _mangaResultCache = {};

function renderMangaResults(items, el) {
  Object.keys(_mangaResultCache).forEach(k => delete _mangaResultCache[k]);
  el.innerHTML = items.map((m, idx) => {
    _mangaResultCache[idx] = m;
    const cover  = m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || '';
    const score  = m.score ? `⭐ ${m.score}` : '';
    const vols   = m.volumes ? `${m.volumes} vol` : '';
    const ch     = m.chapters ? `${m.chapters} ch` : '';
    const type   = m.type || '';
    const status = m.status || '';
    const genres = (m.genres || []).slice(0,2).map(g => g.name).join(', ');
    const coverEl = cover
      ? `<img class="src-cover" src="${cover}" alt="" onerror="this.outerHTML='<div class=src-cover-ph>${esc((m.title||'').slice(0,20))}</div>'"/>`
      : `<div class="src-cover-ph">${esc((m.title||'').slice(0,20))}</div>`;
    return `<div class="search-result-card" onclick="selectMangaResult(${idx})">
      ${coverEl}
      <div class="src-info">
        <div class="src-title">${esc((m.title_english && m.title_english !== m.title) ? m.title_english : m.title)}</div>
        ${m.title_english && m.title_english !== m.title ? `<div style="font-size:.7rem;color:#8a7060;margin-bottom:3px;font-style:italic">${esc(m.title)}</div>` : ''}
        <div class="src-author">${esc((m.authors||[]).map(a=>a.name).join(', '))}</div>
        <div class="src-meta">
          ${type ? `<span class="src-badge src-series-badge">${esc(type)}</span>` : ''}
          ${vols ? `<span class="src-badge src-pages-badge">${vols}</span>` : ''}
          ${ch ? `<span class="src-badge src-pages-badge">${ch}</span>` : ''}
          ${score ? `<span class="src-badge src-rating-badge">${score}</span>` : ''}
          ${status ? `<span class="src-badge" style="background:var(--cream);color:#8a7060;border:1px solid var(--border)">${esc(status)}</span>` : ''}
        </div>
        ${genres ? `<div style="font-size:.7rem;color:#8a7060;margin-top:3px">${esc(genres)}</div>` : ''}
        ${m.synopsis ? `<div class="src-desc">${esc(m.synopsis.slice(0,120))}…</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function selectMangaResult(idx) {
  const m = _mangaResultCache[idx];
  if (!m) return;
  closeModal('manga-search-modal');
  openMangaAddModal(m, null);
}

// ── OPEN MODAL ───────────────────────────────────────────────────────
function openMangaSearch() {
  const inp = document.getElementById('manga-search-input');
  const libQ = (document.getElementById('manga-search-lib').value || '').trim();
  inp.value = libQ;
  const libEl = document.getElementById('manga-search-lib');
  libEl.value = '';
  renderMangaLibrary();
  const hasQ = libQ.length > 0;
  if (!hasQ) {
    document.getElementById('manga-search-results').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#b0988a;font-family:var(--font-display)">
        <div style="font-size:2rem;margin-bottom:8px">🔍</div>
        <div style="font-size:.88rem">Search for manga, manhwa, or manhua</div>
      </div>`;
  }
  document.getElementById('manga-search-modal').classList.add('open');
  if (hasQ) setTimeout(() => doMangaSearch(libQ), 80);
  else setTimeout(() => inp.focus(), 120);
}

document.getElementById('manga-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doMangaSearch(e.target.value);
});

// ── ADD / EDIT FORM ──────────────────────────────────────────────────
function openMangaAddModal(jikanItem, editItem) {
  editingMangaId = editItem ? editItem.id : null;
  mangaRating    = editItem ? (editItem.rating || 0) : 0;
  mangaRatingScale = editItem ? (editItem.ratingScale || 10) : 10;
  pendingManga   = jikanItem || null;

  const m  = jikanItem || {};
  const ex = editItem  || {};

  const title       = ex.title       || m.title || '';
  const titleEn     = ex.titleEn     || m.title_english || '';
  const author      = ex.author      || (m.authors||[]).map(a=>a.name).join(', ') || '';
  const cover       = ex.coverUrl    || m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || '';
  const volumes     = ex.volumes     || m.volumes || '';
  const chapters    = ex.chapters    || m.chapters || '';
  const type        = ex.type        || m.type || 'Manga';
  const status      = ex.status      || 'ptw';
  const malScore    = m.score ? `MAL: ${m.score}` : '';
  const genres      = ex.genres      || (m.genres||[]).map(g=>g.name).join(', ') || '';
  const notes       = ex.notes       || '';
  const curVol      = ex.currentVol  || '';
  const curCh       = ex.currentChapter || '';
  const malId       = ex.malId       || m.mal_id || '';
  const synopsis    = ex.synopsis    || m.synopsis || '';

  document.getElementById('manga-add-title').textContent = editingMangaId ? 'Edit Manga' : 'Add Manga';
  document.getElementById('manga-add-body').innerHTML = `
    ${cover ? `<div style="text-align:center;margin-bottom:14px"><img src="${esc(cover)}" style="height:130px;border-radius:10px;box-shadow:0 4px 16px var(--shadow)" onerror="this.style.display='none'"/></div>` : ''}
    <div class="form-group"><label>Title *</label><input type="text" id="mf-title" value="${esc(title)}" placeholder="Manga title"/></div>
    <div class="form-group"><label>English Title</label><input type="text" id="mf-title-en" value="${esc(titleEn)}" placeholder="English title (if different)"/></div>
    <div class="form-group"><label>Author / Artist</label><input type="text" id="mf-author" value="${esc(author)}" placeholder="Author name"/></div>
    <div class="form-group"><label>Type</label>
      <select id="mf-type">
        ${['Manga','Manhwa','Manhua','Light Novel','One-shot','Doujinshi'].map(t=>`<option ${type===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Genre / Tags</label><input type="text" id="mf-genres" value="${esc(genres)}" placeholder="e.g. Shonen, Fantasy, Action"/></div>
    <div class="form-group"><label>Total Volumes</label><input type="number" id="mf-volumes" value="${volumes}" placeholder="e.g. 12 (blank if ongoing)" min="1"/></div>
    <div class="form-group"><label>Total Chapters</label><input type="number" id="mf-chapters" value="${chapters}" placeholder="Blank if ongoing" min="1"/></div>
    <div class="form-group"><label>Status</label>
      <select id="mf-status">
        <option value="ptw" ${status==='ptw'?'selected':''}>📚 Plan to Read</option>
        <option value="reading" ${status==='reading'?'selected':''}>📖 Currently Reading</option>
        <option value="completed" ${status==='completed'?'selected':''}>✅ Completed</option>
        <option value="dropped" ${status==='dropped'?'selected':''}>❌ Dropped</option>
      </select>
    </div>
    <div class="form-group"><label>Current Volume</label><input type="number" id="mf-cur-vol" value="${curVol}" placeholder="Volume you're on" min="1"/></div>
    <div class="form-group"><label>Current Chapter</label><input type="number" id="mf-cur-ch" value="${curCh}" placeholder="Chapter you're on" min="1"/></div>
    <div class="form-group">
      <label>Rating</label>
      <div class="rating-scale-toggle">
        <button class="scale-opt ${mangaRatingScale===5?'active':''}" onclick="setMangaRatingScale(5)">★ 1–5</button>
        <button class="scale-opt ${mangaRatingScale===10?'active':''}" onclick="setMangaRatingScale(10)">🔢 1–10</button>
      </div>
      <div id="manga-rating-ui"></div>
    </div>
    <div class="form-group"><label>Notes / Review</label><textarea id="mf-notes" placeholder="Your thoughts…">${esc(notes)}</textarea></div>
    <div class="form-group"><label>Cover URL</label><input type="text" id="mf-cover" value="${esc(cover)}" placeholder="Auto-filled from search"/></div>
    <div class="form-group">
      <label>Bookend Style <span style="font-weight:400;text-transform:none;font-size:.68rem;color:#b0988a">— overrides global setting for this series</span></label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        ${['default','none','minimal','bracket','dragon','sakura','moon','hikaru'].map(s => {
          const labels = {default:'🌐 Global',none:'None',minimal:'Wood',bracket:'Bracket',dragon:'🐉',sakura:'🌸',moon:'🌙',hikaru:'🪲 Hikaru'};
          const cur = ex.bookendStyle || 'default';
          return `<button type="button" class="scale-opt ${cur===s?'active':''}"
            onclick="document.querySelectorAll('#mf-bookend-opts .scale-opt').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('mf-bookend-val').value='${s}'"
            >${labels[s]}</button>`;
        }).join('')}
      </div>
      <div id="mf-bookend-opts" style="display:none"></div>
      <input type="hidden" id="mf-bookend-val" value="${esc(ex.bookendStyle||'default')}"/>
    </div>
    ${malScore ? `<div style="font-size:.72rem;color:#8a7060;margin-bottom:12px">📊 ${malScore} on MyAnimeList</div>` : ''}
    <div class="row-btns">
      <button class="btn btn-primary" onclick="saveMangaEntry()">💾 Save</button>
      <button class="btn btn-ghost" onclick="closeModal('manga-add-modal')">Cancel</button>
    </div>`;

  renderMangaRatingPicker();
  document.getElementById('manga-add-modal').classList.add('open');
}

function setMangaRatingScale(n) {
  mangaRatingScale = n;
  document.querySelectorAll('#manga-add-body .scale-opt').forEach(b =>
    b.classList.toggle('active', b.textContent.includes(n === 5 ? '5' : '10'))
  );
  if (mangaRating > 5 && n === 5) mangaRating = 5;
  renderMangaRatingPicker();
}
function renderMangaRatingPicker() {
  const el = document.getElementById('manga-rating-ui'); if (!el) return;
  if (mangaRatingScale === 5) {
    el.innerHTML = `<div style="display:flex;gap:6px">${[1,2,3,4,5].map(i =>
      `<span class="star-pick ${mangaRating>=i?'lit':''}" onclick="setMangaRating(${i})">★</span>`
    ).join('')}</div>`;
  } else {
    el.innerHTML = `<div class="ten-scale">${Array.from({length:10},(_,i)=>i+1).map(i =>
      `<button class="ten-btn ${mangaRating===i?'active':''}" onclick="setMangaRating(${i})">${i}</button>`
    ).join('')}</div>`;
  }
}
function setMangaRating(v) { mangaRating = v; renderMangaRatingPicker(); }


// Fetch current volume count from Jikan immediately after adding a manga.
// For ongoing series Jikan returns volumes:null in search results —
// the detail endpoint sometimes has a higher count or at least chapters
// we can use to infer progress.
async function autoDetectVolumes(entry) {
  if (entry.volumes && entry.volumes > 0) return; // already known

  // If no malId was captured (manual entry without selecting a search result),
  // resolve it now via a Jikan title search before continuing.
  if (!entry.malId) {
    try {
      const sr = await fetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(entry.title)}&limit=1`);
      if (sr.ok) {
        const sd = await sr.json();
        const hit = (sd.data || [])[0];
        if (hit && hit.mal_id) {
          entry.malId = hit.mal_id;
          const idx = manga.findIndex(m => m.id === entry.id);
          if (idx > -1) { manga[idx].malId = hit.mal_id; saveManga(); }
          console.log(`[autoDetectVolumes] Resolved malId ${hit.mal_id} for "${entry.title}" via title search`);
        }
      }
      await new Promise(res => setTimeout(res, 340)); // rate limit before next call
    } catch(e) {
      console.warn('[autoDetectVolumes] Title search failed:', e.message);
    }
  }

  if (!entry.malId) {
    console.warn(`[autoDetectVolumes] Could not resolve malId for "${entry.title}" — skipping`);
    return;
  }

  try {
    const r = await fetch(`https://api.jikan.moe/v4/manga/${entry.malId}`);
    if (!r.ok) return;
    const d = await r.json();
    const data = d.data || {};
    const jikanVols = data.volumes || 0;
    if (jikanVols > 0) {
      const idx = manga.findIndex(m => m.id === entry.id);
      if (idx > -1) {
        manga[idx].volumes = jikanVols;
        saveManga();
        // Update the in-memory vol cover cache key if shelf is loaded
        console.log(`[Manga] Auto-detected ${jikanVols} volumes for "${entry.title}"`);
        showToast(`📚 "${entry.title}" — ${jikanVols} volumes detected automatically.`);
        if (currentMangaView === 'shelf') renderMangaShelfFast();
        else renderMangaLibrary();
      }
      return;
    }
    // Ongoing: Jikan volumes is null — try to infer from published chapters
    // by fetching the volumes list endpoint which returns actual released volumes
    await new Promise(res => setTimeout(res, 340)); // rate limit
    const vr = await fetch(`https://api.jikan.moe/v4/manga/${entry.malId}/volumes`);
    if (vr.ok) {
      const vd = await vr.json();
      const relevedVols = (vd.data || []).length;
      if (relevedVols > 0) {
        const idx = manga.findIndex(m => m.id === entry.id);
        if (idx > -1) {
          manga[idx].volumes = relevedVols;
          saveManga();
          console.log(`[Manga] Auto-detected ${relevedVols} released volumes for "${entry.title}" (ongoing)`);
          showToast(`📚 "${entry.title}" — ${relevedVols} volume${relevedVols>1?'s':''} released so far (ongoing series).`);
          if (currentMangaView === 'shelf') renderMangaShelfFast();
          else renderMangaLibrary();
        }
      } else {
        showToast(`📚 "${entry.title}" added — volume count ongoing, set manually when known.`);
      }
    }
  } catch(e) {
    console.warn('[autoDetectVolumes] Failed:', e.message);
  }
}
async function saveMangaEntry() {
  const title = (document.getElementById('mf-title').value || '').trim();
  if (!title) { showToast('Please enter a title.'); return; }
  const existing = editingMangaId ? manga.find(m => m.id === editingMangaId) : null;
  const entry = {
    id:             editingMangaId || genId(),
    title,
    titleEn:        document.getElementById('mf-title-en').value.trim(),
    author:         document.getElementById('mf-author').value.trim(),
    type:           document.getElementById('mf-type').value,
    genres:         document.getElementById('mf-genres').value.trim(),
    volumes:        parseInt(document.getElementById('mf-volumes').value) || 0,
    chapters:       parseInt(document.getElementById('mf-chapters').value) || 0,
    currentVol:     parseInt(document.getElementById('mf-cur-vol').value) || 0,
    currentChapter: parseInt(document.getElementById('mf-cur-ch').value) || 0,
    status:         document.getElementById('mf-status').value,
    coverUrl:       document.getElementById('mf-cover').value.trim(),
    notes:          document.getElementById('mf-notes').value.trim(),
    bookendStyle:   (() => { const v = document.getElementById('mf-bookend-val')?.value || 'default'; return v === 'default' ? null : v; })(),
    rating:         mangaRating,
    ratingScale:    mangaRatingScale,
    dateAdded:      existing ? existing.dateAdded : new Date().toISOString(),
    malId:          existing ? existing.malId : (pendingManga ? pendingManga.mal_id : null),
  };
  if (editingMangaId) {
    const idx = manga.findIndex(m => m.id === editingMangaId);
    if (idx > -1) manga[idx] = entry;
  } else {
    manga.unshift(entry);
  }
  console.log('[saveMangaEntry] About to call saveManga(). manga.length=', manga.length, 'title=', entry.title);
  saveManga();
  console.log('[saveMangaEntry] saveManga() returned. SK_MANGA in storage:', localStorage.getItem(SK_MANGA)?.length, 'chars');
  // Auto-detect volume count in background for ongoing series
  if (!entry.volumes || entry.volumes === 0) {
    console.log('[saveMangaEntry] Triggering autoDetectVolumes for:', entry.title, 'malId:', entry.malId);
    autoDetectVolumes(entry); // fire and forget — updates when Jikan responds
  } else {
    console.log('[saveMangaEntry] Skipping autoDetect — volumes already set to', entry.volumes);
  }
  // Clear the cover cache for this entry so shelf re-fetches fresh data
  if (_mangaVolCovers[entry.id]) delete _mangaVolCovers[entry.id];
  const libEl = document.getElementById('manga-search-lib');
  if (libEl) libEl.value = '';
  closeModal('manga-add-modal');
  renderMangaLibrary();
  // If shelf is currently visible, re-render it immediately to show new/updated entry
  if (currentMangaView === 'shelf') {
    requestAnimationFrame(() => renderMangaShelf());
  }
  showToast(editingMangaId ? 'Manga updated!' : `"${title}" added to your collection!`);
  editingMangaId = null; mangaRating = 0; pendingManga = null;
}

// ── LIBRARY RENDER ───────────────────────────────────────────────────
const MANGA_STATUS = { ptw:'Plan to Read', reading:'Reading', completed:'Completed', dropped:'Dropped' };
const MANGA_STATUS_CSS = { ptw:'status-tbr', reading:'status-reading', completed:'status-read', dropped:'status-dnf' };

function setMangaFilter(el, s) {
  document.querySelectorAll('#sec-manga .filter-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  activeMangaFilter = s;
  renderMangaLibrary();
}

function renderMangaLibrary() {
  const q = (document.getElementById('manga-search-lib').value || '').toLowerCase();
  const grid  = document.getElementById('manga-grid');
  const empty = document.getElementById('manga-empty');
  const filtered = manga.filter(m => {
    const statusMatch = activeMangaFilter === 'all' || m.status === activeMangaFilter;
    const textMatch   = !q || m.title.toLowerCase().includes(q) || (m.titleEn||'').toLowerCase().includes(q) || (m.author||'').toLowerCase().includes(q);
    return statusMatch && textMatch;
  });
  if (!filtered.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = filtered.map(m => {
    const pct = m.volumes && m.currentVol ? Math.min(100, Math.round(m.currentVol / m.volumes * 100)) : 0;
    const cov = m.coverUrl
      ? `<img class="book-cover" src="${esc(m.coverUrl)}" alt="${esc(displayTitle(m))}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="book-cover-placeholder" style="display:none">${esc(displayTitle(m))}</div>`
      : `<div class="book-cover-placeholder">${esc(displayTitle(m))}</div>`;
    return `<div class="book-card" onclick="openMangaDetail('${m.id}')">
      ${cov}
      <div class="book-info">
        <div class="series-pill">${esc(m.type||'Manga')}</div>
        <div class="book-title">${esc(displayTitle(m))}</div>
        <div class="book-author">${esc(m.author||'')}</div>
        <span class="status-badge ${MANGA_STATUS_CSS[m.status]||'status-tbr'}">${MANGA_STATUS[m.status]||'PTR'}</span>
        ${m.status==='reading'&&m.volumes
          ? `<div class="progress-wrap"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-label">Vol ${m.currentVol||0}/${m.volumes}</div></div>`
          : ''}
      </div>
    </div>`;
  }).join('');
}

// ── DETAIL MODAL ─────────────────────────────────────────────────────
function openMangaDetail(id) {
  const m = manga.find(x => x.id === id); if (!m) return;
  const pct = m.volumes && m.currentVol ? Math.min(100, Math.round(m.currentVol / m.volumes * 100)) : 0;
  document.getElementById('manga-detail-content').innerHTML = `
    ${m.coverUrl
      ? `<img src="${esc(m.coverUrl)}" class="detail-cover" alt="${esc(displayTitle(m))}" onerror="this.outerHTML='<div class=detail-cover-ph>${esc(displayTitle(m))}</div>'">`
      : `<div class="detail-cover-ph">${esc(displayTitle(m))}</div>`}
    <div style="padding:16px 18px 22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px">
        <div class="detail-title">${esc(displayTitle(m))}</div>
        <button class="modal-close" onclick="closeModal('manga-detail-modal')">✕</button>
      </div>
      ${m.titleEn && m.titleEn !== m.title ? `<div style="font-size:.78rem;color:#8a7060;margin-bottom:2px;font-style:italic">${esc(m.title)}</div>` : ''}
      <div class="detail-author">${esc(m.author||'Unknown author')}</div>
      <div class="detail-row">
        <span class="status-badge ${MANGA_STATUS_CSS[m.status]||'status-tbr'}">${MANGA_STATUS[m.status]||''}</span>
        <span class="series-pill">${esc(m.type||'Manga')}</span>
        ${m.genres ? `<span style="font-size:.7rem;color:#8a7060">${esc(m.genres)}</span>` : ''}
      </div>
      <div style="font-size:.74rem;color:#8a7060;margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap">
        ${m.volumes ? `<span>📚 ${m.volumes} volumes</span>` : ''}
        ${m.chapters ? `<span>📄 ${m.chapters} chapters</span>` : ''}
      </div>
      ${m.status==='reading'&&m.volumes?`<div class="progress-wrap" style="margin-bottom:12px"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-label">${pct}% · Vol ${m.currentVol||0}${m.currentChapter?', Ch '+m.currentChapter:''}</div></div>`:''}
      <div class="divider"></div>
      ${m.rating ? `<div style="margin-bottom:12px"><div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Rating</div>${renderRatingDisplay(m.rating,m.ratingScale||10)}</div>` : ''}
      ${m.notes ? `<div style="margin-bottom:12px"><div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Notes</div><div class="review-box">${esc(m.notes)}</div></div>` : ''}
      <div class="divider"></div>
      ${m.status==='reading'?`<div class="form-group"><label>Progress</label><div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="number" id="md-vol" value="${m.currentVol||0}" placeholder="Volume" min="0" max="${m.volumes||999}" style="width:90px;padding:7px 10px;border:1.5px solid var(--border);border-radius:9px;font-family:var(--font-body);background:var(--card-bg);color:var(--ink);outline:none;font-size:.88rem"/>
        <input type="number" id="md-ch" value="${m.currentChapter||0}" placeholder="Chapter" min="0" max="${m.chapters||9999}" style="width:90px;padding:7px 10px;border:1.5px solid var(--border);border-radius:9px;font-family:var(--font-body);background:var(--card-bg);color:var(--ink);outline:none;font-size:.88rem"/>
        <button class="btn btn-sage btn-sm" onclick="updMangaProgress('${id}')">Save</button>
      </div></div>`:''}
      <div class="form-group"><label>Status</label>
        <select id="md-status" onchange="updMangaStatus('${id}',this.value)">
          <option value="ptw" ${m.status==='ptw'?'selected':''}>📚 Plan to Read</option>
          <option value="reading" ${m.status==='reading'?'selected':''}>📖 Reading</option>
          <option value="completed" ${m.status==='completed'?'selected':''}>✅ Completed</option>
          <option value="dropped" ${m.status==='dropped'?'selected':''}>❌ Dropped</option>
        </select>
      </div>
      <div class="row-btns">
        <button class="btn btn-ghost btn-sm" onclick="closeModal('manga-detail-modal');openMangaAddModal(null,manga.find(x=>x.id==='${id}'))">✏️ Edit</button>
        <button class="btn btn-sm" style="background:#f0e0e0;color:#8a3030" onclick="delManga('${id}')">🗑 Remove</button>
      </div>
    </div>`;
  document.getElementById('manga-detail-modal').classList.add('open');
}

function updMangaProgress(id) {
  const m = manga.find(x => x.id === id); if (!m) return;
  m.currentVol     = parseInt(document.getElementById('md-vol').value) || 0;
  m.currentChapter = parseInt(document.getElementById('md-ch').value) || 0;
  saveManga(); openMangaDetail(id); renderMangaLibrary(); showToast('Progress updated!');
}
function updMangaStatus(id, v) {
  const m = manga.find(x => x.id === id); if (!m) return;
  m.status = v; saveManga(); openMangaDetail(id); renderMangaLibrary(); showToast('Status updated!');
}
function delManga(id) {
  if (!confirm('Remove this manga?')) return;
  manga = manga.filter(m => m.id !== id);
  saveManga(); closeModal('manga-detail-modal'); renderMangaLibrary(); showToast('Removed.');
}

// ═══════════════════════════════════════════════════════════════════
// MANGA SHELF VIEW
// ═══════════════════════════════════════════════════════════════════
let currentMangaView = localStorage.getItem(SK_MANGA_VIEW) || 'grid';

function setMangaView(v) {
  currentMangaView = v;
  localStorage.setItem(SK_MANGA_VIEW, v);
  document.getElementById('mvbtn-grid').classList.toggle('active', v === 'grid');
  document.getElementById('mvbtn-shelf').classList.toggle('active', v === 'shelf');
  document.getElementById('manga-grid-wrap').style.display  = v === 'grid'  ? 'block' : 'none';
  document.getElementById('manga-shelf-view').style.display = v === 'shelf' ? 'block' : 'none';
  if (v === 'shelf') requestAnimationFrame(() => renderMangaShelf());
  else renderMangaLibrary();
}

// Volume cover cache: mangaId -> { vol: coverUrl }
const _mangaVolCovers = {};

// Fetch volume count + per-volume covers from Jikan for a manga (uses mal_id)
async function fetchMangaVolCovers(m, forceRefresh = false) {
  if (!m.malId) return;
  if (_mangaVolCovers[m.id] && !forceRefresh) return; // already fetched
  _mangaVolCovers[m.id] = {};
  try {
    // Step 1: Fetch manga detail to get authoritative volume count
    const detailResp = await fetch(`https://api.jikan.moe/v4/manga/${m.malId}`);
    if (detailResp.ok) {
      const detailData = await detailResp.json();
      const jikanVols = detailData.data && detailData.data.volumes;
      if (jikanVols && jikanVols > 0) {
        // Auto-update the stored volume count if Jikan has it and we don't
        const idx = manga.findIndex(x => x.id === m.id);
        if (idx > -1 && (!manga[idx].volumes || manga[idx].volumes === 0)) {
          manga[idx].volumes = jikanVols;
          m.volumes = jikanVols; // update reference too
          saveManga();
          console.log(`[Manga] Auto-set volumes for "${m.title}": ${jikanVols}`);
        }
      }
    }
    // Respect Jikan rate limit between calls
    await new Promise(r => setTimeout(r, 340));

    // Step 2: Fetch pictures for per-volume cover art
    const picResp = await fetch(`https://api.jikan.moe/v4/manga/${m.malId}/pictures`);
    if (!picResp.ok) return;
    const picData = await picResp.json();
    (picData.data || []).forEach((pic, i) => {
      const url = pic.jpg?.large_image_url || pic.jpg?.image_url || '';
      if (url) _mangaVolCovers[m.id][i + 1] = url;
    });
    if (m.coverUrl && !_mangaVolCovers[m.id][1]) {
      _mangaVolCovers[m.id][1] = m.coverUrl;
    }
  } catch(e) { console.warn('[Manga] Cover fetch failed:', e.message); }
}

// Derive a stable two-tone color pair from a string (series title)
// Returns consistent colors for the same series across renders
function seriesColorFromTitle(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash << 5) - hash + title.charCodeAt(i) | 0;
  const h = Math.abs(hash) % 360;
  // Dark spine color + lighter highlight
  const s1 = `hsl(${h},55%,28%)`;
  const s2 = `hsl(${h},50%,45%)`;
  return [s1, s2];
}

// Flag must be declared BEFORE renderMangaShelfFast references it
let _mangaShelfFastMode = false;

// Fast ownership-only re-render — uses cached covers, no network, no placeholder
// Call this after marking volumes owned/unowned for instant visual update
function renderMangaShelfFast() {
  const el = document.getElementById('manga-shelf-view');
  if (!el || el.style.display === 'none') return; // not visible — skip
  _mangaShelfFastMode = true;
  renderMangaShelf().finally(() => { _mangaShelfFastMode = false; });
}

async function renderMangaShelf() {
  const el = document.getElementById('manga-shelf-view');
  if (!el) return;
  const q = (document.getElementById('manga-search-lib').value || '').toLowerCase();
  const filtered = manga.filter(m =>
    !q || m.title.toLowerCase().includes(q) || (m.titleEn||'').toLowerCase().includes(q)
  );

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🗾</div><h3>No manga yet</h3><p>Tap <strong>+ Add Manga</strong> to start your collection.</p></div>`;
    return;
  }

  // Always render immediately with whatever covers are cached — never block on network.
  // Cover fetching happens in the background after initial render.
  if (!_mangaShelfFastMode) {
    // Kick off cover fetching in background — don't await
    (async () => {
      for (const m of filtered) {
        await fetchMangaVolCovers(m);
        await new Promise(r => setTimeout(r, 340));
      }
      // Re-render once covers are loaded (only if still on shelf view)
      if (currentMangaView === 'shelf') {
        _mangaShelfFastMode = true;
        await renderMangaShelf();
        _mangaShelfFastMode = false;
      }
    })();
  }

  const cfg = getShelfConfig();
  const BOOKS_PER_ROW = cfg.spinesPerRow || 18;
  const ALLOW_SHARING  = cfg.allowShelfSharing !== false; // default on
  let rows = [], rowBuf = [], rowLabel = '', rowSeriesIds = new Set();

  const flush = (label, seriesIds) => {
    if (!rowBuf.length) return;
    rows.push({ label, books: [...rowBuf], seriesIds: new Set(seriesIds) });
    rowBuf = [];
    rowSeriesIds = new Set();
  };

  filtered.forEach(m => {
    const totalVols = m.volumes || m.currentVol || 1;
    // ownedVols is a Set of individually claimed volume numbers
    const ownedSet  = new Set(Array.isArray(m.ownedVols) ? m.ownedVols : []);

    if (!ALLOW_SHARING) {
      if (rowBuf.length > 0) flush(rowLabel, rowSeriesIds);
    } else {
      const seriesIsNew = !rowSeriesIds.has(m.id);
      if (seriesIsNew && rowBuf.length > 0 && rowBuf.length >= BOOKS_PER_ROW) {
        flush(rowLabel, rowSeriesIds);
      }
    }

    for (let v = 1; v <= totalVols; v++) {
      if (rowBuf.length >= BOOKS_PER_ROW) {
        const isMidSeries = rowSeriesIds.has(m.id);
        flush(displayTitle(m) + (isMidSeries ? ' (cont.)' : ''), rowSeriesIds);
      }
      rowBuf.push({ mangaId: m.id, vol: v, isOwned: ownedSet.has(v), m });
      rowSeriesIds.add(m.id);
      rowLabel = displayTitle(m);
    }

    if (!ALLOW_SHARING) flush(displayTitle(m), rowSeriesIds);
  });
  if (rowBuf.length) flush(rowLabel, rowSeriesIds);

  // ── Tag each row with bookend placement flags ──────────────────────
  // seriesFirstRow[mangaId] = row index where vol 1 appears
  // seriesLastRow[mangaId]  = row index where last vol appears
  const seriesFirstRow = {};
  const seriesLastRow  = {};
  rows.forEach((row, rowIdx) => {
    row.books.forEach(entry => {
      if (!(entry.mangaId in seriesFirstRow)) {
        seriesFirstRow[entry.mangaId] = rowIdx; // first time we see this series
      }
      seriesLastRow[entry.mangaId] = rowIdx; // keep updating — last wins
    });
  });

  const shelfCfg    = getShelfConfig();
  const globalBookendStyle = shelfCfg.bookendStyle || 'minimal';
  const dividerStyle       = shelfCfg.dividerStyle  || 'gap';

  const mangaShelfTypeCls = 'shelf-type-' + (shelfCfg.shelfType || 'freestanding');
  const mangaRows = rows.map(row => {
    let prevMangaId = null;
    const spines = row.books.map(entry => {
      const m = entry.m;
      const [c1, c2] = seriesColorFromTitle(m.title);
      const volCovers  = _mangaVolCovers[m.id] || {};
      const coverUrl   = volCovers[entry.vol] || volCovers[1] || m.coverUrl || '';
      const click      = entry.isOwned
        ? `openMangaVolDetail('${entry.mangaId}',${entry.vol})`
        : `claimMangaVol('${entry.mangaId}',${entry.vol})`;
      const dTitle     = displayTitle(m);
      const titleFull  = dTitle; // no truncation
      const mTitleLen  = dTitle.length;
      const mTitleSize = mTitleLen <= 8  ? '.70rem'
                       : mTitleLen <= 16 ? '.62rem'
                       : mTitleLen <= 24 ? '.54rem'
                       : mTitleLen <= 34 ? '.48rem'
                       :                   '.42rem';
      const bgStyle    = coverUrl ? `background:${c1};` : `background:linear-gradient(90deg,${c1} 0%,${c2} 55%,${c1} 100%);`;
      const fbBg       = `background:linear-gradient(90deg,${c1},${c2})`;

      // Insert divider when series changes mid-row
      let dividerHtml = '';
      if (prevMangaId && prevMangaId !== entry.mangaId) {
        dividerHtml = buildShelfDivider(dividerStyle, c1);
      }
      prevMangaId = entry.mangaId;

      return dividerHtml + `<div class="book-spine${entry.isOwned ? '' : ' ghost-spine'} manga-spine"
        onclick="${click}"
        style="${bgStyle}width:34px;"
        title="${esc(dTitle)} Vol.${entry.vol}${entry.isOwned ? '' : ' · click to mark as owned'}">
        ${coverUrl
          ? `<img class="spine-cover-img" src="${esc(coverUrl)}" alt="Vol.${entry.vol}" onerror="this.parentElement.style.cssText='${fbBg};width:34px;';this.remove()"/>`
          : ''}
        <div class="spine-title" style="font-size:${mTitleSize}">${esc(titleFull)}</div>
        <div class="spine-num">v${entry.vol}</div>
      </div>`;
    }).join('');

    // ── Bookend placement — series start/end only ───────────────────────
    // LEFT bookend: only on the row where this series' FIRST volume appears
    // RIGHT bookend: only on the row where this series' LAST volume appears
    // Mid-continuation rows get no bookends on that side
    const rowIdx      = rows.indexOf(row);
    const rowMangaIds = [...new Set(row.books.map(e => e.mangaId))];

    // Which series starts on this row? Use the first series that has its first row here
    const startingSeries = rowMangaIds
      .map(id => manga.find(x => x.id === id))
      .filter(Boolean)
      .find(m => seriesFirstRow[m.id] === rowIdx);

    // Which series ends on this row? Use the last series that has its last row here
    const endingSeries = [...rowMangaIds]
      .reverse()
      .map(id => manga.find(x => x.id === id))
      .filter(Boolean)
      .find(m => seriesLastRow[m.id] === rowIdx);

    // Resolve bookend style for each side independently
    const leftStyle  = (startingSeries && startingSeries.bookendStyle) || globalBookendStyle;
    const rightStyle = (endingSeries   && endingSeries.bookendStyle)   || globalBookendStyle;

    const leftEnd  = startingSeries ? buildBookends(leftStyle,  shelfCfg)[0] : '';
    const rightEnd = endingSeries   ? buildBookends(rightStyle, shelfCfg)[1] : '';

    // ── Segmented series header ──────────────────────────────────────────
    // Group consecutive spines by mangaId and render a label above each group
    const SPINE_W  = 34; // px — must match spine width in CSS
    const GAP_W    = 3;  // px — margin-right on each spine
    const DIV_W    = 12; // px — default divider width (gap style)
    // Extract actual bookend pixel widths (0 if no bookend on that side this row)
    const leftEndW  = leftEnd  ? (parseInt((leftEnd.match(/width:(\d+)px/)  || [])[1]) || 0) + 3 : 0;
    const rightEndW = rightEnd ? (parseInt((rightEnd.match(/width:(\d+)px/) || [])[1]) || 0) + 3 : 0;
    const BOOKEND_W = leftEndW;

    // Build runs: [{mangaId, title, count, hasDividerBefore}]
    const runs = [];
    let cur = null;
    row.books.forEach((entry, i) => {
      const hasDivider = i > 0 && row.books[i-1].mangaId !== entry.mangaId;
      if (!cur || cur.mangaId !== entry.mangaId) {
        cur = { mangaId: entry.mangaId, title: displayTitle(entry.m), count: 1, hasDividerBefore: hasDivider };
        runs.push(cur);
      } else {
        cur.count++;
      }
    });

    // Calculate pixel offset and width for each run label
    let offsetPx = BOOKEND_W;
    const segmentLabels = runs.map(run => {
      if (run.hasDividerBefore) offsetPx += DIV_W;
      const spanPx = run.count * (SPINE_W + GAP_W) - GAP_W;
      const label = `<div style="
        position:absolute;
        left:${offsetPx}px;
        width:${spanPx}px;
        font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
        color:#8a7060;font-family:var(--font-body);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        text-align:center;
        padding-bottom:4px;
        border-bottom:2px solid rgba(138,112,96,.25);
      ">🗾 ${esc(run.title)}</div>`;
      offsetPx += spanPx + GAP_W;
      return label;
    }).join('');

    const totalHeaderW = offsetPx + BOOKEND_W;

    return `<div class="shelf-section" style="width:100%;display:block;">
      <div style="position:relative;height:22px;min-width:${totalHeaderW}px;margin-bottom:2px;">
        ${segmentLabels}
      </div>
      <div class="shelf-row-wrap">
        <div class="shelf-row">
          ${leftEnd}
          ${spines}
          ${rightEnd}
          <div class="shelf-add-btn" onclick="openMangaSearch()" title="Add manga">＋</div>
        </div>
      </div>
      <div class="shelf-plank" style="width:100%;"></div>
    </div>`;
  });
  el.innerHTML = `<div class="${mangaShelfTypeCls}">${mangaRows.join('')}</div>`;
}


// Volume-specific detail modal for owned spines on the shelf
// Distinct from openMangaDetail (series view) — focused on this volume's ownership
function openMangaVolDetail(mangaId, vol) {
  const m = manga.find(x => x.id === mangaId); if (!m) return;
  const dt = displayTitle(m);
  vol = parseInt(vol);

  document.getElementById('manga-detail-content').innerHTML = `
    <div style="padding:20px 18px 24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-family:var(--font-display);font-size:1.05rem;font-weight:600;color:var(--ink)">${esc(dt)}</div>
        <button class="modal-close" onclick="closeModal('manga-detail-modal')">✕</button>
      </div>
      <div style="font-size:.78rem;color:var(--accent);font-weight:700;margin-bottom:14px">
        ✅ Volume ${vol} — Owned
      </div>
      <div style="background:var(--cream);border-radius:10px;padding:11px 14px;
                  font-size:.82rem;color:#8a7060;line-height:1.6;margin-bottom:18px;
                  border:1px solid var(--border)">
        You own Vol.${vol} of <strong>${esc(dt)}</strong>.
        What would you like to do?
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        <button class="btn btn-ghost"
          onclick="closeModal('manga-detail-modal');openMangaDetail('${mangaId}')"
          style="text-align:left;padding:11px 16px">
          📖 View Series Details
          <div style="font-size:.72rem;font-weight:400;opacity:.8;margin-top:2px">
            Open the full series page to edit, rate, or track progress
          </div>
        </button>
        <button class="btn btn-ghost"
          onclick="doClaimMangaVol('${mangaId}',${vol},'ghost-revert')"
          style="text-align:left;padding:11px 16px">
          👻 Remove Owned Status for Vol.${vol}
          <div style="font-size:.72rem;font-weight:400;opacity:.8;margin-top:2px">
            Marks only this volume as not owned — other volumes unaffected
          </div>
        </button>
        <button class="btn btn-ghost"
          onclick="closeModal('manga-detail-modal')"
          style="padding:11px 16px">
          Cancel
        </button>
      </div>
    </div>`;

  document.getElementById('manga-detail-modal').classList.add('open');
}

function claimMangaVol(mangaId, vol) {
  const m = manga.find(x => x.id === mangaId); if (!m) return;
  const dt = displayTitle(m);

  document.getElementById('manga-detail-content').innerHTML = `
    <div style="padding:20px 18px 24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-family:var(--font-display);font-size:1.05rem;font-weight:600;color:var(--ink)">${esc(dt)}</div>
        <button class="modal-close" onclick="closeModal('manga-detail-modal')">✕</button>
      </div>
      <div style="font-size:.78rem;color:var(--accent);font-weight:700;margin-bottom:14px">
        📖 Volume ${vol} — Not Yet Owned
      </div>
      <div style="background:var(--cream);border-radius:10px;padding:11px 14px;
                  font-size:.82rem;color:#8a7060;line-height:1.6;margin-bottom:18px;
                  border:1px solid var(--border)">
        This volume is on your shelf but hasn't been marked as owned yet.
        What would you like to do?
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        <button class="btn btn-primary"
          onclick="doClaimMangaVol('${mangaId}',${vol},'owned')"
          style="text-align:left;padding:11px 16px">
          ✅ Mark Vol.${vol} as Owned
          <div style="font-size:.72rem;font-weight:400;opacity:.8;margin-top:2px">
            Sets your current volume to ${vol}
          </div>
        </button>
        <button class="btn btn-ghost"
          onclick="doClaimMangaVol('${mangaId}',${vol},'all-up-to')"
          style="text-align:left;padding:11px 16px">
          📚 Mark Vol.1–${vol} as All Owned
          <div style="font-size:.72rem;font-weight:400;opacity:.8;margin-top:2px">
            Sets current volume to ${vol} (marks all prior volumes owned too)
          </div>
        </button>
        <button class="btn btn-ghost"
          onclick="doClaimMangaVol('${mangaId}',${vol},'ghost-revert')"
          style="text-align:left;padding:11px 16px">
          👻 Remove Owned Status
          <div style="font-size:.72rem;font-weight:400;opacity:.8;margin-top:2px">
            Marks only Vol.${vol} as not owned — other volumes unaffected
          </div>
        </button>
      </div>
    </div>`;

  document.getElementById('manga-detail-modal').classList.add('open');
}

function doClaimMangaVol(mangaId, vol, action) {
  const m = manga.find(x => x.id === mangaId); if (!m) return;
  const dt  = displayTitle(m);
  vol = parseInt(vol);

  // Ensure ownedVols exists as an array
  if (!Array.isArray(m.ownedVols)) m.ownedVols = [];

  if (action === 'owned') {
    // Mark ONLY this specific volume as owned — no others affected
    if (!m.ownedVols.includes(vol)) m.ownedVols.push(vol);
    m.ownedVols.sort((a, b) => a - b);
    if (m.status === 'ptw') m.status = 'reading';
    saveManga();
    closeModal('manga-detail-modal');
    renderMangaShelfFast(); // instant — no cover re-fetch
    showToast(`Vol.${vol} of "${dt}" marked as owned!`);

  } else if (action === 'all-up-to') {
    // Mark vol 1 through vol as all owned
    for (let v = 1; v <= vol; v++) {
      if (!m.ownedVols.includes(v)) m.ownedVols.push(v);
    }
    m.ownedVols.sort((a, b) => a - b);
    if (m.status === 'ptw') m.status = 'reading';
    saveManga();
    closeModal('manga-detail-modal');
    renderMangaShelfFast(); // instant — no cover re-fetch
    showToast(`Vol.1–${vol} of "${dt}" all marked as owned!`);

  } else if (action === 'ghost-revert') {
    // Remove this specific volume from owned — only this one
    m.ownedVols = m.ownedVols.filter(v => v !== vol);
    saveManga();
    closeModal('manga-detail-modal');
    renderMangaShelfFast(); // instant — no cover re-fetch, spine goes dark immediately
    showToast(`Vol.${vol} of "${dt}" sent back to ghost state.`);
  }
}


// ── Bookend + Divider Builders ─────────────────────────────────────────
function buildBookends(style, cfg) {
  // Check custom bookend library first
  const customs = (typeof getCustomBookends === 'function') ? getCustomBookends() : [];
  const customDef = customs.find(c => c.id === style);
  if (customDef) return buildCustomBookendPair(customDef, cfg);

  const wood1 = cfg.customWood     || '#8B5E3C';
  const wood2  = cfg.customWoodDark || '#6B3F1E';
  const h      = cfg.spineH        || 175;

  const styles = {
    minimal: [
      `<div style="width:10px;height:${h}px;background:linear-gradient(180deg,${wood1},${wood2});
                   border-radius:4px 2px 2px 4px;flex-shrink:0;
                   box-shadow:2px 0 6px rgba(0,0,0,.3);align-self:flex-end;"></div>`,
      `<div style="width:10px;height:${h}px;background:linear-gradient(180deg,${wood1},${wood2});
                   border-radius:2px 4px 4px 2px;flex-shrink:0;
                   box-shadow:-2px 0 6px rgba(0,0,0,.3);align-self:flex-end;"></div>`
    ],
    bracket: [
      `<div style="width:16px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#c0a060,#8B6030);
                   border-radius:6px 2px 2px 6px;
                   box-shadow:3px 0 8px rgba(0,0,0,.35);position:relative;">
         <div style="position:absolute;top:4px;bottom:4px;right:0;width:4px;
                     background:rgba(255,255,255,.12);border-radius:2px;"></div>
       </div>`,
      `<div style="width:16px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#c0a060,#8B6030);
                   border-radius:2px 6px 6px 2px;
                   box-shadow:-3px 0 8px rgba(0,0,0,.35);position:relative;">
         <div style="position:absolute;top:4px;bottom:4px;left:0;width:4px;
                     background:rgba(255,255,255,.12);border-radius:2px;"></div>
       </div>`
    ],
    dragon: [
      `<div style="width:22px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#8B1A1A,#4A0E0E);
                   border-radius:6px 2px 2px 6px;position:relative;
                   box-shadow:3px 0 10px rgba(139,26,26,.5);">
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     font-size:${Math.round(h*0.12)}px;writing-mode:vertical-rl;
                     transform:rotate(180deg);color:rgba(255,200,100,.7);text-shadow:0 0 6px gold">🐉</div>
       </div>`,
      `<div style="width:22px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#8B1A1A,#4A0E0E);
                   border-radius:2px 6px 6px 2px;position:relative;
                   box-shadow:-3px 0 10px rgba(139,26,26,.5);">
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     font-size:${Math.round(h*0.12)}px;writing-mode:vertical-rl;
                     color:rgba(255,200,100,.7);text-shadow:0 0 6px gold">🐉</div>
       </div>`
    ],
    sakura: [
      `<div style="width:20px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#c2185b,#7b1e44);
                   border-radius:6px 2px 2px 6px;position:relative;
                   box-shadow:3px 0 8px rgba(194,24,91,.4);">
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     font-size:${Math.round(h*0.11)}px;writing-mode:vertical-rl;
                     transform:rotate(180deg);color:rgba(255,200,220,.85)">🌸</div>
       </div>`,
      `<div style="width:20px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#c2185b,#7b1e44);
                   border-radius:2px 6px 6px 2px;position:relative;
                   box-shadow:-3px 0 8px rgba(194,24,91,.4);">
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     font-size:${Math.round(h*0.11)}px;writing-mode:vertical-rl;
                     color:rgba(255,200,220,.85)">🌸</div>
       </div>`
    ],
    moon: [
      `<div style="width:20px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#1a1a3e,#0a0a20);
                   border-radius:6px 2px 2px 6px;position:relative;
                   box-shadow:3px 0 8px rgba(100,100,255,.3);">
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     font-size:${Math.round(h*0.11)}px;writing-mode:vertical-rl;
                     transform:rotate(180deg);color:rgba(200,200,255,.85)">🌙</div>
       </div>`,
      `<div style="width:20px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#1a1a3e,#0a0a20);
                   border-radius:2px 6px 6px 2px;position:relative;
                   box-shadow:-3px 0 8px rgba(100,100,255,.3);">
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     font-size:${Math.round(h*0.11)}px;writing-mode:vertical-rl;
                     color:rgba(200,200,255,.85)">🌙</div>
       </div>`
    ],
    none: ['', ''],

    hikaru: [
      // Left bookend — The Summer Hikaru Died
      // Deep teal-to-black gradient, glowing firefly center, aqua outer glow
      `<div style="width:24px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#0d3d3a 0%,#071a18 45%,#030d0c 100%);
                   border-radius:6px 2px 2px 6px;position:relative;
                   box-shadow:3px 0 14px rgba(0,210,180,.28),inset 0 0 10px rgba(0,180,160,.08);">
         <!-- Firefly glow orb -->
         <div style="position:absolute;top:20%;left:50%;transform:translateX(-50%);
                     width:10px;height:10px;border-radius:50%;
                     background:radial-gradient(circle,rgba(120,255,220,1) 0%,rgba(0,210,180,.6) 50%,transparent 100%);
                     box-shadow:0 0 8px 4px rgba(0,230,200,.5),0 0 20px 8px rgba(0,180,160,.2);
                     animation:none;"></div>
         <!-- Series title vertical -->
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     writing-mode:vertical-rl;transform:rotate(180deg);
                     font-size:${Math.round(h*0.068)}px;
                     color:rgba(100,255,220,.55);letter-spacing:.12em;
                     font-family:serif;text-shadow:0 0 6px rgba(0,220,190,.7);">夏</div>
         <!-- Bottom glow -->
         <div style="position:absolute;bottom:0;left:0;right:0;height:35%;
                     background:linear-gradient(0deg,rgba(0,160,130,.18),transparent);
                     border-radius:0 0 0 6px;pointer-events:none;"></div>
       </div>`,

      // Right bookend — mirror
      `<div style="width:24px;height:${h}px;flex-shrink:0;align-self:flex-end;
                   background:linear-gradient(180deg,#0d3d3a 0%,#071a18 45%,#030d0c 100%);
                   border-radius:2px 6px 6px 2px;position:relative;
                   box-shadow:-3px 0 14px rgba(0,210,180,.28),inset 0 0 10px rgba(0,180,160,.08);">
         <!-- Firefly glow orb -->
         <div style="position:absolute;top:20%;left:50%;transform:translateX(-50%);
                     width:10px;height:10px;border-radius:50%;
                     background:radial-gradient(circle,rgba(120,255,220,1) 0%,rgba(0,210,180,.6) 50%,transparent 100%);
                     box-shadow:0 0 8px 4px rgba(0,230,200,.5),0 0 20px 8px rgba(0,180,160,.2);"></div>
         <!-- Series title vertical -->
         <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                     writing-mode:vertical-rl;
                     font-size:${Math.round(h*0.068)}px;
                     color:rgba(100,255,220,.55);letter-spacing:.12em;
                     font-family:serif;text-shadow:0 0 6px rgba(0,220,190,.7);">夏</div>
         <!-- Bottom glow -->
         <div style="position:absolute;bottom:0;left:0;right:0;height:35%;
                     background:linear-gradient(0deg,rgba(0,160,130,.18),transparent);
                     border-radius:0 0 6px 0;pointer-events:none;"></div>
       </div>`,
    ],

  };
  return styles[style] || styles.minimal;
}

function buildShelfDivider(style, nextSeriesColor) {
  const h = (getShelfConfig().spineH || 175);
  const styles = {
    gap:    `<div style="width:12px;height:${h}px;flex-shrink:0;align-self:flex-end;"></div>`,
    line:   `<div style="width:4px;height:${h * 0.85}px;flex-shrink:0;align-self:flex-end;
                         background:rgba(255,255,255,.18);border-radius:2px;margin:0 4px;"></div>`,
    marker: `<div style="width:20px;height:${h}px;flex-shrink:0;align-self:flex-end;
                         background:linear-gradient(180deg,#d4a050,#8B6030);
                         border-radius:3px;opacity:.7;margin:0 3px;
                         box-shadow:0 2px 6px rgba(0,0,0,.3);"></div>`,
    color:  `<div style="width:8px;height:${h * 0.9}px;flex-shrink:0;align-self:flex-end;
                         background:${nextSeriesColor};opacity:.6;border-radius:3px;margin:0 3px;"></div>`,
    none:   '',
  };
  return styles[style] || styles.gap;
}


// ═══════════════════════════════════════════════════════════════════
// CUSTOM BOOKEND BUILDER
// ═══════════════════════════════════════════════════════════════════
function getCustomBookends() {
  try { return JSON.parse(localStorage.getItem(SK_CUSTOM_BOOKENDS)) || []; }
  catch { return []; }
}
function saveCustomBookends(arr) {
  localStorage.setItem(SK_CUSTOM_BOOKENDS, JSON.stringify(arr));
}

// Merge custom bookends into the preset system
function getAllBookendStyles() {
  const presets = ['none','minimal','bracket','dragon','sakura','moon','hikaru'];
  const labels  = {none:'None',minimal:'Wood',bracket:'Bracket',dragon:'🐉 Dragon',
                   sakura:'🌸 Sakura',moon:'🌙 Moon',hikaru:'🪲 Hikaru'};
  const customs = getCustomBookends().map(c => ({ id: c.id, label: c.name, custom: true }));
  return { presets, labels, customs };
}

// Build HTML for a custom bookend (same interface as buildBookends)
function buildCustomBookendPair(customDef, cfg) {
  const h    = cfg.spineH || 175;
  const w    = customDef.width  || 22;
  const bg1  = customDef.color1 || '#2a1a0a';
  const bg2  = customDef.color2 || '#1a0a04';
  const glow = customDef.glowColor || 'transparent';
  const icon = customDef.icon  || '';
  const lbl  = customDef.label || '';

  const innerContent = icon
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                   writing-mode:vertical-rl;transform:rotate(180deg);
                   font-size:${Math.round(h * 0.11)}px;
                   color:${customDef.iconColor||'rgba(255,255,255,.8)'};
                   text-shadow:0 0 6px ${glow}">${icon}</div>`
    : (lbl ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                           writing-mode:vertical-rl;transform:rotate(180deg);
                           font-size:${Math.round(h * 0.065)}px;letter-spacing:.1em;
                           color:${customDef.iconColor||'rgba(255,255,255,.6)'};">${esc(lbl)}</div>` : '');

  const glowShadow = glow !== 'transparent'
    ? `,0 0 12px 4px ${glow}40`
    : '';

  const left = `<div style="width:${w}px;height:${h}px;flex-shrink:0;align-self:flex-end;
                             background:linear-gradient(180deg,${bg1},${bg2});
                             border-radius:6px 2px 2px 6px;position:relative;
                             box-shadow:3px 0 10px rgba(0,0,0,.4)${glowShadow};">
    ${innerContent}
  </div>`;
  const right = `<div style="width:${w}px;height:${h}px;flex-shrink:0;align-self:flex-end;
                              background:linear-gradient(180deg,${bg1},${bg2});
                              border-radius:2px 6px 6px 2px;position:relative;
                              box-shadow:-3px 0 10px rgba(0,0,0,.4)${glowShadow};">
    ${innerContent.replace('rotate(180deg)','').replace('transform:rotate(180deg);','')}
  </div>`;
  return [left, right];
}

// Custom bookend lookup is handled inside buildBookends directly

// ── Custom Bookend Editor ──────────────────────────────────────────
let _cbState = { name:'', color1:'#2a1a0a', color2:'#1a0a04', glowColor:'', icon:'', label:'', iconColor:'rgba(255,255,255,.8)', width:22, editId:null };

function openCustomBookendEditor(editId) {
  const customs = getCustomBookends();
  const existing = editId ? customs.find(c => c.id === editId) : null;
  _cbState = existing
    ? { ...existing, editId }
    : { name:'', color1:'#2a1a0a', color2:'#1a0a04', glowColor:'', icon:'', label:'', iconColor:'rgba(255,255,255,.8)', width:22, editId:null };

  document.getElementById('detail-content').innerHTML = buildCustomBookendEditorHTML();
  document.getElementById('detail-modal').classList.add('open');
}

function buildCustomBookendEditorHTML() {
  const s = _cbState;
  const previewCfg = { ...getShelfConfig(), spineH: 120 };
  const [l, r] = buildCustomBookendPair(s, previewCfg);
  const sampleSpines = ['#c62828','#1b4f72','#1d6a4a'].map(c =>
    `<div style="width:28px;height:120px;background:${c};border-radius:2px;box-shadow:2px 0 4px rgba(0,0,0,.3)"></div>`
  ).join('');

  const EMOJIS = ['🌸','🌙','🐉','🪲','⚡','🌊','🔥','❄️','🌟','🏔️','🌿','🦋','💀','👁️','🎋','⛩️','🌺','🦊','🐺','🌸','✦','🎴','🪷','🩸'];

  return `
    <div style="padding:16px 18px 24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-family:var(--font-display);font-size:1.05rem">🔖 ${s.editId ? 'Edit' : 'Create'} Bookend</div>
        <button class="modal-close" onclick="closeModal('detail-modal')">✕</button>
      </div>

      <!-- Live preview -->
      <div style="background:linear-gradient(180deg,var(--shelf-bg-top),var(--shelf-bg-bot));
                  border-radius:10px 10px 0 0;padding:10px 14px 0;
                  display:flex;gap:3px;align-items:flex-end;
                  border:1px solid var(--border);margin-bottom:0" id="cb-preview-row">
        ${l}${sampleSpines}${r}
      </div>
      <div style="height:16px;background:linear-gradient(180deg,var(--shelf-wood),var(--shelf-wood-dark));
                  border-radius:0 0 6px 6px;box-shadow:0 4px 8px rgba(0,0,0,.25);
                  margin-bottom:16px;border:1px solid var(--border);border-top:none"></div>

      <div class="form-group"><label>Name *</label>
        <input type="text" id="cb-name" value="${esc(s.name)}" placeholder="e.g. Summer Night"
          oninput="_cbState.name=this.value"/>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:13px">
        <div>
          <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Top Color</div>
          <div class="color-swatch-btn" style="background:${s.color1};width:36px;height:36px;border-radius:9px">
            <input type="color" value="${s.color1}" oninput="_cbState.color1=this.value;this.parentElement.style.background=this.value;cbUpdatePreview()"/>
          </div>
        </div>
        <div>
          <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Bottom Color</div>
          <div class="color-swatch-btn" style="background:${s.color2};width:36px;height:36px;border-radius:9px">
            <input type="color" value="${s.color2}" oninput="_cbState.color2=this.value;this.parentElement.style.background=this.value;cbUpdatePreview()"/>
          </div>
        </div>
        <div>
          <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Glow Color</div>
          <div class="color-swatch-btn" style="background:${s.glowColor||'#888'};width:36px;height:36px;border-radius:9px">
            <input type="color" value="${s.glowColor||'#00d4b0'}" oninput="_cbState.glowColor=this.value;this.parentElement.style.background=this.value;cbUpdatePreview()"/>
          </div>
        </div>
      </div>

      <div style="font-size:.72rem;font-weight:700;color:#7a6a5a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Icon / Emoji</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
        <span class="emoji-opt ${!s.icon?'selected':''}" onclick="_cbState.icon='';document.getElementById('cb-icon-txt').value='';cbUpdatePreview();document.querySelectorAll('#cb-emoji-row .emoji-opt').forEach(e=>e.classList.remove('selected'));this.classList.add('selected')">∅</span>
        ${EMOJIS.map(e=>`<span class="emoji-opt ${s.icon===e?'selected':''}" id="cb-emoji-row"
          onclick="_cbState.icon='${e}';document.getElementById('cb-icon-txt').value='${e}';cbUpdatePreview();document.querySelectorAll('.emoji-opt').forEach(x=>x.classList.remove('selected'));this.classList.add('selected')">${e}</span>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:13px">
        <input type="text" id="cb-icon-txt" value="${esc(s.icon||s.label)}" placeholder="Emoji, kanji, or short text"
          style="flex:1;padding:7px 11px;border:1.5px solid var(--border);border-radius:9px;font-family:var(--font-body);font-size:.88rem;background:var(--card-bg);color:var(--ink);outline:none"
          oninput="_cbState.icon=this.value;cbUpdatePreview()"/>
        <div>
          <div style="font-size:.68rem;color:#8a7060;margin-bottom:3px">Icon Color</div>
          <div class="color-swatch-btn" style="background:${s.iconColor||'#fff'};width:32px;height:32px;border-radius:8px">
            <input type="color" value="${s.iconColor||'#ffffff'}" oninput="_cbState.iconColor=this.value;this.parentElement.style.background=this.value;cbUpdatePreview()"/>
          </div>
        </div>
      </div>

      <div class="form-group"><label>Width (px)</label>
        <input type="range" min="10" max="40" value="${s.width||22}" step="2"
          oninput="_cbState.width=parseInt(this.value);document.getElementById('cb-w-val').textContent=this.value;cbUpdatePreview()"
          style="width:100%;accent-color:var(--btn-primary-bg)"/>
        <div style="font-size:.68rem;color:#8a7060;margin-top:2px">Current: <span id="cb-w-val">${s.width||22}</span>px</div>
      </div>

      <div class="row-btns" style="margin-top:6px">
        <button class="btn btn-primary" onclick="saveCustomBookend()">💾 Save Bookend</button>
        ${s.editId ? `<button class="btn btn-sm" style="background:#f0e0e0;color:#8a3030" onclick="deleteCustomBookend('${s.editId}')">🗑 Delete</button>` : ''}
        <button class="btn btn-ghost" onclick="closeModal('detail-modal')">Cancel</button>
      </div>
    </div>`;
}

function cbUpdatePreview() {
  const row = document.getElementById('cb-preview-row');
  if (!row) return;
  const cfg = { ...getShelfConfig(), spineH: 120 };
  const [l, r] = buildCustomBookendPair(_cbState, cfg);
  const sampleSpines = ['#c62828','#1b4f72','#1d6a4a'].map(c =>
    `<div style="width:28px;height:120px;background:${c};border-radius:2px;box-shadow:2px 0 4px rgba(0,0,0,.3)"></div>`
  ).join('');
  row.innerHTML = l + sampleSpines + r;
}

function saveCustomBookend() {
  const name = (_cbState.name || '').trim();
  if (!name) { showToast('Please enter a name.'); return; }
  const customs = getCustomBookends();
  const entry = { ..._cbState, id: _cbState.editId || 'cb_' + Date.now(), name };
  delete entry.editId;
  if (_cbState.editId) {
    const idx = customs.findIndex(c => c.id === _cbState.editId);
    if (idx > -1) customs[idx] = entry; else customs.push(entry);
  } else {
    customs.push(entry);
  }
  saveCustomBookends(customs);
  closeModal('detail-modal');
  _refreshShelfPanel();
  showToast(`"${name}" bookend ${_cbState.editId ? 'updated' : 'created'}!`);
}

function deleteCustomBookend(id) {
  if (!confirm('Delete this custom bookend?')) return;
  const customs = getCustomBookends().filter(c => c.id !== id);
  saveCustomBookends(customs);
  closeModal('detail-modal');
  _refreshShelfPanel();
  showToast('Custom bookend deleted.');
}


// ═══════════════════════════════════════════════════════════════════
// AUTO-BACKUP — protects against accidental data loss
// Writes a snapshot after every book/manga change.
// On init, if primary keys are missing, restores from latest snapshot.
// ═══════════════════════════════════════════════════════════════════
const AUTOSAVE_SLOTS = 3; // keep last 3 snapshots

function writeAutosave() {
  // Store only ONE full snapshot to minimise localStorage quota usage.
  // Multiple full copies tripled storage use and could cause QuotaExceededError.
  try {
    const snapshot = {
      ts:       Date.now(),
      books:    JSON.parse(localStorage.getItem(SK_BOOKS)  || '[]'),
      manga:    JSON.parse(localStorage.getItem(SK_MANGA)  || '[]'),
      settings: {},
    };
    ALL_SETTINGS_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) snapshot.settings[k] = v;
    });
    // Keep previous snapshot as slot[1] so we have one level of undo
    const prev = localStorage.getItem(SK_AUTOSAVE);
    const prevSlot = prev ? JSON.parse(prev) : null;
    const slots = [snapshot];
    if (prevSlot && prevSlot[0] && prevSlot[0].ts !== snapshot.ts) {
      // Keep previous snapshot but strip its data to just a timestamp sentinel
      // to avoid doubling storage — full restore still works from slot[0]
      slots.push({ ts: prevSlot[0].ts, books: prevSlot[0].books, manga: prevSlot[0].manga, settings: prevSlot[0].settings });
    }
    localStorage.setItem(SK_AUTOSAVE, JSON.stringify(slots.slice(0, 2)));
  } catch(e) {
    // Autosave failed — primary save already succeeded so data is safe for this session
    console.warn('[Autosave] Snapshot write failed (quota?):', e.name, e.message);
  }
}

function restoreFromAutosave() {
  try {
    const slots = JSON.parse(localStorage.getItem(SK_AUTOSAVE) || '[]');
    if (!slots.length) return false;
    const latest = slots[0];
    if (!latest) return false;

    // Restore books
    if (Array.isArray(latest.books) && latest.books.length > 0) {
      localStorage.setItem(SK_BOOKS, JSON.stringify(latest.books));
    }
    // Restore manga
    if (Array.isArray(latest.manga) && latest.manga.length > 0) {
      localStorage.setItem(SK_MANGA, JSON.stringify(latest.manga));
    }
    // Restore settings
    Object.entries(latest.settings || {}).forEach(([k, v]) => {
      localStorage.setItem(k, v);
    });

    const age = Math.round((Date.now() - latest.ts) / 60000);
    console.log(`[Autosave] Restored from snapshot taken ${age} minute(s) ago`);
    return true;
  } catch(e) {
    console.warn('[Autosave] Restore failed:', e);
    return false;
  }
}

function checkAndRestoreIfNeeded() {
  const storedBooks = JSON.parse(localStorage.getItem(SK_BOOKS) || '[]');
  const storedManga = JSON.parse(localStorage.getItem(SK_MANGA) || '[]');
  console.log('[checkRestore] storedBooks:', storedBooks.length, 'storedManga:', storedManga.length);
  if (storedBooks.length === 0 && storedManga.length === 0) {
    const slots = JSON.parse(localStorage.getItem(SK_AUTOSAVE) || '[]');
    const latest = slots[0];
    if (latest && (
      (Array.isArray(latest.books) && latest.books.length > 0) ||
      (Array.isArray(latest.manga) && latest.manga.length > 0)
    )) {
      console.log('[Autosave] Primary data missing but autosave found — restoring...');
      return restoreFromAutosave();
    }
  }
  return false;
}

// Expose to Data tab UI
function exportAutosaveSlots() {
  const slots = JSON.parse(localStorage.getItem(SK_AUTOSAVE) || '[]');
  if (!slots.length) { showToast('No autosave snapshots found.'); return; }
  const blob = new Blob([JSON.stringify(slots, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `salenas-autosave-${new Date().toISOString().slice(0,10)}.json`,
  });
  a.click();
  showToast(`${slots.length} autosave snapshot(s) exported.`);
}

function restoreAutosaveSlot(slotIndex) {
  const slots = JSON.parse(localStorage.getItem(SK_AUTOSAVE) || '[]');
  const slot = slots[slotIndex];
  if (!slot) { showToast('Snapshot not found.'); return; }
  const age = Math.round((Date.now() - slot.ts) / 60000);
  if (!confirm(`Restore snapshot from ${age} minute(s) ago?\nThis will overwrite your current books, manga, and settings.`)) return;

  if (Array.isArray(slot.books)) localStorage.setItem(SK_BOOKS, JSON.stringify(slot.books));
  if (Array.isArray(slot.manga)) localStorage.setItem(SK_MANGA, JSON.stringify(slot.manga));
  Object.entries(slot.settings || {}).forEach(([k, v]) => localStorage.setItem(k, v));
  showToast('Snapshot restored — reloading…', 2000);
  setTimeout(() => window.location.reload(), 1800);
}



function showSnapshotList() {
  const slots = JSON.parse(localStorage.getItem(SK_AUTOSAVE) || '[]');
  const el = document.getElementById('snapshot-list');
  if (!el) return;
  if (!slots.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:#b0988a;padding:8px 13px">No snapshots yet — they will appear here after you add books or manga.</div>';
    el.style.display = 'block';
    return;
  }
  el.innerHTML = slots.map((s, i) => {
    const date = new Date(s.ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
    const bCount = (s.books || []).length;
    const mCount = (s.manga || []).length;
    return `<div class="data-bar" style="margin-bottom:6px">
      <span>
        <strong>${date}</strong>
        <span style="font-size:.68rem;color:#b0988a;margin-left:6px">${bCount} book${bCount!==1?'s':''}, ${mCount} manga</span>
      </span>
      <button class="btn btn-ghost btn-xs" onclick="restoreAutosaveSlot(${i})">Restore</button>
    </div>`;
  }).join('');
  el.style.display = 'block';
}


// ═══════════════════════════════════════════════════════════════════
// UPDATE CHECKER — detects new deploys, never auto-reloads
// Polls app.js periodically, compares version stamp, shows a dismissible
// banner if a newer version is found. User decides when to reload.
// Never fires during an active save (checked via _saveInProgress flag, declared at top of file).
// ═══════════════════════════════════════════════════════════════════
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
let _updateBannerShown = false;

async function checkForUpdate() {
  if (_updateBannerShown) return; // already showing — don't re-check
  try {
    // Cache-bust with a timestamp query param so we always get the real current file,
    // bypassing any browser or CDN cache layer
    const r = await fetch('/app.js?_t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const text = await r.text();
    const match = text.match(/const APP_VERSION = '([^']+)'/);
    if (!match) return;
    const liveVersion = match[1];
    if (liveVersion !== APP_VERSION) {
      console.log(`[UpdateCheck] New version available: ${liveVersion} (running ${APP_VERSION})`);
      showUpdateAvailableBanner(liveVersion);
    }
  } catch(e) {
    console.warn('[UpdateCheck] Check failed:', e.message);
  }
}

function showUpdateAvailableBanner(newVersion) {
  if (_updateBannerShown) return;
  _updateBannerShown = true;

  const bar = document.createElement('div');
  bar.id = 'update-available-bar';
  bar.style.cssText = [
    'position:fixed;top:0;left:0;right:0;z-index:9999',
    'background:var(--btn-primary-bg,#D4967A)',
    'color:var(--btn-primary-text,#fff)',
    'font-family:var(--font-body,"Lato",sans-serif)',
    'font-size:.82rem;font-weight:700',
    'display:flex;align-items:center;justify-content:center;gap:12px',
    'padding:10px 16px;box-shadow:0 2px 12px rgba(0,0,0,.25)',
  ].join(';');
  bar.innerHTML = `
    <span>✨ A new version of Salena's Bookshelf is available.</span>
    <button id="update-now-btn" style="
      background:rgba(255,255,255,.25);border:1.5px solid rgba(255,255,255,.5);
      color:inherit;border-radius:20px;padding:5px 16px;font-size:.78rem;
      font-weight:700;cursor:pointer;font-family:inherit">
      Refresh Now
    </button>
    <button id="update-dismiss-btn" style="
      background:none;border:none;color:rgba(255,255,255,.75);
      font-size:1.15rem;cursor:pointer;padding:0 4px;line-height:1">
      ✕
    </button>`;
  document.body.prepend(bar);

  document.getElementById('update-now-btn').addEventListener('click', () => {
    if (_saveInProgress) {
      showToast('Finishing current save first — try again in a moment.');
      return;
    }
    window.location.reload();
  });
  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    bar.remove();
    _updateBannerShown = false; // allow it to reappear on next check in case they forget
  });
}

// Start polling once the page has settled — don't compete with initial load
setTimeout(() => {
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
}, 8000);

// Also check when the tab regains focus — catches updates that happened
// while the tab was in the background, without needing to wait for the interval
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});



// ═══════════════════════════════════════
// WISHLIST TAB
// ═══════════════════════════════════════
function renderWishlist() {
  const el    = document.getElementById('sec-wishlist');
  if (!el) return;
  const q     = (document.getElementById('wishlist-search')?.value || '').toLowerCase();
  const items = books.filter(b => b.status === 'wishlist' && (
    !q || b.title.toLowerCase().includes(q) || (b.author||'').toLowerCase().includes(q)
  ));

  if (!items.length) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  min-height:300px;gap:12px;color:#b0988a;font-family:var(--font-display)">
        <div style="font-size:2.5rem">🎁</div>
        <div style="font-size:1.1rem">No wishlist books yet</div>
        <div style="font-size:.82rem;opacity:.7">Add a book and set its status to 🎁 Wishlist</div>
      </div>`;
    return;
  }

  const sm = { wishlist:'status-wishlist' };
  el.innerHTML = `
    <div style="padding:14px 16px 8px;display:flex;align-items:center;gap:10px">
      <input type="text" id="wishlist-search" placeholder="Search wishlist…"
        value="${q}"
        oninput="renderWishlist()"
        style="flex:1;padding:9px 16px;border:1.5px solid var(--border);border-radius:24px;
               font-family:var(--font-body);font-size:.88rem;background:var(--card-bg);
               color:var(--ink);outline:none"/>
      <span style="font-size:.78rem;color:#b0988a;white-space:nowrap">${items.length} book${items.length!==1?'s':''}</span>
    </div>
    <div class="book-grid" style="opacity:.85">
      ${items.map(b => {
        const cover = b.coverUrl
          ? `<img class="book-cover" src="${esc(b.coverUrl)}" alt="${esc(b.title)}"
               onerror="this.outerHTML='<div class=book-cover-ph>${esc(b.title.slice(0,30))}</div>'">`
          : `<div class="book-cover-ph">${esc(b.title.slice(0,30))}</div>`;
        return `<div class="book-card wishlist-card" onclick="openDetail('${b.id}')">
          ${cover}
          <div class="book-info">
            <div class="book-title">${esc(b.title)}</div>
            <div class="book-author">${esc(b.author||'')}</div>
            ${b.series ? `<div style="font-size:.7rem;color:var(--accent);margin-top:2px">📖 ${esc(b.series)}${b.seriesNum?' #'+b.seriesNum:''}</div>` : ''}
            <div style="margin-top:6px">
              <span class="status-badge status-wishlist">🎁 Wishlist</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}



// ═══════════════════════════════════════════════════════════════════
// BARCODE SCANNER — ISBN scan → instant book add, no modal
// Uses native BarcodeDetector (Android/Chrome) with ZXing fallback (iOS)
// ═══════════════════════════════════════════════════════════════════

let _scannerStream   = null;  // active camera stream
let _scannerRunning  = false; // prevents duplicate scan loops
let _scannerCooldown = false; // prevents double-scans of same barcode
let _zxingReader     = null;  // ZXing instance (iOS fallback)

async function openScanner() {
  const modal = document.getElementById('scanner-modal');
  const video = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');

  modal.classList.add('open');
  status.textContent = 'Starting camera…';

  try {
    _scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = _scannerStream;
    await video.play();
    status.textContent = 'Point the camera at an ISBN barcode on the back of the book';
    _scannerRunning = true;
    _startScanLoop(video, status);
  } catch(e) {
    status.textContent = e.name === 'NotAllowedError'
      ? '⚠️ Camera permission denied. Allow camera access in your browser settings.'
      : '⚠️ Camera unavailable: ' + e.message;
  }
}

function stopScanner() {
  _scannerRunning = false;
  if (_scannerStream) {
    _scannerStream.getTracks().forEach(t => t.stop());
    _scannerStream = null;
  }
  if (_zxingReader) {
    try { _zxingReader.reset(); } catch {}
    _zxingReader = null;
  }
  const video = document.getElementById('scanner-video');
  if (video) video.srcObject = null;
  closeModal('scanner-modal');
}

async function _startScanLoop(video, statusEl) {
  // Try native BarcodeDetector first (Android Chrome, newer browsers)
  if ('BarcodeDetector' in window) {
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const loop = async () => {
      if (!_scannerRunning) return;
      try {
        const codes = await detector.detect(video);
        for (const code of codes) {
          const raw = code.rawValue;
          if (_isISBN(raw)) {
            await _onISBNScanned(raw, statusEl);
            return; // stop after first valid ISBN
          }
        }
      } catch {}
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return;
  }

  // iOS fallback — ZXing via canvas frame capture
  const canvas  = document.getElementById('scanner-canvas');
  const ctx     = canvas.getContext('2d');

  // ZXing may not be loaded yet (deferred script) — wait for it
  let waited = 0;
  while (!window.ZXing && waited < 5000) {
    await new Promise(r => setTimeout(r, 200));
    waited += 200;
  }

  if (!window.ZXing) {
    statusEl.textContent = '⚠️ Barcode library failed to load. Try refreshing.';
    return;
  }

  const hints = new Map();
  hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    window.ZXing.BarcodeFormat.EAN_13,
    window.ZXing.BarcodeFormat.EAN_8,
    window.ZXing.BarcodeFormat.UPC_A,
  ]);
  _zxingReader = new window.ZXing.MultiFormatReader();
  _zxingReader.setHints(hints);

  const zxingLoop = async () => {
    if (!_scannerRunning) return;
    try {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const luminance = new window.ZXing.HTMLCanvasElementLuminanceSource(canvas);
      const binary    = new window.ZXing.HybridBinarizer(luminance);
      const bmpResult = new window.ZXing.BinaryBitmap(binary);
      const result    = _zxingReader.decode(bmpResult);
      if (result && _isISBN(result.getText())) {
        await _onISBNScanned(result.getText(), statusEl);
        return;
      }
    } catch {}
    setTimeout(zxingLoop, 150); // ~6fps — enough for barcode reading
  };
  zxingLoop();
}

function _isISBN(str) {
  if (!str) return false;
  const clean = str.replace(/[^0-9X]/gi, '');
  return clean.length === 13 || clean.length === 10;
}

async function _onISBNScanned(isbn, statusEl) {
  if (_scannerCooldown) return;
  _scannerCooldown = true;
  _scannerRunning  = false; // pause scanning while we process

  statusEl.innerHTML = `<span style="color:var(--accent)">📗 ISBN ${isbn} — looking up…</span>`;

  try {
    // Lookup via Google Books ISBN query
    const url  = gbUrl(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    const resp = await fetch(url);
    const data = await resp.json();
    const item = (data.items || [])[0];

    if (!item) {
      statusEl.innerHTML = `<span style="color:#c06060">❌ Book not found for ISBN ${isbn}. Try another.</span>`;
      // Resume scanning after a pause
      await new Promise(r => setTimeout(r, 2000));
      _scannerCooldown = false;
      _scannerRunning  = true;
      _startScanLoop(document.getElementById('scanner-video'), statusEl);
      return;
    }

    const v = item.volumeInfo || {};
    const bd = {
      id:           genId(),
      title:        v.title || 'Unknown Title',
      author:       (v.authors || []).join(', '),
      genre:        (v.categories || []).join(', '),
      series:       detectSeries(v) || '',
      seriesNum:    detectSeriesNum(v) || null,
      pageCount:    v.pageCount || 0,
      currentPage:  0,
      status:       'tbr',
      coverUrl:     bestCover(v),
      isbn:         isbn,
      notes:        '',
      rating:       0,
      ratingScale:  5,
      isGhost:      false,
      googleId:     item.id || '',
      dateAdded:    new Date().toISOString(),
      dateStarted:  null,
      dateFinished: null,
    };

    // Check for duplicate
    if (books.find(b => b.isbn === isbn || b.title.toLowerCase() === bd.title.toLowerCase())) {
      statusEl.innerHTML = `<span style="color:#c0900a">⚠️ "${bd.title}" is already on your shelf.</span>`;
      await new Promise(r => setTimeout(r, 2000));
      _scannerCooldown = false;
      _scannerRunning  = true;
      _startScanLoop(document.getElementById('scanner-video'), statusEl);
      return;
    }

    // Save immediately — no modal
    books.unshift(bd);
    saveLocal();
    if (useCloud()) {
      apiFetch('/api/books', { method: 'POST', body: JSON.stringify(bd) }).catch(() => {});
    }

    statusEl.innerHTML = `<span style="color:#4caf50">✅ Added "<strong>${esc(bd.title)}</strong>"</span>`;

    // Brief success pause then continue scanning for next book
    await new Promise(r => setTimeout(r, 1500));
    statusEl.textContent = 'Ready — scan next book';
    _scannerCooldown = false;
    _scannerRunning  = true;
    _startScanLoop(document.getElementById('scanner-video'), statusEl);

  } catch(e) {
    statusEl.innerHTML = `<span style="color:#c06060">⚠️ Lookup failed: ${e.message}</span>`;
    await new Promise(r => setTimeout(r, 2000));
    _scannerCooldown = false;
    _scannerRunning  = true;
    _startScanLoop(document.getElementById('scanner-video'), statusEl);
  }
}


// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
(async () => {
  // ── Storage availability check — run before anything else ─────────
  // If localStorage is unavailable (private browsing, quota exceeded, browser policy)
  // we need to know immediately rather than silently losing data.
  try {
    const _testKey = '__salena_storage_test__';
    localStorage.setItem(_testKey, '1');
    if (localStorage.getItem(_testKey) !== '1') throw new Error('Read-back failed');
    localStorage.removeItem(_testKey);
  } catch(e) {
    // Show a prominent persistent warning — cannot recover without user action
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  min-height:100vh;padding:40px;font-family:sans-serif;background:#fdf8f2;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:16px">⚠️</div>
        <h2 style="color:#8a3030;margin-bottom:12px">Storage Unavailable</h2>
        <p style="color:#5a4030;max-width:420px;line-height:1.7;margin-bottom:20px">
          Salena's Bookshelf couldn't access browser storage.
          This usually means you're in <strong>Private/Incognito mode</strong>,
          or your browser has storage disabled for this site.
        </p>
        <p style="color:#8a7060;max-width:420px;line-height:1.7">
          Please open the app in a regular (non-private) browser window,
          or enable cookies/storage for <strong>${location.hostname}</strong> in your browser settings.
        </p>
        <button onclick="location.reload()"
          style="margin-top:24px;padding:12px 28px;background:#D4967A;color:#fff;
                 border:none;border-radius:24px;font-size:1rem;cursor:pointer">
          Try Again
        </button>
      </div>`;
    return; // Stop init entirely
  }

  await openIDB();
  await loadCustomFonts();

  // Seed CSS var cache from computed stylesheet defaults BEFORE loadStyle runs.
  // This ensures getCSSVar returns real values even on a brand new install
  // where nothing is in localStorage yet.
  (() => {
    const computed = getComputedStyle(document.documentElement);
    const ALL_VARS = [
      ...COLOR_FIELDS.map(f => f.key),
      '--blush-light','--mauve-light','--card-radius','--pill-radius',
      '--font-display','--font-body','--font-accent',
      '--shelf-wood','--shelf-wood-dark','--shelf-plank-h','--shelf-spine-h',
      '--shelf-bg-top','--shelf-bg-bot','--shelf-grain',
    ];
    ALL_VARS.forEach(k => {
      const val = computed.getPropertyValue(k).trim();
      if (val) _cssVarCache[k] = val;
    });
  })();

  loadStyle();
  applyNavConfig();
  loadShelfConfig();

  // If no theme vars in localStorage, try to recover from cloud
  if (!localStorage.getItem(SK_THEME_VARS) && useCloud()) {
    await recoverSettingsFromCloud();
  }

  // Always clear search/filter inputs on load — browser session restore can
  // repopulate these with stale values that make the library appear empty
  const _libSearch   = document.getElementById('lib-search');
  const _mangaSearch = document.getElementById('manga-search-lib');
  if (_libSearch)   _libSearch.value   = '';
  if (_mangaSearch) _mangaSearch.value = '';

  setView(currentView);
  await loadBooks();
  await loadManga();

  // Auto-restore: if primary data is empty but autosave snapshot exists, recover silently
  const _restored = checkAndRestoreIfNeeded();
  if (_restored) {
    await loadBooks();
    await loadManga();
  }
  renderLibrary();
  // Render manga view too so shelf is ready if user navigates there
  setMangaView(currentMangaView);
  // Populate API settings UI with stored values
  initApiSettingsUI();

  const seEl = document.getElementById('sync-status');
  const mbEl = document.getElementById('migrate-bar');
  if (useCloud()) {
    if (seEl) seEl.innerHTML = '☁️ <strong>Cloud sync active.</strong>';
    if (mbEl) mbEl.style.display = 'flex';
  } else {
    if (seEl) seEl.innerHTML = '💾 <strong>Local storage mode.</strong> Set <code>API_URL</code> in app.js to enable cloud sync.';
    if (mbEl) mbEl.style.display = 'none';
  }
})();
