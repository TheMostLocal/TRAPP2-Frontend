/* ==========================================================================
   headcount.js — HEADCOUNT (z151). Each company's employee history on its Valuation page (bars, like
   an employee-count chart) with revenue per employee beneath it, and Data & Research → Headcount: the
   market's hiring breadth — how many companies are cutting vs growing, by sector and by year.
   Data: TRAPP2-ANALYTICS/data/headcount (pipeline/fetch_headcount.py, Mon + Thu 0640 ET).
   Geometry: every bar sits at its report date on a true time axis (quarterly and annual reports mixed
   on one axis would otherwise distort the spacing), width = 70 % of the tightest gap, height exactly
   proportional to headcount from a zero baseline; grid at round steps.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const BASE = () => `${RAW()}/TRAPP2-ANALYTICS/main/data/headcount/`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { docs: {}, summary: null, at: 0 };
  async function getJSON(f) { const r = await fetch(BASE() + f + '?_=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  const fmtN = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
  const fmtK = v => (v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v)));
  const pct = (v, d = 1) => (v == null ? '—' : `<span style="color:${v < 0 ? 'var(--neg)' : v > 0 ? 'var(--pos)' : 'inherit'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%</span>`);
  const money = v => (v == null ? '—' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : '$' + Math.round(v / 1e3).toLocaleString('en-US') + 'K');
  const qlab = ds => { const d = new Date(ds + 'T12:00:00Z'); return `Q${Math.floor(d.getUTCMonth() / 3) + 1} '${String(d.getUTCFullYear()).slice(2)}`; };
  const niceStep = mx => { const raw = mx / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; };
  const SRC = { filing: 'filing', tenk: 'annual report', sec: 'SEC', wikidata: 'Wikidata', profile: 'quote page' };

  function bars(points, opts = {}) {
    const W = opts.W || 640, H = opts.H || 220, L = 4, R = 44, T = 10, B = 26;
    const t = points.map(p => Date.parse(p.date + 'T12:00:00Z'));
    const t0 = Math.min(...t), t1 = Math.max(...t), span = Math.max(1, t1 - t0);
    const gaps = t.slice(1).map((v, i) => v - t[i]).filter(g => g > 0);
    const minGap = gaps.length ? Math.min(...gaps) : span || 1;
    const plotW = W - L - R;
    const x = v => L + (points.length === 1 ? plotW / 2 : ((v - t0) / span) * (plotW - 24) + 12);
    const bw = Math.max(2, Math.min(36, points.length === 1 ? 36 : (minGap / span) * (plotW - 24) * 0.7));
    const mx = Math.max(...points.map(p => p.employees)), step = niceStep(mx), top = Math.ceil(mx / step) * step;
    const y = v => T + (H - T - B) * (1 - v / top);
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(2)}" y2="${y(v).toFixed(2)}" stroke="var(--rule)" stroke-width="${v === 0 ? 1 : 0.6}"/><text x="${W - R + 6}" y="${(y(v) + 3).toFixed(2)}" font-size="9" fill="var(--ink-faint)" font-family="var(--mono)">${fmtK(v)}</text>`;
    const lastI = points.length - 1;
    const every = Math.max(1, Math.ceil(points.length / 12));
    let b = '';
    points.forEach((p, i) => {
      const cx = x(t[i]), h = (H - T - B) * (p.employees / top);
      b += `<rect x="${(cx - bw / 2).toFixed(2)}" y="${(H - B - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" fill="${p.source === 'profile' ? 'var(--ink-faint)' : i === lastI ? 'var(--amber)' : '#2f7fd1'}"><title>${esc(p.date)}: ${fmtN(p.employees)} employees (${esc(SRC[p.source] || p.source)}${p.form ? ' ' + esc(p.form) : ''})</title></rect>`;
      if (i % every === 0 || i === lastI) b += `<text x="${cx.toFixed(2)}" y="${H - B + 12}" font-size="8" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)">${esc(opts.annual ? p.date.slice(0, 4) : qlab(p.date))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="${esc(opts.label || 'Headcount')}">${g}${b}</svg>`;
  }

  async function renderTicker(tk) {
    const anchor = document.getElementById('credit-ticker-section') || document.getElementById('ern-ticker-section') || document.getElementById('price-chart-section');
    if (!anchor || !tk) return;
    let sec = document.getElementById('hc-ticker-section');
    if (!sec) { sec = document.createElement('div'); sec.id = 'hc-ticker-section'; sec.className = 'section'; }
    if (sec.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', sec);
    sec.dataset.ticker = tk;
    let doc = S.docs[tk];
    if (doc === undefined) { try { doc = await getJSON(encodeURIComponent(tk) + '.json'); } catch (e) { doc = null; } S.docs[tk] = doc; }
    if (sec.dataset.ticker !== tk) return;
    if (!doc || !(doc.points || []).length) { sec.style.display = 'none'; sec.innerHTML = ''; return; }
    sec.style.display = '';
    const m = doc.metrics || {}, pts = doc.points.slice(-44), last = m.latest || pts[pts.length - 1];
    const annual = m.cadence !== 'quarterly';
    const rpe = (m.revenuePerEmployee || []).slice(-12);
    // the headline uses the same basis as its year-over-year change: the reported series at the latest
    // headcount date; the quote page's TTM revenue only when the reports don't line up
    const rpeNow = (rpe.length && rpe[rpe.length - 1].date === last.date) ? rpe[rpe.length - 1] : (m.rpeNow || (rpe.length ? rpe[rpe.length - 1] : null));
    const rpeYoY = rpe.length >= 2 ? (() => { const a = rpe[rpe.length - 1], tgt = Date.parse(a.date) - 365 * 864e5; const b = rpe.slice(0, -1).reduce((best, r) => (Math.abs(Date.parse(r.date) - tgt) < Math.abs(Date.parse(best.date) - tgt) ? r : best)); return Math.abs(Date.parse(b.date) - tgt) < 80 * 864e5 ? (a.rpe / b.rpe - 1) * 100 : null; })() : null;
    const srcs = [...new Set(pts.map(p => SRC[p.source] || p.source))].join(', ');
    const rpeBars = rpe.length >= 2 ? (() => {
      const W = 640, H = 90, mx = Math.max(...rpe.map(r => r.rpe)), bw = (W - 60) / rpe.length;
      return `<svg viewBox="0 0 ${W} ${H + 14}" style="width:100%;height:auto;display:block;margin-top:4px" role="img" aria-label="Revenue per employee">
        <line x1="0" x2="${W - 56}" y1="${H}" y2="${H}" stroke="var(--rule)"/>
        ${rpe.map((r, i) => { const h = (H - 6) * r.rpe / mx; return `<rect x="${(i * bw + bw * 0.15).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${(bw * 0.7).toFixed(2)}" height="${h.toFixed(2)}" fill="var(--amber)" opacity="0.8"><title>${esc(r.date)}: ${money(r.rpe)} (TTM ${money(r.revenue)} ÷ ${fmtN(r.employees)})</title></rect><text x="${(i * bw + bw / 2).toFixed(2)}" y="${H + 11}" font-size="8" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)">${esc(annual ? r.date.slice(0, 4) : qlab(r.date))}</text>`; }).join('')}
        <text x="${W - 50}" y="12" font-size="9" fill="var(--ink-faint)" font-family="var(--mono)">${money(mx)}</text></svg>`;
    })() : '';
    sec.innerHTML = `<div class="company-card"><h4>Headcount <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${esc(tk)} · ${annual ? 'annual reports' : 'quarterly reports'} · ${esc(srcs)}</span></h4>
      <div style="display:flex;flex-wrap:wrap;gap:10px 24px;font-family:var(--mono);font-size:11px;margin:4px 0 8px">
        <div><div style="color:var(--ink-faint);font-size:9px">EMPLOYEES</div><div style="font-size:16px;font-weight:700">${fmtN(last.employees)}</div><div style="font-size:9px;color:var(--ink-faint)">as of ${esc(last.date)}</div></div>
        <div><div style="color:var(--ink-faint);font-size:9px">VS A YEAR EARLIER</div><div style="font-size:14px">${pct(m.yoyPct)}</div><div style="font-size:9px;color:var(--ink-faint)">${m.yoyFrom ? 'vs ' + esc(m.yoyFrom) : 'not enough history yet'}</div></div>
        ${m.qoqPct != null ? `<div><div style="color:var(--ink-faint);font-size:9px">VS LAST QUARTER</div><div style="font-size:14px">${pct(m.qoqPct)}</div></div>` : ''}
        <div><div style="color:var(--ink-faint);font-size:9px">FROM PEAK</div><div style="font-size:14px">${pct(m.fromPeakPct)}</div><div style="font-size:9px;color:var(--ink-faint)">peak ${fmtN(m.peak && m.peak.employees)} (${esc(m.peak && m.peak.date)})</div></div></div>
      ${bars(pts, { annual, label: tk + ' employee count' })}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px">bars at their report dates (true time spacing) · amber = latest · grey = the quote page's count, dated at the latest fiscal-year end</div>
      <div style="margin-top:12px;font-family:var(--mono);font-size:11px"><span style="color:var(--ink-faint);font-size:9px;letter-spacing:.08em">REVENUE PER EMPLOYEE</span>
        <div style="font-size:15px;font-weight:700;margin-top:2px">${rpeNow ? money(rpeNow.rpe) : '—'}${rpeYoY != null ? ` <span style="font-size:11px;font-weight:400">${pct(rpeYoY)} vs a year earlier</span>` : ''}</div>
        <div style="font-size:9px;color:var(--ink-faint)">${rpeNow ? `trailing-12-month revenue ${money(rpeNow.revenue)} ÷ ${fmtN(rpeNow.employees)} employees${m.currency && m.currency !== 'USD' ? ' · ' + esc(m.currency) : ''}` : 'needs revenue and headcount for the same period'}</div></div>
      ${rpeBars}</div>`;
  }

  async function render(host) {
    if (!host) return;
    if (!S.summary || Date.now() - S.at > 10 * 60000) { try { S.summary = await getJSON('summary.json'); } catch (e) { S.summary = null; } S.at = Date.now(); }
    const s = S.summary;
    if (!s || !s.now) { host.innerHTML = `<div class="company-card"><h4>Headcount</h4><div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim)">Waiting for the first run of TRAPP2-ANALYTICS → <strong>Headcount</strong> (Mon + Thu 0640 ET, or run it from the Actions tab).</div></div>`; return; }
    const n = s.now;
    const years = s.byYear || [];
    const W = 640, H = 150, bw = (W - 40) / Math.max(1, years.length);
    const yr = years.length ? `<svg viewBox="0 0 ${W} ${H + 16}" style="width:100%;height:auto;display:block" role="img" aria-label="Share of companies cutting headcount by year">
      <line x1="0" x2="${W - 36}" y1="${H}" y2="${H}" stroke="var(--rule)"/>
      ${[25, 50].map(v => `<line x1="0" x2="${W - 36}" y1="${H - H * v / 100}" y2="${H - H * v / 100}" stroke="var(--rule)" stroke-width="0.5" stroke-dasharray="2 3"/><text x="${W - 32}" y="${H - H * v / 100 + 3}" font-size="9" fill="var(--ink-faint)" font-family="var(--mono)">${v}%</text>`).join('')}
      ${years.map((y, i) => { const h = H * y.pctCutting / 100; return `<rect x="${(i * bw + bw * 0.15).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${(bw * 0.7).toFixed(2)}" height="${h.toFixed(2)}" fill="${y.pctCutting >= 40 ? 'var(--neg)' : y.pctCutting >= 25 ? 'var(--amber)' : 'var(--pos)'}"><title>${y.year}: ${y.pctCutting}% of ${y.companies} companies cut headcount · aggregate ${y.aggregateYoY}%</title></rect><text x="${(i * bw + bw / 2).toFixed(2)}" y="${H + 12}" font-size="8" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)">'${String(y.year).slice(2)}</text>`; }).join('')}</svg>` : '';
    const list = (rows, title) => `<div style="flex:1;min-width:220px"><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:.08em;margin-bottom:4px">${title}</div>${(rows || []).map(r => `<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px solid var(--rule)"><a href="#" data-hc-open="${esc(r.ticker)}" style="color:var(--amber);text-decoration:none">${esc(r.ticker)}</a><span>${fmtN(r.employees)} · ${pct(r.yoyPct)}</span></div>`).join('')}</div>`;
    host.innerHTML = `<section class="company-card" style="margin:0 0 12px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">HEADCOUNT · HIRING BREADTH · ${n.companies} companies with a year-over-year comparison</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px 28px;margin-top:10px;font-family:var(--mono)">
          <div><div style="font-size:9px;color:var(--ink-faint)">CUTTING (≤ −2 % YoY)</div><div style="font-size:20px;font-weight:700;color:${n.pctCutting >= 40 ? 'var(--neg)' : n.pctCutting >= 25 ? 'var(--amber)' : 'var(--ink)'}">${n.pctCutting}%</div></div>
          <div><div style="font-size:9px;color:var(--ink-faint)">GROWING (≥ +2 %)</div><div style="font-size:20px;font-weight:700">${n.pctGrowing}%</div></div>
          <div><div style="font-size:9px;color:var(--ink-faint)">AGGREGATE HEADCOUNT</div><div style="font-size:20px;font-weight:700">${pct(n.aggregateYoY)}</div><div style="font-size:9px;color:var(--ink-faint)">${fmtN(n.employees)} employees</div></div>
          <div><div style="font-size:9px;color:var(--ink-faint)">MEDIAN COMPANY</div><div style="font-size:20px;font-weight:700">${pct(n.medianYoY)}</div></div></div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:8px;line-height:1.5">One company trimming staff raises an eyebrow; many at once is how a slowdown shows up in the labor data. ${n.pctCutting >= 40 ? 'A broad share is cutting now — consistent with a slowing economy.' : n.pctCutting >= 25 ? 'Cutting is spreading — worth watching alongside the regime and credit reads.' : 'Cutting is contained — most companies are holding or adding staff.'}</div></section>
      ${yr ? `<section class="company-card" style="margin:0 0 12px"><h4>Share of companies cutting headcount, by year</h4>${yr}<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">year-end vs the prior year-end (±75 days) · bar height = share cutting (0–100 %, exact) · red ≥ 40 %, amber ≥ 25 %</div></section>` : ''}
      <section class="company-card" style="margin:0 0 12px"><h4>By sector</h4><div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:520px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Sector</th><th style="text-align:right">Companies</th><th style="text-align:right">Cutting</th><th style="text-align:right">Growing</th><th style="text-align:right">Median YoY</th><th style="text-align:right">Aggregate</th></tr></thead><tbody>
        ${Object.entries(s.sectors || {}).filter(([, v]) => v).sort((a, b) => b[1].pctCutting - a[1].pctCutting).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${v.companies}</td><td style="text-align:right">${v.pctCutting}%</td><td style="text-align:right">${v.pctGrowing}%</td><td style="text-align:right">${pct(v.medianYoY)}</td><td style="text-align:right">${pct(v.aggregateYoY)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="company-card" style="margin:0 0 12px;display:flex;flex-wrap:wrap;gap:16px">${list(s.cutting, 'BIGGEST CUTS (≥ 1,000 EMPLOYEES)')}${list(s.growing, 'BIGGEST HIRING')}</section>
      ${(s.excluded || []).length ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-bottom:4px">Left out of the read (moves beyond ±60 % — usually a merger or two sources counting differently): ${(s.excluded || []).slice(0, 12).map(r => `${esc(r.ticker)} ${r.yoyPct > 0 ? '+' : ''}${r.yoyPct}%`).join(' · ')}</div>` : ''}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">${esc(s.note || '')} · as of ${esc(String(s.asOf || '').slice(0, 10))}</div>`;
    host.querySelectorAll('[data-hc-open]').forEach(a => a.onclick = e => { e.preventDefault(); const i = document.getElementById('ticker'); if (i) i.value = a.dataset.hcOpen; if (typeof switchTab === 'function') switchTab('valuation'); if (typeof loadValuation === 'function') loadValuation(); });
  }

  (function () {
    const orig = window.renderSummary;
    if (typeof orig !== 'function' || orig._z151) return;
    const w = function () { const r = orig.apply(this, arguments); try { const st = arguments[0] || (typeof state !== 'undefined' ? state.stock : null); if (st && st.ticker) setTimeout(() => renderTicker(String(st.ticker).toUpperCase()), 80); } catch (e) {} return r; };
    w._z151 = true; Object.keys(orig).forEach(k => { w[k] = orig[k]; });
    window.renderSummary = w;
  })();
  window.Headcount = { render, renderTicker, bars, _S: S };
})();
