/* ==========================================================================
   datatab.js — DATA tab: multi-view data explorer (z95, WIP v1)

   Datasets (v1):
     • Implied-volatility surface — moneyness (strike ÷ spot, 80–120%) × expiry
       × implied vol, from the ticker's options chain (TRAPP2-OPTIONS, falling
       back to TRAPP2). Out-of-the-money side only (puts below spot, calls at
       or above) — the standard way a smile/skew surface is built — linearly
       interpolated onto the moneyness grid; never extrapolated (gaps stay gaps).
     • Treasury yield curve over time — maturity (1M…30Y) × month-end × yield,
       from FRED (TRAPP2-1 data/macro/DGS*.json): "data like this in times".
     • Catalog — every dataset the platform keeps, its source, cadence and age.
   Views: 3D surface (drag / swipe to rotate, tap for a readout), heat map,
   table.

   3D renderer: exact perspective projection of the (x, y, z) grid — world
   axes x = first dimension, y = second (depth), z = value (up); yaw about z,
   pitch about x, pinhole camera at distance D with focal length F. Quads are
   painted far-to-near (painter's algorithm on the quad centroid depth), the
   two walls and the floor farthest from the camera are drawn as reference
   planes, and every tick label is placed by the same projection as the mesh,
   so labels sit exactly on their grid lines.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RAW = () => { try { if (typeof GH_RAW !== 'undefined') return GH_RAW; } catch (e) {} return 'https://raw.githubusercontent.com/TheMostLocal'; };
  const css = (name, fb) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } };

  // ---------------------------------------------------------------- colour --
  // low → high: green → yellow → orange → red (as in the reference surface)
  const STOPS = [[0, [110, 230, 70]], [0.35, [235, 230, 80]], [0.7, [240, 150, 50]], [1, [220, 55, 40]]];
  function colorAt(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], u = (t - t0) / (t1 - t0);
        return c0.map((v, k) => Math.round(v + (c1[k] - v) * u));
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // ------------------------------------------------------------- 3D surface --
  function Surface3D(canvas, ds, onPick) {
    const st = { yaw: -0.62, pitch: 0.52, D: 4.2, picked: null };
    const nx = ds.xs.length, ny = ds.ys.length;
    const vals = ds.z.flat().filter(v => v != null && isFinite(v));
    const zmin = Math.min(...vals), zmax = Math.max(...vals);
    const zlo = Math.floor(zmin / ds.zStep) * ds.zStep, zhi = Math.ceil(zmax / ds.zStep) * ds.zStep || zlo + ds.zStep;
    // world coordinates: x,y in [-1,1], z in [0, H]
    const H = 1.05;
    const X = i => -1 + 2 * (ds.xScale === 'value' ? (ds.xs[i] - ds.xs[0]) / (ds.xs[nx - 1] - ds.xs[0] || 1) : i / Math.max(1, nx - 1));
    const Y = j => -1 + 2 * j / Math.max(1, ny - 1);
    const Z = v => H * (v - zlo) / (zhi - zlo || 1);
    let W = 0, Hpx = 0, F = 0, cx = 0, cy = 0, dpr = 1;
    function size() {
      dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      W = canvas.clientWidth; Hpx = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hpx * dpr);
      F = Math.min(W, Hpx * 1.5) * 1.35; cx = W / 2; cy = Hpx * 0.56;
    }
    function proj(x, y, z) {
      const cyw = Math.cos(st.yaw), syw = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
      const x1 = x * cyw - y * syw, y1 = x * syw + y * cyw;          // yaw about z
      const zc = z - H / 2;                                            // rotate about the box centre
      // pitch about x: camera raised by `pitch` above the floor plane, looking
      // down at the box - near points (y1 < 0) project lower, high points nearer
      const y2 = y1 * cp - zc * sp, z2 = y1 * sp + zc * cp;
      const depth = st.D + y2;
      return { x: cx + F * x1 / depth, y: cy - F * z2 / depth, d: depth };
    }
    // Fit: scale + centre so the whole box (plus label margin) is visible at the
    // current rotation - projected once at F=1 around the origin, then solved.
    function fit() {
      const save = [F, cx, cy];
      F = 1; cx = 0; cy = 0;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const x of [-1.25, 1.25]) for (const y of [-1.25, 1.25]) for (const z of [0, H * 1.12]) {
        const p = proj(x, y, z); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      const padX = 54, padY = 30;
      F = Math.min((W - 2 * padX) / (x1 - x0 || 1), (Hpx - 2 * padY) / (y1 - y0 || 1));
      cx = W / 2 - F * (x0 + x1) / 2; cy = Hpx / 2 - F * (y0 + y1) / 2;
      return save;
    }
    function draw() {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Hpx);
      fit();
      const ink = css('--ink-faint', '#8a8578'), rule = 'rgba(255,255,255,0.14)', label = css('--ink-dim', '#b8b1a4');
      ctx.font = '10px ' + (css('--mono', 'monospace') || 'monospace');
      ctx.lineWidth = 1;
      // which walls are behind? the side whose centre is deeper
      const xWall = proj(-1, 0, H / 2).d > proj(1, 0, H / 2).d ? -1 : 1;
      const yWall = proj(0, -1, H / 2).d > proj(0, 1, H / 2).d ? -1 : 1;
      const poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } };
      const line = (a, b, col) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = col; ctx.stroke(); };
      // floor + walls with grid lines
      poly([proj(-1, -1, 0), proj(1, -1, 0), proj(1, 1, 0), proj(-1, 1, 0)], 'rgba(255,255,255,0.035)', rule);
      poly([proj(xWall, -1, 0), proj(xWall, 1, 0), proj(xWall, 1, H), proj(xWall, -1, H)], 'rgba(255,255,255,0.03)', rule);
      poly([proj(-1, yWall, 0), proj(1, yWall, 0), proj(1, yWall, H), proj(-1, yWall, H)], 'rgba(255,255,255,0.03)', rule);
      for (let i = 0; i < nx; i++) { line(proj(X(i), -1, 0), proj(X(i), 1, 0), rule); line(proj(X(i), yWall, 0), proj(X(i), yWall, H), rule); }
      for (let j = 0; j < ny; j++) { line(proj(-1, Y(j), 0), proj(1, Y(j), 0), rule); line(proj(xWall, Y(j), 0), proj(xWall, Y(j), H), rule); }
      const zt = [];
      for (let v = zlo; v <= zhi + 1e-9; v += ds.zStep) zt.push(v);
      for (const v of zt) { line(proj(xWall, -1, Z(v)), proj(xWall, 1, Z(v)), rule); line(proj(-1, yWall, Z(v)), proj(1, yWall, Z(v)), rule); }
      // mesh quads, far to near
      const quads = [];
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        if (c.some(([a, b]) => ds.z[b][a] == null)) continue;
        const pts = c.map(([a, b]) => proj(X(a), Y(b), Z(ds.z[b][a])));
        const mean = c.reduce((s, [a, b]) => s + ds.z[b][a], 0) / 4;
        quads.push({ pts, d: pts.reduce((s, p) => s + p.d, 0) / 4, t: (mean - zmin) / (zmax - zmin || 1) });
      }
      quads.sort((a, b) => b.d - a.d);
      for (const q of quads) poly(q.pts, rgb(colorAt(q.t), 0.93), 'rgba(40,30,20,0.45)');
      // axis labels on the near edges
      const xEdgeY = -yWall, yEdgeX = -xWall;
      ctx.fillStyle = label;
      const tick = (p, txt, dx, dy, align) => { ctx.textAlign = align; ctx.fillText(txt, p.x + dx, p.y + dy); };
      const xStep = Math.max(1, Math.ceil(nx / 6)), yStep = Math.max(1, Math.ceil(ny / 7));
      for (let i = 0; i < nx; i += xStep) tick(proj(X(i), xEdgeY * 1.08, 0), ds.xTick(ds.xs[i]), 0, 12, 'center');
      for (let j = 0; j < ny; j += yStep) tick(proj(yEdgeX * 1.06, Y(j), 0), ds.yTick(ds.ys[j]), yEdgeX > 0 ? 4 : -4, 4, yEdgeX > 0 ? 'left' : 'right');
      for (const v of zt) { const p = proj(xWall, -yWall * 1.04, Z(v)); tick(p, ds.zFmt(v), xWall < 0 ? -4 : 4, 3, xWall < 0 ? 'right' : 'left'); }
      ctx.fillStyle = ink; ctx.font = '10px ' + (css('--mono', 'monospace') || 'monospace');
      // axis titles sit past the ends of their tick rows, never on top of them
      const xl = proj(0, xEdgeY * 1.32, 0), yl = proj(yEdgeX * 1.06, yWall * 1.3, 0);
      tick(xl, ds.xLabel, 0, 14, 'center'); tick(yl, ds.yLabel, yEdgeX > 0 ? 4 : -4, 0, yEdgeX > 0 ? 'left' : 'right');
      tick(proj(xWall, -yWall * 1.04, H * 1.08), ds.zLabel, 0, 0, 'center');
      // picked point
      if (st.picked) {
        const { i, j } = st.picked, v = ds.z[j][i];
        if (v != null) {
          const p = proj(X(i), Y(j), Z(v));
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = '#000'; ctx.stroke();
        }
      }
    }
    function pick(px, py) {
      let best = null;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = ds.z[j][i]; if (v == null) continue;
        const p = proj(X(i), Y(j), Z(v)), d = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (!best || d < best.d) best = { i, j, d };
      }
      if (best && best.d < 900) { st.picked = best; onPick && onPick(ds.xs[best.i], ds.ys[best.j], ds.z[best.j][best.i]); draw(); }
    }
    // interaction: drag to rotate, tap to read a point
    let drag = null;
    const pos = e => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const down = e => { drag = { ...pos(e), yaw: st.yaw, pitch: st.pitch, moved: false }; };
    const move = e => {
      if (!drag) return;
      const p = pos(e), dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      st.yaw = drag.yaw + dx * 0.01;
      st.pitch = Math.max(0.08, Math.min(1.35, drag.pitch + dy * 0.008));
      draw();
      if (e.cancelable) e.preventDefault();
    };
    const up = e => { if (drag && !drag.moved) pick(drag.x, drag.y); drag = null; };
    canvas.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: true }); canvas.addEventListener('touchmove', move, { passive: false }); canvas.addEventListener('touchend', up);
    canvas.style.touchAction = 'none';
    size(); draw();
    const ro = window.ResizeObserver ? new ResizeObserver(() => { size(); draw(); }) : null;
    if (ro) ro.observe(canvas);
    return { reset() { st.yaw = -0.62; st.pitch = 0.52; draw(); }, redraw: draw, state: st };
  }

  // --------------------------------------------------------------- datasets --
  async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

  async function ivSurface(ticker) {
    let data = null;
    try { if (typeof loadOptionsForTicker === 'function') data = await loadOptionsForTicker(ticker); } catch (e) {}
    if (!data) for (const repo of ['TRAPP2-OPTIONS', 'TRAPP2', 'TRAPP2-2', 'TRAPP2-3']) {
      try { data = await getJSON(`${RAW()}/${repo}/main/data/options/${encodeURIComponent(ticker)}.json`); break; } catch (e) {}
    }
    if (!data || !data.spot || !(data.expiries || []).length) return { error: `No options chain for ${ticker} yet — request it from Valuation → Options.` };
    const S = +data.spot;
    const xs = [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20];
    const rows = [];
    for (const e of [...data.expiries].sort((a, b) => (a.dte || 0) - (b.dte || 0)).slice(0, 12)) {
      const pts = [...(e.puts || []).filter(o => o.strike < S), ...(e.calls || []).filter(o => o.strike >= S)]
        .filter(o => +o.iv > 0.01 && +o.iv < 5).map(o => [o.strike / S, o.iv * 100]).sort((a, b) => a[0] - b[0]);
      if (pts.length < 3) continue;
      const row = xs.map(m => {
        if (m < pts[0][0] || m > pts[pts.length - 1][0]) return null;           // no extrapolation
        for (let k = 1; k < pts.length; k++) if (m <= pts[k][0]) {
          const [m0, v0] = pts[k - 1], [m1, v1] = pts[k];
          return +(v0 + (v1 - v0) * (m1 === m0 ? 0 : (m - m0) / (m1 - m0))).toFixed(2);
        }
        return null;
      });
      if (row.filter(v => v != null).length >= 3) rows.push({ y: e.expiry, row });
    }
    if (rows.length < 2) return { error: `${ticker}'s chain is too thin for a surface (need 2+ expiries with 3+ priced strikes).` };
    return { title: `${ticker} implied-volatility surface`, sub: `spot $${S.toFixed(2)} · ${rows.length} expiries · OTM puts below spot, calls above · as of ${esc(String(data.asOf || '').slice(0, 16))}`,
      xs, ys: rows.map(r => r.y), z: rows.map(r => r.row), xScale: 'value',
      xLabel: 'Moneyness', yLabel: 'Term', zLabel: 'IV %', zStep: 5,
      xTick: v => `${Math.round(v * 100)}%`, yTick: v => new Date(v + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }),
      zFmt: v => v.toFixed(0), cell: v => v == null ? '—' : v.toFixed(1) + '%' };
  }

  const MATS = [['DGS1MO', '1M'], ['DGS3MO', '3M'], ['DGS6MO', '6M'], ['DGS1', '1Y'], ['DGS2', '2Y'], ['DGS3', '3Y'], ['DGS5', '5Y'], ['DGS7', '7Y'], ['DGS10', '10Y'], ['DGS20', '20Y'], ['DGS30', '30Y']];
  async function yieldSurface(months) {
    const base = `${RAW()}/TRAPP2-1/main/data/macro/`;
    const series = await Promise.all(MATS.map(async ([id]) => { try { const j = await getJSON(base + id + '.json'); return (j.observations || []).filter(o => isFinite(+o.value)); } catch (e) { return []; } }));
    if (series.every(s => !s.length)) return { error: 'No FRED yield data (TRAPP2-1 data/macro/DGS*.json) yet.' };
    const last = series.reduce((m, s) => (s.length && s[s.length - 1].date > m ? s[s.length - 1].date : m), '');
    const ends = [];
    const d0 = new Date(last + 'T00:00:00Z');
    for (let k = months - 1; k >= 0; k--) { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - k + 1, 0)); ends.push(k === 0 ? last : d.toISOString().slice(0, 10)); }
    const at = (s, day) => { let v = null; for (const o of s) { if (o.date <= day) v = +o.value; else break; } return v; };
    const z = ends.map(day => series.map(s => (s.length ? at(s, day) : null)));
    return { title: 'US Treasury yield curve over time', sub: `${MATS.length} maturities · month-end · ${ends[0]} → ${last} · FRED`,
      xs: MATS.map(m => m[1]), ys: ends, z, xScale: 'index', xLabel: 'Maturity', yLabel: 'Date', zLabel: 'Yield %', zStep: 0.5,
      xTick: v => v, yTick: v => new Date(v + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      zFmt: v => v.toFixed(1), cell: v => v == null ? '—' : v.toFixed(2) + '%' };
  }

  const CATALOG = [
    ['Stock Book (4 books)', 'TRAPP2 · -1 · -2 · -3 / data/master.json', 'intraday (15 min) + nightly', 'TRAPP2/main/data/master.json'],
    ['Daily price history (20y)', '<book>/data/history/<T>.json', 'nightly', 'TRAPP2/main/data/history/SPY.json'],
    ['Intraday tape', '<book>/data/intraday/<date>.json', 'every 15 min, market hours', null],
    ['Macro (FRED, 42 series)', 'TRAPP2-1/data/macro/<ID>.json', 'mid-day', 'TRAPP2-1/main/data/macro/DGS10.json'],
    ['Quad (nowcast + official)', 'TRAPP2-1/data/macro/quad.json', 'daily', 'TRAPP2-1/main/data/macro/quad.json'],
    ['Regime + history', 'TRAPP2-1/data/regime_current.json · regime_history.json', 'mid-day', 'TRAPP2-1/main/data/regime_current.json'],
    ['Regime certainty', 'TRAPP2-1/data/regime_certainty.json', 'mid-day', 'TRAPP2-1/main/data/regime_certainty.json'],
    ['Fed monitor (H.4.1, FOMC, speeches, SOMA)', 'TRAPP2-1/data/fed/monitor.json', 'around each release', 'TRAPP2-1/main/data/fed/monitor.json'],
    ['FX rates', 'TRAPP2-1/data/fx/rates.json', 'daily', 'TRAPP2-1/main/data/fx/rates.json'],
    ['Options chains + summary', 'TRAPP2-OPTIONS/data/options/', 'core 3×/day · broad daily', 'TRAPP2-OPTIONS/main/data/options/summary.json'],
    ['Patterns & templates', 'TRAPP2-ANALYTICS/data/patterns/', 'analytics refresh (2×/day)', 'TRAPP2-ANALYTICS/main/data/patterns/stats.json'],
    ['Research grades', 'TRAPP2-ANALYTICS/data/research_grades.json', 'analytics refresh', 'TRAPP2-ANALYTICS/main/data/research_grades.json'],
    ['News corpus', 'TRAPP2-ANALYTICS/data/news/latest.json', 'analytics refresh', 'TRAPP2-ANALYTICS/main/data/news/latest.json'],
    ['Bot journal + equity', 'TRAPP2-BOT/data/bot_training_data.json', 'daily run + 30-min equity tape', 'TRAPP2-BOT/main/data/bot_training_data.json'],
    ['Portfolio snapshot', 'TRAPP2-PORT/data/portfolio_data.json', 'on Save to Repo', 'TRAPP2-PORT/main/data/portfolio_data.json'],
    ['Human corrections (XTRAPP)', 'XTRAPP/data/xtrapp_data.json', 'on every correction', 'XTRAPP/main/data/xtrapp_data.json'],
  ];

  // ------------------------------------------------------------------ views --
  function heatHtml(ds) {
    const vals = ds.z.flat().filter(v => v != null), lo = Math.min(...vals), hi = Math.max(...vals);
    return `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-family:var(--mono);font-size:10px;min-width:max-content">
      <thead><tr><th style="padding:4px 8px;text-align:left;color:var(--ink-faint)">${esc(ds.yLabel)} \\ ${esc(ds.xLabel)}</th>${ds.xs.map(x => `<th style="padding:4px 6px;color:var(--ink-dim)">${esc(ds.xTick(x))}</th>`).join('')}</tr></thead>
      <tbody>${ds.ys.map((y, j) => `<tr><td style="padding:3px 8px;color:var(--ink-dim);white-space:nowrap">${esc(ds.yTick(y))}</td>${ds.xs.map((x, i) => { const v = ds.z[j][i];
        if (v == null) return '<td style="padding:3px 6px;text-align:center;color:var(--ink-faint)">·</td>';
        const c = colorAt((v - lo) / (hi - lo || 1)); return `<td style="padding:3px 6px;text-align:center;background:${rgb(c, 0.85)};color:#111">${esc(ds.cell(v))}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function tableHtml(ds) {
    return `<div style="overflow-x:auto"><table class="sb-table" style="font-size:10.5px;min-width:max-content"><thead><tr><th>${esc(ds.yLabel)}</th>${ds.xs.map(x => `<th>${esc(ds.xTick(x))}</th>`).join('')}</tr></thead>
      <tbody>${ds.ys.map((y, j) => `<tr><td>${esc(y)}</td>${ds.z[j].map(v => `<td>${esc(ds.cell(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  const S = { dataset: 'iv', view: '3d', ticker: null, months: 36, surf: null, cache: {} };
  async function render() {
    const host = document.getElementById('data-tab-body');
    if (!host) return;
    let tk = S.ticker;
    if (!tk) { try { tk = (typeof state !== 'undefined' && state.stock && state.stock.ticker) || 'SPY'; } catch (e) { tk = 'SPY'; } }
    S.ticker = String(tk).toUpperCase();
    const seg = (key, opts) => `<span class="seg-control" style="font-size:10px">${opts.map(([v, l]) => `<button class="seg-btn ${S[key] === v ? 'active' : ''}" data-dt-${key}="${v}">${l}</button>`).join('')}</span>`;
    host.innerHTML = `<div class="section-title" style="margin-bottom:6px">Data <small>datasets · tables · heat maps · 3D surfaces · WIP</small></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0">
        ${seg('dataset', [['iv', 'IV surface'], ['yield', 'Yield curve'], ['catalog', 'Catalog']])}
        ${S.dataset !== 'catalog' ? seg('view', [['3d', '3D'], ['heat', 'Heat map'], ['table', 'Table']]) : ''}
        ${S.dataset === 'iv' ? `<input id="dt-ticker" value="${esc(S.ticker)}" style="width:80px;background:var(--bg-elev);border:1px solid var(--rule);color:var(--ink);padding:5px 6px;border-radius:4px;font-family:var(--mono);font-size:11px;text-transform:uppercase"><button class="btn" id="dt-go" style="padding:5px 10px;font-size:10px">Load</button>` : ''}
        ${S.dataset === 'yield' ? seg('months', [[12, '1Y'], [36, '3Y'], [60, '5Y'], [120, '10Y']]) : ''}
      </div>
      <div id="dt-title" style="font-family:var(--mono);font-size:11px;color:var(--ink)"></div>
      <div id="dt-sub" style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-bottom:6px"></div>
      <div id="dt-view"></div>
      <div id="dt-readout" style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);min-height:16px;margin-top:6px"></div>`;
    host.querySelectorAll('[data-dt-dataset]').forEach(b => b.onclick = () => { S.dataset = b.dataset.dtDataset; render(); });
    host.querySelectorAll('[data-dt-view]').forEach(b => b.onclick = () => { S.view = b.dataset.dtView; render(); });
    host.querySelectorAll('[data-dt-months]').forEach(b => b.onclick = () => { S.months = +b.dataset.dtMonths; render(); });
    const go = $('#dt-go'); if (go) { go.onclick = () => { S.ticker = ($('#dt-ticker').value || '').trim().toUpperCase() || S.ticker; render(); }; $('#dt-ticker').onkeydown = e => { if (e.key === 'Enter') go.click(); }; }
    const view = $('#dt-view');
    if (S.dataset === 'catalog') return renderCatalog(view);
    view.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading…</div>';
    const key = S.dataset === 'iv' ? 'iv:' + S.ticker : 'yield:' + S.months;
    const ds = S.cache[key] || (S.cache[key] = await (S.dataset === 'iv' ? ivSurface(S.ticker) : yieldSurface(S.months)));
    if (!document.getElementById('dt-view')) return;
    if (ds.error) { delete S.cache[key]; view.innerHTML = `<div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);padding:16px 0">${esc(ds.error)}</div>`; return; }
    $('#dt-title').textContent = ds.title; $('#dt-sub').innerHTML = ds.sub;
    if (S.view === 'heat') { view.innerHTML = heatHtml(ds); return; }
    if (S.view === 'table') { view.innerHTML = tableHtml(ds); return; }
    view.innerHTML = `<div style="position:relative;background:linear-gradient(#2a2a2a,#121212);border:1px solid var(--rule);border-radius:6px">
        <canvas id="dt-canvas" style="width:100%;height:${window.innerWidth < 600 ? 340 : 460}px;display:block"></canvas>
        <button class="btn btn-ghost" id="dt-reset" style="position:absolute;right:8px;top:8px;padding:3px 8px;font-size:9px">Reset view</button></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">Drag / swipe to rotate · tap a point for its value · colour = value (green low → red high)</div>`;
    const ro = $('#dt-readout');
    S.surf = Surface3D($('#dt-canvas'), ds, (x, y, v) => { ro.innerHTML = `${esc(ds.xLabel)} <strong>${esc(ds.xTick(x))}</strong> · ${esc(ds.yLabel)} <strong>${esc(ds.yTick(y))}</strong> · ${esc(ds.zLabel)} <strong style="color:var(--ink)">${esc(ds.cell(v))}</strong>`; });
    $('#dt-reset').onclick = () => S.surf.reset();
  }
  async function renderCatalog(view) {
    view.innerHTML = `<div style="overflow-x:auto"><table class="sb-table" style="font-size:10.5px;min-width:max-content"><thead><tr><th>Dataset</th><th>Where</th><th>Refresh</th><th>Last update</th><th></th></tr></thead><tbody>
      ${CATALOG.map(([n, where, cad, url], k) => `<tr><td>${esc(n)}</td><td style="color:var(--ink-faint)">${esc(where)}</td><td>${esc(cad)}</td><td id="dt-age-${k}" style="color:var(--ink-faint)">${url ? '…' : '—'}</td>
        <td>${url ? `<a href="${RAW()}/${url}" target="_blank" rel="noopener" style="color:var(--ink-faint)">JSON ↗</a>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px">"Last update" reads each file's own timestamp; files over ~2 MB are linked, not opened.</div>`;
    const SMALL = /regime_|quad\.json|monitor\.json|rates\.json|summary\.json|stats\.json|DGS10|SPY\.json/;
    CATALOG.forEach(async ([, , , url], k) => {
      const cell = document.getElementById('dt-age-' + k);
      if (!url || !cell) return;
      if (!SMALL.test(url)) { cell.textContent = 'open to view'; return; }
      try {
        const j = await getJSON(`${RAW()}/${url}`);
        const t = Array.isArray(j) ? (j[j.length - 1] || {}).date : (j.generatedAt || j.generated_at || j.asOf || j.date || j.fetched_at || j.updated || j.computed_at || (j.observations ? j.observations[j.observations.length - 1].date : null));
        cell.textContent = t ? String(t).slice(0, 16).replace('T', ' ') : 'no timestamp';
      } catch (e) { cell.textContent = 'not found'; }
    });
  }

  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.tab-btn[data-tab="data"]');
    if (b) setTimeout(render, 30);
  }, true);
  window.DataTab = { render, ivSurface, yieldSurface, Surface3D, colorAt };
})();
