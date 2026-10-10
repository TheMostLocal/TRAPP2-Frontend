/* ==========================================================================
   charts.js — real price-history charts for composite books (z89).

   GoodGlobe Index: rebuilt from each member's actual daily closes (repo history
   files) instead of once-a-day snapshots taken only when the app was open
   (which produced flat lines and jumps). Equal-weighted, S&P-style:
     * the index starts at $20.00 on its inception date (first member added)
     * each day's return = average of every live member's own daily return
       (shorts count inverse); a member joins at the index level on the day it
       was added and contributes from the next close; a removed member stops
       contributing on its removal date (its past stays baked in)
     * 1D = today's intraday tape (15-min snapshots in data/intraday/) vs each
       member's previous close
   Range bar: 1D 1W 1M 3M YTD 1Y ALL; daily / weekly / monthly points for 3M+.
   Scrub (mouse or finger) reads out the date/time, index price and change.

   The same drawing + data helpers are reused for the bot equity and portfolio
   value charts (WIP).
   ========================================================================== */
(function () {
  'use strict';
  const BOOKS = ['TRAPP2', 'TRAPP2-2', 'TRAPP2-3', 'TRAPP2-1'];
  const raw = () => { try { if (typeof GH_RAW !== 'undefined') return GH_RAW; } catch (e) {} return 'https://raw.githubusercontent.com/TheMostLocal'; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BASE_VALUE = 20;

  // ---------------- data ----------------
  const _daily = {}, _book = {}, _tape = {};
  async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function fetchDaily(t) {
    t = String(t || '').toUpperCase();
    if (_daily[t]) return _daily[t];
    for (const b of BOOKS) {
      try {
        const rows = await getJSON(`${raw()}/${b}/main/data/history/${encodeURIComponent(t)}.json`);
        if (Array.isArray(rows) && rows.length) {
          const out = [];
          for (const x of rows) {
            const d = String(x.date || '').slice(0, 10), c = +(x.close != null ? x.close : x.price);
            if (/^\d{4}-\d{2}-\d{2}$/.test(d) && isFinite(c) && c > 0 && (!out.length || out[out.length - 1].d < d)) out.push({ d, c });
          }
          if (out.length) { _daily[t] = out; _book[t] = b; return out; }
        }
      } catch (e) {}
    }
    _daily[t] = [];
    return _daily[t];
  }
  async function fetchTapeDay(book, date) {
    const k = book + '|' + date;
    if (k in _tape) return _tape[k];
    try { _tape[k] = await getJSON(`${raw()}/${book}/main/data/intraday/${date}.json`); } catch (e) { _tape[k] = null; }
    return _tape[k];
  }

  // ---------------- index math ----------------
  const day = iso => String(iso || '').slice(0, 10);
  function members() {
    let entries = [];
    try { entries = (typeof getGoodGlobeIndexEntries === 'function') ? getGoodGlobeIndexEntries() : []; } catch (e) {}
    const isMember = e => e.removedFromIndex || (e.flags || []).some(f => ['Tracking', 'Trading', 'Long', 'Short'].includes(f));
    return entries.filter(isMember).map(e => ({
      ticker: e.ticker, join: day(e.firstFlaggedAt), exit: e.removedFromIndex ? (day(e.removedAt) || null) : null,
      dir: (typeof _memberDirection === 'function') ? _memberDirection(e) : 1,
    })).filter(m => m.join);
  }
  // Daily level series from inception. -> {points:[{t:'YYYY-MM-DD', v}], members, inception}
  async function indexDaily() {
    const ms = members();
    if (!ms.length) return { points: [], members: [] };
    await Promise.all(ms.map(m => fetchDaily(m.ticker)));
    const inception = ms.reduce((a, m) => (a && a < m.join ? a : m.join), null);
    const dates = new Set();
    for (const m of ms) for (const b of _daily[m.ticker]) if (b.d >= inception) dates.add(b.d);
    const cal = [...dates].sort();
    const idx = {};   // ticker -> {map, last}
    for (const m of ms) {
      const h = _daily[m.ticker];
      const map = new Map(h.map(b => [b.d, b.c]));
      // close at (or last before) the join date = the member's starting mark
      let last = null;
      for (const b of h) { if (b.d <= m.join) last = b.c; else break; }
      idx[m.ticker] = { map, last };
    }
    let level = BASE_VALUE;
    const points = [{ t: inception, v: level }];
    for (const d of cal) {
      if (d <= inception) continue;
      let sum = 0, n = 0;
      for (const m of ms) {
        const st = idx[m.ticker];
        if (!(m.join < d) || (m.exit && d > m.exit)) {
          if (m.join >= d && st.map.has(d)) st.last = st.map.get(d);   // not yet a member: keep its mark current
          continue;
        }
        const c = st.map.get(d);
        if (st.last == null) { if (c != null) st.last = c; continue; }   // no history before joining
        n++;
        if (c != null) { sum += m.dir * (c / st.last - 1); st.last = c; }
      }
      if (n) level *= 1 + sum / n;
      points.push({ t: d, v: +level.toFixed(4) });
    }
    return { points, members: ms, inception };
  }
  // Intraday (1D) for the latest tape day. Level path = previous-close level x
  // (1 + equal-weighted move of every live member vs ITS previous close).
  async function indexIntraday(daily) {
    const ms = members().filter(m => !m.exit);
    if (!ms.length || !daily.points.length) return null;
    await Promise.all(ms.map(m => fetchDaily(m.ticker)));
    // latest tape date available for any member's book (look back 7 days)
    let tapeDate = null;
    const books = [...new Set(ms.map(m => _book[m.ticker]).filter(Boolean))];
    for (let back = 0; back < 8 && !tapeDate; back++) {
      const dt = new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
      for (const b of books) { const tp = await fetchTapeDay(b, dt); if (tp && tp.snapshots && tp.snapshots.length) { tapeDate = dt; break; } }
    }
    if (!tapeDate) return null;
    const prevPts = daily.points.filter(p => p.t < tapeDate);
    const L0 = prevPts.length ? prevPts[prevPts.length - 1].v : BASE_VALUE;
    const prevClose = {};
    for (const m of ms) { const h = _daily[m.ticker] || []; for (const b of h) { if (b.d < tapeDate) prevClose[m.ticker] = b.c; else break; } }
    const series = [];
    const times = new Set();
    const perBook = {};
    for (const b of books) { const tp = await fetchTapeDay(b, tapeDate); perBook[b] = (tp && tp.snapshots) || []; perBook[b].forEach(s => times.add(s.t)); }
    const last = {};
    for (const t of [...times].sort()) {
      for (const b of books) for (const s of perBook[b]) if (s.t === t) for (const m of ms) if (_book[m.ticker] === b && s.p && s.p[m.ticker] != null) last[m.ticker] = +s.p[m.ticker];
      let sum = 0, n = 0;
      for (const m of ms) { const pc = prevClose[m.ticker], px = last[m.ticker]; if (pc && px) { sum += m.dir * (px / pc - 1); n++; } }
      if (n) series.push({ t, v: +(L0 * (1 + sum / n)).toFixed(4) });
    }
    return series.length ? { points: [{ t: tapeDate + 'T13:30:00Z', v: L0 }, ...series], date: tapeDate, base: L0 } : null;
  }

  // ---------------- windows & resampling ----------------
  const RANGES = [['1D', null], ['1W', 7], ['1M', 31], ['3M', 92], ['YTD', 'ytd'], ['1Y', 366], ['ALL', 'all']];
  function windowed(points, r) {
    if (!points.length) return points;
    const lastT = new Date(points[points.length - 1].t);
    let from;
    if (r === 'all') return points;
    if (r === 'ytd') from = `${lastT.getUTCFullYear()}-01-01`;
    else from = new Date(lastT.getTime() - r * 864e5).toISOString().slice(0, 10);
    const i = points.findIndex(p => p.t >= from);
    const s = Math.max(0, i - 1);          // include the close before the window as its base
    return points.slice(s);
  }
  function resample(points, mode) {
    if (mode === 'D' || points.length < 3) return points;
    const key = p => { const d = new Date(p.t + 'T00:00:00Z');
      if (mode === 'M') return p.t.slice(0, 7);
      const y = d.getUTCFullYear(), onejan = Date.UTC(y, 0, 1); return y + '-W' + Math.floor(((d - onejan) / 864e5 + new Date(onejan).getUTCDay()) / 7); };
    const out = [];
    for (const p of points) { const k = key(p); if (out.length && out[out.length - 1]._k === k) out[out.length - 1] = { ...p, _k: k }; else out.push({ ...p, _k: k }); }
    if (out[0].t !== points[0].t) out.unshift({ ...points[0], _k: '' });
    return out;
  }

  // ---------------- drawing ----------------
  const fmtMoney = v => '$' + (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2));
  function drawStockChart(host, points, opts = {}) {
    // Draw at the host's real pixel width (no viewBox stretching), so text and
    // line weights stay true on a phone and on desktop.
    const W = Math.max(280, Math.round(host.clientWidth || (host.parentElement && host.parentElement.clientWidth) || 600));
    const H = opts.height || 190, padR = 56, padB = 18, padT = 8;
    if (!points || points.length < 2) { host.innerHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:24px 0;text-align:center">${esc(opts.empty || 'Not enough history yet')}</div>`; return; }
    const vals = points.map(p => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.01 || 1; lo -= pad; hi += pad;
    const X = i => (i / (points.length - 1)) * (W - padR);
    const Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
    const up = points[points.length - 1].v >= points[0].v;
    const col = up ? 'var(--pos,#5b8a72)' : 'var(--neg,#c25a4a)';
    const gid = 'vc' + Math.random().toString(36).slice(2, 7);
    const line = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.v).toFixed(1)).join('');
    const grid = [0, 1, 2, 3].map(k => { const v = lo + (hi - lo) * (k + 0.5) / 4, y = Y(v);
      return `<line x1="0" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--rule,#2d2d33)" stroke-width="0.6" vector-effect="non-scaling-stroke"/>` +
             `<text x="${W - padR + 6}" y="${y + 3.5}" font-size="10" fill="var(--ink-faint,#6e6a5f)" font-family="var(--mono,monospace)">${opts.money === false ? v.toFixed(2) : fmtMoney(v)}</text>`; }).join('');
    const intraday = String(points[0].t).includes('T');
    const lab = t => intraday ? new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                              : new Date(t + 'T12:00:00Z').toLocaleDateString(undefined, points.length > 300 ? { year: '2-digit', month: 'short' } : { month: 'short', day: 'numeric' });
    const xi = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    const xt = xi.map((i, k) => ({ i, k: i === 0 ? 0 : i === points.length - 1 ? 2 : 1 })).map(({ i, k }) =>
      `<text x="${X(i)}" y="${H - 4}" font-size="10" fill="var(--ink-faint,#6e6a5f)" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}" font-family="var(--mono,monospace)">${esc(lab(points[i].t))}</text>`).join('');
    host.innerHTML = `<div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto;display:block;overflow:visible" role="img" aria-label="${esc(opts.label || 'chart')}">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.25"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        <path d="${line} L${X(points.length - 1)},${H - padB} L0,${H - padB} Z" fill="url(#${gid})"/>
        <path d="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        <line class="vc-x" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="var(--ink-dim,#b8b1a4)" stroke-dasharray="3,3" vector-effect="non-scaling-stroke" opacity="0"/>
        <circle class="vc-dot" r="3.5" fill="${col}" opacity="0"/>
        ${xt}
      </svg>
      <div class="vc-hit" style="position:absolute;left:0;top:0;bottom:${padB}px;right:${(padR / W) * 100}%;cursor:crosshair;touch-action:pan-y"></div>
    </div>`;
    const hit = host.querySelector('.vc-hit'), xl = host.querySelector('.vc-x'), dot = host.querySelector('.vc-dot');
    const move = cx => {
      const r = hit.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (cx - r.left) / r.width));
      const i = Math.round(f * (points.length - 1)), p = points[i];
      xl.setAttribute('x1', X(i)); xl.setAttribute('x2', X(i)); xl.setAttribute('opacity', '0.7');
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.v)); dot.setAttribute('opacity', '1');
      opts.onScrub && opts.onScrub(p, points[0], intraday ? new Date(p.t).toLocaleString() : p.t);
    };
    const reset = () => { xl.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); opts.onReset && opts.onReset(); };
    hit.addEventListener('mousemove', e => move(e.clientX));
    hit.addEventListener('mouseleave', reset);
    hit.addEventListener('touchstart', e => e.touches[0] && move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchmove', e => e.touches[0] && move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchend', reset);
  }

  // ---------------- GoodGlobe mount ----------------
  const GG = { range: '1Y', interval: 'D', daily: null, intraday: undefined, builtAt: 0 };
  async function mountGoodGlobeChart() {
    const host = document.getElementById('gg-hist-mount');
    if (!host) return;
    host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0;text-align:center">Building the index from member price history…</div>';
    if (!GG.daily || Date.now() - GG.builtAt > 10 * 60 * 1000) {
      GG.daily = await indexDaily(); GG.intraday = undefined; GG.builtAt = Date.now();
    }
    render();
  }
  async function render() {
    const host = document.getElementById('gg-hist-mount');
    if (!host || !GG.daily) return;
    const priceEl = document.getElementById('gg-price-readout'), pctEl = document.getElementById('gg-pct-readout'), subEl = document.getElementById('gg-sub-readout');
    const all = GG.daily.points;
    let pts, label;
    if (GG.range === '1D') {
      if (GG.intraday === undefined) GG.intraday = await indexIntraday(GG.daily);
      pts = GG.intraday ? GG.intraday.points : [];
      label = GG.intraday ? `${GG.intraday.date} · intraday (15-min tape)` : 'no intraday tape for the latest session';
    } else {
      const r = RANGES.find(x => x[0] === GG.range)[1];
      pts = windowed(all, r);
      if (['3M', 'YTD', '1Y', 'ALL'].includes(GG.range)) pts = resample(pts, GG.interval);
      label = GG.range === 'ALL' ? `since inception (${GG.daily.inception}, $${BASE_VALUE.toFixed(2)})` : GG.range;
    }
    const bar = RANGES.map(([k]) => `<button class="seg-btn ${GG.range === k ? 'active' : ''}" data-vcr="${k}" style="font-size:10px">${k}</button>`).join('');
    const ivl = ['3M', 'YTD', '1Y', 'ALL'].includes(GG.range)
      ? `<span class="seg-control" style="font-size:10px;margin-left:6px">${['D', 'W', 'M'].map(k => `<button class="seg-btn ${GG.interval === k ? 'active' : ''}" data-vci="${k}" style="font-size:10px">${k}</button>`).join('')}</span>` : '';
    host.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 4px"><span class="seg-control" style="font-size:10px">${bar}</span>${ivl}</div><div class="vc-chart"></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">${GG.daily.members.length} member${GG.daily.members.length === 1 ? '' : 's'} · built from each member's daily closes · equal-weighted, shorts inverse · starts at $${BASE_VALUE.toFixed(2)} on ${esc(GG.daily.inception || '—')}</div>`;
    const setHeader = (p, base, sub) => {
      if (!p || !base) return;
      const ch = (p.v / base.v - 1) * 100, c = ch >= 0 ? 'var(--pos)' : 'var(--neg)';
      if (priceEl) { priceEl.textContent = '$' + p.v.toFixed(2); priceEl.style.color = c; }
      if (pctEl) { pctEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'; pctEl.style.color = c; }
      if (subEl) subEl.textContent = sub;
    };
    const resetHeader = () => pts.length ? setHeader(pts[pts.length - 1], pts[0], label + ' · scrub the chart') : null;
    drawStockChart(host.querySelector('.vc-chart'), pts, { label: 'GoodGlobe Index', empty: label,
      onScrub: (p, base, when) => setHeader(p, base, when), onReset: resetHeader });
    resetHeader();
    host.querySelectorAll('[data-vcr]').forEach(b => b.onclick = () => { GG.range = b.dataset.vcr; render(); });
    host.querySelectorAll('[data-vci]').forEach(b => b.onclick = () => { GG.interval = b.dataset.vci; render(); });
  }

  // ---------------- mini charts (Global Trade logistics cards) ----------------
  // <div class="vc-spark" data-tk="BDRY" data-days="92"> -> a small line chart of
  // the last N days of closes with first / last labels and the period change.
  async function mountSparks(root) {
    const els = [...(root || document).querySelectorAll('.vc-spark[data-tk]')];
    await Promise.all(els.map(async el => {
      const t = el.dataset.tk, days = +el.dataset.days || 92;
      const h = await fetchDaily(t);
      if (!el.isConnected) return;
      if (!h || h.length < 5) { el.innerHTML = '<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">no price history</div>'; return; }
      const cut = new Date(new Date(h[h.length - 1].d + 'T00:00:00Z').getTime() - days * 864e5).toISOString().slice(0, 10);
      const pts = h.filter(b => b.d >= cut);
      const W = Math.max(160, Math.round(el.clientWidth || 260)), H = 44;
      const vals = pts.map(b => b.c), lo = Math.min(...vals), hi = Math.max(...vals), rng = (hi - lo) || hi * 0.01 || 1;
      const X = i => (i / (pts.length - 1)) * W, Y = v => 3 + (hi - v) / rng * (H - 6);
      const up = vals[vals.length - 1] >= vals[0], col = up ? 'var(--pos,#5b8a72)' : 'var(--neg,#c25a4a)';
      const ch = (vals[vals.length - 1] / vals[0] - 1) * 100;
      const line = pts.map((b, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(b.c).toFixed(1)).join('');
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${esc(t)} 3-month price">
          <path d="${line} L${W},${H} L0,${H} Z" fill="${col}" opacity="0.10"/>
          <path d="${line}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/></svg>
        <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px">
          <span>${esc(pts[0].d)}</span><span style="color:${col}">${ch >= 0 ? '+' : ''}${ch.toFixed(1)}% · ${days > 80 ? '3M' : days + 'd'}</span><span>${esc(pts[pts.length - 1].d)}</span></div>`;
    }));
  }

  window.VChart = { fetchDaily, fetchTapeDay, drawStockChart, windowed, resample, indexDaily, indexIntraday, mountGoodGlobeChart, mountSparks, _gg: GG };
})();
