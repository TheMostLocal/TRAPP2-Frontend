/* ==========================================================================
   warning.js — Early warning ("the digging"), on the Regime tab (z196).

   Reads TRAPP2-ANALYTICS/data/warning/signals.json (pipeline/warning_signals.py): the published loss, lending,
   funding, labour, collateral, leverage and growth data scored against their own history since the 1980s-90s
   (publication lags respected), four gauges (fundamental stress, market stress, fragility, organic growth), a
   composite RISK percentile, the regime, flags (market blindness, the marginal buyer stepping back, seasonal traps,
   debt-fuelled vs organic growth, insider buying, 8-K red flags), bottom-up breadth (filings, insiders, short
   interest, headcount, the options market, credit ratings, 52-week highs / lows), the industries each warning hits
   (the bot sizes and scores from them) and a backtest against NBER recessions and 20 % drawdowns.
   The card sits above the regime hero. In-memory only (nothing stored in the browser).
   ========================================================================== */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const raw = () => { try { if (typeof GH_RAW !== 'undefined') return GH_RAW; } catch (e) {} return 'https://raw.githubusercontent.com/TheMostLocal'; };
  let W = null, at = 0, pending = null, failed = false, open = { ind: false, bt: false, bu: false };
  async function load(force) {
    if (!force && W && Date.now() - at < 15 * 60 * 1000) return W;
    if (pending) return pending;
    pending = (async () => {
      try {
        const r = await fetch(`${raw()}/TRAPP2-ANALYTICS/main/data/warning/signals.json`, { cache: 'no-cache' });
        if (r.ok) { W = await r.json(); at = Date.now(); failed = false; } else failed = true;
      } catch (e) { failed = true; }
      pending = null; return W;
    })();
    return pending;
  }
  const LEVEL_COL = { low: 'var(--pos)', moderate: 'var(--data-amber)', elevated: '#e0a24a', high: '#e0704a', extreme: 'var(--neg)', unknown: 'var(--ink-faint)' };
  const FLAG_COL = { blindness: 'var(--neg)', 'marginal-buyer': '#e0704a', filings: '#e0a24a', curve: '#e0a24a', 'debt-fuelled': '#e0a24a',
                     seasonal: 'var(--ink-dim)', organic: 'var(--pos)', insiders: 'var(--pos)' };
  const pctTxt = v => v == null ? '—' : `${Math.round(v)}`;
  const share = v => v == null ? '—' : `${Math.round(v * 100)}%`;
  const num = (v, d = 1) => v == null || !isFinite(v) ? '—' : (+v).toFixed(d);
  const mono = 'font-family:var(--mono)';
  const small = `${mono};font-size:9.5px;color:var(--ink-faint)`;

  function bar(label, g, invert, note) {
    // stress gauges: high = red; growth: high = green
    const p = g && g.pct != null ? g.pct : null;
    const col = p == null ? 'var(--ink-faint)' : invert ? (p >= 60 ? 'var(--pos)' : p <= 30 ? 'var(--neg)' : 'var(--data-amber)')
                                               : (p >= 75 ? 'var(--neg)' : p >= 60 ? '#e0a24a' : p <= 35 ? 'var(--pos)' : 'var(--data-amber)');
    return `<div style="display:grid;grid-template-columns:minmax(110px,150px) 1fr 44px;gap:8px;align-items:center;${mono};font-size:10px;margin:3px 0" title="${esc(note || '')}">
      <span style="color:var(--ink-dim)">${esc(label)}</span>
      <span style="height:6px;background:var(--rule);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:${p == null ? 0 : Math.max(2, Math.min(100, p))}%;background:${col}"></span></span>
      <span style="text-align:right;color:var(--ink)">${pctTxt(p)}</span></div>`;
  }

  function sparkline(hist, recs) {
    // monthly [YYYY-MM, risk%, F, M, Fr, G, regime, blind]; risk percentile solid, fundamental / market thin
    const rows = (hist || []).filter(r => r[1] != null);
    if (rows.length < 12) return '';
    const Wd = 640, H = 120, pl = 26, pr = 6, pt = 6, pb = 16, n = rows.length;
    const x = i => pl + i / (n - 1) * (Wd - pl - pr), y = v => pt + (1 - v / 100) * (H - pt - pb);
    const line = (k, col, w, dash) => {
      const pts = rows.map((r, i) => r[k] == null ? null : `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).filter(Boolean).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? 'stroke-dasharray="3 3"' : ''} opacity="${w > 1 ? 1 : 0.65}"/>`;
    };
    const idx = m => rows.findIndex(r => r[0] >= m);
    const recLines = (recs || []).map(r => { const i = idx(r.start); return i > 0 ? `<line x1="${x(i)}" x2="${x(i)}" y1="${pt}" y2="${H - pb}" stroke="var(--neg)" stroke-width="1" opacity="0.5"/><text x="${x(i) + 2}" y="${pt + 8}" font-size="8" fill="var(--neg)">rec ${esc(r.start.slice(0, 4))}</text>` : ''; }).join('');
    const blind = rows.map((r, i) => r[7] ? `<rect x="${(x(i) - 1).toFixed(1)}" y="${H - pb - 4}" width="2.5" height="4" fill="var(--neg)"/>` : '').join('');
    const years = []; let last = '';
    rows.forEach((r, i) => { const yy = r[0].slice(0, 4); if (yy !== last && +yy % 5 === 0) { years.push(`<text x="${x(i)}" y="${H - 3}" font-size="8" fill="var(--ink-faint)">${yy}</text>`); } last = yy; });
    return `<svg viewBox="0 0 ${Wd} ${H}" style="width:100%;height:auto;display:block;margin-top:6px" role="img" aria-label="risk percentile history">
      ${[75, 90].map(v => `<line x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)" stroke-dasharray="2 4"/><text x="2" y="${y(v) + 3}" font-size="8" fill="var(--ink-faint)">${v}</text>`).join('')}
      ${recLines}${line(2, '#e0a24a', 0.8, true)}${line(3, '#7faaca', 0.8, true)}${line(1, 'var(--amber)', 1.6)}${blind}${years.join('')}
    </svg>
    <div style="${small};margin-top:2px">risk percentile (solid) · fundamental stress (amber, dashed) · market stress (blue, dashed) · red ticks = market blindness · red lines = recession starts</div>`;
  }

  function flagsHtml(flags) {
    if (!flags || !flags.length) return `<div style="${small};margin:6px 0">No flags: nothing published is running ahead of the market right now.</div>`;
    return `<ul style="list-style:none;margin:8px 0 0;padding:0">${flags.map(f => `<li style="${mono};font-size:10.5px;line-height:1.55;margin:4px 0;padding-left:8px;border-left:2px solid ${FLAG_COL[f.kind] || 'var(--ink-dim)'};color:var(--ink)"><span style="color:${FLAG_COL[f.kind] || 'var(--ink-dim)'};font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:.08em">${esc(f.kind)}</span> ${esc(f.text)}</li>`).join('')}</ul>`;
  }

  function pillarsHtml(d) {
    const ps = d.pillars || {};
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-top:10px">${Object.keys(ps).map(k => {
      const p = ps[k]; const note = (d.notes || []).find(n => n.startsWith(p.label)) || '';
      const isG = k === 'growth';
      const col = p.score == null ? 'var(--ink-faint)' : isG ? (p.score >= 60 ? 'var(--pos)' : p.score <= 35 ? 'var(--neg)' : 'var(--data-amber)') : (p.score >= 70 ? 'var(--neg)' : p.score >= 55 ? '#e0a24a' : 'var(--pos)');
      return `<div style="border:1px solid var(--rule);border-radius:4px;padding:7px 9px">
        <div style="display:flex;justify-content:space-between;gap:6px;${mono};font-size:10px"><span style="color:var(--ink)">${esc(p.label)}</span><span style="color:${col};font-weight:700">${p.score == null ? '—' : Math.round(p.score)}</span></div>
        <div style="${small}">${esc(p.what)} · ${p.n}/${p.of} series scored</div>
        <div style="${mono};font-size:9.5px;color:var(--ink-dim);line-height:1.45;margin-top:4px">${esc(note.replace(/^[^:]*:\s*\d+\/100 - /, ''))}</div></div>`;
    }).join('')}</div>`;
  }

  function indicatorsHtml(d) {
    const rows = (d.indicators || []).filter(r => r.score != null || r.value != null);
    const tf = { level: 'level', yoy_diff: 'Δ 1y', yoy_pct: '% 1y', chg6: 'Δ 6m', yoy_gap: 'gap 1y' };
    return `<div style="overflow-x:auto;margin-top:6px"><table class="sb-table" style="width:100%;min-width:640px;${mono};font-size:10px">
      <thead><tr><th style="text-align:left">Series</th><th style="text-align:left">Pillar</th><th>Latest</th><th>As of</th><th>Read</th><th>Score</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td style="text-align:left">${esc(r.label)} <span style="color:var(--ink-faint)">${esc(r.series)}</span></td><td style="text-align:left;color:var(--ink-dim)">${esc(r.pillar)}</td>
        <td>${r.value == null ? '—' : esc(num(r.value, Math.abs(r.value) >= 100 ? 0 : 2))}</td><td style="color:var(--ink-faint)">${esc(r.date || '—')}</td>
        <td>${r.x == null ? '—' : `${esc(num(r.x, 2))} <span style="color:var(--ink-faint)">${esc(tf[r.transform] || '')}</span>`}</td>
        <td style="color:${r.score == null ? 'var(--ink-faint)' : r.pillar === 'growth' ? (r.score >= 60 ? 'var(--pos)' : r.score <= 35 ? 'var(--neg)' : 'var(--ink)') : (r.score >= 75 ? 'var(--neg)' : r.score <= 35 ? 'var(--pos)' : 'var(--ink)')}">${r.score == null ? (r.value == null ? 'no data' : 'building') : Math.round(r.score)}</td></tr>`).join('')}</tbody></table></div>
      <div style="${small};margin-top:4px">Score = percentile vs the series' own history (stress pillars: higher = more stress; growth: higher = stronger). "Building": fewer than 5 years of history on file. Missing: ${esc(((d.coverage || {}).missing || []).join(', ') || 'none')}.</div>`;
  }

  function bottomUpHtml(bu, exposures) {
    if (!bu) return '';
    const sec = bu.sec || {}, ins = sec.insiders || {}, sh = bu.short || {}, hc = bu.headcount || {}, op = (bu.options || {}).breadth || {}, cr = bu.credit || {}, px = bu.prices || {};
    const sc = bu.scores || {};
    const cell = (label, val, key, sub) => `<div style="border:1px solid var(--rule);border-radius:4px;padding:6px 8px"><div style="${small};text-transform:uppercase;letter-spacing:.06em">${esc(label)}</div>
      <div style="${mono};font-size:13px;color:var(--ink)">${val}</div><div style="${small}">${sc[key] ? `stress ${Math.round(sc[key].score)}/100 · ${esc(sc[key].basis)}` : esc(sub || '')}</div></div>`;
    const recent = (sec.recent || []).slice(0, 6).map(r => `${esc(r.ticker)} <span style="color:var(--ink-faint)">${esc(r.date.slice(5))}</span> ${esc((r.what || []).join(', '))}`).join(' · ');
    const expo = [...Object.entries((exposures || {}).industry || {}), ...Object.entries((exposures || {}).sector || {})];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin-top:8px">
      ${cell('8-K red flags vs base', sec.ratio != null ? `${num(sec.ratio, 2)}×` : '—', 'secRatio', `${sec.companies || 0} companies`)}
      ${cell('Insiders net buying', share(ins.buyShare), 'insiderBuy', ins.companiesWithActivity ? `${ins.netBuyers} of ${ins.companiesWithActivity} · ${ins.clusterBuys} cluster` : '')}
      ${cell('Short interest rising', share(sh.risingShare), 'shortRising', '')}
      ${cell('Headcount cutting', share(hc.cuttingShare), 'headcountCutting', '')}
      ${cell('Options: inverted term', share(op.invertedShare), 'optInverted', op.n ? `${op.n} names` : 'no market.json yet')}
      ${cell('Options: IV rank ≥ 80', share(op.ivRankHighShare), 'optIvRankHigh', '')}
      ${cell('Unusual activity put-led', share(op.unusualPutLedShare), 'optPutLed', '')}
      ${cell('Credit trend negative', share(cr.negTrendShare), 'creditNegTrend', cr.companies ? `${cr.companies} rated` : 'ratings not built yet')}
      ${cell('Near 52-week lows', share(px.nearLowsShare), 'nearLows', px.names ? `${px.names} stocks` : '')}
      ${cell('Near 52-week highs', share(px.nearHighsShare), 'nearHighs', '')}
    </div>
    ${recent ? `<div style="${mono};font-size:9.5px;color:var(--ink-dim);margin-top:6px;line-height:1.5"><span style="color:var(--ink-faint)">LATEST RED FILINGS · </span>${recent}</div>` : ''}
    ${expo.length ? `<div style="${mono};font-size:9.5px;color:var(--ink-dim);margin-top:6px;line-height:1.5"><span style="color:var(--ink-faint)">EXPOSED · </span>${expo.sort((a, b) => b[1].e - a[1].e).slice(0, 8).map(([k, v]) => `<span title="${esc(v.why)}">${esc(k)} <span style="color:var(--neg)">${Math.round(v.e * 100)}</span></span>`).join(' · ')}</div>` : ''}`;
  }

  function backtestHtml(bt) {
    if (!bt || !bt.months) return `<div style="${small}">Backtest: not enough history on file yet.</div>`;
    const rec = (bt.recessions || []).map(r => `<tr><td>${esc(r.start)}</td><td>${r.riskAt12m ?? '—'}</td><td>${r.riskAt6m ?? '—'}</td><td>${r.riskAt3m ?? '—'}</td><td>${r.leadMonths ?? '—'}</td><td>${r.fundamentalLeadMonths ?? '—'}</td><td>${r.blindnessMonths}</td></tr>`).join('');
    const bk = (bt.buckets || []).map(b => `<tr><td style="color:${LEVEL_COL[b.level]}">${esc(b.level)}</td><td>${b.n}</td><td>${num(b.fwd12Ret)}%</td><td>${num(b.dd20Rate)}%</td><td>${num(b.avgWorstDD)}%</td><td>${num(b.recessionWithin12)}%</td></tr>`).join('');
    const base = bt.base || {}, hit = bt.hit || {}, er = bt.earned || {};
    return `<div style="${mono};font-size:10px;color:var(--ink-dim);margin-top:6px;line-height:1.5">${bt.months} months since ${esc(bt.from)} · equity: ${esc(bt.equity || '—')} · recessions: ${esc(bt.recessionSource)}.
        ${hit.signalMonths ? ` Risk ≥ 75th percentile (${hit.signalMonths} months) was followed within 12 months by a 20% drawdown or a recession <strong style="color:var(--ink)">${num(hit.hitRate)}%</strong> of the time vs <strong style="color:var(--ink)">${num(hit.baseRate)}%</strong> for all months - wrong ${num(hit.falseAlarmRate)}% of the time.` : ''}
        Earned: the size throttle <strong style="color:${er.throttle ? 'var(--pos)' : 'var(--ink-faint)'}">${er.throttle ? 'yes' : 'no'}</strong> · leaning in on organic growth <strong style="color:${er.organicUpside ? 'var(--pos)' : 'var(--ink-faint)'}">${er.organicUpside ? 'yes' : 'no'}</strong>.</div>
      ${rec ? `<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:520px;${mono};font-size:10px;margin-top:6px"><thead><tr><th>Recession</th><th>Risk 12m before</th><th>6m</th><th>3m</th><th>Lead (risk ≥ 75)</th><th>Lead (fundamentals ≥ 70)</th><th>Blind months</th></tr></thead><tbody>${rec}</tbody></table></div>` : ''}
      ${bk ? `<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:520px;${mono};font-size:10px;margin-top:6px"><thead><tr><th>Risk level</th><th>Months</th><th>Next 12m return</th><th>20% drawdown</th><th>Avg worst drawdown</th><th>Recession within 12m</th></tr></thead><tbody>${bk}<tr style="color:var(--ink-faint)"><td>all months</td><td>${base.n ?? '—'}</td><td>${num(base.fwd12Ret)}%</td><td>${num(base.dd20Rate)}%</td><td>—</td><td>${num(base.recessionWithin12)}%</td></tr></tbody></table></div>` : ''}`;
  }

  function botHtml(d) {
    const er = ((d.backtest || {}).earned) || {};
    const r = d.risk;
    if (r == null || d.provisional) return `<div style="${small};margin-top:6px">The bot records this read on every trade but doesn't act on it until a full (non-provisional) read exists.</div>`;
    let base = r < 60 ? 1 : r < 75 ? 0.9 : r < 90 ? 0.8 : 0.7;
    if (!er.throttle) base = Math.max(base, 0.9);
    return `<div style="${mono};font-size:10px;color:var(--ink-dim);margin-top:6px;line-height:1.55">What the bot does with it: new longs sized <strong style="color:var(--ink)">×${base.toFixed(2)}</strong>${er.throttle ? '' : ' (throttle not earned by the backtest - capped at ×0.90)'}, less in an exposed industry (×(1 − 0.35·exposure)); a <em>warning</em> signal in the blend that the learning layer weights; ${d.level === 'extreme' && /acute|spreading/.test(d.regime) ? '<strong style="color:var(--neg)">no new leveraged long funds</strong>; ' : ''}shorts in exposed industries up to ×1.15 only when earned; the read is stamped on every trade (warningAtEntry).</div>`;
  }

  function cardHtml(d) {
    const lvl = d.level || 'unknown', col = LEVEL_COL[lvl] || 'var(--ink-dim)';
    const g = d.gauges || {};
    const sec = (title, key, body) => `<div style="margin-top:10px"><button class="btn btn-ghost" data-ew-toggle="${key}" style="padding:2px 8px;font-size:9.5px">${open[key] ? '▾' : '▸'} ${esc(title)}</button>${open[key] ? body : ''}</div>`;
    return `<section id="early-warning-card" class="company-card" style="margin:0 0 16px;border-left:3px solid ${col}">
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline">
        <div style="${mono};font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">EARLY WARNING · THE DIGGING</div>
        <div style="${mono};font-size:22px;color:${col}">${d.risk == null ? '—' : Math.round(d.risk)}</div>
        <div style="${mono};font-size:11px;color:${col};font-weight:700;text-transform:uppercase">${esc(lvl)}${d.provisional ? ' · provisional' : ''}</div>
        <div style="${mono};font-size:11px;color:var(--ink)">${esc(d.regime || '')}</div>
        <div style="margin-left:auto;${small}">${esc(d.date || '')} · ${(d.coverage || {}).scored || 0}/${(d.coverage || {}).indicators || 0} series scored</div>
      </div>
      <div style="${mono};font-size:10.5px;color:var(--ink-dim);margin:6px 0 8px;line-height:1.55">${esc(d.headline || '')}${d.regimeWhy ? ` — ${esc(d.regimeWhy)}` : ''}. Risk = where today's composite sits among every month since the backtest starts (100 = worst on record).</div>
      ${bar('Fundamental stress', g.fundamental, false, 'loss data 30% · lenders 20% · jobs 30% · collateral 20% - what is published')}
      ${bar('Market stress', g.market, false, 'spreads, VIX, financial conditions, commercial-paper funding - what is priced')}
      ${bar('Fragility', g.fragility, false, 'leverage build-up and late-cycle signs: credit vs income, corporate debt / GDP, the curve')}
      ${bar('Organic growth', g.growth, true, 'income ex transfers, payrolls, production, orders, profits - credit not outrunning income')}
      ${flagsHtml(d.flags)}
      ${sparkline(d.history, (d.backtest || {}).recessions)}
      ${pillarsHtml(d)}
      ${botHtml(d)}
      ${sec('Bottom-up: filings, insiders, short interest, options, credit, breadth', 'bu', bottomUpHtml(d.bottomUp, d.exposures))}
      ${sec('Backtest: recessions and drawdowns', 'bt', backtestHtml(d.backtest))}
      ${sec('Every series', 'ind', indicatorsHtml(d))}
      <div style="${small};margin-top:8px;line-height:1.5">${esc(d.method || '')} ${((d.caveats || []).map(c => esc(c)).join(' '))} Data: FRED (Federal Reserve banks, BLS, Census, BEA, S&P CoreLogic, Chicago / St. Louis Fed), SEC EDGAR, FINRA, TRAPP2-OPTIONS, TRAPP2-CREDIT. Not investment advice.</div>
    </section>`;
  }

  async function renderCard(force) {
    const panel = document.querySelector('.tab-panel[data-panel="regime"]');
    if (!panel) return;
    const d = await load(force);
    const old = document.getElementById('early-warning-card');
    let html;
    if (!d) {
      html = `<section id="early-warning-card" class="company-card" style="margin:0 0 16px;border-left:3px solid var(--ink-faint)"><div style="${mono};font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">EARLY WARNING · THE DIGGING</div>
        <div style="${small};margin-top:6px">${failed ? 'No read yet: TRAPP2-ANALYTICS data/warning/signals.json appears after the Early warning workflow first runs (weekdays 0920 / 1840 ET, or Actions → Early warning → Run workflow).' : 'Loading…'}</div></section>`;
    } else html = cardHtml(d);
    const hero = document.getElementById('regime-hero');
    if (old) old.outerHTML = html;
    else if (hero && hero.parentNode === panel) hero.insertAdjacentHTML('beforebegin', html);
    else panel.insertAdjacentHTML('beforeend', html);
    const card = document.getElementById('early-warning-card');
    if (card) card.querySelectorAll('[data-ew-toggle]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.ewToggle; open[k] = !open[k]; renderCard(false); }));
  }

  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.tab-btn[data-tab="regime"]');
    if (b) setTimeout(() => renderCard(false), 60);
  }, true);
  setInterval(() => {
    const panel = document.querySelector('.tab-panel[data-panel="regime"]');
    if (panel && panel.classList.contains('active') && !document.getElementById('early-warning-card')) renderCard(false);
  }, 1500);
  window.EarlyWarning = { load, renderCard };
})();
