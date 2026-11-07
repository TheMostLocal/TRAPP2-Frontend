/* ==========================================================================
   quantdesk.js — the QUANT BOOK tab (z171, universe line z174, strategy lab z175, curve + stocks / funds z176, macro quad z177; card z163, dashboard z170).
   Its own top-level tab, laid out like Bot Bets: ◆ Portfolio (today, record, equity, engine & pipeline, open
   positions, statistics, the backtest gate, by day, strategies & risk) and ▤ Ledger (every closed quant trade,
   filterable and sortable). Separate from the swing bot in every way: data from TRAPP2-QUANT (data/quant/*) and
   the quant_* Supabase tables only - the bot's journal (TRAPP2-BOT) is never read here, and this book never
   appears on Bets.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  const pct2 = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
  const col = v => (v < 0 ? 'var(--neg)' : v > 0 ? 'var(--pos)' : 'inherit');
  const bps = v => (v == null ? '—' : `<span style="color:${col(v)}">${v > 0 ? '+' : ''}${(+v).toFixed(2)} bps</span>`);
  const usd = v => (v == null ? '—' : `<span style="color:${col(v)}">${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</span>`);
  const etTime = iso => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return '—'; } };
  const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !isFinite(m) ? '' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const CAPITAL = 100000;
  const STRATS = {
    sector_reversion: ['Stat-arb (Medallion family)', 'fades a stock\'s 10-minute move against its sector ETF (beta-adjusted, z ≥ 2.5)', '≤ 30 min'],
    etf_arb: ['ETF arbitrage (Jane Street family)', 'trades a sector ETF toward its own holdings when it lags them by > 2.5× the round-trip cost', '≤ 10 min'],
    opening_range: ['Intraday momentum', 'a clean break of the first 15 minutes\' range before 1130 ET', 'to the close'],
  };

  async function gh(path) { try { const r = await fetch(`${RAW()}/TRAPP2-QUANT/main/${path}?_=${Math.floor(Date.now() / 60000)}`, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
  async function sb(path) {
    try {      // the quant tables live in the PORT + ANALYTICS project; the Bot project is only a fallback
      const an = typeof getAnalyticsSupabaseUrl === 'function' && getAnalyticsSupabaseUrl();
      const u = (an || (typeof getSupabaseUrl === 'function' ? getSupabaseUrl() : '') || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
      const a = an ? (typeof getAnalyticsSupabaseAnon === 'function' ? getAnalyticsSupabaseAnon() : '') : (typeof getSupabaseAnon === 'function' ? getSupabaseAnon() : '');
      if (!u || !a) return null;
      const r = await fetch(u + path, { headers: { apikey: a, Authorization: 'Bearer ' + a }, cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  let _runs = { at: 0, v: null };
  async function actionsRuns() {
    if (_runs.v && Date.now() - _runs.at < 600000) return _runs.v;       // GitHub: 60 calls / h without a token
    const tok = typeof getGitHubToken === 'function' ? getGitHubToken() : '';
    const one = async wf => {
      try {
        const r = await fetch(`https://api.github.com/repos/TheMostLocal/TRAPP2-QUANT/actions/workflows/${wf}/runs?per_page=1`, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, tok ? { Authorization: 'Bearer ' + tok } : {}) });
        if (!r.ok) return { err: r.status === 403 ? 'rate-limited' : 'HTTP ' + r.status };
        const j = await r.json(); return (j.workflow_runs || [])[0] || { none: true };
      } catch (e) { return { err: 'offline' }; }
    };
    const [engine, backtest, tests] = await Promise.all([one('engine.yml'), one('backtest.yml'), one('tests.yml')]);
    _runs = { at: Date.now(), v: { engine, backtest, tests } };
    return _runs.v;
  }
  async function dayFiles(days) {
    const out = [];
    for (let k = 0; k < days; k++) {
      const d = new Date(Date.now() - k * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      try {
        const r = await fetch(`${RAW()}/TRAPP2-QUANT/main/data/quant/trades/${d}.jsonl?_=${Math.floor(Date.now() / 60000)}`, { cache: 'no-cache' });
        if (r.ok) (await r.text()).split('\n').forEach(l => { try { if (l.trim()) out.push(JSON.parse(l)); } catch (e) {} });
      } catch (e) {}
    }
    return out;
  }
  async function loadAll() {
    const [quadDoc, lab, summ, gate, bt, uni, st, sbTrades, runs] = await Promise.all([fetch(`${RAW()}/TRAPP2-1/main/data/macro/quad.json?_=${Math.floor(Date.now() / 600000)}`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null), gh('data/quant/lab/latest.json'), gh('data/quant/summary.json'), gh('data/quant/gate.json'), gh('data/quant/backtest/latest.json'),
      gh('data/quant/universe.json'), sb('/rest/v1/quant_state?id=eq.live&select=doc,updated_at'), sb('/rest/v1/quant_trades?select=trade&order=closed_at.desc&limit=500'), actionsRuns()]);
    let trades = (sbTrades || []).map(r => r.trade).filter(Boolean), src = trades.length ? 'Supabase (live)' : '';
    if (!trades.length) { trades = (await dayFiles(14)).sort((a, b) => String(b.exit_ts).localeCompare(String(a.exit_ts))); src = trades.length ? 'GitHub (committed every 15 min)' : ''; }
    return { quadDoc, lab, summ, gate, bt, uni, live: st && st[0] && st[0].doc, liveAt: st && st[0] && st[0].updated_at, trades, src, runs };
  }

  // ---- shared pieces, styled like Bot Bets ----
  const card = (title, inner, sub) => `<div class="company-card" style="margin:0 0 14px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim);text-transform:uppercase">${title}</div>${sub ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:3px">${sub}</div>` : ''}<div style="margin-top:8px">${inner}</div></div>`;
  const empty = t => `<div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);line-height:1.6">${t}</div>`;
  const tile = (k, v, s) => `<div style="min-width:130px;flex:1 1 130px"><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:.1em">${k}</div><div style="font-family:var(--mono);font-size:16px;font-weight:700;margin-top:2px">${v}</div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px">${s || ''}</div></div>`;
  const tbl = (head, rows, minw) => `<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:${minw || 520}px;font-family:var(--mono);font-size:10.5px"><thead><tr>${head.map(h => `<th style="text-align:${h[1] || 'left'}${h[2] ? ';cursor:pointer' : ''}"${h[2] ? ` class="quant-sort" data-col="${h[2]}" title="tap to sort"` : ''}>${h[0]}${h[2] && _ui.sort === h[2] ? (_ui.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const statRow = (label, s, gate) => !s || !s.n ? `<tr><td>${esc(label)}</td><td colspan="6" style="color:var(--ink-faint)">no trades yet</td>${gate !== undefined ? `<td>${gate}</td>` : ''}</tr>` :
    `<tr><td>${esc(label)}</td><td style="text-align:right">${s.n.toLocaleString('en-US')}</td><td style="text-align:right">${pct(s.winRate)}</td><td style="text-align:right;color:var(--ink-faint)">${s.winRateCI95 ? pct(s.winRateCI95[0]) + '–' + pct(s.winRateCI95[1]) : '—'}</td><td style="text-align:right">${bps(s.expectancyBps)}</td><td style="text-align:right">${s.profitFactor == null ? '—' : s.profitFactor.toFixed(2)}</td><td style="text-align:right">${s.tStat == null ? '—' : s.tStat.toFixed(2)}</td>${gate !== undefined ? `<td>${gate}</td>` : ''}</tr>`;
  const runTxt = r => !r ? '—' : r.err ? `<span style="color:var(--ink-faint)">${esc(r.err)}</span>` : r.none ? '<span style="color:var(--ink-faint)">never run</span>'
    : `${r.status !== 'completed' ? `<span style="color:var(--amber)">${esc(r.status)}</span>` : r.conclusion === 'success' ? '<span style="color:var(--pos)">success</span>' : `<span style="color:var(--neg)">${esc(r.conclusion || '?')}</span>`} · ${esc(etTime(r.created_at))} ET <a href="${esc(r.html_url)}" target="_blank" rel="noopener" style="color:var(--amber)">log ↗</a>`;
  // z176: the book's curve - cumulative dollars, live (Alpaca paper) and shadow (simulated) apart, every session
  function curvePoints(d) {
    if (d.summ && Array.isArray(d.summ.curve) && d.summ.curve.length) return d.summ.curve;
    let l = 0, sh = 0;
    return d.trades.slice().sort((a, b) => String(a.exit_ts).localeCompare(String(b.exit_ts)))
      .map(t => { if (t.mode === 'live') l += +t.pnl || 0; else if (t.mode === 'shadow') sh += +t.pnl || 0; return [String(t.exit_ts).slice(0, 16), +l.toFixed(2), +sh.toFixed(2)]; });
  }
  function curveSvg(pts) {
    if (!pts || pts.length < 2) return '';
    const W = 640, H = 150, n = pts.length;
    const vals = pts.flatMap(p => [p[1], p[2]]), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = (hi - lo) || 1;
    const x = i => (i / (n - 1)) * W, y = v => H - ((v - lo) / span) * (H - 6) - 3;
    const line = k => pts.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
    const days = []; pts.forEach((p, i) => { const dd = p[0].slice(0, 10); if (!days.length || days[days.length - 1][0] !== dd) days.push([dd, i]); });
    const L = pts[n - 1][1], S = pts[n - 1][2], hasLive = pts.some(p => p[1] !== 0);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:150px;display:block">
      ${days.slice(1).map(([, i]) => `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="0" y2="${H}" stroke="var(--rule)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
      <line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--ink-faint)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
      <polyline fill="none" stroke="var(--amber)" stroke-width="1.6" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" points="${line(2)}"/>
      ${hasLive ? `<polyline fill="none" stroke="${L >= 0 ? 'var(--pos)' : 'var(--neg)'}" stroke-width="2.2" vector-effect="non-scaling-stroke" points="${line(1)}"/>` : ''}
    </svg>
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:3px">
      <span>${esc(days[0][0])}${days.length > 1 ? ` … ${esc(days[days.length - 1][0])} (${days.length} sessions)` : ''}</span>
      <span>— live ${hasLive ? usd(L) : '(no live trades yet)'} &nbsp; <span style="color:var(--amber)">- - shadow ${usd(S)} (simulated, not in the book)</span></span>
    </div>`;
  }
  function byStrategyLine(d) {
    const by = {};
    d.trades.forEach(t => { const k = kindOf(t, d), b = by[t.strategy] = by[t.strategy] || { n: 0, stock: 0, fund: 0 }; b.n++; b[k] = (b[k] || 0) + 1; });
    const parts = Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([st, b]) => `${esc(st)} ${b.n.toLocaleString('en-US')} (${[b.stock ? `${b.stock.toLocaleString('en-US')} stocks` : '', b.fund ? `${b.fund.toLocaleString('en-US')} funds` : ''].filter(Boolean).join(', ')})`);
    return parts.length ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-dim);margin-top:8px">trades on record: ${parts.join(' · ')}</div>` : '';
  }
  // z177: stock or fund - the trade's own tag (z176+), the universe's (z176+), else the Stock Book (only funds carry an
  // expense ratio), else the funds the engine knows (sector / index ETFs and the ETFs it arbitrages). Older trades
  // (FXI, YINN traded by opening range before z176) no longer fall through to "stock".
  let _erMap = null;
  function expenseRatioFund(sym) {
    if (_erMap === null && typeof state !== 'undefined' && state.stockbook && Array.isArray(state.stockbook.rows) && state.stockbook.rows.length) {
      _erMap = new Map();
      state.stockbook.rows.forEach(r => { const er = r && (r.expenseRatio ?? r['expense ratio']); if (r && r.ticker) _erMap.set(String(r.ticker).toUpperCase(), er != null && er !== '' && isFinite(+er)); });
    }
    return _erMap ? _erMap.get(String(sym).toUpperCase()) : undefined;
  }
  const KNOWN_FUNDS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC']);
  const kindOf = (t, d) => {
    if (t.tags && t.tags.kind) return t.tags.kind;
    if (t.strategy === 'etf_arb') return 'fund';
    const uk = d.uni && d.uni.kinds && d.uni.kinds[t.symbol];
    if (uk) return uk;
    const er = expenseRatioFund(t.symbol);
    if (er !== undefined) return er ? 'fund' : 'stock';
    return KNOWN_FUNDS.has(t.symbol) || (d.uni && d.uni.etf_weights && d.uni.etf_weights[t.symbol]) ? 'fund' : 'stock';
  };
  const _ui = { view: 'portfolio', mode: 'all', strat: 'all', kind: 'all', sort: 'exit_ts', dir: -1 };
  // z175: the strategy lab in words - which segments, which parameters
  const SEG_WORDS = { liq: { mega: 'mega names (≥ $1B/day)', large: 'large names ($200M–1B)', mid: 'mid-size names ($50–200M)', small: 'small names (< $50M)', unknown: 'names without volume data' },
                      tod: { open: 'the open (to 1030)', mid: 'midday (1030–1430)', late: 'late (after 1430)' }, side: { long: 'longs', short: 'shorts' } };
  function segWords(key) {
    if (key === 'all') return 'every name, all day';
    return key.split('|').map(part => { const [d, v] = part.split(':'); return d === 'sector' ? (v === 'none' ? 'no sector' : `${v} names`) : d === 'quad' ? `official ${v.replace('Q', 'Quad ')}` : ((SEG_WORDS[d] || {})[v] || part); }).join(' · ');
  }
  function variantWords(strategy, p) {
    if (!p) return '—';
    const hm = m => `${Math.floor(m / 60)}${String(m % 60).padStart(2, '0')}`;
    if (strategy === 'sector_reversion') return `z ≥ ${p.z_in} · hold ≤ ${p.max_hold} min${p.vol_spike_max ? ` · skip volume spikes > ${p.vol_spike_max}×` : ''}`;
    if (strategy === 'etf_arb') return `gap ≥ ${p.thr_mult}× cost · hold ≤ ${p.max_hold} min${p.persist ? ' · 2 minutes running' : ''}`;
    if (strategy === 'opening_range') return `${p.range_min}-min range · target ${p.target_mult}× risk · entries to ${hm(p.last_entry)} ET`;
    return Object.entries(p).map(([k, v]) => `${k} ${v}`).join(' · ');
  }
  function labCard(lab) {
    if (!lab || !lab.strategies) return card('Where it works · strategy lab', empty('The lab hasn\'t run yet. Each night (Actions → Quant backtest) it replays the last 40 sessions of real 1-minute bars across every universe name, scores each strategy\'s parameter variants in every segment (liquidity, time of day, side, sector), trains on two thirds and tests on the last third it never saw, with false-discovery control. A strategy trades live only in segments that pass; everywhere else it keeps running in shadow.'));
    const ses = lab.sessions || {}, r = lab.rules || {};
    const sub = `retrained ${esc(etTime(lab.asOf))} ET · trained on ${ses.train ? `${esc(ses.train[0])} … ${esc(ses.train[1])} (${ses.train[2]} sessions)` : '—'} · tested on ${ses.test ? `${esc(ses.test[0])} … ${esc(ses.test[1])} (${ses.test[2]})` : '—'} · live needs ≥ ${r.minTrainTrades} / ${r.minTestTrades} trades, ≥ ${r.minTestExpectancyBps} bps a trade out of sample, false-discovery q ≤ ${r.fdr}`;
    const bodies = Object.entries(lab.strategies).map(([st, m]) => {
      const variants = Object.assign({}, m.variants || {});
      const best = Object.entries(m.overall || {}).filter(([, v]) => v.test && v.test.n).sort((a, b) => b[1].test.meanBps - a[1].test.meanBps)[0];
      const rows = (m.report || []).slice(0, 10).map(c => `<tr><td style="white-space:normal;min-width:180px">${esc(segWords(c.segment))}</td><td style="white-space:normal;min-width:170px">${esc(variantWords(st, (m.live || []).find(a => a.variant === c.variant) ? variants[c.variant] : (c.params || null)) || c.variant)}</td>
        <td style="text-align:right">${c.train.n} · ${bps(c.train.meanBps)} · t ${c.train.t}</td><td style="text-align:right">${c.test.n} · ${bps(c.test.meanBps)} · t ${c.test.t}</td><td style="text-align:right">${c.q}</td><td>${c.approved ? '<span style="color:var(--pos);font-weight:700">LIVE</span>' : '<span style="color:var(--ink-faint)">shadow</span>'}</td></tr>`);
      return `<div style="font-family:var(--mono);font-size:11px;margin:12px 0 6px"><strong>${esc(st)}</strong> · ${m.tested} segments tested · <span style="color:${(m.live || []).length ? 'var(--pos)' : 'var(--ink-faint)'}">${(m.live || []).length} live</span>${best ? ` · on every name the best variant made ${bps(best[1].test.meanBps)} a trade out of sample` : ''}</div>`
        + (rows.length ? tbl([['Segment'], ['Variant'], ['Train (n · net · t)', 'right'], ['Test (n · net · t)', 'right'], ['q', 'right'], ['Status']], rows, 760)
                       : empty('No segment had enough trades with a positive training result to test.'));
    }).join('');
    return card('Where it works · strategy lab', bodies + `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:8px">net = after the spread (scaled by each name's liquidity), slippage and fees · q = the chance the result is a false discovery among everything tested · shadow trades keep collecting evidence on every name</div>`, sub);
  }

  // z177: the macro quad the quant book records on every trade (official GDP/CPI and the market nowcast)
  const QN = { 1: 'Goldilocks', 2: 'Reflation', 3: 'Stagflation', 4: 'Deflation' };
  function quadLine(doc) {
    if (!doc) return '';
    const cur = doc.current || {}, off = doc.official || doc.officialLatest || (cur.method !== 'market-nowcast' ? cur : null) || {};
    const nc = doc.nowcast || (cur.method === 'market-nowcast' ? cur : null) || {};
    const ag = doc.agree || (off.quad && nc.quad ? { sameQuad: off.quad === nc.quad } : null);
    const part = (q, label, asOf) => q ? `<strong>Q${q} ${QN[q] || ''}</strong> <span style="color:var(--ink-faint)">${label}${asOf ? ' · ' + esc(String(asOf).slice(0, 10)) : ''}</span>` : '';
    return `<div style="font-family:var(--mono);font-size:10px;line-height:1.7;margin-top:8px;padding:8px 10px;border-left:2px solid ${ag && !ag.sameQuad ? 'var(--amber)' : 'var(--rule)'}">macro quad: ${part(off.quad, 'official GDP/CPI', off.asOf)}${nc.quad ? ` · ${part(nc.quad, 'market nowcast', nc.asOf)}` : ''}`
      + (ag ? `<br><span style="color:${ag.sameQuad ? 'var(--pos)' : 'var(--amber)'}">${ag.sameQuad ? '✓ they agree' : '⚠ ' + esc(ag.note || 'they disagree')}</span>` : '')
      + `<br><span style="color:var(--ink-faint)">every quant trade records both; the lab tests each strategy by the official quad as it was known that day - it changes nothing until a segment earns it</span></div>`;
  }

  // z174: what the universe holds - every US stock / ETF in the books - and what Alpaca's stock API can't trade
  function universeLine(u) {
    const c = u.counts || {}, n = c.symbols || (u.symbols || []).length;
    const skip = Object.entries(c.notOnAlpacaStocks || {}).sort((a, b) => b[1] - a[1]);
    const skipped = skip.reduce((x, [, v]) => x + v, 0);
    return `${n} symbols${c.bookTickers ? ` - every US stock / ETF in the books (${c.usTradable} of ${c.bookTickers} book tickers)` : ''}`
      + (skipped ? `; ${skipped} not on Alpaca's stock API (${skip.map(([k, v]) => `${v} ${esc(k)}`).join(', ')})` : '')
      + (c.withSector != null ? ` · ${c.withSector} with a sector ETF · ${c.momentum} liquid enough for breakouts` : '')
      + `, built ${esc(etTime(u.asOf))} ET`;
  }

  function whyNothing(d) {
    const r = d.runs || {};
    if (d.summ || d.live) return '';
    if (r.tests && r.tests.conclusion === 'failure') return 'The <strong>Tests</strong> run is failing - the repo has a broken commit. Open its log.';
    if (r.engine && r.engine.conclusion === 'failure') return 'The last <strong>engine</strong> job failed - open its log (often: the Alpaca secrets aren\'t set).';
    if (!d.uni) return 'Nothing has run yet: TRAPP2-QUANT needs its Actions secrets (ALPACA_KEY_ID / ALPACA_SECRET_KEY, SUPABASE_URL / SUPABASE_SERVICE_ROLE) and variables, then Actions → Quant backtest → Run workflow once, and Actions → Quant engine → Run workflow (Mon–Thu any time: it waits for 0920 ET).';
    if (!d.gate) return 'The universe is built but no backtest has finished - Actions → Quant backtest → Run workflow (it needs the Alpaca secrets).';
    return 'Ready - waiting for the engine\'s next session (0920 ET, Monday–Friday).';
  }

  function portfolioView(d) {
    const L = (d.summ && d.summ.live) || {}, S = (d.summ && d.summ.shadow) || {}, g = (d.gate && d.gate.strategies) || {};
    const bench = (d.summ && d.summ.benchmarkWinRate) || 0.5075, opn = (d.live && d.live.open) || [];
    const realized = d.trades.filter(t => t.mode === 'live').reduce((s, t) => s + (+t.pnl || 0), 0);
    const why = whyNothing(d);
    const tiles = `<div class="company-card" style="margin:0 0 14px"><div style="display:flex;flex-wrap:wrap;gap:14px 22px">
      ${tile('BOOK VALUE', `$${(CAPITAL + realized).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, `$100,000 paper · realized ${usd(realized)} over ${d.trades.filter(t => t.mode === 'live').length} live trades on record`)}
      ${tile('TODAY', d.live ? usd(d.live.dayPnl) : '—', d.live ? `${d.live.closedToday} closed · ${opn.length} open` : 'no session data')}
      ${tile('LIVE RECORD', L.n ? `${L.n.toLocaleString('en-US')} trades` : '—', L.n ? `win ${pct(L.winRate)} · ${bps(L.expectancyBps)}` : 'live trades start when the gate passes')}
      ${tile('SHADOW RECORD', S.n ? `${S.n.toLocaleString('en-US')} trades` : '—', S.n ? `win ${pct(S.winRate)} · ${bps(S.expectancyBps)}` : 'simulated fills while unproven')}
      ${tile('VS 50.75 %', L.pBeatsBenchmark == null ? '—' : L.pBeatsBenchmark < 0.05 ? '<span style="color:var(--pos)">beats it</span>' : 'not yet shown', L.pBeatsBenchmark == null ? 'needs live trades' : `p = ${L.pBeatsBenchmark}`)}
      ${tile('DATA', d.live && d.live.feed ? (d.live.feed.stream ? '<span style="color:var(--pos)">streaming</span>' : d.live.feed.pollerOk ? 'polling' : '<span style="color:var(--neg)">stale</span>') : '—', d.live && d.live.feed ? esc(d.live.feed.feed || '') : 'engine not running')}
    </div>${curveSvg(curvePoints(d)) ? `<div style="margin-top:14px">${curveSvg(curvePoints(d))}</div>` : ''}${byStrategyLine(d)}</div>`;
    const r = d.runs || {};
    const status = card('Engine & pipeline', `${why ? `<div style="font-family:var(--mono);font-size:10.5px;color:var(--amber);line-height:1.6;margin-bottom:8px">⚠ ${why}</div>` : ''}
      ${tbl([['Workflow'], ['Latest run']], [['Quant engine (0920 ET → close)', r.engine], ['Quant backtest (the gate, 1840 ET)', r.backtest], ['Tests (every push)', r.tests]].map(([n, x]) => `<tr><td>${n}</td><td>${runTxt(x)}</td></tr>`), 420)}
      ${quadLine(d.quadDoc)}
      <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:6px">universe: ${d.uni ? universeLine(d.uni) : 'not built yet'} · gate: ${d.gate ? `from ${esc(etTime(d.gate.asOf))} ET` : 'no backtest yet'} · summary: ${d.summ ? `${esc(etTime(d.summ.asOf))} ET (${ago(d.summ.asOf)})` : 'none yet'} · live state: ${d.live ? `${ago(d.liveAt)} (Supabase)` : 'none'}</div>`);
    const pos = card('Open positions', opn.length ? tbl([['Symbol'], ['Side'], ['Qty', 'right'], ['Strategy'], ['Mode'], ['Entry', 'right'], ['Move', 'right']],
      opn.map(p => `<tr><td>${esc(p.symbol)}</td><td>${esc(p.side)}</td><td style="text-align:right">${p.qty}</td><td>${esc(p.strategy)}</td><td>${p.mode === 'shadow' ? '<span style="color:var(--ink-faint)">shadow</span>' : 'live'}</td><td style="text-align:right">$${(+p.entry).toFixed(2)}</td><td style="text-align:right">${bps(p.moveBps)}</td></tr>`))
      : empty(d.live ? 'Flat - the book is always flat by 1555 ET.' : 'None - the engine isn\'t running right now.'));
    const latest = d.trades.slice(0, 8);
    const act = card('Latest trades', latest.length ? tbl([['Closed (ET)'], ['Strategy'], ['Trade'], ['Net', 'right'], ['$', 'right']],
      latest.map(t => `<tr><td>${esc(etTime(t.exit_ts))}</td><td>${esc(t.strategy)}${t.mode === 'shadow' ? ' <span style="color:var(--ink-faint)">(shadow)</span>' : ''}</td><td>${esc(t.side)} ${t.qty} ${esc(t.symbol)}</td><td style="text-align:right">${bps(t.net_bps)}</td><td style="text-align:right">${usd(t.pnl)}</td></tr>`), 460) + '<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:6px">every trade → ▤ Ledger</div>'
      : empty('No quant trades yet - they appear here and in ▤ Ledger.'));
    const stats = card('Statistics · live and shadow, per strategy', d.summ ? `<div style="font-family:var(--mono);font-size:11px;margin:0 0 6px">${L.n ? `Live: ${L.n.toLocaleString('en-US')} trades · win ${pct(L.winRate)} · ${L.pBeatsBenchmark != null && L.pBeatsBenchmark < 0.05 ? `<span style="color:var(--pos)">beats ${pct2(bench)}</span>` : `not yet shown to beat ${pct2(bench)}`}${L.pBeatsBenchmark != null ? ` (p = ${L.pBeatsBenchmark})` : ''}` : 'No live trades yet.'}</div>
      ${tbl([['Book'], ['Trades', 'right'], ['Win', 'right'], ['95 % CI', 'right'], ['Expectancy', 'right'], ['Profit factor', 'right'], ['t', 'right'], ['Gate']],
        [statRow('All live', L, ''), statRow('All shadow', S, '')].concat(Object.entries(d.summ.byStrategy || {}).map(([k, v]) => statRow(k + ' · live', v.live, g[k] ? (g[k].pass ? '<span style="color:var(--pos)">live</span>' : 'shadow') : '—') + statRow(k + ' · shadow', v.shadow, ''))), 600)}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">expectancy = average net result per trade after the spread, slippage and fees · a win rate alone can mislead · ~4,300 trades show 52 % beats 50.75 %; ~375 show 55 %</div>`
      : empty('Appears after the first session: win rate with its 95 % interval, a test against Medallion\'s 50.75 %, expectancy after costs, profit factor and t - live and shadow, per strategy.'));
    const gs = (d.bt && d.bt.strategies) || g, rules = (d.gate && d.gate.rules) || {};
    const gateC = card('Quality gate · nightly backtest', Object.keys(gs).length
      ? `${tbl([['Strategy'], ['Status'], ['Trades', 'right'], ['Win', 'right'], ['Expectancy', 'right'], ['t', 'right']], Object.entries(gs).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.pass ? '<span style="color:var(--pos)">LIVE</span>' : 'shadow'}</td><td style="text-align:right">${v.n == null ? '—' : v.n}</td><td style="text-align:right">${pct(v.winRate)}</td><td style="text-align:right">${bps(v.expectancyBps)}</td><td style="text-align:right">${v.tStat == null ? '—' : (+v.tStat).toFixed(2)}</td></tr>`), 480)}
         <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:6px">${d.bt && d.bt.days ? `replayed ${d.bt.days.length} sessions (${esc(d.bt.days[0])} … ${esc(d.bt.days[d.bt.days.length - 1])}) of real 1-minute bars · ` : ''}live needs ≥ ${rules.minTrades || 200} trades, expectancy ≥ ${rules.minExpectancyBps || 0.5} bps after costs, t ≥ ${rules.minTStat || 2}</div>`
      : empty('No backtest yet. Each night the last 10 sessions of real 1-minute bars run through the same engine; a strategy trades live (Alpaca paper) only with ≥ 200 trades, expectancy ≥ 0.5 bps after costs and t ≥ 2 - until then it trades in shadow.'));
    const days = Object.entries((d.summ && d.summ.byDay) || {}).sort((a, b) => b[0].localeCompare(a[0]));
    const byDay = days.length ? card('By day · live', tbl([['Day'], ['Trades', 'right'], ['P&L', 'right'], ['Win', 'right'], ['Expectancy', 'right']], days.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${v.n}</td><td style="text-align:right">${usd(v.pnl)}</td><td style="text-align:right">${pct(v.winRate)}</td><td style="text-align:right">${bps(v.expectancyBps)}</td></tr>`), 420)) : '';
    const rulesC = card('Strategies & risk', `${tbl([['Strategy'], ['Family'], ['Looks for'], ['Holds']], Object.entries(STRATS).map(([k, v]) => `<tr><td>${k}</td><td>${v[0]}</td><td style="white-space:normal;min-width:240px">${v[1]}</td><td>${v[2]}</td></tr>`), 640)}
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);line-height:1.7;margin-top:8px">$100,000 paper book, separate from the swing bot · 0.15 % of capital lost at a stop · ≤ 5 % per position, ≤ 25 positions, ≤ 150 % gross · entries 0940–1540 ET, flat at 1555 ET · no new entries after −1.5 % on the day · spread ≤ 8 bps, price ≥ $5, data ≤ 30 s old · market orders on the Alpaca paper account</div>`);
    return tiles + status + labCard(d.lab) + pos + act + stats + gateC + byDay + rulesC;
  }

  function ledgerView(d) {
    const strategies = [...new Set(d.trades.map(t => t.strategy))].sort();
    let shown = d.trades.filter(t => (_ui.mode === 'all' || t.mode === _ui.mode) && (_ui.strat === 'all' || t.strategy === _ui.strat) && (_ui.kind === 'all' || kindOf(t, d) === _ui.kind));
    const nStock = d.trades.filter(t => kindOf(t, d) === 'stock').length, nFund = d.trades.length - nStock;
    const key = _ui.sort, num = ['net_bps', 'pnl', 'hold_sec', 'qty'].includes(key);
    shown = shown.slice().sort((a, b) => (num ? ((+a[key] || 0) - (+b[key] || 0)) : String(a[key] || '').localeCompare(String(b[key] || ''))) * _ui.dir);
    const liveT = d.trades.filter(t => t.mode === 'live'), shadowT = d.trades.filter(t => t.mode === 'shadow');
    const sum = a => a.reduce((s, t) => s + (+t.pnl || 0), 0);
    const chip = (grp, val, label) => `<button class="quant-chip" data-grp="${grp}" data-val="${val}" style="font-family:var(--mono);font-size:10px;padding:4px 10px;margin:0 6px 6px 0;border:1px solid var(--rule);border-radius:12px;cursor:pointer;background:${_ui[grp] === val ? 'var(--amber)' : 'transparent'};color:${_ui[grp] === val ? '#000' : 'var(--ink-dim)'}">${label}</button>`;
    const acct = `<div class="company-card" style="margin:0 0 14px"><div style="display:flex;flex-wrap:wrap;gap:8px 22px;font-family:var(--mono);font-size:11px">
        <span style="color:var(--ink-faint)">Capital: <strong style="color:var(--ink)">$100,000</strong></span>
        <span style="color:var(--ink-faint)">Live realized: <strong>${usd(sum(liveT))}</strong> (${liveT.length} trades)</span>
        <span style="color:var(--ink-faint)">Shadow (simulated, not in the book): <strong>${usd(sum(shadowT))}</strong> (${shadowT.length} trades)</span>
      </div></div>`;
    const ledger = card(`Quant ledger · ${d.trades.length} trade${d.trades.length === 1 ? '' : 's'}`, d.trades.length
      ? `<div>${chip('kind', 'all', `All ${d.trades.length.toLocaleString('en-US')}`)}${chip('kind', 'stock', `Stocks ${nStock.toLocaleString('en-US')}`)}${chip('kind', 'fund', `ETFs & funds ${nFund.toLocaleString('en-US')}`)}</div>
         <div>${chip('mode', 'all', 'All')}${chip('mode', 'live', 'Live')}${chip('mode', 'shadow', 'Shadow')}<span style="display:inline-block;width:10px"></span>${chip('strat', 'all', 'Every strategy')}${strategies.map(x => chip('strat', x, esc(x))).join('')}</div>
         ${tbl([['Closed (ET)', 'left', 'exit_ts'], ['Strategy', 'left', 'strategy'], ['Mode'], ['Symbol', 'left', 'symbol'], ['Side'], ['Qty', 'right', 'qty'], ['Entry', 'right'], ['Exit', 'right'], ['Held', 'right', 'hold_sec'], ['Net', 'right', 'net_bps'], ['$', 'right', 'pnl'], ['Why out']],
           shown.slice(0, 300).map(t => `<tr><td>${esc(etTime(t.exit_ts))}</td><td>${esc(t.strategy)}</td><td>${t.mode === 'shadow' ? '<span style="color:var(--ink-faint)">shadow</span>' : esc(t.mode)}</td><td>${esc(t.symbol)} <span style="color:var(--ink-faint);font-size:9px">${kindOf(t, d) === 'fund' ? 'fund' : 'stock'}</span></td><td>${esc(t.side)}</td><td style="text-align:right">${t.qty}</td><td style="text-align:right">$${(+t.entry_px).toFixed(2)}</td><td style="text-align:right">$${(+t.exit_px).toFixed(2)}</td><td style="text-align:right">${Math.round((t.hold_sec || 0) / 60)} min</td><td style="text-align:right">${bps(t.net_bps)}</td><td style="text-align:right">${usd(t.pnl)}</td><td style="color:var(--ink-faint)">${esc(t.reason_out)}</td></tr>`), 900)}`
      : empty('No quant trades yet. Every closed trade lands here - live (Alpaca paper fills) and shadow (simulated, for strategies the gate hasn\'t passed) - with entry and exit, hold time, net bps after costs, dollars and why it closed.'),
      d.src ? `source: ${d.src}${shown.length > 300 ? ' · showing 300' : ''} · tap a column to sort` : '');
    const note = `<div class="company-card" style="border-left:3px solid var(--ink-faint)"><div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);line-height:1.7"><strong style="color:var(--ink)">Separate books:</strong> this ledger is the quant book's alone (TRAPP2-QUANT, Supabase quant_trades). The swing bot's trades live on Bets and never mix with these; shadow trades are simulated and never count toward the book.</div></div>`;
    return acct + ledger + note;
  }

  async function renderPage() {
    const body = document.getElementById('quant-body');
    if (!body) return;
    if (!body.innerHTML.trim()) body.innerHTML = empty('Loading the quant book…');
    const d = await loadAll();
    const v = _ui.view === 'ledger' ? 'ledger' : 'portfolio';
    const btn = (id, label) => `<button class="quant-view-btn" data-view="${id}" style="font-family:var(--mono);font-size:11px;padding:8px 18px;border:none;cursor:pointer;background:${v === id ? 'var(--amber)' : 'transparent'};color:${v === id ? '#000' : 'var(--ink-dim)'};font-weight:${v === id ? '700' : '400'}">${label}</button>`;
    const toggle = `<div style="display:flex;gap:0;margin:0 0 18px;border:1px solid var(--rule);border-radius:8px;overflow:hidden;width:fit-content">${btn('portfolio', '◆ Portfolio')}${btn('ledger', `▤ Ledger (${d.trades.length})`)}</div>`;
    body.innerHTML = toggle + (v === 'ledger' ? ledgerView(d) : portfolioView(d));
    body.querySelectorAll('.quant-view-btn').forEach(b => b.addEventListener('click', () => { _ui.view = b.dataset.view; renderPage(); }));
    body.querySelectorAll('.quant-chip').forEach(b => b.addEventListener('click', () => { _ui[b.dataset.grp] = b.dataset.val; renderPage(); }));
    body.querySelectorAll('.quant-sort').forEach(th => th.addEventListener('click', () => { const c = th.dataset.col; if (_ui.sort === c) _ui.dir = -_ui.dir; else { _ui.sort = c; _ui.dir = -1; } renderPage(); }));
  }

  setInterval(() => {
    const panel = document.querySelector('.tab-panel[data-panel="quant"]');
    if (panel && panel.classList.contains('active')) renderPage();
  }, 60000);
  window.QuantDesk = { renderPage, render: renderPage };
})();
