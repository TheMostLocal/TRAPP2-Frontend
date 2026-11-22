/* ============================================================
   >>> DESTINATION: TheMostLocal/TRAPP2-Frontend
   >>> FILE PATH:   asfiled.js
   z204 - FUNDAMENTALS AS FILED ("derive, don't fetch", owner 11-21 0951 ET: "P/E ... rely on the formulas ... compare
   with Yahoo and take the most accurate"). TRAPP2-ANALYTICS data/derived/fundamentals.json (pipeline/fundamentals.py,
   in the analytics run): for every company with SEC XBRL facts, the trailing twelve months and the latest balance
   sheet AS FILED (10-K / 10-Q, USD), each figure checked against Yahoo's on the same period, and a pick per figure -
   "sec" (verified / the newer filing / Yahoo has none), "yahoo" (our facts are older), or disputed (> 10 % apart on
   the same period: neither is used for a decision). This module:
     * the summary: the EPS and P/E cells say "✓ SEC" when the filing agrees, "SEC newer" when the filing is the later
       period (its figure in the tooltip), "≠ SEC" (amber) when they disagree on the same period, "SEC" when the
       filing supplies a figure no source had
     * the valuation (normalizeStock): EPS and P/E from the filing where neither the sheet nor Alpha Vantage has one
       (and the filing is usable) - never over a figure
     * a FUNDAMENTALS AS FILED block under the market statistics: every TTM figure with its period, its construct
       and Yahoo's figure beside it, the multiples at the LIVE price from the filing's denominators (P/E, P/S, P/B,
       EV, EV/sales, EV/EBITDA, EV/EBIT, FCF / earnings / dividend yield, ROE, margins, net debt / EBITDA, interest
       cover), and what is disputed or not yet read
   The file loads when the first stock is opened (not on every page view); fetchStock waits up to 2 s more for it
   once the stock's own data is in. A file that arrives later only adds the block and the tags.
   ============================================================ */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' && GH_RAW ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const S = { doc: null, loading: null, failedAt: 0, filled: 0 };
  const num = v => { if (v == null || v === '') return null; const x = typeof v === 'string' ? parseFloat(v.replace(/[$,%]/g, '')) : +v; return isFinite(x) ? x : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = t => String(t || '').toUpperCase().trim();
  const entry = t => (S.doc && S.doc.tickers && S.doc.tickers[T(t)]) || null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '—'; };
  const big = n => { if (n == null || !isFinite(n)) return '—'; const a = Math.abs(n), s = n < 0 ? '−' : ''; return s + '$' + (a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0)); };
  const usd = v => (v == null || !isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`);
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v < 0 ? '−' : ''}${Math.abs(100 * v).toFixed(d)}%`);
  const x = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v.toFixed(d)}×`);
  const HOW = { FY: 'the fiscal year', '4Q': 'four quarters', 'FY~': 'the fiscal year (the latest quarter could not be chained)' };
  const how = h => HOW[h] || (/^FY\+(\d)Q$/.test(h || '') ? `the fiscal year + ${h[3]} quarter${h[3] === '1' ? '' : 's'} since − the same a year earlier` : (h || ''));

  function load() {
    if (S.doc) return Promise.resolve(S.doc);
    if (S.loading) return S.loading;
    if (S.failedAt && Date.now() - S.failedAt < 600e3) return Promise.resolve(null);
    S.loading = fetch(`${RAW()}/TRAPP2-ANALYTICS/main/data/derived/fundamentals.json?_=${Math.floor(Date.now() / 3600e3)}`, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { S.doc = d && d.tickers ? d : null; S.loading = null; S.failedAt = S.doc ? 0 : Date.now(); if (S.doc) onArrive(); return S.doc; });
    return S.loading;
  }
  const waitDoc = ms => (S.doc ? Promise.resolve(S.doc) : Promise.race([load(), new Promise(r => setTimeout(() => r(null), ms))]));
  const usdListing = s => { const c = String((s && s.currency) || 'USD').toUpperCase(); return c === 'USD' && !/\.[A-Z]{1,4}$/.test(T(s && s.ticker)); };

  // ---- the valuation's stock object: EPS / P/E where no source has one -----------------------------------------------
  function patchStock(s) {
    if (!s || !s.ticker || s._asFiledDone) return s;
    const e = entry(s.ticker);
    s._asFiledDone = !!S.doc;
    if (!e || !usdListing(s)) return s;
    const src = (s._sources && s._sources.eps) || [];
    const had = src.slice(0, 2).some(v => v != null && isFinite(v));
    const eps = num((e.t || {}).eps);
    if (!had && (e.use || {}).eps === 'sec' && eps != null) {
      s.eps = eps;
      const px = num(s.price);
      if (px > 0 && eps > 0 && (s.pe == null || !isFinite(s.pe))) s.pe = px / eps;
      s._epsSrc = { v: eps, end: (e.te || {}).eps || e.end, how: (e.how || {}).eps, filed: e.filed };
      S.filled++;
    }
    return s;
  }

  // ---- the summary cells -----------------------------------------------------------------------------------------------
  function tagFor(e, key) {
    const y = ((e && e.y) || {})[key];
    const use = ((e && e.use) || {})[key];
    if (!y) return null;
    const band = y[2];
    if (band === 'agree' || band === 'near') return { t: '✓ SEC', c: 'var(--ink-faint)', tip: 'agrees with the filing' };
    if (band === 'newer') return { t: 'SEC newer', c: 'var(--ink-faint)', tip: 'the filing is the later period' };
    if (band === 'check' && use == null) return { t: '≠ SEC', c: 'var(--amber)', tip: 'disagrees with the filing on the same period' };
    if (band === 'only' && use === 'sec') return { t: 'SEC', c: 'var(--ink-faint)', tip: 'no source had it - the filing\'s' };
    return null;
  }
  function renderCells(s) {
    const e = entry(s.ticker);
    ['s-eps', 's-pe'].forEach(id => { const el = document.getElementById(id); if (el) el.querySelectorAll('.asfiled-tag').forEach(n => n.remove()); });
    if (!e || !usdListing(s)) return;
    const tg = tagFor(e, 'eps');
    if (!tg) return;
    const eps = num((e.t || {}).eps), px = num(s.price);
    const end = (e.te || {}).eps || e.end;
    const yv = (e.y.eps || [])[0];
    const tip = `As filed with the SEC: diluted EPS ${usd(eps)} over the twelve months to ${day(end)} (${how((e.how || {}).eps)}; newest filing ${esc((e.filed || [])[0] || '')} ${day((e.filed || [])[1])}). Yahoo: ${yv == null ? 'none' : usd(yv)} - ${tg.tip}.`;
    const mk = () => { const n = document.createElement('span'); n.className = 'asfiled-tag'; n.title = tip; n.style.cssText = `font-family:var(--mono);font-size:9px;font-weight:400;margin-left:4px;cursor:help;color:${tg.c}`; n.textContent = tg.t; return n; };
    const ce = document.getElementById('s-eps');
    if (ce) ce.appendChild(mk());
    const cp = document.getElementById('s-pe');
    if (cp && eps > 0 && px > 0) { const n = mk(); n.title = `${tip} P/E at today's price on the filing's EPS: ${(px / eps).toFixed(2)}.`; cp.appendChild(n); }
  }

  // ---- the block ---------------------------------------------------------------------------------------------------------
  const cell = (label, value, sub, color, title) => `<div style="min-width:0${title ? ';cursor:help' : ''}"${title ? ` title="${esc(title)}"` : ''}>
      <div style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.16em;color:var(--ink-dim);margin-bottom:3px">${label}</div>
      <div style="font-family:var(--mono);font-size:13px;font-weight:500;color:${color || 'var(--ink)'};overflow-wrap:anywhere">${value}</div>
      ${sub ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px;line-height:1.35">${sub}</div>` : ''}</div>`;
  const BAND = { agree: ['✓', 'var(--pos)'], near: ['≈', 'var(--ink-dim)'], check: ['≠', 'var(--amber)'], newer: ['newer', 'var(--ink-dim)'], older: ['older', 'var(--ink-faint)'], only: ['', ''], partial: ['', ''] };
  function vsYahoo(e, key, fmt) {
    const y = ((e.y || {})[key]);
    if (!y) return '';
    const [yv, , band, alt] = y;
    const [mk, col] = BAND[band] || ['', ''];
    if (band === 'only') return 'Yahoo: none';
    if (band === 'partial') return `Yahoo ${fmt(yv)} · ours after the re-read`;
    return `Yahoo ${fmt(yv)}${mk ? ` <span style="color:${col}">${mk}</span>` : ''}${alt === 'incl. operating leases' ? ' (incl. leases)' : ''}`;
  }
  function blockHtml(s) {
    const e = s && entry(s.ticker);
    if (!e || !usdListing(s)) return null;
    const t = e.t || {}, b = e.b || {}, use = e.use || {}, te = e.te || {};
    const px = num(s.price) || num(e.px);
    const mcLive = num(s.marketCap) || (e.mc && e.px && px ? e.mc[0] * px / e.px : null);
    const endOf = k => te[k] || e.end;
    const cells = [];
    const flow = (label, key, title) => {
      if (t[key] == null) return;
      const usable = !(key in use) || use[key] === 'sec';
      const sub = [vsYahoo(e, key, key === 'eps' ? usd : big), endOf(key) !== e.end ? `to ${day(endOf(key))}` : ''].filter(Boolean).join(' · ');
      cells.push(cell(label, key === 'eps' || key === 'dps' ? usd(t[key]) : big(t[key]), sub, usable ? null : 'var(--ink-dim)',
        `${title} Twelve months to ${day(endOf(key))}: ${how((e.how || {})[key])}.${usable ? '' : ' Not used for decisions (see the note).'}`));
    };
    flow('EPS · diluted', 'eps', 'Diluted earnings per share as filed.');
    flow('Revenue', 'rev', `Revenue as filed (${esc(e.rc || 'concept')}).`);
    flow('Net income', 'ni', 'Net income attributable to the company as filed.');
    flow('Operating income', 'oi', 'Operating income as filed.');
    flow('EBITDA', 'ebitda', 'Operating income + depreciation & amortization (cash-flow statement).');
    flow('Free cash flow', 'fcf', 'Operating cash flow − capital expenditure.');
    flow('Dividends / share', 'dps', 'Dividends declared per share.');
    const bs = (label, key, title) => {
      if (b[key] == null) return;
      const ck = key === 'cashT' ? 'cash' : key;
      const usable = !(ck in use) || use[ck] === 'sec';
      cells.push(cell(label, big(b[key]), vsYahoo(e, ck, big), usable ? null : 'var(--ink-dim)', `${title} At ${day(e.bd)}.`));
    };
    bs('Common equity', 'eq', 'Stockholders\' equity less preferred stock.');
    bs('Cash + short-term inv.', 'cashT', 'Cash and equivalents + short-term investments (Yahoo\'s "total cash").');
    bs('Debt', 'debt', 'Long-term debt (non-current) + current maturities + short-term borrowings / commercial paper + finance leases.');
    // multiples at the live price, from the filing's denominators where the pick is the filing's
    const ok = k => use[k] === 'sec';
    const cur = k => (te[k] || e.end) === e.end;
    const m = [];
    const add = (label, v, f, title) => { if (v != null && isFinite(v)) m.push(cell(label, f(v), '', null, title)); };
    const eps = ok('eps') ? num(t.eps) : null, rev = ok('rev') ? num(t.rev) : null, eq = ok('eq') ? num(b.eq) : null;
    const ebitda = ok('ebitda') ? num(t.ebitda) : null, debt = ok('debt') ? num(b.debt) : null, cash = ok('cash') ? num(b.cashT) : null;
    const ev = mcLive != null && debt != null && cash != null ? mcLive + debt - cash : null;
    add('P/E', px && eps > 0 ? px / eps : null, v => v.toFixed(1), 'Today\'s price / the filing\'s TTM diluted EPS.');
    add('P/S', mcLive && rev > 0 ? mcLive / rev : null, v => v.toFixed(2), 'Market cap / TTM revenue as filed.');
    add('P/B', mcLive && eq > 0 ? mcLive / eq : null, v => v.toFixed(2), 'Market cap / common equity as filed.');
    add('EV', ev, big, 'Market cap + debt − cash and short-term investments.');
    add('EV / sales', ev != null && rev > 0 ? ev / rev : null, v => v.toFixed(2));
    add('EV / EBITDA', ev != null && ebitda > 0 ? ev / ebitda : null, v => v.toFixed(1));
    add('EV / EBIT', ev != null && cur('oi') && num(t.oi) > 0 ? ev / num(t.oi) : null, v => v.toFixed(1));
    add('FCF yield', mcLive && cur('fcf') && num(t.fcf) != null ? num(t.fcf) / mcLive : null, v => pct(v), 'Free cash flow / market cap.');
    add('Earnings yield', px && eps != null ? eps / px : null, v => pct(v));
    add('Dividend yield', px && ok('dy') && num(t.dps) != null ? num(t.dps) / px : null, v => pct(v, 2), 'Dividends declared per share over the twelve months / today\'s price.');
    add('ROE', eq > 0 && ok('ni') ? num(t.ni) / eq : null, v => pct(v));
    add('Operating margin', rev > 0 && cur('oi') && num(t.oi) != null ? num(t.oi) / rev : null, v => pct(v));
    add('Net margin', rev > 0 && ok('ni') ? num(t.ni) / rev : null, v => pct(v));
    add('Net debt / EBITDA', ebitda > 0 && debt != null && cash != null ? (debt - cash) / ebitda : null, v => x(v));
    add('Interest cover', cur('oi') && num(t.int) ? num(t.oi) / Math.abs(num(t.int)) : null, v => x(v), 'Operating income / interest expense.');
    // notes
    const notes = [];
    const NAME = { eps: 'EPS', rev: 'revenue', ni: 'net income', eq: 'common equity', ebitda: 'EBITDA', debt: 'debt', cash: 'cash', dy: 'dividend yield' };
    const disputed = Object.keys(use).filter(k => use[k] == null && ((e.y || {})[k] || [])[2] === 'check');
    if (disputed.length) notes.push(`<span style="color:var(--amber)">Disputed - the filing and Yahoo disagree by more than 10 % on the same period: ${disputed.map(k => `${NAME[k] || k} (filing ${k === 'eps' ? usd(k in t ? t[k] : null) : big(k in t ? t[k] : (k === 'cash' ? b.cashT : b[k]))} vs Yahoo ${k === 'eps' ? usd(e.y[k][0]) : big(e.y[k][0])})`).join(', ')}. Neither is used for a decision until a newer filing or a human settles it.</span>`);
    const older = Object.keys(use).filter(k => use[k] === 'yahoo' && ['older', 'check'].includes(((e.y || {})[k] || [])[2]));
    if (older.length) notes.push(`Yahoo's ${older.map(k => NAME[k] || k).join(', ')} ${older.length > 1 ? 'are' : 'is'} for a later period (or our read predates z204's): Yahoo's is the one used.`);
    if ((e.v || 1) < 4) notes.push('Debt, short-term investments, D&A (EBITDA), preferred stock and dividends come with the SEC re-read that z204 started (~250 companies a run, ~a week for all): until then EV-based figures stay out.');
    const q = e.q || [];
    q.filter(f => /^split:/.test(f)).forEach(f => notes.push(`Per-share figures re-based across a split (${esc(f.slice(6).split(',').map(p => p.replace(/^(\d{4}-\d\d-\d\d):/, (m, d) => day(d) + ' ')).join('; '))}).`));
    if (q.includes('class?')) notes.push('Another listing of the same filer (a share class, a preferred or a note): per-share figures count only where Yahoo agrees.');
    if (q.includes('no-cap')) notes.push('No market cap in the book: not the common stock - no multiples.');
    if (q.includes('basis?')) notes.push('The share counts jump by no split factor (issuance, a de-SPAC, share classes): per-share figures count only where Yahoo agrees.');
    if (q.includes('stale')) notes.push('<span style="color:var(--amber)">The newest period filed is over 15 months old.</span>');
    if (s._epsSrc) notes.push(`No source had an EPS for ${esc(s.ticker)}: the valuation uses the filing's (${usd(s._epsSrc.v)}).`);
    const filed = e.filed ? `newest filing ${esc(e.filed[0])} ${day(e.filed[1])}` : '';
    const head = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 14px;align-items:baseline">
        <span style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.2em;color:var(--ink-dim)">Fundamentals as filed · SEC 10-K / 10-Q</span>
        <span style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)" title="${esc(S.doc.method || '')}">twelve months to ${esc(day(e.end))}${filed ? ' · ' + filed : ''} · checked against Yahoo</span></div>`;
    const grid = (items, min) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${min}px,1fr));gap:12px 18px;margin-top:10px">${items.join('')}</div>`;
    const sub = m.length ? `<div style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.16em;color:var(--ink-dim);margin-top:14px">At today's price · ${usd(px)}${mcLive ? ' · market cap ' + big(mcLive) : ''}</div>${grid(m, 104)}` : '';
    return `${head}${grid(cells, 132)}${sub}${notes.length ? `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:10px;line-height:1.5">${notes.map(n => `<div>· ${n}</div>`).join('')}</div>` : ''}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:8px">TRAPP2-ANALYTICS data/derived/fundamentals.json · built ${esc(String(S.doc.at || '').replace('T', ' ').replace('Z', ' UTC'))} · SEC XBRL as filed (USD) · facts read ${esc(String(e.v))}</div>`;
  }
  function renderBlock(s) {
    let el = document.getElementById('s-asfiled');
    const html = s ? blockHtml(s) : null;
    if (!html) { if (el) el.remove(); return false; }
    if (!el) {
      el = document.createElement('div');
      el.id = 's-asfiled';
      el.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)';
      const after = document.getElementById('s-mstats') || document.getElementById('s-52w-bar-wrap');
      if (after && after.parentNode) after.parentNode.insertBefore(el, after.nextSibling);
      else { const sum = document.getElementById('summary'); if (!sum) return false; sum.appendChild(el); }
    } else {
      const ms = document.getElementById('s-mstats');           // keep it under the market statistics when both re-render
      if (ms && ms.nextSibling !== el) ms.parentNode.insertBefore(el, ms.nextSibling);
    }
    el.innerHTML = html;
    return true;
  }
  function onArrive() {
    try {
      const s = typeof state !== 'undefined' && state && state.stock;
      if (s && document.getElementById('summary') && document.getElementById('summary').classList.contains('visible')) { renderCells(s); renderBlock(s); }
    } catch (e) {}
  }

  // ---- hooks -----------------------------------------------------------------------------------------------------------
  function hook(name, make) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig._z204) return false;
    const w = make(orig);
    w._z204 = true;
    window[name] = w;
    return true;
  }
  function install() {
    return [
      hook('fetchStock', orig => async function () {
        load();                                                // the first stock opened starts the load, in parallel
        const v = await orig.apply(this, arguments);
        try { await waitDoc(2000); } catch (e) {}
        return v;
      }),
      hook('normalizeStock', orig => function () { const s = orig.apply(this, arguments); try { patchStock(s); } catch (e) {} return s; }),
      hook('renderSummary', orig => function (s) {
        const r = orig.apply(this, arguments);
        try { if (s) { renderCells(s); renderBlock(s); } } catch (e) {}
        return r;
      }),
    ].every(Boolean);
  }
  if (!install()) document.addEventListener('DOMContentLoaded', install);
  window.AsFiled = { load, entry, patchStock, blockHtml, renderBlock, _S: S };
})();
