/* ==========================================================================
   earnings.js — EARNINGS (z136). Data & Research → Earnings, and each asset's own earnings
   on its Valuation page. Load after app.js.

   Data: TRAPP2-ANALYTICS/data/earnings (pipeline: fetch_index_members.py → fetch_earnings.py →
   build_earnings_season.py, run 0900 / 1730 / 2100 ET).
   • The season, bottom-up: for the S&P 500, Nasdaq-100 or Dow 30 — per sector, per group
     (Cyclicals / Near-Cyclicals / Defensives) and in total: # reported, % reported, % beating
     (reported EPS > estimate), % missing (<; equal = in line), aggregate surprise
     (Σ (actual − estimate) × shares ÷ Σ |estimate| × shares) and the return since the quarter
     end (sector SPDR minus the index; the index row absolute).
   • Blended quarterly EPS for the index (reported where out, else the estimate), tracked daily
     from the day the pipeline started.
   • This week's reports (before the open / after the close) and the latest results.
   • Per asset: the next report and its estimate, and the last reports with surprises.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const BASE = () => `${RAW()}/TRAPP2-ANALYTICS/main/data/earnings/`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GROUPS = [['Cyclicals', ['Technology', 'Consumer Discretionary', 'Industrials', 'Basic Materials', 'Communication Services']],
                  ['Near-Cyclicals', ['Financials', 'Real Estate', 'Energy']], ['Defensives', ['Healthcare', 'Consumer Staples', 'Utilities']]];
  const S = { season: null, hist: null, at: 0, ix: 'SPY', sector: '', tick: {} };
  async function getJSON(f) { const r = await fetch(BASE() + f + '?_=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function load() {
    if (S.season && Date.now() - S.at < 5 * 60000) return;
    try { S.season = await getJSON('season.json'); } catch (e) { S.season = null; }
    try { S.hist = await getJSON('history.json'); } catch (e) { S.hist = null; }
    S.at = Date.now();
  }
  const pct = (v, d = 0) => (v == null ? '—' : (v * 100).toFixed(d) + '%');
  const spct = (v, d = 1) => (v == null ? '—' : `<span style="color:${v < 0 ? 'var(--neg)' : 'inherit'}">${(v * 100).toFixed(d)}%</span>`);
  const money = v => (v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2));
  const when = (d, t) => { if (!d) return '—'; const s = new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); return s + (t === 'BMO' ? ' · before the open' : t === 'AMC' ? ' · after the close' : ''); };
  const asOf = iso => { const d = new Date(iso); return isFinite(d) ? d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'; };
  const link = t => `<a href="#" data-ern-open="${esc(t)}" style="color:var(--amber);font-weight:700;text-decoration:none;border-bottom:1px dotted var(--amber)">${esc(t)}</a>`;
  function openTicker(t) { const inp = document.getElementById('ticker'); if (inp) inp.value = t; if (typeof switchTab === 'function') switchTab('valuation'); if (typeof loadValuation === 'function') loadValuation(); }

  function row(label, st, opts = {}) {
    if (!st) return '';
    const rep = `${st.reported} / ${st.members}`;
    const cell = (v, extra = '') => `<td style="text-align:right;white-space:nowrap;${extra}">${v}</td>`;
    return `<tr style="${opts.bold ? 'font-weight:700;' : ''}${opts.top ? 'border-top:1px solid var(--ink-faint);' : ''}">
      <td style="text-align:left;white-space:nowrap;${opts.indent ? 'padding-left:12px' : ''}">${esc(label)}</td>${cell(rep)}${cell(pct(st.pctReported))}
      ${cell(st.reported ? pct(st.pctBeat) : '—', 'background:rgba(74,144,226,0.10)')}${cell(st.reported ? pct(st.pctMiss) : '—')}${cell(st.reported ? spct(st.surprise) : '—')}
      ${cell(spct(opts.abs ? st.returnSinceQEnd : st.relReturn))}</tr>`;
  }

  async function render(host) {
    if (!host) return;
    if (!S.season) host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading earnings…</div>';
    await load();
    if (!host.isConnected) return;
    const se = S.season;
    if (!se || !se.indices || !Object.keys(se.indices).length) {
      host.innerHTML = `<div class="company-card"><div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);line-height:1.6">Earnings data arrives with the first run of TRAPP2-ANALYTICS → <strong>Earnings (members, reports, season)</strong> (0900 / 1730 / 2100 ET on weekdays, or run it from the Actions tab). It builds the S&amp;P 500, Nasdaq-100 and Dow 30 member lists, every member's reports, and this season's table.</div></div>`;
      return;
    }
    if (!se.indices[S.ix]) S.ix = Object.keys(se.indices)[0];
    const ix = se.indices[S.ix], q = se.quarter || {};
    const qEnd = q.end ? new Date(q.end + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }) : '';
    const tabs = Object.entries(se.indices).map(([k, v]) => `<button class="seg-btn ${k === S.ix ? 'active' : ''}" data-ern-ix="${k}" style="font-size:10px">${esc(v.name || k)}</button>`).join('');
    // blended EPS tracking
    const ser = ((S.hist && S.hist.series) || {})[`${S.ix}:${q.label}`] || [];
    const first = ser[0], last = ser[ser.length - 1];
    const epsCard = ix.blendedEps != null ? `<div class="company-card" style="margin:0 0 12px;display:inline-block;min-width:240px;border:1px solid var(--rule)">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--ink-dim)">${esc(q.label)} BLENDED EPS · ${esc(ix.name)}</div>
        <div style="display:grid;grid-template-columns:auto auto;gap:3px 16px;font-family:var(--mono);font-size:11px;margin-top:6px">
          ${first ? `<span>As of ${esc(new Date(first.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }))}</span><span style="text-align:right">${money(first.eps)}</span>` : ''}
          <span>Current</span><span style="text-align:right">${money(ix.blendedEps)}</span>
          ${first && last && first.date !== last.date ? `<span><em>% change</em></span><span style="text-align:right">${spct(last.eps / first.eps - 1)}</span>` : ''}
        </div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">reported EPS where out, else the estimate · index level × Σ weight × EPS ÷ price${first ? ` · tracked since ${esc(first.date)}` : ''}</div></div>` : '';
    let table = row(`${ix.name} (absolute)`, ix.total, { bold: true, abs: true });
    table += GROUPS.map(([g]) => row(g, ix.groups && ix.groups[g], { top: g === 'Cyclicals' })).join('');
    GROUPS.forEach(([g, names]) => { table += names.map((s, k) => row(s, ix.sectors && ix.sectors[s], { top: k === 0, indent: true })).join(''); });
    const up = (ix.upcoming || []).slice(0, 40);
    const res = (ix.results || []).filter(r => !S.sector || r.sector === S.sector).slice(0, 60);
    const sectors = [...new Set((ix.results || []).map(r => r.sector).filter(Boolean))].sort();
    host.innerHTML = `
      <section class="company-card" style="margin:0 0 12px">
        <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">EARNINGS · ${esc(q.label)} SEASON</div>
          <span class="seg-control" style="font-size:10px">${tabs}</span>
          <div style="margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">as of ${esc(asOf(se.asOf))}</div></div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--ink);margin-top:8px;line-height:1.6">${ix.total.reported} of ${ix.total.members} reported (${pct(ix.total.pctReported)}) · ${pct(ix.total.pctBeat)} beating · ${pct(ix.total.pctMiss)} missing · aggregate surprise ${spct(ix.total.surprise)} · ${esc(ix.name)} since ${esc(qEnd)} ${spct(ix.total.returnSinceQEnd)}</div>
      </section>
      ${epsCard}
      <section class="company-card" style="margin:0 0 12px"><h4>${esc(ix.name)} ${esc(q.label)} reported earnings <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· bottom-up from each member's own report</span></h4>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table class="sb-table" style="width:100%;min-width:600px;font-family:var(--mono);font-size:11px">
          <thead><tr><th style="text-align:left">Sector</th><th style="text-align:right"># cos reported</th><th style="text-align:right">% cos reported</th><th style="text-align:right;background:rgba(74,144,226,0.10)">% cos beating</th><th style="text-align:right">% cos missing</th><th style="text-align:right">Surprise (%)</th><th style="text-align:right">Relative return since ${esc(qEnd)}</th></tr></thead>
          <tbody>${table}</tbody></table></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px;line-height:1.5">Beating / missing: reported EPS above / below the estimate on the report date (equal = in line). Surprise: Σ (reported − estimate) × shares ÷ Σ |estimate| × shares over the members that reported. Relative return: the sector SPDR since ${esc(q.end || '')} minus the index's own; groups weighted by their sectors' index weight. Members: ${esc(ix.source || '—')}${ix.weightCoverage != null ? ` (weights cover ${pct(ix.weightCoverage)})` : ''}. Reports: Yahoo.</div></section>
      <section class="company-card" style="margin:0 0 12px"><h4>Reporting next</h4>
        ${up.length ? `<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">When</th><th style="text-align:left">Ticker</th><th style="text-align:left">Sector</th><th style="text-align:right">EPS est.</th></tr></thead><tbody>
          ${up.map(u => `<tr><td style="white-space:nowrap">${esc(when(u.date, u.time))}</td><td>${link(u.ticker)}</td><td>${esc(u.sector || '—')}</td><td style="text-align:right">${money(u.est)}</td></tr>`).join('')}</tbody></table></div>` : '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No member reports scheduled in the season window.</div>'}</section>
      <section class="company-card" style="margin:0 0 12px"><h4>Latest results</h4>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"><button class="seg-btn ${!S.sector ? 'active' : ''}" data-ern-sec="" style="font-size:10px">All</button>${sectors.map(s => `<button class="seg-btn ${S.sector === s ? 'active' : ''}" data-ern-sec="${esc(s)}" style="font-size:10px">${esc(s)}</button>`).join('')}</div>
        ${res.length ? `<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:520px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Reported</th><th style="text-align:left">Ticker</th><th style="text-align:right">EPS est.</th><th style="text-align:right">EPS actual</th><th style="text-align:right">Surprise</th><th></th></tr></thead><tbody>
          ${res.map(r => { const s = r.surprisePct != null ? r.surprisePct / 100 : (r.est ? (r.act - r.est) / Math.abs(r.est) : null), b = r.act > r.est ? 'BEAT' : r.act < r.est ? 'MISS' : 'IN LINE';
            return `<tr><td style="white-space:nowrap">${esc(when(r.date, r.time))}</td><td>${link(r.ticker)}</td><td style="text-align:right">${money(r.est)}</td><td style="text-align:right">${money(r.act)}</td><td style="text-align:right">${spct(s)}</td><td style="color:${b === 'BEAT' ? 'var(--pos)' : b === 'MISS' ? 'var(--neg)' : 'var(--ink-dim)'};font-size:9.5px">${b}</td></tr>`; }).join('')}</tbody></table></div>` : '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No reports yet this season.</div>'}</section>`;
    host.querySelectorAll('[data-ern-ix]').forEach(b => b.onclick = () => { S.ix = b.dataset.ernIx; render(host); });
    host.querySelectorAll('[data-ern-sec]').forEach(b => b.onclick = () => { S.sector = b.dataset.ernSec; render(host); });
    host.querySelectorAll('[data-ern-open]').forEach(a => a.onclick = e => { e.preventDefault(); openTicker(a.dataset.ernOpen); });
  }

  // ---- one asset's earnings, on its Valuation page (under the price chart) ----
  async function tickerDoc(t) {
    if (S.tick[t] && Date.now() - S.tick[t].at < 10 * 60000) return S.tick[t].doc;
    let doc = null;
    try { doc = await getJSON(`tickers/${encodeURIComponent(t)}.json`); } catch (e) {}
    S.tick[t] = { at: Date.now(), doc };
    return doc;
  }
  function surpriseBars(hist) {
    const h = hist.slice(-8).filter(x => x.epsActual != null && x.epsEstimate != null);
    if (h.length < 2) return '';
    const vals = h.map(x => (x.surprisePct != null ? x.surprisePct : (x.epsEstimate ? (x.epsActual - x.epsEstimate) / Math.abs(x.epsEstimate) * 100 : 0)));
    const W = 320, H = 70, mx = Math.max(1, ...vals.map(Math.abs)), mid = H / 2, bw = W / h.length;
    return `<svg viewBox="0 0 ${W} ${H + 14}" style="width:100%;max-width:420px;height:auto;display:block" role="img" aria-label="Earnings surprise by quarter">
      <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--rule)" stroke-width="1"/>
      ${vals.map((v, i) => { const hgt = Math.abs(v) / mx * (mid - 4), y = v >= 0 ? mid - hgt : mid;
        return `<rect x="${(i * bw + bw * 0.2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${Math.max(0.5, hgt).toFixed(1)}" fill="${v >= 0 ? 'var(--pos)' : 'var(--neg)'}"><title>${esc(h[i].date)}: ${v.toFixed(1)}%</title></rect>
          <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H + 11}" font-size="8" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)">${esc(h[i].date.slice(2, 7))}</text>`; }).join('')}
    </svg><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">surprise % by report, same scale up and down (± ${mx.toFixed(1)}%)</div>`;
  }
  async function renderTicker(t) {
    const anchor = document.getElementById('price-chart-section');
    if (!anchor || !t) return;
    let sec = document.getElementById('ern-ticker-section');
    if (!sec) { sec = document.createElement('div'); sec.id = 'ern-ticker-section'; sec.className = 'section'; anchor.insertAdjacentElement('afterend', sec); }
    sec.dataset.ticker = t;
    sec.innerHTML = '<div class="company-card"><div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">Loading earnings…</div></div>';
    const doc = await tickerDoc(t);
    if (sec.dataset.ticker !== t) return;
    if (!doc) { sec.innerHTML = `<div class="company-card"><h4>Earnings</h4><div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No earnings on file for ${esc(t)} — tracked for S&amp;P 500, Nasdaq-100 and Dow members and the books' US stocks (after the pipeline's next run).</div></div>`; return; }
    const h = (doc.history || []).slice().reverse();
    const nx = doc.next;
    sec.innerHTML = `<div class="company-card"><h4>Earnings <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${esc(t)} · Yahoo</span></h4>
      <div style="font-family:var(--mono);font-size:11px;margin-bottom:8px">${nx ? `Next report <strong>${esc(when(nx.date, nx.time))}</strong> · EPS estimate <strong>${money(nx.epsEstimate)}</strong>` : 'No upcoming report date on file.'}</div>
      ${surpriseBars(doc.history || [])}
      ${h.length ? `<div style="overflow-x:auto;margin-top:6px"><table class="sb-table" style="width:100%;min-width:420px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Reported</th><th style="text-align:right">EPS est.</th><th style="text-align:right">EPS actual</th><th style="text-align:right">Surprise</th><th></th></tr></thead><tbody>
        ${h.map(r => { const b = r.epsActual > r.epsEstimate ? 'BEAT' : r.epsActual < r.epsEstimate ? 'MISS' : 'IN LINE', s = r.surprisePct != null ? r.surprisePct / 100 : (r.epsEstimate ? (r.epsActual - r.epsEstimate) / Math.abs(r.epsEstimate) : null);
          return `<tr><td style="white-space:nowrap">${esc(when(r.date, r.time))}</td><td style="text-align:right">${money(r.epsEstimate)}</td><td style="text-align:right">${money(r.epsActual)}</td><td style="text-align:right">${spct(s)}</td><td style="color:${b === 'BEAT' ? 'var(--pos)' : b === 'MISS' ? 'var(--neg)' : 'var(--ink-dim)'};font-size:9.5px">${b}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">updated ${esc(asOf(doc.updatedAt))}</div></div>`;
  }
  // hook: after the Valuation overview renders, show that asset's earnings
  (function () {
    const orig = window.renderSummary;
    if (typeof orig !== 'function' || orig._z136) return;
    const w = function () { const r = orig.apply(this, arguments); try { const st = arguments[0] || (typeof state !== 'undefined' ? state.stock : null); if (st && st.ticker) renderTicker(String(st.ticker).toUpperCase()); } catch (e) {} return r; };
    w._z136 = true; Object.keys(orig).forEach(k => { w[k] = orig[k]; });
    window.renderSummary = w;
  })();
  window.EarningsTab = { render, renderTicker, load, _S: S };
})();
