/* ==========================================================================
   marketextras.js — z158. Official sources in the app:
   · Valuation → "Filings · insiders · short": SEC 8-K events (red flags), Form 4 insider buys / sells,
     FINRA short volume and short interest, and fundamentals AS FILED with the SEC (XBRL)
   · Macro Data → "Volatility & Sentiment": CBOE VIX term structure and SKEW, Treasury auctions and debt,
     BLS, GDELT news tone, and the FX / crypto cross-checks against the ECB, Coinbase and CoinGecko
   Data: TRAPP2-ANALYTICS data/sec, data/short · TRAPP2-1 data/extras
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = {};
  async function J(repo, path, ttlMin = 10) {
    const k = repo + '/' + path;
    if (C[k] && Date.now() - C[k].t < ttlMin * 60000) return C[k].v;
    let v = null;
    try { const r = await fetch(`${RAW()}/${repo}/main/${path}?_=${Math.floor(Date.now() / 600000)}`, { cache: 'no-cache' }); if (r.ok) v = await r.json(); } catch (e) {}
    C[k] = { t: Date.now(), v };
    return v;
  }
  const money = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '') + '$' + (Math.abs(v) >= 1e12 ? (Math.abs(v) / 1e12).toFixed(2) + 'T' : Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? Math.round(Math.abs(v) / 1e3) + 'K' : Math.round(Math.abs(v)));
  const num = (v, d = 1) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const sgn = (v, d = 1, suf = '%') => v == null || !isFinite(v) ? '—' : `<span style="color:${v < 0 ? 'var(--neg)' : v > 0 ? 'var(--pos)' : 'inherit'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}${suf}</span>`;
  const H = t => `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:.08em;margin:10px 0 4px">${t}</div>`;
  const CODE = { P: 'buy (open market)', S: 'sale (open market)', A: 'grant / award', M: 'option exercise', F: 'tax withholding', G: 'gift', D: 'returned to company', C: 'conversion' };

  // ---------------------------------------------------------------- Valuation card
  async function renderTicker(tk) {
    const anchor = document.getElementById('hc-ticker-section') || document.getElementById('credit-ticker-section') || document.getElementById('price-chart-section');
    if (!anchor || !tk) return;
    let sec = document.getElementById('mx-ticker-section');
    if (!sec) { sec = document.createElement('div'); sec.id = 'mx-ticker-section'; sec.className = 'section'; }
    if (sec.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', sec);
    sec.dataset.ticker = tk;
    const [doc, sh] = await Promise.all([J('TRAPP2-ANALYTICS', `data/sec/${encodeURIComponent(tk)}.json`), J('TRAPP2-ANALYTICS', 'data/short/index.json')]);
    if (sec.dataset.ticker !== tk) return;
    const vol = sh && sh.volume && sh.volume[tk], si = sh && sh.interest && sh.interest[tk];
    if (!doc && !vol && !si) { sec.style.display = 'none'; sec.innerHTML = ''; return; }
    sec.style.display = '';
    const ev = (doc && doc.events) || [], ins = (doc && doc.insider) || null, tx = ((doc && doc.insiderTx) || []).slice(-8).reverse();
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const red = [...new Set(ev.filter(e => e.date >= d30).flatMap(e => e.red || []))], caution = [...new Set(ev.filter(e => e.date >= d30).flatMap(e => e.caution || []))];
    const items = (doc && doc.events && doc.events.length && doc.events[0].labels) ? null : null;
    const label = code => { for (const e of ev) { const i = (e.items || []).indexOf(code); if (i >= 0) return e.labels[i]; } return code; };
    const f = (doc && doc.facts) || {};
    const fy = (() => {
      const rev = (f.revenue && f.revenue.annual) || [];
      const ends = rev.slice(-4).map(r => r.end);
      const at = (k, end) => { const a = (f[k] && f[k].annual) || []; const x = a.find(r => r.end === end); return x ? x.val : null; };
      return ends.map(end => ({ end, rev: at('revenue', end), ni: at('netIncome', end), eps: at('epsDiluted', end), ocf: at('operatingCashFlow', end), capex: at('capex', end) }));
    })();
    sec.innerHTML = `<div class="company-card"><h4>Filings · insiders · short <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${esc(tk)} · SEC EDGAR + FINRA</span></h4>
      ${red.length ? `<div style="font-family:var(--mono);font-size:11px;color:var(--neg);margin:4px 0">⚠ red-flag filing in the last 30 days: ${red.map(c => `${esc(c)} ${esc(label(c))}`).join(' · ')}</div>` : ''}
      ${caution.length ? `<div style="font-family:var(--mono);font-size:11px;color:var(--amber);margin:4px 0">caution: ${caution.map(c => `${esc(c)} ${esc(label(c))}`).join(' · ')}</div>` : ''}
      ${H('8-K EVENTS · LAST 180 DAYS')}${ev.length ? ev.slice(0, 8).map(e => `<div style="font-family:var(--mono);font-size:10.5px;padding:2px 0;border-bottom:1px solid var(--rule)"><span style="color:var(--ink-faint)">${esc(e.date)}</span> ${(e.labels || []).filter(l => l !== 'exhibits').map(esc).join(' · ') || esc(e.form)}</div>`).join('') : '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">none on file</div>'}
      ${H('INSIDERS · LAST 90 DAYS (FORM 4)')}${ins ? `<div style="display:flex;flex-wrap:wrap;gap:6px 20px;font-family:var(--mono);font-size:11px">
          <div>bought ${money(ins.buyValue)} <span style="color:var(--ink-faint)">· ${ins.buyers} insider${ins.buyers === 1 ? '' : 's'}</span></div>
          <div>sold ${money(ins.sellValue)} <span style="color:var(--ink-faint)">· ${ins.sellers}</span></div>
          <div>net ${ins.net >= 0 ? `<span style="color:var(--pos)">${money(ins.net)}</span>` : `<span style="color:var(--neg)">${money(ins.net)}</span>`}</div>
          ${ins.cluster ? '<div style="color:var(--pos)">cluster buying (3+ insiders in 30 days)</div>' : ''}${ins.ceoCfoBuy ? '<div style="color:var(--pos)">CEO / CFO bought</div>' : ''}</div>
        ${tx.map(t => `<div style="font-family:var(--mono);font-size:10px;padding:2px 0;border-bottom:1px solid var(--rule)"><span style="color:var(--ink-faint)">${esc(t.date)}</span> ${esc(t.owner)} <span style="color:var(--ink-faint)">(${esc(t.role || 'insider')})</span> · ${esc(CODE[t.code] || t.code)} · ${num(t.shares, 0)} sh${t.price ? ' @ $' + num(t.price, 2) : ''}</div>`).join('')}` : '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">none on file</div>'}
      ${H('SHORT SELLING (FINRA)')}<div style="display:flex;flex-wrap:wrap;gap:6px 20px;font-family:var(--mono);font-size:11px">
        ${vol ? `<div>short share of volume ${num(vol.ratio1d)}% <span style="color:var(--ink-faint)">today · ${num(vol.ratio5d)}% 5d · ${num(vol.ratio20d)}% 20d${vol.z != null ? ' · z ' + num(vol.z, 2) : ''}</span></div>` : ''}
        ${si ? `<div>short interest ${num(si.shares, 0)} sh ${sgn(si.changePct)} <span style="color:var(--ink-faint)">· ${num(si.daysToCover, 1)} days to cover · settled ${esc(si.settlementDate)}</span></div>` : '<div style="color:var(--ink-faint)">short interest not on file</div>'}</div>
      ${fy.length ? `${H('AS FILED WITH THE SEC (10-K, XBRL)')}<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:480px;font-family:var(--mono);font-size:10.5px"><thead><tr><th style="text-align:left">Fiscal year end</th><th style="text-align:right">Revenue</th><th style="text-align:right">Net income</th><th style="text-align:right">Diluted EPS</th><th style="text-align:right">Op. cash flow</th><th style="text-align:right">Free cash flow</th></tr></thead><tbody>
        ${fy.map(r => `<tr><td>${esc(r.end)}</td><td style="text-align:right">${money(r.rev)}</td><td style="text-align:right">${money(r.ni)}</td><td style="text-align:right">${r.eps == null ? '—' : '$' + num(r.eps, 2)}</td><td style="text-align:right">${money(r.ocf)}</td><td style="text-align:right">${r.ocf != null && r.capex != null ? money(r.ocf - r.capex) : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------- Volatility & Sentiment page
  function curve(L) {
    const pts = [['VIX9D', 9], ['VIX', 30], ['VIX3M', 93], ['VIX6M', 182]].filter(([k]) => L[k] != null).map(([k, d]) => ({ k, d, v: L[k] }));
    if (pts.length < 2) return '';
    const W = 520, Hh = 170, l = 44, r = 16, t = 14, b = 30;
    const vs = pts.map(p => p.v), lo = Math.floor(Math.min(...vs) - 2), hi = Math.ceil(Math.max(...vs) + 2);
    const x = d => l + (d - 0) / 190 * (W - l - r), y = v => t + (Hh - t - b) * (1 - (v - lo) / (hi - lo));
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${Hh}" style="width:100%;max-width:560px;height:auto;display:block" role="img" aria-label="VIX term structure">
      ${[lo, (lo + hi) / 2, hi].map(v => `<line x1="${l}" x2="${W - r}" y1="${y(v).toFixed(2)}" y2="${y(v).toFixed(2)}" stroke="var(--rule)" stroke-width="0.6"/><text x="${l - 6}" y="${(y(v) + 3).toFixed(2)}" font-size="9" text-anchor="end" fill="var(--ink-faint)" font-family="var(--mono)">${num(v, 1)}</text>`).join('')}
      <path d="${path}" fill="none" stroke="var(--amber)" stroke-width="2"/>
      ${pts.map(p => `<circle cx="${x(p.d).toFixed(2)}" cy="${y(p.v).toFixed(2)}" r="3.5" fill="var(--amber)"><title>${p.k}: ${p.v} (${p.d} days)</title></circle><text x="${x(p.d).toFixed(2)}" y="${Hh - 12}" font-size="9" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)">${p.k}</text><text x="${x(p.d).toFixed(2)}" y="${(y(p.v) - 8).toFixed(2)}" font-size="9" text-anchor="middle" fill="var(--ink)" font-family="var(--mono)">${num(p.v, 1)}</text>`).join('')}</svg>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">x = days to horizon (9 / 30 / 93 / 182, to scale) · y = index level</div>`;
  }

  async function render(host) {
    if (!host) return;
    const [v, tr, bls, gd, ck] = await Promise.all(['vol', 'treasury', 'bls', 'gdelt', 'checks'].map(n => J('TRAPP2-1', `data/extras/${n}.json`)));
    if (!v && !tr && !bls && !gd && !ck) { host.innerHTML = '<div class="company-card"><h4>Volatility &amp; Sentiment</h4><div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim)">Waiting for the first run of TRAPP2-1 → <strong>Market extras</strong> (weekdays 0725 and 1820 ET, or run it from the Actions tab).</div></div>'; return; }
    const L = (v && v.latest) || {};
    const read = !v ? '' : v.structure === 'backwardation' ? 'Short-dated fear above longer-dated (backwardation) — the market is paying up for protection now; typical of stress.' : 'Normal upward slope (contango) — near-term fear below longer-dated; typical of calm markets.';
    host.innerHTML = `
      ${v ? `<section class="company-card" style="margin:0 0 12px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">VOLATILITY · CBOE · ${esc(v.date || '')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px 28px;margin:10px 0;font-family:var(--mono)">
          <div><div style="font-size:9px;color:var(--ink-faint)">VIX</div><div style="font-size:20px;font-weight:700">${num(L.VIX, 2)}</div><div style="font-size:9px;color:var(--ink-faint)">${v.vixPctile1y}th pctile, 1 y</div></div>
          <div><div style="font-size:9px;color:var(--ink-faint)">VIX ÷ VIX3M</div><div style="font-size:20px;font-weight:700;color:${v.structure === 'backwardation' ? 'var(--neg)' : 'var(--pos)'}">${num(v.vixTo3m, 3)}</div><div style="font-size:9px;color:var(--ink-faint)">${esc(v.structure || '')}</div></div>
          <div><div style="font-size:9px;color:var(--ink-faint)">SKEW</div><div style="font-size:20px;font-weight:700">${num(L.SKEW, 1)}</div><div style="font-size:9px;color:var(--ink-faint)">${v.skewPctile1y != null ? v.skewPctile1y + 'th pctile — tail-risk pricing' : ''}</div></div></div>
        ${curve(L)}<div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:6px">${esc(read)}</div></section>` : ''}
      ${tr ? `<section class="company-card" style="margin:0 0 12px"><h4>Treasury auctions (FiscalData)</h4><div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Security</th><th style="text-align:left">Auction</th><th style="text-align:right">High yield / rate</th><th style="text-align:right">Bid-to-cover</th></tr></thead><tbody>
        ${(tr.auctions || []).slice(0, 14).map(a => `<tr><td>${esc(a.term)} ${esc(a.type)}</td><td>${esc(a.date)}</td><td style="text-align:right">${num(+a.highYield, 3)}%</td><td style="text-align:right">${num(+a.bidToCover, 2)}</td></tr>`).join('')}</tbody></table></div>
        ${tr.debt ? `<div style="font-family:var(--mono);font-size:10.5px;margin-top:6px">Debt to the penny: <strong>${money(+tr.debt.total)}</strong> <span style="color:var(--ink-faint)">· ${esc(tr.debt.date)}</span></div>` : ''}</section>` : ''}
      ${bls ? `<section class="company-card" style="margin:0 0 12px"><h4>BLS — from the source</h4><div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Series</th><th style="text-align:left">Month</th><th style="text-align:right">Value</th><th style="text-align:right">vs a year ago</th><th style="text-align:right">vs last month</th></tr></thead><tbody>
        ${Object.values(bls.series || {}).map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.month)}</td><td style="text-align:right">${num(s.value, s.value > 1000 ? 0 : 2)}</td><td style="text-align:right">${s.yoyPct != null ? sgn(s.yoyPct, 2) : '—'}</td><td style="text-align:right">${s.change != null ? (s.change > 0 ? '+' : '') + num(s.change, 1) : s.momPct != null ? sgn(s.momPct, 2) : '—'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      ${gd ? `<section class="company-card" style="margin:0 0 12px"><h4>News tone (GDELT)</h4><div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Theme</th><th style="text-align:right">Tone, last 7 d</th><th style="text-align:right">Tone, prior 30 d</th><th style="text-align:right">Coverage vs prior 30 d</th></tr></thead><tbody>
        ${Object.entries(gd.themes || {}).map(([k, t]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${num(t.tone7d, 2)}</td><td style="text-align:right">${num(t.tonePrior30d, 2)}</td><td style="text-align:right">${t.volumeChangePct != null ? sgn(t.volumeChangePct, 0) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">${esc(gd.note || '')}</div></section>` : ''}
      ${ck ? `<section class="company-card" style="margin:0 0 12px"><h4>Cross-checks of our prices</h4><div style="font-family:var(--mono);font-size:10.5px;line-height:1.7">
        FX vs the ECB reference (${esc(ck.fxDate || '')}): ${(ck.fx || []).filter(x => x.flag).map(x => `<span style="color:var(--neg)">${esc(x.ccy)} ${sgn(x.gapPct, 2)}</span>`).join(' · ') || `<span style="color:var(--pos)">all ${(ck.fx || []).length} within 0.5 %</span>`}<br>
        Crypto vs Coinbase / CoinGecko: ${(ck.crypto || []).filter(x => x.flag).map(x => `<span style="color:var(--neg)">${esc(x.ticker)} ${sgn(x.gapPct, 2)}</span>`).join(' · ') || `<span style="color:var(--pos)">all ${(ck.crypto || []).length} within 1 %</span>`}</div></section>` : ''}`;
  }

  (function () {
    const orig = window.renderSummary;
    if (typeof orig !== 'function' || orig._z158) return;
    const w = function () { const r = orig.apply(this, arguments); try { const st = arguments[0] || (typeof state !== 'undefined' ? state.stock : null); if (st && st.ticker) setTimeout(() => renderTicker(String(st.ticker).toUpperCase()), 160); } catch (e) {} return r; };
    w._z158 = true; Object.keys(orig).forEach(k => { w[k] = orig[k]; });
    window.renderSummary = w;
  })();
  window.MarketExtras = { render, renderTicker };
})();
