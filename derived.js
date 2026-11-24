/* ============================================================
   >>> DESTINATION: TheMostLocal/TRAPP2-Frontend
   >>> FILE PATH:   derived.js
   z203 - MARKET STATISTICS BY THE FORMULA ("derive, don't fetch", owner 11-21 0951 ET). TRAPP2-ANALYTICS
   data/derived/market.json (pipeline/derived.py, in the analytics run) computes, for every ticker in the five books,
   from the books' own daily closes (split-adjusted, price only): the 52-week CLOSING range, the 50- / 200-day
   averages, average and dollar volume, realized volatility, beta vs the S&P 500 (60 completed monthly returns -
   Yahoo's "5Y Monthly" method, within 0.01 of Yahoo's on US issuers - and 252 daily), trailing returns and the 52-week
   drawdown, each checked against Yahoo's figure where Yahoo has one. This module:
     * FILLS what the master rows leave blank (in memory, never over a value or a human override): the Stock Book
       rows' 52-week high / low (blank in every TRAPP2 / -1 / -2 / -3 row), beta (US-listed USD equities and ETFs - LOW,
       TJX, TGT, SPY, QQQ, the sector SPDRs ... had none, so the valuation's CAPM assumed 1.00) and average volume
     * REPLACES Yahoo's 52-week range where our closes prove it wrong (a close outside Yahoo's intraday range, or
       Yahoo's extreme a split factor beyond every close - a split Yahoo never re-based: APH, MLI, PIPR ...), Yahoo's
       kept beside it
     * the valuation (normalizeStock): the same 52-week fill / replacement, and a computed beta where no source has
       one - the CAPM then uses it instead of the 1.00 assumption. Where nothing has a beta the cell now says "assumed",
       and the Stock Book no longer receives the 1.00 as if it were data (syncStockToStockbook)
     * the summary: the "52W Range" cell says when it is our closing range; the Beta cell says "calc" / "assumed";
       a MARKET STATISTICS block under the 52-week bar (every figure above with its basis, checks and flags)
   fetchStock waits up to 3 s more for the file (loading since the page opened) once the stock's data is in, so the first
   valuation already has it; a file that arrives later only adds the block - the beta the valuation ran with is never
   changed under it.
   z205 - THE HOLY GRAIL (Risk tab) FROM OUR CLOSES. "Import from Stock Book" (and a ticker typed into a leg) set a
   leg's volatility as beta x 18 (15-60 %) and its correlation as 55 % - rough mappings. Now, where the file has the
   ticker: volatility = its 1-year realized volatility (s252; the 60-day one when the year holds a one-session jump),
   correlation = a one-factor estimate - the leg's daily correlation with the S&P 500 (sign of the 252-day beta x the
   square root of its R²) times the other stock legs' average. A pair whose histories are loaded is still measured
   directly by the app; only the fallback changes. A value is replaced only where the app had just put its rough one
   (never a typed figure), is marked (dotted, with its basis on hover) until edited, and a stale / mismatched / jumpy
   history is not used.
   ============================================================ */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' && GH_RAW ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const S = { doc: null, loading: null, filled: { r52: 0, x52: 0, beta: 0, adv: 0 } };
  const num = v => { if (v == null || v === '') return null; const x = typeof v === 'string' ? parseFloat(v.replace(/[$,%]/g, '')) : +v; return isFinite(x) ? x : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = t => String(t || '').toUpperCase().trim();
  const entry = t => (S.doc && S.doc.tickers && S.doc.tickers[T(t)]) || null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '—'; };
  const dayShort = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]} '${m[1].slice(2)}` : '—'; };
  const signed = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
  const tone = v => (v == null || !isFinite(v) || v === 0 ? 'var(--ink)' : v > 0 ? 'var(--pos)' : 'var(--neg)');
  const big = n => { if (n == null || !isFinite(n)) return '—'; const a = Math.abs(n); return a >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : a >= 1e3 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n)); };
  const unit = t => { t = T(t); return t.endsWith('=X') ? 'fx' : (t.startsWith('^') || t === 'DX-Y.NYB') ? 'index' : 'money'; };

  function load() {
    if (S.doc) return Promise.resolve(S.doc);
    if (S.loading) return S.loading;
    if (S.failedAt && Date.now() - S.failedAt < 600e3) return Promise.resolve(null);     // not there: ask again in 10 min, not per stock
    S.loading = fetch(`${RAW()}/TRAPP2-ANALYTICS/main/data/derived/market.json?_=${Math.floor(Date.now() / 3600e3)}`, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { S.doc = d && d.tickers ? d : null; S.loading = null; S.failedAt = S.doc ? 0 : Date.now(); if (S.doc) onArrive(); return S.doc; });
    return S.loading;
  }
  const waitDoc = ms => (S.doc ? Promise.resolve(S.doc) : Promise.race([load(), new Promise(r => setTimeout(() => r(null), ms))]));

  // ---- what may take our prices: quoted in USD (or an index level / a future / crypto in USD), not a converted
  //      foreign row and not a currency pair (its display can be inverted) ------------------------------------------
  function priceOk(x) {
    const t = T(x && x.ticker);
    if (!t || t.endsWith('=X') || /\.[A-Z]{1,4}$/.test(t)) return false;
    const c = String((x && x.currency) || '').toUpperCase();
    if (c && c !== 'USD') return false;
    if (x._currencyUnconverted) return false;
    if (x._localCurrency && String(x._localCurrency).toUpperCase() !== 'USD') return false;
    return true;
  }
  const blank = v => v == null || v === '' || !isFinite(+v) || +v === 0;
  const overridden = (row, f) => !!(row && row._preOverride && Object.prototype.hasOwnProperty.call(row._preOverride, f));

  // ---- a Stock Book row (applyOverridesToRow is the rows' final layer; and the rows loaded before the file came) ---
  function patchRow(row) {
    if (!row || !row.ticker || !S.doc) return false;
    const e = entry(row.ticker);
    if (!e) return false;
    let n = 0;
    const px = num(row.price);
    if (e.u52 && priceOk(row) && !overridden(row, 'high52') && !overridden(row, 'low52')) {
      const h0 = num(row.high52), l0 = num(row.low52);
      const fill = blank(h0) || blank(l0);
      if ((fill || e.x52) && !(row._derived && row._derived.r52)) {
        if (!fill) { row._yahooHigh52 = h0; row._yahooLow52 = l0; }
        row.high52 = Math.max(e.h52[0], px > 0 ? px : -Infinity);
        row.low52 = Math.min(e.l52[0], px > 0 ? px : Infinity);
        row._derived = Object.assign(row._derived || {}, { r52: fill ? 'fill' : 'x52' });
        S.filled[fill ? 'r52' : 'x52']++; n++;
      }
    }
    if (e.ub && blank(row.beta) && !overridden(row, 'beta')) {
      row.beta = e.ub[0];
      row._derived = Object.assign(row._derived || {}, { beta: e.ub[1] });
      S.filled.beta++; n++;
    }
    if (e.a63 && blank(row.avgVolume) && blank(row.volumeavg)) {
      row.avgVolume = e.a63;
      row._derived = Object.assign(row._derived || {}, { adv: 1 });
      S.filled.adv++; n++;
    }
    return n > 0;
  }
  function patchLoaded() {
    try {
      const rows = (typeof state !== 'undefined' && state && state.stockbook && state.stockbook.rows) || [];
      rows.forEach(patchRow);
    } catch (e) {}
  }

  // ---- the valuation's stock object (normalizeStock; env = its envelope) -------------------------------------------
  function reported52(env) {
    const r = (env && env.sheetRow) || null;
    const ov = (env && env.overview) || {};
    const k = ['high52', 'high 52', '52w high', '52 week high', '52-wk high'];
    const sn = (row, ...keys) => (typeof sheetNum === 'function' ? sheetNum(row, ...keys) : keys.map(f => num(row && row[f])).find(v => v != null));
    return (r && (sn(r, ...k) > 0 || sn(r, 'fmp52weekhigh', 'fmphigh52') > 0)) || num(ov['52WeekHigh']) > 0;
  }
  function betaSourced(s) {
    const b = (s && s._sources && s._sources.beta) || [];
    return b.slice(0, 2).some(v => v != null && isFinite(v) && v !== 0);        // the sheet's / Alpha Vantage's - the two the valuation picks from
  }
  function patchStock(s, env) {
    if (!s || !s.ticker || s._derivedDone) return s;
    const e = entry(s.ticker);
    s._derivedDone = !!S.doc;
    if (!e) { if (S.doc && !betaSourced(s)) s._betaDefault = true; return s; }
    const px = num(s.price);
    if (e.u52 && priceOk(s)) {
      const rep = reported52(env);
      if (!rep || e.x52) {
        if (rep) { s._yahooHigh52 = num(s.high52); s._yahooLow52 = num(s.low52); }
        const hi = Math.max(e.h52[0], px > 0 ? px : -Infinity), lo = Math.min(e.l52[0], px > 0 ? px : Infinity);
        s._r52 = { kind: rep ? 'x52' : 'fill', x: e.x52 || 0, h: e.h52, l: e.l52, since: e.since || null, ext: hi > e.h52[0] ? 'high' : lo < e.l52[0] ? 'low' : null };
        s.high52 = hi;
        s.low52 = lo;
      }
    }
    if (!betaSourced(s)) {
      if (e.ub) {
        s.beta = e.ub[0];
        s._betaSrc = { v: e.ub[0], m: e.ub[1], b: e.ub[1] === 'm' ? e.b5 : e.b1 };
      } else {
        s._betaDefault = true;
      }
    }
    return s;
  }

  // ---- the summary --------------------------------------------------------------------------------------------------
  const money = (s, v, dec) => {
    if (v == null || !isFinite(v)) return '—';
    const u = unit(s.ticker);
    if (u === 'index') return (typeof fmtNum === 'function' ? fmtNum(v, 2) : v.toFixed(2));
    const c = String(s.currency || 'USD');
    if (c.toUpperCase() !== 'USD') return `${(+v).toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 6 : 2 })} ${esc(c)}`;
    return typeof fmt$ === 'function' ? fmt$(v, dec) : '$' + (+v).toFixed(2);
  };
  const cell = (label, value, sub, color, title) => `<div style="min-width:0${title ? ';cursor:help' : ''}"${title ? ` title="${esc(title)}"` : ''}>
      <div style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.16em;color:var(--ink-dim);margin-bottom:3px">${label}</div>
      <div style="font-family:var(--mono);font-size:13px;font-weight:500;color:${color || 'var(--ink)'};overflow-wrap:anywhere">${value}</div>
      ${sub ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px;line-height:1.35">${sub}</div>` : ''}</div>`;

  function blockHtml(s) {
    const e = s && entry(s.ticker);
    if (!e) return null;
    const u = unit(s.ticker);
    const px = num(s.price) || e.px;
    const live = num(s.price) != null;
    const row = (typeof getStockbookRow === 'function' && getStockbookRow(s.ticker)) || {};
    const rel = (a, b) => (a > 0 && b > 0 ? 100 * (a / b - 1) : null);
    const cells = [];
    // 52 weeks
    if (u !== 'fx') {
      cells.push(cell('52W closing range', `${money(s, e.l52[0])} – ${money(s, e.h52[0])}`,
        e.since ? `since ${dayShort(e.since)} (all our history)` : `low ${dayShort(e.l52[1])} · high ${dayShort(e.h52[1])}`, null,
        'The lowest and highest CLOSE of the sessions dated after the same day a year earlier (Yahoo\'s 52-week range is intraday, so a closing range sits inside it).'));
    }
    const fh = rel(px, e.h52[0]), fl = rel(px, e.l52[0]);
    cells.push(cell('From 52W high', signed(fh), fh > 0 ? 'above every close of the year' : `${live ? 'live price' : 'last close'}`, tone(fh)));
    cells.push(cell('From 52W low', signed(fl), u === 'fx' ? `low ${dayShort(e.l52[1])}` : '', tone(fl)));
    if (u !== 'fx' && e.m50) cells.push(cell('50-day average', money(s, e.m50), `price ${signed(rel(px, e.m50))}`, null));
    if (u !== 'fx' && e.m200) cells.push(cell('200-day average', money(s, e.m200), `price ${signed(rel(px, e.m200))}`, null));
    if (e.ath) cells.push(cell('Record close', u === 'fx' ? signed(rel(px, e.ath[0])) : money(s, e.ath[0]),
      `${dayShort(e.ath[1])}${u === 'fx' ? '' : ` · ${signed(rel(px, e.ath[0]))}`}`, u === 'fx' ? tone(rel(px, e.ath[0])) : null,
      `The highest close in our history (since ${day(e.f)}, ${e.n.toLocaleString('en-US')} sessions).`));
    // risk
    const vols = [e.s20, e.s60, e.s252].map(v => (v == null ? '—' : v.toFixed(1)));
    if (e.s20 != null || e.s60 != null) cells.push(cell('Volatility (annual)', vols.join(' · ') + '%', `20d · 60d · 1y${e.ppy ? ` · ×√${e.ppy}` : ''}`, null,
      `Sample standard deviation of daily log returns, annualized by the sessions a year holds (${e.ppy || 252}).`));
    if (e.b5) {
      const yb = s._sources && s._sources.beta ? num(s._sources.beta[0]) : num(row.beta);
      const foreign = s.country && !/^(united states|usa?|)$/i.test(String(s.country).trim());
      let ysub = '';
      if (yb != null && !(s._betaSrc && s._betaSrc.v === yb)) {
        const g = Math.abs(e.b5[0] - yb);
        ysub = foreign ? ` · Yahoo ${yb.toFixed(2)} (not vs the S&P 500)` : ` · Yahoo ${yb.toFixed(2)} ${g <= 0.05 ? '✓' : g <= 0.15 ? '≈' : '≠'}`;
      }
      cells.push(cell('Beta · 5Y monthly', e.b5[0].toFixed(2), `R² ${e.b5[2].toFixed(2)} · ${e.b5[1]} mo${ysub}`, null,
        `OLS slope of ${e.b5[1]} completed monthly price returns on the S&P 500's (Yahoo's "Beta (5Y Monthly)" method; the current month is left out). R² = the share of the moves the market explains.`));
    }
    if (e.b1) cells.push(cell('Beta · 1Y daily', e.b1[0].toFixed(2), `R² ${e.b1[2].toFixed(2)} · ${e.b1[1]} sessions`, null,
      'OLS slope of the last 252 daily returns on the S&P 500\'s, on the sessions both traded. Faster to react, noisier; a foreign listing\'s daily beta reads low (the markets close at different hours).'));
    if (e.dd) cells.push(cell('Largest fall · 52W', e.dd[0] ? signed(e.dd[0]) : '0.0%', e.dd[1] ? `${dayShort(e.dd[1])} → ${dayShort(e.dd[2])}` : 'no fall from a high', e.dd[0] ? 'var(--neg)' : null,
      'The deepest close-to-close fall from a running high inside the 52 weeks.'));
    // liquidity
    if (e.a20 || e.a63) {
      const ya = row && !(row._derived && row._derived.adv) ? num(row.avgVolume != null ? row.avgVolume : row.volumeavg) : null;
      cells.push(cell('Average volume', `${big(e.a20)} · ${big(e.a63)}`, `20d · 3m${ya ? ` · Yahoo ${big(ya)}${e.a63 && Math.abs(e.a63 / ya - 1) > 0.25 ? ' ≠' : ''}` : ''}`, null,
        'Shares a day: the mean over the last 20 and 63 sessions (Yahoo\'s "Avg. Volume" is the 3-month one).'));
    }
    if (e.dv20) cells.push(cell('Dollar volume · 20d', u === 'money' && String(s.currency || 'USD').toUpperCase() === 'USD' ? (typeof fmt$ === 'function' ? fmt$(e.dv20) : big(e.dv20)) : big(e.dv20), 'traded a day (close × volume)', null));
    if (e.rv != null) cells.push(cell('Last volume', `${e.rv.toFixed(2)}×`, `vs the 63 before (${dayShort(e.d)})`, e.rv >= 2 ? 'var(--amber)' : null));
    // returns
    const R = e.r || {};
    const rets = [['1M', '1m'], ['3M', '3m'], ['6M', '6m'], ['YTD', 'ytd'], ['1Y', '1y'], ['3Y / yr', '3y'], ['5Y / yr', '5y']]
      .filter(([, k]) => R[k] != null).map(([l, k]) => cell(l, signed(R[k]), '', tone(R[k])));
    // notes
    const notes = [];
    const q = e.q || [];
    if (q.includes('stale')) notes.push(`<span style="color:var(--amber)">No session since ${day(e.d)} while the S&amp;P traded - stale history; nothing here is filled from it.</span>`);
    if (q.includes('short')) notes.push(`History since ${day(e.f)} - under a year: the range and the averages are since then.`);
    q.filter(x => /^jump:/.test(x)).forEach(x => { const p = x.split(':'); notes.push(`<span style="color:var(--amber)">A one-session move of ×${esc(p[2].replace(/^x/, ''))} on ${day(p[1])} - a split our history missed, or a real event: the figures spanning it are not used to fill.</span>`); });
    q.filter(x => /^px:/.test(x)).forEach(x => notes.push(`<span style="color:var(--amber)">Our last close is ${esc(x.slice(4))} the book's for ${day(e.d)} - a different share basis? Nothing is filled from it.</span>`));
    if (s._r52 && s._r52.kind === 'x52') notes.push(`<span style="color:var(--amber)">Yahoo's 52-week range ${money(s, s._yahooLow52)} – ${money(s, s._yahooHigh52)} is ${s._r52.x === 2 ? 'a split factor beyond every close (a split it never re-based)' : 'contradicted by our closes (a close outside an intraday range)'} - the range above and in the summary is ours.</span>`);
    else if (e.w52) notes.push('Yahoo\'s 52-week extreme sits 25 %+ beyond every close - an intraday spike in a thin name, most likely; both are shown.');
    if (s._betaSrc) notes.push(`No source had a beta for ${esc(s.ticker)}: the valuation uses ours (${s._betaSrc.m === 'm' ? '5-year monthly' : '1-year daily'}, ${s._betaSrc.v.toFixed(2)}) instead of assuming 1.00.`);
    const stale = S.doc.date && (Date.now() - Date.parse(S.doc.date + 'T21:00:00Z')) > 6 * 864e5;
    const head = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 14px;align-items:baseline">
        <span style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.2em;color:var(--ink-dim)">Market statistics · computed from our daily closes</span>
        <span style="font-family:var(--mono);font-size:9px;color:${stale ? 'var(--amber)' : 'var(--ink-faint)'}" title="${esc(S.doc.method || '')}">${esc(day(e.d))}${stale ? ' (stale)' : ''} · split-adjusted, price only · vs the S&amp;P 500</span></div>`;
    const grid = (items, min) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${min}px,1fr));gap:12px 18px;margin-top:10px">${items.join('')}</div>`;
    return `${head}${grid(cells, 132)}${rets.length ? grid(rets, 66) : ''}${notes.length ? `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:10px;line-height:1.5">${notes.map(n => `<div>· ${n}</div>`).join('')}</div>` : ''}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:8px">TRAPP2-ANALYTICS data/derived/market.json · built ${esc(String(S.doc.at || '').replace('T', ' ').replace('Z', ' UTC'))} · every figure from the books' own history, checked against Yahoo's where it has one</div>`;
  }

  function renderBlock(s) {
    const wrap = document.getElementById('s-52w-bar-wrap');
    let el = document.getElementById('s-mstats');
    const html = blockHtml(s);
    if (!html) { if (el) el.remove(); return false; }
    if (!el) {
      el = document.createElement('div');
      el.id = 's-mstats';
      el.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)';
      if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(el, wrap.nextSibling);
      else { const sum = document.getElementById('summary'); if (!sum) return false; sum.appendChild(el); }
    }
    el.innerHTML = html;
    return true;
  }
  function renderCells(s) {
    const r = document.getElementById('s-52w');
    if (r && r.dataset.mstats) { r.removeAttribute('title'); delete r.dataset.mstats; }
    if (r && s._r52 && s.high52 && s.low52) {
      r.dataset.mstats = '1';
      r.querySelectorAll('.mstats-tag').forEach(n => n.remove());
      const tag = document.createElement('div');
      tag.className = 'mstats-tag';
      const x = s._r52.kind === 'x52';
      tag.style.cssText = `font-family:var(--mono);font-size:9px;font-weight:400;margin-top:2px;color:${x ? 'var(--amber)' : 'var(--ink-faint)'}`;
      tag.textContent = x ? 'closing · Yahoo\'s contradicted' : (s._r52.since ? `closing · since ${dayShort(s._r52.since)}` : 'closing range');
      r.appendChild(tag);
      r.title = x ? `Our 52-week closing range. Yahoo's (intraday) was ${money(s, s._yahooLow52)} – ${money(s, s._yahooHigh52)}, which our closes contradict.`
        : 'The lowest and highest close of the last 52 weeks from our history (the book has no 52-week range for this ticker)' + (s._r52.ext ? ', stretched to today\'s price' : '') + '.';
    }
    const b = document.getElementById('s-beta');
    if (b && (s._betaSrc || s._betaDefault)) {
      const tag = t => `<span style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-left:4px;font-weight:400">${t}</span>`;
      if (s._betaSrc) {
        const bb = s._betaSrc.b || [];
        const tip = `Beta ${s._betaSrc.v.toFixed(2)} - computed: ${s._betaSrc.m === 'm' ? `${bb[1] || 60} completed monthly returns vs the S&P 500 (Yahoo's 5Y monthly method)` : `${bb[1] || 252} daily returns vs the S&P 500`}${bb[2] != null ? `, R² ${(+bb[2]).toFixed(2)}` : ''}. No source had one for this ticker; the CAPM uses this one.`;
        b.innerHTML = `<span title="${esc(tip)}" style="cursor:help;border-bottom:1px dotted var(--ink-faint)">${s._betaSrc.v.toFixed(2)}</span>${tag('calc')}`;
      } else {
        b.innerHTML = `<span title="${esc('No source has a beta for this ticker and there is not enough clean history to compute one: the valuation assumes the market\'s, 1.00.')}" style="cursor:help;border-bottom:1px dotted var(--ink-faint)">${(+s.beta || 1).toFixed(2)}</span>${tag('assumed')}`;
      }
    }
  }

  function onArrive() {
    patchLoaded();
    try {
      const s = typeof state !== 'undefined' && state && state.stock;
      if (s && document.getElementById('summary') && document.getElementById('summary').classList.contains('visible')) renderBlock(s);   // late: the block only
    } catch (e) {}
  }

  // ---- z205: the Holy Grail legs -------------------------------------------------------------------------------------
  const jumpWithin = (e, days) => (e.q || []).some(q => {
    const m = /^jump:(\d{4}-\d{2}-\d{2})/.exec(q);
    return m && (Date.parse(e.d) - Date.parse(m[1])) / 864e5 <= days;
  });
  function legStats(t) {
    const e = entry(t);
    if (!e || (e.q || []).some(q => q === 'stale' || /^px:/.test(q))) return null;
    let vol = null, vsrc = null, rho = null;
    if (num(e.s252) != null && num(e.s252) > 0 && !jumpWithin(e, 366)) { vol = num(e.s252); vsrc = 's252'; }
    else if (num(e.s60) != null && num(e.s60) > 0 && !jumpWithin(e, 92)) { vol = num(e.s60); vsrc = 's60'; }
    const b = e.b1;
    if (Array.isArray(b) && num(b[0]) != null && num(b[2]) != null && (num(b[1]) || 0) >= 200 && !jumpWithin(e, 366))
      rho = Math.sign(num(b[0])) * Math.sqrt(Math.max(0, Math.min(1, num(b[2]))));
    return vol == null && rho == null ? null : { vol, vsrc, rho, beta: num(b && b[0]), r2: num(b && b[2]), d: e.d };
  }
  // the leg's ticker, only in the form the app itself writes ("AAPL · Apple Inc." / "AAPL") and in the Stock Book
  function legTicker(leg) {
    const m = /^([A-Z][A-Z0-9.\-]{0,5})(?:\s·|$)/.exec(String((leg && leg.name) || ''));
    return m && typeof getStockbookRow === 'function' && getStockbookRow(m[1]) ? m[1] : null;
  }
  // what app.js puts in a leg when it has nothing measured: beta x 18 clamped to 15-60 %, else 25 %
  function roughVol(t) {
    const r = typeof getStockbookRow === 'function' ? getStockbookRow(t) : null;
    return r && r.beta && isFinite(r.beta) ? Math.max(15, Math.min(60, r.beta * 18)) : 25;
  }
  function sourceLegs(legs, only) {
    const st = legs.map(l => { const t = legTicker(l); return t ? { t, s: legStats(t) } : null; });
    let n = 0;
    legs.forEach((l, i) => {
      if (only && !only.has(i)) return;
      const x = st[i];
      if (!x || !x.s || (l._mstats && l._mstats.t === x.t)) return;
      const src = { t: x.t, d: x.s.d };
      if (x.s.vol != null && isFinite(l.volatility) && Math.abs(l.volatility - roughVol(x.t)) < 1e-9) {
        l.volatility = Math.round(x.s.vol * 10) / 10;
        src.volatility = { v: l.volatility, from: x.s.vsrc };
      }
      const others = st.filter((y, j) => j !== i && y && y.s && y.s.rho != null).map(y => y.s.rho);
      if (x.s.rho != null && others.length && (l.avgCorr === 55 || l.avgCorr === 70)) {
        const avg = others.reduce((a, b) => a + b, 0) / others.length;
        l.avgCorr = Math.max(-100, Math.min(100, Math.round(100 * x.s.rho * avg)));
        src.avgCorr = { v: l.avgCorr, rho: Math.round(x.s.rho * 1000) / 1000, avg: Math.round(avg * 1000) / 1000, k: others.length };
      }
      if (src.volatility || src.avgCorr) { l._mstats = src; n++; }
    });
    return n;
  }
  function rerenderRisk() {
    try { saveRiskPortfolio(); } catch (e) {}
    renderRiskLegsTable(); renderHolyGrailChart(); renderRiskMetrics();
  }
  // load the legs' price histories (the app's own lazy loader, IndexedDB cache) so their pairs are MEASURED from daily
  // log returns - the one-factor figure is then only the fallback for a pair whose history can't be had
  function primeLegs(legs, tickers) {
    const need = tickers.filter(t => typeof getHistoryForTicker === 'function' && !getHistoryForTicker(t));
    if (!need.length || typeof primeHistoryForTickers !== 'function' || (typeof _primeAllowed === 'function' && !_primeAllowed())) return null;
    return primeHistoryForTickers(need).then(() => {
      if (state.risk && state.risk.legs === legs) { renderHolyGrailChart(); renderRiskMetrics(); }
    }).catch(() => {});
  }
  function markLegs() {
    const tbody = document.getElementById('risk-legs-body');
    const legs = (typeof state !== 'undefined' && state.risk && state.risk.legs) || [];
    if (!tbody) return;
    let shown = 0, d = null;
    tbody.querySelectorAll('.risk-leg-input[data-field="volatility"], .risk-leg-input[data-field="avgCorr"]').forEach(inp => {
      const leg = legs[+inp.dataset.idx], f = inp.dataset.field, m = leg && leg._mstats, src = m && m[f];
      if (!src || legTicker(leg) !== m.t || !isFinite(leg[f]) || Math.abs(leg[f] - src.v) > 1e-9) return;
      inp.dataset.mstats = '1';
      inp.style.borderBottom = '1px dotted var(--ink-faint)';
      inp.title = f === 'volatility'
        ? `${src.v}% - ${src.from === 's252' ? '1-year' : '60-day'} realized volatility of ${m.t} from our daily closes (sd of daily log returns x √252, through ${day(m.d)})${src.from === 's60' ? ' - the year holds a one-session jump, so the last 60 sessions' : ''}. Type over it to use your own.`
        : `${src.v}% - one-factor estimate: ${m.t}'s daily correlation with the S&P 500 (${src.rho.toFixed(2)}, from its 252-day beta's R²) x the other ${src.k} stock leg${src.k === 1 ? '' : 's'}' average (${src.avg.toFixed(2)}). Used only for pairs without loaded price histories - those are measured directly. Type over it to use your own.`;
      inp.addEventListener('input', () => {                   // typed over: no longer ours
        if (!(Math.abs(parseFloat(inp.value) - src.v) <= 1e-9)) { inp.style.borderBottom = ''; inp.removeAttribute('title'); delete inp.dataset.mstats; }
      });
      shown++; d = d || m.d;
    });
    let note = document.getElementById('risk-mstats-note');
    if (!shown) { if (note) note.remove(); return; }
    if (!note) {
      note = document.createElement('div');
      note.id = 'risk-mstats-note';
      note.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:6px;line-height:1.5';
      const wrap = tbody.closest('.risk-legs-table-wrap') || tbody.closest('table');
      if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(note, wrap.nextSibling);
    }
    note.textContent = `Dotted: from our daily closes (TRAPP2-ANALYTICS market.json, ${day(d)}) - volatility realized over a year, correlation a one-factor estimate vs the S&P 500. Hover for the basis; type over a value to use your own.`;
  }
  function wireLegNames() {
    const tbody = document.getElementById('risk-legs-body');
    if (!tbody) return;
    tbody.querySelectorAll('.risk-leg-input[data-field="name"]').forEach(inp => {
      const after = () => {                                   // runs after app.js's own handler (registered first)
        try {
          const legs = state.risk.legs, i = +inp.dataset.idx, t = legs[i] && legTicker(legs[i]);
          if (!S.doc || !t) return;
          if (sourceLegs(legs, new Set([i]))) { rerenderRisk(); primeLegs(legs, [t]); }
        } catch (e) {}
      };
      inp.addEventListener('input', after);
      inp.addEventListener('change', after);
    });
  }

  // ---- hooks into app.js's global functions (the established wrap pattern) -----------------------------------------
  function hook(name, make) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig._z203) return false;
    const w = make(orig);
    w._z203 = true;
    window[name] = w;
    return true;
  }
  function install() {
    const ok = [
      hook('fetchStock', orig => async function () {
        const v = await orig.apply(this, arguments);        // an error comes straight through
        try { await waitDoc(3000); } catch (e) {}           // the file has been loading since the page opened
        return v;
      }),
      hook('normalizeStock', orig => function (env) { const s = orig.apply(this, arguments); try { patchStock(s, env); } catch (e) {} return s; }),
      hook('applyOverridesToRow', orig => function (row) { const r = orig.apply(this, arguments); try { patchRow(row); } catch (e) {} return r; }),
      hook('renderSummary', orig => function (s) {
        const r = orig.apply(this, arguments);
        try { if (s) { renderCells(s); renderBlock(s); } } catch (e) {}
        return r;
      }),
      hook('syncStockToStockbook', orig => function (stock) {
        const before = stock && stock._betaDefault && typeof getStockbookRow === 'function' ? getStockbookRow(stock.ticker) : null;
        const prev = before ? before.beta : undefined;
        const r = orig.apply(this, arguments);
        try {
          if (typeof invalidateStockbookIndex === 'function') invalidateStockbookIndex();   // the merge replaced the row object; the index still held the old one
          if (stock && stock._betaDefault && typeof getStockbookRow === 'function') {
            const row = getStockbookRow(stock.ticker);
            if (row && row.beta === stock.beta) row.beta = prev != null ? prev : null;   // the 1.00 assumption is not data
          }
        } catch (e) {}
        return r;
      }),
      hook('importFromStockBook', orig => async function () {                    // z205
        const before = typeof state !== 'undefined' && state.risk ? state.risk.legs : null;
        const v = await orig.apply(this, arguments);
        try {
          const legs = state.risk && state.risk.legs;
          if (!legs || legs === before || !legs.length) return v;              // cancelled, or nothing to import
          if (!S.doc) await waitDoc(3000);
          if (S.doc && state.risk.legs === legs && sourceLegs(legs, null)) rerenderRisk();
          if (state.risk.legs === legs) primeLegs(legs, legs.map(legTicker).filter(Boolean));
        } catch (e) {}
        return v;
      }),
      hook('renderRiskLegsTable', orig => function () {                        // z205: the marks, the typed-ticker path
        const r = orig.apply(this, arguments);
        try { markLegs(); wireLegNames(); } catch (e) {}
        return r;
      }),
    ];
    return ok.every(Boolean);
  }
  if (!install()) document.addEventListener('DOMContentLoaded', install);
  load();
  window.MarketStats = { load, entry, patchRow, patchStock, blockHtml, renderBlock, priceOk, legStats, sourceLegs, _S: S };
})();
