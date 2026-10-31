/* ==========================================================================
   quantdesk.js — z163 card · z170 Bets → "⚡ Quant" dashboard (engine status, today, open positions, the ledger,
   statistics, the gate, the rules). The quant book on the Bets page: today (open positions, P&L, trades, feed health from
   Supabase · Bot project · quant_state) and the record (TRAPP2-QUANT data/quant/summary.json + gate.json):
   win rate with its 95 % interval against Medallion's 50.75 %, expectancy in bps net of costs, profit factor,
   t-stat — live and shadow, per strategy, and which strategies the quality gate has let trade live.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  const pct2 = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
  const bps = v => (v == null ? '—' : `<span style="color:${v < 0 ? 'var(--neg)' : v > 0 ? 'var(--pos)' : 'inherit'}">${v > 0 ? '+' : ''}${(+v).toFixed(2)} bps</span>`);
  const usd = v => (v == null ? '—' : `<span style="color:${v < 0 ? 'var(--neg)' : v > 0 ? 'var(--pos)' : 'inherit'}">${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</span>`);
  async function gh(path) { try { const r = await fetch(`${RAW()}/TRAPP2-QUANT/main/${path}?_=${Math.floor(Date.now() / 60000)}`, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
  async function sb(path) {
    try {
      // z166: the quant tables live in the PORT + ANALYTICS project (that's where they were created); the Bot project is the fallback
      const an = typeof getAnalyticsSupabaseUrl === 'function' && getAnalyticsSupabaseUrl();
      const u = (an || (typeof getSupabaseUrl === 'function' ? getSupabaseUrl() : '') || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
      const a = an ? (typeof getAnalyticsSupabaseAnon === 'function' ? getAnalyticsSupabaseAnon() : '') : (typeof getSupabaseAnon === 'function' ? getSupabaseAnon() : '');
      if (!u || !a) return null;
      const r = await fetch(u + path, { headers: { apikey: a, Authorization: 'Bearer ' + a }, cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  const row = (label, s, gate) => !s || !s.n ? `<tr><td>${esc(label)}</td><td colspan="6" style="color:var(--ink-faint)">no trades yet</td>${gate !== undefined ? `<td>${gate}</td>` : ''}</tr>` :
    `<tr><td>${esc(label)}</td><td style="text-align:right">${s.n.toLocaleString('en-US')}</td><td style="text-align:right">${pct(s.winRate)}</td>
      <td style="text-align:right;color:var(--ink-faint)">${s.winRateCI95 ? pct(s.winRateCI95[0]) + '–' + pct(s.winRateCI95[1]) : '—'}</td>
      <td style="text-align:right">${bps(s.expectancyBps)}</td><td style="text-align:right">${s.profitFactor == null ? '—' : s.profitFactor.toFixed(2)}</td>
      <td style="text-align:right">${s.tStat == null ? '—' : s.tStat.toFixed(2)}</td>${gate !== undefined ? `<td>${gate}</td>` : ''}</tr>`;

  async function render() {
    const panel = document.querySelector('.tab-panel[data-panel="bets"]');
    if (!panel) return;
    if (typeof _betsView !== 'undefined' && _betsView === 'quant') {        // z170: the dashboard view has it all
      const old = document.getElementById('quant-desk'); if (old) old.remove();
      return;
    }
    let host = document.getElementById('quant-desk');
    if (!host) {
      host = document.createElement('section');
      host.id = 'quant-desk';
      host.className = 'company-card';
      host.style.margin = '12px 0';
      const head = panel.querySelector('.news-header');
      if (head && head.nextSibling) head.parentNode.insertBefore(host, head.nextSibling); else panel.prepend(host);
    }
    const [summ, gate, st, uni, recent] = await Promise.all([gh('data/quant/summary.json'), gh('data/quant/gate.json'), sb('/rest/v1/quant_state?id=eq.live&select=doc,updated_at'),
      gh('data/quant/universe.json'), sb('/rest/v1/quant_trades?select=trade&order=closed_at.desc&limit=25')]);
    const live = st && st[0] && st[0].doc;
    if (!summ && !live) {
      // z167: say exactly why nothing shows and what starts it
      const step = !uni ? 'Neither the backtest nor the engine has run yet - TRAPP2-QUANT needs its Actions secrets (ALPACA_KEY_ID / ALPACA_SECRET_KEY, SUPABASE_URL / SUPABASE_SERVICE_ROLE) and variables (QUANT_FEED, QUANT_STREAM_LIMIT). Then Actions → Quant backtest → Run workflow once; the engine starts itself at 0920 ET (or Actions → Quant engine → Run workflow during the session).'
        : !gate ? 'The universe is built, but no backtest has finished - Actions → Quant backtest → Run workflow (needs the Alpaca secrets).'
        : 'Backtest done; waiting for the engine\'s first session (0920 ET, or Actions → Quant engine → Run workflow during the session).';
      host.innerHTML = `<div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">QUANT BOOK · INTRADAY &amp; SHORT HORIZON</div>
        <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);margin-top:6px;line-height:1.6">Quant trades appear here - today's P&amp;L, open positions, every closed trade and the record against 50.75 %. Nothing yet: ${escapeHtml(step)}</div>`;
      return;
    }
    const trades = (recent || []).map(r => r.trade).filter(Boolean);
    const L = (summ && summ.live) || {}, S = (summ && summ.shadow) || {}, g = (gate && gate.strategies) || {};
    const bench = (summ && summ.benchmarkWinRate) || 0.5075;
    const beat = L.pBeatsBenchmark == null ? '' : L.pBeatsBenchmark < 0.05 ? `<span style="color:var(--pos)">beats ${pct2(bench)} (p = ${L.pBeatsBenchmark})</span>` : `not yet shown to beat ${pct2(bench)} (p = ${L.pBeatsBenchmark})`;
    const opn = (live && live.open) || [];
    host.innerHTML = `<div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">QUANT BOOK · INTRADAY &amp; SHORT HORIZON · separate from the swing bot</div>
      ${live ? `<div style="display:flex;flex-wrap:wrap;gap:8px 26px;margin:10px 0;font-family:var(--mono);font-size:11px">
        <div><div style="font-size:9px;color:var(--ink-faint)">TODAY</div><div style="font-size:17px;font-weight:700">${usd(live.dayPnl)}</div><div style="font-size:9px;color:var(--ink-faint)">${live.closedToday} trades closed · ${opn.length} open</div></div>
        <div><div style="font-size:9px;color:var(--ink-faint)">DATA</div><div>${live.feed && live.feed.stream ? '<span style="color:var(--pos)">streaming</span>' : live.feed && live.feed.pollerOk ? 'polling' : '<span style="color:var(--neg)">stale</span>'} · ${esc((live.feed && live.feed.feed) || '')}</div><div style="font-size:9px;color:var(--ink-faint)">as of ${esc(new Date(st[0].updated_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }))} ET</div></div></div>
        ${opn.length ? `<div style="font-family:var(--mono);font-size:10.5px;margin-bottom:8px">${opn.map(p => `${esc(p.symbol)} ${esc(p.side)} ${p.qty} · ${esc(p.strategy)}${p.mode === 'shadow' ? ' (shadow)' : ''} · ${bps(p.moveBps)}`).join('<br>')}</div>` : ''}` : ''}
      ${summ ? `<div style="font-family:var(--mono);font-size:11px;margin:6px 0">${L.n ? `Live record: ${L.n.toLocaleString('en-US')} trades · win ${pct(L.winRate)} · ${beat}` : 'No live trades yet — strategies trade live once the backtest gate passes them.'}</div>
      <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:560px;font-family:var(--mono);font-size:10.5px"><thead><tr><th style="text-align:left">Book</th><th style="text-align:right">Trades</th><th style="text-align:right">Win</th><th style="text-align:right">95 % CI</th><th style="text-align:right">Expectancy</th><th style="text-align:right">Profit factor</th><th style="text-align:right">t</th><th style="text-align:left">Gate</th></tr></thead><tbody>
        ${row('All live', L, '')}${row('All shadow', S, '')}
        ${Object.entries((summ && summ.byStrategy) || {}).map(([k, v]) => row(k + ' · live', v.live, g[k] ? (g[k].pass ? '<span style="color:var(--pos)">live</span>' : 'shadow') : '—') + row(k + ' · shadow', v.shadow, '')).join('')}</tbody></table></div>
      ${trades.length ? `<div style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--ink-dim);margin:12px 0 4px">LATEST TRADES</div>
        <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:560px;font-family:var(--mono);font-size:10.5px"><thead><tr><th style="text-align:left">Closed (ET)</th><th style="text-align:left">Strategy</th><th style="text-align:left">Trade</th><th style="text-align:right">Held</th><th style="text-align:right">Net</th><th style="text-align:right">$</th><th style="text-align:left">Why out</th></tr></thead><tbody>
        ${trades.map(t => `<tr><td>${esc(new Date(t.exit_ts).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td>${esc(t.strategy)}${t.mode === 'shadow' ? ' <span style="color:var(--ink-faint)">(shadow)</span>' : ''}</td><td>${esc(t.side)} ${t.qty} ${esc(t.symbol)}</td><td style="text-align:right">${Math.round((t.hold_sec || 0) / 60)} min</td><td style="text-align:right">${bps(t.net_bps)}</td><td style="text-align:right">${usd(t.pnl)}</td><td style="color:var(--ink-faint)">${esc(t.reason_out)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">expectancy = average net result per trade after the spread, slippage and fees · win rate alone can mislead (a strategy can win most trades and lose money) · benchmark: Medallion's often-quoted ${pct2(bench)}</div>` : ''}`;
  }

  (function () {
    const orig = window.renderBetsTab;
    if (typeof orig === 'function' && !orig._z163) {
      const w = function () { const r = orig.apply(this, arguments); try { setTimeout(render, 50); } catch (e) {} return r; };
      w._z163 = true; Object.keys(orig).forEach(k => { w[k] = orig[k]; });
      window.renderBetsTab = w;
    }
  })();
  // ======================================================================================================
  // z170 - THE QUANT DASHBOARD: Bets → "⚡ Quant", a full view like the bot's own - engine status, today,
  // open positions, every trade (the ledger), statistics per strategy, the backtest gate, the rules. It shows
  // what exists and says plainly what doesn't yet (and why), so it is useful before the engine's first trade.
  // ======================================================================================================
  const STRATS = {
    sector_reversion: ['Stat-arb (Medallion family)', 'fades a stock\'s 10-minute move against its sector ETF (beta-adjusted, z ≥ 2.5)', '≤ 30 min'],
    etf_arb: ['ETF arbitrage (Jane Street family)', 'trades a sector ETF toward its own holdings when it lags them by > 2.5× the round-trip cost', '≤ 10 min'],
    opening_range: ['Intraday momentum', 'a clean break of the first 15 minutes\' range before 1130 ET', 'to the close'],
  };
  const etTime = iso => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return '—'; } };
  const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !isFinite(m) ? '' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const card = (title, inner, sub) => `<div class="company-card" style="margin:0 0 14px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim);text-transform:uppercase">${title}</div>${sub ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:3px">${sub}</div>` : ''}<div style="margin-top:8px">${inner}</div></div>`;
  const empty = t => `<div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);line-height:1.6">${t}</div>`;
  const tile = (k, v, s) => `<div style="min-width:130px;flex:1 1 130px"><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:.1em">${k}</div><div style="font-family:var(--mono);font-size:16px;font-weight:700;margin-top:2px">${v}</div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px">${s || ''}</div></div>`;
  const tbl = (head, rows, minw) => `<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:${minw || 520}px;font-family:var(--mono);font-size:10.5px"><thead><tr>${head.map(h => `<th style="text-align:${h[1] || 'left'}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  let _runsCache = { at: 0, v: null };
  async function actionsRuns() {
    // the engine / backtest / tests workflows' latest runs - cached 10 min (GitHub allows 60 calls / hour without a token)
    if (_runsCache.v && Date.now() - _runsCache.at < 600000) return _runsCache.v;
    const tok = typeof getGitHubToken === 'function' ? getGitHubToken() : '';
    const one = async wf => {
      try {
        const r = await fetch(`https://api.github.com/repos/TheMostLocal/TRAPP2-QUANT/actions/workflows/${wf}/runs?per_page=1`, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, tok ? { Authorization: 'Bearer ' + tok } : {}) });
        if (!r.ok) return { err: r.status === 403 ? 'rate-limited' : 'HTTP ' + r.status };
        const j = await r.json(); return (j.workflow_runs || [])[0] || { none: true };
      } catch (e) { return { err: 'offline' }; }
    };
    const [engine, backtest, tests] = await Promise.all([one('engine.yml'), one('backtest.yml'), one('tests.yml')]);
    _runsCache = { at: Date.now(), v: { engine, backtest, tests } };
    return _runsCache.v;
  }
  async function recentTradeFiles(days) {
    // GitHub fallback for the ledger: data/quant/trades/<ET date>.jsonl for the last `days` calendar days
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
  const _qState = { mode: 'all', strat: 'all' };

  async function renderDashboard(host) {
    if (!host) return;
    host.innerHTML = empty('Loading the quant book…');
    const [summ, gate, bt, uni, st, sbTrades, runs] = await Promise.all([gh('data/quant/summary.json'), gh('data/quant/gate.json'), gh('data/quant/backtest/latest.json'),
      gh('data/quant/universe.json'), sb('/rest/v1/quant_state?id=eq.live&select=doc,updated_at'), sb('/rest/v1/quant_trades?select=trade&order=closed_at.desc&limit=300'), actionsRuns()]);
    let trades = (sbTrades || []).map(r => r.trade).filter(Boolean);
    let tradeSrc = trades.length ? 'Supabase (live)' : '';
    if (!trades.length) { trades = (await recentTradeFiles(10)).sort((a, b) => String(b.exit_ts).localeCompare(String(a.exit_ts))); tradeSrc = trades.length ? 'GitHub (committed every 15 min)' : ''; }
    const live = st && st[0] && st[0].doc;
    const L = (summ && summ.live) || {}, S = (summ && summ.shadow) || {}, g = (gate && gate.strategies) || {};
    const bench = (summ && summ.benchmarkWinRate) || 0.5075;

    // ---- engine status: why nothing shows, when that's the case ----
    const runTxt = r => !r ? '—' : r.err ? `<span style="color:var(--ink-faint)">${esc(r.err)}</span>` : r.none ? '<span style="color:var(--ink-faint)">never run</span>'
      : `${r.status !== 'completed' ? `<span style="color:var(--amber)">${esc(r.status)}</span>` : r.conclusion === 'success' ? '<span style="color:var(--pos)">success</span>' : `<span style="color:var(--neg)">${esc(r.conclusion || '?')}</span>`} · ${esc(etTime(r.created_at))} ET <a href="${esc(r.html_url)}" target="_blank" rel="noopener" style="color:var(--amber)">log ↗</a>`;
    let why = '';
    if (!summ && !live) {
      why = runs && runs.tests && runs.tests.conclusion === 'failure' ? 'The <strong>Tests</strong> run is failing - the repo has a broken commit (z169: <code>quant/ledgar.py</code> must be deleted and <code>quant/ledger.py</code> added).'
        : runs && runs.engine && runs.engine.conclusion === 'failure' ? 'The last <strong>engine</strong> job failed - open its log (often: the Alpaca secrets aren\'t set).'
        : !uni ? 'Nothing has run yet. TRAPP2-QUANT needs its Actions secrets (ALPACA_KEY_ID / ALPACA_SECRET_KEY, SUPABASE_URL / SUPABASE_SERVICE_ROLE) and variables (QUANT_FEED, QUANT_STREAM_LIMIT); then Actions → Quant backtest → Run workflow once, and Actions → Quant engine → Run workflow (Mon–Thu any time: it waits for 0920 ET).'
        : !gate ? 'The universe is built but no backtest has finished - Actions → Quant backtest → Run workflow.'
        : 'Ready - waiting for the engine\'s next session (0920 ET).';
    }
    const statusCard = card('Engine & pipeline', `${why ? `<div style="font-family:var(--mono);font-size:10.5px;color:var(--amber);line-height:1.6;margin-bottom:8px">⚠ ${why}</div>` : ''}
      ${tbl([['Workflow'], ['Latest run']], [['Quant engine (0920 ET → close)', runs && runs.engine], ['Quant backtest (the gate, 1840 ET)', runs && runs.backtest], ['Tests (every push)', runs && runs.tests]]
        .map(([n, r]) => `<tr><td>${n}</td><td>${runTxt(r)}</td></tr>`), 420)}
      <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:6px">universe: ${uni ? `${(uni.counts && uni.counts.symbols) || (uni.symbols || []).length} symbols, built ${esc(etTime(uni.asOf))} ET` : 'not built yet'} · gate: ${gate ? `from ${esc(etTime(gate.asOf))} ET` : 'no backtest yet'} · summary: ${summ ? `${esc(etTime(summ.asOf))} ET (${ago(summ.asOf)})` : 'none yet'} · live state: ${live ? `${ago(st[0].updated_at)} (Supabase)` : 'none (Supabase secrets, or not running)'}</div>`);

    // ---- headline tiles ----
    const opn = (live && live.open) || [];
    const tiles = `<div style="display:flex;flex-wrap:wrap;gap:14px 22px;margin:2px 0 14px">
      ${tile('TODAY', live ? usd(live.dayPnl) : '—', live ? `${live.closedToday} closed · ${opn.length} open` : 'no session data')}
      ${tile('LIVE RECORD', L.n ? `${L.n.toLocaleString('en-US')} trades` : '—', L.n ? `win ${pct(L.winRate)} · ${bps(L.expectancyBps)}` : 'live trades start when the gate passes')}
      ${tile('SHADOW RECORD', S.n ? `${S.n.toLocaleString('en-US')} trades` : '—', S.n ? `win ${pct(S.winRate)} · ${bps(S.expectancyBps)}` : 'simulated fills while unproven')}
      ${tile('VS 50.75 %', L.pBeatsBenchmark == null ? '—' : L.pBeatsBenchmark < 0.05 ? '<span style="color:var(--pos)">beats it</span>' : 'not yet shown', L.pBeatsBenchmark == null ? 'needs live trades' : `p = ${L.pBeatsBenchmark}`)}
      ${tile('DATA', live && live.feed ? (live.feed.stream ? '<span style="color:var(--pos)">streaming</span>' : live.feed.pollerOk ? 'polling' : '<span style="color:var(--neg)">stale</span>') : '—', live && live.feed ? esc(live.feed.feed || '') : 'engine not running')}
    </div>`;

    // ---- open positions ----
    const posCard = card('Open positions', opn.length ? tbl([['Symbol'], ['Side'], ['Qty', 'right'], ['Strategy'], ['Mode'], ['Entry', 'right'], ['Move', 'right']],
      opn.map(p => `<tr><td>${esc(p.symbol)}</td><td>${esc(p.side)}</td><td style="text-align:right">${p.qty}</td><td>${esc(p.strategy)}</td><td>${p.mode === 'shadow' ? '<span style="color:var(--ink-faint)">shadow</span>' : 'live'}</td><td style="text-align:right">$${(+p.entry).toFixed(2)}</td><td style="text-align:right">${bps(p.moveBps)}</td></tr>`))
      : empty(live ? 'Flat - no open positions (the book is always flat by 1555 ET).' : 'None - the engine isn\'t running right now.'));

    // ---- the ledger: every closed trade, filterable ----
    const strategies = [...new Set(trades.map(t => t.strategy))].sort();
    const shown = trades.filter(t => (_qState.mode === 'all' || t.mode === _qState.mode) && (_qState.strat === 'all' || t.strategy === _qState.strat));
    const chip = (grp, val, label) => `<button class="quant-chip" data-grp="${grp}" data-val="${val}" style="font-family:var(--mono);font-size:10px;padding:4px 10px;margin:0 6px 6px 0;border:1px solid var(--rule);border-radius:12px;cursor:pointer;background:${_qState[grp] === val ? 'var(--amber)' : 'transparent'};color:${_qState[grp] === val ? '#000' : 'var(--ink-dim)'}">${label}</button>`;
    const ledgerCard = card(`Ledger · ${trades.length} trade${trades.length === 1 ? '' : 's'}`, trades.length
      ? `<div>${chip('mode', 'all', 'All')}${chip('mode', 'live', 'Live')}${chip('mode', 'shadow', 'Shadow')}<span style="display:inline-block;width:10px"></span>${chip('strat', 'all', 'Every strategy')}${strategies.map(x => chip('strat', x, esc(x))).join('')}</div>
         ${tbl([['Closed (ET)'], ['Strategy'], ['Mode'], ['Trade'], ['Entry', 'right'], ['Exit', 'right'], ['Held', 'right'], ['Net', 'right'], ['$', 'right'], ['Why out']],
           shown.slice(0, 200).map(t => `<tr><td>${esc(etTime(t.exit_ts))}</td><td>${esc(t.strategy)}</td><td>${t.mode === 'shadow' ? '<span style="color:var(--ink-faint)">shadow</span>' : esc(t.mode)}</td><td>${esc(t.side)} ${t.qty} ${esc(t.symbol)}</td><td style="text-align:right">$${(+t.entry_px).toFixed(2)}</td><td style="text-align:right">$${(+t.exit_px).toFixed(2)}</td><td style="text-align:right">${Math.round((t.hold_sec || 0) / 60)} min</td><td style="text-align:right">${bps(t.net_bps)}</td><td style="text-align:right">${usd(t.pnl)}</td><td style="color:var(--ink-faint)">${esc(t.reason_out)}</td></tr>`), 820)}`
      : empty('No quant trades yet. Every closed trade lands here - live (Alpaca paper fills) and shadow (simulated, for strategies the gate hasn\'t passed) - with its entry and exit, hold time, net bps after costs, dollars and why it closed.'),
      tradeSrc ? `source: ${tradeSrc}${shown.length > 200 ? ' · showing the latest 200' : ''}` : '');

    // ---- statistics per strategy ----
    const statsCard = card('Statistics · live and shadow, per strategy', summ ? `<div style="font-family:var(--mono);font-size:11px;margin:0 0 6px">${L.n ? `Live: ${L.n.toLocaleString('en-US')} trades · win ${pct(L.winRate)} · ${L.pBeatsBenchmark != null && L.pBeatsBenchmark < 0.05 ? `<span style="color:var(--pos)">beats ${pct2(bench)}</span>` : `not yet shown to beat ${pct2(bench)}`}${L.pBeatsBenchmark != null ? ` (p = ${L.pBeatsBenchmark})` : ''}` : 'No live trades yet.'}</div>
      ${tbl([['Book'], ['Trades', 'right'], ['Win', 'right'], ['95 % CI', 'right'], ['Expectancy', 'right'], ['Profit factor', 'right'], ['t', 'right'], ['Gate']],
        [row('All live', L, ''), row('All shadow', S, '')].concat(Object.entries(summ.byStrategy || {}).map(([k, v]) => row(k + ' · live', v.live, g[k] ? (g[k].pass ? '<span style="color:var(--pos)">live</span>' : 'shadow') : '—') + row(k + ' · shadow', v.shadow, ''))), 600)}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">expectancy = average net result per trade after the spread, slippage and fees · a win rate alone can mislead · ~4,300 trades show 52 % beats 50.75 %; ~375 show 55 %</div>`
      : empty('Statistics appear after the first session: win rate with its 95 % interval, a test against Medallion\'s 50.75 %, expectancy in bps net of costs, profit factor and t - live and shadow, for each strategy.'));

    // ---- the gate (backtest) ----
    const gs = (bt && bt.strategies) || g;
    const gateCard = card('Quality gate · nightly backtest', Object.keys(gs).length
      ? `${tbl([['Strategy'], ['Status'], ['Trades', 'right'], ['Win', 'right'], ['Expectancy', 'right'], ['t', 'right']],
          Object.entries(gs).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.pass ? '<span style="color:var(--pos)">LIVE</span>' : 'shadow'}</td><td style="text-align:right">${v.n == null ? '—' : v.n}</td><td style="text-align:right">${pct(v.winRate)}</td><td style="text-align:right">${bps(v.expectancyBps)}</td><td style="text-align:right">${v.tStat == null ? '—' : (+v.tStat).toFixed(2)}</td></tr>`), 480)}
         <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:6px">${bt && bt.days ? `replayed ${bt.days.length} sessions (${esc(bt.days[0])} … ${esc(bt.days[bt.days.length - 1])}) of real 1-minute bars · ` : ''}live needs ≥ ${((gate && gate.rules) || {}).minTrades || 200} trades, expectancy ≥ ${((gate && gate.rules) || {}).minExpectancyBps || 0.5} bps after costs, t ≥ ${((gate && gate.rules) || {}).minTStat || 2}</div>`
      : empty('No backtest yet. Each night the last 10 sessions of real 1-minute bars run through the same engine; a strategy trades live (Alpaca paper) only with ≥ 200 trades, expectancy ≥ 0.5 bps after costs and t ≥ 2 - until then it trades in shadow.'));

    // ---- daily P&L ----
    const days = Object.entries((summ && summ.byDay) || {}).sort((a, b) => b[0].localeCompare(a[0]));
    const dayCard = days.length ? card('By day · live', tbl([['Day'], ['Trades', 'right'], ['P&L', 'right'], ['Win', 'right'], ['Expectancy', 'right']],
      days.map(([d, v]) => `<tr><td>${esc(d)}</td><td style="text-align:right">${v.n}</td><td style="text-align:right">${usd(v.pnl)}</td><td style="text-align:right">${pct(v.winRate)}</td><td style="text-align:right">${bps(v.expectancyBps)}</td></tr>`), 420)) : '';

    // ---- what it trades and the rules ----
    const rulesCard = card('Strategies & risk', `${tbl([['Strategy'], ['Family'], ['Looks for'], ['Holds']], Object.entries(STRATS).map(([k, v]) => `<tr><td>${k}</td><td>${v[0]}</td><td style="white-space:normal;min-width:240px">${v[1]}</td><td>${v[2]}</td></tr>`), 640)}
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);line-height:1.7;margin-top:8px">$100,000 paper book, separate from the swing bot · 0.15 % of capital lost at a stop · ≤ 5 % per position, ≤ 25 positions, ≤ 150 % gross · entries 0940–1540 ET, flat at 1555 ET · no new entries after −1.5 % on the day · spread ≤ 8 bps, price ≥ $5, data ≤ 30 s old · market orders on the Alpaca paper account (real fills against real quotes)</div>`);

    host.innerHTML = `<div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim);margin:0 0 10px">QUANT BOOK · INTRADAY &amp; SHORT HORIZON · TRAPP2-QUANT</div>
      ${tiles}${statusCard}${posCard}${ledgerCard}${statsCard}${gateCard}${dayCard}${rulesCard}`;
    host.querySelectorAll('.quant-chip').forEach(b => b.addEventListener('click', () => { _qState[b.dataset.grp] = b.dataset.val; renderDashboard(host); }));
  }

  // refresh: the card on the Bets portfolio view, the dashboard on the Quant view - only while Bets is the open tab
  setInterval(() => {
    const panel = document.querySelector('.tab-panel[data-panel="bets"]');
    if (!panel || !(panel.classList.contains('active') || panel.offsetParent)) return;
    if (typeof _betsView !== 'undefined' && _betsView === 'quant') { const h = document.getElementById('quant-dashboard'); if (h) renderDashboard(h); }
    else render();
  }, 60000);
  window.QuantDesk = { render, renderDashboard };
})();
