/* ==========================================================================
   pages/research.js — z160 (Phase 3). Moved verbatim from app.js; loaded the first time the page opens
   (app.js keeps a stub for renderResearchTab that loads this file, then calls the real function).
   Every function here is used only by this page (checked against app.js, every other script and index.html).
   ========================================================================== */
function renderResearchTab() {
  const body = document.getElementById('research-body');
  if (!body) return;
  const rows = (typeof state !== 'undefined' && state.stockbook?.rows) ? state.stockbook.rows : [];
  if (!rows.length) {
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--ink-dim);font-family:var(--mono);font-size:12px">No stockbook loaded. Configure a data source first.</div>`;
    return;
  }
  const data = computeResearchRankings(true);  // always fresh — never serve a pre-normalization empty cache
  // Ensure the backend research (full fundamentals for ~650 tickers) is loading.
  // The category screen + metric ranker fall back to these values for tickers
  // whose live rows lack fundamentals, so kick the fetch off the first time the
  // research tab renders; it re-renders this tab when it lands.
  if (typeof loadBackendResearch === 'function' && !_backendResearchFetched) {
    loadBackendResearch().catch(() => {});
  }
  // BACKEND GRADES WIN. The analytics backend computes grades nightly from the
  // full, clean dataset; the local computation can be wrong when this browser
  // has stale/sparse rows (that's how BIGGQ showed A+ locally while the backend
  // correctly had D+). So where the backend has a grade for a ticker, it
  // overrides the local one — local stays only as a fallback for tickers the
  // backend hasn't graded yet. Each overridden row is marked so the UI can note
  // the source.
  mergeBackendGradesOverLocal(data);
  // Human grades anchor the displayed grade. Where a human has graded a ticker,
  // that grade becomes the headline grade (the user's judgment wins); the auto
  // grade is kept as _autoGrade so the Verify cell can show the discrepancy.
  if (typeof loadHumanGrades === 'function') {
    const hg = loadHumanGrades();
    for (const tk of Object.keys(hg)) {
      const row = data.byTicker[tk];
      const h = hg[tk];
      if (row && h && h.grade && h.status === 'graded') {
        row._autoGrade = row.grade;
        row.grade = h.grade;
        row._humanGraded = true;
      }
    }
  }

  // View toggle
  const head = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0 18px">
      <div class="seg-control">
        <button class="seg-btn ${RESEARCH_STATE.view==='grade'?'active':''}" data-rview="grade">Grades</button>
        <button class="seg-btn ${RESEARCH_STATE.view==='filter'?'active':''}" data-rview="filter">Screener</button>
      </div>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-left:auto">${data.universeSize} equities ranked across ${RESEARCH_METRICS.length} metrics</span>
    </div>`;

  if (RESEARCH_STATE.view === 'filter') {
    body.innerHTML = head + renderResearchScreener(data);
    wireResearchScreener();
  } else if (RESEARCH_STATE.detailTicker) {
    body.innerHTML = head + renderResearchDetail(data, RESEARCH_STATE.detailTicker);
    wireResearchDetailBack();
  } else {
    body.innerHTML = head + renderResearchGrades(data);
    wireResearchGrades();
  }
  // View toggle handler
  body.querySelectorAll('[data-rview]').forEach(b => b.addEventListener('click', () => {
    RESEARCH_STATE.view = b.dataset.rview;
    RESEARCH_STATE.detailTicker = null;
    renderResearchTab();
  }));
}

function renderResearchScreener(data) {
  // ===== CATEGORY SCREENER + multi-metric filter =====
  // PRIMARY MODE — Category screen: pick one or more grade categories
  // (Profitability, Growth, Valuation, Balance Sheet, Income). Each ticker is
  // ranked by the WEIGHTED AVERAGE of its scores in the selected categories
  // (using the same category weights the overall grade uses, re-normalized over
  // just the picked categories). The result shows that blended category score
  // AND a letter grade derived from it — so values and grade always match and
  // are pulled strictly from the chosen categories.
  const allRows = Object.values(data.byTicker);
  const GRADED_CATS = [...RESEARCH_GRADED_CATEGORIES];   // Profitability, Growth, Valuation, Balance Sheet, Income

  if (!Array.isArray(RESEARCH_STATE.screenCats)) RESEARCH_STATE.screenCats = [];
  const picked = RESEARCH_STATE.screenCats.filter(c => RESEARCH_GRADED_CATEGORIES.has(c));

  // Blended score for a ticker across the picked categories (weighted, re-
  // normalized over the categories the ticker actually has data for).
  const blendedCatScore = (t) => {
    const cs = t.categoryScores || {};
    let sum = 0, wsum = 0, used = 0;
    for (const c of picked) {
      if (cs[c] != null && isFinite(cs[c])) {
        const w = RESEARCH_CATEGORY_WEIGHTS[c] || 0;
        sum += cs[c] * w; wsum += w; used++;
      }
    }
    if (used === 0 || wsum === 0) return null;
    return sum / wsum;
  };

  // Category chips (multi-select).
  const catChips = GRADED_CATS.map(c => {
    const on = picked.includes(c);
    const w = ((RESEARCH_CATEGORY_WEIGHTS[c] || 0) * 100).toFixed(0);
    return `<button class="rf-cat-chip" data-cat="${escapeHtml(c)}" style="
      font-family:var(--mono);font-size:10px;padding:6px 11px;border-radius:14px;cursor:pointer;
      border:1px solid ${on ? 'var(--amber)' : 'var(--rule)'};
      background:${on ? 'var(--amber)' : 'transparent'};
      color:${on ? '#1a1a1a' : 'var(--ink-dim)'};font-weight:${on ? '700' : '400'}">
      ${on ? '✓ ' : ''}${escapeHtml(c)} <span style="opacity:0.7">${w}%</span></button>`;
  }).join(' ');

  // Build the category-ranked result set when ≥1 category is picked.
  let catTableHtml = '';
  if (picked.length > 0) {
    const minCov = RESEARCH_STATE.minCoverage || 0;
    const ranked = allRows
      .map(t => ({ t, score: blendedCatScore(t) }))
      .filter(x => x.score != null && (x.t.coverage || 0) >= minCov)
      .sort((a, b) => b.score - a.score);

    const catCols = picked.map(c => `<th style="text-align:right" title="${escapeHtml(c)} percentile (0-100)">${escapeHtml(c)}</th>`).join('');
    const catRows = ranked.map((x, i) => {
      const t = x.t;
      const blendGrade = researchGradeLetter(x.score);
      const perCatCells = picked.map(c => {
        const v = (t.categoryScores || {})[c];
        return `<td style="text-align:right;font-family:var(--mono);font-size:11px;color:${v != null ? researchGradeColor(researchGradeLetter(v)) : 'var(--ink-faint)'}">${v != null ? v.toFixed(0) : '—'}</td>`;
      }).join('');
      return `<tr class="research-screen-row" data-ticker="${escapeHtml(t.ticker)}" style="cursor:pointer">
        <td style="font-family:var(--mono);font-size:11px;color:var(--ink-faint);text-align:right">${i + 1}</td>
        <td style="font-family:var(--mono);font-weight:700">${escapeHtml(t.ticker)}</td>
        <td style="font-size:11px;color:var(--ink-dim)"><div style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div></td>
        <td style="text-align:center"><span style="font-family:var(--mono);font-size:14px;font-weight:700;color:${researchGradeColor(blendGrade)}" title="Grade from the blended score of the selected categories">${blendGrade}</span></td>
        <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:700">${x.score.toFixed(0)}<span style="color:var(--ink-faint);font-size:9px">/100</span></td>
        ${perCatCells}
        <td style="text-align:center;font-family:var(--mono);font-size:9px;color:var(--amber)">value →</td>
      </tr>`;
    }).join('');

    catTableHtml = `
      <div class="company-card" style="margin:0 0 14px">
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%">
        <table class="sb-table" style="width:100%;min-width:0">
          <thead><tr>
            <th style="text-align:right">#</th><th>Ticker</th><th>Company</th>
            <th style="text-align:center" title="Letter grade from the blended category score">Grade</th>
            <th style="text-align:right" title="Weighted average of the selected categories' percentile scores">Blended</th>
            ${catCols}
            <th></th>
          </tr></thead>
          <tbody>${catRows || `<tr><td colspan="${6 + picked.length}" style="padding:20px;text-align:center;color:var(--ink-faint)">No tickers have data in the selected categor${picked.length > 1 ? 'ies' : 'y'}.</td></tr>`}</tbody>
        </table>
        </div>
      </div>`;
  }

  const catScreenerHtml = `
    <div class="company-card" style="margin:0 0 14px">
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">Category screen</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-bottom:10px;line-height:1.5">Pick one or more categories. Tickers are ranked by the weighted average of their scores in those categories, with a grade to match. ${picked.length ? `<span style="color:var(--amber)">Showing ${picked.length} categor${picked.length > 1 ? 'ies' : 'y'}.</span>` : 'Pick a category to begin.'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px">${catChips}</div>
      ${picked.length > 1 ? `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:8px">Blended weights re-normalized over your picks: ${picked.map(c => `${c} ${((RESEARCH_CATEGORY_WEIGHTS[c] / picked.reduce((s, x) => s + RESEARCH_CATEGORY_WEIGHTS[x], 0)) * 100).toFixed(0)}%`).join(' · ')}</div>` : ''}
    </div>
    ${catTableHtml}`;

  // ===== METRIC RANKER — select metric(s) to instantly rank; thresholds optional
  // New model (per the user's ask):
  //  • Selecting a metric IMMEDIATELY ranks every ticker by that metric — no
  //    value required. Multiple metrics → ranked by the AVERAGE of their
  //    percentile ranks (grade-weighted blend), best first.
  //  • A value threshold is OPTIONAL: each selected metric has a "+ filter"
  //    toggle that reveals an op + value box. Empty threshold = rank only.
  //  • Metrics with little/no data in the loaded universe are shown but marked
  //    "no data" so dead metrics are obvious (only ~P/E, market cap, dividend
  //    yield are populated from the basic sheet feed; the rest need the richer
  //    backend fields).
  // RESEARCH_STATE.filters entries: { metric, op, val, threshold:bool }.
  const cats = [...new Set(RESEARCH_METRICS.map(x => x.cat))];

  // Per-metric data coverage across the loaded universe (how many tickers have a
  // finite value). Used to flag dead metrics and to weight blends sensibly.
  const metricCoverage = {};
  for (const m of RESEARCH_METRICS) {
    const pm = data.perMetric[m.key];
    metricCoverage[m.key] = pm && Array.isArray(pm.ranked) ? pm.ranked.length : 0;
  }
  const totalTickers = allRows.length || 1;

  const metricOptionsFor = (sel) => cats.map(cat =>
    `<optgroup label="${cat}">` +
    RESEARCH_METRICS.filter(x => x.cat === cat).map(x => {
      const cov = metricCoverage[x.key] || 0;
      const covPct = Math.round((cov / totalTickers) * 100);
      const dead = cov < 3;
      return `<option value="${x.key}" ${x.key === sel ? 'selected' : ''}>${x.label}${dead ? ' — no data' : ` (${covPct}% have data)`}</option>`;
    }).join('') +
    `</optgroup>`
  ).join('');

  // Default to a metric that actually HAS data so the screen isn't empty on open.
  const firstLiveMetric = (RESEARCH_METRICS.find(m => (metricCoverage[m.key] || 0) >= 3) || RESEARCH_METRICS[0]).key;
  if (!RESEARCH_STATE.filters || !RESEARCH_STATE.filters.length) {
    RESEARCH_STATE.filters = [{ metric: firstLiveMetric, op: 'gte', val: '', threshold: false }];
  }
  // Back-compat: older filter entries may lack the threshold flag.
  RESEARCH_STATE.filters.forEach(f => { if (f.threshold === undefined) f.threshold = (f.val !== '' && f.val != null); });

  const metricVal = (metricKey, ticker) => {
    const pm = data.perMetric[metricKey];
    if (!pm) return null;
    const hit = pm.byTicker ? pm.byTicker.get(ticker) : pm.ranked.find(r => r.ticker === ticker);
    return hit ? hit.value : null;
  };
  // Percentile rank (0-100, higher=better after direction) of a ticker for a metric.
  const metricPct = (metricKey, ticker) => {
    const pm = data.perMetric[metricKey];
    if (!pm || !pm.byTicker) return null;
    const hit = pm.byTicker.get(ticker);
    return hit && hit.pct != null ? hit.pct : null;   // perMetric entries store the percentile as `pct`
  };

  // The metrics the user has selected (dedupe).
  const selectedMetrics = [...new Set(RESEARCH_STATE.filters.map(f => f.metric))];
  // Active THRESHOLDS only (metric + a real numeric value the user opted into).
  const activeThresholds = RESEARCH_STATE.filters.filter(f => f.threshold && f.val !== '' && isFinite(+f.val));

  // 1. Apply any opted-in thresholds as hard filters.
  let results = allRows.filter(t => {
    for (const f of activeThresholds) {
      const v = metricVal(f.metric, t.ticker);
      if (v == null || !isFinite(v)) return false;
      const thr = +f.val;
      if (f.op === 'gte' && !(v >= thr)) return false;
      if (f.op === 'lte' && !(v <= thr)) return false;
      if (f.op === 'gt'  && !(v >  thr)) return false;
      if (f.op === 'lt'  && !(v <  thr)) return false;
    }
    return true;
  });
  // A ticker must have data for at least one selected metric to be ranked.
  results = results.filter(t => selectedMetrics.some(mk => metricVal(mk, t.ticker) != null));

  // 2. Rank. Single metric → by that metric's value (direction-aware). Multiple →
  //    by the AVERAGE percentile across the selected metrics (grade-weighted blend).
  const blendPct = (ticker) => {
    let sum = 0, n = 0;
    for (const mk of selectedMetrics) {
      const p = metricPct(mk, ticker);
      if (p != null) { sum += p; n++; }
    }
    return n ? sum / n : null;
  };
  if (selectedMetrics.length === 1) {
    const fk = selectedMetrics[0];
    const mObj = RESEARCH_METRICS.find(x => x.key === fk);
    const higher = mObj ? mObj.higher : true;
    results.sort((a, b) => {
      const va = metricVal(fk, a.ticker), vb = metricVal(fk, b.ticker);
      if (va == null) return 1; if (vb == null) return -1;
      return higher ? vb - va : va - vb;
    });
  } else {
    results.sort((a, b) => {
      const pa = blendPct(a.ticker), pb = blendPct(b.ticker);
      if (pa == null) return 1; if (pb == null) return -1;
      return pb - pa;
    });
  }
  const shown = results;

  // ---- Filter-row UI (one row per selected metric) ----
  const filterRowsHtml = RESEARCH_STATE.filters.map((f, i) => {
    const mObj = RESEARCH_METRICS.find(x => x.key === f.metric) || RESEARCH_METRICS[0];
    const cov = metricCoverage[f.metric] || 0;
    const dead = cov < 3;
    const isPctMetric = mObj.key.includes('Margin') || ['roe','roa','rotce','revGrowth','epsGrowth','divYield','fcfMargin','cashRatio','sbcPctRev'].includes(mObj.key);
    return `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap" data-filter-row="${i}">
      <select class="heat-filter-select rf-metric" data-i="${i}" style="min-width:230px">${metricOptionsFor(f.metric)}</select>
      ${dead
        ? `<span style="font-family:var(--mono);font-size:9px;color:var(--neg)">no data in this universe</span>`
        : f.threshold
          ? `<select class="heat-filter-select rf-op" data-i="${i}" style="width:60px">
               <option value="gte" ${f.op==='gte'?'selected':''}>≥</option>
               <option value="lte" ${f.op==='lte'?'selected':''}>≤</option>
               <option value="gt"  ${f.op==='gt' ?'selected':''}>&gt;</option>
               <option value="lt"  ${f.op==='lt' ?'selected':''}>&lt;</option>
             </select>
             <input class="rf-val" data-i="${i}" value="${f.val}" placeholder="value" inputmode="decimal"
               style="width:84px;background:var(--bg-card);border:1px solid var(--rule);color:var(--ink);font-family:var(--mono);font-size:11px;padding:5px 8px;border-radius:3px">
             <span style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">${mObj.higher?'higher=better':'lower=better'}${isPctMetric?' · decimal (0.2=20%)':''}</span>
             <button class="btn btn-ghost rf-nothresh" data-i="${i}" style="font-size:9px;padding:2px 7px" title="Remove the value threshold — keep ranking by this metric">− value</button>`
          : `<button class="btn btn-ghost rf-addthresh" data-i="${i}" style="font-size:10px;padding:3px 9px" title="Add an optional value cutoff for this metric">+ value</button>
             <span style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">ranking by ${mObj.higher?'highest':'lowest'} · ${Math.round((cov/totalTickers)*100)}% have data</span>`
      }
      <button class="btn btn-ghost rf-del" data-i="${i}" style="font-size:11px;padding:2px 8px;margin-left:auto" title="Remove this metric">✕</button>
    </div>`;
  }).join('');

  // ---- Result rows: show grade + each selected metric's value ----
  const rowsHtml = shown.map((t, idx) => {
    const metricCells = selectedMetrics.map(mk => {
      const mObj = RESEARCH_METRICS.find(x => x.key === mk);
      const v = metricVal(mk, t.ticker);
      return `<td style="text-align:right;font-family:var(--mono);font-size:11px">${v != null && mObj ? mObj.fmt(v) : '—'}</td>`;
    }).join('');
    const blend = selectedMetrics.length > 1 ? blendPct(t.ticker) : null;
    return `<tr class="research-screen-row" data-ticker="${escapeHtml(t.ticker)}" style="cursor:pointer">
      <td style="font-family:var(--mono);font-size:11px;color:var(--ink-faint);text-align:right">${idx + 1}</td>
      <td style="font-family:var(--mono);font-weight:700">${escapeHtml(t.ticker)}</td>
      <td style="font-size:11px;color:var(--ink-dim)"><div style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div></td>
      <td style="text-align:center"><span style="font-family:var(--mono);font-weight:700;color:${researchGradeColor(t.grade)}">${t.grade || '—'}</span></td>
      ${blend != null ? `<td style="text-align:right;font-family:var(--mono);font-size:11px;font-weight:700" title="Average percentile across selected metrics">${blend.toFixed(0)}</td>` : `<td style="text-align:right;font-family:var(--mono);font-size:11px">${t.gradeScore != null ? t.gradeScore.toFixed(0) : '—'}</td>`}
      ${metricCells}
      <td style="text-align:center;font-family:var(--mono);font-size:9px;color:var(--amber)">open →</td>
    </tr>`;
  }).join('');

  const metricHeaderCols = selectedMetrics.map(mk => {
    const mObj = RESEARCH_METRICS.find(x => x.key === mk);
    return `<th style="text-align:right">${mObj ? escapeHtml(mObj.label) : ''}</th>`;
  }).join('');
  const scoreColLabel = selectedMetrics.length > 1 ? 'Blend' : 'Score';

  return `
    ${catScreenerHtml}
    <div class="company-card" style="margin:0 0 14px">
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">Metric ranker</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-bottom:10px;line-height:1.5">Pick a metric to rank every ticker by it instantly — no value needed. Add more metrics to rank by their blended percentile. Use <strong>+ value</strong> on any metric only if you also want a hard cutoff.${activeThresholds.length ? ` <span style="color:var(--amber)">${activeThresholds.length} threshold${activeThresholds.length>1?'s':''} active.</span>` : ''}</div>
      ${filterRowsHtml}
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost" id="rf-add" style="font-size:10px">+ Add metric</button>
        <button class="btn btn-ghost" id="rf-clear" style="font-size:10px">Reset</button>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-left:auto;align-self:center">${results.length} ranked${selectedMetrics.length === 1 ? ' · by ' + (RESEARCH_METRICS.find(x=>x.key===selectedMetrics[0])?.label || '') : selectedMetrics.length > 1 ? ' · blended ' + selectedMetrics.length + ' metrics' : ''}</span>
      </div>
    </div>
    <div class="company-card" style="margin:0">
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%">
      <table class="sb-table" style="width:100%;min-width:0">
        <thead><tr>
          <th style="text-align:right">#</th><th>Ticker</th><th>Company</th>
          <th style="text-align:center">Grade</th><th style="text-align:right">${scoreColLabel}</th>
          ${metricHeaderCols}
          <th></th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${6 + selectedMetrics.length}" style="padding:20px;text-align:center;color:var(--ink-faint)">No tickers have data for the selected metric(s). Pick P/E, Market Cap, or Dividend Yield — those are populated from the basic feed.</td></tr>`}</tbody>
      </table>
      </div>
    </div>`;
}

function wireResearchScreener() {
  // Category chips: toggle membership in RESEARCH_STATE.screenCats, then re-render.
  document.querySelectorAll('.rf-cat-chip').forEach(chip => chip.addEventListener('click', () => {
    const c = chip.dataset.cat;
    if (!Array.isArray(RESEARCH_STATE.screenCats)) RESEARCH_STATE.screenCats = [];
    const i = RESEARCH_STATE.screenCats.indexOf(c);
    if (i >= 0) RESEARCH_STATE.screenCats.splice(i, 1);
    else RESEARCH_STATE.screenCats.push(c);
    renderResearchTab();
  }));
  const syncFromInputs = () => {
    document.querySelectorAll('.rf-metric').forEach(el => { const i = +el.dataset.i; if (RESEARCH_STATE.filters[i]) RESEARCH_STATE.filters[i].metric = el.value; });
    document.querySelectorAll('.rf-op').forEach(el => { const i = +el.dataset.i; if (RESEARCH_STATE.filters[i]) RESEARCH_STATE.filters[i].op = el.value; });
    document.querySelectorAll('.rf-val').forEach(el => { const i = +el.dataset.i; if (RESEARCH_STATE.filters[i]) RESEARCH_STATE.filters[i].val = el.value.trim(); });
  };
  // CHANGING A METRIC re-ranks instantly (no Apply needed — that's the point).
  document.querySelectorAll('.rf-metric').forEach(el => el.addEventListener('change', () => { syncFromInputs(); renderResearchTab(); }));
  // Changing an operator while a threshold is open also re-applies live.
  document.querySelectorAll('.rf-op').forEach(el => el.addEventListener('change', () => { syncFromInputs(); renderResearchTab(); }));
  // + value / − value: toggle the optional threshold for a metric row.
  document.querySelectorAll('.rf-addthresh').forEach(b => b.addEventListener('click', () => {
    syncFromInputs(); const i = +b.dataset.i;
    if (RESEARCH_STATE.filters[i]) { RESEARCH_STATE.filters[i].threshold = true; }
    renderResearchTab();
  }));
  document.querySelectorAll('.rf-nothresh').forEach(b => b.addEventListener('click', () => {
    syncFromInputs(); const i = +b.dataset.i;
    if (RESEARCH_STATE.filters[i]) { RESEARCH_STATE.filters[i].threshold = false; RESEARCH_STATE.filters[i].val = ''; }
    renderResearchTab();
  }));
  // Add another metric (defaults to a metric that has data so the screen stays live).
  document.getElementById('rf-add')?.addEventListener('click', () => {
    syncFromInputs();
    RESEARCH_STATE.filters.push({ metric: 'marketCap', op: 'gte', val: '', threshold: false });
    renderResearchTab();
  });
  document.getElementById('rf-clear')?.addEventListener('click', () => { RESEARCH_STATE.filters = []; renderResearchTab(); });
  document.querySelectorAll('.rf-del').forEach(b => b.addEventListener('click', () => {
    syncFromInputs(); const i = +b.dataset.i; RESEARCH_STATE.filters.splice(i, 1);
    renderResearchTab();
  }));
  // Typing a threshold value re-applies live on input (debounced) and on Enter.
  let _rfValTimer = null;
  document.querySelectorAll('.rf-val').forEach(el => {
    el.addEventListener('input', () => { clearTimeout(_rfValTimer); _rfValTimer = setTimeout(() => { syncFromInputs(); renderResearchTab(); }, 350); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(_rfValTimer); syncFromInputs(); renderResearchTab(); } });
  });
  // CLICK A RESULT → open that ticker.
  document.querySelectorAll('.research-screen-row').forEach(r => r.addEventListener('click', () => {
    const tk = r.dataset.ticker;
    if (tk && typeof executeCommand === 'function') executeCommand(tk);
  }));
}

function renderResearchGrades(data) {
  // The "Grade" column shows the FRONTEND grade (live, this-browser compute).
  // The "Backend" column shows the backend's nightly grade. They can differ —
  // that's expected and surfaced with a Δ flag. We SORT by the BACKEND score
  // (the stable nightly reference), falling back to the frontend score for any
  // ticker the backend hasn't graded yet, so the ordering is anchored to the
  // authoritative source while each row still displays its own live grade.
  const minCov = RESEARCH_STATE.minCoverage || 0;
  const allUnfiltered = Object.values(data.byTicker).filter(t => t.gradeScore != null);
  const all = allUnfiltered.filter(t => (t.coverage || 0) >= minCov);
  const sortScore = (t) => (t.backendScore != null ? t.backendScore : t.gradeScore);
  all.sort((a, b) => sortScore(b) - sortScore(a));
  const hiddenCount = allUnfiltered.length - all.length;

  const rowsHtml = all.map((t, i) => {
    const hg = (typeof getHumanGrade === 'function') ? getHumanGrade(t.ticker) : null;
    // Verify cell: human grade takes precedence; else backend agreement; else —.
    let verifyCell;
    if (hg && hg.status === 'review') {
      verifyCell = `<span title="Submitted for review — awaiting a human grade" style="color:var(--data-amber);font-size:13px">\u25f7</span>`;
    } else if (hg && hg.grade && hg.grade !== t.grade) {
      // Human assigned a DIFFERENT grade → red ✗ + the human grade next to it.
      verifyCell = `<span title="A human graded this ${hg.grade}, differing from the frontend ${t.grade}" style="color:var(--neg);font-weight:700">\u2717</span> <span style="font-family:var(--mono);font-weight:700;color:${researchGradeColor(hg.grade)}">${hg.grade}</span>`;
    } else if (hg && (hg.status === 'confirmed' || (hg.grade && hg.grade === t.grade))) {
      verifyCell = `<span title="Confirmed by human review" style="color:var(--pos);font-weight:700;font-size:13px">\u2713</span>`;
    } else if (t.backendGrade && !t.diverged) {
      verifyCell = `<span title="Backend agrees with the frontend grade" style="color:var(--pos);font-size:12px">\u2713</span>`;
    } else if (t.backendGrade && t.diverged) {
      verifyCell = `<span title="Backend grades this ${t.backendGrade} (Δ${t.divergence.toFixed(0)} pts) — review to set a human grade" style="color:var(--neg);font-weight:700">\u2717</span> <span style="font-family:var(--mono);font-size:11px;font-weight:700;color:${researchGradeColor(t.backendGrade)}">${t.backendGrade}</span>`;
    } else {
      verifyCell = `<span style="color:var(--ink-faint);font-size:10px">\u2014</span>`;
    }
    const reviewBtn = (hg && hg.status === 'review')
      ? `<button class="research-review-btn" data-ticker="${escapeHtml(t.ticker)}" title="Open to set the human grade" style="background:none;border:1px solid var(--data-amber);color:var(--data-amber);border-radius:3px;font-family:var(--mono);font-size:9px;padding:2px 7px;cursor:pointer">grade…</button>`
      : (hg && hg.grade)
        ? `<button class="research-review-btn" data-ticker="${escapeHtml(t.ticker)}" title="Edit the human grade" style="background:none;border:1px solid var(--rule);color:var(--ink-dim);border-radius:3px;font-family:var(--mono);font-size:9px;padding:2px 7px;cursor:pointer">edit</button>`
        : `<button class="research-review-btn" data-ticker="${escapeHtml(t.ticker)}" title="Submit this grade for human review" style="background:none;border:1px solid var(--rule);color:var(--ink-faint);border-radius:3px;font-family:var(--mono);font-size:9px;padding:2px 7px;cursor:pointer">review</button>`;
    return `
    <tr class="research-row" data-ticker="${t.ticker}" style="cursor:pointer">
      <td style="text-align:center;width:28px" onclick="event.stopPropagation()"><input type="checkbox" class="research-select" data-ticker="${escapeHtml(t.ticker)}" ${RESEARCH_SELECTED.has(t.ticker)?'checked':''} style="cursor:pointer"></td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--ink-faint);text-align:right">${i+1}</td>
      <td style="font-family:var(--mono);font-weight:700">${escapeHtml(t.ticker)}${(typeof editedMarker === 'function') ? editedMarker(t.ticker, 'function') : ''}</td>
      <td style="font-size:11px;color:var(--ink-dim)"><div style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div></td>
      <td style="text-align:center"><span style="font-family:var(--mono);font-size:15px;font-weight:700;color:${researchGradeColor(t.grade)}">${t.grade}</span></td>
      <td style="text-align:center">${verifyCell}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:11px">${t.gradeScore.toFixed(0)}<span style="color:var(--ink-faint);font-size:9px">/100</span></td>
      <td style="text-align:right;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">${t.coverage}/${t.coverageTotal} metrics</td>
      <td style="text-align:center" onclick="event.stopPropagation()">${reviewBtn}</td>
    </tr>`;
  }).join('');

  const be = data.backend;
  // ---- Non-equity cohort (backend-graded on conduct, not fundamentals) ----
  let nonEqHtml = '';
  // Prefer backend non-equity grades; fall back to LOCAL grading (from cached
  // price history) so a just-reclassified ticker (IMST → ETF) shows in this
  // table immediately, before tonight's backend run.
  let neData = _backendResearch?._fresh && _backendResearch.nonEquity ? _backendResearch.nonEquity : null;
  if (!neData && typeof data.nonEquityLocal === 'object') neData = data.nonEquityLocal;
  if (neData) {
    const ne = Object.values(neData).filter(x => x.gradeScore != null).sort((a, b) => b.gradeScore - a.gradeScore);
    if (ne.length) {
      const clsColor = c => c === 'etf/fund' ? '#7faaca' : c?.includes('fx') ? 'var(--data-amber)' : 'var(--ink-dim)';
      const neRows = ne.map((t, i) => `
        <tr class="research-row" data-ticker="${t.ticker}" style="cursor:pointer">
          <td style="text-align:center;width:28px" onclick="event.stopPropagation()"><input type="checkbox" class="research-select" data-ticker="${escapeHtml(t.ticker)}" ${RESEARCH_SELECTED.has(t.ticker)?'checked':''} style="cursor:pointer"></td>
          <td style="font-family:var(--mono);font-size:11px;color:var(--ink-faint);text-align:right">${i + 1}</td>
          <td style="font-family:var(--mono);font-weight:700">${escapeHtml(t.ticker)}</td>
          <td style="font-size:11px;color:var(--ink-dim)"><div style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div></td>
          <td><span style="padding:1px 6px;border:1px solid ${clsColor(t.assetClass)};color:${clsColor(t.assetClass)};border-radius:2px;font-family:var(--mono);font-size:8px;text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(t.assetClass || 'non-equity')}</span></td>
          <td style="text-align:center"><span style="font-family:var(--mono);font-size:15px;font-weight:700;color:${researchGradeColor(t.grade)}">${t.grade}</span></td>
          <td style="text-align:right;font-family:var(--mono);font-size:11px">${t.gradeScore.toFixed(0)}<span style="color:var(--ink-faint);font-size:9px">/100</span></td>
          <td style="text-align:right;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">${t.coverage}/${t.coverageTotal}</td>
        </tr>`).join('');
      nonEqHtml = `
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin:18px 0 8px;line-height:1.6">
          <strong style="color:var(--ink)">Non-Equity Grades</strong> — ETFs, leveraged ETFs, FX, metals, bonds, crypto are graded on a DIFFERENT basis than equities: risk-adjusted conduct (1y &amp; 3m return, Sharpe, volatility/conservativeness, max drawdown, trend consistency), ranked only against other non-equities. They have no ROE — they have behavior. The badge marks the asset class so a grade is never mistaken for a fundamentals grade. Computed nightly by the analytics backend from full repo history.
        </div>
        <div class="company-card" style="margin:0">
          <table class="sb-table" style="width:100%">
            <thead><tr>
              <th style="text-align:center;width:28px"></th>
              <th style="text-align:right">#</th><th>Ticker</th><th>Name</th><th>Class</th>
              <th style="text-align:center">Grade</th><th style="text-align:right">Score</th><th style="text-align:right">Coverage</th>
            </tr></thead>
            <tbody>${neRows}</tbody>
          </table>
        </div>`;
    }
  }

  return `
    ${_researchSparseDataDetected ? `<div style="background:rgba(224,176,76,0.15);border:1px solid var(--amber);border-radius:6px;padding:10px 12px;margin-bottom:12px;font-family:var(--mono);font-size:11px;color:var(--amber);line-height:1.5">
      <strong>Stale data detected.</strong> Your stockbook rows are missing financial fields (revenue, margins, debt…), so grades and coverage are unreliable. The committed data HAS these fields — your browser is serving a cached copy. Fix: <strong>Stock Book → Refresh All</strong>, or hard-refresh the page (Ctrl/Cmd-Shift-R). Grades will be accurate once fresh data loads.
    </div>` : ''}
    <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-bottom:12px;line-height:1.6">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <label style="font-family:var(--mono);font-size:10px;color:var(--ink-dim)">Min coverage:</label>
        <select id="research-mincov" class="heat-filter-select" style="font-size:10px;padding:2px 6px">
          ${[0,5,8,10,12,15,18].map(n => `<option value="${n}" ${minCov===n?'selected':''}>${n===0?'All':n+'+ metrics'}</option>`).join('')}
        </select>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">${all.length} shown${hiddenCount?` · ${hiddenCount} hidden (sparse data)`:''}</span>
        ${(typeof loadHumanGrades === 'function' && Object.keys(loadHumanGrades()).length) ? `<button id="research-export-human" class="btn btn-ghost" style="font-size:9px;margin-left:auto;padding:2px 8px" title="Export human grades as JSON to commit to the XTRAPP repo (so trained reloads honor them)">⤓ Human grades (${Object.keys(loadHumanGrades()).length}) for XTRAPP</button>` : ''}
      </div>
      ${be ? `<span style="color:var(--pos)">● Backend verified</span> — grades cross-checked against the analytics backend (computed ${be.ageHours}h ago, all three books).${be.divergedCount ? ` <span style="color:var(--neg)">${be.divergedCount} divergence${be.divergedCount > 1 ? 's' : ''} flagged (Δ)</span> — backend and this browser disagree on those names; usually stale data on one side.` : ' All grades agree.'}<br>` : `<span style="color:var(--ink-faint)">○ Backend grades unavailable — showing local computation only.</span><br>`}
      Composite grade = category-weighted percentile across the metrics a company reports. Categories carry fixed weights (Profitability 30% · Growth 22% · Valuation 22% · Balance Sheet 16% · Income 10%) so one over-populated category can't dominate, and a missing category is re-normalized away rather than penalized. Size/Scale metrics are shown as context but excluded from the grade — bigger isn't better. Click any company for its per-category breakdown.
    </div>
    <div class="company-card" style="margin:0">
      <table class="sb-table" style="width:100%">
        <thead><tr>
          <th style="text-align:center;width:28px"><input type="checkbox" id="research-select-all" title="Select all shown" style="cursor:pointer"></th>
          <th style="text-align:right">#</th><th>Ticker</th><th>Company</th>
          <th style="text-align:center" title="Frontend grade — computed live in this browser from the metrics it currently has.">Grade</th><th style="text-align:center" title="Verification: green ✓ = confirmed (human or backend agrees); red ✗ = a human assigned a different grade (shown next to Grade); ◷ = awaiting review.">Verify</th><th style="text-align:right">Score</th><th style="text-align:right">Coverage</th><th style="text-align:center" title="Submit this grade for human review, or set a human grade.">Review</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${nonEqHtml}`;
}

function _renderResearchBulkBar() {
  document.getElementById('research-bulk-bar')?.remove();
  if (!RESEARCH_SELECTED.size) return;
  const bar = document.createElement('div');
  bar.id = 'research-bulk-bar';
  bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:9000;background:var(--bg-panel,#16181d);border:1px solid var(--amber);border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 4px 20px rgba(0,0,0,0.5);max-width:94vw';
  const sel = [...RESEARCH_SELECTED];
  bar.innerHTML = `
    <span style="font-family:var(--mono);font-size:11px;color:var(--amber);font-weight:700">${sel.length} selected</span>
    <span style="font-family:var(--mono);font-size:10px;color:var(--ink-dim)">Set classification →</span>
    <select id="research-bulk-class" style="font-family:var(--mono);font-size:10px;padding:3px 6px;background:var(--bg-card);border:1px solid var(--rule);color:var(--ink);border-radius:4px">
      <option value="">— choose —</option>
      <option value="etf">ETF</option>
      <option value="etf_leveraged">ETF (leveraged)</option>
      <option value="fund">Mutual fund</option>
      <option value="bond">Bond / fixed income</option>
      <option value="crypto">Crypto</option>
      <option value="fx">FX / currency</option>
      <option value="future">Future / commodity</option>
      <option value="index">Index</option>
      <option value="international">International equity (grades on available data)</option>
      <option value="equity">Equity (back to fundamentals)</option>
    </select>
    <button class="btn" id="research-bulk-apply" style="font-size:10px;background:var(--pos)">Apply to ${sel.length}</button>
    <button class="btn btn-ghost" id="research-bulk-clear" style="font-size:10px">Clear</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#research-bulk-clear').addEventListener('click', () => {
    RESEARCH_SELECTED.clear(); _renderResearchBulkBar();
    document.querySelectorAll('.research-select').forEach(cb => cb.checked = false);
    const sa = document.getElementById('research-select-all'); if (sa) sa.checked = false;
  });
  bar.querySelector('#research-bulk-apply').addEventListener('click', () => {
    const fn = bar.querySelector('#research-bulk-class').value;
    if (!fn) { if (typeof flashStatus === 'function') flashStatus('Pick a classification first', 'error'); return; }
    let n = 0;
    for (const tk of sel) {
      // Write the same override store the editor + valuation use, so the change
      // is durable and shows everywhere. 'function' drives classifyAssetRow.
      const r0 = (state.stockbook?.rows || []).find(x => x.ticker === tk);
      const oldFn = r0 ? (r0.function || r0._function || null) : null;
      if (typeof setOverride === 'function') { setOverride(tk, 'function', fn, { source: 'research-bulk' }); n++; }
      // Record the edit (timestamped, permanent classification) → review + XTRAPP.
      if (typeof recordFieldEdit === 'function') recordFieldEdit(tk, 'function', fn, { source: 'research-bulk', oldValue: oldFn, permanent: true });
      const r = (state.stockbook?.rows || []).find(x => x.ticker === tk);
      if (r) { delete r._preOverride; if (typeof applyOverridesToRow === 'function') applyOverridesToRow(r); if (typeof normalizeRowFields === 'function') normalizeRowFields(r); }
    }
    RESEARCH_SELECTED.clear();
    _researchCache = null;                 // force recompute so they move tables
    if (typeof renderResearchTab === 'function') renderResearchTab();
    if (typeof flashStatus === 'function') flashStatus(`${n} ticker(s) reclassified to ${fn} — moved to the matching grade scale, saved durably`, 'success');
  });
}

function wireResearchGrades() {
  document.querySelectorAll('.research-row').forEach(r => r.addEventListener('click', () => {
    RESEARCH_STATE.detailTicker = r.dataset.ticker; renderResearchTab();
  }));
  // Review buttons — open a grade-input popover for the human grade.
  document.querySelectorAll('.research-review-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openHumanGradePrompt(b.dataset.ticker, b);
  }));
  const mc = document.getElementById('research-mincov');
  if (mc) mc.addEventListener('change', () => { RESEARCH_STATE.minCoverage = +mc.value; renderResearchTab(); });
  // Export human grades for the XTRAPP repo.
  document.getElementById('research-export-human')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof exportHumanGradesForXtrapp === 'function') exportHumanGradesForXtrapp();
  });

  // Multi-select checkboxes — toggle selection without opening the detail.
  document.querySelectorAll('.research-select').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      const tk = cb.dataset.ticker;
      if (cb.checked) RESEARCH_SELECTED.add(tk); else RESEARCH_SELECTED.delete(tk);
      _renderResearchBulkBar();
    });
  });
  // Select-all toggles every checkbox currently shown.
  const selAll = document.getElementById('research-select-all');
  if (selAll) selAll.addEventListener('change', () => {
    document.querySelectorAll('.research-select').forEach(cb => {
      cb.checked = selAll.checked;
      const tk = cb.dataset.ticker;
      if (selAll.checked) RESEARCH_SELECTED.add(tk); else RESEARCH_SELECTED.delete(tk);
    });
    _renderResearchBulkBar();
  });
  _renderResearchBulkBar();   // restore the bar if a selection persisted
}

function renderResearchDetail(data, ticker) {
  let t = data.byTicker[ticker];
  // Reclassified to a non-equity (ETF/fund/FX/etc.)? Show its non-equity grade
  // card instead of "No data" — the ticker just moved scales, it didn't vanish.
  if (!t) {
    const ne = (data.nonEquityLocal && data.nonEquityLocal[ticker])
      || (_backendResearch?.nonEquity && _backendResearch.nonEquity[ticker]) || null;
    if (ne) return renderNonEquityDetail(ne, ticker);
    return `<div style="padding:20px;color:var(--ink-faint)">
      <button class="btn btn-ghost" onclick="RESEARCH_STATE.detailTicker=null;renderResearchTab()" style="font-size:11px;margin-bottom:12px">← Back</button>
      <div>No grade yet for ${escapeHtml(ticker)}. ${' '}
      <button class="btn btn-ghost" style="font-size:10px" onclick="openResearchEditor('${escapeHtml(ticker)}')">✎ Edit / classify</button>
      <button class="btn btn-ghost" style="font-size:10px" onclick="reportTickerForReview('${escapeHtml(ticker)}')">⚑ Report for review</button></div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:8px">If this is an ETF/fund/FX/bond, set its classification in the editor and it'll grade on the non-equity scale.</div>
    </div>`;
  }

  // The live row, for computing any metric value the rank tables missed.
  const liveRow = (state.stockbook?.rows || []).find(r => r.ticker === ticker) || null;
  const backendRanks = _backendResearch?.byTicker?.[ticker]?.ranks || null;

  // Group ranks by category
  const cats = [...new Set(RESEARCH_METRICS.map(x => x.cat))];
  const catBlocks = cats.map(cat => {
    const metrics = RESEARCH_METRICS.filter(x => x.cat === cat);
    const rowsHtml = metrics.map(m => {
      let rk = t.ranks[m.key];
      // Fallback 1: backend's rank for this metric (computed server-side).
      if (!rk && backendRanks && backendRanks[m.key]) rk = backendRanks[m.key];
      // Fallback 2: no rank anywhere, but the row HAS the value — show the raw
      // number (unranked) rather than a misleading "n/a". This is what makes
      // every metric with real data appear even before ranking catches up.
      if (!rk && liveRow) {
        const v = m.get(liveRow);
        if (v != null && isFinite(v)) {
          return `<tr><td style="font-size:11px;color:var(--ink-dim)">${escapeHtml(m.label)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:700">${m.fmt(v)}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:9px;color:var(--ink-faint)">unranked</td>
            <td style="text-align:right"></td></tr>`;
        }
      }
      if (!rk) {
        return `<tr><td style="font-size:11px;color:var(--ink-dim)">${escapeHtml(m.label)}</td>
          <td style="text-align:right;font-family:var(--mono);font-size:11px;color:var(--ink-faint)">no data</td>
          <td style="text-align:right"></td><td style="text-align:right"></td></tr>`;
      }
      const pctColor = rk.pct >= 70 ? 'var(--pos)' : rk.pct >= 40 ? 'var(--data-amber)' : 'var(--neg)';
      return `<tr>
        <td style="font-size:11px;color:var(--ink-dim)">${escapeHtml(m.label)}</td>
        <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:700">${m.fmt(rk.value)}</td>
        <td style="text-align:right;font-family:var(--mono);font-size:11px;color:var(--ink)">#${rk.rank} <span style="color:var(--ink-faint);font-size:9px">of ${rk.total}</span></td>
        <td style="text-align:right;font-family:var(--mono);font-size:11px;color:${pctColor};font-weight:700">${rk.pct}<span style="font-size:8px">%ile</span></td>
      </tr>`;
    }).join('');
    return `
      <div class="company-card" style="margin:0 0 12px">
        <h4>${escapeHtml(cat)}</h4>
        <table class="sb-table" style="width:100%">
          <thead><tr><th>Metric</th><th style="text-align:right">Value</th><th style="text-align:right">Rank</th><th style="text-align:right">Percentile</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }).join('');

  return `
    <button class="btn btn-ghost" id="research-back" style="margin-bottom:14px;font-size:11px">← Back to grades</button>
    <div class="company-card" style="border-left:3px solid ${researchGradeColor(t.grade)};margin:0 0 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <h3 style="font-family:var(--serif);font-size:24px;margin:0">${escapeHtml(t.ticker)} <span style="font-size:13px;color:var(--ink-dim);font-weight:400">${escapeHtml(t.name)}</span></h3>
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:4px">${escapeHtml(t.sector || '')} · graded on ${t.coverage} of ${t.coverageTotal} metrics${t.coverage < t.coverageTotal/2 ? ' · sparse data, grade less reliable' : ''}</div>
        </div>
        <div style="text-align:center">
          <div style="font-family:var(--mono);font-size:48px;font-weight:700;line-height:1;color:${researchGradeColor(t.grade)}">${t.grade}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:2px">${t.gradeScore.toFixed(0)}/100 composite</div>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" style="font-size:10px;background:var(--pos)" onclick="openResearchEditor('${t.ticker}')">✎ Edit metrics &amp; classification</button>
        <button class="btn btn-ghost" style="font-size:10px" onclick="document.getElementById('ticker').value='${t.ticker}';switchTab('valuation');setTimeout(()=>document.getElementById('fetch-btn')?.click(),100)">Open in Valuation →</button>
      </div>
      ${(() => {
        // Category breakdown: shows how each WEIGHTED category scored (0-100
        // percentile) and its weight, so the grade is explainable — you can see
        // it's, say, a great grower that's expensive, not just a letter.
        const cs = t.categoryScores || {};
        const order = [['Profitability',0.30],['Growth',0.22],['Valuation',0.22],['Balance Sheet',0.16],['Income',0.10]];
        const bars = order.filter(([c]) => cs[c] != null).map(([cat, w]) => {
          const v = cs[cat];
          const color = v >= 70 ? 'var(--pos)' : v >= 45 ? 'var(--amber)' : 'var(--neg)';
          return `<div style="margin-bottom:5px">
            <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--ink-dim);margin-bottom:2px">
              <span>${escapeHtml(cat)} <span style="color:var(--ink-faint)">· ${Math.round(w*100)}% of grade</span></span><span style="color:${color};font-weight:700">${v}</span>
            </div>
            <div style="height:5px;background:var(--rule);border-radius:3px;overflow:hidden"><div style="height:100%;width:${v}%;background:${color}"></div></div>
          </div>`;
        }).join('');
        return bars ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--rule)"><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Category breakdown (percentile vs peers)</div>${bars}</div>` : '';
      })()}
      ${(() => {
        // PEER GRADE + REGIME GRADE + MOMENTUM GRADE — the market-condition-aware reads.
        let pg = null, rg = null, mg = null;
        try { if (typeof computePeerGrade === 'function') pg = computePeerGrade(t.ticker); } catch {}
        try { if (typeof computeRegimeGrade === 'function') rg = computeRegimeGrade(t.ticker); } catch {}
        try { if (typeof computeMomentumGrade === 'function') mg = computeMomentumGrade(t.ticker); } catch {}
        if (!pg && !rg && !mg) return '';
        const card = (title, g, sub) => {
          if (!g) return '';
          const color = g.score >= 70 ? 'var(--pos)' : g.score >= 45 ? 'var(--amber)' : 'var(--neg)';
          return `<div style="flex:1;min-width:160px;background:var(--bg-card);border:1px solid var(--rule);border-radius:6px;padding:10px">
            <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">${title}</div>
            <div style="display:flex;align-items:baseline;gap:8px">
              <span style="font-size:22px;font-weight:800;color:${color};font-family:var(--mono)">${g.label}</span>
              <span style="font-family:var(--mono);font-size:11px;color:var(--ink-dim)">${g.score}/100</span>
            </div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:4px;line-height:1.4">${escapeHtml(g.note || '')}</div>
            <div style="font-family:var(--mono);font-size:8px;color:var(--ink-faint);margin-top:3px;opacity:0.7">${sub}</div>
          </div>`;
        };
        const momSub = mg && mg.hasSocial ? 'price + volume + social' : 'price + volume (open Activity→Social to add social)';
        return `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--rule)">
          <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Peer · regime · momentum grades</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${card('Peer Grade', pg, 'vs sector peers + sector ETF momentum')}
            ${card('Regime Grade', rg, 'tailwind/headwind in the current regime')}
            ${card('Momentum Grade', mg, momSub)}
          </div>
          ${(() => {
            // DEEP TREND ANALYSIS — the statistical read (σ-momentum, trend
            // quality, health-vs-toppy classification, peer-relative, real drift).
            let tr = null;
            try { tr = (typeof analyzePriceTrend === 'function') ? analyzePriceTrend(t.ticker) : null; } catch {}
            if (!tr) return '';
            const classColors = {
              'healthy-uptrend': 'var(--pos)', 'persistent-downtrend': 'var(--neg)',
              'late-stage-extended': 'var(--amber)', 'rolling-over': 'var(--amber)',
              'breaking-down': 'var(--neg)', 'choppy-rangebound': 'var(--ink-dim)', 'neutral': 'var(--ink-dim)',
            };
            const cc = classColors[tr.classification] || 'var(--ink-dim)';
            const su = (k) => tr.momentumByHorizon[k] ? `${tr.momentumByHorizon[k].sigmaUnits >= 0 ? '+' : ''}${tr.momentumByHorizon[k].sigmaUnits}σ` : '—';
            const pct = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
            const stat = (label, val, tip) => `<div title="${tip || ''}"><span style="color:var(--ink-faint)">${label}</span> <span style="color:var(--ink)">${val}</span></div>`;
            return `<div style="margin-top:10px;background:var(--bg-card);border:1px solid var(--rule);border-left:3px solid ${cc};border-radius:6px;padding:11px">
              <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.05em">Trend Analysis <span style="opacity:0.6">· statistical price-behavior read</span></div>
                <div style="font-family:var(--mono);font-size:11px;font-weight:700;color:${cc}">${tr.classification.replace(/-/g, ' ')}</div>
              </div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-bottom:8px;line-height:1.4">${escapeHtml(tr.healthNote)}</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px 14px;font-family:var(--mono);font-size:10px;line-height:1.5">
                ${stat('Momentum', tr.momentumScore + '/100', 'Blended σ-unit momentum across horizons')}
                ${stat('Trend quality', tr.trendQuality + '/100 ' + tr.trendDir, 'R² of the log-price fit — how clean the trend is')}
                ${stat('Ann. vol', (tr.stats.annualizedVol * 100).toFixed(0) + '%', 'Annualized volatility of daily returns')}
                ${stat('1mo / 3mo', su('d20') + ' / ' + su('d63'), 'Momentum in standard-deviation units — judged against this stock own volatility, not a flat percent')}
                ${stat('Vol regime', tr.stats.volRegime != null ? tr.stats.volRegime + '×' : '—', 'Recent vol ÷ long-run vol. >1.3 = expanding (risk rising)')}
                ${stat('From high', pct(tr.stats.fromHigh), 'Distance below the running peak')}
                ${tr.real ? stat('Real drift', pct(tr.real.realDriftAnn) + '/yr', 'Inflation-adjusted annualized trend (CPI-deflated)') : ''}
                ${tr.peerRelative != null ? stat('Vs peers', pct(tr.peerRelative), tr.peerNote || 'vs sector peers, 3-month') : ''}
              </div>
            </div>`;
          })()}
        </div>`;
      })()}
    </div>
    ${catBlocks}`;
}

function wireResearchDetailBack() {
  document.getElementById('research-back')?.addEventListener('click', () => {
    RESEARCH_STATE.detailTicker = null; renderResearchTab();
  });
}
