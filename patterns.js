/* ==========================================================================
   patterns.js — Patterns & Templates (z83, WIP)

   A card in the Technical Analysis sub-panel that shows, for the TA ticker:
     • a price chart coloured by the Minervini trend-template score, with the
       50/150/200-day SMAs
     • for the chosen template: every historical identification the backend
       engine made (pivots, neckline, confirmation, target, outcome) and the
       CURRENT candidate with each rule's pass/fail — so you can read the
       template yourself ("guide" mode) with or without the system's calls
     • the track record: this ticker's identifications + success rate, and the
       template's universe-wide record (backtest + live) with 95% CIs and edge
       vs the unconditional baseline

   Data: TRAPP2-ANALYTICS/data/patterns/{current,stats,signals}.json and
   records/<TICKER>.json (written by pipeline/scan_patterns.py), plus the
   ticker's daily history from its book repo. Geometry is drawn at the exact
   bar/price of each pivot (bar-index x-axis, so weekends don't distort it).
   Loaded after app.js; uses app globals when present, never requires them.
   ========================================================================== */
(function () {
  'use strict';
  const VER = 'z87';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = () => {
    try { if (typeof ANALYTICS_BASE !== 'undefined') return ANALYTICS_BASE + 'patterns/'; } catch (e) {}
    try { if (typeof GH_RAW !== 'undefined') return GH_RAW + '/TRAPP2-ANALYTICS/main/data/patterns/'; } catch (e) {}
    return 'https://raw.githubusercontent.com/TheMostLocal/TRAPP2-ANALYTICS/main/data/patterns/';
  };
  const rawBase = () => { try { if (typeof GH_RAW !== 'undefined') return GH_RAW; } catch (e) {} return 'https://raw.githubusercontent.com/TheMostLocal'; };

  const P = { current: null, stats: null, signals: null, loadedAt: 0, rec: {}, hist: {},
              ticker: null, tpl: 'minervini', range: 504, showCalls: true, showGuide: true };
  const STATUS = {
    success:     { c: 'var(--green,#6cc28a)', g: '✓', t: 'Success — target reached' },
    failure:     { c: 'var(--red,#d97a6c)',   g: '✗', t: 'Failure — stopped out after confirmation' },
    invalidated: { c: 'var(--red,#d97a6c)',   g: '⨯', t: 'Invalidated — broke out the other way (misidentified)' },
    expired:     { c: 'var(--ink-faint,#6e6a5f)', g: '○', t: 'Expired — never confirmed' },
    timeout:     { c: 'var(--amber,#e0b04c)', g: '◔', t: 'Timeout — neither target nor stop in 60 bars' },
    confirmed:   { c: '#5aa9e6', g: '◆', t: 'Confirmed — in progress' },
    open:        { c: '#5aa9e6', g: '◇', t: 'Open — not enough bars to judge yet' },
  };
  const PIVOT_LABELS = { hs_top: ['LS', 'T1', 'H', 'T2', 'RS'], hs_bottom: ['LS', 'P1', 'H', 'P2', 'RS'],
                         double_top: ['P1', 'T', 'P2'], double_bottom: ['B1', 'P', 'B2'],
                         cup_handle: ['Rim', 'Cup', 'Rim', 'Handle'], bull_flag: ['Base', 'Pole', 'Flag'],
                         bear_flag: ['Top', 'Pole', 'Flag'], asc_triangle: ['R1', 'S1', 'R2', 'S2'],
                         desc_triangle: ['S1', 'R1', 'S2', 'R2'], breakout_52w: ['52W hi', 'Breakout'] };
  // VCP has 2 or 3 contractions -> label by position (H1 L1 H2 L2 ...)
  const labelsFor = (tpl, pv) => PIVOT_LABELS[tpl] ||
    pv.map((p, k) => (p[2] === 'H' ? 'H' : 'L') + (Math.floor(k / 2) + 1));
  const GROUPS = [['Trend templates', ['minervini']],
                  ['Reversal patterns', ['hs_top', 'hs_bottom', 'double_top', 'double_bottom']],
                  ['Continuation patterns', ['vcp', 'cup_handle', 'bull_flag', 'bear_flag', 'asc_triangle', 'desc_triangle']],
                  ['Breakouts', ['breakout_52w']]];

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function loadShared(force) {
    if (!force && P.current && Date.now() - P.loadedAt < 30 * 60 * 1000) return;
    const b = base();
    const [cur, st, sg] = await Promise.all([getJSON(b + 'current.json'), getJSON(b + 'stats.json'),
                                             getJSON(b + 'signals.json').catch(() => null)]);
    P.current = cur; P.stats = st; P.signals = sg; P.loadedAt = Date.now();
  }
  async function loadRecord(t) {
    if (P.rec[t] !== undefined) return P.rec[t];
    try { P.rec[t] = await getJSON(base() + 'records/' + encodeURIComponent(t.replace('/', '_')) + '.json'); }
    catch (e) { P.rec[t] = null; }
    return P.rec[t];
  }
  async function loadHistory(t, book) {
    if (P.hist[t]) return P.hist[t];
    let rows = null;
    const repo = String(book || '').replace(/-main$/, '');
    if (repo) {
      try { rows = await getJSON(`${rawBase()}/${repo}/main/data/history/${encodeURIComponent(t)}.json`); } catch (e) {}
    }
    if (!Array.isArray(rows) || rows.length < 30) {
      try { if (typeof getHistoryForTicker === 'function') rows = getHistoryForTicker(t); } catch (e) {}
    }
    const out = [];
    for (const x of rows || []) {
      const d = String(x.date || '').slice(0, 10), c = +(x.close != null ? x.close : x.price);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && isFinite(c) && c > 0) out.push({ d, c });
    }
    const dedup = [];
    for (const x of out) if (!dedup.length || dedup[dedup.length - 1].d < x.d) dedup.push(x);   // daily, ascending
    P.hist[t] = dedup;
    return dedup;
  }

  // ---- indicators (same definitions as patterns_engine.py) ----
  function sma(c, n) {
    const o = new Array(c.length).fill(null); let s = 0;
    for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) o[i] = s / n; }
    return o;
  }
  // Per-bar Minervini score from the 9 PRICE criteria (RS needs the whole
  // universe, so it's only known for today - shown in the checklist).
  function priceScores(c) {
    const s50 = sma(c, 50), s150 = sma(c, 150), s200 = sma(c, 200), out = new Array(c.length).fill(null);
    for (let i = 252; i < c.length; i++) {
      if (s200[i] == null || s200[i - 22] == null) continue;
      let hi = -Infinity, lo = Infinity;
      for (let k = i - 251; k <= i; k++) { if (c[k] > hi) hi = c[k]; if (c[k] < lo) lo = c[k]; }
      const p = c[i];
      out[i] = (p > s50[i]) + (p > s150[i]) + (p > s200[i]) + (s50[i] > s150[i]) + (s50[i] > s200[i]) +
               (s150[i] > s200[i]) + (p >= lo * 1.3) + (p >= hi * 0.75) + (s200[i] > s200[i - 22]);
    }
    return { s50, s150, s200, score: out };
  }
  function scoreColor(s) {          // 0 (red) → 4.5 (amber) → 9 (teal)
    if (s == null) return 'var(--ink-faint,#6e6a5f)';
    const t = Math.max(0, Math.min(1, s / 9));
    const a = [217, 122, 108], m = [224, 176, 76], z = [64, 214, 214];
    const mix = (x, y, u) => x.map((v, i) => Math.round(v + (y[i] - v) * u));
    const rgb = t < 0.5 ? mix(a, m, t / 0.5) : mix(m, z, (t - 0.5) / 0.5);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  // ---- styles ----
  function injectCSS() {
    if ($('#pat-css')) return;
    const st = document.createElement('style'); st.id = 'pat-css';
    st.textContent = `
#pat-card{margin:14px 0}
#pat-card .pat-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 10px}
#pat-card select,#pat-card .pat-seg button{background:var(--bg-elev,#14161a);color:var(--ink,#f0e7d0);border:1px solid var(--rule,#2d2d33);font-family:var(--mono,monospace);font-size:11px;padding:5px 8px;border-radius:4px}
#pat-card .pat-seg button.on{border-color:var(--amber,#e0b04c);color:var(--amber,#e0b04c)}
#pat-card label{font-family:var(--mono,monospace);font-size:11px;color:var(--ink-dim,#b8b1a4);display:flex;gap:4px;align-items:center}
#pat-card .pat-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px}
@media (max-width:900px){#pat-card .pat-grid{grid-template-columns:1fr}}
#pat-card .pat-box{background:var(--bg-card,#1a1d22);border:1px solid var(--rule,#2d2d33);border-radius:6px;padding:10px;font-family:var(--mono,monospace);font-size:11px;color:var(--ink,#f0e7d0)}
#pat-card .pat-box h4{margin:0 0 8px;font-size:11px;letter-spacing:.04em;color:var(--ink-dim,#b8b1a4);font-weight:600}
#pat-card .pat-row{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
#pat-card .ok{color:var(--green,#6cc28a)} #pat-card .no{color:var(--red,#d97a6c)} #pat-card .dim{color:var(--ink-faint,#6e6a5f)}
#pat-card table{width:100%;border-collapse:collapse;font-family:var(--mono,monospace);font-size:10.5px}
#pat-card th,#pat-card td{padding:3px 6px;border-bottom:1px solid var(--rule,#2d2d33);text-align:right;white-space:nowrap}
#pat-card th:first-child,#pat-card td:first-child{text-align:left}
#pat-card .pat-scroll{max-height:260px;overflow:auto}
#pat-card .pat-chart{overflow-x:auto}
#pat-card .pat-note{font-family:var(--mono,monospace);font-size:10px;color:var(--ink-faint,#6e6a5f);margin-top:6px;line-height:1.5}
#pat-card .pat-sig{cursor:pointer} #pat-card .pat-sig:hover td{color:var(--amber,#e0b04c)}
#pat-pred{font-family:var(--mono,monospace);font-size:11px;color:var(--ink-dim,#b8b1a4);margin:6px 2px 2px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
#pat-pred .k{color:var(--ink-faint,#6e6a5f);letter-spacing:.04em}
#pat-pred .v{color:var(--ink,#f0e7d0)} #pat-pred .up{color:var(--green,#6cc28a)} #pat-pred .dn{color:var(--red,#d97a6c)}
#pat-pred a{color:var(--ink-faint,#6e6a5f);cursor:pointer;text-decoration:underline dotted}
#pat-pred a:hover{color:var(--amber,#e0b04c)}`;
    document.head.appendChild(st);
  }

  function ensureCard() {
    let card = $('#pat-card');
    if (card) return card;
    const panel = $('.val-subpanel[data-subpanel="ta"]');
    const grid = (panel && $('.ta-analytics-grid', panel)) || $('.ta-analytics-grid');
    if (!grid) return null;
    injectCSS();
    card = document.createElement('section');
    card.className = 'ta-card'; card.id = 'pat-card';
    card.innerHTML = `<h3>Patterns &amp; Templates <span class="dim" style="font-size:10px;font-weight:400">· statistically tracked · WIP</span></h3>
      <div class="pat-bar">
        <select id="pat-tpl"></select>
        <span class="pat-seg" id="pat-range">
          <button data-n="126">6M</button><button data-n="252">1Y</button><button data-n="504" class="on">2Y</button><button data-n="1260">5Y</button><button data-n="99999">All</button>
        </span>
        <label title="Draw every identification the engine made (and its outcome)"><input type="checkbox" id="pat-calls" checked> system calls</label>
        <label title="Draw the latest candidate for this template with its rule checklist — read it yourself"><input type="checkbox" id="pat-guide" checked> template guide</label>
        <span class="dim" id="pat-asof" style="margin-left:auto;font-family:var(--mono);font-size:10px"></span>
      </div>
      <div class="pat-grid">
        <div><div class="pat-chart" id="pat-chart"></div><div class="pat-note" id="pat-legend"></div></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="pat-box" id="pat-check"></div>
          <div class="pat-box" id="pat-stats"></div>
        </div>
      </div>
      <div class="pat-grid" style="margin-top:10px">
        <div class="pat-box"><h4>TRACK RECORD — THIS TICKER</h4><div class="pat-scroll" id="pat-record"></div></div>
        <div class="pat-box"><h4>ACTIVE SIGNALS — LAST 10 BARS</h4><div class="pat-scroll" id="pat-signals"></div></div>
      </div>
      <div class="pat-note">Close-based detection (daily closes, no intraday wicks), no lookahead: a pattern is only identified on the bar its last pivot became knowable, and is then judged only by later bars. Success = target before the stop within 60 bars of confirmation (measured move for H&amp;S, doubles, triangles, cup &amp; handle; the pole for flags; 2R for VCP and 52-week breakouts); unsuccessful = invalidated (broke out the other way), expired (never confirmed in 40 bars) or stopped out. Minervini = fresh 10/10, judged on 63-day return vs SPY. Paper research — not advice.</div>`;
    // Full-width section right under the TA price chart (before the analytics grid).
    grid.parentNode.insertBefore(card, grid);
    const sel = $('#pat-tpl', card);
    buildMenu(sel);
    sel.onchange = () => { P.tpl = sel.value; render(); };
    card.querySelectorAll('#pat-range button').forEach(b => b.onclick = () => {
      card.querySelectorAll('#pat-range button').forEach(x => x.classList.toggle('on', x === b));
      P.range = +b.dataset.n; render();
    });
    $('#pat-calls', card).onchange = e => { P.showCalls = e.target.checked; render(); };
    $('#pat-guide', card).onchange = e => { P.showGuide = e.target.checked; render(); };
    return card;
  }

  // Template menu - rebuilt from current.json once it loads, so new templates
  // published by the scanner appear without a frontend change.
  function buildMenu(sel) {
    const tpls = (P.current && P.current.templates) || { minervini: { label: 'Minervini Trend Template' } };
    if (sel.dataset.n === String(Object.keys(tpls).length)) return;
    sel.dataset.n = String(Object.keys(tpls).length);
    const seen = new Set();
    sel.innerHTML = GROUPS.map(([g, keys]) => {
      const opts = keys.filter(k => tpls[k]).map(k => { seen.add(k);
        return `<option value="${k}">${esc(tpls[k].label)}${tpls[k].direction === 'bearish' ? ' ▼' : tpls[k].direction === 'bullish' && k !== 'minervini' ? ' ▲' : ''}</option>`; }).join('');
      return opts ? `<optgroup label="${esc(g)}">${opts}</optgroup>` : '';
    }).join('') + Object.entries(tpls).filter(([k]) => !seen.has(k)).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
    if (!tpls[P.tpl]) P.tpl = 'minervini';
    sel.value = P.tpl;
  }

  // ---- chart ----
  function drawChart(host, H, cur, rec) {
    const W = 1000, HT = 380, padL = 8, padR = 62, padT = 14, padB = 22;
    const all = H.map(x => x.c), ind = priceScores(all);
    const n = H.length, start = Math.max(0, n - P.range), view = H.slice(start);
    if (view.length < 2) { host.innerHTML = '<div class="dim">No history.</div>'; return; }
    const idx = new Map(H.map((x, i) => [x.d, i]));
    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < n; i++) {
      for (const v of [all[i], ind.s50[i], ind.s150[i], ind.s200[i]]) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const pad = (hi - lo) * 0.06 || hi * 0.05; lo -= pad; hi += pad;
    const X = i => padL + (i - start) / Math.max(1, n - 1 - start) * (W - padL - padR);
    const Y = v => padT + (hi - v) / (hi - lo) * (HT - padT - padB);
    const inView = i => i != null && i >= start && i < n;
    const parts = [];
    // grid + right axis
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4, y = Y(v);
      parts.push(`<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--rule,#2d2d33)" stroke-width="0.5"/>`,
                 `<text x="${W - padR + 4}" y="${y + 3}" font-size="10" fill="var(--ink-faint,#6e6a5f)" font-family="var(--mono)">${fmt(v)}</text>`);
    }
    // year ticks
    let lastY = null;
    for (let i = start; i < n; i++) {
      const y = H[i].d.slice(0, 4);
      if (y !== lastY && i > start) parts.push(`<text x="${X(i)}" y="${HT - 6}" font-size="9" fill="var(--ink-faint,#6e6a5f)" font-family="var(--mono)">${y}</text>`);
      lastY = y;
    }
    // SMAs
    const line = (arr, color, w, dash) => {
      let d = '';
      for (let i = start; i < n; i++) if (arr[i] != null) d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(arr[i]).toFixed(1);
      return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="0.85"/>` : '';
    };
    parts.push(line(ind.s200, '#8a6fd1', 1.2), line(ind.s150, '#5aa9e6', 1), line(ind.s50, '#e0b04c', 1));
    // price, coloured per segment by the trend-template score
    for (let i = start + 1; i < n; i++) {
      parts.push(`<line x1="${X(i - 1).toFixed(1)}" y1="${Y(all[i - 1]).toFixed(1)}" x2="${X(i).toFixed(1)}" y2="${Y(all[i]).toFixed(1)}" stroke="${scoreColor(ind.score[i])}" stroke-width="1.6"/>`);
    }
    const tpl = P.tpl;
    // system calls
    if (P.showCalls && rec && Array.isArray(rec.detections)) {
      for (const dt of rec.detections) {
        if (dt.tp !== tpl) continue;
        const ii = idx.get(dt.id);
        if (tpl === 'minervini') {
          if (!inView(ii)) continue;
          const s = STATUS[dt.st] || STATUS.open;
          parts.push(`<path d="M${X(ii)},${Y(all[ii]) + 6} l-5,9 h10 z" fill="${s.c}"><title>Minervini 10/10 · ${dt.id} · ${esc(s.t)}${dt.ex != null ? ` · ${dt.ex > 0 ? '+' : ''}${dt.ex}% vs SPY (63d)` : ''}</title></path>`);
          continue;
        }
        const pv = (dt.pv || []).map(p => [idx.get(p[0]), p[1]]);
        if (!pv.length || !pv.some(p => inView(p[0]))) continue;
        if (tpl === 'breakout_52w') {
          // a level + a marker, not a price path: dashed prior 52-week high from
          // where it was set to the breakout bar, ▲ on the breakout close.
          const s = STATUS[dt.st] || STATUS.open, [hi, bo] = pv;
          if (!inView(bo[0])) continue;
          const lvl = dt.nk && dt.nk[0] ? dt.nk[0][1] : hi[1];
          parts.push(`<line x1="${X(Math.max(start, hi[0]))}" x2="${X(bo[0])}" y1="${Y(lvl)}" y2="${Y(lvl)}" stroke="${s.c}" stroke-dasharray="4,3" stroke-width="1" opacity="0.8"><title>prior 52-week high ${fmt(lvl)}</title></line>`,
                     `<path d="M${X(bo[0])},${Y(all[bo[0]]) - 7} l-5,-9 h10 z" transform="rotate(180 ${X(bo[0])} ${Y(all[bo[0]]) - 11.5})" fill="${s.c}"><title>52-week breakout ${dt.id} · ${esc(s.t)}${dt.rt != null ? ` · ${dt.rt}%` : ''}</title></path>`);
          const end = dt.xd ? idx.get(dt.xd) : n - 1;
          if (dt.tg != null && end != null) parts.push(`<line x1="${X(bo[0])}" x2="${X(end)}" y1="${Y(dt.tg)}" y2="${Y(dt.tg)}" stroke="${s.c}" stroke-dasharray="2,3" stroke-width="1"><title>2R target ${fmt(dt.tg)}</title></line>`);
          if (dt.xd && inView(idx.get(dt.xd))) parts.push(`<text x="${X(idx.get(dt.xd)) + 4}" y="${Y(all[idx.get(dt.xd)]) - 6}" font-size="12" fill="${s.c}">${s.g}</text>`);
          continue;
        }
        const labels = labelsFor(tpl, dt.pv);
        const s = STATUS[dt.st] || STATUS.open;
        parts.push(`<path d="${pv.map((p, k) => (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join('')}" fill="none" stroke="${s.c}" stroke-width="1.3" opacity="0.9"/>`);
        pv.forEach((p, k) => parts.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="2.6" fill="${s.c}"/>`,
          `<text x="${X(p[0])}" y="${Y(p[1]) + (dt.pv[k][2] === 'L' ? 13 : -6)}" font-size="9" text-anchor="middle" fill="${s.c}" font-family="var(--mono)">${labels[k]}</text>`));
        drawNeck(parts, dt.nk, idx, X, Y, dt.xd ? idx.get(dt.xd) : (dt.cd ? idx.get(dt.cd) : n - 1), s.c);
        if (dt.cd && inView(idx.get(dt.cd))) {
          const ci = idx.get(dt.cd);
          parts.push(`<rect x="${X(ci) - 3}" y="${Y(all[ci]) - 3}" width="6" height="6" fill="none" stroke="${s.c}" stroke-width="1.2"><title>confirmed ${dt.cd}</title></rect>`);
          const end = dt.xd ? idx.get(dt.xd) : n - 1;
          if (dt.tg != null) parts.push(`<line x1="${X(ci)}" x2="${X(end)}" y1="${Y(dt.tg)}" y2="${Y(dt.tg)}" stroke="${s.c}" stroke-dasharray="2,3" stroke-width="1"><title>target ${fmt(dt.tg)}</title></line>`);
        }
        const ei = dt.xd ? idx.get(dt.xd) : null;
        const at = inView(ei) ? ei : pv[pv.length - 1][0];
        if (inView(at)) parts.push(`<text x="${X(at) + 4}" y="${Y(all[at]) - 6}" font-size="12" fill="${s.c}"><title>${esc(TPLNAME(tpl))} · identified ${dt.id} · ${esc(s.t)}${dt.rt != null ? ` · ${dt.rt}%` : ''}</title>${s.g}</text>`);
      }
    }
    // template guide (current candidate)
    if (P.showGuide && tpl === 'breakout_52w' && cur && cur.cand && cur.cand[tpl]) {
      // guide = the level to clear: prior 52-week high from where it was set to today
      const cd = cur.cand[tpl], hi = idx.get(cd.pv[0][0]), lvl = cd.nk && cd.nk[0] ? cd.nk[0][1] : cd.pv[0][1];
      const col = cd.ok ? 'var(--amber-bright,#ffc960)' : 'var(--ink-dim,#b8b1a4)';
      if (hi != null && lvl != null) parts.push(`<line x1="${X(Math.max(start, hi))}" x2="${X(n - 1)}" y1="${Y(lvl)}" y2="${Y(lvl)}" stroke="${col}" stroke-dasharray="6,3" stroke-width="1.4"/>`,
        `<text x="${X(n - 1) - 4}" y="${Y(lvl) - 5}" font-size="10" text-anchor="end" fill="${col}" font-family="var(--mono)" font-weight="600">52W high ${fmt(lvl)}</text>`);
    }
    if (P.showGuide && tpl !== 'minervini' && tpl !== 'breakout_52w' && cur && cur.cand && cur.cand[tpl]) {
      const cd = cur.cand[tpl], col = cd.ok ? 'var(--amber-bright,#ffc960)' : 'var(--ink-dim,#b8b1a4)';
      const pv = cd.pv.map(p => [idx.get(p[0]), p[1]]);
      const labels = labelsFor(tpl, cd.pv);
      if (pv.every(p => p[0] != null)) {
        parts.push(`<path d="${pv.map((p, k) => (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join('')}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="5,3"/>`);
        pv.forEach((p, k) => parts.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.2" fill="none" stroke="${col}" stroke-width="1.4"/>`,
          `<text x="${X(p[0])}" y="${Y(p[1]) + (cd.pv[k][2] === 'L' ? 15 : -8)}" font-size="10" text-anchor="middle" fill="${col}" font-family="var(--mono)" font-weight="600">${labels[k]}</text>`));
        drawNeck(parts, cd.nk, idx, X, Y, n - 1, col, '6,3');
      }
    }
    host.innerHTML = `<svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:auto;display:block" role="img" aria-label="Pattern chart">${parts.join('')}</svg>`;
  }
  function drawNeck(parts, nk, idx, X, Y, endIdx, color, dash) {
    if (!nk || nk.length < 2) return;
    const a = idx.get(nk[0][0]), b = idx.get(nk[1][0]);
    if (a == null || b == null || endIdx == null) return;
    const slope = b === a ? 0 : (nk[1][1] - nk[0][1]) / (b - a);
    const yEnd = nk[0][1] + slope * (endIdx - a);
    parts.push(`<line x1="${X(a)}" y1="${Y(nk[0][1])}" x2="${X(endIdx)}" y2="${Y(yEnd)}" stroke="${color}" stroke-width="1" stroke-dasharray="${dash || '4,3'}" opacity="0.9"><title>neckline</title></line>`);
  }
  const fmt = v => (v == null || !isFinite(v)) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toPrecision(3));
  const TPLNAME = k => ((P.current && P.current.templates && P.current.templates[k]) || {}).label || k;
  const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`;

  // ---- side panels ----
  function renderChecklist(host, cur) {
    const names = (P.current && P.current.ruleNames) || {};
    if (!cur) { host.innerHTML = '<h4>TEMPLATE</h4><div class="dim">No scan data for this ticker yet.</div>'; return; }
    if (P.tpl === 'minervini') {
      const mv = cur.mv, rn = names.minervini || [];
      if (!mv) { host.innerHTML = '<h4>MINERVINI TREND TEMPLATE</h4><div class="dim">Needs 252+ bars.</div>'; return; }
      const v = mv.v || {};
      host.innerHTML = `<h4>MINERVINI TREND TEMPLATE (D) — ${mv.s}/${mv.of}</h4>` +
        rn.map((r, k) => `<div class="pat-row"><span>${esc(r[0])}</span><span class="${mv.p[k] === '1' ? 'ok' : 'no'}">${mv.p[k] === '1' ? '✓' : '✗'}</span></div>`).join('') +
        `<div class="pat-row dim" style="margin-top:6px"><span>Current values</span><span></span></div>
         <div class="pat-row"><span>RP (RS percentile)</span><span>${v.RP ?? '—'}</span></div>
         <div class="pat-row"><span>Price vs 52W High</span><span class="${(v.vs52wHighPct || 0) < 0 ? 'no' : 'ok'}">${pct(v.vs52wHighPct)}</span></div>
         <div class="pat-row"><span>Price vs 52W Low</span><span class="ok">${pct(v.vs52wLowPct)}</span></div>`;
      return;
    }
    const cd = cur.cand && cur.cand[P.tpl], rn = names[P.tpl] || [];
    if (!cd) { host.innerHTML = `<h4>${esc(TPLNAME(P.tpl).toUpperCase())}</h4><div class="dim">${P.tpl === 'breakout_52w' ? 'Needs 260+ bars with real volume.' : 'No pivot sequence of this shape yet.'}</div>`; return; }
    const passes = cd.p.split('').filter(x => x === '1').length;
    host.innerHTML = `<h4>${esc(TPLNAME(P.tpl).toUpperCase())} — ${P.tpl === 'breakout_52w' ? 'TODAY' : 'LATEST CANDIDATE'} ${passes}/${cd.p.length}</h4>` +
      rn.map((r, k) => `<div class="pat-row" title="${esc(r[1] || '')}"><span>${esc(r[0])}</span><span><span class="dim">${cd.val[k] == null ? '' : esc(Array.isArray(cd.val[k]) ? cd.val[k].join(' → ') : cd.val[k])}</span> <span class="${cd.p[k] === '1' ? 'ok' : 'no'}">${cd.p[k] === '1' ? '✓' : '✗'}</span></span></div>`).join('') +
      `<div class="pat-row" style="margin-top:6px"><span>${cd.ok ? '<span class="ok">VALID — identified ' + esc(cd.id) + '</span>' : '<span class="dim">Not a valid pattern (manual read only)</span>'}</span></div>` +
      `<div class="pat-note">Pivots: ${cd.pv.map((p, k) => `${labelsFor(P.tpl, cd.pv)[k]} ${p[0]} @ ${fmt(p[1])}`).join(' · ')}. Hover a rule for its threshold.</div>`;
  }
  function statLine(s, label) {
    if (!s || !s.n) return `<div class="pat-row dim"><span>${label}</span><span>no data</span></div>`;
    const ci = s.successCI95 && s.successCI95[0] != null ? ` <span class="dim">[${s.successCI95[0]}–${s.successCI95[1]}]</span>` : '';
    let h = `<div class="pat-row"><span>${label} · n ${s.n}</span><span>${s.successRate == null ? '—' : s.successRate + '%'}${ci}</span></div>`;
    if (s.identificationSuccessRate != null) h += `<div class="pat-row dim"><span>&nbsp; identification success</span><span>${s.identificationSuccessRate}%</span></div>`;
    if (s.avgReturnPct != null) h += `<div class="pat-row dim"><span>&nbsp; avg return at exit</span><span>${pct(s.avgReturnPct)}</span></div>`;
    if (s.edgeVsBaselinePct != null) h += `<div class="pat-row dim"><span>&nbsp; 20-bar edge vs baseline</span><span class="${s.edgeVsBaselinePct > 0 ? 'ok' : 'no'}">${pct(s.edgeVsBaselinePct)}</span></div>`;
    return h;
  }
  function renderStats(host, rec) {
    const st = P.stats && P.stats.templates && P.stats.templates[P.tpl];
    const mine = rec && rec.stats && rec.stats[P.tpl];
    const now = P.stats && P.stats.regimeNow ? P.stats.regimeNow.trend : null;
    const tr = (st && st.byRegime && st.byRegime.trend) || {};
    const regimeRows = ['up', 'mixed', 'down'].filter(r => tr[r]).map(r => {
      const x = tr[r], cur = r === now;
      return `<div class="pat-row ${x.usable ? '' : 'dim'}" title="${x.usable ? '' : 'fewer than ' + ((P.stats && P.stats.minRegimeN) || 50) + ' judged calls - not used by the bot'}"` +
        `${cur ? ' style="color:var(--amber,#e0b04c)"' : ''}><span>&nbsp; ${cur ? '▸ ' : ''}${r}-trend market · n ${x.judged}</span>` +
        `<span>${x.successRate == null ? '—' : x.successRate + '%'} <span class="${(x.edgeVsBaselinePct || 0) > 0 ? 'ok' : 'no'}">${pct(x.edgeVsBaselinePct)}</span></span></div>`;
    }).join('');
    host.innerHTML = `<h4>STATISTICAL RECORD — ${esc(TPLNAME(P.tpl).toUpperCase())}</h4>` +
      statLine(mine, esc(P.ticker)) + statLine(st && st.backtest, 'Universe · backtest') +
      (regimeRows ? `<div class="pat-row dim" style="margin-top:4px"><span>By market regime (SPY trend${now ? ', now ' + esc(now) : ''})</span><span>success · edge</span></div>` + regimeRows : '') +
      statLine(st && st.live, 'Universe · live') +
      `<div class="pat-note">Success rate with 95% Wilson interval. ${P.tpl === 'minervini' ? 'Success = beat SPY over 63 trading days.' : 'Success = target reached after confirmation.'} Live record since ${esc((P.stats && P.stats.liveStart) || '—')}.</div>`;
  }
  function renderRecord(host, rec) {
    const rows = ((rec && rec.detections) || []).filter(d => d.tp === P.tpl).slice().reverse();
    if (!rows.length) { host.innerHTML = '<div class="dim">No identifications for this template on this ticker.</div>'; return; }
    const isT = P.tpl === 'minervini';
    host.innerHTML = `<table><thead><tr><th>identified</th><th>status</th>${isT ? '<th>63d</th><th>vs SPY</th>' : '<th>confirmed</th><th>exit</th><th>return</th>'}<th>+20d</th></tr></thead><tbody>` +
      rows.map(d => { const s = STATUS[d.st] || STATUS.open;
        return `<tr><td>${esc(d.id)}</td><td style="color:${s.c}" title="${esc(s.t)}">${s.g} ${esc(d.st)}</td>` +
          (isT ? `<td>${pct(d.rt)}</td><td>${pct(d.ex)}</td>` : `<td>${esc(d.cd || '—')}</td><td>${esc(d.xd || '—')}</td><td>${pct(d.rt)}</td>`) +
          `<td>${pct(d.f20)}</td></tr>`; }).join('') + '</tbody></table>';
  }
  function renderSignals(host) {
    const sg = ((P.signals && P.signals.signals) || []).filter(s => P.tpl === 'all' || s.template === P.tpl).slice(0, 60);
    if (!sg.length) { host.innerHTML = '<div class="dim">No recent identifications for this template.</div>'; return; }
    host.innerHTML = `<table><thead><tr><th>ticker</th><th>dir</th><th>status</th><th>identified</th><th>track</th></tr></thead><tbody>` +
      sg.map(s => `<tr class="pat-sig" data-t="${esc(s.ticker)}"><td>${esc(s.ticker)}</td><td class="${s.direction === 'bullish' ? 'ok' : 'no'}">${s.direction === 'bullish' ? '▲' : '▼'}</td><td>${esc(s.status)}</td><td>${esc(s.identDate)}</td><td class="dim">${s.track && s.track.successRate != null ? s.track.successRate + '%' : '—'}</td></tr>`).join('') + '</tbody></table>';
    host.querySelectorAll('.pat-sig').forEach(tr => tr.onclick = () => open(tr.dataset.t));
  }

  let renderSeq = 0;
  async function render() {
    const card = ensureCard();
    if (!card || !P.ticker) return;
    const seq = ++renderSeq, t = P.ticker;
    const chart = $('#pat-chart', card);
    try { await loadShared(); } catch (e) {
      chart.innerHTML = `<div class="dim">Pattern data unavailable (${esc(e.message)}). It's written by TRAPP2-ANALYTICS → Analytics refresh.</div>`;
      return;
    }
    buildMenu($('#pat-tpl', card));
    const cur = P.current.tickers && P.current.tickers[t];
    $('#pat-asof', card).textContent = `${t} · scan ${P.current.asOf} · ${P.current.engine}`;
    const [rec, H] = await Promise.all([loadRecord(t), loadHistory(t, cur && cur.b)]);
    if (seq !== renderSeq) return;
    if (!H || H.length < 30) chart.innerHTML = '<div class="dim">No daily history for this ticker.</div>';
    else drawChart(chart, H, cur, rec);
    $('#pat-legend', card).innerHTML = `Line colour = trend-template score from the 9 price criteria (<span style="color:${scoreColor(0)}">0</span> → <span style="color:${scoreColor(4.5)}">4.5</span> → <span style="color:${scoreColor(9)}">9</span>; RS is ranked across the universe and shown for today only). ` +
      `<span style="color:#e0b04c">SMA 50</span> · <span style="color:#5aa9e6">SMA 150</span> · <span style="color:#8a6fd1">SMA 200</span>. ` +
      (P.tpl === 'minervini' ? 'Triangles = fresh 10/10 signals, coloured by outcome.' :
       P.tpl === 'breakout_52w' ? 'Solid = system breakouts (dashed level = prior 52-week high, colour = outcome, dotted = 2R target).' :
       'Solid = system identifications (colour = outcome, □ = confirmation, dotted = target); dashed amber = current candidate.');
    renderChecklist($('#pat-check', card), cur);
    renderStats($('#pat-stats', card), rec);
    renderRecord($('#pat-record', card), rec);
    renderSignals($('#pat-signals', card));
  }

  function open(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    P.ticker = t;
    if (patternsOn()) render();
  }
  window.openPatterns = open;
  window.patternsState = P;

  // Follow the TA ticker (the TA sub-panel syncs to the valued ticker).
  function currentTaTicker() {
    try { if (typeof state !== 'undefined' && state.ta && state.ta.primary) return String(state.ta.primary).toUpperCase(); } catch (e) {}
    const inp = $('#ta-ticker-input');
    return inp && inp.value ? inp.value.trim().toUpperCase() : null;
  }
  // ---- "Patterns" button among the TA tools ----------------------------------
  // The card shows only while the Patterns tool is on, like the other TA tools.
  // The app's own #ta-tools handler toggles 'patterns' in state.ta.activeTools
  // (and Cursor / Clear turn it off); this file just follows that state and
  // remembers the choice between sessions.
  const PREF = 'valuatio.ta.patternsOn';
  function toolsSet() { try { return (typeof state !== 'undefined' && state.ta && state.ta.activeTools) || null; } catch (e) { return null; } }
  function ensureButton() {
    const bar = $('#ta-tools');
    if (!bar) return null;
    let btn = $('.ta-tool[data-tool="patterns"]', bar);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.className = 'ta-tool'; btn.dataset.tool = 'patterns';
    btn.title = 'Chart patterns & trend templates - every call statistically tracked (success rate, 95% CI, record per ticker)';
    btn.innerHTML = '<span class="ta-tool-icon">◇</span><span class="ta-tool-name">Patterns</span>';
    const right = [...bar.children].find(el => el.tagName === 'DIV' && /margin-left:\s*auto/.test(el.getAttribute('style') || ''));
    bar.insertBefore(btn, right || null);
    // restore the remembered choice once per page load
    let on = false;
    try { on = localStorage.getItem(PREF) === '1'; } catch (e) {}
    const set = toolsSet();
    if (on && set && !set.has('patterns')) { set.add('patterns'); btn.classList.add('active'); }
    bar.addEventListener('click', () => setTimeout(syncVisibility, 0));      // runs after the app's handler
    const clr = $('#ta-clear-drawings');
    if (clr) clr.addEventListener('click', () => setTimeout(syncVisibility, 0));
    return btn;
  }
  function patternsOn() {
    const set = toolsSet();
    if (set) return set.has('patterns');
    const b = $('.ta-tool[data-tool="patterns"]');
    return !!(b && b.classList.contains('active'));
  }
  function syncVisibility() {
    const on = patternsOn();
    try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) {}
    const b = $('.ta-tool[data-tool="patterns"]');
    if (b) b.classList.toggle('active', on);
    let card = $('#pat-card');
    if (on && !card) card = ensureCard();
    if (card) card.style.display = on ? '' : 'none';
    if (on && P.ticker && card && !$('#pat-chart svg', card)) render();
  }

  // ---- pattern read under the Valuation overview chart ----------------------
  // A one-line "what pattern does this chart look like" for the valued ticker:
  // the best-fitting candidate across the pattern templates, with a confidence
  // = share of that template's rules met x recency of its last swing point
  // (100% within 15 bars, fading to 40% at 45, nothing after 60), and the
  // template's historical success rate for context.
  function barsBetween(a, b) {
    const d = (Date.parse(b) - Date.parse(a)) / 86400000;
    return isFinite(d) ? Math.max(0, Math.round(d * 5 / 7)) : 999;
  }
  function recencyFactor(bars) {
    if (bars <= 15) return 1;
    if (bars <= 45) return 1 - 0.6 * (bars - 15) / 30;
    if (bars <= 60) return 0.4 * (60 - bars) / 15;
    return 0;
  }
  function predictPattern(t) {
    const cur = P.current && P.current.tickers && P.current.tickers[t];
    if (!cur || !cur.cand) return null;
    const sig = ((P.signals && P.signals.signals) || []).filter(x => x.ticker === t);
    const out = [];
    for (const [k, cd] of Object.entries(cur.cand)) {
      if (!cd || !cd.p) continue;
      const passes = cd.p.split('').filter(x => x === '1').length, of = cd.p.length;
      const last = cd.pv && cd.pv.length ? cd.pv[cd.pv.length - 1][0] : cd.id;
      const bars = barsBetween(last, cur.dt);
      let fit = cd.ok ? 1 : passes / of;
      if (k === 'breakout_52w' && !cd.ok && passes < of - 1) continue;      // not "near" a breakout
      const s = sig.find(x => x.template === k);
      const conf = Math.round(fit * recencyFactor(k === 'breakout_52w' ? 0 : bars) * 100);
      if (conf <= 0) continue;
      out.push({ key: k, conf, passes, of, ok: !!cd.ok, bars, status: s ? s.status : (cd.ok ? 'identified' : 'forming') });
    }
    // System calls from the last 10 bars (signals.json) count too - e.g. a 52-week
    // breakout confirmed last week is the chart's pattern even though today's bar
    // isn't a breakout. A call that already failed is not a prediction.
    for (const sg of sig) {
      if (['invalidated', 'failure', 'expired'].includes(sg.status)) continue;
      const bars = barsBetween(sg.confirmDate || sg.identDate, cur.dt);
      const conf = Math.round(recencyFactor(bars) * 100);
      const prev = out.find(o => o.key === sg.template);
      const meta = (P.current.templates || {})[sg.template] || {};
      const rulesOf = cur.cand && cur.cand[sg.template] ? cur.cand[sg.template].p.length : null;
      const row = { key: sg.template, conf, passes: rulesOf, of: rulesOf, ok: true, bars, status: sg.status, fromCall: true };
      if (!prev) { if (conf > 0 && meta.kind !== 'template') out.push(row); }
      else if (conf > prev.conf || (conf === prev.conf && !prev.fromCall)) Object.assign(prev, row);
    }
    const rank = { confirmed: 3, success: 2, identified: 2, open: 2, forming: 1 };
    out.sort((a, b) => b.conf - a.conf || (rank[b.status] || 0) - (rank[a.status] || 0) || b.passes / b.of - a.passes / a.of);
    return out;
  }
  async function renderPrediction() {
    const sec = $('#price-chart-section');
    if (!sec || sec.style.display === 'none') return;
    let t = null;
    try { if (typeof state !== 'undefined' && state.stock && state.stock.ticker) t = String(state.stock.ticker).toUpperCase(); } catch (e) {}
    if (!t) return;
    let host = $('#pat-pred');
    if (!host) {
      injectCSS();
      host = document.createElement('div'); host.id = 'pat-pred';
      const wrap = $('.price-chart-wrap', sec);
      if (wrap && wrap.nextSibling) sec.insertBefore(host, wrap.nextSibling); else sec.appendChild(host);
    }
    if (host.dataset.t === t && host.dataset.at === String(P.loadedAt)) return;
    try { await loadShared(); } catch (e) { host.innerHTML = '<span class="k">PATTERN READ</span><span>unavailable</span>'; return; }
    host.dataset.t = t; host.dataset.at = String(P.loadedAt);
    const list = predictPattern(t);
    if (!list) { host.innerHTML = '<span class="k">PATTERN READ</span><span>not scanned (needs 300+ daily bars)</span>'; return; }
    const top = list[0];
    if (!top || top.conf < 45) {
      host.innerHTML = '<span class="k">PATTERN READ</span><span>no clear pattern</span>' +
        (top ? `<span class="k">closest: ${esc(TPLNAME(top.key))} ${top.conf}%</span>` : '');
      return;
    }
    const meta = (P.current.templates || {})[top.key] || {};
    const up = meta.direction === 'bullish';
    const tpl = P.stats && P.stats.templates && P.stats.templates[top.key];
    const now = P.stats && P.stats.regimeNow ? P.stats.regimeNow.trend : null;
    const rg = tpl && tpl.byRegime && tpl.byRegime.trend && tpl.byRegime.trend[now];
    // z93: only lean on the market-regime split when the regime call is dialed in
    let _rcOk = false;
    try { const rc = window.RegimeCertainty ? await window.RegimeCertainty.load() : null; _rcOk = !!(rc && rc.dialedIn); } catch (e) {}
    const useRg = !!(_rcOk && rg && rg.usable && rg.successRate != null);
    const st = useRg ? rg : (tpl && tpl.backtest);
    const why = (top.fromCall ? `Confidence = a system call (${top.status}) ~${top.bars} bars ago x recency. `
                              : `Confidence = ${top.ok ? 'all' : top.passes + ' of ' + top.of} rules met x recency (last swing ~${top.bars} bars ago). `) +
                `Historical: ${st && st.successRate != null ? st.successRate + '% reached target (n ' + st.judged + (useRg ? ', ' + now + '-trend markets only' : '') + ')' : 'n/a'}. ` +
                (list[1] ? `Runner-up: ${TPLNAME(list[1].key)} ${list[1].conf}%.` : '');
    host.title = why;
    host.innerHTML = `<span class="k">PATTERN READ</span>` +
      `<span class="v">${esc(TPLNAME(top.key))} <span class="${up ? 'up' : 'dn'}">${up ? '▲' : '▼'}</span></span>` +
      `<span>${esc(top.status)}</span>` +
      `<span>confidence <span class="v">${top.conf}%</span></span>` +
      (st && st.successRate != null ? `<span class="k">hist. ${st.successRate}% hit target${useRg ? ' in ' + esc(now) + '-trend markets' : ''}</span>` : '') +
      `<a data-k="${esc(top.key)}">details</a>`;
    const a = $('a', host);
    if (a) a.onclick = () => openInTA(top.key);
  }
  function openInTA(key) {
    P.tpl = key;
    const set = toolsSet();
    if (set) set.add('patterns');
    try { localStorage.setItem(PREF, '1'); } catch (e) {}
    const tab = $('.val-subtab[data-subtab="ta"]');
    if (tab) tab.click();
    setTimeout(() => { ensureButton(); syncVisibility(); const sel = $('#pat-tpl'); if (sel) sel.value = key; render();
      const c = $('#pat-card'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }
  window.patternRead = t => (P.current ? predictPattern(String(t).toUpperCase()) : null);

  // Follows CHANGES of the TA ticker only, so a ticker opened from the signals
  // list (or openPatterns()) stays put until the TA ticker itself changes.
  let lastTa = null;
  // Open immediately when Valuation → Technical Analysis is clicked (the poll
  // below also covers programmatic switches and TA-input changes).
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.val-subtab[data-subtab="ta"]');
    if (!b) return;
    setTimeout(() => {
      ensureButton();
      syncVisibility();
      let t = currentTaTicker();
      try { if (!t && typeof state !== 'undefined' && state.stock && state.stock.ticker) t = state.stock.ticker; } catch (err) {}
      if (t && patternsOn()) { lastTa = String(t).toUpperCase(); open(t); }
    }, 0);
  }, true);
  setInterval(() => {
    renderPrediction();
    const panel = $('.val-subpanel[data-subpanel="ta"]');
    if (!panel || panel.style.display === 'none') return;
    ensureButton();
    syncVisibility();
    if (!patternsOn()) return;
    const t = currentTaTicker();
    if (t && t !== lastTa) { lastTa = t; open(t); }
  }, 1200);
  console.log(`[patterns] ${VER} loaded — window.openPatterns('AAPL')`);
})();
