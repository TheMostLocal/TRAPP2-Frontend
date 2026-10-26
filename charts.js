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
   Range bar: 1D 1W 1M 3M YTD 1Y ALL. Interval points (z122): 1D = the day's
   15-min tape only; 1W = daily or weekly; 1M and longer = daily, weekly or
   monthly (a weekly / monthly point is that period's last close). The chosen
   interval is remembered and falls back to the coarsest one a range offers.
   Scrub (mouse or finger) reads out the date/time, index price and change.

   Account value (z122) uses the same chart, ranges, intervals and scrub header
   as the index — with deposits / withdrawals taken out: the % is time-weighted
   and the P/L is market P/L, both from the range's first point to the scrubbed one.

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
  // z136: the app shows Eastern clock times with AM / PM ("9:30 AM", "4:00 PM"), from the tz database
  // (EDT / EST automatic). (24-hour time is only for the conversation, not the screen.)
  const _clk = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
  const hhmmET = ms => _clk.format(new Date(ms));
  // z134: the ET calendar date `back` days ago (tape files are named by it; the UTC date runs a day
  // ahead from 20:00 ET in summer / 19:00 ET in winter)
  const etDay = back => new Date(Date.now() - back * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const _tapeAt = {};
  async function fetchTapeDay(book, date) {
    const k = book + '|' + date;
    if (k in _tape && !(date === etDay(0) && Date.now() - (_tapeAt[k] || 0) > 55000)) return _tape[k];   // z135: today's tape stays fresh
    _tapeAt[k] = Date.now();
    try { _tape[k] = await getJSON(`${raw()}/${book}/main/data/intraday/${date}.json${date === etDay(0) ? '?_=' + Math.floor(Date.now() / 60000) : ''}`); } catch (e) { _tape[k] = null; }
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
      const dt = etDay(back);   // z134: tape files are named by the ET trading date
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
    // z134: official open at 09:30 ET → regular-session ticks → official close; members' prices
    // start from their official opens (not the previous close) and the index's change is still
    // measured from the previous close level L0 (dotted line).
    const docs = {};
    for (const b of books) { const tp = await fetchTapeDay(b, tapeDate); docs[b] = tp || {}; }
    const closeMin = Math.min(...books.map(b => +docs[b].closeMinuteET || 960));
    for (const b of books) { perBook[b] = (docs[b].snapshots || []).filter(s => regMinute(s, closeMin)); perBook[b].forEach(s => times.add(s.t)); }
    const offOpen = {}, offClose = {};
    for (const m of ms) { const d = docs[_book[m.ticker]] || {}; if (d.open && +d.open[m.ticker] > 0) offOpen[m.ticker] = +d.open[m.ticker]; if (d.close && +d.close[m.ticker] > 0) offClose[m.ticker] = +d.close[m.ticker]; }
    const level = px => { let sum = 0, n = 0; for (const m of ms) { const pc = prevClose[m.ticker], p = px[m.ticker]; if (pc && p) { sum += m.dir * (p / pc - 1); n++; } } return n ? +(L0 * (1 + sum / n)).toFixed(4) : null; };
    const half = Math.ceil(ms.length / 2), t930 = etInstant(tapeDate, 570);
    // z135: the members' 5-minute bars when (nearly) all have them - 0930 official opens → every 5-min close →
    // 1600 official closes; otherwise the 15-min tape below
    const barsBy = {};
    await Promise.all(ms.map(async m => { try { const bd = await fetchBars(m.ticker); if (bd && bd.date === tapeDate && bd.bars.some(b => sessionOf(b.t) === 'reg')) barsBy[m.ticker] = bd; } catch (e) {} }));
    if (Object.keys(barsBy).length >= Math.ceil(ms.length * 0.8)) {
      const px = {}, ends = new Set(), out = [];
      for (const m of ms) { const bd = barsBy[m.ticker]; const o = bd && bd.oo > 0 ? bd.oo : offOpen[m.ticker]; if (o) px[m.ticker] = o; }
      if (Object.keys(px).length >= half) out.push({ t: t930, v: level(px), _open: true });
      const reg = {};
      for (const [T, bd] of Object.entries(barsBy)) { reg[T] = bd.bars.filter(b => sessionOf(b.t) === 'reg'); reg[T].forEach(b => ends.add(b.t + 300000)); }
      const ptr = {};
      for (const t of [...ends].sort((a, z) => a - z)) {
        for (const T of Object.keys(reg)) { let k = ptr[T] || 0; while (k < reg[T].length && reg[T][k].t + 300000 <= t) { px[T] = reg[T][k].c; k++; } ptr[T] = k; }
        const v = level(px);
        if (v != null) out.push({ t: new Date(t).toISOString().replace('.000Z', 'Z'), v });
      }
      const lastPt = out[out.length - 1];
      if (lastPt && etMin(Date.parse(lastPt.t)) >= closeMin && Object.values(barsBy).every(bd => bd.oc > 0)) lastPt._close = true;
      if (out.length >= 2) return { points: out, date: tapeDate, base: L0, prevClose: L0, source: '5-min bars' };
    }
    const last = Object.assign({}, offOpen);
    const opened = Object.keys(offOpen).length >= half;
    if (opened) series.push({ t: t930, v: level(offOpen), _open: true });
    for (const t of [...times].sort()) {
      if (opened && t <= t930) continue;
      for (const b of books) for (const s of perBook[b]) if (s.t === t) for (const m of ms) if (_book[m.ticker] === b && s.p && s.p[m.ticker] != null) last[m.ticker] = +s.p[m.ticker];
      const v = level(last);
      if (v != null) series.push({ t, v });
    }
    if (Object.keys(offClose).length >= half) { const v = level(Object.assign({}, last, offClose)); if (v != null) series.push({ t: etInstant(tapeDate, closeMin), v, _close: true }); }
    if (!series.length) return null;
    return { points: series, date: tapeDate, base: L0, prevClose: L0 };
  }

  // ---------------- windows & resampling ----------------
  const RANGES = [['1D', null], ['1W', 7], ['1M', 31], ['3M', 92], ['YTD', 'ytd'], ['1Y', 366], ['ALL', 'all']];
  const EXTRA_RANGES = { '6M': 183, '5Y': 1827 };   // z131: offered by the Valuation price chart
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
  // z122: which interval points each range offers, and the effective one for a preference
  const IVALS = { '1D': ['D'], '1W': ['D', 'W'], '1M': ['D', 'W', 'M'] };   // 3M, YTD, 1Y, ALL: D W M
  const ivalsFor = r => IVALS[r] || ['D', 'W', 'M'];
  function effInterval(pref, avail) {
    if (avail.includes(pref)) return pref;
    const order = ['D', 'W', 'M'], want = order.indexOf(pref);
    return avail.filter(k => order.indexOf(k) <= want).pop() || avail[0];
  }
  function whenLabel(p, ivl, intraday) {
    if (!p) return '';
    if (p._base) return intraday ? 'previous close' : 'start of range';
    if (p._open || p._close) return (p._open ? 'official open' : 'official close') + ' (Yahoo) · ' + hhmmET(Date.parse(p.t)) + ' ET';   // z134 / z135: 24-hour ET
    if (intraday) return new Date(p.t).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + hhmmET(Date.parse(p.t)) + ' ET';   // z135
    const d = new Date(p.t + 'T12:00:00Z'), f = o => d.toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC' }, o));
    if (ivl === 'W' && p._k) return 'week ending ' + f({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (ivl === 'M' && p._k) return f({ month: 'long', year: 'numeric' }) + ' (to ' + f({ month: 'short', day: 'numeric' }) + ')';
    return f({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  const ivlBar = (avail, cur, attr) => `<span class="seg-control" style="font-size:10px;margin-left:6px">${avail.map(k => `<button class="seg-btn ${cur === k ? 'active' : ''}" ${attr}="${k}" style="font-size:10px" title="${k === 'D' ? 'daily' : k === 'W' ? 'weekly' : 'monthly'} points">${k}</button>`).join('')}</span>`;
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
    // z129: an optional baseline (a number, or a value per point - e.g. the capital put in, which
    // steps up on a deposit) drawn dotted, kept in frame; and ONE colour for the whole chart -
    // line, area and dot - decided by opts.isUp(point, first) (default: above the first point).
    // While you scrub it follows the point under your finger; at rest, the last point.
    const baseAt = opts.baseline == null ? null : (typeof opts.baseline === 'function' ? i => opts.baseline(points[i], i) : () => +opts.baseline);
    const vals = points.map(p => p.v).concat(baseAt ? points.map((p, i) => baseAt(i)).filter(v => v != null && isFinite(v)) : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.01 || 1; lo -= pad; hi += pad;
    const X = i => (i / (points.length - 1)) * (W - padR);
    const Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
    const isUp = p => (opts.isUp ? !!opts.isUp(p, points[0]) : p.v >= points[0].v);
    const COL = u => (u ? 'var(--pos,#5b8a72)' : 'var(--neg,#c25a4a)');
    const up = isUp(points[points.length - 1]);
    const col = COL(up);
    let basePath = '';
    if (baseAt) {                            // a step line: flat until the day the capital changes
      let d = '';
      points.forEach((p, i) => { const v = baseAt(i); if (v == null || !isFinite(v)) return; const y = Y(v).toFixed(1);
        d += d ? ` L${X(i).toFixed(1)},${d.split(',').pop()} L${X(i).toFixed(1)},${y}` : `M${X(i).toFixed(1)},${y}`; });
      basePath = `<path class="vc-base" d="${d}" fill="none" stroke="var(--ink-dim,#b8b1a4)" stroke-width="1" stroke-dasharray="2,4" opacity="0.6" vector-effect="non-scaling-stroke"><title>${esc(opts.baselineLabel || 'baseline')}</title></path>`;
    }
    const gid = 'vc' + Math.random().toString(36).slice(2, 7);
    const line = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.v).toFixed(1)).join('');
    const grid = [0, 1, 2, 3].map(k => { const v = lo + (hi - lo) * (k + 0.5) / 4, y = Y(v);
      return `<line x1="0" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--rule,#2d2d33)" stroke-width="0.6" vector-effect="non-scaling-stroke"/>` +
             `<text x="${W - padR + 6}" y="${y + 3.5}" font-size="10" fill="var(--ink-faint,#6e6a5f)" font-family="var(--mono,monospace)">${opts.axisFmt ? esc(opts.axisFmt(v)) : opts.money === false ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)) : fmtMoney(v)}</text>`; }).join('');
    const intraday = String(points[0].t).includes('T');
    const lab = t => intraday ? hhmmET(Date.parse(t))                                         // z135: 24-hour ET
                              : new Date(t + 'T12:00:00Z').toLocaleDateString(undefined, points.length > 300 ? { year: '2-digit', month: 'short' } : { month: 'short', day: 'numeric' });
    const xi = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    const xt = xi.map((i, k) => ({ i, k: i === 0 ? 0 : i === points.length - 1 ? 2 : 1 })).map(({ i, k }) =>
      `<text x="${X(i)}" y="${H - 4}" font-size="10" fill="var(--ink-faint,#6e6a5f)" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}" font-family="var(--mono,monospace)">${esc(lab(points[i].t))}</text>`).join('');
    host.innerHTML = `<div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto;display:block;overflow:visible" role="img" aria-label="${esc(opts.label || 'chart')}">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop class="vc-s0" offset="0%" stop-color="${col}" stop-opacity="0.25"/><stop class="vc-s1" offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        ${basePath}
        <path d="${line} L${X(points.length - 1)},${H - padB} L0,${H - padB} Z" fill="url(#${gid})"/>
        <path class="vc-line" d="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        <line class="vc-x" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="var(--ink-dim,#b8b1a4)" stroke-dasharray="3,3" vector-effect="non-scaling-stroke" opacity="0"/>
        <circle class="vc-dot" r="3.5" fill="${col}" opacity="0"/>
        ${(opts.markers || []).map(m => { const i = points.findIndex(p => p.t >= m.t); if (i < 0) return '';
          const x = X(i), y = Y(points[i].v), up = m.kind === 'in';
          return `<g><title>${esc(m.label)}</title><path d="M${x},${up ? y + 7 : y - 7} l-5,${up ? 8 : -8} h10 z" fill="${up ? 'var(--pos,#5b8a72)' : 'var(--amber,#e0b04c)'}" stroke="#000" stroke-width="0.6"/></g>`; }).join('')}
        ${xt}
      </svg>
      <div class="vc-hit" style="position:absolute;left:0;top:0;bottom:${padB}px;right:${(padR / W) * 100}%;cursor:crosshair;touch-action:pan-y"></div>
    </div>`;
    const hit = host.querySelector('.vc-hit'), xl = host.querySelector('.vc-x'), dot = host.querySelector('.vc-dot');
    const lineEl = host.querySelector('.vc-line'), stops = host.querySelectorAll('.vc-s0, .vc-s1');
    let painted = up;
    const paint = u => { if (u === painted) return; painted = u; const c = COL(u);
      lineEl.setAttribute('stroke', c); dot.setAttribute('fill', c); stops.forEach(s => s.setAttribute('stop-color', c)); };
    const move = cx => {
      const r = hit.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (cx - r.left) / r.width));
      const i = Math.round(f * (points.length - 1)), p = points[i];
      xl.setAttribute('x1', X(i)); xl.setAttribute('x2', X(i)); xl.setAttribute('opacity', '0.7');
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.v)); dot.setAttribute('opacity', '1');
      paint(isUp(p));
      opts.onScrub && opts.onScrub(p, points[0], intraday ? new Date(p.t).toLocaleString() : p.t);
    };
    const reset = () => { xl.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); paint(up); opts.onReset && opts.onReset(); };
    hit.addEventListener('mousemove', e => move(e.clientX));
    hit.addEventListener('mouseleave', reset);
    hit.addEventListener('touchstart', e => e.touches[0] && move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchmove', e => e.touches[0] && move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchend', reset);
  }

  // ---------------- GoodGlobe mount ----------------
  const GG = { range: '1Y', interval: 'D', daily: null, intraday: undefined, builtAt: 0 };   // interval = the preference (z122)
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
    const avail = ivalsFor(GG.range), ivl = effInterval(GG.interval, avail);
    let pts, label;
    if (GG.range === '1D') {
      if (GG.intraday === undefined) GG.intraday = await indexIntraday(GG.daily);
      pts = GG.intraday ? GG.intraday.points : [];
      label = GG.intraday ? `${GG.intraday.date} · 0930–1600 ET · ${GG.intraday.source || '15-min tape'}` : 'no intraday data for the latest session';
    } else {
      const r = RANGES.find(x => x[0] === GG.range)[1];
      pts = windowed(all, r);
      if (ivl !== 'D') pts = resample(pts, ivl);
      label = GG.range === 'ALL' ? `since inception (${GG.daily.inception}, $${BASE_VALUE.toFixed(2)})` : GG.range;
    }
    const bar = RANGES.map(([k]) => `<button class="seg-btn ${GG.range === k ? 'active' : ''}" data-vcr="${k}" style="font-size:10px">${k}</button>`).join('');
    host.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 4px"><span class="seg-control" style="font-size:10px">${bar}</span>${ivlBar(avail, ivl, 'data-vci')}</div><div class="vc-chart"></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">${GG.daily.members.length} member${GG.daily.members.length === 1 ? '' : 's'} · built from each member's daily closes · equal-weighted, shorts inverse · starts at $${BASE_VALUE.toFixed(2)} on ${esc(GG.daily.inception || '—')}</div>`;
    const setHeader = (p, base, sub) => {
      if (!p || !base) return;
      const ch = (p.v / base.v - 1) * 100, c = ch >= 0 ? 'var(--pos)' : 'var(--neg)';
      if (priceEl) { priceEl.textContent = '$' + p.v.toFixed(2); priceEl.style.color = c; }
      if (pctEl) { pctEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'; pctEl.style.color = c; }
      if (subEl) subEl.textContent = sub;
    };
    // z134: on 1D the change is from the previous close (dotted), while the line itself starts at the official open
    const prevPt = GG.range === '1D' && GG.intraday && GG.intraday.base ? { v: GG.intraday.base, t: '' } : null;
    const resetHeader = () => pts.length ? setHeader(pts[pts.length - 1], prevPt || pts[0], label + ' · scrub the chart') : null;
    drawStockChart(host.querySelector('.vc-chart'), pts, Object.assign({ label: 'GoodGlobe Index', empty: label,
      onScrub: (p, base) => setHeader(p, prevPt || base, whenLabel(p, ivl, GG.range === '1D')), onReset: resetHeader },
      prevPt ? { isUp: p => p.v >= prevPt.v, baseline: prevPt.v, baselineLabel: 'previous close' } : {}));
    resetHeader();
    host.querySelectorAll('[data-vcr]').forEach(b => b.onclick = () => { GG.range = b.dataset.vcr; render(); });
    host.querySelectorAll('[data-vci]').forEach(b => b.onclick = () => { GG.interval = b.dataset.vci; render(); });
    clearTimeout(GG.timer);                                    // z135: 1D re-reads every minute while on screen
    if (GG.range === '1D') GG.timer = setTimeout(() => { if (!host.isConnected || GG.range !== '1D') return; const m = etMin(Date.now()); if (document.visibilityState === 'visible' && m >= 240 && m <= 1205) GG.intraday = undefined; render(); }, 60000);
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

  // ---------------- Account value (portfolio, z97) ----------------
  // Total account value per day = cash + every holding marked at that day's
  // actual close, rebuilt from the transaction ledger:
  //   cash(d)     = opening capital + cash effect of every non-void row <= d
  //                 (buys, sells, shorts, options, deposits, withdrawals, adjustments)
  //   holdings(d) = shares from buy/sell/short rows <= d, x close(d) x USD factor
  // Positions that pre-date the ledger enter at their added date and cost.
  // Deposits / withdrawals are drawn as markers, and the headline return is
  // TIME-WEIGHTED (flows removed), so taking cash out never looks like a loss.
  // Opening capital = the reconciliation value if you've entered one, else the
  // amount that makes today's cash match the stored balance.
  async function accountSeries() {
    const txAll = (typeof loadTransactions === 'function') ? loadTransactions() : [];
    const entries = (typeof loadPortfolio === 'function') ? (loadPortfolio() || []) : [];
    const effect = t => (typeof txCashEffect === 'function') ? txCashEffect(t) : 0;
    const tx = txAll.map(t => ({ ...t, d: String(t.ts || '').slice(0, 10) })).filter(t => t.d).sort((a, b) => a.d < b.d ? -1 : 1);
    // positions that pre-date the ledger: a virtual buy at addedAt
    const ACTIVE = ['Long', 'Short'];
    const covered = new Set(tx.filter(t => t.type === 'buy' || t.type === 'short').map(t => String(t.ticker || '').toUpperCase()));
    for (const e of entries) {
      const T = String(e.ticker || '').toUpperCase();
      if (!ACTIVE.includes(e.position) || covered.has(T) || !(+e.qty > 0) || !(+e.costBasis > 0)) continue;
      const d = String(e.addedAt || e.createdAt || '').slice(0, 10); if (!d) continue;
      tx.push({ d, type: e.position === 'Short' ? 'short' : 'buy', ticker: T, qty: +e.qty, price: +e.costBasis, fee: 0, _virtual: true,
                cost: e.position === 'Short' ? undefined : +e.qty * +e.costBasis, proceeds: e.position === 'Short' ? +e.qty * +e.costBasis : undefined });
    }
    tx.sort((a, b) => a.d < b.d ? -1 : 1);
    if (!tx.length) return null;
    const stored = (typeof getCashPosition === 'function') ? +getCashPosition() || 0 : 0;
    const flowAll = tx.reduce((s, t) => s + effect(t), 0);
    const op = (typeof loadCashOpening === 'function') ? loadCashOpening() : null;
    const opening = op ? +op.amount : stored - flowAll;
    const tickers = [...new Set(tx.filter(t => ['buy', 'sell', 'short'].includes(t.type) && t.ticker).map(t => String(t.ticker).toUpperCase()))];
    await Promise.all(tickers.map(t => fetchDaily(t)));
    const fx = {}; for (const t of tickers) fx[t] = (typeof _botUsdFactor === 'function') ? _botUsdFactor(t) : 1;
    const start = tx[0].d, end = new Date().toISOString().slice(0, 10);
    // z111: RECONCILE holdings to the portfolio as it stands. The ledger can miss
    // a share change (a position switched to Tracking / Watching, or deleted
    // without a sell row), and replaying it then keeps "holding" shares you no
    // longer have - which is how this chart sat ~$30k above the portfolio value.
    // For each ticker whose replayed quantity today doesn't match the active
    // positions, the share path comes from the active positions themselves
    // (each counted from its added date) instead of the ledger.
    const sharesOf = e => (e.position === 'Short' ? -1 : 1) * (+e.qty || 0);
    const activeQty = {}, activeEntries = {};
    for (const e of entries) {
      if (!ACTIVE.includes(e.position) || (e.instrument && e.instrument !== 'shares' && e.instrument !== 'stock')) continue;
      const T = String(e.ticker || '').toUpperCase();
      activeQty[T] = (activeQty[T] || 0) + sharesOf(e);
      (activeEntries[T] = activeEntries[T] || []).push({ d: String(e.addedAt || e.createdAt || start).slice(0, 10), q: sharesOf(e) });
    }
    const replayFinal = {};
    for (const t of tx) {
      const T = String(t.ticker || '').toUpperCase();
      if (t.type === 'buy') replayFinal[T] = (replayFinal[T] || 0) + (+t.qty || 0);
      else if (t.type === 'sell' || t.type === 'short') replayFinal[T] = (replayFinal[T] || 0) - (+t.qty || 0);
    }
    const fromEntries = new Set();
    for (const T of new Set([...Object.keys(replayFinal), ...Object.keys(activeQty)])) {
      if (Math.abs((replayFinal[T] || 0) - (activeQty[T] || 0)) > 1e-6) fromEntries.add(T);
    }
    for (const T of Object.keys(activeQty)) if (!tickers.includes(T)) { tickers.push(T); await fetchDaily(T); fx[T] = (typeof _botUsdFactor === 'function') ? _botUsdFactor(T) : 1; }
    const ptr = {}, lastC = {}, qty = {};
    let cash = opening, k = 0, pendingFlow = 0;
    const points = [], flows = [];
    for (let ts = Date.parse(start + 'T00:00:00Z'); ts <= Date.parse(end + 'T00:00:00Z'); ts += 864e5) {
      const day = new Date(ts), dow = day.getUTCDay(), ds = day.toISOString().slice(0, 10);
      let flowToday = 0;
      while (k < tx.length && tx[k].d <= ds) {
        const t = tx[k++], T = String(t.ticker || '').toUpperCase();
        cash += effect(t);
        if (t.type === 'buy') qty[T] = (qty[T] || 0) + (+t.qty || 0);
        else if (t.type === 'sell') qty[T] = (qty[T] || 0) - (+t.qty || 0);
        else if (t.type === 'short') qty[T] = (qty[T] || 0) - (+t.qty || 0);
        else if (t.type === 'deposit' || t.type === 'withdrawal') { flowToday += +t.amount || 0; flows.push({ t: ds, amount: +t.amount || 0 }); }
      }
      pendingFlow += flowToday;                 // z122: a weekend deposit belongs to the next weekday's point
      if (dow === 0 || dow === 6) continue;
      for (const T of fromEntries) qty[T] = (activeEntries[T] || []).reduce((a, e) => a + (e.d <= ds ? e.q : 0), 0);
      let mv = 0;
      for (const T of Object.keys(qty)) {
        if (!qty[T]) continue;
        const h = _daily[T] || []; let i = ptr[T] || 0;
        while (i < h.length && h[i].d <= ds) { lastC[T] = h[i].c; i++; } ptr[T] = i;
        if (lastC[T] != null) mv += qty[T] * lastC[T] * (fx[T] || 1);
      }
      points.push({ t: ds, v: +(cash + mv).toFixed(2), flow: +pendingFlow.toFixed(2) });
      pendingFlow = 0;
    }
    // time-weighted return: chain daily returns with that day's external flow removed
    let twr = 1;
    for (let i = 1; i < points.length; i++) { const prev = points[i - 1].v; if (prev > 0) twr *= (points[i].v - points[i].flow) / prev; }
    return { points, flows, opening, openingSource: op ? 'reconciliation' : 'implied by stored cash', twrPct: (twr - 1) * 100,
             final: { cash, qty: { ...qty }, fx },
             virtual: tx.filter(t => t._virtual).length, reconciled: [...fromEntries].sort(),
             cashGap: op ? +(stored - cash).toFixed(2) : 0 };
  }
  // z122: time-weighted return and market P/L carried on every point (from the window's
  // first point), so a weekly / monthly point still reads exactly - flows never count as P/L.
  function withReturns(pts) {
    let f = 1, cf = 0;
    return pts.map((p, i) => {
      if (i > 0) { const prev = pts[i - 1].v; if (prev > 0) f *= (p.v - (p.flow || 0)) / prev; cf += p.flow || 0; }
      return Object.assign({}, p, { twr: f, cumFlow: +cf.toFixed(2) }, i === 0 ? { _base: true } : {});
    });
  }
  // 1D: today's positions x the books' 15-min tape + today's cash; the base is the previous close
  async function accountIntraday(s) {
    const q = (s.final && s.final.qty) || {}, fx = (s.final && s.final.fx) || {};
    const held = Object.keys(q).filter(T => q[T]);
    if (!held.length || !s.points.length) return null;
    await Promise.all(held.map(T => fetchDaily(T)));
    const books = [...new Set(held.map(T => _book[T]).filter(Boolean))];
    let tapeDate = null;
    for (let back = 0; back < 8 && !tapeDate; back++) {
      const dt = etDay(back);   // z134: tape files are named by the ET trading date
      for (const b of books) { const tp = await fetchTapeDay(b, dt); if (tp && tp.snapshots && tp.snapshots.length) { tapeDate = dt; break; } }
    }
    if (!tapeDate) return null;
    const prev = s.points.filter(p => p.t < tapeDate);
    if (!prev.length) return null;
    const base = prev[prev.length - 1].v;
    const flowToday = s.flows.filter(f => f.t === tapeDate).reduce((a, f) => a + f.amount, 0), adj = base + flowToday;
    const last = {};
    for (const T of held) for (const b of (_daily[T] || [])) { if (b.d < tapeDate) last[T] = b.c; else break; }
    const perBook = {}, times = new Set();
    for (const b of books) { const tp = await fetchTapeDay(b, tapeDate); perBook[b] = (tp && tp.snapshots) || []; perBook[b].forEach(x => times.add(x.t)); }
    const cash = s.final.cash, out = [];
    for (const t of [...times].sort()) {
      for (const b of books) for (const x of perBook[b]) if (x.t === t && x.p) for (const T of held) if (_book[T] === b && x.p[T] != null && isFinite(+x.p[T])) last[T] = +x.p[T];
      const v = cash + held.reduce((a, T) => a + (last[T] != null ? q[T] * last[T] * (fx[T] || 1) : 0), 0);
      out.push({ t, v: +v.toFixed(2), twr: adj > 0 ? v / adj : 1, cumFlow: flowToday });
    }
    if (!out.length) return null;
    const t0 = new Date(Date.parse(out[0].t) - 60000).toISOString();
    return { points: [{ t: t0, v: base, twr: 1, cumFlow: 0, _base: true }, ...out], date: tapeDate, base };
  }
  const ACC = { range: '3M', interval: 'D', series: null, intraday: undefined };
  async function mountAccountChart() {
    const host = document.getElementById('acct-value-mount'); if (!host) return;
    host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:16px 0">Rebuilding account value from the ledger…</div>';
    const s = await accountSeries();
    if (!document.getElementById('acct-value-mount')) return;
    if (!s || s.points.length < 2) { host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:16px 0">No ledger activity yet.</div>'; return; }
    ACC.series = s; ACC.intraday = undefined;
    if (!RANGES.some(x => x[0] === ACC.range)) ACC.range = '3M';
    return renderAccount();
  }
  async function renderAccount() {
    const host = document.getElementById('acct-value-mount'), s = ACC.series;
    if (!host || !s) return;
    const avail = ivalsFor(ACC.range), ivl = effInterval(ACC.interval, avail), intra = ACC.range === '1D';
    let pts, label;
    if (intra) {
      if (ACC.intraday === undefined) ACC.intraday = await accountIntraday(s);
      pts = ACC.intraday ? ACC.intraday.points : [];
      label = ACC.intraday ? `${ACC.intraday.date} · intraday (15-min tape)` : 'no intraday tape for the latest session';
    } else {
      pts = withReturns(windowed(s.points, RANGES.find(x => x[0] === ACC.range)[1]));
      if (ivl !== 'D') pts = resample(pts, ivl);
      label = ACC.range === 'ALL' ? `since ${pts.length ? whenLabel(Object.assign({}, pts[0], { _base: false }), 'D', false) : '—'}` : ACC.range;
    }
    const from = pts.length ? pts[0].t : '', fromDay = String(from).slice(0, 10);
    const flowsIn = s.flows.filter(f => (intra ? f.t === (ACC.intraday && ACC.intraday.date) : f.t > fromDay));
    const netFlow = flowsIn.reduce((a, f) => a + f.amount, 0);
    const money2 = v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const money0 = v => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const bar = RANGES.map(([k]) => `<button class="seg-btn ${ACC.range === k ? 'active' : ''}" data-acr="${k}" style="font-size:10px">${k}</button>`).join('');
    host.innerHTML = `<div>
        <div style="display:flex;align-items:baseline;gap:10px;margin-top:3px;flex-wrap:wrap">
          <span id="acct-price-readout" style="font-family:var(--mono);font-size:30px;font-weight:800;line-height:1"></span>
          <span id="acct-pct-readout" style="font-family:var(--mono);font-size:14px;font-weight:700"></span>
        </div>
        <div id="acct-sub-readout" style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:2px"></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 4px"><span class="seg-control" style="font-size:10px">${bar}</span>${ivlBar(avail, ivl, 'data-aci')}</div>
      <div class="acct-chart"></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px;line-height:1.5">
        Cash + holdings at each close (1D: on the 15-min tape), rebuilt from the transaction ledger · % is time-weighted and P/L is market P/L — deposits / withdrawals are taken out (▲ deposit ▼ withdrawal: ${flowsIn.length} in range, net ${money0(netFlow)}) ·
        opening capital $${Math.round(s.opening).toLocaleString()} (${esc(s.openingSource)})${s.virtual ? ` · ${s.virtual} position(s) older than the ledger enter at their added date and cost` : ''}${s.reconciled && s.reconciled.length ? ` · share path taken from current positions for ${esc(s.reconciled.join(', '))} (the ledger's share count didn't match)` : ''}${s.cashGap && Math.abs(s.cashGap) >= 1 ? ` · <span style="color:var(--red)">stored cash differs from the ledger by $${Math.abs(s.cashGap).toLocaleString()} — see Transactions → Cash reconciliation</span>` : ''}${ACC.range === 'ALL' ? ` · all-time time-weighted ${s.twrPct >= 0 ? '+' : ''}${s.twrPct.toFixed(2)}%` : ''}</div>`;
    const priceEl = host.querySelector('#acct-price-readout'), pctEl = host.querySelector('#acct-pct-readout'), subEl = host.querySelector('#acct-sub-readout');
    const setHeader = (p, base, sub) => {
      if (!p || !base) return;
      const pnl = p.v - base.v - (p.cumFlow || 0), pct = ((p.twr != null ? p.twr : p.v / base.v) - 1) * 100, c = pnl >= 0 ? 'var(--pos)' : 'var(--neg)';
      priceEl.textContent = money2(p.v); priceEl.style.color = c;
      pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'; pctEl.style.color = c;
      subEl.textContent = `${sub} · market P/L ${money0(pnl)}`;
    };
    const resetHeader = () => pts.length ? setHeader(pts[pts.length - 1], pts[0], `${label} · scrub the chart`) : null;
    drawStockChart(host.querySelector('.acct-chart'), pts, { label: 'Account value', empty: label,
      markers: flowsIn.map(f => ({ t: f.t, kind: f.amount >= 0 ? 'in' : 'out', label: `${f.t}: ${f.amount >= 0 ? 'deposit' : 'withdrawal'} $${Math.abs(f.amount).toLocaleString()}` })),
      onScrub: (p, base) => setHeader(p, base, whenLabel(p, ivl, intra)), onReset: resetHeader });
    resetHeader();
    host.querySelectorAll('[data-acr]').forEach(b => b.onclick = () => { ACC.range = b.dataset.acr; renderAccount(); });
    host.querySelectorAll('[data-aci]').forEach(b => b.onclick = () => { ACC.interval = b.dataset.aci; renderAccount(); });
  }

  // ---------------- a value series with capital flows (z129: Bot equity) ----------------
  // The account-value chart, generalised: the same header, 1D…ALL bar, D / W / M rule and flow
  // markers, for any daily value series carrying capital flows ({t, v, flow}). P/L is market P/L
  // (flows out); % = P/L ÷ capital at work (the window's opening value + the flows inside it), so
  // ALL reads exactly the all-time return on capital. The dotted line is that capital at each
  // point (it steps up on a deposit), and the whole chart is green while P/L ≥ 0 at the point under
  // your finger - red whenever the value is below what was put in.
  const FC = {};
  async function mountFlowChart(host, cfg) {
    if (!host) return;
    const st = FC[cfg.key] || (FC[cfg.key] = { range: cfg.range || 'ALL', interval: 'D', intraday: undefined, at: 0 });
    if (cfg.fresh) { st.intraday = undefined; }
    const s = cfg.series || {};
    const all = (s.points || []).filter(p => p && p.t && isFinite(p.v));
    if (all.length < 2) { host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:16px 0">Not enough history yet.</div>'; return; }
    const flows = (s.flows || []).filter(f => f && f.t && f.amount);
    const money2 = v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const moneyS = v => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const draw = async () => {
      if (!host.isConnected) return;
      const avail = ivalsFor(st.range), ivl = effInterval(st.interval, avail), intra = st.range === '1D';
      let pts, label;
      if (intra) {
        if (st.intraday === undefined) { try { st.intraday = cfg.intraday ? await cfg.intraday() : null; } catch (e) { st.intraday = null; } }
        if (!host.isConnected) return;
        pts = st.intraday ? st.intraday.points : [];
        label = st.intraday ? `${st.intraday.date} · intraday` : 'no intraday marks for the latest session';
      } else {
        pts = withReturns(windowed(all, RANGES.find(x => x[0] === st.range)[1]));
        if (ivl !== 'D') pts = resample(pts, ivl);
        label = st.range === 'ALL' ? `since ${whenLabel(Object.assign({}, all[0], { _base: false }), 'D', false)}` : st.range;
      }
      const fromDay = pts.length ? String(pts[0].t).slice(0, 10) : '';
      const flowsIn = flows.filter(f => (intra ? false : f.t > fromDay));
      const bar = RANGES.map(([k]) => `<button class="seg-btn ${st.range === k ? 'active' : ''}" data-vcr="${k}" style="font-size:10px">${k}</button>`).join('');
      host.innerHTML = `<div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:3px;flex-wrap:wrap">
            <span data-vc-price style="font-family:var(--mono);font-size:30px;font-weight:800;line-height:1"></span>
            <span data-vc-pct style="font-family:var(--mono);font-size:14px;font-weight:700"></span></div>
          <div data-vc-sub style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:2px"></div></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 4px"><span class="seg-control" style="font-size:10px">${bar}</span>${ivlBar(avail, ivl, 'data-vci')}</div>
        <div class="vc-chart"></div>
        ${cfg.footnote ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px;line-height:1.5">${cfg.footnote}</div>` : ''}`;
      const pe = host.querySelector('[data-vc-price]'), ce = host.querySelector('[data-vc-pct]'), se = host.querySelector('[data-vc-sub]');
      const pnlOf = (p, base) => p.v - base.v - (p.cumFlow || 0);
      const capOf = (p, base) => base.v + (p.cumFlow || 0);
      const setHeader = (p, base, sub) => {
        if (!p || !base) return;
        const pnl = pnlOf(p, base), cap = capOf(p, base), pct = cap > 0 ? pnl / cap * 100 : 0, c = pnl >= 0 ? 'var(--pos)' : 'var(--neg)';
        pe.textContent = money2(p.v); pe.style.color = c;
        ce.textContent = `${moneyS(pnl)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`; ce.style.color = c;
        se.textContent = `${sub} · put in ${money2(cap)}`;
      };
      const resetHeader = () => (pts.length ? setHeader(pts[pts.length - 1], pts[0], `${label} · scrub the chart`) : null);
      drawStockChart(host.querySelector('.vc-chart'), pts, { label: cfg.title || 'Value', empty: label,
        isUp: (p, base) => pnlOf(p, base) >= 0, baseline: (p) => capOf(p, pts[0]), baselineLabel: 'capital put in (opening value + deposits)',
        markers: flowsIn.map(f => ({ t: f.t, kind: f.amount >= 0 ? 'in' : 'out', label: `${f.t}: ${f.label || (f.amount >= 0 ? 'capital in' : 'capital out')} ${moneyS(f.amount)}` })),
        onScrub: (p, base) => setHeader(p, base, whenLabel(p, ivl, intra)), onReset: resetHeader });
      resetHeader();
      host.querySelectorAll('[data-vcr]').forEach(b => b.onclick = () => { st.range = b.dataset.vcr; draw(); });
      host.querySelectorAll('[data-vci]').forEach(b => b.onclick = () => { st.interval = b.dataset.vci; draw(); });
    };
    await draw();
  }

  // ---------------- any one series, the GoodGlobe way (z127) ----------------
  // The same chart as the GoodGlobe index and the account value - large value + % that follow
  // the scrub, the 1D 1W 1M 3M YTD 1Y ALL bar and the D / W / M interval rule - for any one
  // daily series (Regime → TLT). 1D comes from the 15-min tape of the ticker's book, with the
  // previous close placed one minute before the first tick (the z122 rule).
  const SC = {};
  async function seriesIntraday(ticker, daily) {
    const b = _book[ticker];
    if (!b) return null;
    let tp = null, tapeDate = null;
    for (let back = 0; back < 8 && !tapeDate; back++) {
      const dt = etDay(back);   // z134: tape files are named by the ET trading date
      const x = await fetchTapeDay(b, dt);
      if (x && x.snapshots && x.snapshots.some(s => s.p && s.p[ticker] != null)) { tp = x; tapeDate = dt; }
    }
    if (!tapeDate) return null;
    const prev = daily.filter(p => p.t < tapeDate);
    if (!prev.length) return null;
    // z134: the day's line = Yahoo's OFFICIAL open at 09:30 ET → the regular-session 15-min ticks →
    // Yahoo's OFFICIAL close at 16:00 ET (13:00 on an early close). Pre-market is not on the line
    // (the tape repeats the regular price then; extended hours live in the 5-minute bars), and the
    // official prints trump whatever the 15-minute pulls caught at those two minutes. The change
    // is still measured from the previous close (dotted line).
    const closeMin = +tp.closeMinuteET || 960, inReg = s => regMinute(s, closeMin);
    const ticks = tp.snapshots.filter(s => s.p && s.p[ticker] != null && inReg(s)).map(s => ({ t: s.t, v: +s.p[ticker] })).sort((a, z) => (a.t < z.t ? -1 : 1));
    const oo = tp.open && +tp.open[ticker] > 0 ? +tp.open[ticker] : null, oc = tp.close && +tp.close[ticker] > 0 ? +tp.close[ticker] : null;
    const points = [];
    if (oo) points.push({ t: etInstant(tapeDate, 570), v: oo, _open: true });
    points.push(...ticks.filter(p => !oo || p.t > etInstant(tapeDate, 570)));
    if (oc) points.push({ t: etInstant(tapeDate, closeMin), v: oc, _close: true });
    if (!points.length) return null;
    return { points, date: tapeDate, prevClose: prev[prev.length - 1].v, open: oo, close: oc, closeMin };
  }

  // ---------------- today's 5-minute bars (z131) ----------------
  // data/bars/<date>/<TICKER>.json in the ticker's book (pipeline/fetch_intraday_bars.py, one ~10 KB
  // file per ticker): [[t, o, h, l, c, v]], t = bar start (epoch s); pre-market 04:00-09:30 ET and
  // after hours 16:00-20:00 ET where the symbol trades them. Re-read every 2 minutes.
  const _barsLatest = {}, _barsT = {};
  async function fetchBars(ticker) {
    const t = String(ticker || '').toUpperCase();
    // z159: Supabase first (live_bars_day, one row, no 5-minute raw cache); the book's GitHub files below are the fallback
    try {
      if (window.LiveData && typeof window.LiveData.bars === 'function') {
        const k = 'sb|' + t, n0 = Date.now();
        if (!_barsT[k] || n0 - _barsT[k].at > 55000) _barsT[k] = { at: n0, rec: await window.LiveData.bars(t) };
        if (_barsT[k].rec) return _barsT[k].rec;
      }
    } catch (e) {}
    if (!_book[t]) { try { await fetchDaily(t); } catch (e) {} }
    const b = _book[t];
    if (!b) return null;
    const now = Date.now(), v = Math.floor(now / 60000);
    if (!_barsLatest[b] || now - _barsLatest[b].at > 55000) {
      let latest = null;
      try { latest = await getJSON(`${raw()}/${b}/main/data/bars/latest.json?_=${v}`); } catch (e) {}
      _barsLatest[b] = { at: now, latest };
    }
    const latest = _barsLatest[b].latest;
    if (!latest || !latest.date || (Array.isArray(latest.tickers) && !latest.tickers.includes(t))) return null;
    const key = `${b}|${latest.date}|${t}`;
    if (!_barsT[key] || now - _barsT[key].at > 55000) {
      let rec = null;
      try { rec = await getJSON(`${raw()}/${b}/main/data/bars/${latest.date}/${encodeURIComponent(t)}.json?_=${v}`); } catch (e) {}
      _barsT[key] = { at: now, rec };
    }
    const rec = _barsT[key].rec;
    if (!rec || !Array.isArray(rec.b) || rec.b.length < 2) return null;
    return { date: rec.date || latest.date, interval: 5, updatedAt: rec.updatedAt || null, prevClose: rec.pc != null && +rec.pc > 0 ? +rec.pc : null,
             bars: rec.b.map(x => ({ t: x[0] * 1000, o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] || 0 })),
             oo: rec.oo != null && +rec.oo > 0 ? +rec.oo : null, oc: rec.oc != null && +rec.oc > 0 ? +rec.oc : null,   // z134 / z135
             ext: (latest.ext && latest.ext[t]) || null };
  }
  // z135: the day's LINE from the 5-minute bars - the official open at 0930 ET, then each regular bar's close
  // at the bar's END (the 0930 bar's close is the price at 0935), the last ending 1600 at the official close.
  // Pre-market and after hours stay off the line (the header quotes them).
  function barsLine(bd) {
    const reg = (bd.bars || []).filter(b => sessionOf(b.t) === 'reg');
    if (!reg.length) return [];
    const pts = [];
    const oo = bd.oo > 0 ? bd.oo : (etMin(reg[0].t) === 570 ? reg[0].o : null);
    if (oo > 0) pts.push({ t: etInstant(bd.date, 570), v: oo, _open: true });
    for (const b of reg) pts.push({ t: new Date(b.t + 300000).toISOString().replace('.000Z', 'Z'), v: b.c });
    const last = pts[pts.length - 1];
    if (bd.oc > 0 && Math.abs(last.v - bd.oc) < 1e-9 && etMin(Date.parse(last.t)) >= 960) last._close = true;
    return pts;
  }
  const _etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
  // z134: Eastern-time helpers - DST-correct via the browser's tz database, never a fixed UTC offset.
  // etInstant('2026-10-19', 570) = 09:30 ET that day as a UTC ISO time (13:30Z in EDT, 14:30Z in EST).
  function etInstant(ds, minET) {
    const noon = Date.parse(ds + 'T12:00:00Z'), off = etMin(noon) - 720;         // ET minus UTC, minutes
    return new Date(Date.parse(ds + 'T00:00:00Z') + (minET - off) * 60000).toISOString().replace('.000Z', 'Z');
  }
  // a tape snapshot inside the regular session: its ET bucket (b) when present, else its time in ET
  const regMinute = (s, closeMin) => { const m = s.b != null ? +s.b : etMin(Date.parse(s.t)); return m >= 570 && m < (closeMin || 960); };
  const etMin = ms => { const [h, m] = _etFmt.format(new Date(ms)).split(':').map(Number); return (h % 24) * 60 + m; };
  const sessionOf = ms => { const m = etMin(ms); return m < 570 ? 'pre' : m < 960 ? 'reg' : 'post'; };
  const SESSION_NAME = { pre: 'pre-market', reg: 'regular session', post: 'after hours' };
  const etClock = ms => hhmmET(ms) + ' ET';                                                    // z135: 24-hour ET
  // A US stock / ETF trades 04:00-20:00 ET; indices (^), FX (=X), futures (=F), crypto (-USD) and foreign
  // listings keep their own clocks, so they get no pre / after-hours bands.
  const usExtended = t => !/^\^|=X$|=F$|-USD$|\.[A-Z]{1,3}$/.test(String(t || '').toUpperCase());

  // Candles + volume on a CLOCK-TIME axis: a US listing that trades extended hours spans 04:00-20:00 ET
  // (the day's future stays empty, as on a broker's 1D chart); one that doesn't, 09:30-16:00. Candle width
  // = 70 % of one 5-minute slot; a missing bar is a gap, never bridged.
  function drawCandleChart(host, data, opts = {}) {
    const bars = (data && data.bars) || [];
    const W = Math.max(280, Math.round(host.clientWidth || (host.parentElement && host.parentElement.clientWidth) || 600));
    const H = opts.height || 236, padR = 56, padB = 18, padT = 18, volH = Math.round((H - padT - padB) * 0.18), gap = 6;
    if (bars.length < 2) { host.innerHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:24px 0;text-align:center">${esc(opts.empty || 'No intraday bars yet')}</div>`; return; }
    const iv = (data.interval || 5) * 60000;
    const first = bars[0].t, day0 = first - etMin(first) * 60000;          // 00:00 ET of the session day
    const hasPre = bars.some(b => sessionOf(b.t) === 'pre'), hasPost = bars.some(b => sessionOf(b.t) === 'post');
    const ext = opts.us && (hasPre || hasPost);
    const t0 = opts.us ? day0 + (ext ? 240 : 570) * 60000 : first;
    const t1 = opts.us ? day0 + (ext ? 1200 : 960) * 60000 : bars[bars.length - 1].t + iv;
    const plotW = W - padR, X = t => ((t - t0) / (t1 - t0)) * plotW;
    let lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
    if (data.prevClose > 0) { lo = Math.min(lo, data.prevClose); hi = Math.max(hi, data.prevClose); }
    const pad = (hi - lo) * 0.08 || hi * 0.01 || 1; lo -= pad; hi += pad;
    const priceBottom = H - padB - volH - gap;
    const Y = v => padT + (hi - v) / (hi - lo) * (priceBottom - padT);
    const maxV = Math.max(0, ...bars.map(b => b.v || 0));
    const VY = v => H - padB - (maxV > 0 ? (v / maxV) * volH : 0);
    const bw = Math.max(1, Math.min(9, 0.7 * (X(t0 + iv) - X(t0))));
    const UP = 'var(--pos,#5b8a72)', DN = 'var(--neg,#c25a4a)';
    const axis = opts.axisFmt || fmtMoney;
    const band = (a, b, label) => { const xa = X(a), xb = X(b);
      return `<rect x="${xa.toFixed(1)}" y="${padT - 14}" width="${(xb - xa).toFixed(1)}" height="${(H - padB - padT + 14).toFixed(1)}" fill="var(--ink-faint,#6e6a5f)" opacity="0.07"/>` +
             `<text x="${((xa + xb) / 2).toFixed(1)}" y="${padT - 5}" font-size="8.5" text-anchor="middle" fill="var(--ink-faint,#6e6a5f)" font-family="var(--mono,monospace)" letter-spacing="0.08em">${label}</text>`; };
    const bands = ext ? band(day0 + 240 * 60000, day0 + 570 * 60000, 'PRE-MARKET') + band(day0 + 960 * 60000, day0 + 1200 * 60000, 'AFTER HOURS') : '';
    const grid = [0, 1, 2, 3].map(k => { const v = lo + (hi - lo) * (k + 0.5) / 4, y = Y(v);
      return `<line x1="0" x2="${plotW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--rule,#2d2d33)" stroke-width="0.6"/>` +
             `<text x="${plotW + 6}" y="${(y + 3.5).toFixed(1)}" font-size="10" fill="var(--ink-faint,#6e6a5f)" font-family="var(--mono,monospace)">${esc(axis(v))}</text>`; }).join('');
    const pc = data.prevClose > 0 ? `<line x1="0" x2="${plotW}" y1="${Y(data.prevClose).toFixed(1)}" y2="${Y(data.prevClose).toFixed(1)}" stroke="var(--ink-dim,#b8b1a4)" stroke-width="1" stroke-dasharray="2,4" opacity="0.75"><title>previous close ${esc(axis(data.prevClose))}</title></line>` : '';
    const candles = bars.map(b => {
      const x = X(b.t + iv / 2), col = b.c >= b.o ? UP : DN, yo = Y(b.o), yc = Y(b.c), top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yc - yo));
      return `<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${Y(b.h).toFixed(2)}" y2="${Y(b.l).toFixed(2)}" stroke="${col}" stroke-width="1"/>` +
             `<rect x="${(x - bw / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${hgt.toFixed(2)}" fill="${col}"/>` +
             (b.v > 0 ? `<rect x="${(x - bw / 2).toFixed(2)}" y="${VY(b.v).toFixed(2)}" width="${bw.toFixed(2)}" height="${(H - padB - VY(b.v)).toFixed(2)}" fill="${col}" opacity="0.45"/>` : '');
    }).join('');
    const ticks = (opts.us ? (ext ? [240, 570, 720, 960, 1200] : [570, 720, 840, 960]).map(m => day0 + m * 60000)
                           : [first, (first + t1) / 2, t1]).map((t, k, arr) =>
      `<text x="${X(t).toFixed(1)}" y="${H - 4}" font-size="10" fill="var(--ink-faint,#6e6a5f)" text-anchor="${k === 0 ? 'start' : k === arr.length - 1 ? 'end' : 'middle'}" font-family="var(--mono,monospace)">${esc(hhmmET(t).replace(':00', ''))}</text>`).join('');
    host.innerHTML = `<div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto;display:block;overflow:visible" role="img" aria-label="${esc(opts.label || 'intraday candles')}">
        ${bands}${grid}${pc}
        <line x1="0" x2="${plotW}" y1="${H - padB}" y2="${H - padB}" stroke="var(--rule,#2d2d33)" stroke-width="0.6"/>
        ${candles}
        <line class="vc-x" x1="0" x2="0" y1="${padT - 14}" y2="${H - padB}" stroke="var(--ink-dim,#b8b1a4)" stroke-dasharray="3,3" opacity="0"/>
        <circle class="vc-dot" r="3.5" fill="var(--ink,#e8e2d4)" opacity="0"/>
        ${ticks}
      </svg>
      <div class="vc-hit" style="position:absolute;left:0;top:0;bottom:${padB}px;right:${(padR / W) * 100}%;cursor:crosshair;touch-action:pan-y"></div>
    </div>`;
    const hit = host.querySelector('.vc-hit'), xl = host.querySelector('.vc-x'), dot = host.querySelector('.vc-dot');
    const move = cx => {
      const r = hit.getBoundingClientRect(); if (!r.width) return;
      const tt = t0 + Math.max(0, Math.min(1, (cx - r.left) / r.width)) * (t1 - t0);
      let k = 0; for (let n = 1; n < bars.length; n++) if (Math.abs(bars[n].t + iv / 2 - tt) < Math.abs(bars[k].t + iv / 2 - tt)) k = n;
      const b = bars[k], x = X(b.t + iv / 2);
      xl.setAttribute('x1', x); xl.setAttribute('x2', x); xl.setAttribute('opacity', '0.7');
      dot.setAttribute('cx', x); dot.setAttribute('cy', Y(b.c)); dot.setAttribute('fill', b.c >= b.o ? UP : DN); dot.setAttribute('opacity', '1');
      opts.onScrub && opts.onScrub(b, k);
    };
    const reset = () => { xl.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); opts.onReset && opts.onReset(); };
    hit.addEventListener('mousemove', e => move(e.clientX));
    hit.addEventListener('mouseleave', reset);
    hit.addEventListener('touchstart', e => e.touches[0] && move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchmove', e => e.touches[0] && move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchend', reset);
  }

  // The 1D header for bars: the last price against the prior close, then the regular session's move and
  // the extended-hours move separately (as a broker shows "Today" and "After hours").
  function barsSummary(bd, fmtV) {
    const bars = bd.bars, pc = bd.prevClose, last = bars[bars.length - 1];
    const reg = bars.filter(b => sessionOf(b.t) === 'reg'), regClose = reg.length ? reg[reg.length - 1].c : null;
    const seg = (a, b, name) => { if (!(a > 0) || !(b > 0)) return ''; const d = b - a, p = d / a * 100;
      return `<span style="color:${d >= 0 ? 'var(--pos)' : 'var(--neg)'}">${d >= 0 ? '▲' : '▼'} ${d >= 0 ? '+' : '−'}${fmtV(Math.abs(d)).replace(/^-/, '')} (${p >= 0 ? '+' : ''}${p.toFixed(2)}%)</span> ${name}`; };
    const parts = [];
    const ls = sessionOf(last.t);
    if (regClose != null) parts.push(seg(pc, regClose, 'Today'));
    if (ls === 'post' && regClose != null) parts.push(seg(regClose, last.c, 'After hours'));
    if (ls === 'pre') parts.push(seg(pc, last.c, 'Pre-market'));
    return parts.filter(Boolean).join(' · ') + ` <span style="color:var(--ink-faint)">· ${esc(etClock(last.t + 5 * 60000))}</span>`;
  }

  async function mountSeriesChart(host, cfg) {
    if (!host) return;
    const st = SC[cfg.key] || (SC[cfg.key] = { range: cfg.range || '1Y', interval: 'D', intraday: undefined, barsAt: 0 });
    if (st.ticker !== cfg.ticker) { st.ticker = cfg.ticker; st.intraday = undefined; st.bars = undefined; st.barsAt = 0; }
    const daily = (cfg.daily || []).filter(b => b && b.d && b.c > 0).map(b => ({ t: b.d, v: +b.c }));
    if (!daily.length) { host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:16px 0">No price history.</div>'; return; }
    // z131: today's price when the daily history lags (it is written after the close)
    if (cfg.live && cfg.live.v > 0 && cfg.live.d && cfg.live.d > daily[daily.length - 1].t) daily.push({ t: cfg.live.d, v: +cfg.live.v, _live: cfg.live.label || 'latest quote' });
    const fmtV = cfg.fmt || (v => '$' + v.toFixed(2));
    const keys = cfg.ranges || RANGES.map(x => x[0]);
    const span = k => (RANGES.find(x => x[0] === k) || [k, EXTRA_RANGES[k]])[1];
    if (!keys.includes(st.range)) st.range = cfg.range && keys.includes(cfg.range) ? cfg.range : keys[keys.length - 1];
    const draw = async () => {
      if (!host.isConnected) return;
      const avail = ivalsFor(st.range), ivl = effInterval(st.interval, avail);
      let pts = [], label = '', bd = null;
      if (st.range === '1D') {
        if (cfg.bars !== false && cfg.ticker && (st.bars === undefined || Date.now() - st.barsAt > 120000)) {
          try { st.bars = await fetchBars(cfg.ticker); } catch (e) { st.bars = null; }
          st.barsAt = Date.now();
        }
        bd = st.bars || null;
        if (bd && cfg.tx) bd = Object.assign({}, bd, { prevClose: bd.prevClose > 0 ? cfg.tx(bd.prevClose) : null, oo: bd.oo > 0 ? cfg.tx(bd.oo) : null, oc: bd.oc > 0 ? cfg.tx(bd.oc) : null,
          bars: bd.bars.map(b => { const o = cfg.tx(b.o), c = cfg.tx(b.c), h1 = cfg.tx(b.h), l1 = cfg.tx(b.l); return { t: b.t, o, c, h: Math.max(h1, l1), l: Math.min(h1, l1), v: b.v }; }) });
        st.mode1d = st.mode1d || 'line';
        if (bd && st.mode1d === 'line') {                     // z135: 0930 official open → 5-min closes → 1600 official close
          pts = barsLine(bd);
          st.lineBase = bd.prevClose > 0 ? bd.prevClose : null;
          label = `${bd.date} · 0930–1600 ET · 5-min bars`;
          if (pts.length < 2) { pts = []; label = `${bd.date} · the session opens at 0930 ET`; }
        } else st.lineBase = null;
        if (!bd) {
          if (st.intraday === undefined) st.intraday = cfg.ticker ? await seriesIntraday(cfg.ticker, daily) : null;
          pts = st.intraday ? st.intraday.points : [];
          label = st.intraday ? `${st.intraday.date} · regular session, 0930–${st.intraday.closeMin === 780 ? '1300' : '1600'} ET (15-min tape)` : 'no intraday data for the latest session';
        }
      } else {
        pts = windowed(daily, span(st.range));
        if (ivl !== 'D') pts = resample(pts, ivl);
        label = st.range === 'ALL' ? `since ${daily[0].t}` : st.range;
        if (cfg.onWindow) { try { cfg.onWindow(pts, st.range, ivl); } catch (e) {} }
      }
      const bar = keys.map(k => `<button class="seg-btn ${st.range === k ? 'active' : ''}" data-vcr="${k}" style="font-size:10px">${k}</button>`).join('');
      host.innerHTML = `<div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase">${esc(cfg.title || cfg.ticker || '')}</div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:3px;flex-wrap:wrap">
            <span data-vc-price style="font-family:var(--mono);font-size:30px;font-weight:800;line-height:1">—</span>
            <span data-vc-pct style="font-family:var(--mono);font-size:14px;font-weight:700">—</span></div>
          <div data-vc-sub style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:2px"></div></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 4px"><span class="seg-control" style="font-size:10px">${bar}</span>${ivlBar(avail, ivl, 'data-vci')}${bd ? `<span class="seg-control" style="font-size:10px;margin-left:6px"><button class="seg-btn ${st.mode1d === 'line' ? 'active' : ''}" data-vcm="line" style="font-size:10px">Line</button><button class="seg-btn ${st.mode1d === 'candles' ? 'active' : ''}" data-vcm="candles" style="font-size:10px">Candles</button></span>` : ''}</div>
        <div class="vc-chart"></div>${cfg.note ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">${cfg.note}</div>` : ''}`;
      const pe = host.querySelector('[data-vc-price]'), ce = host.querySelector('[data-vc-pct]'), se = host.querySelector('[data-vc-sub]');
      const setHeader = (v, base, sub, html) => {
        if (!(v > 0) || !(base > 0)) return;
        const ch = (v / base - 1) * 100, good = cfg.upIsBad ? ch <= 0 : ch >= 0, c = good ? 'var(--pos)' : 'var(--neg)';   // z132: a spread or yield rising is bad news
        pe.textContent = fmtV(v); pe.style.color = c;
        ce.textContent = cfg.changeFmt ? cfg.changeFmt(v, base) : (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'; ce.style.color = c;   // z132: bp for spreads
        if (html) se.innerHTML = sub; else se.textContent = sub;
      };
      if (bd && st.mode1d === 'candles') {
        const last = bd.bars[bd.bars.length - 1], base = bd.prevClose > 0 ? bd.prevClose : bd.bars[0].o;
        const rest = () => setHeader(last.c, base, barsSummary(bd, fmtV) + ' · scrub the chart', true);
        drawCandleChart(host.querySelector('.vc-chart'), bd, { us: usExtended(cfg.ticker), axisFmt: cfg.axisFmt, label: (cfg.title || cfg.ticker) + ' today',
          onScrub: b => setHeader(b.c, base, `${etClock(b.t)} · ${SESSION_NAME[sessionOf(b.t)]} · O ${fmtV(b.o)} H ${fmtV(b.h)} L ${fmtV(b.l)} C ${fmtV(b.c)}${b.v ? ' · vol ' + b.v.toLocaleString() : ''}`), onReset: rest });
        rest();
      } else {
        // z134: on 1D the line starts at the official open but the change is from the previous close (dotted)
        const pc1d = st.range !== '1D' ? null : st.lineBase > 0 ? st.lineBase : (st.intraday && st.intraday.prevClose > 0 ? (cfg.tx ? cfg.tx(st.intraday.prevClose) : st.intraday.prevClose) : null);
        const baseV = () => pc1d || (pts[0] && pts[0].v);
        const offNote = st.range === '1D' && st.intraday ? [st.intraday.open ? `open ${fmtV(cfg.tx ? cfg.tx(st.intraday.open) : st.intraday.open)}` : '', st.intraday.close ? `close ${fmtV(cfg.tx ? cfg.tx(st.intraday.close) : st.intraday.close)}` : ''].filter(Boolean).join(' · ') : '';
        const resetHeader = () => {
          if (!pts.length) return null;
          if (bd && st.mode1d === 'line') return setHeader(pts[pts.length - 1].v, baseV(), barsSummary(bd, fmtV) + ` · <span style="color:var(--ink-faint)">${esc(label)} · scrub the chart</span>`, true);
          return setHeader(pts[pts.length - 1].v, baseV(), (pts[pts.length - 1]._live ? `${pts[pts.length - 1].t} · ${pts[pts.length - 1]._live} · ` : '') + label + (offNote ? ` · official ${offNote} (Yahoo)` : '') + ' · scrub the chart');
        };
        drawStockChart(host.querySelector('.vc-chart'), pts, Object.assign({ label: cfg.title || cfg.ticker, empty: label, axisFmt: cfg.axisFmt, isUp: cfg.upIsBad ? ((p, f) => p.v <= f.v) : undefined,
          onScrub: p => setHeader(p.v, baseV(), (p._live ? `${p.t} · ${p._live}` : whenLabel(p, ivl, st.range === '1D'))), onReset: resetHeader },
          pc1d ? { isUp: p => (cfg.upIsBad ? p.v <= pc1d : p.v >= pc1d), baseline: pc1d, baselineLabel: 'previous close' } : {}));
        resetHeader();
      }
      host.querySelectorAll('[data-vcr]').forEach(b => b.onclick = () => { st.range = b.dataset.vcr; draw(); });
      host.querySelectorAll('[data-vci]').forEach(b => b.onclick = () => { st.interval = b.dataset.vci; draw(); });
      host.querySelectorAll('[data-vcm]').forEach(b => b.onclick = () => { st.mode1d = b.dataset.vcm; draw(); });
      // z135: while 1D is on screen between 0400 and 2005 ET, re-read the bars / tape every minute -
      // the 0930 open and the 1600 close appear as soon as the pipeline commits them (~1 minute after)
      clearTimeout(st.timer);
      if (st.range === '1D') st.timer = setTimeout(() => {
        if (!host.isConnected || st.range !== '1D') return;
        const m = etMin(Date.now());
        if (document.visibilityState === 'visible' && m >= 240 && m <= 1205) { st.bars = undefined; st.barsAt = 0; st.intraday = undefined; }
        draw();
      }, 60000);
    };
    await draw();
  }


  window.VChart = { fetchDaily, fetchTapeDay, drawStockChart, mountSeriesChart, drawCandleChart, fetchBars, usExtended, sessionOf, mountFlowChart, withReturns, windowed, resample, indexDaily, indexIntraday, mountGoodGlobeChart, mountSparks, accountSeries, mountAccountChart,
                    accountIntraday, withReturns, ivalsFor, effInterval, whenLabel, _gg: GG, _acc: ACC };
})();
