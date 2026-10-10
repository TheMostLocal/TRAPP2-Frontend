/* ==========================================================================
   options.js — Options finder + on-demand coverage (z90). Loaded after app.js.

   Valuation → Options gets a "FIND A CONTRACT" panel: enter a target price and a
   date, and every call (target above spot) or put (target below) in the chain
   is valued AT THAT DATE IF THE STOCK IS AT THE TARGET (Black-Scholes with the
   contract's own IV and its remaining time), against what it costs now (ask):
       value at target, return, breakeven at expiry, and the market-implied odds
       of finishing past breakeven (lognormal with the contract's IV).
   Ranked by return. Everything is computed in the browser from the chain file.

   No chain for a ticker? "Request options" dispatches the TRAPP2-OPTIONS
   workflow for it (needs a GitHub token with Actions: write on that repo); the
   chain appears a few minutes later and the ticker stays covered.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const N = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  function bs(type, S, K, T, r, v) {
    if (T <= 0 || !(v > 0)) return Math.max(0, type === 'call' ? S - K : K - S);
    const d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)), d2 = d1 - v * Math.sqrt(T);
    return type === 'call' ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
  }
  // P(S_T beyond level) under lognormal with vol v (risk-neutral drift r)
  const pBeyond = (S, L, T, r, v, above) => {
    if (!(T > 0) || !(v > 0)) return above ? (S > L ? 1 : 0) : (S < L ? 1 : 0);
    const d2 = (Math.log(S / L) + (r - v * v / 2) * T) / (v * Math.sqrt(T));
    return above ? N(d2) : N(-d2);
  };
  const yrs = (a, b) => Math.max(0, (Date.parse(b + 'T21:00:00Z') - Date.parse(a + 'T21:00:00Z')) / (365 * 864e5));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const money = v => (v == null || !isFinite(v)) ? '—' : '$' + (+v).toFixed(2);
  const pct = v => (v == null || !isFinite(v)) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;

  function findContracts(data, target, date) {
    const S = +data.spot, r = +data.riskFreeRate || 0.04, now = todayISO();
    const side = target >= S ? 'calls' : 'puts', type = side === 'calls' ? 'call' : 'put';
    const exps = (data.expiries || []).filter(e => e.expiry >= date);
    const use = (exps.length ? exps : (data.expiries || []).slice(-1)).slice(0, 3);
    const out = [];
    for (const e of use) {
      const Trem = yrs(date, e.expiry), Tnow = yrs(now, e.expiry);
      for (const c of (e[side] || [])) {
        const cost = (+c.ask > 0) ? +c.ask : ((+c.mid > 0) ? +c.mid : +c.last);
        if (!(cost > 0.01) || !(+c.iv > 0)) continue;
        const val = bs(type, target, +c.strike, Trem, r, +c.iv);
        const be = type === 'call' ? +c.strike + cost : +c.strike - cost;
        out.push({ expiry: e.expiry, strike: +c.strike, type, cost, val, ret: val / cost - 1, be,
                   pBe: pBeyond(S, be, Tnow, r, +c.iv, type === 'call'), oi: +c.openInterest || 0, iv: +c.iv });
      }
    }
    out.sort((a, b) => b.ret - a.ret);
    // odds the stock is past the target by the date (nearest-to-ATM IV)
    const near = (data.expiries || [])[0];
    const atm = near ? [...(near.calls || []), ...(near.puts || [])].sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0] : null;
    const pTarget = atm ? pBeyond(S, target, yrs(now, date), r, +atm.iv, target >= S) : null;
    return { list: out.slice(0, 8), side, pTarget, S };
  }

  function finderHtml(tk, data) {
    const S = +data.spot;
    const d0 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    return `<div class="company-card" id="opt-finder" style="margin:0 0 12px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim);margin-bottom:8px">FIND A CONTRACT · TARGET PRICE &amp; DATE</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-family:var(--mono);font-size:11px">
        <label>Target $ <input id="opt-f-px" inputmode="decimal" value="${(S * 1.1).toFixed(2)}" style="width:90px;background:var(--bg-elev);border:1px solid var(--rule);color:var(--ink);padding:5px 6px;border-radius:4px;font-family:var(--mono)"></label>
        <label>by <input id="opt-f-date" type="date" value="${d0}" style="background:var(--bg-elev);border:1px solid var(--rule);color:var(--ink);padding:4px 6px;border-radius:4px;font-family:var(--mono)"></label>
        <button class="btn" id="opt-f-go" style="padding:5px 12px;font-size:10px">Find</button>
        <span style="color:var(--ink-faint)">spot ${money(S)}</span>
      </div>
      <div id="opt-f-out" style="margin-top:10px"></div>
    </div>`;
  }
  function renderFinder(tk, data) {
    const out = $('#opt-f-out'); if (!out) return;
    const target = parseFloat(($('#opt-f-px').value || '').replace(/[$,]/g, ''));
    const date = $('#opt-f-date').value;
    if (!(target > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { out.innerHTML = '<div style="color:var(--ink-faint);font-family:var(--mono);font-size:10px">Enter a target price and date.</div>'; return; }
    const r = findContracts(data, target, date);
    if (!r.list.length) { out.innerHTML = '<div style="color:var(--ink-faint);font-family:var(--mono);font-size:10px">No priced contracts on that side of the chain.</div>'; return; }
    const head = `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-bottom:6px">${esc(tk)} ${target >= r.S ? '▲' : '▼'} to ${money(target)} (${pct(target / r.S - 1)}) by ${esc(date)} → best ${r.side}, valued at that date if ${esc(tk)} is there.
      ${r.pTarget != null ? `Options market odds of ${esc(tk)} being past ${money(target)} by then: <strong style="color:var(--ink)">${(r.pTarget * 100).toFixed(0)}%</strong>.` : ''}</div>`;
    out.innerHTML = head + `<div style="overflow-x:auto"><table class="sb-table" style="font-size:11px;min-width:max-content"><thead><tr>
      <th>contract</th><th>cost now</th><th>value at target</th><th>return</th><th>breakeven</th><th>P(past BE)</th><th>OI</th></tr></thead><tbody>` +
      r.list.map(c => `<tr><td>${esc(c.expiry)} ${c.strike} ${c.type === 'call' ? 'C' : 'P'}</td><td>${money(c.cost)}</td><td>${money(c.val)}</td>
        <td style="color:${c.ret >= 0 ? 'var(--pos)' : 'var(--neg)'}">${pct(c.ret)}</td><td>${money(c.be)}</td><td>${(c.pBe * 100).toFixed(0)}%</td><td>${c.oi}</td></tr>`).join('') +
      `</tbody></table></div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px">Value at target = Black-Scholes with each contract's IV and its time left after your date; cost = current ask. Odds are market-implied (lognormal), not a forecast. Per share — x100 per contract. Paper research, not advice.</div>`;
  }

  async function requestCoverage(tk, btn) {
    const token = localStorage.getItem('valuatio.github.token');
    const msg = $('#opt-req-msg');
    if (!token) { if (msg) msg.textContent = 'Needs a GitHub token (Home → Connections) with Actions: write on TRAPP2-OPTIONS.'; return; }
    btn.disabled = true;
    try {
      const api = (typeof GH_API_REPOS !== 'undefined' ? GH_API_REPOS : 'https://api.github.com/repos/TheMostLocal') + '/TRAPP2-OPTIONS/actions/workflows/options.yml/dispatches';
      const r = await fetch(api, { method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
                                   body: JSON.stringify({ ref: 'main', inputs: { tickers: tk } }) });
      if (r.status === 204) { if (msg) msg.textContent = `Requested — ${tk}'s chain should appear in about 3–6 minutes and stays covered from now on.`; }
      else if (r.status === 404) { if (msg) msg.textContent = 'TRAPP2-OPTIONS repo or workflow not found (create the repo first — see STATUS) or the token can\'t see it.'; btn.disabled = false; }
      else if (r.status === 403) { if (msg) msg.textContent = 'Token lacks Actions: write on TRAPP2-OPTIONS.'; btn.disabled = false; }
      else { if (msg) msg.textContent = 'Request failed: HTTP ' + r.status; btn.disabled = false; }
    } catch (e) { if (msg) msg.textContent = 'Request failed: ' + e.message; btn.disabled = false; }
  }

  // Wrap the app's Options renderer: after it draws, add the finder (or the
  // request button when there's no chain).
  function wrap() {
    if (typeof window.renderOptionsTab !== 'function' || window.renderOptionsTab._z90) return false;
    const orig = window.renderOptionsTab;
    const wrapped = async function (ticker) {
      const res = await orig.apply(this, arguments);
      try {
        const tk = String(ticker || '').toUpperCase();
        const body = document.getElementById('options-body');
        if (!body) return res;
        const data = (typeof loadOptionsForTicker === 'function') ? await loadOptionsForTicker(tk) : null;
        if (data && data.expiries && data.expiries.length) {
          if (!$('#opt-finder', body)) body.insertAdjacentHTML('afterbegin', finderHtml(tk, data));
          const go = () => renderFinder(tk, data);
          $('#opt-f-go').onclick = go; $('#opt-f-px').onkeydown = e => { if (e.key === 'Enter') go(); };
          go();
        } else if (!$('#opt-req', body)) {
          body.insertAdjacentHTML('beforeend', `<div class="company-card" id="opt-req" style="margin:12px 0 0;font-family:var(--mono);font-size:11px">
            <button class="btn" id="opt-req-btn" style="padding:5px 12px;font-size:10px">Request options for ${esc(tk)}</button>
            <div id="opt-req-msg" style="color:var(--ink-faint);font-size:10px;margin-top:6px">Adds ${esc(tk)} to TRAPP2-OPTIONS coverage and fetches its chain now.</div></div>`);
          $('#opt-req-btn').onclick = e => requestCoverage(tk, e.currentTarget);
        }
      } catch (e) { console.warn('[options] finder', e); }
      return res;
    };
    wrapped._z90 = true;
    window.renderOptionsTab = wrapped;
    return true;
  }
  if (!wrap()) document.addEventListener('DOMContentLoaded', wrap);
  window.OptionsFinder = { findContracts, bs, pBeyond };
})();
