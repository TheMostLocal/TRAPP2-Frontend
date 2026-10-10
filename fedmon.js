/* ==========================================================================
   fedmon.js — Fed tab: QE/QT + Fed reaction monitor (z92). Loaded after app.js.

   Reads TRAPP2-1/data/fed/monitor.json (pipeline/fetch_fed_monitor.py) and adds
   four panels under the Fed tab's rate section:
     1. BALANCE SHEET (H.4.1, weekly): QE / QT state, monthly run-rate, split
        Treasuries vs MBS, reserves, TGA, reverse repo, "net liquidity"
        (assets - TGA - RRP), with 2.5-year charts.
     2. FOMC COMMUNICATION: latest statement / minutes / projections / balance-
        sheet notes, with the next meeting and when its minutes come out.
     3. SPEECHES: Chair and Governors, Chair highlighted.
     4. NEW YORK FED: SOMA holdings summary and the latest operation results.
   Each panel says when its data is stale and links to the official source.
   ========================================================================== */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const raw = () => { try { if (typeof GH_RAW !== 'undefined') return GH_RAW; } catch (e) {} return 'https://raw.githubusercontent.com/TheMostLocal'; };
  const bn = v => (v == null || !isFinite(v)) ? '—' : (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${(+v).toFixed(0)}bn`);
  const sbn = v => (v == null || !isFinite(v)) ? '—' : `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(0)}bn`;
  const day = iso => { const d = iso ? new Date(iso) : null; return d && isFinite(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  let MON = null, loadedAt = 0, loading = null;

  async function load() {
    if (MON && Date.now() - loadedAt < 15 * 60 * 1000) return MON;
    if (loading) return loading;
    loading = (async () => {
      try { const r = await fetch(`${raw()}/TRAPP2-1/main/data/fed/monitor.json`, { cache: 'no-cache' }); if (r.ok) { MON = await r.json(); loadedAt = Date.now(); } }
      catch (e) {}
      loading = null; return MON;
    })();
    return loading;
  }

  const card = (title, src, inner, stale) => `<div class="company-card" style="margin:12px 0">
      <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;margin-bottom:8px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">${title}</div>
        ${stale ? `<span style="font-family:var(--mono);font-size:9px;color:var(--amber)" title="${esc(stale)}">stale — last good data shown</span>` : ''}
        <span style="margin-left:auto;font-family:var(--mono);font-size:9px">${src}</span></div>${inner}</div>`;
  const link = (href, txt) => `<a href="${esc(href)}" target="_blank" rel="noopener" style="color:var(--ink-faint)">${esc(txt)} ↗</a>`;
  const kv = (k, v, sub, col) => `<div style="min-width:0"><div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--ink-faint)">${k}</div>
      <div style="font-family:var(--mono);font-size:15px;color:${col || 'var(--ink)'};margin-top:2px">${v}</div>${sub ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">${sub}</div>` : ''}</div>`;

  function balanceSheetHtml(m) {
    const b = m.balanceSheet, src = m.sources?.balanceSheet || {};
    if (!b) return card('BALANCE SHEET · QE / QT (H.4.1)', link('https://www.federalreserve.gov/releases/h41/', 'H.4.1'),
      '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No balance-sheet data yet — runs after TRAPP2-1 “Fed Monitor” (needs FRED_API_KEY).</div>', src.error);
    const qt = /QT/.test(b.stance), qe = /QE/.test(b.stance);
    const col = qt ? 'var(--neg)' : qe ? 'var(--pos)' : 'var(--amber)';
    const grid = `<div class="fm-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px 14px">
      ${kv('STANCE', esc(b.stance), `as of ${esc(b.asOf)}`, col)}
      ${kv('TOTAL ASSETS', bn(b.totalBn), `${sbn(b.change52wBn)} over 52 wk`)}
      ${kv('PACE (13-WK)', `${sbn(b.monthlyPaceBn)}/mo`, `4-wk ${sbn(b.change4wBn)}`, col)}
      ${kv('TREASURIES', bn(b.treasuries?.bn), b.treasuries?.monthlyBn != null ? `${sbn(b.treasuries.monthlyBn)}/mo` : '')}
      ${kv('MBS', bn(b.mbs?.bn), b.mbs?.monthlyBn != null ? `${sbn(b.mbs.monthlyBn)}/mo` : '')}
      ${kv('RESERVES', bn(b.reserves?.bn), b.reserves?.monthlyBn != null ? `${sbn(b.reserves.monthlyBn)}/mo` : '')}
      ${kv('TGA', bn(b.tga?.bn), 'Treasury cash at the Fed')}
      ${kv('REVERSE REPO', bn(b.rrp?.bn), b.rrp ? `as of ${esc(b.rrp.asOf)}` : '')}
      ${kv('NET LIQUIDITY', bn(b.netLiquidityBn), 'assets − TGA − RRP')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px">
      <div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">TOTAL ASSETS ($bn)</div><div id="fedmon-ta"></div></div>
      <div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">NET LIQUIDITY ($bn)</div><div id="fedmon-nl"></div></div>
    </div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px">QT = assets shrinking faster than $10bn/month on the 13-week run-rate; QE = growing faster than that. Net liquidity rises when the Fed adds reserves or when the TGA / reverse repo drain back into markets.</div>`;
    return card('BALANCE SHEET · QE / QT (H.4.1, weekly)', link('https://www.federalreserve.gov/releases/h41/', 'H.4.1 release'), grid, src.ok ? null : src.error);
  }

  function nextMinutes() {
    try {
      const sched = (typeof FOMC_SCHEDULE_2026 !== 'undefined') ? FOMC_SCHEDULE_2026 : [];
      const today = new Date().toISOString().slice(0, 10);
      const next = sched.find(x => x.date >= today);
      const prev = [...sched].reverse().find(x => x.date < today);
      const plus21 = d => new Date(Date.parse(d + 'T00:00:00Z') + 21 * 864e5).toISOString().slice(0, 10);
      return { next, prev, minutesOut: prev ? plus21(prev.date) : null };
    } catch (e) { return {}; }
  }

  function commsHtml(m) {
    const items = m.monetary || [], src = m.sources?.monetary || {};
    const typeCol = { statement: 'var(--amber)', minutes: '#7faaca', projections: '#c08ae0', implementation: 'var(--ink-dim)', 'balance-sheet': 'var(--neg)', other: 'var(--ink-faint)' };
    const nm = nextMinutes();
    const head = `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-bottom:8px">
      ${nm.next ? `Next FOMC: <strong style="color:var(--ink)">${esc(nm.next.date)}</strong>${nm.next.sep ? ' · with projections (dot plot)' : ''}` : ''}
      ${nm.prev ? ` · minutes of ${esc(nm.prev.date)} due ${esc(nm.minutesOut)}` : ''}</div>`;
    const rows = items.slice(0, 10).map(i => `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--rule);font-family:var(--mono);font-size:10.5px">
        <span style="min-width:84px;color:var(--ink-faint)">${esc(day(i.date))}</span>
        <span style="min-width:82px;color:${typeCol[i.type] || 'var(--ink-faint)'};text-transform:uppercase;font-size:9px;padding-top:2px">${esc(i.type || '')}</span>
        <a href="${esc(i.link)}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:none;flex:1">${esc(i.title)}</a></div>`).join('');
    return card('FOMC STATEMENTS · MINUTES · PROJECTIONS', link('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', 'FOMC calendar'),
      head + (rows || '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No items yet.</div>') + projectionsHtml(m), src.ok === false ? src.error : null);
  }

  function projectionsHtml(m) {
    const p = m.projections;
    if (!p) return '';
    const last = s => s && s.series && s.series.length ? s.series[s.series.length - 1] : null;
    const cells = Object.entries(p).map(([k, s]) => { const l = last(s); return l ? kv(esc(s.label.toUpperCase()), `${(+l[1]).toFixed(2)}%`, `latest SEP · ${esc(l[0])}`) : ''; }).join('');
    const path = p.FEDTARMD && p.FEDTARMD.series ? p.FEDTARMD.series.slice(-4).map(([d, v]) => `${d.slice(0, 4)}: ${(+v).toFixed(2)}%`).join(' · ') : '';
    return `<div style="margin-top:12px;font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--ink-dim)">SUMMARY OF ECONOMIC PROJECTIONS · MEDIANS</div>
      <div class="fm-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px 14px;margin-top:6px">${cells}</div>
      ${path ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:6px">Median fed-funds path: ${esc(path)}</div>` : ''}`;
  }

  function speechesHtml(m) {
    const items = m.speeches || [], src = m.sources?.speeches || {};
    const rows = items.slice(0, 10).map(i => `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--rule);font-family:var(--mono);font-size:10.5px">
        <span style="min-width:84px;color:var(--ink-faint)">${esc(day(i.date))}</span>
        <span style="min-width:72px;color:${i.chair ? 'var(--amber)' : 'var(--ink-dim)'};font-weight:${i.chair ? 700 : 400}">${esc(i.speaker || '')}${i.chair ? ' ★' : ''}</span>
        <a href="${esc(i.link)}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:none;flex:1">${esc(i.title.replace(/^[^,]+,\s*/, ''))}</a></div>`).join('');
    return card('SPEECHES · CHAIR &amp; GOVERNORS', link('https://www.federalreserve.gov/newsevents/speeches.htm', 'all speeches'),
      rows || '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No speeches yet.</div>', src.ok === false ? src.error : null);
  }

  function nyfedHtml(m) {
    const ny = m.nyfed || {}, src = m.sources?.nyfed || {};
    // The NY Fed API shapes vary by endpoint; show what's there generically.
    const soma = ny.somaSummary && !ny.somaSummary.error ? (ny.somaSummary.soma?.summary || ny.somaSummary.summary || []) : [];
    const s0 = Array.isArray(soma) ? soma[soma.length - 1] || soma[0] : null;
    const num = v => isFinite(+v) ? +v : null;
    const somaCells = s0 ? Object.entries(s0).filter(([k, v]) => num(v) != null && +v > 1e6).slice(0, 6)
      .map(([k, v]) => kv(esc(k.replace(/([A-Z])/g, ' $1').toUpperCase()), bn(num(v) / 1e9), '')).join('') : '';
    const ops = [];
    for (const key of ['repoLatest', 'treasuryOpsLatest']) {
      const o = ny[key];
      if (!o || o.error) continue;
      const list = o.repo?.operations || o.treasury?.auctions || o.operations || o.auctions || [];
      for (const x of (Array.isArray(list) ? list : []).slice(0, 4)) {
        ops.push(`<div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;border-bottom:1px solid var(--rule);font-family:var(--mono);font-size:10px">
          <span style="color:var(--ink-faint);min-width:84px">${esc(x.operationDate || x.operationDateTime || x.date || '')}</span>
          <span style="color:var(--ink-dim)">${esc(x.operationType || x.operationDirection || key)}</span>
          <span>${x.totalAmtAccepted != null ? bn(+x.totalAmtAccepted / 1e9) + ' accepted' : x.totalParAmtAccepted != null ? bn(+x.totalParAmtAccepted / 1e9) + ' accepted' : ''}</span></div>`);
      }
    }
    const inner = (s0 ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-bottom:6px">SOMA holdings as of ${esc(s0.asOfDate || '')}</div>
        <div class="fm-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px 14px">${somaCells}</div>` : '') +
      (ops.length ? `<div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--ink-dim);margin-top:10px">LATEST OPERATIONS</div>${ops.join('')}` : '') ||
      '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No NY Fed data yet.</div>';
    return card('NEW YORK FED · SOMA &amp; OPERATIONS', link('https://www.newyorkfed.org/markets/desk-operations', 'operation calendars') + ' · ' +
      link('https://www.newyorkfed.org/markets/soma-holdings', 'SOMA holdings'), inner, src.ok === false ? src.error : null);
  }

  async function renderMonitor() {
    const body = document.getElementById('fed-body');
    if (!body) return;
    let host = document.getElementById('fedmon');
    if (!host) { host = document.createElement('div'); host.id = 'fedmon'; body.appendChild(host); }
    host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:12px 0">Loading the Fed monitor…</div>';
    const m = await load();
    if (!document.getElementById('fedmon')) return;
    if (!m) {
      host.innerHTML = card('QE / QT &amp; FED REACTION MONITOR', '', `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);line-height:1.6">
        No monitor data yet. It's written by TRAPP2-1 → Actions → <strong>Fed Monitor</strong> (data/fed/monitor.json). Sources:
        ${link('https://www.federalreserve.gov/releases/h41/', 'H.4.1')} · ${link('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', 'FOMC')} ·
        ${link('https://www.federalreserve.gov/newsevents/speeches.htm', 'speeches')} · ${link('https://www.newyorkfed.org/markets/soma-holdings', 'NY Fed SOMA')}</div>`);
      return;
    }
    host.innerHTML = `<div style="font-family:var(--serif);font-size:24px;margin:22px 0 4px">QE / QT &amp; Fed reaction monitor</div>
      <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">updated ${esc(day(m.generatedAt))} · H.4.1 weekly (Thu) · statements 2:00pm ET on meeting days · minutes 3 weeks later</div>
      ${balanceSheetHtml(m)}${commsHtml(m)}${speechesHtml(m)}${nyfedHtml(m)}`;
    try {
      const b = m.balanceSheet;
      if (b && window.VChart) {
        const pts = a => (a || []).map(([t, v]) => ({ t, v }));
        window.VChart.drawStockChart(document.getElementById('fedmon-ta'), pts(b.totalAssets), { height: 140, money: false, label: 'Fed total assets' });
        window.VChart.drawStockChart(document.getElementById('fedmon-nl'), pts(b.netLiquidity), { height: 140, money: false, label: 'Net liquidity' });
      }
    } catch (e) { console.warn('[fedmon] charts', e); }
  }

  function wrap() {
    if (typeof window.renderFedTab !== 'function' || window.renderFedTab._z92) return false;
    const orig = window.renderFedTab;
    const w = function () { const r = orig.apply(this, arguments); try { renderMonitor(); } catch (e) { console.warn('[fedmon]', e); } return r; };
    w._z92 = true;
    window.renderFedTab = w;
    return true;
  }
  if (!wrap()) document.addEventListener('DOMContentLoaded', wrap);
  window.FedMonitor = { load, renderMonitor };
})();
