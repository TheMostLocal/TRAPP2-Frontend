/* ==========================================================================
   optionshub.js — EVERY OPTIONS CHAIN IN ONE PLACE (z125). Load after app.js.

   Lists each ticker TRAPP2-OPTIONS keeps a chain for (manifest.json + summary.json)
   with its read: spot, ATM IV (30-day when known), expected move, IV rank, 25Δ
   skew, term slope, put/call open interest, max pain, quote quality, unusual
   prints and when the chain was last fetched. Tap a ticker for its full chain in
   Valuation → Options (Greeks, surfaces, Find a contract). A ticker that isn't
   covered can be requested (options.yml dispatch; token with Actions: write on
   TRAPP2-OPTIONS). Shown as Stock Book & Valuation → Options, and as the Stock
   Book's Options section (which listed OCC contract rows — the books hold none).
   Columns sort like the Stock Book: text A→Z first, numbers high→low first.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const API = () => (typeof GH_API_REPOS !== 'undefined' ? GH_API_REPOS : 'https://api.github.com/repos/TheMostLocal');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v == null || v === '' || !isFinite(+v)) ? null : +v;
  const S = { data: null, at: 0, sort: 'ticker', dir: 'asc', q: '' };
  const COLS = [
    ['ticker', 'Ticker', 'text'], ['spot', 'Spot', 'num'], ['iv', 'ATM IV', 'num'], ['move', 'Exp. move', 'num'],
    ['rank', 'IV rank', 'num'], ['skew', '25Δ skew', 'num'], ['slope', 'Term slope', 'num'], ['pcoi', 'Put/Call OI', 'num'],
    ['pain', 'Max pain', 'num'], ['quality', 'Quotes', 'num'], ['unusual', 'Unusual', 'num'], ['asOf', 'Updated', 'num'],
  ];

  async function load(force) {
    if (!force && S.data && Date.now() - S.at < 10 * 60 * 1000) return S.data;
    const base = RAW() + '/TRAPP2-OPTIONS/main/data/options/';
    const get = async f => { try { const r = await fetch(`${base}${f}?_v=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
    const [summ, man] = await Promise.all([get('summary.json'), get('manifest.json')]);
    const st = (summ && summ.tickers) || {};
    const all = new Set([...((man && man.tickers) || []), ...Object.keys(st)].map(t => String(t).toUpperCase()));
    const rows = [...all].map(t => {
      const s = st[t] || {};
      return { ticker: t, spot: num(s.spot), iv: num(s.atmIv30 != null ? s.atmIv30 : s.atmIv), ivBasis: s.atmIv30 != null ? `${s.dte30 || 30}-day` : (s.nearestExpiry ? `nearest (${s.nearestExpiry})` : ''),
               move: num(s.expectedMove30Pct != null ? s.expectedMove30Pct : s.expectedMovePct), rank: num(s.ivRank && s.ivRank.rank), rankN: s.ivRank ? s.ivRank.n : null,
               skew: num(s.skew25), slope: num(s.termSlope), pcoi: num(s.putCallOI), pain: num(s.maxPain), quality: num(s.quoteQualityPct),
               unusual: Array.isArray(s.unusual) ? s.unusual.length : null, expiries: num(s.expiries), asOf: s.asOf ? Date.parse(s.asOf) : null, hasRead: !!st[t] };
    });
    S.data = { rows, asOf: (summ && summ.asOf) || (man && man.asOf) || null, ok: !!(summ || man) };
    S.at = Date.now();
    return S.data;
  }

  const pct1 = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const pts = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`;
  const when = t => { if (!t) return '—'; const d = new Date(t); return isFinite(d) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'; };
  function cell(r, k) {
    switch (k) {
      case 'ticker': return `<a href="#" data-oh-open="${esc(r.ticker)}" style="color:var(--amber);font-weight:700;text-decoration:none;border-bottom:1px dotted var(--amber)">${esc(r.ticker)}</a>`;
      case 'spot': return r.spot == null ? '—' : '$' + r.spot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'iv': return r.iv == null ? '—' : `<span title="${esc(r.ivBasis)}">${pct1(r.iv)}</span>`;
      case 'move': return r.move == null ? '—' : '±' + r.move.toFixed(2) + '%';
      case 'rank': return r.rank != null ? r.rank.toFixed(0) : `<span style="color:var(--ink-faint)" title="IV rank needs 20 days of surface history">${r.rankN != null ? r.rankN + '/20 d' : '—'}</span>`;
      case 'skew': return `<span style="color:${r.skew == null ? 'inherit' : r.skew > 0.03 ? 'var(--neg)' : r.skew < 0 ? 'var(--pos)' : 'inherit'}">${pts(r.skew)}</span>`;
      case 'slope': return `<span style="color:${r.slope != null && r.slope < -0.01 ? 'var(--neg)' : 'inherit'}">${pts(r.slope)}</span>`;
      case 'pcoi': return r.pcoi == null ? '—' : r.pcoi.toFixed(2);
      case 'pain': return r.pain == null ? '—' : '$' + r.pain.toLocaleString();
      case 'quality': return r.quality == null ? '—' : r.quality.toFixed(0) + '%';
      case 'unusual': return r.unusual == null ? '—' : r.unusual ? `<span style="color:var(--amber)">${r.unusual}</span>` : '0';
      case 'asOf': return when(r.asOf);
    }
    return '—';
  }
  function sorted(rows) {
    const col = COLS.find(c => c[0] === S.sort) || COLS[0], isNum = col[2] === 'num';
    const tk = (a, b) => a.ticker.localeCompare(b.ticker, undefined, { numeric: true });
    return rows.slice().sort((a, b) => {
      const av = a[S.sort], bv = b[S.sort];
      if (av == null && bv == null) return tk(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = isNum ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
      return (S.dir === 'desc' ? -c : c) || tk(a, b);
    });
  }

  async function render(host, opts) {
    if (!host) return;
    opts = opts || {};
    if (!S.data) host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading every options chain…</div>';
    const d = await load(opts.force);
    if (!host.isConnected) return;
    const q = S.q.trim().toUpperCase();
    const rows = sorted(d.rows.filter(r => !q || r.ticker.includes(q)));
    const icon = k => S.sort !== k ? '<span class="sort-icon">↕</span>' : `<span class="sort-icon active">${S.dir === 'asc' ? '↑' : '↓'}</span>`;
    host.innerHTML = `<div class="company-card" style="margin:0 0 12px;font-family:var(--mono)">
        <div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center">
          <span style="font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">OPTIONS · ${d.rows.length} TICKER${d.rows.length === 1 ? '' : 'S'} WITH A CHAIN</span>
          <span style="font-size:10px;color:var(--ink-faint)">TRAPP2-OPTIONS · summary ${esc(when(d.asOf ? Date.parse(d.asOf) : null))}</span>
          <input id="oh-q" class="sb-search" placeholder="filter ticker" value="${esc(S.q)}" style="max-width:140px;font-size:11px;padding:4px 8px">
          <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
            <input id="oh-req" placeholder="add a ticker" style="width:100px;font-size:11px;padding:4px 8px;font-family:var(--mono)">
            <button id="oh-req-btn" class="btn btn-ghost" style="padding:3px 9px;font-size:10px">Request chain</button>
          </span>
        </div>
        <div id="oh-msg" style="font-size:10px;color:var(--ink-dim);margin-top:6px">${d.ok ? 'Tap a ticker for its full chain (Valuation → Options): Greeks, IV surface, Find a contract.' : '<span style="color:var(--red)">Couldn\'t reach TRAPP2-OPTIONS — check the connection and refresh.</span>'}</div>
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table class="sb-table" style="width:100%;min-width:760px">
        <thead><tr>${COLS.map(([k, l]) => `<th class="sortable" data-oh-sort="${k}" style="cursor:pointer;white-space:nowrap">${l}${icon(k)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${COLS.map(([k]) => `<td style="white-space:nowrap">${cell(r, k)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${COLS.length}" style="color:var(--ink-faint)">No ticker matches "${esc(S.q)}".</td></tr>`}</tbody>
      </table></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px;line-height:1.5">ATM IV: at-the-money implied volatility from mid prices on the parity forward (30-day expiry when available, else the nearest) · expected move: ±1 standard deviation to that expiry · IV rank: today's ATM IV within its own history (needs 20 days) · 25Δ skew: put wing − call wing (positive = downside demand) · term slope: 90-day − 30-day ATM IV (negative = inverted, near-term stress) · quotes: share of clean two-sided quotes · unusual: strikes trading ≥ 500 contracts and ≥ 2× open interest.</div>`;
    host.querySelectorAll('[data-oh-sort]').forEach(th => th.onclick = () => {
      const k = th.dataset.ohSort, isNum = (COLS.find(c => c[0] === k) || [])[2] === 'num';
      if (S.sort === k) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = k; S.dir = isNum ? 'desc' : 'asc'; }
      render(host, opts);
    });
    host.querySelectorAll('[data-oh-open]').forEach(a => a.onclick = e => { e.preventDefault(); openChain(a.dataset.ohOpen); });
    const qi = host.querySelector('#oh-q');
    if (qi) qi.oninput = () => { S.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { render(host, opts).then(() => { const n = host.querySelector('#oh-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 250); };
    const rb = host.querySelector('#oh-req-btn'), ri = host.querySelector('#oh-req');
    if (rb && ri) rb.onclick = () => request(ri.value, rb, host.querySelector('#oh-msg'));
  }

  async function openChain(t) {
    const tk = String(t || '').toUpperCase();
    if (!tk) return;
    const inp = document.getElementById('ticker');
    if (inp) inp.value = tk;
    if (typeof switchTab === 'function') switchTab('valuation');
    try { if (typeof loadValuation === 'function') await loadValuation(); } catch (e) {}
    const b = document.querySelector('.val-subtab[data-subtab="options"]');
    if (b) b.click();
  }

  async function request(raw, btn, msg) {
    const tk = String(raw || '').trim().toUpperCase();
    const say = m => { if (msg) msg.textContent = m; };
    if (!/^[A-Z0-9.\-^=]{1,15}$/.test(tk)) return say('Type a ticker to request (e.g. MSFT).');
    if (S.data && S.data.rows.some(r => r.ticker === tk)) return say(`${tk} already has a chain — tap it in the list.`);
    const token = localStorage.getItem('valuatio.github.token');
    if (!token) return say('Needs the GitHub token (Home → Connections) with Actions: write on TRAPP2-OPTIONS.');
    btn.disabled = true;
    try {
      const r = await fetch(`${API()}/TRAPP2-OPTIONS/actions/workflows/options.yml/dispatches`, { method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: 'main', inputs: { tickers: tk } }) });
      if (r.status === 204) say(`Requested ${tk} — its chain appears here in about 3–6 minutes and stays covered.`);
      else { say(r.status === 403 ? 'The token lacks Actions: write on TRAPP2-OPTIONS.' : `Request failed (HTTP ${r.status}).`); btn.disabled = false; }
    } catch (e) { say('Request failed: ' + e.message); btn.disabled = false; }
  }

  window.OptionsHub = { render, load, openChain, _state: S };
})();
