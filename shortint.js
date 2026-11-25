/* ============================================================
   >>> DESTINATION: TheMostLocal/TRAPP2-Frontend
   >>> FILE PATH:   shortint.js
   z207 - SHORT SELLING, OFFICIAL (FINRA). Owner 11-24: "notice sell-offs, short covering and hedging". Yahoo's "short %
   of float" disagreed with FINRA's own numbers by 3-300x on 11-25 (WHR 0.1 % vs 32 % of the shares; CHTR 45 % vs 9 %),
   so the stock summary now shows FINRA's: TRAPP2-ANALYTICS data/short/index.json (pipeline/fetch_short.py, twice a
   weekday with the SEC run):
     * consolidated short interest at the latest settlement (twice a month, published about 7 business days later):
       shares short, as a share of the shares outstanding (the SEC count the app trusts - mcap.js / data/sec/shares.json
       - or the stock's own count, said which), the change since the settlement before (none across a split), FINRA's
       average daily volume and days to cover
     * Reg SHO short sales on FINRA's latest day: short share of volume, its 5- and 20-session averages and how
       unusual today is (sd against the 20 sessions before it) - market makers' hedges included: read the change
     * the crowded-short rule the bot and the quant book apply (15 %+ of the shares or 10+ days to cover; 8 % / 7 days
       while shorts are being covered), and Yahoo's figure beside FINRA's when the two disagree
   The file (~550 KB, gzip ~150 KB) loads when the first stock is opened; in memory only (no storage).
   ============================================================ */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' && GH_RAW ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const S = { doc: null, loading: null, failedAt: 0, latest: null };
  const num = v => { if (v == null || v === '') return null; const x = typeof v === 'string' ? parseFloat(v.replace(/[$,%]/g, '')) : +v; return isFinite(x) ? x : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = t => String(t || '').toUpperCase().trim().replace(/\./g, '-');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '—'; };
  const cnt = n => { if (n == null || !isFinite(n)) return '—'; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)); };
  const pc = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
  const share = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${(100 * v).toFixed(d)}%`);
  const sd1 = v => { const r = Math.round(+v * 10) / 10; return r === 0 ? '0.0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`; };
  // the bars the bot (TRAPP2-BOT risk_book.crowded_short) and the quant book (quant/tape.py) apply
  const RULE = { so: 0.15, dtc: 10, squeezeSo: 0.08, squeezeDtc: 7, dtcMinSo: 0.05 };

  function load() {
    if (S.doc) return Promise.resolve(S.doc);
    if (S.loading) return S.loading;
    if (S.failedAt && Date.now() - S.failedAt < 600e3) return Promise.resolve(null);
    S.loading = fetch(`${RAW()}/TRAPP2-ANALYTICS/main/data/short/index.json?_=${Math.floor(Date.now() / 3600e3)}`, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => {
        S.doc = d && (d.interest || d.volume) ? d : null; S.loading = null; S.failedAt = S.doc ? 0 : Date.now();
        if (S.doc) {                                           // FINRA's newest settlement (the file says it from z207 on)
          S.latest = (S.doc.settlements && S.doc.settlements.latest) || Object.values(S.doc.interest || {}).reduce((m, e) => (e && e.settlementDate > m ? e.settlementDate : m), '') || null;
          onArrive();
        }
        return S.doc;
      });
    return S.loading;
  }
  const entry = t => {
    if (!S.doc) return null;
    const k = T(t), i = (S.doc.interest || {})[k], v = (S.doc.volume || {})[k];
    return i || v ? { i: i || null, v: v || null } : null;
  };
  const usdListing = s => { const c = String((s && s.currency) || 'USD').toUpperCase(); return c === 'USD' && !/\.[A-Z]{1,4}$/.test(String((s && s.ticker) || '').toUpperCase()); };

  // the share count: the SEC's (mcap.js, data/sec/shares.json) when it has one, else the stock's own
  function sharesOut(s) {
    try {
      const mf = window.MarketCapFormula && window.MarketCapFormula.entry && window.MarketCapFormula.entry(s.ticker);
      if (mf && num(mf.s) > 0) return { n: num(mf.s), src: mf.p === 'sec' ? 'the SEC\'s cover count' : 'the trusted count (data/sec/shares.json)' };
    } catch (e) { /* not loaded */ }
    const n = num(s.sharesOutstanding);
    return n > 0 ? { n, src: 'the stock\'s own share count' } : null;
  }
  const yahooFloat = s => {
    const v = num((s.sheetRow || {}).shortpctfloat != null ? s.sheetRow.shortpctfloat : s.shortPctFloat);
    return v != null && v > 0 && v <= 1 ? v : null;
  };

  function crowd(pct, dtc) {
    if (pct == null) return null;
    const d = dtc == null ? 0 : dtc;
    if (pct >= RULE.so || (d >= RULE.dtc && pct >= RULE.dtcMinSo)) return { lvl: 2, text: `a crowded short - the bot and the quant book open no short sale here (${share(RULE.so, 0)}+ of the shares or ${RULE.dtc}+ days to cover)` };
    if (pct >= RULE.squeezeSo || (d >= RULE.squeezeDtc && pct >= RULE.dtcMinSo)) return { lvl: 1, text: `on the watch list - no new short sale while shorts are being covered (${share(RULE.squeezeSo, 0)}+ of the shares or ${RULE.squeezeDtc}+ days)` };
    return null;
  }

  function cell(label, value, sub, color, title) {
    return `<div title="${esc(title || '')}"><div style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.14em;color:var(--ink-dim)">${esc(label)}</div>
      <div style="font-family:var(--mono);font-size:15px;margin-top:3px;color:${color || 'var(--ink)'}">${value}</div>${sub ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px">${sub}</div>` : ''}</div>`;
  }

  function blockHtml(s) {
    const e = s && s.ticker && entry(s.ticker);
    if (!e || !usdListing(s)) return null;
    const i = e.i, v = e.v, cells = [], notes = [];
    let pct = null, so = null, cr = null;
    if (i && num(i.shares) != null) {
      so = sharesOut(s);
      pct = so && num(i.shares) / so.n <= 1 ? num(i.shares) / so.n : null;
      const dtc = num(i.daysToCover);
      cr = crowd(pct, dtc);
      cells.push(cell('Shares short', cnt(num(i.shares)), `settled ${esc(day(i.settlementDate))}`, null, 'FINRA consolidated short interest: shares sold short and not yet covered at the settlement date, all US venues.'));
      cells.push(cell('Of the shares out', share(pct), so ? `on ${esc(so.src)}` : 'no share count', cr ? (cr.lvl === 2 ? 'var(--neg)' : 'var(--amber)') : null,
        'Shares short / shares outstanding. FINRA publishes shares, not a percentage; "of the float" (Yahoo) uses a smaller denominator.'));
      cells.push(cell('Change', i.split ? 'split' : pc(num(i.changePct)), i.split ? 'not comparable across the split' : (num(i.prevShares) != null ? `from ${cnt(num(i.prevShares))} the settlement before` : ''),
        !i.split && num(i.changePct) != null && Math.abs(num(i.changePct)) >= 10 ? 'var(--amber)' : null, 'Shares short vs the previous settlement (about two weeks earlier).'));
      cells.push(cell('Days to cover', dtc != null ? dtc.toFixed(1) : '—', num(i.avgDailyVolume) != null ? `${cnt(num(i.avgDailyVolume))} shares a day (FINRA)` : '',
        dtc != null && dtc >= RULE.squeezeDtc ? 'var(--amber)' : null, 'Shares short / the average daily volume FINRA reports for the settlement period - how many days of normal trading it would take to buy them back.'));
    }
    if (v && num(v.ratio1d) != null) {
      const z = num(v.z);
      cells.push(cell('Short sales today', `${(+v.ratio1d).toFixed(0)}%`, `of volume · ${esc(day(v.date))}`, null, 'Reg SHO: short-sale volume / total reported volume on FINRA\'s consolidated NMS file for the day.'));
      cells.push(cell('5 / 20 sessions', `${num(v.ratio5d) != null ? (+v.ratio5d).toFixed(0) : '—'}% / ${num(v.ratio20d) != null ? (+v.ratio20d).toFixed(0) : '—'}%`, z != null ? `today ${sd1(z)} sd vs the 20 before` : '',
        z != null && Math.abs(z) >= 2 ? 'var(--amber)' : null, 'The short share of volume averaged over the last 5 and 20 sessions; today scored against the 20 sessions before it.'));
    }
    if (!cells.length) return null;
    if (cr) notes.push(`<span style="color:${cr.lvl === 2 ? 'var(--neg)' : 'var(--amber)'}">${esc(cr.text)}.</span>`);
    const yf = yahooFloat(s);
    if (yf != null && pct != null && (yf > 2.5 * pct || yf < pct / 2.5)) notes.push(`Yahoo shows ${share(yf)} of the float short - far from FINRA's ${share(pct)} of the shares outstanding; FINRA's is the one used.`);
    if (i && S.latest && i.settlementDate < S.latest) notes.push(`<span style="color:var(--amber)">This name is on the ${esc(day(i.settlementDate))} settlement; FINRA's newest is ${esc(day(S.latest))}.</span>`);
    notes.push('Short sales (Reg SHO) count every short sale, market makers\' hedges included - about half of all volume on a normal day: read the change, not the level.');
    const head = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 14px;align-items:baseline">
        <span style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.2em;color:var(--ink-dim)">Short selling · FINRA (official)</span>
        <span style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">short interest twice a month, ~7 business days after its settlement · short sales daily</span></div>`;
    return `${head}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));gap:12px 18px;margin-top:10px">${cells.join('')}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:10px;line-height:1.5">${notes.map(n => `<div>· ${n}</div>`).join('')}</div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:8px">TRAPP2-ANALYTICS data/short/index.json · ${esc(String(S.doc.asOf || '').replace('T', ' ').replace('Z', ' UTC'))}</div>`;
  }

  function renderBlock(s) {
    let el = document.getElementById('s-shortint');
    const html = s ? blockHtml(s) : null;
    if (!html) { if (el) el.remove(); return false; }
    const after = () => document.getElementById('s-asfiled') || document.getElementById('s-mstats') || document.getElementById('s-52w-bar-wrap');
    if (!el) {
      el = document.createElement('div');
      el.id = 's-shortint';
      el.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)';
      const a = after();
      if (a && a.parentNode) a.parentNode.insertBefore(el, a.nextSibling);
      else { const sum = document.getElementById('summary'); if (!sum) return false; sum.appendChild(el); }
    } else {
      const a = after();                                       // keep it under the as-filed block / market statistics
      if (a && a.nextSibling !== el) a.parentNode.insertBefore(el, a.nextSibling);
    }
    el.innerHTML = html;
    return true;
  }
  function onArrive() {
    try {
      const s = typeof state !== 'undefined' && state && state.stock;
      if (s && document.getElementById('summary') && document.getElementById('summary').classList.contains('visible')) renderBlock(s);
    } catch (e) { /* no summary on screen */ }
  }

  function hook(name, make) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig._z207) return false;
    const w = make(orig);
    w._z207 = true;
    Object.keys(orig).forEach(k => { if (!(k in w)) w[k] = orig[k]; });   // keep earlier wrappers' flags (z204's)
    window[name] = w;
    return true;
  }
  function install() {
    return [
      hook('fetchStock', orig => async function () {
        load();                                                // the first stock opened starts the load, in parallel
        return orig.apply(this, arguments);                    // no wait: the block arrives with the file
      }),
      hook('renderSummary', orig => function (s) {
        const r = orig.apply(this, arguments);
        try { if (s) renderBlock(s); } catch (e) { /* the summary stands without it */ }
        return r;
      }),
    ].every(Boolean);
  }
  if (!install()) document.addEventListener('DOMContentLoaded', install);
  window.ShortInterest = { load, entry, blockHtml, renderBlock, crowd, RULE, _S: S };
})();
