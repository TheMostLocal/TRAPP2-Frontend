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

   v6 (z120) — Yield curve "Curve" view: the daily Treasury curve as a 2D line
   (maturity on a true log or linear axis × yield on one fixed scale for the
   range) with a date scrubber and ▶ play, a comparison curve (1M / 3M / 1Y
   earlier or the range start), Δ-by-maturity bars from a zero baseline, and the
   desk read: 2Y, 10Y, 2s10s, 3m10y, 2s5s10s fly, inversion, and the move
   (bull/bear steepener/flattener, twist, parallel). Catalog: CSV export and the
   surfaces / quad-calls / official-quad files.

   v7 (z126) — "+ Real & breakeven": TIPS real yields beside the nominal curve
   (FRED DFII where the pipeline has it, else nominal − breakeven, which is FRED's
   own definition of T5YIE / T10YIE — so 5y and 10y today), with the breakeven as a
   dotted bracket between the two at each TIPS maturity; 10Y real, 10Y breakeven and
   the 5y5y forward in the read. Under the scrubber, a strip colours every trading
   day by its move (vs 1M / 3M / 1Y earlier) with the share of each move type in the
   range; tap it to jump there. The Regime tab shows the curve as a context card.
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
  function Surface3D(canvas, ds, onPick, cam) {
    // camera state is shared with the caller so it survives re-renders (scrubbing)
    const st = cam || { yaw: -0.62, pitch: 0.52, D: 4.2, picked: null };
    const nx = ds.xs.length, ny = ds.ys.length;
    const vals = ds.z.flat().filter(v => v != null && isFinite(v));
    // A fixed range (ds.zRange) keeps height + colour comparable across time snapshots.
    const zmin = ds.zRange ? ds.zRange[0] : Math.min(...vals), zmax = ds.zRange ? ds.zRange[1] : Math.max(...vals);
    // "nice" tick step so the value axis carries at most ~6 labels
    const zStep = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100].find(st => (zmax - zmin) / st <= 6) || ds.zStep;
    ds = Object.assign({}, ds, { zStep, zFmt: (zStep % 1) ? (v => v.toFixed(zStep < 0.5 ? 2 : 1)) : ds.zFmt });
    // bars start at ZERO (an honest bar height); surfaces start at the data floor
    const zlo = ds.bars ? 0 : Math.floor(zmin / zStep) * zStep, zhi = Math.ceil(zmax / zStep) * zStep || zlo + zStep;
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
      // CATEGORICAL data (ds.bars): one prism per cell - a surface would imply
      // values BETWEEN categories that don't exist. Boxes painted far-to-near,
      // each box's faces far-to-near, top last.
      if (ds.bars) {
        const hx = 0.36 * 2 / Math.max(1, nx - 1), hy = Math.min(0.36 * 2 / Math.max(1, ny - 1), 0.32);
        const boxes = [];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const v = ds.z[j][i]; if (v == null) continue;
          const x = X(i), y = Y(j), h = Z(v), t = (v - zmin) / (zmax - zmin || 1);
          boxes.push({ i, x, y, h, t, d: proj(x, y, h / 2).d });
        }
        boxes.sort((a, b) => b.d - a.d);
        for (const bx of boxes) {
          const dim = st.focus != null && bx.i !== st.focus;            // z133: focus one category
          const c = colorAt(bx.t), sh = f => rgb(c.map(k => Math.round(k * f)), dim ? 0.12 : 0.95);
          const P = (sx, sy, z) => proj(bx.x + sx * hx, bx.y + sy * hy, z);
          const faces = [
            { pts: [P(-1, -1, 0), P(1, -1, 0), P(1, -1, bx.h), P(-1, -1, bx.h)], f: 0.78 },
            { pts: [P(-1, 1, 0), P(1, 1, 0), P(1, 1, bx.h), P(-1, 1, bx.h)], f: 0.78 },
            { pts: [P(-1, -1, 0), P(-1, 1, 0), P(-1, 1, bx.h), P(-1, -1, bx.h)], f: 0.62 },
            { pts: [P(1, -1, 0), P(1, 1, 0), P(1, 1, bx.h), P(1, -1, bx.h)], f: 0.62 },
          ].map(fc => ({ ...fc, d: fc.pts.reduce((s2, q) => s2 + q.d, 0) / 4 })).sort((a, b) => b.d - a.d);
          for (const fc of faces) poly(fc.pts, sh(fc.f), 'rgba(0,0,0,0.35)');
          poly([P(-1, -1, bx.h), P(1, -1, bx.h), P(1, 1, bx.h), P(-1, 1, bx.h)], rgb(c, dim ? 0.14 : 0.97), dim ? null : 'rgba(0,0,0,0.35)');
        }
      }
      // CATEGORICAL x CONTINUOUS (ds.ribbons): one "fence" per category running
      // along the continuous axis, from the zero line to the value - no surface
      // is interpolated BETWEEN categories (e.g. between XLK and XLF).
      if (ds.ribbons) {
        const z0 = Z(Math.max(zlo, Math.min(zhi, 0)));
        const fences = [];
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny - 1; j++) {
          const a = ds.z[j][i], b2 = ds.z[j + 1][i];
          if (a == null || b2 == null) continue;
          const pts = [proj(X(i), Y(j), z0), proj(X(i), Y(j + 1), z0), proj(X(i), Y(j + 1), Z(b2)), proj(X(i), Y(j), Z(a))];
          fences.push({ i, pts, d: pts.reduce((s2, q) => s2 + q.d, 0) / 4, t: ((a + b2) / 2 - zmin) / (zmax - zmin || 1), top: [pts[3], pts[2]] });
        }
        fences.sort((a, b) => b.d - a.d);
        for (const f of fences) {                                            // z133: a focused category stays solid, the rest fade
          const dim = st.focus != null && f.i !== st.focus;
          poly(f.pts, rgb(colorAt(f.t), dim ? 0.07 : st.focus != null ? 0.7 : 0.55), null);
          if (dim) { ctx.save(); ctx.globalAlpha = 0.22; line(f.top[0], f.top[1], rgb(colorAt(f.t), 1)); ctx.restore(); }
          else { ctx.save(); ctx.lineWidth = st.focus != null ? 2 : 1; line(f.top[0], f.top[1], rgb(colorAt(f.t), 1)); ctx.restore(); }
        }
      }
      // mesh quads, far to near
      const quads = [];
      if (!ds.bars && !ds.ribbons) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
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
      const yStep = Math.max(1, Math.ceil(ny / 7));
      if (ds.ribbons || ds.bars || ds.xCategorical) {
        // z133: a CATEGORY axis labels EVERY category (it showed every 3rd: 5 of 14 assets). Try 10 → 9 → 8 px
        // on one row, then two staggered rows, until no two label boxes overlap at this rotation; if
        // nothing fits, still draw them all at 8 px staggered - a category is never dropped.
        const fam = css('--mono', 'monospace') || 'monospace';
        const items = ds.xs.map((x, i) => ({ i, txt: String(ds.xTick(x)), p: proj(X(i), xEdgeY * 1.08, 0) }));
        const clash = (sz, rows) => {
          ctx.font = sz + 'px ' + fam;
          const bx = items.map((it, k) => { const w = ctx.measureText(it.txt).width, dy = 12 + (rows === 2 && k % 2 ? sz + 3 : 0);
            return { x0: it.p.x - w / 2 - 2, x1: it.p.x + w / 2 + 2, y0: it.p.y + dy - sz, y1: it.p.y + dy + 2 }; });
          for (let a = 0; a < bx.length; a++) for (let b = a + 1; b < bx.length; b++)
            if (bx[a].x0 < bx[b].x1 && bx[b].x0 < bx[a].x1 && bx[a].y0 < bx[b].y1 && bx[b].y0 < bx[a].y1) return true;
          return false;
        };
        let fit = null;
        for (const sz of [10, 9, 8]) if (!clash(sz, 1)) { fit = { sz, rows: 1 }; break; }
        if (fit) {
          st.labelFit = fit;
          items.forEach(it => {
            const on = st.focus === it.i;
            ctx.font = (on ? 'bold ' : '') + fit.sz + 'px ' + fam;
            ctx.fillStyle = on ? css('--amber', '#e0b04c') : st.focus != null ? ink : label;
            tick(it.p, it.txt, 0, 12, 'center');
          });
        } else {
          // Too dense for upright labels at this rotation: turn every label PERPENDICULAR to the
          // projected axis, reading outward from the box. Each then needs only its text HEIGHT of
          // axis length (font = tick spacing − 2 px, 7-10 px), so all of them fit side by side.
          const a = items[0].p, b = items[items.length - 1].p, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
          // perspective spaces the ticks unevenly - size the text by the TIGHTEST pair, not the average
          const along = items.map(it => it.p.x * ux + it.p.y * uy);
          let gap = Infinity; for (let k = 1; k < along.length; k++) gap = Math.min(gap, Math.abs(along[k] - along[k - 1]));
          // still too tight (a near edge-on view): alternate labels step outward past their neighbours,
          // so only every SECOND label shares a lane
          const stagger = Math.floor(gap - 1) < 7;
          const sz = Math.max(7, Math.min(10, Math.floor((stagger ? 2 * gap : gap) - 1)));
          const mid = proj(0, 0, 0), am = proj(0, xEdgeY * 1.08, 0);
          let nx2 = -uy, ny2 = ux;                                            // a normal to the axis...
          if (nx2 * (am.x - mid.x) + ny2 * (am.y - mid.y) < 0) { nx2 = -nx2; ny2 = -ny2; }   // ...pointing away from the box
          let ang = Math.atan2(ny2, nx2), align = 'left';
          if (Math.cos(ang) < 0) { ang += Math.PI; align = 'right'; }          // keep text upright
          ctx.font = sz + 'px ' + fam;
          const maxW = Math.max(...items.map(it => ctx.measureText(it.txt).width));
          st.labelFit = { sz, rows: 0, rotated: true, ang, gap, ux, uy, out: [nx2, ny2], maxW: stagger ? 2 * maxW + 6 : maxW, stagger };
          items.forEach((it, k) => {
            const on = st.focus === it.i, off = 4 + (stagger && k % 2 ? maxW + 6 : 0);
            ctx.save();
            ctx.translate(it.p.x + nx2 * off, it.p.y + ny2 * off);
            ctx.rotate(ang);
            ctx.font = (on ? 'bold ' : '') + sz + 'px ' + fam;
            ctx.fillStyle = on ? css('--amber', '#e0b04c') : st.focus != null ? ink : label;
            ctx.textAlign = align; ctx.textBaseline = 'middle';
            ctx.fillText(it.txt, 0, 0);
            ctx.restore();
          });
        }
        ctx.font = '10px ' + fam; ctx.fillStyle = label; ctx.textBaseline = 'alphabetic';
      } else {
        const xStep = Math.max(1, Math.ceil(nx / 6));
        for (let i = 0; i < nx; i += xStep) tick(proj(X(i), xEdgeY * 1.08, 0), ds.xTick(ds.xs[i]), 0, 12, 'center');
      }
      for (let j = 0; j < ny; j += yStep) tick(proj(yEdgeX * 1.06, Y(j), 0), ds.yTick(ds.ys[j]), yEdgeX > 0 ? 4 : -4, 4, yEdgeX > 0 ? 'left' : 'right');
      for (const v of zt) { const p = proj(xWall, -yWall * 1.04, Z(v)); tick(p, ds.zFmt(v), xWall < 0 ? -4 : 4, 3, xWall < 0 ? 'right' : 'left'); }
      ctx.fillStyle = ink; ctx.font = '10px ' + (css('--mono', 'monospace') || 'monospace');
      // axis titles sit past the ends of their tick rows, never on top of them
      const xl = proj(0, xEdgeY * 1.32, 0), yl = proj(yEdgeX * 1.06, yWall * 1.3, 0);
      const lf = st.labelFit;
      if (lf && lf.rotated && (ds.ribbons || ds.bars || ds.xCategorical)) {   // z133: past the rotated labels, not on them
        const m = proj(0, xEdgeY * 1.08, 0);
        tick({ x: m.x + lf.out[0] * (lf.maxW + 16), y: m.y + lf.out[1] * (lf.maxW + 16) }, ds.xLabel, 0, 4, 'center');
      } else tick(xl, ds.xLabel, 0, 14, 'center');
      tick(yl, ds.yLabel, yEdgeX > 0 ? 4 : -4, 0, yEdgeX > 0 ? 'left' : 'right');
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
      if (best && best.d < 900) {
        st.picked = best;
        if (ds.ribbons || ds.bars || ds.xCategorical) st.focus = best.i;          // z133: tapping a point focuses its category
        onPick && onPick(ds.xs[best.i], ds.ys[best.j], ds.z[best.j][best.i], best.i); draw();
      }
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
    return { reset() { st.yaw = -0.62; st.pitch = 0.52; draw(); }, redraw: draw, state: st,
             setFocus(i) { st.focus = (i == null || i === st.focus) ? null : i; st.picked = null; draw(); return st.focus; } };
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
      const pts = smilePoints(e, S).map(([m, v]) => [m, v * 100]);
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
    return { title: `${ticker} implied-volatility surface`, sub: `spot $${S.toFixed(2)} · ${rows.length} expiries · OTM puts below spot, calls above, put/call average within ±2.5%${(data.expiries || []).some(e => e.forward) ? ' · IV from mids on the parity-implied forward' : ''} · as of ${esc(String(data.asOf || '').slice(0, 16))}`,
      xs, ys: rows.map(r => r.y), z: rows.map(r => r.row), xScale: 'value',
      xLabel: 'Moneyness', yLabel: 'Term', zLabel: 'IV %', zStep: 5,
      xTick: v => `${Math.round(v * 100)}%`, yTick: v => new Date(v + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }),
      zFmt: v => v.toFixed(0), cell: v => v == null ? '—' : v.toFixed(1) + '%' };
  }

  // ---- constant maturity (mirror of TRAPP2-OPTIONS update_surface_history) ----
  const CM_M = [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20];
  const CM_T = [7, 14, 30, 60, 90, 180, 365, 730];
  const tenorLabel = d => d < 30 ? `${d}d` : d < 365 ? `${Math.round(d / 30)}M` : `${Math.round(d / 365)}Y`;
  function smileAt(pts, m) {
    if (!pts.length || m < pts[0][0] || m > pts[pts.length - 1][0]) return null;
    for (let k = 1; k < pts.length; k++) if (m <= pts[k][0]) { const [m0, v0] = pts[k - 1], [m1, v1] = pts[k]; return v0 + (v1 - v0) * (m1 === m0 ? 0 : (m - m0) / (m1 - m0)); }
    return null;
  }
  // OTM puts below spot, OTM calls above, put/call average within ±2.5% of spot
  // (removes the step where the smile switches sides) - same rule as the pipeline.
  function smilePoints(e, S) {
    // z107: prefer the parity-consistent mid IV (TRAPP2-OPTIONS ivMid), else Yahoo's iv
    const ivOf = o => +(o.ivMid || o.iv);
    const ok = o => ivOf(o) > 0.01 && ivOf(o) < 5;
    const P = new Map((e.puts || []).filter(ok).map(o => [o.strike, ivOf(o)])), C = new Map((e.calls || []).filter(ok).map(o => [o.strike, ivOf(o)]));
    const out = [];
    for (const K of [...new Set([...P.keys(), ...C.keys()])].sort((a, b) => a - b)) {
      const m = K / S;
      if (Math.abs(m - 1) <= 0.025 && P.has(K) && C.has(K)) out.push([m, (P.get(K) + C.get(K)) / 2]);
      else if (K < S && P.has(K)) out.push([m, P.get(K)]);
      else if (K >= S && C.has(K)) out.push([m, C.get(K)]);
    }
    return out;
  }
  function cmFromChain(d) {
    const S = +d.spot; if (!S) return null;
    const exps = [];
    for (const e of [...(d.expiries || [])].sort((a, b) => (a.dte || 0) - (b.dte || 0))) {
      if (!((e.dte || 0) >= 1)) continue;
      const pts = smilePoints(e, S);
      if (pts.length >= 3) exps.push([e.dte, pts]);
    }
    if (exps.length < 2) return null;
    return CM_T.map(T => CM_M.map(m => {
      for (let k = 1; k < exps.length; k++) {
        const [t0, p0] = exps[k - 1], [t1, p1] = exps[k];
        if (t0 <= T && T <= t1) {
          const a = smileAt(p0, m), b = smileAt(p1, m);
          if (a == null || b == null) return null;
          const w = a * a * t0 + (b * b * t1 - a * a * t0) * (t1 === t0 ? 0 : (T - t0) / (t1 - t0));   // total variance
          return w > 0 ? +(Math.sqrt(w / T) * 100).toFixed(2) : null;
        }
      }
      return null;
    }));
  }
  async function cmSurface(ticker) {
    let hist = null;
    try { hist = await getJSON(`${RAW()}/TRAPP2-OPTIONS/main/data/surfaces/${encodeURIComponent(ticker)}.json`); } catch (e) {}
    let snaps = (hist && Array.isArray(hist.snapshots)) ? hist.snapshots.filter(x => x && x.iv) : [];
    if (!snaps.length) {
      let data = null;
      try { if (typeof loadOptionsForTicker === 'function') data = await loadOptionsForTicker(ticker); } catch (e) {}
      const g = data ? cmFromChain(data) : null;
      if (!g) return { error: `No options chain for ${ticker} yet — request it from Valuation → Options.` };
      snaps = [{ date: String(data.asOf || '').slice(0, 10) || 'today', spot: data.spot, iv: g }];
    }
    // one height/colour scale across ALL snapshots, so scrubbing shows real change
    const allv = snaps.flatMap(x => x.iv.flat()).filter(v => v != null && isFinite(v));
    const zRange = allv.length ? [Math.min(...allv), Math.max(...allv)] : null;
    const mk = k => {
      const sn = snaps[k];
      return { title: `${ticker} implied-volatility surface · constant maturity`, snapIndex: k, snaps,
        sub: `${sn.date} · spot $${(+sn.spot || 0).toFixed(2)} · tenors 7d–2Y interpolated in total variance · ${snaps.length > 1 ? snaps.length + ' daily snapshots' : 'history builds daily from the options workflow'}`,
        xs: CM_M, ys: CM_T, z: sn.iv, zRange: snaps.length > 1 ? zRange : null, xScale: 'value', xLabel: 'Moneyness', yLabel: 'Tenor', zLabel: 'IV %', zStep: 5,
        xTick: v => `${Math.round(v * 100)}%`, yTick: tenorLabel, zFmt: v => v.toFixed(0), cell: v => v == null ? '—' : v.toFixed(1) + '%' };
    };
    return { cm: true, make: mk, count: snaps.length };
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

  // ---- z120 · Data tab v6: the yield curve as a 2D curve with a time scrubber ----
  // FRED H.15 constant-maturity Treasury yields (par, bond-equivalent %), DAILY.
  // Geometry: x = maturity in years on a true log (or linear) scale - each tenor
  // at its real position, never evenly spaced; straight segments join observed
  // tenors (no fitted curve) and a missing tenor breaks the line. y = yield on ONE
  // fixed scale for the whole range (plus a year of comparison history), so a
  // moving curve is a real move. Δ bars start at a zero baseline, sit at their
  // tenor's x, and share one symmetric scale per (range, comparison).
  const TEN_Y = [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];
  const TEN_L = MATS.map(m => m[1]);
  const IX = { m3: 1, y2: 4, y5: 6, y10: 8 };
  const CMP = { '1m': [1, '1M earlier'], '3m': [3, '3M earlier'], '1y': [12, '1Y earlier'], start: [null, 'range start'] };
  const CW = 360, CL = 36, CR = 10, CP = 8;                           // shared x frame (chart, Δ bars, tap); CP keeps the end tenors' bars inside the plot
  function buildDaily(series) {
    const ok = o => o && o.date && o.value !== null && o.value !== '' && o.value !== '.' && isFinite(+o.value);
    const maps = series.map(s => { const m = new Map(); for (const o of (s || [])) if (ok(o)) m.set(o.date, +o.value); return m; });
    const all = new Set(); maps.forEach(m => m.forEach((v, d) => all.add(d)));
    const dates = [...all].sort().filter(d => maps.reduce((c, m) => c + (m.has(d) ? 1 : 0), 0) >= 6);
    return { dates, rows: dates.map(d => maps.map(m => (m.has(d) ? m.get(d) : null))) };
  }
  // v7: [maturity, TIPS series, breakeven series, index of that maturity in TEN_Y]
  const REAL_MAT = [[5, 'DFII5', 'T5YIE', 6], [7, 'DFII7', null, 7], [10, 'DFII10', 'T10YIE', 8], [20, 'DFII20', null, 9], [30, 'DFII30', null, 10]];
  const EXTRA_IDS = ['T5YIE', 'T10YIE', 'T5YIFR', 'DFII5', 'DFII7', 'DFII10', 'DFII20', 'DFII30'];
  async function yieldDaily() {
    const base = `${RAW()}/TRAPP2-1/main/data/macro/`;
    const grab = async id => { try { return (await getJSON(base + id + '.json')).observations || []; } catch (e) { return []; } };
    const [series, extra] = await Promise.all([Promise.all(MATS.map(([id]) => grab(id))), Promise.all(EXTRA_IDS.map(grab))]);
    const D = buildDaily(series);
    if (!D.dates.length) return { error: 'No FRED yield data (TRAPP2-1 data/macro/DGS*.json) yet.' };
    const ok = o => o && o.date && o.value !== null && o.value !== '' && o.value !== '.' && isFinite(+o.value);
    const maps = {};
    EXTRA_IDS.forEach((id, i) => { const m = new Map(); for (const o of extra[i]) if (ok(o)) m.set(o.date, +o.value); maps[id] = m; });
    D.has = Object.fromEntries(EXTRA_IDS.map(id => [id, maps[id].size > 0]));
    // real yield: TIPS (DFII) when FRED has it, else nominal − breakeven on the SAME day
    // (FRED defines T5YIE / T10YIE as DGS − DFII, so the derivation is exact). No carry-forward.
    D.real = D.dates.map((d, k) => REAL_MAT.map(([, tips, be, ni]) => {
      if (maps[tips].has(d)) return maps[tips].get(d);
      const nom = D.rows[k][ni];
      return (be && maps[be].has(d) && nom != null) ? +(nom - maps[be].get(d)).toFixed(4) : null;
    }));
    D.fwd = D.dates.map(d => (maps.T5YIFR.has(d) ? maps.T5YIFR.get(d) : null));
    return D;
  }
  function realStats(D, k) {
    if (!D || !D.real || !D.real[k]) return null;
    const r = D.real[k], row = D.rows[k], at = m => { const i = REAL_MAT.findIndex(x => x[0] === m); return i < 0 ? null : r[i]; };
    const nom = m => row[REAL_MAT.find(x => x[0] === m)[3]];
    const real10 = at(10), real5 = at(5);
    return { real10, real5, be10: real10 != null && nom(10) != null ? +(nom(10) - real10).toFixed(4) : null,
             be5: real5 != null && nom(5) != null ? +(nom(5) - real5).toFixed(4) : null, fwd: D.fwd ? D.fwd[k] : null };
  }
  // v7: every trading day's move vs N earlier, as a categorical strip (by trading day, like the scrubber)
  const MOVE_COL = { 'bull steepener': '#4caf7d', 'bull flattener': '#2f8f83', 'bear steepener': '#d0645a', 'bear flattener': '#e0b04c',
    'steepening twist': '#9b87f5', 'flattening twist': '#5b8def', 'parallel rally': '#8fc9b4', 'parallel sell-off': '#d79a8f', 'little changed': '#6b6b6b' };
  function moveLabels(D, start, mode) {
    const out = [];
    for (let k = start; k < D.dates.length; k++) { const kc = cmpIndex(D, k, mode, start); const mv = kc == null ? null : classifyMove(D.rows[kc], D.rows[k]); out.push(mv ? mv.label : null); }
    return out;
  }
  function moveStripSvg(labels, mark) {
    const n = labels.length, H = 12;
    if (!n) return '';
    let g = '', i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && labels[j + 1] === labels[i]) j++;
      const x0 = Math.round(i / n * CW * 1000) / 1000, x1 = Math.round((j + 1) / n * CW * 1000) / 1000;   // shared rounded edges: runs tile exactly
      g += `<rect x="${x0}" y="0" width="${+(x1 - x0).toFixed(3)}" height="${H}" fill="${labels[i] ? MOVE_COL[labels[i]] : 'transparent'}"><title>${labels[i] || 'no comparison yet'}</title></rect>`;
      i = j + 1;
    }
    if (mark != null && mark >= 0 && mark < n) g += `<rect x="${((mark + 0.5) / n * CW - 0.9).toFixed(3)}" y="0" width="1.8" height="${H}" fill="var(--ink,#e8e2d4)"/>`;
    return `<svg id="dt-cstrip-svg" viewBox="0 0 ${CW} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;display:block;cursor:pointer;border-radius:2px" role="img" aria-label="Each trading day's curve move">${g}</svg>`;
  }
  const bpd = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 100));
  function curveStats(r) {
    if (!r) return null;
    const fly = (r[IX.y2] == null || r[IX.y5] == null || r[IX.y10] == null) ? null : Math.round((2 * r[IX.y5] - r[IX.y2] - r[IX.y10]) * 100);
    return { y2: r[IX.y2], y10: r[IX.y10], s2s10: bpd(r[IX.y10], r[IX.y2]), s3m10y: bpd(r[IX.y10], r[IX.m3]), fly };
  }
  // the textbook 2Y / 10Y read of a move between two curves (±3 bp = unchanged)
  function classifyMove(a, b) {
    if (!a || !b) return null;
    const d2 = bpd(b[IX.y2], a[IX.y2]), d10 = bpd(b[IX.y10], a[IX.y10]);
    if (d2 == null || d10 == null) return null;
    const dS = d10 - d2;
    if (Math.abs(d2) < 3 && Math.abs(d10) < 3) return { label: 'little changed', d2, d10, dS };
    if (d2 * d10 < 0) return { label: dS > 0 ? 'steepening twist' : 'flattening twist', d2, d10, dS };
    const bull = d2 + d10 < 0;
    if (Math.abs(dS) < 3) return { label: bull ? 'parallel rally' : 'parallel sell-off', d2, d10, dS };
    return { label: `${bull ? 'bull' : 'bear'} ${dS > 0 ? 'steepener' : 'flattener'}`, d2, d10, dS };
  }
  function niceScale(lo, hi, n) {
    if (!(hi > lo)) hi = lo + 1;
    const raw = (hi - lo) / (n || 5), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const st = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    return [+(Math.floor(lo / st) * st).toFixed(6), +(Math.ceil(hi / st) * st).toFixed(6), st];
  }
  function monthsBefore(day, months) {
    const d = new Date(day + 'T00:00:00Z'), y = d.getUTCFullYear(), m = d.getUTCMonth() - months;
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();            // clamp: Mar 31 - 1M = Feb 28, not Mar 3
    return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), dim))).toISOString().slice(0, 10);
  }
  function lastOnOrBefore(D, target, hiIdx) {
    let a = 0, b = hiIdx, ans = null;
    while (a <= b) { const mid = (a + b) >> 1; if (D.dates[mid] <= target) { ans = mid; a = mid + 1; } else b = mid - 1; }
    return ans;
  }
  function cmpIndex(D, k, mode, start) {
    if (mode === 'start') return start < k ? start : null;
    return lastOnOrBefore(D, monthsBefore(D.dates[k], CMP[mode][0]), k - 1);
  }
  function rangeStart(D, months) {
    const n = D.dates.length, i = lastOnOrBefore(D, monthsBefore(D.dates[n - 1], months), n - 1);
    return i == null ? 0 : Math.min(n - 1, i + 1);
  }
  function curveScales(D, start, mode, withReal) {
    const n = D.dates.length, from = lastOnOrBefore(D, monthsBefore(D.dates[start], 12), start);
    let lo = Infinity, hi = -Infinity, mx = 0;
    for (let k = from == null ? 0 : from; k < n; k++) {
      for (const v of D.rows[k]) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (withReal && D.real) for (const v of D.real[k]) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }   // v7: one scale for both curves
    }
    const pad = Math.max(0.1, (hi - lo) * 0.04);
    for (let k = start; k < n; k++) {
      const kc = cmpIndex(D, k, mode, start); if (kc == null) continue;
      for (let i = 0; i < TEN_Y.length; i++) { const d = bpd(D.rows[k][i], D.rows[kc][i]); if (d != null && Math.abs(d) > mx) mx = Math.abs(d); }
    }
    const ds = niceScale(-Math.max(mx, 5), Math.max(mx, 5), 4), m = Math.max(Math.abs(ds[0]), Math.abs(ds[1]));
    return { y: niceScale(lo - pad, hi + pad, 5), d: [-m, m, ds[2]] };
  }
  function xMap(xs) {
    const tr = xs === 'lin' ? (m => m) : Math.log, a = tr(TEN_Y[0]), b = tr(TEN_Y[TEN_Y.length - 1]);
    return m => +(CL + CP + (tr(m) - a) / (b - a) * (CW - CL - CR - 2 * CP)).toFixed(2);
  }
  const C_INK = 'var(--ink,#e8e2d4)', C_DIM = 'var(--ink-dim,#b9b2a3)', C_FAINT = 'var(--ink-faint,#8a8476)', C_RULE = 'var(--rule,#3a3a3a)', C_AMBER = 'var(--amber,#e0b04c)';
  function curveSvg(D, k, kc, o) {
    const H = 232, T = 10, B = 34, X = xMap(o.xs), [lo, hi, st] = o.y;
    const Y = v => +(T + (hi - v) / (hi - lo) * (H - T - B)).toFixed(2);
    const dec = st >= 1 ? 0 : st >= 0.5 ? 1 : 2;
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += st) {
      const y = Y(v);
      g += `<line x1="${CL}" y1="${y}" x2="${CW - CR}" y2="${y}" stroke="${C_RULE}" stroke-width="0.6"${Math.abs(v) < 1e-9 ? '' : ' stroke-dasharray="2 3"'}/>`
         + `<text x="${CL - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="${C_FAINT}">${v.toFixed(dec)}</text>`;
    }
    let lastX = -1e9;
    TEN_Y.forEach((m, i) => {
      const x = X(m);
      g += `<line x1="${x}" y1="${H - B}" x2="${x}" y2="${H - B + 4}" stroke="${C_FAINT}" stroke-width="0.8"/>`;
      if (x - lastX >= 16) { g += `<text x="${x}" y="${H - B + 14}" text-anchor="middle" font-size="9" fill="${C_FAINT}">${TEN_L[i]}</text>`; lastX = x; }
    });
    g += `<line x1="${CL}" y1="${H - B}" x2="${CW - CR}" y2="${H - B}" stroke="${C_FAINT}" stroke-width="0.8"/>`
       + `<text x="${(CL + CW - CR) / 2}" y="${H - 5}" text-anchor="middle" font-size="9" fill="${C_FAINT}">maturity · ${o.xs === 'lin' ? 'linear' : 'log'} scale</text>`
       + `<text x="10" y="${(T + H - B) / 2}" transform="rotate(-90 10 ${(T + H - B) / 2})" text-anchor="middle" font-size="9" fill="${C_FAINT}">yield %</text>`;
    const path = r => { let d = '', pen = false; TEN_Y.forEach((m, i) => { if (r[i] == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(m)} ${Y(r[i])} `; pen = true; }); return d.trim(); };
    const dots = (r, col, rad) => TEN_Y.map((m, i) => (r[i] == null ? '' : `<circle cx="${X(m)}" cy="${Y(r[i])}" r="${rad}" fill="${col}"/>`)).join('');
    if (kc != null) g += `<path d="${path(D.rows[kc])}" fill="none" stroke="${C_DIM}" stroke-width="1.2" stroke-dasharray="4 3"/>${dots(D.rows[kc], C_DIM, 1.8)}`;
    g += `<path d="${path(D.rows[k])}" fill="none" stroke="${C_AMBER}" stroke-width="2"/>${dots(D.rows[k], C_AMBER, 2.6)}`
;
    if (o.real && D.real && D.real[k]) {                     // v7: real curve + breakeven brackets
      const rr = D.real[k], TEAL = 'var(--teal,#4fb3a9)';
      REAL_MAT.forEach(([m, , , ni], i) => {
        const nom = D.rows[k][ni];
        if (rr[i] == null || nom == null) return;
        const x = X(m), yn = Y(nom), yr = Y(rr[i]);
        g += `<line x1="${x}" y1="${yn}" x2="${x}" y2="${yr}" stroke="${TEAL}" stroke-width="1" stroke-dasharray="1 2"/>`
           + `<text x="${(x + 3).toFixed(2)}" y="${((yn + yr) / 2 + 3).toFixed(2)}" font-size="8" fill="${TEAL}">${(nom - rr[i]).toFixed(2)}</text>`;
      });
      let d = '', pen = false;
      REAL_MAT.forEach(([m], i) => { if (rr[i] == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(m)} ${Y(rr[i])} `; pen = true; });
      g += `<path d="${d.trim()}" fill="none" stroke="${TEAL}" stroke-width="1.6" stroke-dasharray="5 3"/>`
         + REAL_MAT.map(([m], i) => (rr[i] == null ? '' : `<circle cx="${X(m)}" cy="${Y(rr[i])}" r="2.4" fill="${TEAL}"/>`)).join('');
    }
    g += `<rect id="dt-curve-hit" x="${CL}" y="${T}" width="${CW - CL - CR}" height="${H - T - B}" fill="transparent" style="cursor:crosshair"/>`;
    return `<svg viewBox="0 0 ${CW} ${H}" style="width:100%;height:auto;display:block;font-family:var(--mono,monospace)" role="img" aria-label="US Treasury yield curve on ${D.dates[k]}">${g}</svg>`;
  }
  function deltaSvg(D, k, kc, o) {
    const H = 124, T = 12, B = 24, X = xMap(o.xs), [lo, hi, st] = o.d;
    const Y = v => +(T + (hi - v) / (hi - lo) * (H - T - B)).toFixed(2);
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += st) {
      const y = Y(v), z = Math.abs(v) < 1e-9;
      g += `<line x1="${CL}" y1="${y}" x2="${CW - CR}" y2="${y}" stroke="${z ? C_FAINT : C_RULE}" stroke-width="${z ? 1 : 0.6}"${z ? '' : ' stroke-dasharray="2 3"'}/>`
         + `<text x="${CL - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="${C_FAINT}">${v > 0 ? '+' : ''}${Math.round(v)}</text>`;
    }
    let lastX = -1e9, lastV = -1e9;
    TEN_Y.forEach((m, i) => {
      const x = X(m), d = bpd(D.rows[k][i], D.rows[kc][i]);
      if (x - lastX >= 16) { g += `<text x="${x}" y="${H - 5}" text-anchor="middle" font-size="9" fill="${C_FAINT}">${TEN_L[i]}</text>`; lastX = x; }
      if (d == null) return;
      const y0 = Y(0), y1 = Y(Math.max(lo, Math.min(hi, d))), w = 9;
      g += `<rect x="${(x - w / 2).toFixed(2)}" y="${Math.min(y0, y1)}" width="${w}" height="${Math.max(0.6, Math.abs(y1 - y0)).toFixed(2)}" fill="${d > 0 ? 'var(--red,#d0645a)' : 'var(--pos,#5fb37a)'}" opacity="0.85"/>`;
      if (x - lastV >= 16) { g += `<text x="${x}" y="${d >= 0 ? y1 - 3 : y1 + 9}" text-anchor="middle" font-size="8" fill="${C_DIM}">${d > 0 ? '+' : ''}${d}</text>`; lastV = x; }
    });
    return `<svg viewBox="0 0 ${CW} ${H}" style="width:100%;height:auto;display:block;font-family:var(--mono,monospace)" role="img" aria-label="Change in yield by maturity, basis points">${g}</svg>`;
  }
  function curveStatsHtml(D, k, kc, lab) {
    const a = curveStats(D.rows[k]), b = kc == null ? null : curveStats(D.rows[kc]), mv = kc == null ? null : classifyMove(D.rows[kc], D.rows[k]);
    const pct = v => (v == null ? '—' : v.toFixed(2) + '%'), bps = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v} bp`);
    const chg = (x, y) => (x == null || y == null ? '' : ` <span style="color:var(--ink-faint)">(${x - y > 0 ? '+' : ''}${x - y})</span>`);
    const chgY = (x, y) => { const d = bpd(x, y); return d == null ? '' : ` <span style="color:var(--ink-faint)">(${d > 0 ? '+' : ''}${d} bp)</span>`; };
    const inv = [a.s2s10 != null && a.s2s10 < 0 ? '2s10s' : null, a.s3m10y != null && a.s3m10y < 0 ? '3m10y' : null].filter(Boolean);
    const it = (l, v, c) => `<span>${l} <strong style="color:var(--ink)">${v}</strong>${c || ''}</span>`;
    const rs = realStats(D, k), rsb = kc == null ? null : realStats(D, kc);
    const realBits = rs ? [
      rs.real10 != null ? it('10Y real', pct(rs.real10), rsb && chgY(rs.real10, rsb.real10)) : '',
      rs.be10 != null ? it('10Y breakeven', pct(rs.be10), rsb && chgY(rs.be10, rsb.be10)) : '',
      rs.fwd != null ? it('5y5y', pct(rs.fwd), rsb && rsb.fwd != null ? chgY(rs.fwd, rsb.fwd) : '') : ''].join('') : '';
    return `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);margin:6px 2px">
      ${it('2Y', pct(a.y2), b && chgY(a.y2, b.y2))}${it('10Y', pct(a.y10), b && chgY(a.y10, b.y10))}
      ${it('2s10s', bps(a.s2s10), b && chg(a.s2s10, b.s2s10))}${it('3m10y', bps(a.s3m10y), b && chg(a.s3m10y, b.s3m10y))}
      ${it('2s5s10s fly', bps(a.fly), b && chg(a.fly, b.fly))}${realBits}
      ${inv.length ? `<span style="color:var(--red)">inverted · ${inv.join(' · ')}</span>` : ''}
      ${mv ? `<span>vs ${esc(lab)}: <strong style="color:var(--ink)">${esc(mv.label)}</strong> <span style="color:var(--ink-faint)">(2Y ${mv.d2 > 0 ? '+' : ''}${mv.d2} · 10Y ${mv.d10 > 0 ? '+' : ''}${mv.d10} bp)</span></span>` : ''}</div>`;
  }
  async function renderCurve(view) {
    view.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading…</div>';
    const D = S.cache.ydaily || (S.cache.ydaily = await yieldDaily());
    if (!document.getElementById('dt-view')) return;
    if (D.error) { delete S.cache.ydaily; view.innerHTML = `<div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);padding:16px 0">${esc(D.error)}</div>`; return; }
    const n = D.dates.length, start = rangeStart(D, S.months), skey = `ycs:${S.months}:${S.ccmp}:${S.cr}`;
    const sc = S.cache[skey] || (S.cache[skey] = curveScales(D, start, S.ccmp, S.cr === 'real'));
    // v7: the move strip (vs 1M when the comparison is the range start)
    const sMode = S.ccmp === 'start' ? '1m' : S.ccmp, lkey = `ylab:${S.months}:${sMode}`;
    const labels = S.cache[lkey] || (S.cache[lkey] = moveLabels(D, start, sMode));
    const shares = {}; let known = 0;
    for (const l of labels) if (l) { shares[l] = (shares[l] || 0) + 1; known++; }
    const stripHtml = k => `<div style="margin:0 0 6px">${moveStripSvg(labels, k - start)}
        <div style="display:flex;flex-wrap:wrap;gap:2px 10px;font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:3px">
          <span>each trading day's move vs ${esc(CMP[sMode][1])}:</span>${Object.entries(shares).sort((p, q) => q[1] - p[1]).map(([l, c]) => `<span><span style="display:inline-block;width:8px;height:8px;background:${MOVE_COL[l]};border-radius:1px;vertical-align:middle"></span> ${esc(l)} ${(c / known * 100).toFixed(0)}%</span>`).join('')}</div></div>`;
    $('#dt-title').textContent = 'US Treasury yield curve';
    $('#dt-sub').innerHTML = `${TEN_L.length} maturities · daily · FRED H.15 constant maturity (par, bond-equivalent %) · ${esc(D.dates[start])} → ${esc(D.dates[n - 1])} · <a href="#" id="dt-csv" style="color:var(--ink-faint)">CSV ↓</a>`;
    $('#dt-csv').onclick = e => { e.preventDefault(); downloadCsv({ title: `US Treasury yields daily ${D.dates[start]} to ${D.dates[n - 1]}`, xLabel: 'Maturity', yLabel: 'Date', xs: TEN_L, ys: D.dates.slice(start), z: D.rows.slice(start), xTick: v => v, yTick: v => v }); };
    const ro = $('#dt-readout');
    const paint = () => {
      if (!document.getElementById('dt-view')) return stopPlay();
      const k = S.ck == null ? n - 1 : Math.max(start, Math.min(n - 1, S.ck));
      const kc = cmpIndex(D, k, S.ccmp, start), lab = CMP[S.ccmp][1];
      const key = (col, w, dash) => `<svg width="18" height="6" style="vertical-align:middle"><line x1="0" y1="3" x2="18" y2="3" stroke="${col}" stroke-width="${w}"${dash ? ' stroke-dasharray="4 3"' : ''}/></svg>`;
      view.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10px;margin:4px 0 6px">
          <span style="color:var(--ink-faint)">${esc(D.dates[start].slice(0, 7))}</span>
          <button class="btn btn-ghost" id="dt-cplay" style="padding:2px 8px;font-size:10px" title="Play through the dates">${S.playing ? '❚❚' : '▶'}</button>
          <input type="range" id="dt-cscrub" min="${start}" max="${n - 1}" value="${k}" style="flex:1;min-width:0">
          <span style="color:var(--ink-faint)">${esc(D.dates[n - 1].slice(0, 7))}</span></div>
        ${stripHtml(k)}
        <div style="background:var(--bg-elev);border:1px solid var(--rule);border-radius:6px;padding:4px 2px">${curveSvg(D, k, kc, { xs: S.cx, y: sc.y, real: S.cr === 'real' })}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-family:var(--mono);font-size:9.5px;margin:5px 2px">
          <span>${key(C_AMBER, 2)} <strong style="color:var(--ink)">${esc(D.dates[k])}</strong></span>
          ${kc != null ? `<span style="color:var(--ink-dim)">${key(C_DIM, 1.2, true)} ${esc(D.dates[kc])} (${esc(lab)})</span>` : `<span style="color:var(--ink-faint)">no ${esc(lab)} curve in the data</span>`}
          ${S.cr === 'real' ? `<span style="color:var(--teal,#4fb3a9)">${key('var(--teal,#4fb3a9)', 1.6, true)} real yield (TIPS) · dotted bracket = breakeven</span>` : ''}</div>
        ${curveStatsHtml(D, k, kc, lab)}
        ${kc != null ? `<div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin:8px 2px 2px">Change by maturity vs ${esc(lab)} · bp · up = higher yield</div>
          <div style="background:var(--bg-elev);border:1px solid var(--rule);border-radius:6px;padding:2px">${deltaSvg(D, k, kc, { xs: S.cx, d: sc.d })}</div>` : ''}
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px;line-height:1.5">Points are the observed tenors at their true maturity (${S.cx === 'lin' ? 'linear' : 'log'} axis), joined by straight segments — no fitted curve. One fixed yield scale for the whole range, so a move while scrubbing is real. The move label reads the 2Y and 10Y (within ±3 bp = unchanged). Tap the chart for one tenor.</div>`;
      bind(k, kc, lab);
    };
    const bind = (k, kc, lab) => {
      const strip = document.getElementById('dt-cstrip-svg');
      if (strip) strip.onclick = e => {
        const bb = strip.getBoundingClientRect();
        if (!bb.width) return;
        stopPlay();
        S.ck = start + Math.max(0, Math.min(labels.length - 1, Math.floor((e.clientX - bb.left) / bb.width * labels.length)));
        paint();
      };
      const r = $('#dt-cscrub'); if (r) r.oninput = () => { stopPlay(); S.ck = +r.value; paint(); };
      const pb = $('#dt-cplay'); if (pb) pb.onclick = () => {
        if (S.playing) { stopPlay(); paint(); return; }
        S.playing = true;
        const step = Math.max(1, Math.round((n - start) / 150));
        if ((S.ck == null ? n - 1 : S.ck) >= n - 1) S.ck = start;
        S.timer = setInterval(() => {
          if (!document.getElementById('dt-cscrub')) return stopPlay();
          S.ck = Math.min(n - 1, (S.ck == null ? n - 1 : S.ck) + step);
          if (S.ck >= n - 1) stopPlay();
          paint();
        }, 110);
        paint();
      };
      const hit = document.getElementById('dt-curve-hit');
      if (hit) hit.onclick = e => {
        const svg = hit.ownerSVGElement, bb = svg && svg.getBoundingClientRect();
        if (!bb || !bb.width) return;
        const vx = (e.clientX - bb.left) / bb.width * CW, X = xMap(S.cx);
        let bi = 0; TEN_Y.forEach((m, i) => { if (Math.abs(X(m) - vx) < Math.abs(X(TEN_Y[bi]) - vx)) bi = i; });
        const v = D.rows[k][bi], c = kc == null ? null : D.rows[kc][bi], d = bpd(v, c);
        ro.innerHTML = `<strong style="color:var(--ink)">${TEN_L[bi]}</strong> · ${v == null ? '—' : v.toFixed(2) + '%'} on ${esc(D.dates[k])}${c != null ? ` · ${c.toFixed(2)}% ${esc(lab)} · Δ ${d > 0 ? '+' : ''}${d} bp` : ''}`;
      };
    };
    paint();
  }

  // ---- Pattern success surface (z104): template × market trend / breakout volume ----
  async function patternSurface(split) {
    let st;
    try { st = await getJSON(`${RAW()}/TRAPP2-ANALYTICS/main/data/patterns/stats.json`); } catch (e) { return { error: 'No pattern statistics yet (TRAPP2-ANALYTICS data/patterns/stats.json).' }; }
    const T = st.templates || {};
    const keys = Object.keys(T).filter(k => k !== 'minervini');
    const rows = split === 'volume' ? [['confirmed', 'Volume ≥ ' + ((T[keys[0]] || {}).volConfirmAt || 1.4) + '×'], ['unconfirmed', 'Lighter volume']]
                                    : [['up', 'Up-trend'], ['mixed', 'Mixed'], ['down', 'Down-trend']];
    const cell = (k, r) => {
      const t = T[k] || {};
      const x = split === 'volume' ? (t.byVolume || {})[r] : ((t.byRegime || {}).trend || {})[r];
      return x && x.judged >= 30 && x.successRate != null ? +x.successRate : null;     // too-thin cells stay empty
    };
    const z = rows.map(([r]) => keys.map(k => cell(k, r)));
    const short = { hs_top: 'H&S top', hs_bottom: 'Inv H&S', double_top: 'Dbl top', double_bottom: 'Dbl bottom', vcp: 'VCP', cup_handle: 'Cup&H',
                    bull_flag: 'Bull flag', bear_flag: 'Bear flag', asc_triangle: 'Asc tri', desc_triangle: 'Desc tri', breakout_52w: '52w BO',
                    flat_base: 'Flat base', high_tight_flag: 'HTF' };
    return { title: `Pattern success rate by ${split === 'volume' ? 'breakout volume' : 'market trend (SPY)'}`,
      sub: `${esc(st.engine || '')} backtest · % of judged calls that reached target · cells with < 30 judged calls left empty · as of ${esc(String(st.asOf || '').slice(0, 10))}`,
      bars: true, xs: keys, ys: rows.map(r => r[0]), z, xScale: 'index', xLabel: 'Template', yLabel: split === 'volume' ? 'Volume' : 'Trend', zLabel: 'Success %', zStep: 10,
      xTick: k => short[k] || k, yTick: r => (rows.find(x => x[0] === r) || [r, r])[1], zFmt: v => v.toFixed(0), cell: v => v == null ? '—' : v.toFixed(1) + '%' };
  }

  // ---- Correlation surface (z108): asset × month-end × rolling correlation with SPY ----
  // Pearson correlation of DAILY returns over the trailing window (default 63
  // sessions ≈ 3 months) ending at each month-end, for the 11 sector SPDRs plus
  // long Treasuries (TLT), gold (GLD) and the dollar proxy (UUP). Shows how
  // relationships move over time - e.g. the stock/bond correlation flip.
  const CORR_ASSETS = ['XLK', 'XLC', 'XLY', 'XLF', 'XLI', 'XLB', 'XLE', 'XLV', 'XLP', 'XLU', 'XLRE', 'TLT', 'GLD', 'UUP'];
  async function corrSurface(months, win) {
    if (!window.VChart) return { error: 'charts.js not loaded' };
    const [spy, ...rest] = await Promise.all(['SPY', ...CORR_ASSETS].map(t => window.VChart.fetchDaily(t)));
    if (!spy || spy.length < win + 30) return { error: 'No SPY history in the books.' };
    const sp = new Map(spy.map(b => [b.d, b.c]));
    const assets = [], series = [];
    CORR_ASSETS.forEach((t, k) => { const h = rest[k]; if (h && h.length > win + 30) { assets.push(t); series.push(h); } });
    if (!assets.length) return { error: 'No asset histories found.' };
    // month-end dates from SPY's calendar
    const ends = [];
    for (let i = spy.length - 1; i > 0 && ends.length < months; i--) if (spy[i].d.slice(0, 7) !== (spy[i + 1] || { d: '' }).d.slice(0, 7)) ends.push(i);
    ends.reverse();
    const maps = series.map(h => new Map(h.map(b => [b.d, b.c])));   // built once per asset
    const corrAt = (m, iEnd) => {
      const xs = [], ys = [];
      for (let i = iEnd - win + 1; i <= iEnd; i++) {
        const d0 = spy[i - 1].d, d1 = spy[i].d;
        const a0 = m.get(d0), a1 = m.get(d1);
        if (a0 && a1) { xs.push(a1 / a0 - 1); ys.push(spy[i].c / spy[i - 1].c - 1); }
      }
      if (xs.length < win * 0.8) return null;
      const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
      return sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : null;
    };
    const z = ends.map(iEnd => maps.map(m => corrAt(m, iEnd)));
    return { title: `Rolling ${win}-day correlation with SPY`, sub: `${assets.length} assets · ${ends.length} month-ends · ${esc(spy[ends[0]].d)} → ${esc(spy[ends[ends.length - 1]].d)} · daily returns, Pearson`,
      ribbons: true, xs: assets, ys: ends.map(i => spy[i].d), z, zRange: [-1, 1], xScale: 'index', xLabel: 'Asset', yLabel: 'Date', zLabel: 'Correlation', zStep: 0.5,
      xTick: v => v, yTick: v => { const d = new Date(v + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + " '" + String(d.getUTCFullYear()).slice(2); },
      yRead: v => v, zFmt: v => v.toFixed(1), cell: v => v == null ? '—' : v.toFixed(2) };   // z133: "May '26", never read as May 26th
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
    ['Options IV surface history', 'TRAPP2-OPTIONS/data/surfaces/<T>.json', 'each options run', 'TRAPP2-OPTIONS/main/data/surfaces/SPY.json'],
    ['Quad nowcast calls (judged)', 'TRAPP2-1/data/quad_calls.json', 'mid-day', 'TRAPP2-1/main/data/quad_calls.json'],
    ['Official quad history (2005 →)', 'TRAPP2-1/data/macro/quad_history_full.json', 'Macro Quad run', 'TRAPP2-1/main/data/macro/quad_history_full.json'],
  ];

  // ------------------------------------------------------------------ views --
  function heatHtml(ds) {
    const vals = ds.z.flat().filter(v => v != null);
    const lo = ds.zRange ? ds.zRange[0] : Math.min(...vals), hi = ds.zRange ? ds.zRange[1] : Math.max(...vals);
    return `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-family:var(--mono);font-size:10px;min-width:max-content">
      <thead><tr><th style="padding:4px 8px;text-align:left;color:var(--ink-faint)">${esc(ds.yLabel)} \\ ${esc(ds.xLabel)}</th>${ds.xs.map(x => `<th style="padding:4px 6px;color:var(--ink-dim)">${esc(ds.xTick(x))}</th>`).join('')}</tr></thead>
      <tbody>${ds.ys.map((y, j) => `<tr><td style="padding:3px 8px;color:var(--ink-dim);white-space:nowrap">${esc(ds.yTick(y))}</td>${ds.xs.map((x, i) => { const v = ds.z[j][i];
        if (v == null) return '<td style="padding:3px 6px;text-align:center;color:var(--ink-faint)">·</td>';
        const c = colorAt((v - lo) / (hi - lo || 1)); return `<td style="padding:3px 6px;text-align:center;background:${rgb(c, 0.85)};color:#111">${esc(ds.cell(v))}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  // Slices: one line per row (smile per expiry / tenor) + ATM term structure.
  function slicesHtml(ds) {
    const W = 600, Hh = 220, pl = 40, pr = 10, pt = 10, pb = 24;
    const vals = ds.z.flat().filter(v => v != null); if (!vals.length) return '';
    const lo = Math.floor(Math.min(...vals)), hi = Math.ceil(Math.max(...vals));
    const sx = i => pl + i / Math.max(1, ds.xs.length - 1) * (W - pl - pr);
    const sy = v => pt + (hi - v) / (hi - lo || 1) * (Hh - pt - pb);
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => { const v = lo + (hi - lo) * f, y = sy(v); return `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.1)"/><text x="${pl - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="#8a8578" font-family="monospace">${v.toFixed(0)}</text>`; }).join('');
    const xt = ds.xs.map((x, i) => `<text x="${sx(i)}" y="${Hh - 6}" font-size="9" text-anchor="middle" fill="#8a8578" font-family="monospace">${esc(ds.xTick(x))}</text>`).join('');
    const lines = ds.ys.map((y, j) => {
      const c = rgb(colorAt(ds.ys.length > 1 ? j / (ds.ys.length - 1) : 0));
      let d = '', pen = false;
      ds.z[j].forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + sx(i).toFixed(1) + ',' + sy(v).toFixed(1); pen = true; });
      return d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.6"><title>${esc(ds.yTick(y))}</title></path>` : '';
    }).join('');
    const legend = ds.ys.map((y, j) => `<span style="color:${rgb(colorAt(ds.ys.length > 1 ? j / (ds.ys.length - 1) : 0))}">■ ${esc(ds.yTick(y))}</span>`).join(' ');
    // ATM term structure (the column closest to 100%)
    const ai = ds.xs.reduce((b, x, i) => Math.abs(+x - 1) < Math.abs(+ds.xs[b] - 1) ? i : b, 0);
    const atm = ds.ys.map((y, j) => [j, ds.z[j][ai]]).filter(p => p[1] != null);
    const tx = j => pl + j / Math.max(1, ds.ys.length - 1) * (W - pl - pr);
    const tline = atm.map(([j, v], k) => (k ? 'L' : 'M') + tx(j).toFixed(1) + ',' + sy(v).toFixed(1)).join('');
    const tt = ds.ys.map((y, j) => `<text x="${tx(j)}" y="${Hh - 6}" font-size="9" text-anchor="middle" fill="#8a8578" font-family="monospace">${esc(ds.yTick(y))}</text>`).join('');
    const isNum = typeof ds.xs[0] === 'number';
    return `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-dim);margin:6px 0 2px">${esc(ds.zLabel)} ACROSS ${esc(ds.xLabel.toUpperCase())} — one line per ${esc(ds.yLabel.toLowerCase())}</div>
      <svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto;display:block">${grid}${xt}${lines}</svg>
      <div style="font-family:var(--mono);font-size:9px;line-height:1.6">${legend}</div>
      ${isNum ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-dim);margin:12px 0 2px">${esc(ds.zLabel)} AT ${esc(ds.xTick(ds.xs[ai]))} ACROSS ${esc(ds.yLabel.toUpperCase())} (term structure)</div>
      <svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto;display:block">${grid}${tt}<path d="${tline}" fill="none" stroke="var(--amber,#e0b04c)" stroke-width="2"/></svg>` : ''}`;
  }
  function legendHtml(ds) {
    const vals = ds.z.flat().filter(v => v != null);
    const lo = ds.zRange ? ds.zRange[0] : Math.min(...vals), hi = ds.zRange ? ds.zRange[1] : Math.max(...vals);
    const stops = STOPS.map(([t, c]) => `${rgb(c)} ${Math.round(t * 100)}%`).join(',');
    return `<div style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:9.5px;color:var(--ink-dim);margin-top:6px">
      <span>${esc(ds.cell(lo))}</span><span style="flex:1;height:8px;border-radius:4px;background:linear-gradient(90deg,${stops})"></span><span>${esc(ds.cell(hi))}</span></div>`;
  }
  function tableHtml(ds) {
    return `<div style="overflow-x:auto"><table class="sb-table" style="font-size:10.5px;min-width:max-content"><thead><tr><th>${esc(ds.yLabel)}</th>${ds.xs.map(x => `<th>${esc(ds.xTick(x))}</th>`).join('')}</tr></thead>
      <tbody>${ds.ys.map((y, j) => `<tr><td>${esc(y)}</td>${ds.z[j].map(v => `<td>${esc(ds.cell(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  const S = { dataset: 'iv', view: '3d', ticker: null, months: 36, surf: null, cache: {}, ivMode: 'cm', snap: null, psplit: 'volume', cwin: 63, ck: null, ccmp: '1m', cx: 'log', cr: 'nom' };
  async function render() {
    const host = document.getElementById('data-tab-body');
    if (!host) return;
    if (S.view === 'curve' && S.dataset !== 'yield') S.view = '3d';       // v6: Curve is a yield-only view
    let tk = S.ticker;
    if (!tk) { try { tk = (typeof state !== 'undefined' && state.stock && state.stock.ticker) || 'SPY'; } catch (e) { tk = 'SPY'; } }
    S.ticker = String(tk).toUpperCase();
    const seg = (key, opts) => `<span class="seg-control" style="font-size:10px">${opts.map(([v, l]) => `<button class="seg-btn ${S[key] === v ? 'active' : ''}" data-dt-${key}="${v}">${l}</button>`).join('')}</span>`;
    host.innerHTML = `<div class="section-title" style="margin-bottom:6px">Data <small>datasets · tables · heat maps · 3D surfaces · WIP</small></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0">
        ${seg('dataset', [['iv', 'IV surface'], ['yield', 'Yield curve'], ['corr', 'Correlation'], ['patterns', 'Patterns'], ['catalog', 'Catalog']])}
        ${S.dataset === 'corr' ? seg('cwin', [[21, '1M'], [63, '3M'], [126, '6M']]) + seg('months', [[12, '1Y'], [36, '3Y'], [60, '5Y'], [120, '10Y']]) : ''}
        ${S.dataset === 'patterns' ? seg('psplit', [['trend', 'by trend'], ['volume', 'by volume']]) : ''}
        ${S.dataset !== 'catalog' ? seg('view', (S.dataset === 'yield' ? [['curve', 'Curve']] : []).concat([['3d', '3D'], ['heat', 'Heat map'], ['slices', 'Slices'], ['table', 'Table']])) : ''}
        ${S.dataset === 'yield' && S.view === 'curve' ? seg('ccmp', [['1m', 'vs 1M'], ['3m', 'vs 3M'], ['1y', 'vs 1Y'], ['start', 'vs start']]) + seg('cx', [['log', 'log'], ['lin', 'linear']]) + seg('cr', [['nom', 'Nominal'], ['real', '+ Real & breakeven']]) : ''}
        ${S.dataset === 'iv' ? seg('ivMode', [['cm', 'Constant maturity'], ['exp', 'By expiry']]) : ''}
        ${S.dataset === 'iv' ? `<input id="dt-ticker" value="${esc(S.ticker)}" style="width:80px;background:var(--bg-elev);border:1px solid var(--rule);color:var(--ink);padding:5px 6px;border-radius:4px;font-family:var(--mono);font-size:11px;text-transform:uppercase"><button class="btn" id="dt-go" style="padding:5px 10px;font-size:10px">Load</button>` : ''}
        ${S.dataset === 'yield' ? seg('months', [[12, '1Y'], [36, '3Y'], [60, '5Y'], [120, '10Y']]) : ''}
      </div>
      <div id="dt-title" style="font-family:var(--mono);font-size:11px;color:var(--ink)"></div>
      <div id="dt-sub" style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-bottom:6px"></div>
      <div id="dt-view"></div>
      <div id="dt-readout" style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);min-height:16px;margin-top:6px"></div>`;
    host.querySelectorAll('[data-dt-dataset]').forEach(b => b.onclick = () => { stopPlay(); S.dataset = b.dataset.dtDataset; if (S.dataset === 'yield') S.view = 'curve'; render(); });
    host.querySelectorAll('[data-dt-ccmp]').forEach(b => b.onclick = () => { S.ccmp = b.dataset.dtCcmp; render(); });
    host.querySelectorAll('[data-dt-cx]').forEach(b => b.onclick = () => { S.cx = b.dataset.dtCx; render(); });
    host.querySelectorAll('[data-dt-cr]').forEach(b => b.onclick = () => { S.cr = b.dataset.dtCr; render(); });
    host.querySelectorAll('[data-dt-view]').forEach(b => b.onclick = () => { S.view = b.dataset.dtView; render(); });
    host.querySelectorAll('[data-dt-months]').forEach(b => b.onclick = () => { S.months = +b.dataset.dtMonths; render(); });
    host.querySelectorAll('[data-dt-psplit]').forEach(b => b.onclick = () => { S.psplit = b.dataset.dtPsplit; render(); });
    host.querySelectorAll('[data-dt-cwin]').forEach(b => b.onclick = () => { S.cwin = +b.dataset.dtCwin; render(); });
    host.querySelectorAll('[data-dt-ivMode], [data-dt-ivmode]').forEach(b => b.onclick = () => { S.ivMode = b.dataset.dtIvmode || b.dataset.dtIvMode; S.snap = null; render(); });
    const go = $('#dt-go'); if (go) { go.onclick = () => { S.ticker = ($('#dt-ticker').value || '').trim().toUpperCase() || S.ticker; render(); }; $('#dt-ticker').onkeydown = e => { if (e.key === 'Enter') go.click(); }; }
    const view = $('#dt-view');
    if (S.dataset === 'catalog') return renderCatalog(view);
    if (S.dataset === 'yield' && S.view === 'curve') return renderCurve(view);
    view.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading…</div>';
    const key = S.dataset === 'iv' ? `iv:${S.ivMode}:${S.ticker}` : S.dataset === 'patterns' ? 'pat:' + S.psplit
              : S.dataset === 'corr' ? `corr:${S.cwin}:${S.months}` : 'yield:' + S.months;
    const loader = S.dataset === 'iv' ? (S.ivMode === 'cm' ? cmSurface(S.ticker) : ivSurface(S.ticker))
                 : S.dataset === 'patterns' ? patternSurface(S.psplit)
                 : S.dataset === 'corr' ? corrSurface(S.months, S.cwin) : yieldSurface(S.months);
    const got = S.cache[key] || (S.cache[key] = await loader);
    if (!document.getElementById('dt-view')) return;
    if (got.error) { delete S.cache[key]; view.innerHTML = `<div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);padding:16px 0">${esc(got.error)}</div>`; return; }
    // constant-maturity history: a date scrubber over the daily snapshots
    let ds = got, scrub = '';
    if (got.cm) {
      const k = S.snap == null ? got.count - 1 : Math.max(0, Math.min(got.count - 1, S.snap));
      ds = got.make(k);
      if (got.count > 1) scrub = `<div style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10px;margin:4px 0 8px">
          <span style="color:var(--ink-faint)">${esc(ds.snaps[0].date)}</span>
          <button class="btn btn-ghost" id="dt-play" style="padding:2px 8px;font-size:10px" title="Play through the dates">${S.playing ? '❚❚' : '▶'}</button>
          <input type="range" id="dt-scrub" min="0" max="${got.count - 1}" value="${k}" style="flex:1">
          <span style="color:var(--ink-faint)">${esc(ds.snaps[got.count - 1].date)}</span></div>`;
    }
    $('#dt-title').textContent = ds.title; $('#dt-sub').innerHTML = ds.sub;
    const bindScrub = () => {
      const r = $('#dt-scrub'); if (r) r.oninput = () => { stopPlay(); S.snap = +r.value; render(); };
      const pb = $('#dt-play'); if (pb) pb.onclick = () => {
        if (S.playing) { stopPlay(); render(); return; }
        S.playing = true; if ((S.snap == null ? got.count - 1 : S.snap) >= got.count - 1) S.snap = 0;
        S.timer = setInterval(() => { if (!document.getElementById('dt-view')) return stopPlay();
          const nxt = (S.snap == null ? got.count - 1 : S.snap) + 1;
          if (nxt > got.count - 1) { stopPlay(); render(); return; }
          S.snap = nxt; render(); }, 700);
        render();
      };
    };
    // CSV of whatever grid is on screen
    $('#dt-sub').insertAdjacentHTML('beforeend', ` · <a href="#" id="dt-csv" style="color:var(--ink-faint)">CSV ↓</a>`);
    $('#dt-csv').onclick = e => { e.preventDefault(); downloadCsv(ds); };
    if (S.view === 'heat') { view.innerHTML = scrub + heatHtml(ds) + legendHtml(ds); bindScrub(); return; }
    if (S.view === 'table') { view.innerHTML = scrub + tableHtml(ds); bindScrub(); return; }
    if (S.view === 'slices') { view.innerHTML = scrub + slicesHtml(ds); bindScrub(); return; }
    view.innerHTML = `<div style="position:relative;background:linear-gradient(#2a2a2a,#121212);border:1px solid var(--rule);border-radius:6px">
        <canvas id="dt-canvas" style="width:100%;height:${window.innerWidth < 600 ? 340 : 460}px;display:block"></canvas>
        <button class="btn btn-ghost" id="dt-reset" style="position:absolute;right:8px;top:8px;padding:3px 8px;font-size:9px">Reset view</button></div>
      ${legendHtml(ds)}
      ${(ds.ribbons || ds.bars || ds.xCategorical) ? `<div id="dt-cats" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${ds.xs.map((x, i) => `<button class="seg-btn" data-dt-cat="${i}" style="font-size:10px;padding:3px 8px;border:1px solid var(--rule);border-radius:3px">${esc(ds.xTick(x))}</button>`).join('')}</div>` : ''}
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px">Drag / swipe to rotate · tap a point for its value${(ds.ribbons || ds.bars || ds.xCategorical) ? ' · tap a name to isolate it (tap again for all)' : ''} · colour = value (green low → red high)</div>`;
    if (scrub) { view.insertAdjacentHTML('afterbegin', scrub); bindScrub(); }
    const ro = $('#dt-readout');
    S.camera = S.camera || { yaw: -0.62, pitch: 0.52, D: 4.2, picked: null };
    S.camera.picked = null;
    let paintChipsLater = ci => document.querySelectorAll('[data-dt-cat]').forEach(b => { const on = +b.dataset.dtCat === ci; b.classList.toggle('active', on); b.style.borderColor = on ? 'var(--amber)' : 'var(--rule)'; });
    if (S.camera.focusKey !== ds.title) { S.camera.focus = null; S.camera.focusKey = ds.title; }   // z133: a new dataset starts unfocused
    S.surf = Surface3D($('#dt-canvas'), ds, (x, y, v, ci) => { if (ci != null && typeof paintChipsLater === 'function') paintChipsLater(ci); ro.innerHTML = `${esc(ds.xLabel)} <strong>${esc(ds.xTick(x))}</strong> · ${esc(ds.yLabel)} <strong>${esc(ds.yRead ? ds.yRead(y) : ds.yTick(y))}</strong> · ${esc(ds.zLabel)} <strong style="color:var(--ink)">${esc(ds.cell(v))}</strong>`; }, S.camera);
    $('#dt-reset').onclick = () => S.surf.reset();
    // z133: one chip per category - isolate it, with its own latest value and range in the readout
    const catRead = i => {
      if (i == null) return '';
      const col = ds.z.map((row, j) => ({ y: ds.ys[j], v: row[i] })).filter(o => o.v != null && isFinite(o.v));
      if (!col.length) return `${esc(ds.xTick(ds.xs[i]))}: no values`;
      const last = col[col.length - 1], lo = col.reduce((a, b) => (b.v < a.v ? b : a)), hi = col.reduce((a, b) => (b.v > a.v ? b : a));
      const rd = y => esc(ds.yRead ? ds.yRead(y) : ds.yTick(y));
      return `<strong style="color:var(--amber)">${esc(ds.xTick(ds.xs[i]))}</strong> · latest ${esc(ds.cell(last.v))} (${rd(last.y)}) · low ${esc(ds.cell(lo.v))} (${rd(lo.y)}) · high ${esc(ds.cell(hi.v))} (${rd(hi.y)})`;
    };
    const paintChips = f => document.querySelectorAll('[data-dt-cat]').forEach(b => { const on = +b.dataset.dtCat === f; b.classList.toggle('active', on); b.style.borderColor = on ? 'var(--amber)' : 'var(--rule)'; });
    document.querySelectorAll('[data-dt-cat]').forEach(b => b.onclick = () => { const f = S.surf.setFocus(+b.dataset.dtCat); paintChips(f); if (ro) ro.innerHTML = f == null ? '' : catRead(f); });
    if (S.camera.focus != null) { paintChips(S.camera.focus); if (ro) ro.innerHTML = catRead(S.camera.focus); }
  }
  function stopPlay() { if (S.timer) clearInterval(S.timer); S.timer = null; S.playing = false; }
  function downloadCsv(ds) {
    const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const lines = [[`${ds.yLabel} / ${ds.xLabel}`, ...ds.xs.map(x => ds.xTick(x))].map(q).join(',')];
    ds.ys.forEach((y, j) => lines.push([ds.yTick(y), ...ds.z[j].map(v => v == null ? '' : v)].map(q).join(',')));
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (ds.title || 'data').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function renderCatalog(view) {
    view.innerHTML = `<div style="overflow-x:auto"><table class="sb-table" style="font-size:10.5px;min-width:max-content"><thead><tr><th>Dataset</th><th>Where</th><th>Refresh</th><th>Last update</th><th></th></tr></thead><tbody>
      ${CATALOG.map(([n, where, cad, url], k) => `<tr><td>${esc(n)}</td><td style="color:var(--ink-faint)">${esc(where)}</td><td>${esc(cad)}</td><td id="dt-age-${k}" style="color:var(--ink-faint)">${url ? '…' : '—'}</td>
        <td>${url ? `<a href="${RAW()}/${url}" target="_blank" rel="noopener" style="color:var(--ink-faint)">JSON ↗</a>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px">"Last update" reads each file's own timestamp; files over ~2 MB are linked, not opened. · <a href="#" id="dt-cat-csv" style="color:var(--ink-faint)">CSV ↓</a></div>`;
    document.getElementById('dt-cat-csv').onclick = e => {                // v6: the catalog as CSV (last updates as shown)
      e.preventDefault();
      const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
      const rows = [['Dataset', 'Where', 'Refresh', 'Last update', 'URL']].concat(CATALOG.map(([nm, where, cad, url], k) => {
        const c = document.getElementById('dt-age-' + k);
        return [nm, where, cad, c ? c.textContent : '', url ? `${RAW()}/${url}` : ''];
      }));
      const blob = new Blob([rows.map(r => r.map(q).join(',')).join('\n') + '\n'], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Valuatio_data_catalog.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const SMALL = /regime_|quad\.json|quad_calls|quad_history_full|surfaces\/|monitor\.json|rates\.json|summary\.json|stats\.json|DGS10|SPY\.json/;
    CATALOG.forEach(async ([, , , url], k) => {
      const cell = document.getElementById('dt-age-' + k);
      if (!url || !cell) return;
      if (!SMALL.test(url)) { cell.textContent = 'open to view'; return; }
      try {
        const j = await getJSON(`${RAW()}/${url}`);
        const t = Array.isArray(j) ? ((j[j.length - 1] || {}).date || (j[j.length - 1] || {}).asOf) : (j.snapshots ? (j.snapshots[j.snapshots.length - 1] || {}).date : null) || (j.rows ? ((j.rows[j.rows.length - 1] || {}).date || (j.rows[j.rows.length - 1] || {}).month) : null) || (j.generatedAt || j.generated_at || j.asOf || j.date || j.fetched_at || j.updated || j.computed_at || (j.observations ? j.observations[j.observations.length - 1].date : null));
        cell.textContent = t ? String(t).slice(0, 16).replace('T', ' ') : 'no timestamp';
      } catch (e) { cell.textContent = 'not found'; }
    });
  }

  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.tab-btn[data-tab="data"]');
    if (b) setTimeout(render, 30);
  }, true);
  // v7: the latest curve read for the Regime tab's context card
  async function curveSnapshot() {
    const D = S.cache.ydaily || (S.cache.ydaily = await yieldDaily());
    if (!D || D.error) return null;
    const k = D.dates.length - 1, kc = cmpIndex(D, k, '1m', 0), a = curveStats(D.rows[k]);
    return Object.assign({ date: D.dates[k], vs: kc == null ? null : D.dates[kc], move: kc == null ? null : classifyMove(D.rows[kc], D.rows[k]),
      inverted: (a.s2s10 != null && a.s2s10 < 0) || (a.s3m10y != null && a.s3m10y < 0) }, a, realStats(D, k) || {});
  }
  function openCurve() {
    S.dataset = 'yield'; S.view = 'curve'; S.ck = null;
    if (typeof switchTab === 'function') switchTab('data');
    setTimeout(render, 40);
  }
  window.DataTab = { render, ivSurface, yieldSurface, Surface3D, colorAt, curveSnapshot, openCurve,
                     _curve: { buildDaily, curveStats, classifyMove, niceScale, monthsBefore, cmpIndex, rangeStart, curveScales, curveSvg, deltaSvg, xMap, TEN_Y, TEN_L,
                               realStats, moveLabels, moveStripSvg, REAL_MAT, MOVE_COL, yieldDaily } };
})();
