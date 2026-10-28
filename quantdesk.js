/* ==========================================================================
   quantdesk.js — z163. The quant book on the Bets page: today (open positions, P&L, trades, feed health from
   Supabase · Bot project · quant_state) and the record (TRAPP2-QUANT data/quant/summary.json + gate.json):
   win rate with its 95 % interval against Medallion's 50.75 %, expectancy in bps net of costs, profit factor,
   t-stat — live and shadow, per strategy, and which strategies the quality gate has let trade live.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
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
    let host = document.getElementById('quant-desk');
    if (!host) {
      host = document.createElement('section');
      host.id = 'quant-desk';
      host.className = 'company-card';
      host.style.margin = '12px 0';
      const head = panel.querySelector('.news-header');
      if (head && head.nextSibling) head.parentNode.insertBefore(host, head.nextSibling); else panel.prepend(host);
    }
    const [summ, gate, st] = await Promise.all([gh('data/quant/summary.json'), gh('data/quant/gate.json'), sb('/rest/v1/quant_state?id=eq.live&select=doc,updated_at')]);
    const live = st && st[0] && st[0].doc;
    if (!summ && !live) { host.innerHTML = `<h4>Quant book · intraday</h4><div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim)">Waiting for the first session of TRAPP2-QUANT (engine 0920 ET; the nightly backtest decides which strategies trade live).</div>`; return; }
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
  setInterval(() => { if (document.querySelector('.tab-btn[data-tab="bets"].active')) render(); }, 60000);
  window.QuantDesk = { render };
})();
