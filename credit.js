/* ==========================================================================
   credit.js — CREDIT: JUNK & CORPORATE BONDS (z132). Macro Data → Credit. Load after charts.js.

   Free primary sources only, read from TRAPP2-1 (Mid-Day refresh):
     • ICE BofA US corporate indices via FRED — option-adjusted spreads (OAS) for high yield
       (all, BB, B, CCC & lower), investment grade (all, AAA, AA, A, BBB), Euro HY, EM corporates;
       effective yields; total-return indices. FRED carries ~3 years of these (ICE licensing),
       so every percentile here is "of the last ~3 years" and says so.
     • Moody's seasoned Aaa / Baa corporate yields and Baa − 10Y (back to 1986) for the long view.
     • FINRA TRACE corporate-bond breadth (IG vs HY advances / declines / 52-week highs & lows),
       when the FINRA API secrets are set (pipeline/fetch_finra_credit.py).
     • The books' credit ETFs (HYG, JNK, LQD, EMB, VCSH) — price return, distributions excluded.
   Read: junk spread level (tight < 300 bp · normal < 450 · wide < 650 · stressed < 900 · distressed),
   its 1-month move, CCC − BB (decompression = the weakest credits lagging), HY − IG.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SPREADS = [
    ['BAMLH0A0HYM2', 'High yield (all)', 'hy'], ['BAMLH0A1HYBB', 'BB', 'hy'], ['BAMLH0A2HYB', 'B', 'hy'], ['BAMLH0A3HYC', 'CCC & lower', 'hy'],
    ['BAMLC0A0CM', 'Investment grade (all)', 'ig'], ['BAMLC0A1CAAA', 'AAA', 'ig'], ['BAMLC0A2CAA', 'AA', 'ig'], ['BAMLC0A3CA', 'A', 'ig'], ['BAMLC0A4CBBB', 'BBB', 'ig'],
    ['BAMLHE00EHYIOAS', 'Euro high yield', 'x'], ['BAMLEMCBPIOAS', 'EM corporates', 'x'], ['BAA10Y', "Moody's Baa − 10Y", 'x'],
  ];
  const YIELDS = [['BAMLH0A0HYM2EY', 'High-yield effective yield'], ['BAMLC0A0CMEY', 'IG effective yield'], ['DBAA', "Moody's Baa yield"], ['DAAA', "Moody's Aaa yield"]];
  const TR = [['BAMLHYH0A0HYM2TRIV', 'High-yield total return'], ['BAMLCC0A0CMTRIV', 'IG total return']];
  const LADDER = [['AAA', 'BAMLC0A1CAAA'], ['AA', 'BAMLC0A2CAA'], ['A', 'BAMLC0A3CA'], ['BBB', 'BAMLC0A4CBBB'], ['BB', 'BAMLH0A1HYBB'], ['B', 'BAMLH0A2HYB'], ['CCC', 'BAMLH0A3HYC']];
  const ETFS = [['HYG', 'High-yield (iShares)'], ['JNK', 'High-yield (SPDR)'], ['LQD', 'IG corporates'], ['EMB', 'EM sovereign $'], ['VCSH', 'Short-term IG']];
  const S = { data: null, at: 0, pick: 'BAMLH0A0HYM2', finra: null };

  async function getJSON(u) { const r = await fetch(u + (u.includes('?') ? '&' : '?') + '_=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function series(id) {
    try {
      const d = await getJSON(`${RAW()}/TRAPP2-1/main/data/macro/${id}.json`);
      return (d.observations || []).filter(o => o && o.date && o.value !== '.' && o.value !== '' && o.value != null && isFinite(+o.value)).map(o => ({ d: String(o.date).slice(0, 10), v: +o.value }));
    } catch (e) { return []; }
  }
  async function load() {
    if (S.data && Date.now() - S.at < 10 * 60000) return S.data;
    const ids = [...SPREADS, ...YIELDS, ...TR].map(x => x[0]);
    const vals = await Promise.all(ids.map(series));
    const data = {}; ids.forEach((id, i) => { data[id] = vals[i]; });
    try { S.finra = await getJSON(`${RAW()}/TRAPP2-1/main/data/credit/finra_breadth.json`); } catch (e) { S.finra = null; }
    S.data = data; S.at = Date.now();
    return data;
  }
  // value on/before a date; change in bp over a calendar lookback; percentile of the latest within the history
  const at = (s, d) => { let v = null; for (const o of s) { if (o.d <= d) v = o; else break; } return v; };
  const back = (s, days) => { if (!s.length) return null; const last = s[s.length - 1]; return at(s, new Date(Date.parse(last.d + 'T12:00:00Z') - days * 864e5).toISOString().slice(0, 10)); };
  const pctile = s => { if (s.length < 20) return null; const v = s[s.length - 1].v; return s.filter(o => o.v <= v).length / s.length; };
  const bp = v => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`);
  const lvlBp = v => (v == null ? '—' : `${Math.round(v * 100)} bp`);
  const pc = v => (v == null ? '—' : v.toFixed(2) + '%');
  function regimeOf(hyBp) {
    if (hyBp == null) return null;
    return hyBp < 300 ? ['TIGHT', 'var(--amber)'] : hyBp < 450 ? ['NORMAL', 'var(--pos)'] : hyBp < 650 ? ['WIDE', 'var(--amber)'] : hyBp < 900 ? ['STRESSED', 'var(--neg)'] : ['DISTRESSED', 'var(--neg)'];
  }
  function read(d) {
    const hy = d.BAMLH0A0HYM2, ig = d.BAMLC0A0CM, ccc = d.BAMLH0A3HYC, bb = d.BAMLH0A1HYBB;
    if (!hy || !hy.length) return null;
    const L = s => (s && s.length ? s[s.length - 1].v : null), M = s => { const b = s && back(s, 30); return b && s.length ? (s[s.length - 1].v - b.v) * 100 : null; };
    const hyBp = L(hy) * 100, hy1m = M(hy), p = pctile(hy), rg = regimeOf(hyBp);
    const dec = ccc && bb && ccc.length && bb.length ? (L(ccc) - L(bb)) * 100 : null;
    const dec1m = ccc && bb ? (() => { const c = back(ccc, 30), b = back(bb, 30); return c && b && dec != null ? dec - (c.v - b.v) * 100 : null; })() : null;
    const move = hy1m == null ? '' : hy1m >= 25 ? `widening (${bp(hy1m)} bp in a month)` : hy1m <= -25 ? `tightening (${bp(hy1m)} bp in a month)` : `steady (${bp(hy1m)} bp in a month)`;
    const parts = [`Junk ${rg[0].toLowerCase()} at ${Math.round(hyBp)} bp${p != null ? ` (${Math.round(p * 100)}th percentile of ~3 years)` : ''}, ${move}`];
    if (dec != null) parts.push(`CCC − BB ${Math.round(dec)} bp${dec1m != null ? ` (${bp(dec1m)} 1M${dec1m >= 25 ? ': the weakest credits are lagging — decompression' : dec1m <= -25 ? ': the weakest credits are catching up — reach for yield' : ''})` : ''}`);
    if (ig && ig.length) parts.push(`IG ${Math.round(L(ig) * 100)} bp (${bp(M(ig))} 1M)`);
    return { text: parts.join(' · '), regime: rg, hyBp, hy1m, p };
  }

  function ladderSvg(d) {
    const W = 340, H = 170, L0 = 40, R = 10, T = 12, B = 26;
    const pts = k => LADDER.map(([lab, id]) => { const s = d[id] || []; const o = k === 0 ? s[s.length - 1] : back(s, k); return o ? o.v * 100 : null; });
    const now = pts(0), m1 = pts(30), y1 = pts(365);
    const all = [...now, ...m1, ...y1].filter(v => v != null && v > 0);
    if (!all.length) return '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">Rating spreads arrive with the next Mid-Day refresh.</div>';
    const lo = Math.log10(Math.min(...all) * 0.8), hi = Math.log10(Math.max(...all) * 1.2);
    const X = i => L0 + (i + 0.5) * (W - L0 - R) / LADDER.length, Y = v => T + (hi - Math.log10(v)) / (hi - lo) * (H - T - B);
    const line = (arr, col, dash, w) => { let p = '', pen = false; arr.forEach((v, i) => { if (v == null || !(v > 0)) { pen = false; return; } p += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `; pen = true; });
      return `<path d="${p}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>` + arr.map((v, i) => v > 0 ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${w + 0.8}" fill="${col}"/>` : '').join(''); };
    const ticks = [25, 50, 100, 200, 400, 800, 1600].filter(v => Math.log10(v) >= lo && Math.log10(v) <= hi);
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Spread by rating">
      ${ticks.map(v => `<line x1="${L0}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--rule)" stroke-width="0.6"/><text x="${L0 - 4}" y="${(Y(v) + 3).toFixed(1)}" font-size="8.5" text-anchor="end" fill="var(--ink-faint)" font-family="var(--mono)">${v}</text>`).join('')}
      <line x1="${X(3.5).toFixed(1)}" x2="${X(3.5).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="var(--ink-faint)" stroke-dasharray="2,3"/><text x="${(X(3.5) + 3).toFixed(1)}" y="${T + 8}" font-size="8" fill="var(--ink-faint)" font-family="var(--mono)">junk →</text>
      ${line(y1, 'var(--ink-faint)', '1.5,2.5', 1)}${line(m1, 'var(--ink-dim)', '4,3', 1.2)}${line(now, 'var(--amber)', '', 1.8)}
      ${LADDER.map(([lab], i) => `<text x="${X(i).toFixed(1)}" y="${H - 8}" font-size="9" text-anchor="middle" fill="var(--ink-dim)" font-family="var(--mono)">${lab}</text>`).join('')}
    </svg>
    <div style="display:flex;gap:12px;flex-wrap:wrap;font-family:var(--mono);font-size:9px;color:var(--ink-faint)"><span style="color:var(--amber)">● now</span><span style="color:var(--ink-dim)">– – 1 month ago</span><span>··· 1 year ago</span><span>OAS in bp · log scale · ratings equally spaced</span></div>`;
  }

  function boardRows(d) {
    const row = (id, name, unit) => {
      const s = d[id] || [];
      if (!s.length) return `<tr><td>${esc(name)}</td><td colspan="6" style="color:var(--ink-faint)">next Mid-Day refresh</td></tr>`;
      const last = s[s.length - 1].v, ch = k => { const b = back(s, k); return b ? (last - b.v) * 100 : null; }, p = pctile(s);
      const cell = v => `<td style="color:${v == null ? 'var(--ink-faint)' : unit === 'tr' ? (v >= 0 ? 'var(--pos)' : 'var(--neg)') : (v > 0 ? 'var(--neg)' : v < 0 ? 'var(--pos)' : 'inherit')}">${v == null ? '—' : unit === 'tr' ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : bp(v)}</td>`;
      if (unit === 'tr') { const r = k => { const b = back(s, k); return b ? (last / b.v - 1) * 100 : null; }; return `<tr data-cr-pick="${id}" style="cursor:pointer"><td>${esc(name)}</td><td>${last.toFixed(1)}</td>${cell(r(7))}${cell(r(30))}${cell(r(91))}${cell(r(365))}<td>—</td></tr>`; }
      return `<tr data-cr-pick="${id}" style="cursor:pointer"><td>${esc(name)}</td><td>${unit === 'y' ? pc(last) : lvlBp(last)}</td>${cell(ch(7))}${cell(ch(30))}${cell(ch(91))}${cell(ch(365))}<td>${p == null ? '—' : Math.round(p * 100) + 'th'}</td></tr>`;
    };
    return SPREADS.map(([id, n]) => row(id, n, 's')).join('') +
      `<tr><td colspan="7" style="color:var(--ink-faint);font-size:9px;padding-top:8px">YIELDS</td></tr>` + YIELDS.map(([id, n]) => row(id, n, 'y')).join('') +
      `<tr><td colspan="7" style="color:var(--ink-faint);font-size:9px;padding-top:8px">TOTAL RETURN (index level · % change)</td></tr>` + TR.map(([id, n]) => row(id, n, 'tr')).join('');
  }

  function finraHtml() {
    const f = S.finra;
    if (!f || !Array.isArray(f.rows) || !f.rows.length) return `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);line-height:1.6">TRACE breadth (FINRA): not connected. Add the free FINRA API credentials as TRAPP2-1 secrets FINRA_CLIENT_ID / FINRA_CLIENT_SECRET (FINRA API Console) and the next Mid-Day refresh adds investment-grade vs high-yield advances, declines and 52-week highs / lows.</div>`;
    const dateK = Object.keys(f.rows[0]).find(k => /date/i.test(k)) || 'tradeReportDate';
    const catK = Object.keys(f.rows[0]).find(k => /categ|product|grade|type/i.test(k));
    const last = f.rows.map(r => String(r[dateK] || '')).sort().pop();
    const today = f.rows.filter(r => String(r[dateK] || '') === last);
    const nums = Object.keys(f.rows[0]).filter(k => k !== dateK && k !== catK && today.some(r => typeof r[k] === 'number'));
    return `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-bottom:4px">FINRA TRACE · ${esc(f.dataset)} · ${esc(last)}</div>
      <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px"><thead><tr><th style="text-align:left">${esc(catK || 'segment')}</th>${nums.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead>
      <tbody>${today.map(r => `<tr><td>${esc(catK ? r[catK] : '')}</td>${nums.map(k => `<td>${r[k] == null ? '—' : (+r[k]).toLocaleString()}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  async function etfHtml() {
    if (!(window.VChart && window.VChart.fetchDaily)) return '';
    const rows = await Promise.all(ETFS.map(async ([t, n]) => {
      let h = []; try { h = await window.VChart.fetchDaily(t) || []; } catch (e) {}
      if (!h.length) return '';
      const last = h[h.length - 1], r = days => { const from = new Date(Date.parse(last.d + 'T12:00:00Z') - days * 864e5).toISOString().slice(0, 10); let b = null; for (const x of h) { if (x.d <= from) b = x; else break; } return b ? (last.c / b.c - 1) * 100 : null; };
      const c = v => `<td style="color:${v == null ? 'var(--ink-faint)' : v >= 0 ? 'var(--pos)' : 'var(--neg)'}">${v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'}</td>`;
      return `<tr><td><a href="#" data-cr-etf="${t}" style="color:var(--amber);font-weight:700;text-decoration:none">${t}</a> <span style="color:var(--ink-faint)">${esc(n)}</span></td><td>$${last.c.toFixed(2)}</td>${c(r(30))}${c(r(91))}${c(r(365))}</tr>`;
    }));
    return `<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px"><thead><tr><th style="text-align:left">ETF</th><th>Last</th><th>1M</th><th>3M</th><th>1Y</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">Price return — the funds' monthly distributions are excluded (the ICE total-return rows above include coupons).</div>`;
  }

  async function render(host) {
    if (!host) return;
    if (!S.data) host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading credit…</div>';
    const d = await load();
    if (!host.isConnected) return;
    const r = read(d), hy = d.BAMLH0A0HYM2 || [];
    const asOf = hy.length ? hy[hy.length - 1].d : '—';
    host.innerHTML = `
      <section class="company-card" style="margin:0 0 12px;border-left:3px solid ${r ? r.regime[1] : 'var(--rule)'}">
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">CREDIT · JUNK &amp; CORPORATE BONDS</div>
          ${r ? `<div style="font-family:var(--mono);font-size:15px;font-weight:700;color:${r.regime[1]}">${r.regime[0]} · ${Math.round(r.hyBp)} bp</div>` : ''}
          <div style="margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">ICE BofA via FRED · ${esc(asOf)}</div></div>
        <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink);margin-top:6px;line-height:1.6">${r ? esc(r.text) : 'High-yield spreads not in the data yet.'}</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px">Bands for the junk spread: tight &lt; 300 bp · normal &lt; 450 · wide &lt; 650 · stressed &lt; 900 · distressed beyond. Context, not a signal: the bot records it on every trade.</div>
      </section>
      <section class="company-card" style="margin:0 0 12px"><h4>Spread board <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· option-adjusted spread over Treasuries · changes in bp · percentile of ~3 years · tap a row to chart it</span></h4>
        <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:520px"><thead><tr><th style="text-align:left">Series</th><th>Now</th><th>1W</th><th>1M</th><th>3M</th><th>1Y</th><th>Pctile</th></tr></thead><tbody>${boardRows(d)}</tbody></table></div></section>
      <section class="company-card" style="margin:0 0 12px"><h4>Quality ladder <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· spread by rating, AAA → CCC</span></h4>${ladderSvg(d)}</section>
      <section class="company-card" style="margin:0 0 12px"><div id="cr-chart"></div></section>
      <section class="company-card" style="margin:0 0 12px"><h4>Credit ETFs</h4><div id="cr-etfs"><div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">Loading…</div></div></section>
      <section class="company-card" style="margin:0 0 12px"><h4>TRACE breadth</h4>${finraHtml()}</section>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);line-height:1.6;margin-bottom:12px">Sources: ICE BofA indices (FRED; ICE limits FRED to ~3 years), Moody's seasoned yields (FRED, since 1986), FINRA TRACE (official API, noncommercial use), the books' ETF closes. Not wired, by design: BondTerminal (paid terminal), aistockwire / CCIR / ZeroHedge (articles and research pages without a data feed — scraping them would break their terms and break on any redesign). Single bonds (e.g. CoreWeave's 2030–2032 notes) can come from FINRA's TRACE trade data with the same credentials — next step once connected.</div>`;
    host.querySelectorAll('[data-cr-pick]').forEach(tr => tr.onclick = () => { S.pick = tr.dataset.crPick; drawChart(d); host.querySelector('#cr-chart').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    drawChart(d);
    const etf = await etfHtml();
    const box = host.querySelector('#cr-etfs');
    if (box) { box.innerHTML = etf || '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No ETF history.</div>';
      box.querySelectorAll('[data-cr-etf]').forEach(a => a.onclick = e => { e.preventDefault(); const inp = document.getElementById('ticker'); if (inp) inp.value = a.dataset.crEtf; if (typeof switchTab === 'function') switchTab('valuation'); if (typeof loadValuation === 'function') loadValuation(); }); }
  }
  function drawChart(d) {
    const el = document.getElementById('cr-chart'), id = S.pick;
    if (!el || !(window.VChart && window.VChart.mountSeriesChart)) return;
    const meta = [...SPREADS, ...YIELDS, ...TR].find(x => x[0] === id) || [id, id];
    const isSpread = SPREADS.some(x => x[0] === id), isTR = TR.some(x => x[0] === id);
    const s = d[id] || [];
    window.VChart.mountSeriesChart(el, { key: 'credit-' + id, ticker: id, title: meta[1] + (isSpread ? ' · OAS' : ''), bars: false,
      daily: s.map(o => ({ d: o.d, c: isSpread ? o.v * 100 : o.v })), range: '1Y', ranges: ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'],
      upIsBad: isSpread || YIELDS.some(x => x[0] === id),
      changeFmt: isSpread ? ((v, b) => `${v >= b ? '+' : '−'}${Math.abs(Math.round(v - b))} bp`) : isTR ? null : ((v, b) => `${v >= b ? '+' : '−'}${Math.abs(v - b).toFixed(2)} pp`),
      fmt: v => (isSpread ? Math.round(v) + ' bp' : isTR ? v.toFixed(1) : v.toFixed(2) + '%'), axisFmt: v => (isSpread ? Math.round(v) + '' : isTR ? Math.round(v) + '' : v.toFixed(1) + '%') });
  }
  window.CreditTab = { render, load, _read: read, _back: back, _pctile: pctile, _regimeOf: regimeOf };
})();
