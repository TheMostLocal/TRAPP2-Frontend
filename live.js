/* ==========================================================================
   live.js — z159, PHASE 2: live data from Supabase, GitHub as the fallback.
   · quotes   Analytics project, live_quotes - polled every 60 s while the page is visible, only rows newer
              than the last poll (incremental), applied to the Stock Book's US rows (price, day change, high /
              low / open / prior close, volume; market cap scaled with price). Foreign-currency rows keep
              their GitHub path (their USD conversion happens on load).
   · bars     Analytics project, live_bars_day - one row per ticker per day (charts.js asks here first)
   · journal  Bot project, bot_state 'journal' - a 1-row head check first; the full journal only when the
              runner has written a newer one (botmirror.js asks here first)
   Credentials: the projects' URL + anon key already in the app (Home → Connections; app_config.json).
   Anything missing or slow (4 s) → the GitHub path, exactly as before.
   ========================================================================== */
(function () {
  'use strict';
  const clean = u => String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  function proj(kind) {
    let u = '', a = '';
    try {
      if (kind === 'analytics') { u = typeof getAnalyticsSupabaseUrl === 'function' ? getAnalyticsSupabaseUrl() : ''; a = typeof getAnalyticsSupabaseAnon === 'function' ? getAnalyticsSupabaseAnon() : ''; }
      else { u = typeof getSupabaseUrl === 'function' ? getSupabaseUrl() : ''; a = typeof getSupabaseAnon === 'function' ? getSupabaseAnon() : ''; }
    } catch (e) {}
    u = clean(u); a = String(a || '').trim();
    return u && a ? { u, a } : null;
  }
  async function q(kind, path, ms = 4000) {
    const p = proj(kind);
    if (!p) return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const tm = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
      const r = await fetch(p.u + path, { headers: { apikey: p.a, Authorization: 'Bearer ' + p.a, Accept: 'application/json' }, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; } finally { if (tm) clearTimeout(tm); }
  }
  const S = { since: null, polls: 0, applied: 0, lastAt: 0, lastN: 0, src: null };
  const usTicker = t => /^[A-Z][A-Z0-9-]{0,6}$/.test(t) && !t.endsWith('-USD');
  const visible = id => !!document.querySelector(`.tab-btn[data-tab="${id}"].active`);

  // ---- quotes ----
  function applyQuotes(rows) {
    const book = (typeof state !== 'undefined' && state.stockbook && state.stockbook.rows) || [];
    if (!book.length) return 0;
    const byT = new Map(book.map(r => [String(r.ticker || '').toUpperCase(), r]));
    let n = 0;
    for (const lv of rows) {
      const t = String(lv.ticker || '').toUpperCase(), r = byT.get(t);
      if (!r || !usTicker(t) || r._usdNormalized || r._currencyUnconverted) continue;
      const px = +lv.price;
      if (!(px > 0)) continue;
      const old = +r.price;
      r.price = px;
      if (old > 0 && +r.marketCap > 0) r.marketCap = +r.marketCap * px / old;
      if (lv.volume != null) r.volume = +lv.volume;
      const raw = r.rawRow;
      if (raw && typeof raw === 'object') {
        for (const [k, v] of [['price', px], ['change', lv.change], ['changepct', lv.changepct], ['closeyest', lv.closeyest], ['high', lv.high], ['low', lv.low], ['priceopen', lv.priceopen], ['fetched_at', lv.fetched_at]]) {
          if (v != null) raw[k] = String(v);
        }
      }
      r._live = { at: lv.fetched_at, src: 'supabase' };
      n++;
    }
    return n;
  }
  async function pollQuotes(force) {
    if (!force && document.hidden) return 0;
    if (!proj('analytics')) return 0;
    const f = S.since ? `&fetched_at=gt.${encodeURIComponent(S.since)}` : '';
    const rows = await q('analytics', `/rest/v1/live_quotes?select=ticker,price,change,changepct,priceopen,high,low,closeyest,volume,fetched_at${f}&order=fetched_at.asc&limit=5000`);
    S.polls++;
    if (!Array.isArray(rows)) { S.src = 'github'; return 0; }
    S.src = 'supabase'; S.lastAt = Date.now();
    if (!rows.length) return 0;
    S.since = rows[rows.length - 1].fetched_at;
    const n = applyQuotes(rows);
    S.applied += n; S.lastN = n;
    try { if (n && visible('stockbook') && typeof renderStockBook === 'function') renderStockBook(); } catch (e) {}
    return n;
  }

  // ---- bars (charts.js) ----
  const etNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  async function bars(ticker) {
    const t = String(ticker || '').toUpperCase();
    const rows = await q('analytics', `/rest/v1/live_bars_day?ticker=eq.${encodeURIComponent(t)}&select=date,pc,oo,oc,ext,b,updated_at&order=date.desc&limit=1`);
    const r = Array.isArray(rows) && rows[0];
    if (!r || !Array.isArray(r.b) || r.b.length < 2) return null;
    // during the extended session a row more than 45 minutes old means the pushes stopped - use GitHub
    const e = etNow(), m = e.getHours() * 60 + e.getMinutes();
    if (e.getDay() >= 1 && e.getDay() <= 5 && m >= 240 && m < 1200 && r.updated_at && Date.now() - Date.parse(r.updated_at) > 45 * 60000) return null;
    const pos = v => (v != null && +v > 0 ? +v : null);
    return { date: r.date, interval: 5, updatedAt: r.updated_at || null, prevClose: pos(r.pc), oo: pos(r.oo), oc: pos(r.oc), ext: r.ext || null, source: 'supabase',
             bars: r.b.map(x => ({ t: x[0] * 1000, o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] || 0 })) };
  }

  // ---- journal (botmirror.js) ----
  const J = { gen: null, doc: null };
  async function journal() {
    const head = await q('bot', '/rest/v1/bot_state?id=eq.journal&select=generated_at,updated_at');
    const h = Array.isArray(head) && head[0];
    if (!h) return null;
    if (J.doc && J.gen && h.generated_at && Date.parse(h.generated_at) <= Date.parse(J.gen)) return { doc: J.doc, generatedAt: J.gen, unchanged: true };
    const full = await q('bot', '/rest/v1/bot_state?id=eq.journal&select=doc,generated_at', 10000);
    const d = Array.isArray(full) && full[0] && full[0].doc;
    if (!d || !Array.isArray(d.trades)) return null;
    J.doc = d; J.gen = full[0].generated_at || d.generatedAt || null;
    return { doc: d, generatedAt: J.gen, unchanged: false };
  }

  // the Stock Book: one poll right after every load, then every 60 s
  (function () {
    const orig = typeof window.loadStockBook === 'function' ? window.loadStockBook : null;
    if (orig && !orig._z159) {
      const w = async function () { const r = await orig.apply(this, arguments); S.since = null; try { await pollQuotes(true); } catch (e) {} return r; };
      w._z159 = true;
      window.loadStockBook = w;
    }
  })();
  setInterval(() => { pollQuotes(false).catch(() => {}); }, 60000);
  window.LiveData = { pollQuotes, applyQuotes, bars, journal, status: () => Object.assign({}, S), _proj: proj };
})();
