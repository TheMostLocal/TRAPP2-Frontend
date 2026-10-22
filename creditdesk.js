/* ==========================================================================
   creditdesk.js — BONDS & CDS (z139). Data & Research → Bonds & CDS, and each company's own
   bonds and credit default swaps on its Valuation page. Load after app.js and charts.js.

   Data: TRAPP2-CREDIT/data (pipeline: fetch_cds_dtcc.py → fetch_bonds.py → build_credit_index.py,
   daily 0730 ET).
   • CDS: single-name trades from DTCC's SEC swap repository public tape — the 5-year spread
     (median of 4–6-year trades that day, in basis points), its 1-week / 1-month change, trades.
     Corporate names trade thinly: no trade = no point, never a filled-in value.
   • Bonds: every outstanding bond under the company's name (OpenFIGI): coupon, maturity, the
     maturity wall by year. Prices / yields arrive once FINRA TRACE access is confirmed.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const BASE = () => `${RAW()}/TRAPP2-CREDIT/main/data/`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { idx: null, at: 0, filter: 'all', q: '', sel: null, sort: 'cds', docs: {} };
  async function getJSON(f) { const r = await fetch(BASE() + f + '?_=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function loadIndex() { if (S.idx && Date.now() - S.at < 5 * 60000) return S.idx; try { S.idx = await getJSON('credit_index.json'); } catch (e) { S.idx = null; } S.at = Date.now(); return S.idx; }
  async function doc(kind, t) { const k = kind + ':' + t; if (k in S.docs) return S.docs[k]; let d = null; try { d = await getJSON(`${kind}/issuers/${encodeURIComponent(t)}.json`); } catch (e) {} S.docs[k] = d; return d; }
  const bp = v => (v == null ? '—' : `${(+v).toFixed(0)} bp`);
  const chg = v => (v == null ? '—' : `<span style="color:${v > 0 ? 'var(--neg)' : v < 0 ? 'var(--pos)' : 'inherit'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}</span>`);   // wider = worse
  const dt = d => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
  const yrs = d => (d ? ((Date.parse(d) - Date.now()) / 31557600000) : null);
  const pct2 = v => (Math.round(v * 100 + (v >= 0 ? 1e-9 : -1e-9)) / 100).toFixed(2) + '%';   // 5.225 → 5.23 (half up, not binary-float 5.22)
  const openVal = t => { const i = document.getElementById('ticker'); if (i) i.value = t; if (typeof switchTab === 'function') switchTab('valuation'); if (typeof loadValuation === 'function') loadValuation(); };

  // maturity wall: bars of equal width, height ∝ count (exact), one per year present
  function wallSvg(wall, W = 320, H = 70) {
    const ys = Object.keys(wall || {}).sort();
    if (!ys.length) return '';
    const mx = Math.max(...ys.map(y => wall[y])), bw = W / ys.length;
    const lab = k => (ys.length <= 12 || k % Math.ceil(ys.length / 12) === 0);
    return `<svg viewBox="0 0 ${W} ${H + 14}" style="width:100%;max-width:520px;height:auto;display:block" role="img" aria-label="Bonds maturing by year">
      ${ys.map((y, k) => { const h = wall[y] / mx * (H - 4); return `<rect x="${(k * bw + bw * 0.15).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${(bw * 0.7).toFixed(2)}" height="${h.toFixed(2)}" fill="var(--amber)" opacity="0.85"><title>${y}: ${wall[y]} bond(s)</title></rect>${lab(k) ? `<text x="${(k * bw + bw / 2).toFixed(2)}" y="${H + 11}" font-size="8" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)">'${y.slice(2)}</text>` : ''}`; }).join('')}
      <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--rule)"/></svg>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">bonds maturing per year (count; tallest ${mx})</div>`;
  }

  async function detail(host, t) {
    host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">Loading…</div>';
    const [cd, bd] = await Promise.all([doc('cds', t), doc('bonds', t)]);
    const ix = ((S.idx || {}).tickers || {})[t] || {};
    const cds = ix.cds || {};
    const series = ((cd && cd.daily) || []).filter(d => d.bps5y != null).map(d => ({ d: d.date, c: d.bps5y }));
    const trades = ((cd && cd.trades) || []).slice(-25).reverse();
    const bonds = (bd && bd.bonds) || [];
    host.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;margin-bottom:8px">
        <a href="#" data-cd-open="${esc(t)}" style="color:var(--amber);font-family:var(--mono);font-weight:700;font-size:14px;text-decoration:none;border-bottom:1px dotted var(--amber)">${esc(t)}</a>
        <span style="font-family:var(--mono);font-size:11px;color:var(--ink-dim)">${esc(ix.name || (bd && bd.name) || '')}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">CDS 5Y ${bp(cds.bps5y)} · 1W ${chg(cds.chg1w)} · 1M ${chg(cds.chg1m)} bp</span></div>
      <h4 style="margin-top:6px">Credit default swaps <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${esc(((cd && cd.entities) || []).join(' · ') || 'no single-name CDS trades on file')}</span></h4>
      ${series.length >= 2 ? '<div class="cd-chart"></div>' : `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin:4px 0 8px">${series.length ? `One 5-year print so far: ${bp(series[0].c)} on ${dt(series[0].d)}.` : 'No 5-year spread prints yet.'} Corporate CDS trade thinly — the line fills in as trades are reported.</div>`}
      ${trades.length ? `<div style="overflow-x:auto;margin-top:6px"><table class="sb-table" style="width:100%;min-width:460px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Traded</th><th style="text-align:left">Entity</th><th style="text-align:right">Tenor</th><th style="text-align:right">Spread</th><th style="text-align:right">Upfront</th><th style="text-align:right">Notional</th></tr></thead><tbody>
        ${trades.map(x => `<tr><td style="white-space:nowrap">${esc(dt(x.date))}</td><td>${esc(x.entity)}</td><td style="text-align:right">${x.tenor != null ? x.tenor.toFixed(1) + 'y' : '—'}</td><td style="text-align:right">${bp(x.bps)}</td><td style="text-align:right">${x.upfront != null ? x.upfront.toFixed(2) : '—'}</td><td style="text-align:right">${x.notional != null ? (x.ccy ? esc(x.ccy) + ' ' : '') + (+x.notional).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:3px">DTCC public tape: notional is capped in dissemination; some trades are quoted as upfront points rather than a spread.</div>` : ''}
      <h4 style="margin-top:12px">Bonds outstanding <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${bonds.length} · OpenFIGI${bd && bd.updatedAt ? ' · ' + esc(bd.updatedAt.slice(0, 10)) : ''}</span></h4>
      ${bonds.length ? wallSvg(ix.wall || bonds.reduce((w, b) => { const y = b.maturity.slice(0, 4); w[y] = (w[y] || 0) + 1; return w; }, {})) + `
        <div style="overflow-x:auto;margin-top:6px;max-height:360px;overflow-y:auto"><table class="sb-table" style="width:100%;min-width:460px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Bond</th><th style="text-align:right">Coupon</th><th style="text-align:right">Maturity</th><th style="text-align:right">Years left</th><th style="text-align:left">Type</th></tr></thead><tbody>
        ${bonds.map(b => `<tr><td>${esc(b.desc)}</td><td style="text-align:right">${b.coupon != null ? b.coupon.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%' : 'floating'}</td><td style="text-align:right;white-space:nowrap">${esc(dt(b.maturity))}</td><td style="text-align:right">${(yrs(b.maturity) || 0).toFixed(1)}</td><td>${esc(b.type || '')}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:3px">Terms only — prices and yields come from FINRA TRACE once its access is confirmed (no invented prices).</div>` : '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No bonds on file for this company yet (lists refresh in batches every run).</div>'}`;
    host.querySelectorAll('[data-cd-open]').forEach(a => a.onclick = e => { e.preventDefault(); openVal(a.dataset.cdOpen); });
    const ch = host.querySelector('.cd-chart');
    if (ch && window.VChart && VChart.mountSeriesChart) VChart.mountSeriesChart(ch, { key: 'cds-' + t, title: `${t} CDS 5Y`, daily: series, range: '1Y', ranges: ['1M', '3M', '6M', '1Y', 'ALL'], upIsBad: true, bars: false,
      axisFmt: v => v.toFixed(0) + ' bp', fmt: v => v.toFixed(0) + ' bp', note: 'Median 4–6-year single-name CDS trade per day (basis points); red when wider.' });
  }

  async function render(host) {
    if (!host) return;
    if (!S.idx) host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading bonds &amp; CDS…</div>';
    const idx = await loadIndex();
    if (!host.isConnected) return;
    if (!idx || !idx.tickers) {
      host.innerHTML = `<div class="company-card"><h4>Bonds &amp; CDS</h4><div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);line-height:1.6">Waiting for the first run of <strong>TRAPP2-CREDIT → Credit (bonds + CDS)</strong>. Create the repo, add the files, then run the workflow once with backfill = 60 (Actions tab). CDS come from DTCC's public swap tape, bond lists from OpenFIGI, prices from FINRA TRACE once confirmed.</div></div>`;
      return;
    }
    const rows = Object.entries(idx.tickers).map(([t, v]) => ({ t, ...v }))
      .filter(r => S.filter === 'all' || (S.filter === 'cds' ? !!r.cds : (r.bonds || 0) > 0))
      .filter(r => !S.q || r.t.includes(S.q.toUpperCase()) || String(r.name || '').toUpperCase().includes(S.q.toUpperCase()));
    const key = { cds: r => (r.cds && r.cds.bps5y != null ? r.cds.bps5y : -1), chg: r => (r.cds && r.cds.chg1m != null ? r.cds.chg1m : -1e9), bonds: r => r.bonds || 0, t: r => r.t, mat: r => r.nextMaturity || '9999' }[S.sort] || (r => r.t);
    rows.sort((a, b) => { const x = key(a), y = key(b); return typeof x === 'string' ? x.localeCompare(y) : (y - x) || a.t.localeCompare(b.t); });
    const nC = Object.values(idx.tickers).filter(v => v.cds).length, nB = Object.values(idx.tickers).filter(v => v.bonds).length;
    const prog = idx.bondsProgress || {};                  // z146: bond lists fill in over runs - say how far along
    const progress = prog.issuers ? ` (bond lists checked for ${prog.checked} of ${prog.issuers} companies${prog.checked < prog.issuers ? ' so far — the rest fill in with the next runs' : ''})` : '';
    const th = (k, l, al = 'right') => `<th data-cd-sort="${k}" style="text-align:${al};cursor:pointer;${S.sort === k ? 'color:var(--amber)' : ''}">${l}${S.sort === k ? ' ▾' : ''}</th>`;
    host.innerHTML = `
      <section class="company-card" style="margin:0 0 12px">
        <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">BONDS &amp; CDS · ${nB} companies with bonds${esc(progress)} · ${nC} with CDS trades</div>
          <span class="seg-control" style="font-size:10px">${[['all', 'All'], ['cds', 'With CDS'], ['bonds', 'With bonds']].map(([k, l]) => `<button class="seg-btn ${S.filter === k ? 'active' : ''}" data-cd-f="${k}" style="font-size:10px">${l}</button>`).join('')}</span>
          <input data-cd-q placeholder="ticker or name" value="${esc(S.q)}" style="font-family:var(--mono);font-size:11px;padding:4px 6px;background:var(--bg-elev);border:1px solid var(--rule);color:var(--ink);min-width:120px">
          <div style="margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">CDS ${esc((idx.cdsAsOf || '').slice(0, 10) || '—')} · index ${esc((idx.asOf || '').slice(0, 10))}</div></div>
        <div style="overflow-x:auto;margin-top:8px;max-height:460px;overflow-y:auto"><table class="sb-table" style="width:100%;min-width:640px;font-family:var(--mono);font-size:11px">
          <thead><tr>${th('t', 'Ticker', 'left')}<th style="text-align:left">Company</th>${th('bonds', 'Bonds')}${th('mat', 'Next maturity')}<th style="text-align:right">Avg coupon</th>${th('cds', 'CDS 5Y')}<th style="text-align:right">1W</th>${th('chg', '1M')}<th style="text-align:right">Trades 30d</th></tr></thead>
          <tbody>${rows.slice(0, 400).map(r => `<tr data-cd-row="${esc(r.t)}" style="cursor:pointer;${S.sel === r.t ? 'background:rgba(212,160,23,0.10)' : ''}"><td style="color:var(--amber);font-weight:700">${esc(r.t)}</td><td>${esc(r.name || '')}</td><td style="text-align:right">${r.bonds || '—'}</td><td style="text-align:right;white-space:nowrap">${esc(dt(r.nextMaturity))}</td><td style="text-align:right">${r.avgCoupon != null ? pct2(r.avgCoupon) : '—'}</td><td style="text-align:right">${bp(r.cds && r.cds.bps5y)}</td><td style="text-align:right">${chg(r.cds && r.cds.chg1w)}</td><td style="text-align:right">${chg(r.cds && r.cds.chg1m)}</td><td style="text-align:right">${r.cds ? r.cds.n30 : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px;line-height:1.5">CDS 5Y = median single-name CDS trade with 4–6 years to maturity on its latest trading day (DTCC SEC swap repository, public tape); change in basis points, red = wider (worse credit). Bonds = outstanding bonds under the company's name (OpenFIGI). Tap a row for the bonds and trades.</div>
      </section>
      <section class="company-card cd-detail" style="margin:0 0 12px;${S.sel ? '' : 'display:none'}"></section>`;
    host.querySelectorAll('[data-cd-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.cdF; render(host); });
    host.querySelectorAll('[data-cd-sort]').forEach(b => b.onclick = () => { S.sort = b.dataset.cdSort; render(host); });
    const q = host.querySelector('[data-cd-q]'); if (q) q.onchange = () => { S.q = q.value.trim(); render(host); };
    host.querySelectorAll('[data-cd-row]').forEach(tr => tr.onclick = () => { S.sel = tr.dataset.cdRow; render(host); });
    if (S.sel) detail(host.querySelector('.cd-detail'), S.sel);
  }

  // ---- each company's own bonds & CDS on its Valuation page (under the earnings card) ----
  async function renderTicker(t) {
    const anchor = document.getElementById('ern-ticker-section') || document.getElementById('price-chart-section');
    if (!anchor || !t) return;
    let sec = document.getElementById('credit-ticker-section');
    if (!sec) { sec = document.createElement('div'); sec.id = 'credit-ticker-section'; sec.className = 'section'; }
    if (sec.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', sec);
    sec.dataset.ticker = t;
    const idx = await loadIndex();
    if (sec.dataset.ticker !== t) return;
    const v = idx && idx.tickers && idx.tickers[t];
    if (!v) { sec.innerHTML = ''; sec.style.display = 'none'; return; }       // no bonds or CDS on file: nothing to show
    sec.style.display = '';
    const c = v.cds || {};
    sec.innerHTML = `<div class="company-card"><h4>Bonds &amp; CDS <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${esc(t)}</span></h4>
      <div style="display:flex;flex-wrap:wrap;gap:10px 22px;font-family:var(--mono);font-size:11px;margin-bottom:8px">
        <div><div style="color:var(--ink-faint);font-size:9px">CDS 5Y</div><div style="font-size:15px;font-weight:700">${bp(c.bps5y)}</div><div style="font-size:9px;color:var(--ink-faint)">${c.bps5yDate ? 'as of ' + esc(dt(c.bps5yDate)) : 'no 5-year print'}</div></div>
        <div><div style="color:var(--ink-faint);font-size:9px">1W / 1M</div><div style="font-size:13px">${chg(c.chg1w)} / ${chg(c.chg1m)} bp</div><div style="font-size:9px;color:var(--ink-faint)">${c.n30 != null ? c.n30 + ' trades in 30 days' : 'no CDS trades on file'}</div></div>
        <div><div style="color:var(--ink-faint);font-size:9px">Bonds outstanding</div><div style="font-size:15px;font-weight:700">${v.bonds || 0}</div><div style="font-size:9px;color:var(--ink-faint)">${v.nextMaturity ? 'next ' + esc(dt(v.nextMaturity)) + ' · last ' + esc(dt(v.lastMaturity)) : ''}</div></div>
        <div><div style="color:var(--ink-faint);font-size:9px">Avg coupon</div><div style="font-size:13px">${v.avgCoupon != null ? pct2(v.avgCoupon) : '—'}</div></div></div>
      ${v.wall ? wallSvg(v.wall) : ''}
      <div style="margin-top:6px"><a href="#" data-cd-desk="${esc(t)}" style="font-family:var(--mono);font-size:10px;color:var(--amber)">Open in Data &amp; Research → Bonds &amp; CDS ›</a></div></div>`;
    const a = sec.querySelector('[data-cd-desk]');
    if (a) a.onclick = e => { e.preventDefault(); S.sel = t; S.filter = 'all'; if (typeof switchTab === 'function') switchTab('creditdesk'); const h = document.getElementById('creditdesk-mount'); if (h) render(h); };
  }
  (function () {
    const orig = window.renderSummary;
    if (typeof orig !== 'function' || orig._z139) return;
    const w = function () { const r = orig.apply(this, arguments); try { const st = arguments[0] || (typeof state !== 'undefined' ? state.stock : null); if (st && st.ticker) setTimeout(() => renderTicker(String(st.ticker).toUpperCase()), 50); } catch (e) {} return r; };
    w._z139 = true; Object.keys(orig).forEach(k => { w[k] = orig[k]; });
    window.renderSummary = w;
  })();
  window.CreditDesk = { render, renderTicker, _S: S };
})();
