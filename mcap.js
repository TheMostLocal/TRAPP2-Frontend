/* ============================================================
   >>> DESTINATION: TheMostLocal/TRAPP2-Frontend
   >>> FILE PATH:   mcap.js
   z202 - MARKET CAP BY THE FORMULA. Owner 11-21: "instead of relying on yahoo finance to give us market cap we can
   simply use the price and outstanding shares to find this and compare with Yahoo and take the most accurate info".
   TRAPP2-ANALYTICS data/sec/shares.json (pipeline/shares.py, with the SEC run twice a day) says per ticker which share
   count to trust: the SEC's own cover count (dei:EntityCommonStockSharesOutstanding) where Yahoo agrees within 2 % or
   the diluted count corroborates it, Yahoo's (the count its market cap implies) where they disagree - flagged. This
   module makes the app's market caps = price x that count:
     * Stock Book rows (applyOverridesToRow, the rows' final layer; and the rows already loaded when the file
       arrives): marketCap / sharesOutstanding (+ the raw marketcap / shares twins); Yahoo's figures kept in
       row._yahooMcap / row._yahooShares; provenance in row._mcapSrc. A human override (XTRAPP) still wins.
     * the valuation (normalizeStock): marketCap, sharesOutstanding (per-share values use the filed count), the
       enterprise value's market-cap term.
     * the badge under Market Cap (renderMarketCapCheck): what the number is and how it was checked - the old badge
       multiplied the price by Yahoo's OWN count, so it could only ever agree with Yahoo.
   Checked at use: when the count Yahoo's market cap implies now is > 10 % from the file's (a split since the file),
   Yahoo's figure stays. Foreign listings and funds without a filing are not in the file: untouched. In memory only.
   ============================================================ */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' && GH_RAW ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const S = { doc: null, loading: null, patched: 0 };
  const num = v => { if (v == null || v === '') return null; const x = typeof v === 'string' ? parseFloat(v.replace(/[$,]/g, '')) : +v; return isFinite(x) ? x : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const big = n => { const a = Math.abs(n); return a >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n).toLocaleString('en-US'); };
  const when = d => { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return d; } };
  const entry = t => (S.doc && S.doc.tickers && S.doc.tickers[String(t || '').toUpperCase()]) || null;
  // checked at use: the count Yahoo's market cap implies NOW against the file's - more than 10 % apart means something
  // happened since the file was built (a split, an issue); Yahoo's figure then stays (the bot does the same)
  const moved = (sh, ym, px) => !!(ym && px && sh) && Math.abs(sh / (ym / px) - 1) > 0.10;

  function load() {
    if (S.doc) return Promise.resolve(S.doc);
    if (S.loading) return S.loading;
    S.loading = fetch(`${RAW()}/TRAPP2-ANALYTICS/main/data/sec/shares.json?_=${Math.floor(Date.now() / 3600e3)}`, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { S.doc = d && d.tickers ? d : null; S.loading = null; if (S.doc) patchLoaded(); return S.doc; });
    return S.loading;
  }

  // ---- a Stock Book row -----------------------------------------------------------------------------------------
  function patchRow(row) {
    if (!row || !row.ticker || !S.doc) return false;
    const e = entry(row.ticker);
    if (!e || !(e.s > 0)) return false;
    if (row._usdNormalized || row._localCurrency || row._currencyUnconverted) return false;     // converted foreign rows: not ours
    const pre = row._preOverride || {};
    if ('marketCap' in pre || 'marketcap' in pre || 'sharesOutstanding' in pre || 'shares' in pre) return false;   // XTRAPP wins
    const px = num(row.price);
    if (!(px > 0)) return false;
    if (row._mcapSrc && row._mcapSrc.s === e.s && row._mcapSrc.px === px) return false;
    if (!row._mcapSrc) {
      const ym = num(row.marketCap != null ? row.marketCap : row.marketcap);
      if (moved(e.s, ym, px)) return false;                // Yahoo's count moved > 10 % since the file (a split?): keep Yahoo
      row._yahooMcap = ym;
      row._yahooShares = num(row.sharesOutstanding != null ? row.sharesOutstanding : row.shares);
    }
    const mc = px * e.s;
    row.marketCap = mc;
    if ('marketcap' in row) row.marketcap = mc;
    row.sharesOutstanding = e.s;
    if ('shares' in row) row.shares = e.s;
    row._mcapSrc = { s: e.s, px, p: e.p, st: e.st, se: e.se || null, y: e.y || null, dx: e.dx == null ? null : e.dx, dl: e.dl || null };
    S.patched++;
    return true;
  }
  function patchLoaded() {
    try {
      const rows = (typeof state !== 'undefined' && state && state.stockbook && state.stockbook.rows) || [];
      rows.forEach(patchRow);
    } catch (e) {}
  }

  // ---- the valuation's stock object -----------------------------------------------------------------------------
  function patchStock(s) {
    if (!s || !s.ticker || !S.doc) return s;
    const e = entry(s.ticker), px = num(s.price);
    if (!e || !(e.s > 0) || !(px > 0) || s._mcapCheck) return s;
    const yh = num(s.marketCap);
    if (moved(e.s, yh, px)) return s;                       // a split / issue since the file was built: Yahoo's stays
    s._yahooMarketCap = yh;
    s._yahooShares = num(s.sharesOutstanding);
    s.marketCap = px * e.s;
    s.sharesOutstanding = e.s;
    if (num(s.enterpriseValue) != null && yh != null) s.enterpriseValue = num(s.enterpriseValue) - yh + s.marketCap;   // EV = cap + debt - cash
    if (s._sources) {
      s._sources.marketCap = [s.marketCap].concat(s._sources.marketCap || []);
      s._sources.shares = [e.s].concat(s._sources.shares || []);
    }
    s._mcapCheck = Object.assign({ px }, e);
    return s;
  }

  // ---- the badge under Market Cap -------------------------------------------------------------------------------
  function badgeHtml(s) {
    const e = s && (s._mcapCheck || entry(s.ticker));
    if (!e) return null;
    const px = num(s.price) || e.px;
    const dx = e.dx == null ? '' : `${e.dx > 0 ? '+' : ''}${(+e.dx).toFixed(1)}%`;
    const cover = e.se ? `SEC cover ${when(e.se[1])}` : '';
    const lines = [`Market cap = price × shares = $${(+px).toFixed(2)} × ${big(e.s)} (${e.p === 'sec' ? 'the SEC count' : "Yahoo's count"})`];
    if (e.se) lines.push(`SEC cover count: ${big(e.se[0])} shares as of ${when(e.se[1])} (dei:EntityCommonStockSharesOutstanding)`);
    if (e.y) lines.push(`Yahoo's count (its market cap / price): ${big(e.y)}${dx ? ` - the SEC's is ${dx} vs it` : ''}`);
    if (e.dl) lines.push(`Diluted weighted shares (latest 10-Q / 10-K, ${when(e.dl[1])}): ${big(e.dl[0])}`);
    if (e.ym) lines.push(`Yahoo's market cap at the pipeline's price: $${big(e.ym)}`);
    lines.push(`Rule: within 2 % = verified; 2-10 % = the SEC's only if the diluted count sides with it; over 10 % = Yahoo kept (a split, an ADR ratio or a class count) until reviewed. Source: TRAPP2-ANALYTICS data/sec/shares.json (${S.doc && S.doc.date ? S.doc.date : ''}).`);
    const T = {
      verified: ['var(--pos)', `✓ price × SEC shares (${cover}) · Yahoo agrees (${dx})`],
      sec: ['var(--pos)', `✓ price × SEC shares (${cover}) · Yahoo's count ${dx} off; the diluted count sides with the SEC`],
      'sec-only': ['var(--pos)', `✓ price × SEC shares (${cover}) · no Yahoo count to compare`],
      near: ['var(--data-amber, var(--amber))', `≈ price × Yahoo's count · the SEC cover (${e.se ? when(e.se[1]) : '—'}) is ${dx} off and nothing independent decides`],
      check: ['var(--data-amber, var(--amber))', `? price × Yahoo's count · the SEC cover count is ${dx} off - a split, an ADR ratio or a class count? (flagged for review)`],
      'yahoo-only': ['var(--ink-faint)', "· price × Yahoo's count · no SEC cover count (multi-class, a fund or a foreign filer)"],
    }[e.st] || ['var(--ink-faint)', '· price × shares'];
    return { color: T[0], text: T[1], title: lines.join('\n') };
  }
  async function renderBadge(stock) {
    const b = badgeHtml(stock);
    const el = document.getElementById('s-mcap');
    if (!b || !el || !el.parentElement) return false;
    el.parentElement.querySelectorAll('.mcap-check').forEach(n => n.remove());
    const d = document.createElement('div');
    d.className = 'mcap-check';
    d.title = b.title;
    d.style.cssText = `font-family:var(--mono);font-size:10px;margin-top:4px;cursor:help;letter-spacing:0.02em;line-height:1.35;color:${b.color}`;
    d.textContent = b.text;
    el.parentElement.appendChild(d);
    return true;
  }

  // ---- hooks into app.js's global functions (the established wrap pattern: navgroups wraps switchTab) -------------
  function hook(name, make) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig._z202) return false;
    const w = make(orig);
    w._z202 = true;
    window[name] = w;
    return true;
  }
  function install() {
    const a = hook('applyOverridesToRow', orig => function (row) { const r = orig.apply(this, arguments); try { patchRow(row); } catch (e) {} return r; });
    const b = hook('normalizeStock', orig => function () { const s = orig.apply(this, arguments); try { patchStock(s); } catch (e) {} return s; });
    const c = hook('renderMarketCapCheck', orig => async function (stock) {
      if (!S.doc) await load();
      try {
        if (stock && !stock._mcapCheck && entry(stock.ticker)) {          // the file arrived after the page was built
          patchStock(stock);
          const el = document.getElementById('s-mcap');
          if (el && stock._mcapCheck && typeof fmt$ === 'function') { el.textContent = fmt$(stock.marketCap); el.title = String(Math.round(stock.marketCap)); }
        }
        if (await renderBadge(stock)) return;
      } catch (e) {}
      return orig.apply(this, arguments);
    });
    return a && b && c;
  }
  if (!install()) document.addEventListener('DOMContentLoaded', install);
  load();
  window.MarketCapFormula = { load, entry, patchRow, patchStock, badgeHtml, _S: S };
})();
