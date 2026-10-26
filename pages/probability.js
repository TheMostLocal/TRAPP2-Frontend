/* ==========================================================================
   pages/probability.js — z160 (Phase 3). Moved verbatim from app.js; loaded the first time the page opens
   (app.js keeps a stub for renderProbabilityTab that loads this file, then calls the real function).
   Every function here is used only by this page (checked against app.js, every other script and index.html).
   ========================================================================== */
function loadCallSources() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(CALL_SOURCES_STORAGE) || '[]') || []; } catch {}
  const used = Array.from(new Set(loadCalls().map(c => c.source).filter(Boolean)));
  return Array.from(new Set([...saved, ...used, ...CALL_SEED_SOURCES])).sort((a, b) => a.localeCompare(b));
}

function addCallSource(name) {
  if (!name) return;
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(CALL_SOURCES_STORAGE) || '[]') || []; } catch {}
  if (!saved.includes(name)) { saved.push(name); try { localStorage.setItem(CALL_SOURCES_STORAGE, JSON.stringify(saved)); } catch {} }
}

function thesisRemainingDays(thesis) {
  if (!thesis.targetDate) return thesis.days || thesis.initialDays || 90;
  const ms = new Date(thesis.targetDate) - new Date();
  const days = Math.ceil(ms / 86400000);
  return Math.max(1, days);
}

function logit(p) {
  // Clamp to avoid infinity
  const c = Math.max(0.001, Math.min(0.999, p));
  return Math.log(c / (1 - c));
}

function invLogit(x) { return 1 / (1 + Math.exp(-x)); }

function sigmoid(x, k = 1) { return 1 / (1 + Math.exp(-k * x)); }

function probHistorical(history, currentPrice, strike, direction, daysAhead) {
  if (!history || history.length < 30) return null;
  // Daily log returns
  const returns = [];
  for (let i = 1; i < history.length; i++) {
    const r = Math.log(history[i].price / history[i - 1].price);
    if (isFinite(r)) returns.push(r);
  }
  if (returns.length < 20) return null;
  const mu = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mu) ** 2, 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);
  if (!isFinite(sigma) || sigma <= 0) return null;
  // Project to T trading days
  const T = daysAhead;
  const meanLogP = Math.log(currentPrice) + mu * T;
  const sdLogP = sigma * Math.sqrt(T);
  // P(P_T > K) for direction='above'; otherwise complement
  const z = (Math.log(strike) - meanLogP) / sdLogP;
  const probAbove = 1 - normCdf(z);
  return {
    p: direction === 'above' ? probAbove : 1 - probAbove,
    annualizedVol: sigma * Math.sqrt(252),
    annualizedDrift: mu * 252,
    realizedVol52w: sigma * Math.sqrt(252),
  };
}

function probValuation(ticker, currentPrice, strike, direction) {
  const saved = loadSaved();
  const v = saved.find(s => s.ticker === ticker.toUpperCase());
  if (!v || !v.fairValue || !currentPrice) return null;
  // Margin of safety relative to STRIKE (where we're betting price will be)
  // If fair value is well above strike, "above strike" thesis gets a lift
  const mosVsStrike = (v.fairValue - strike) / strike;
  // Sigmoid with k=4: MoS=20% → 0.69, MoS=-20% → 0.31, MoS=50% → 0.88
  const pAbove = sigmoid(mosVsStrike, 4);
  return {
    p: direction === 'above' ? pAbove : 1 - pAbove,
    fairValue: v.fairValue,
    mosVsStrike,
    savedAt: v.savedAt,
  };
}

function resolveMacroETF(rowOrSector) {
  if (typeof rowOrSector === 'string') return sectorNameToETF(rowOrSector);
  if (!rowOrSector) return null;
  return sectorNameToETF(rowOrSector.sector)
      || sectorNameToETF(rowOrSector.subSector)
      || sectorNameToETF(rowOrSector.industry)
      || null;
}

function probMacro(sectorOrRow, direction) {
  const m = state.macro;
  if (!m?.current?.quad) return null;
  if (!sectorOrRow) return null;
  const etf = resolveMacroETF(sectorOrRow);
  if (!etf) return null;
  const etfData = SECTOR_ETFS.find(e => e.ticker === etf);
  if (!etfData) return null;
  const quad = m.current.quad;
  let pAbove = 0.50;
  let stance = 'neutral';
  if (etfData.favors.includes(quad)) { pAbove = 0.60; stance = 'tailwind'; }
  else if (etfData.hurts.includes(quad)) { pAbove = 0.40; stance = 'headwind'; }
  return {
    p: direction === 'above' ? pAbove : 1 - pAbove,
    quad,
    quadName: QUADS[quad].name,
    etf,
    stance,
  };
}

function probCrossSignals(thesis, sbRow, currentPrice) {
  const ticker = thesis.ticker.toUpperCase();
  const direction = thesis.direction;
  const diag = {};
  const subSignals = {};

  // ---- 1. Peer momentum from supply chains ----
  // For every chain this ticker appears in, take peers at the same tier
  // and average their 1-month returns. If multiple chains, average across.
  try {
    if (typeof getSupplyChainPeersForTicker === 'function') {
      const matches = getSupplyChainPeersForTicker(ticker);
      const allPeerReturns = [];
      for (const m of matches) {
        for (const p of m.peers) {
          if (!p.ticker) continue;
          const ret = (typeof _chainTickerReturn === 'function')
            ? _chainTickerReturn(p.ticker, 21)  // 1-month
            : null;
          if (ret != null && isFinite(ret)) allPeerReturns.push(ret);
        }
      }
      if (allPeerReturns.length >= 3) {
        const avgRet = allPeerReturns.reduce((a, b) => a + b, 0) / allPeerReturns.length;
        // Sigmoid: ±5% peer move → ~±10pt prob shift from 0.50.
        // Bigger peer rally → higher probability for "above" theses.
        const z = avgRet / 0.025;  // 2.5% scaling → z=2 at +5%
        const pAbove = 1 / (1 + Math.exp(-z));
        subSignals.peer = direction === 'above' ? pAbove : 1 - pAbove;
        diag.peer = { count: allPeerReturns.length, avgReturn: avgRet, p: subSignals.peer };
      } else {
        diag.peer = { count: allPeerReturns.length, note: 'need 3+ priced peers' };
      }
    }
  } catch (e) {
    diag.peer = { error: e.message };
  }

  // ---- 2. Sector ETF momentum ----
  // Uses the sectorNameToETF mapping from elsewhere in the app. Take the
  // ETF's 1-month return, sigmoid-transform.
  try {
    const sectorEtf = (sbRow?.sector || sbRow?.subSector)
      ? (typeof sectorNameToETF === 'function' ? sectorNameToETF(sbRow.sector || sbRow.subSector) : null)
      : null;
    if (sectorEtf) {
      const etfRet = (typeof _chainTickerReturn === 'function')
        ? _chainTickerReturn(sectorEtf, 21)
        : null;
      if (etfRet != null && isFinite(etfRet)) {
        // Same sigmoid as peer momentum but slightly tighter scaling
        // because sector ETFs are less volatile than individual peers.
        const z = etfRet / 0.02;
        const pAbove = 1 / (1 + Math.exp(-z));
        subSignals.etf = direction === 'above' ? pAbove : 1 - pAbove;
        diag.etf = { ticker: sectorEtf, return: etfRet, p: subSignals.etf };
      } else {
        diag.etf = { ticker: sectorEtf, note: 'no return data' };
      }
    } else {
      diag.etf = { note: 'no sector ETF mapping' };
    }
  } catch (e) {
    diag.etf = { error: e.message };
  }

  // ---- 3. Fundamentals trend ----
  // Combines revenue growth + earnings growth + operating margin into one
  // score in [0,1]. Each is sigmoid-transformed individually then averaged.
  try {
    const rg = sbRow?.revenueGrowth;
    const eg = sbRow?.earningsGrowth;
    const om = sbRow?.operatingMargin ?? sbRow?.grossMargin;
    const components = [];
    if (rg != null && isFinite(rg)) {
      // Revenue growth: 10% YoY → roughly +5pt above 50%
      components.push(1 / (1 + Math.exp(-(rg / 0.10))));
    }
    if (eg != null && isFinite(eg)) {
      // Earnings growth: more volatile, so wider scaling
      components.push(1 / (1 + Math.exp(-(eg / 0.15))));
    }
    if (om != null && isFinite(om)) {
      // Margin: ~15% considered neutral, sigmoid centered there
      components.push(1 / (1 + Math.exp(-((om - 0.15) / 0.10))));
    }
    if (components.length > 0) {
      const fundScore = components.reduce((a, b) => a + b, 0) / components.length;
      subSignals.fund = direction === 'above' ? fundScore : 1 - fundScore;
      diag.fund = {
        inputs: components.length,
        revenueGrowth: rg, earningsGrowth: eg, margin: om,
        score: fundScore,
      };
    } else {
      diag.fund = { note: 'no growth/margin data in stockbook' };
    }
  } catch (e) {
    diag.fund = { error: e.message };
  }

  // ---- 4. Technical trend ----
  // Position vs 20D + 50D SMA + distance from 52W high.
  // Above both SMAs + near high → bullish bias.
  try {
    const hist = (typeof _chainGetPriceHistory === 'function')
      ? _chainGetPriceHistory(ticker)
      : null;
    if (hist && hist.length >= 50) {
      const prices = hist.map(h => h.price).filter(p => p != null && isFinite(p));
      const last = prices[prices.length - 1];
      const sma20 = _avg(prices.slice(-20));
      const sma50 = _avg(prices.slice(-50));
      const high52w = Math.max(...prices.slice(-252));
      const distFromHigh = (high52w - last) / high52w;  // 0 = at high, 1 = down 100%

      // Score components, each in [0,1]:
      //   • last/sma20 ratio: 1.0 = at SMA, scaled. >1.02 → bullish.
      //   • last/sma50 ratio: same logic, slower trend.
      //   • dist from high: ≤2% from high → near-high, bullish.
      const sma20Score = 1 / (1 + Math.exp(-((last / sma20 - 1) / 0.02)));
      const sma50Score = 1 / (1 + Math.exp(-((last / sma50 - 1) / 0.03)));
      const nearHighScore = 1 / (1 + Math.exp((distFromHigh - 0.10) / 0.05));
      const techScore = (sma20Score + sma50Score + nearHighScore) / 3;

      subSignals.tech = direction === 'above' ? techScore : 1 - techScore;
      diag.tech = {
        last: +last.toFixed(2),
        sma20: +sma20.toFixed(2),
        sma50: +sma50.toFixed(2),
        high52w: +high52w.toFixed(2),
        distFromHigh: +(distFromHigh * 100).toFixed(1),
        score: techScore,
      };
    } else {
      diag.tech = { note: hist ? `only ${hist.length} bars` : 'no history' };
    }
  } catch (e) {
    diag.tech = { error: e.message };
  }

  // ---- 5. Fed rate-path tailwind/headwind ----
  // Rate-sensitive sectors (real estate, utilities, regional banks, long-duration
  // growth, homebuilders) move with the expected rate path. An easing bias is a
  // tailwind for rate-cut beneficiaries; tightening is a headwind. Uses the
  // blended market+user expectation from the Fed tab.
  try {
    if (typeof fedRateExpectation === 'function') {
      const fed = fedRateExpectation();
      // Net easing pressure in [-1, 1]: positive = cuts expected
      const easingPressure = Math.max(-1, Math.min(1, -fed.expectedBpsChange / 75)); // -75bps → +1.0
      // Sector sensitivity sign: +1 = benefits from cuts, -1 = hurt by cuts
      const sector = (sbRow?.sector || sbRow?.subSector || '').toLowerCase();
      let sensitivity = 0;
      if (/real estate|reit|utilities|homebuild|residential|construction/.test(sector)) sensitivity = 1;
      else if (/technology|software|growth|biotech|semiconductor/.test(sector)) sensitivity = 0.6; // long-duration growth
      else if (/bank|financial|insurance/.test(sector)) sensitivity = -0.5; // banks' NIM can compress when cutting
      else if (/energy|materials|staples/.test(sector)) sensitivity = 0.1;
      if (sensitivity !== 0) {
        // Combine: easing × positive-sensitivity → bullish push
        const push = easingPressure * sensitivity;  // [-1, 1]
        const pAbove = 1 / (1 + Math.exp(-(push / 0.4)));
        subSignals.fed = direction === 'above' ? pAbove : 1 - pAbove;
        diag.fed = {
          stance: fed.stance,
          expectedBpsChange: +fed.expectedBpsChange.toFixed(0),
          sectorSensitivity: sensitivity,
          push: +push.toFixed(2),
          p: subSignals.fed,
        };
      } else {
        diag.fed = { note: 'sector not rate-sensitive', stance: fed.stance };
      }
    }
  } catch (e) {
    diag.fed = { error: e.message };
  }

  // ---- Blend the sub-signals ----
  // Equal weights inside the component. If a sub-signal is missing it drops
  // out and the remaining weights re-normalize (log-odds method matches
  // the top-level blender).
  const keys = Object.keys(subSignals);
  if (keys.length === 0) {
    return { p: null, subSignals, diag, note: 'no sub-signals available' };
  }
  let logitSum = 0;
  const eachWeight = 1 / keys.length;
  for (const k of keys) {
    const p = subSignals[k];
    // Clamp to avoid log(0)
    const pClamped = Math.max(0.01, Math.min(0.99, p));
    logitSum += eachWeight * Math.log(pClamped / (1 - pClamped));
  }
  const p = 1 / (1 + Math.exp(-logitSum));

  return {
    p,
    subSignals,
    diag,
    inputCount: keys.length,
  };
}

function _avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function blendProbabilities(components, weights) {
  // components = { hist: 0.62, val: 0.55, macro: 0.50, manual: 0.70 }
  // weights = { hist: 0.4, val: 0.3, macro: 0.2, manual: 0.1 }  (must sum to 1)
  let totalW = 0;
  let weightedLogit = 0;
  for (const k of Object.keys(components)) {
    const p = components[k];
    if (p == null) continue;
    const w = weights[k] || 0;
    weightedLogit += w * logit(p);
    totalW += w;
  }
  if (totalW === 0) return 0.5;
  // Normalize so the available components reflect their full weight
  return invLogit(weightedLogit / totalW);
}

async function computeThesisProbability(thesis) {
  const ticker = thesis.ticker.toUpperCase();

  // Try multiple sources for current price + sector
  // 1. Stockbook row (sheet-derived)
  let sbRow = getStockbookRow(ticker);

  // 2. If stockbook empty, force a load
  if (!sbRow && (state.stockbook?.rows?.length ?? 0) === 0) {
    try {
      await loadStockBook(false);
      sbRow = getStockbookRow(ticker);
    } catch {}
  }

  // 3. Sector fallback: pull from enrichment cache if sheet doesn't have it
  let sector = sbRow?.sector;
  if (!sector) {
    try {
      const cache = JSON.parse(localStorage.getItem(DESC_CACHE_KEY) || '{}');
      if (cache[ticker]?.sector) sector = cache[ticker].sector;
    } catch {}
  }
  // 4. If still no sector, fetch via enrichTicker (Finnhub → Wikipedia)
  if (!sector) {
    try {
      const enriched = await enrichTicker(ticker, sbRow?.name);
      if (enriched?.sector) sector = enriched.sector;
    } catch {}
  }

  // Current price: stockbook → sheet history (last point) → state.stock
  let currentPrice = sbRow?.price;
  let priceSource = 'sheet';
  if (!currentPrice) {
    const hist = await getPriceHistory(ticker).catch(() => null);
    if (hist && hist.length > 0) {
      currentPrice = hist[hist.length - 1].price;
      priceSource = 'sheet-history';
    }
  }
  if (!currentPrice && state.stock?.ticker === ticker) {
    currentPrice = state.stock.price;
    priceSource = 'memory';
  }
  if (!currentPrice) {
    return {
      error: 'No current price for ' + ticker + '. Add it to your sheet, or load it on the Valuation tab first.',
      diagnostics: {
        stockbookHasTicker: !!sbRow,
        stockbookSize: state.stockbook?.rows?.length || 0,
        sector: sector || null,
      },
    };
  }

  // 1. Historical
  const hist = await getPriceHistory(ticker).catch(() => null);
  const histResult = probHistorical(hist, currentPrice, thesis.strike, thesis.direction, thesisRemainingDays(thesis));
  const histDiag = {
    historyFound: !!hist,
    historyLength: hist?.length || 0,
    needsAtLeast: 30,
  };

  // 2. Valuation
  const valResult = probValuation(ticker, currentPrice, thesis.strike, thesis.direction);
  const savedAll = loadSaved();
  const valDiag = {
    savedValuationsTotal: savedAll.length,
    savedForThisTicker: savedAll.filter(v => v.ticker === ticker).length,
  };

  // 3. Macro — pass the full row so SPY etc. can fall back to subSector
  const macroInput = sbRow ? {
    sector: sbRow.sector || sector,
    subSector: sbRow.subSector,
    industry: sbRow.industry,
  } : sector;
  const macroResult = probMacro(macroInput, thesis.direction);
  const macroDiag = {
    sector: sector || null,
    subSector: sbRow?.subSector || null,
    sectorSource: sbRow?.sector ? 'sheet' : sector ? 'enrichment' : 'missing',
    macroLoaded: !!state.macro?.current?.quad,
  };

  // 4. Manual
  const manualP = thesis.manualPrior ?? 0.5;

  // 5. AI Inference — multi-feature gradient model
  const aiResult = await probAIInference(thesis, sbRow);

  // 6. Cross-Signals — peer momentum + sector ETF momentum + fundamentals + technicals.
  // Single component (with internal sub-signal breakdown) to avoid double-counting
  // overlap with AI Inference and to keep the UI uncluttered. Each sub-signal is
  // independently calibrated and weak ones (missing data) drop out gracefully.
  const crossResult = probCrossSignals(thesis, sbRow, currentPrice);

  const components = {
    ai: aiResult?.p ?? null,
    hist: histResult?.p ?? null,
    val: valResult?.p ?? null,
    macro: macroResult?.p ?? null,
    cross: crossResult?.p ?? null,
    manual: manualP,
  };
  const blended = blendProbabilities(components, thesis.weights);

  return {
    currentPrice,
    priceSource,
    sector,
    components,
    weights: thesis.weights,
    blended,
    details: {
      ai: aiResult,
      hist: histResult,
      val: valResult,
      macro: macroResult,
      cross: crossResult,
      manual: { p: manualP }
    },
    diagnostics: { hist: histDiag, val: valDiag, macro: macroDiag, cross: crossResult?.diag || {} },
  };
}

function _ensureCallsCSS() {
  if (document.getElementById('calls-css')) return;
  const st = document.createElement('style'); st.id = 'calls-css';
  st.textContent = '.calls-sub{display:inline-flex;background:rgba(0,0,0,.16);border:1px solid var(--rule);border-radius:9px;padding:2px;gap:2px;margin-bottom:14px}'
    + '.calls-sub button{font-family:var(--mono);font-size:10px;font-weight:600;color:var(--ink-dim);background:transparent;border:none;border-radius:7px;padding:6px 14px;cursor:pointer}'
    + '.calls-sub button.active{background:var(--amber);color:#000}'
    + '.call-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;align-items:end}'
    + '.call-form label{display:flex;flex-direction:column;gap:3px}'
    + '.call-form span{font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}'
    + '.call-form input,.call-form select{font-family:var(--mono);font-size:12px;padding:6px 8px;background:var(--bg);border:1px solid var(--rule);border-radius:5px;color:var(--ink);width:100%;box-sizing:border-box}'
    + '.call-form input:focus,.call-form select:focus{outline:none;border-color:var(--amber)}'
    + '.calls-table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px}'
    + '.calls-table th{text-align:left;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);padding:6px 8px;border-bottom:1px solid var(--rule);white-space:nowrap}'
    + '.calls-table td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap}'
    + '.calls-table tr:hover td{background:rgba(224,176,76,.06)}';
  (document.head || document.documentElement).appendChild(st);
}

function _callsSubNav() {
  const v = PROB_VIEW.view;
  return `<div class="calls-sub">
    <button data-probview="theses" class="${v === 'theses' ? 'active' : ''}">Theses</button>
    <button data-probview="calls" class="${v === 'calls' ? 'active' : ''}">Analyst Calls</button>
    <button data-probview="score" class="${v === 'score' ? 'active' : ''}">Scorecard</button>
  </div>`;
}

function _winTabs(attr) {
  const w = PROB_VIEW.win;
  return `<div class="calls-sub" style="margin-bottom:10px">${[['month', '1M'], ['quarter', '3M'], ['year', '1Y'], ['all', 'ALL']]
    .map(([k, l]) => `<button data-${attr}="${k}" class="${w === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
}

function renderCallsView(host) {
  _ensureCallsCSS();
  const calls = loadCalls();
  const sources = loadCallSources();
  const today = new Date().toISOString().slice(0, 10);
  const scored = calls.map(scoreCall).sort((a, b) => (a.date < b.date ? 1 : -1));
  const rows = scored.map(c => `
    <tr>
      <td style="color:var(--ink-dim)">${c.date || ''}</td>
      <td style="font-weight:700">${c.source || ''}</td>
      <td><span class="bot-ticker-link" data-ticker="${c.ticker}" style="color:var(--amber);cursor:pointer;text-decoration:underline;text-decoration-style:dotted">${c.ticker}</span></td>
      <td style="color:${c.direction === 'bearish' ? 'var(--neg)' : 'var(--pos)'};font-weight:700">${(c.direction || 'bullish').toUpperCase()}</td>
      <td style="color:var(--ink-faint);max-width:220px;overflow:hidden;text-overflow:ellipsis">${(c.note || '').replace(/</g, '&lt;')}</td>
      <td style="color:var(--ink-dim)">${c.entry != null ? '$' + c.entry.toFixed(2) : '—'}</td>
      <td style="color:var(--ink-dim)">${c.live != null ? '$' + c.live.toFixed(2) : '—'}</td>
      <td style="font-weight:700;color:${c.retPct == null ? 'var(--ink-faint)' : c.retPct >= 0 ? 'var(--pos)' : 'var(--neg)'}">${c.retPct == null ? '—' : (c.retPct >= 0 ? '+' : '') + c.retPct + '%'}</td>
      <td style="color:var(--ink-faint)">${c.days != null ? c.days + 'd' : '—'}</td>
      <td><button class="btn btn-ghost" data-callrm="${c.id}" style="font-size:9px;padding:2px 7px">✕</button></td>
    </tr>`).join('');
  host.innerHTML = _callsSubNav() + `
    <div class="company-card">
      <h4>Log a call <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· who said it, what they said, when · tracked from that date forward</span></h4>
      <div class="call-form">
        <label><span>Source</span>
          <select id="call-source">${sources.map(x => `<option value="${x}">${x}</option>`).join('')}<option value="__new">+ Add new…</option></select>
        </label>
        <label id="call-newsrc-wrap" style="display:none"><span>New source</span><input id="call-newsrc" placeholder="e.g. Raymond James"></label>
        <label><span>Ticker / ETF</span><input id="call-ticker" placeholder="NVDA" style="text-transform:uppercase"></label>
        <label><span>Call</span><select id="call-dir"><option value="bullish">Bullish / Buy</option><option value="bearish">Bearish / Sell</option></select></label>
        <label><span>Date</span><input id="call-date" type="date" value="${today}"></label>
        <label style="grid-column:span 2"><span>Note (optional)</span><input id="call-note" placeholder="buy the dip in semis"></label>
        <button class="btn" id="call-add" style="font-size:11px">+ Add call</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-ghost" id="calls-sync" style="font-size:10px">↑ Sync calls to Supabase</button>
        <span id="calls-msg" style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);align-self:center"></span>
      </div>
    </div>
    <div class="company-card">
      <h4>Calls <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${calls.length} logged · return measured from the call date to now, signed by direction</span></h4>
      <div style="overflow-x:auto">
        <table class="calls-table"><thead><tr>
          <th>Date</th><th>Source</th><th>Ticker</th><th>Call</th><th>Note</th><th>At call</th><th>Now</th><th>Return</th><th>Held</th><th></th>
        </tr></thead><tbody>${rows || '<tr><td colspan="10" style="color:var(--ink-faint);padding:14px">No calls logged yet — add one above.</td></tr>'}</tbody></table>
      </div>
    </div>`;
  const srcSel = host.querySelector('#call-source');
  srcSel?.addEventListener('change', () => {
    host.querySelector('#call-newsrc-wrap').style.display = srcSel.value === '__new' ? '' : 'none';
  });
  host.querySelector('#call-add')?.addEventListener('click', () => {
    let source = srcSel.value;
    if (source === '__new') { source = (host.querySelector('#call-newsrc').value || '').trim(); if (source) addCallSource(source); }
    const ticker = (host.querySelector('#call-ticker').value || '').trim().toUpperCase();
    const date = host.querySelector('#call-date').value || today;
    const direction = host.querySelector('#call-dir').value;
    const note = (host.querySelector('#call-note').value || '').trim();
    if (!source || !ticker) { host.querySelector('#calls-msg').textContent = 'source + ticker required'; return; }
    const all = loadCalls();
    all.push({ id: `${ticker}-${date}-${Date.now()}`, source, ticker, direction, date, note,
      priceAtCall: _callPriceAt(ticker, date), createdAt: new Date().toISOString() });
    saveCalls(all);
    if (typeof flashStatus === 'function') flashStatus(`Logged ${source} · ${direction} ${ticker}`, 'success');
    renderProbabilityTab();
  });
  host.querySelectorAll('[data-callrm]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-callrm');
    saveCalls(loadCalls().filter(c => c.id !== id));
    renderProbabilityTab();
  }));
  host.querySelector('#calls-sync')?.addEventListener('click', async () => {
    const msg = host.querySelector('#calls-msg');
    if (typeof analyticsSupabasePushKV !== 'function') { msg.textContent = 'analytics Supabase not configured'; return; }
    msg.textContent = 'syncing…';
    try { const n = await analyticsSupabasePushKV(); msg.textContent = `✓ pushed ${n} row(s)`; }
    catch { msg.textContent = 'sync failed — check Analytics Supabase config'; }
  });
  host.querySelectorAll('.bot-ticker-link').forEach(el => el.addEventListener('click', () => {
    const t = el.getAttribute('data-ticker');
    if (t && typeof lookupTicker === 'function') lookupTicker(t);
  }));
}

function renderCallsScorecard(host) {
  _ensureCallsCSS();
  const all = loadCalls();
  const w = PROB_VIEW.win;
  const mine = all.filter(c => (c.source || '').toLowerCase() === 'me');
  const analysts = all.filter(c => (c.source || '').toLowerCase() !== 'me');
  const card = (title, sc, sub) => {
    const wr = sc.winRate;
    return `<div class="company-card" style="margin-bottom:14px">
      <h4>${title} <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${sub}</span></h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:14px 12px">
        ${[['Win rate', wr == null ? '—' : wr + '%', wr == null ? 'var(--ink-faint)' : wr >= 50 ? 'var(--pos)' : 'var(--neg)', `${sc.wins}W / ${sc.losses}L`],
           ['Calls scored', String(sc.n), 'var(--ink)', sc.pending ? sc.pending + ' pending price' : 'all priced'],
           ['Avg return', sc.avgReturn == null ? '—' : (sc.avgReturn >= 0 ? '+' : '') + sc.avgReturn + '%', sc.avgReturn == null ? 'var(--ink-faint)' : sc.avgReturn >= 0 ? 'var(--pos)' : 'var(--neg)', 'per call, direction-signed'],
           ['Best', sc.best ? `${sc.best.ticker} ${sc.best.retPct >= 0 ? '+' : ''}${sc.best.retPct}%` : '—', 'var(--pos)', sc.best ? sc.best.source : ''],
           ['Worst', sc.worst ? `${sc.worst.ticker} ${sc.worst.retPct >= 0 ? '+' : ''}${sc.worst.retPct}%` : '—', 'var(--neg)', sc.worst ? sc.worst.source : '']]
          .map(([l, v, c, s2]) => `<div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:.1em;text-transform:uppercase">${l}</div><div style="font-family:var(--mono);font-size:17px;font-weight:700;color:${c};margin-top:3px;white-space:nowrap">${v}</div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:1px">${s2 || ''}</div></div>`).join('')}
      </div>
    </div>`;
  };
  const board = callsBySource(all, w);
  const boardRows = board.map(b => `
    <tr>
      <td style="font-weight:700">${b.source}</td>
      <td style="font-weight:700;color:${b.winRate == null ? 'var(--ink-faint)' : b.winRate >= 50 ? 'var(--pos)' : 'var(--neg)'}">${b.winRate == null ? '—' : b.winRate + '%'}</td>
      <td style="color:var(--ink-dim)">${b.wins}W / ${b.losses}L</td>
      <td style="color:${(b.avgReturn ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)'}">${b.avgReturn == null ? '—' : (b.avgReturn >= 0 ? '+' : '') + b.avgReturn + '%'}</td>
      <td style="color:var(--ink-faint)">${b.n}${b.pending ? ' (+' + b.pending + ')' : ''}</td>
    </tr>`).join('');
  host.innerHTML = _callsSubNav() + _winTabs('probwin') +
    card('Analyst &amp; institution calls', callsScorecard(analysts, w), `${w === 'all' ? 'all time' : w === 'month' ? 'last 30 days' : w === 'quarter' ? 'last 3 months' : 'last year'} · calls made in the window`) +
    card('Your calls', callsScorecard(mine, w), 'logged under source "Me"') + `
    <div class="company-card">
      <h4>Leaderboard <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· by source · sorted by win rate</span></h4>
      <div style="overflow-x:auto">
        <table class="calls-table"><thead><tr><th>Source</th><th>Win rate</th><th>W/L</th><th>Avg return</th><th>Calls</th></tr></thead>
        <tbody>${boardRows || '<tr><td colspan="5" style="color:var(--ink-faint);padding:14px">No calls in this window.</td></tr>'}</tbody></table>
      </div>
    </div>`;
  host.querySelectorAll('[data-probwin]').forEach(b => b.addEventListener('click', () => { PROB_VIEW.win = b.getAttribute('data-probwin'); renderProbabilityTab(); }));
}

async function renderProbabilityTab() {
  const grid = document.getElementById('prob-grid');
  const empty = document.getElementById('prob-empty');
  // Sub-views: Theses (the original) | Analyst Calls | Scorecard.
  if (grid && PROB_VIEW.view !== 'theses') {
    if (empty) empty.style.display = 'none';
    if (PROB_VIEW.view === 'calls') renderCallsView(grid); else renderCallsScorecard(grid);
    grid.querySelectorAll('[data-probview]').forEach(b => b.addEventListener('click', () => { PROB_VIEW.view = b.getAttribute('data-probview'); renderProbabilityTab(); }));
    return;
  }
  const allTheses = state.probability.theses;
  const _subNav = (typeof _callsSubNav === 'function') ? _callsSubNav() : '';
  const _wireSub = () => grid.querySelectorAll('[data-probview]').forEach(b => b.addEventListener('click', () => { PROB_VIEW.view = b.getAttribute('data-probview'); renderProbabilityTab(); }));
  if (allTheses.length === 0) {
    if (typeof _ensureCallsCSS === 'function') _ensureCallsCSS();
    grid.innerHTML = _subNav;
    _wireSub();
    empty.style.display = 'block';
    return;
  }
  if (typeof _ensureCallsCSS === 'function') _ensureCallsCSS();
  empty.style.display = 'none';

  // ===== AUTO-RESOLVE EXPIRED THESES =====
  // Walk each active thesis: if its target date has passed, mark it archived
  // and record the final resolution. Like prediction markets (Kalshi /
  // Polymarket), the final probability is binary:
  //   • target hit at any point during the window → 100%
  //   • target never hit → 0%
  //
  // We use the snapshot history to detect "hit at any point": if any
  // snapshot's price crossed the strike in the correct direction, the
  // thesis resolves YES. This handles the case where a stock touched the
  // strike intraday but ended below at expiry.
  let archivedNow = 0;
  for (const t of allTheses) {
    if (t.status === 'archived') continue;
    const remainingDays = thesisRemainingDays(t);
    if (remainingDays > 0) continue;

    // Expired — determine resolution
    let resolution = 'no';
    const snapshots = t.snapshots || [];
    // Hit if any historical snapshot price ever crossed the strike in the right direction
    for (const snap of snapshots) {
      if (snap.price == null) continue;
      if (t.direction === 'above' && snap.price >= t.strike) { resolution = 'yes'; break; }
      if (t.direction === 'below' && snap.price <= t.strike) { resolution = 'yes'; break; }
    }
    // Also check the last-known price from stockbook as a final check
    if (resolution === 'no') {
      const sbRow = getStockbookRow(t.ticker.toUpperCase());
      const finalPrice = sbRow?.price;
      if (finalPrice != null) {
        if (t.direction === 'above' && finalPrice >= t.strike) resolution = 'yes';
        if (t.direction === 'below' && finalPrice <= t.strike) resolution = 'yes';
      }
    }
    t.status = 'archived';
    t.resolvedAt = new Date().toISOString();
    t.resolution = resolution;
    t.finalProb = resolution === 'yes' ? 1.0 : 0.0;
    // Append the final resolution snapshot so the chart pins to 0% or 100%
    if (!t.snapshots) t.snapshots = [];
    t.snapshots.push({
      t: t.resolvedAt,
      p: t.finalProb,
      price: null,
      resolved: true,
    });
    archivedNow++;
  }
  if (archivedNow > 0) {
    saveTheses(state.probability.theses);
    console.log(`[probability] auto-archived ${archivedNow} expired theses`);
  }

  // Split active vs archived
  const activeTheses   = allTheses.filter(t => t.status !== 'archived');
  const archivedTheses = allTheses.filter(t => t.status === 'archived');

  // Compute each active in parallel
  const computed = await Promise.all(activeTheses.map(t =>
    computeThesisProbability(t).then(r => ({ thesis: t, result: r }))
  ));

  // ===== SNAPSHOT LOGGING =====
  // Push a new snapshot to thesis.snapshots[] every render (throttled).
  // Each snapshot = { t: ISO timestamp, p: probability, price: current_price }.
  //
  // Throttling: we don't want to flood the array on every micro-render. Only
  // push if either:
  //   (a) it's the first ever snapshot for this thesis, OR
  //   (b) >= MIN_SNAPSHOT_INTERVAL_MS has passed since the last snapshot
  //
  // 5-minute throttle gives us ~80-100 points per trading day, which is
  // plenty for a clean sparkline without explosive storage growth. A 1-year
  // thesis ends up with about 25K points = ~2MB localStorage, well within
  // the 5MB browser limit.
  const MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
  const MAX_SNAPSHOTS_PER_THESIS = 5000;            // hard cap for safety
  const now = Date.now();
  let snapshotsAddedThisRender = 0;

  computed.forEach(({ thesis, result }) => {
    if (result?.error) return;
    if (result.blended == null) return;

    // First-time creation snapshot (preserve existing behavior)
    if (thesis.createdProb == null) {
      thesis.createdProb = result.blended;
      snapshotsAddedThisRender++;
    }
    if (thesis.createdPrice == null && result.currentPrice != null) {
      thesis.createdPrice = result.currentPrice;
    }

    if (!Array.isArray(thesis.snapshots)) thesis.snapshots = [];
    const last = thesis.snapshots[thesis.snapshots.length - 1];
    const lastTime = last ? new Date(last.t).getTime() : 0;

    if (!last || (now - lastTime) >= MIN_SNAPSHOT_INTERVAL_MS) {
      thesis.snapshots.push({
        t: new Date(now).toISOString(),
        p: result.blended,
        price: result.currentPrice ?? null,
      });
      // Trim if oversized (oldest first)
      if (thesis.snapshots.length > MAX_SNAPSHOTS_PER_THESIS) {
        thesis.snapshots.splice(0, thesis.snapshots.length - MAX_SNAPSHOTS_PER_THESIS);
      }
      snapshotsAddedThisRender++;
    }
  });
  if (snapshotsAddedThisRender > 0) saveTheses(state.probability.theses);

  // Build dashboard summary across active theses
  const valid = computed.filter(c => !c.result.error);
  const summaryHtml = renderProbabilitySummary(valid);

  // Active thesis cards
  const activeCardsHtml = computed.map(({ thesis, result }) =>
    renderThesisCard(thesis, result)).join('');

  // Archived thesis section — collapsed by default, expandable
  const archivedHtml = archivedTheses.length > 0
    ? renderArchivedThesesSection(archivedTheses)
    : '';

  grid.innerHTML = _subNav + summaryHtml + activeCardsHtml + archivedHtml;
  _wireSub();

  // Wire up interactions
  computed.forEach(({ thesis }) => {
    wireThesisCard(thesis);
  });

  // Wire archived cards — they have a restricted action set (restore + delete)
  // and use a different DOM class so wireThesisCard doesn't find them.
  archivedTheses.forEach(thesis => {
    const card = document.querySelector(`.thesis-archived-card[data-id="${thesis.id}"]`);
    if (!card) return;
    card.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (act === 'restore') {
          if (!await appConfirm(`Restore "${thesis.ticker}" to active theses?`)) return;
          thesis.status = 'active';
          thesis.resolvedAt = null;
          thesis.resolution = null;
          thesis.finalProb = null;
          if (Array.isArray(thesis.snapshots)) {
            thesis.snapshots = thesis.snapshots.filter(s => !s.resolved);
          }
          saveTheses(state.probability.theses);
          renderProbabilityTab();
        } else if (act === 'delete') {
          if (!await appConfirm(`Permanently delete archived thesis for ${thesis.ticker}? This cannot be undone.`, { danger: true })) return;
          state.probability.theses = state.probability.theses.filter(t => t.id !== thesis.id);
          _thesisTombstone(thesis.id);
          saveTheses(state.probability.theses);
          renderProbabilityTab();
        }
      });
    });
  });
}

function renderProbabilitySummary(computed) {
  if (computed.length === 0) return '';

  // Categorize each thesis by probability
  const buckets = {
    veryLikely: computed.filter(c => c.result.blended >= 0.70),
    likely:     computed.filter(c => c.result.blended >= 0.55 && c.result.blended < 0.70),
    coinflip:   computed.filter(c => c.result.blended >= 0.45 && c.result.blended < 0.55),
    unlikely:   computed.filter(c => c.result.blended >= 0.30 && c.result.blended < 0.45),
    veryUnlikely: computed.filter(c => c.result.blended < 0.30),
  };

  // Average blended probability across all
  const avgProb = computed.reduce((s, c) => s + c.result.blended, 0) / computed.length;

  // Sector exposure breakdown
  const sectorMap = {};
  computed.forEach(c => {
    const s = c.result.sector || 'Unknown';
    if (!sectorMap[s]) sectorMap[s] = { count: 0, totalProb: 0 };
    sectorMap[s].count++;
    sectorMap[s].totalProb += c.result.blended;
  });
  const sectorRows = Object.entries(sectorMap)
    .map(([s, d]) => ({ sector: s, count: d.count, avgProb: d.totalProb / d.count }))
    .sort((a, b) => b.count - a.count);

  // Highest-conviction thesis (highest probability * how far above 50%)
  const topThesis = [...computed].sort((a, b) => b.result.blended - a.result.blended)[0];
  const bottomThesis = [...computed].sort((a, b) => a.result.blended - b.result.blended)[0];

  const macroQuad = state.macro?.current?.quad;
  const macroLabel = macroQuad ? `Q${macroQuad} · ${QUADS[macroQuad].name}` : 'Macro not loaded';

  return `
    <div class="prob-summary">
      <div class="prob-summary-head">
        <div>
          <div class="prob-summary-title">Probability Dashboard</div>
          <div class="prob-summary-sub">${computed.length} theses · ${macroLabel}</div>
        </div>
        <div class="prob-summary-avg">
          <div class="prob-summary-avg-label">Average Probability</div>
          <div class="prob-summary-avg-pct" style="color:${avgProb > 0.5 ? 'var(--pos)' : 'var(--neg)'}">
            ${(avgProb * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <!-- Probability distribution histogram (5 buckets) -->
      <div class="prob-summary-buckets">
        ${[
          { key: 'veryLikely', label: 'Very Likely', sub: '≥70%', color: 'var(--pos)' },
          { key: 'likely', label: 'Likely', sub: '55–70%', color: '#7aa085' },
          { key: 'coinflip', label: 'Coin Flip', sub: '45–55%', color: 'var(--data-amber)' },
          { key: 'unlikely', label: 'Unlikely', sub: '30–45%', color: '#b88578' },
          { key: 'veryUnlikely', label: 'Very Unlikely', sub: '<30%', color: 'var(--neg)' },
        ].map(b => `
          <div class="prob-bucket" style="border-top:3px solid ${b.color}">
            <div class="prob-bucket-count">${buckets[b.key].length}</div>
            <div class="prob-bucket-label">${b.label}</div>
            <div class="prob-bucket-sub">${b.sub}</div>
          </div>
        `).join('')}
      </div>

      <!-- Top picks: most & least likely outcomes -->
      <div class="prob-summary-picks">
        <div class="prob-pick">
          <div class="prob-pick-label up">▲ Highest probability</div>
          <div class="prob-pick-thesis">
            <span class="tic">${topThesis.thesis.ticker}</span>
            ${topThesis.thesis.direction} ${fmt$(topThesis.thesis.strike)} in ${thesisRemainingDays(topThesis.thesis)}d
          </div>
          <div class="prob-pick-pct" style="color:var(--pos)">${(topThesis.result.blended * 100).toFixed(1)}%</div>
        </div>
        <div class="prob-pick">
          <div class="prob-pick-label down">▼ Lowest probability</div>
          <div class="prob-pick-thesis">
            <span class="tic">${bottomThesis.thesis.ticker}</span>
            ${bottomThesis.thesis.direction} ${fmt$(bottomThesis.thesis.strike)} in ${thesisRemainingDays(bottomThesis.thesis)}d
          </div>
          <div class="prob-pick-pct" style="color:var(--neg)">${(bottomThesis.result.blended * 100).toFixed(1)}%</div>
        </div>
      </div>

      ${sectorRows.length > 1 ? `
      <div class="prob-summary-sectors">
        <div class="prob-summary-sectors-title">Sector Exposure (avg probability per sector)</div>
        <table class="prob-summary-table">
          <thead><tr><th>Sector</th><th>Theses</th><th>Avg Probability</th><th></th></tr></thead>
          <tbody>
            ${sectorRows.map(s => {
              const w = (s.avgProb * 100).toFixed(0);
              return `
                <tr>
                  <td>${s.sector}</td>
                  <td>${s.count}</td>
                  <td style="color:${s.avgProb > 0.5 ? 'var(--pos)' : 'var(--neg)'}">${(s.avgProb * 100).toFixed(1)}%</td>
                  <td><div class="prob-summary-bar"><div style="width:${w}%;background:${s.avgProb > 0.5 ? 'var(--pos)' : 'var(--neg)'}"></div></div></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}
    </div>
  `;
}

function renderProbabilitySparkline(thesis, opts = {}) {
  const snapshots = thesis.snapshots || [];
  if (snapshots.length < 2) {
    // Not enough data yet — show a small placeholder so the layout doesn't jump
    return `
      <div class="thesis-sparkline-placeholder" style="height:${opts.height || 50}px;display:flex;align-items:center;justify-content:center;color:var(--ink-faint);font-family:var(--mono);font-size:9px;background:var(--bg-elev);border:1px solid var(--rule);border-radius:3px;padding:6px">
        ${snapshots.length === 1 ? '1 snapshot — chart appears after 2nd render' : 'Logging starts on first compute'}
      </div>
    `;
  }

  const w = opts.width || 200;
  const h = opts.height || 50;
  const padL = 4, padR = 4, padT = 4, padB = 4;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  // Convert snapshot times to x-coords (normalize 0..1 over the lifespan)
  const times = snapshots.map(s => new Date(s.t).getTime());
  const minT = times[0];
  const maxT = Math.max(...times);
  const tRange = maxT - minT || 1;
  const points = snapshots.map((s, i) => {
    const x = padL + ((times[i] - minT) / tRange) * chartW;
    const y = padT + (1 - (s.p ?? 0.5)) * chartH;
    return { x, y, p: s.p, t: s.t, resolved: s.resolved };
  });

  // Line color: trend-aware
  const first = snapshots[0].p ?? 0.5;
  const last  = snapshots[snapshots.length - 1].p ?? 0.5;
  const trendColor = last > first + 0.005 ? 'var(--pos)'
                   : last < first - 0.005 ? 'var(--neg)'
                   : 'var(--amber)';

  // Build polyline string
  const polylineStr = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Gridlines at 25/50/75
  const gridY = (val) => padT + (1 - val) * chartH;

  // Last point highlight — bigger circle, color matches trend
  const lastPt = points[points.length - 1];

  // Bottom strip with first → last labels
  const firstPct = (first * 100).toFixed(0);
  const lastPct  = (last * 100).toFixed(0);
  const delta = (last - first) * 100;
  const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'pt';

  return `
    <div class="thesis-sparkline">
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="display:block;background:var(--bg-elev);border-radius:3px">
        <!-- 25/50/75 gridlines -->
        <line x1="${padL}" y1="${gridY(0.25)}" x2="${w - padR}" y2="${gridY(0.25)}" stroke="var(--rule)" stroke-width="0.5" stroke-dasharray="1,3"/>
        <line x1="${padL}" y1="${gridY(0.50)}" x2="${w - padR}" y2="${gridY(0.50)}" stroke="var(--rule)" stroke-width="0.8"/>
        <line x1="${padL}" y1="${gridY(0.75)}" x2="${w - padR}" y2="${gridY(0.75)}" stroke="var(--rule)" stroke-width="0.5" stroke-dasharray="1,3"/>
        <!-- The line -->
        <polyline points="${polylineStr}" fill="none" stroke="${trendColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <!-- Last point marker -->
        <circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="2.5" fill="${trendColor}"/>
      </svg>
      <div class="thesis-sparkline-labels">
        <span class="thesis-sparkline-from">${firstPct}%</span>
        <span class="thesis-sparkline-delta" style="color:${trendColor}">${deltaStr}</span>
        <span class="thesis-sparkline-to">${lastPct}%</span>
      </div>
    </div>
  `;
}

function renderArchivedThesesSection(archived) {
  if (!archived.length) return '';
  // Sort newest-resolved first
  const sorted = [...archived].sort((a, b) =>
    new Date(b.resolvedAt || b.createdAt) - new Date(a.resolvedAt || a.createdAt)
  );
  const cards = sorted.map(t => {
    const isWin = t.resolution === 'yes';
    const winColor = isWin ? 'var(--pos)' : 'var(--neg)';
    const winLabel = isWin ? 'YES — TARGET HIT' : 'NO — DID NOT HIT';
    const targetDate = new Date(t.targetDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const resolvedDate = t.resolvedAt ? new Date(t.resolvedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const createdDate = t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    return `
      <div class="thesis-archived-card" data-id="${t.id}">
        <div class="thesis-archived-head">
          <div>
            <div class="thesis-archived-question">
              <span class="tic">${t.ticker}</span>
              closes <strong>${t.direction}</strong> ${fmt$(t.strike)} by ${targetDate}
            </div>
            <div class="thesis-archived-meta">
              Staked ${createdDate} · Resolved ${resolvedDate} ·
              At creation: <strong style="color:var(--ink-dim)">${t.createdProb != null ? (t.createdProb * 100).toFixed(0) + '%' : '—'}</strong>
            </div>
          </div>
          <div class="thesis-archived-result" style="background:rgba(${isWin ? '91,138,114' : '165,100,90'},0.12);color:${winColor};border:1px solid ${winColor}">
            ${winLabel}
          </div>
        </div>
        <div class="thesis-archived-sparkline">
          ${renderProbabilitySparkline(t, { height: 60 })}
        </div>
        <div class="thesis-actions">
          <button class="thesis-action-btn" data-act="restore" data-id="${t.id}" title="Move back to active list (e.g. if auto-archive was wrong)">Restore</button>
          <button class="thesis-action-btn danger" data-act="delete" data-id="${t.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="archived-section">
      <details ${archived.length > 0 ? '' : 'open'}>
        <summary class="archived-summary">
          <span>Past Theses · ${archived.length} resolved</span>
          <span class="archived-stats">
            ${(() => {
              const wins = archived.filter(t => t.resolution === 'yes').length;
              const losses = archived.filter(t => t.resolution === 'no').length;
              const winRate = (wins + losses) > 0 ? Math.round(wins / (wins + losses) * 100) : null;
              return `<span style="color:var(--pos)">${wins} won</span> · <span style="color:var(--neg)">${losses} lost</span>${winRate != null ? ` · ${winRate}% hit rate` : ''}`;
            })()}
          </span>
        </summary>
        <div class="archived-list">${cards}</div>
      </details>
    </div>
  `;
}

function renderThesisCard(thesis, result) {
  if (result.error) {
    return `
      <div class="thesis-card" data-id="${thesis.id}">
        <div class="thesis-question">
          <span class="tic">${thesis.ticker}</span> ${thesis.direction} $${thesis.strike} in ${thesisRemainingDays(thesis)}d
        </div>
        <div style="color:var(--red);font-family:var(--mono);font-size:11px">${result.error}</div>
        <div class="thesis-actions">
          <button class="thesis-action-btn danger" data-act="delete" data-id="${thesis.id}">Delete</button>
        </div>
      </div>
    `;
  }

  const { components, weights, blended, currentPrice, details, sector } = result;
  const pct = (blended * 100).toFixed(1);
  const _remDays = thesisRemainingDays(thesis);
  const horizonLabel = _remDays >= 365 ? Math.round(_remDays / 365) + 'y'
    : _remDays >= 30 ? Math.round(_remDays / 30) + 'mo' : _remDays + 'd';
  const targetDate = new Date(thesis.targetDate || (Date.now() + (thesis.days || 90) * 86400000))
    .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const targetMove = ((thesis.strike / currentPrice - 1) * 100);
  const moveLabel = (targetMove >= 0 ? '+' : '') + targetMove.toFixed(1) + '%';

  // Component cells
  const compCell = (key, label, value, weight, hint) => {
    const v = value;
    const valDisplay = v == null ? '—'
      : key === 'manual' ? (v * 100).toFixed(0) + '%'
      : (v * 100).toFixed(1) + '%';
    const muted = v == null ? 'muted' : (v > 0.5 ? 'up' : v < 0.5 ? 'down' : '');
    return `
      <div class="thesis-component">
        <div class="name">${label}</div>
        <div class="value ${muted}">${valDisplay}</div>
        ${hint ? `<div style="color:var(--ink-faint);font-size:9px;margin-top:2px">${hint}</div>` : ''}
        <div class="weight">
          <input type="range" min="0" max="100" value="${(weight * 100).toFixed(0)}"
                 data-comp="${key}" data-id="${thesis.id}">
          <span class="weight-val">${(weight * 100).toFixed(0)}%</span>
        </div>
      </div>
    `;
  };

  return `
    <div class="thesis-card" data-id="${thesis.id}">
      <div class="thesis-question">
        <span class="tic">${thesis.ticker}</span>
        closes <strong>${thesis.direction}</strong> ${fmt$(thesis.strike)} by ${targetDate}
      </div>

      <div class="thesis-prob">
        <div class="thesis-prob-pct">${pct}<span style="font-size:24px">%</span></div>
        <div>
          <div class="thesis-prob-label">Implied Probability</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--ink-dim);margin-top:2px">
            Current: ${fmt$(currentPrice)} · Move needed: ${moveLabel}
          </div>
          ${thesis.createdProb != null ? (() => {
            const createdPct = (thesis.createdProb * 100).toFixed(1);
            const delta = (blended - thesis.createdProb) * 100;
            const deltaColor = delta > 0.5 ? 'var(--pos)' : delta < -0.5 ? 'var(--neg)' : 'var(--ink-dim)';
            const priceDelta = thesis.createdPrice ? ((currentPrice - thesis.createdPrice) / thesis.createdPrice * 100) : null;
            const priceColor = priceDelta == null ? 'var(--ink-dim)' : priceDelta > 0 ? 'var(--pos)' : 'var(--neg)';
            return `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:6px;padding-top:6px;border-top:1px dashed var(--rule)">
              At creation: <strong style="color:var(--ink-dim)">${createdPct}%</strong>
              ${thesis.createdPrice != null ? ` @ <strong style="color:var(--ink-dim)">${fmt$(thesis.createdPrice)}</strong>` : ''}
              · Change: <strong style="color:${deltaColor}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts</strong>
              ${priceDelta != null ? ` · Price: <strong style="color:${priceColor}">${priceDelta >= 0 ? '+' : ''}${priceDelta.toFixed(1)}%</strong>` : ''}
            </div>`;
          })() : ''}
        </div>
      </div>
      <div class="thesis-prob-bar">
        <div class="thesis-prob-bar-fill" style="width:${pct}%"></div>
      </div>
      ${(() => {
        // ---- Probability timeline ----
        // Record a daily snapshot of the blended probability + price so the
        // user can see the TREND over the thesis's life, not just creation vs
        // now. We keep at most one snapshot per calendar day (latest wins) and
        // cap the history at 120 points to bound storage.
        if (!Array.isArray(thesis.probTimeline)) thesis.probTimeline = [];
        const todayKey = new Date().toISOString().slice(0, 10);
        const last = thesis.probTimeline[thesis.probTimeline.length - 1];
        if (!last || last.date !== todayKey) {
          thesis.probTimeline.push({ date: todayKey, prob: blended, price: currentPrice });
        } else {
          last.prob = blended; last.price = currentPrice;  // update today's point
        }
        if (thesis.probTimeline.length > 120) thesis.probTimeline = thesis.probTimeline.slice(-120);
        // Persist (debounced via the existing save in callers, but save here too)
        try { if (typeof saveTheses === 'function') saveTheses(state.probability.theses); } catch {}

        const tl = thesis.probTimeline;
        if (tl.length < 2) {
          return `<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:8px">Probability timeline starts building from today — revisit over the coming days to see the trend.</div>`;
        }
        // Build an SVG sparkline of probability over time
        const W = 320, H = 48, pad = 4;
        const probs = tl.map(p => p.prob);
        const minP = Math.min(...probs), maxP = Math.max(...probs);
        const range = (maxP - minP) || 0.01;
        const n = tl.length;
        const x = (i) => pad + (i / (n - 1)) * (W - 2 * pad);
        const y = (p) => H - pad - ((p - minP) / range) * (H - 2 * pad);
        const path = tl.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.prob).toFixed(1)}`).join(' ');
        const first = tl[0], lastPt = tl[tl.length - 1];
        const trend = lastPt.prob - first.prob;
        const trendColor = trend > 0.005 ? 'var(--pos)' : trend < -0.005 ? 'var(--neg)' : 'var(--ink-dim)';
        const spanDays = Math.round((new Date(lastPt.date) - new Date(first.date)) / 86400000);
        return `
          <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--rule)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:0.08em;text-transform:uppercase">Probability Trend · ${n} pts over ${spanDays}d</span>
              <span style="font-family:var(--mono);font-size:10px;font-weight:700;color:${trendColor}">${trend >= 0 ? '↑' : '↓'} ${trend >= 0 ? '+' : ''}${(trend * 100).toFixed(1)} pts</span>
            </div>
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">
              <line x1="${pad}" y1="${y(0.5).toFixed(1)}" x2="${W - pad}" y2="${y(0.5).toFixed(1)}" stroke="var(--rule)" stroke-dasharray="2,3" stroke-width="0.5"/>
              <path d="${path}" fill="none" stroke="${trendColor}" stroke-width="1.5"/>
              <circle cx="${x(n - 1).toFixed(1)}" cy="${y(lastPt.prob).toFixed(1)}" r="2.5" fill="${trendColor}"/>
            </svg>
            <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:8px;color:var(--ink-faint);margin-top:2px">
              <span>${first.date} · ${(first.prob * 100).toFixed(0)}%</span>
              <span>${lastPt.date} · ${(lastPt.prob * 100).toFixed(0)}%</span>
            </div>
          </div>`;
      })()}

      <div class="thesis-components">
        ${compCell('ai', 'AI Inference', components.ai, weights.ai,
          details.ai?.interpretation || (details.ai?.error || 'Need 30+ days of history'))}
        ${compCell('hist', 'Historical', components.hist, weights.hist,
          details.hist ? `Realized vol ${(details.hist.realizedVol52w * 100).toFixed(0)}% ann`
            : result.diagnostics?.hist?.historyFound
              ? `Only ${result.diagnostics.hist.historyLength} days · need 30+`
              : 'No price history in sheet')}
        ${compCell('val', 'Valuation (DCF)', components.val, weights.val,
          details.val ? `Saved FV ${fmt$(details.val.fairValue)}`
            : result.diagnostics?.val?.savedValuationsTotal === 0
              ? 'No saved valuations · run Save on Valuation tab'
              : `No saved DCF for ${thesis.ticker}`)}
        ${compCell('macro', 'Macro Quad', components.macro, weights.macro,
          details.macro ? `Q${details.macro.quad} ${details.macro.stance}`
            : !result.diagnostics?.macro?.macroLoaded ? 'Macro tab not loaded'
            : !result.diagnostics?.macro?.sector ? 'No sector found · enrich Stock Book'
            : 'Sector not mapped to ETF')}
        ${(() => {
          // Cross-Signals breakdown — peer momentum + sector ETF + fundamentals + technicals
          // Hint shows how many sub-signals contributed and the strongest one
          const cd = details.cross;
          if (!cd || cd.p == null) {
            return compCell('cross', 'Cross-Signals', null, weights.cross,
              cd?.note || 'No peers/sector/fundamentals/technicals available');
          }
          const subs = cd.subSignals || {};
          const labelByKey = { peer: 'Peers', etf: 'Sector ETF', fund: 'Fundamentals', tech: 'Technicals' };
          // Show abbreviated breakdown in the hint
          const inputs = Object.keys(subs);
          const hintParts = inputs.map(k => {
            const v = subs[k];
            const pct = (v * 100).toFixed(0);
            const color = v > 0.55 ? 'var(--pos)' : v < 0.45 ? 'var(--neg)' : 'var(--ink-faint)';
            return `<span style="color:${color}">${labelByKey[k] || k} ${pct}%</span>`;
          });
          const hint = `${cd.inputCount}/4 inputs: ${hintParts.join(' · ')}`;
          return compCell('cross', 'Cross-Signals', cd.p, weights.cross, hint);
        })()}
        ${compCell('manual', 'Your Prior', components.manual, weights.manual,
          'Drag the value slider →')}
        <!-- Sparkline lives in the component grid next to Your Prior, sized
             to match a component cell so the row reads cleanly. Shows how
             the blended probability has evolved over the lifetime of the
             thesis — Kalshi/Polymarket style. -->
        <div class="thesis-component thesis-component-spark">
          <div class="name">Trend · ${(thesis.snapshots?.length || 0)} pts</div>
          ${renderProbabilitySparkline(thesis, { height: 50 })}
        </div>
      </div>

      <div class="thesis-meta">
        <span class="thesis-meta-item">Horizon <strong>${horizonLabel}</strong></span>
        <span class="thesis-meta-item">Sector <strong>${sector || '—'}</strong></span>
        <span class="thesis-meta-item">Created <strong>${new Date(thesis.createdAt).toLocaleDateString()}</strong></span>
      </div>

      <!-- Manual prior slider (separate from component weights) -->
      <div style="display:flex;gap:10px;align-items:center;font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.12em">
        <span>Your Conviction</span>
        <input type="range" min="5" max="95" value="${(thesis.manualPrior * 100).toFixed(0)}"
               data-prior data-id="${thesis.id}" style="flex:1;accent-color:var(--amber)">
        <span style="color:var(--amber);font-weight:700">${(thesis.manualPrior * 100).toFixed(0)}%</span>
      </div>

      <div class="thesis-actions">
        <button class="thesis-action-btn" data-act="value" data-tic="${thesis.ticker}">Open in GP</button>
        <button class="thesis-action-btn" data-act="duplicate" data-id="${thesis.id}">Duplicate</button>
        <button class="thesis-action-btn" data-act="archive" data-id="${thesis.id}" title="Move to past theses — call it early as either YES or NO">Archive</button>
        <button class="thesis-action-btn danger" data-act="delete" data-id="${thesis.id}">Delete</button>
      </div>
    </div>
  `;
}

async function wireThesisCard(thesis) {
  const card = document.querySelector(`.thesis-card[data-id="${thesis.id}"]`);
  if (!card) return;

  // Component weight sliders — debounced re-render
  card.querySelectorAll('input[data-comp]').forEach(slider => {
    slider.addEventListener('input', e => {
      const compKey = e.target.dataset.comp;
      const newW = parseInt(e.target.value) / 100;
      // Update weight, normalize so all sum to 1
      const t = state.probability.theses.find(x => x.id === thesis.id);
      if (!t) return;
      t.weights[compKey] = newW;
      // Normalize
      const sum = Object.values(t.weights).reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (const k of Object.keys(t.weights)) t.weights[k] /= sum;
      }
      saveTheses(state.probability.theses);
      // Update only this card
      computeThesisProbability(t).then(result => {
        const newCard = document.createElement('div');
        newCard.innerHTML = renderThesisCard(t, result);
        card.replaceWith(newCard.firstElementChild);
        wireThesisCard(t);
      });
    });
  });

  // Manual prior slider
  const priorSlider = card.querySelector('input[data-prior]');
  if (priorSlider) {
    priorSlider.addEventListener('input', e => {
      const val = parseInt(e.target.value) / 100;
      const t = state.probability.theses.find(x => x.id === thesis.id);
      if (!t) return;
      t.manualPrior = val;
      saveTheses(state.probability.theses);
      computeThesisProbability(t).then(result => {
        const newCard = document.createElement('div');
        newCard.innerHTML = renderThesisCard(t, result);
        card.replaceWith(newCard.firstElementChild);
        wireThesisCard(t);
      });
    });
  }

  // Action buttons
  card.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async e => {
      const act = btn.dataset.act;
      if (act === 'delete') {
        if (!await appConfirm('Delete this thesis?')) return;
        state.probability.theses = state.probability.theses.filter(t => t.id !== thesis.id);
        _thesisTombstone(thesis.id);
        saveTheses(state.probability.theses);
        renderProbabilityTab();
      } else if (act === 'duplicate') {
        const copy = {
          ...thesis,
          id: 't' + Date.now(),
          createdAt: new Date().toISOString(),
          // Don't carry over snapshots — duplicate starts fresh
          snapshots: [],
          createdProb: null,
          createdPrice: null,
        };
        state.probability.theses.push(copy);
        saveTheses(state.probability.theses);
        renderProbabilityTab();
      } else if (act === 'archive') {
        // Manual archive — let the user call it early as YES or NO.
        // (Auto-archive on expiry is handled at render time and uses the
        // hit/miss check against snapshots.)
        const choice = await appPrompt(
          `Archive "${thesis.ticker} ${thesis.direction} $${thesis.strike}" as:\n\n` +
          `  yes  →  target was hit, resolves at 100%\n` +
          `  no   →  target NOT hit, resolves at 0%\n` +
          `  cancel  →  keep active\n\n` +
          `Type yes or no:`
        );
        if (!choice) return;
        const resolution = choice.trim().toLowerCase();
        if (resolution !== 'yes' && resolution !== 'no') {
          appAlert(`Invalid choice "${choice}" — must be yes or no. Thesis not archived.`);
          return;
        }
        thesis.status = 'archived';
        thesis.resolvedAt = new Date().toISOString();
        thesis.resolution = resolution;
        thesis.finalProb = resolution === 'yes' ? 1.0 : 0.0;
        if (!Array.isArray(thesis.snapshots)) thesis.snapshots = [];
        thesis.snapshots.push({
          t: thesis.resolvedAt,
          p: thesis.finalProb,
          price: null,
          resolved: true,
          manualResolution: true,
        });
        saveTheses(state.probability.theses);
        renderProbabilityTab();
      } else if (act === 'restore') {
        // Restore an archived thesis to active. Resets status + clears the
        // resolution snapshot we appended so the chart returns to normal.
        if (!await appConfirm(`Restore "${thesis.ticker}" to active theses?`)) return;
        thesis.status = 'active';
        thesis.resolvedAt = null;
        thesis.resolution = null;
        thesis.finalProb = null;
        if (Array.isArray(thesis.snapshots)) {
          thesis.snapshots = thesis.snapshots.filter(s => !s.resolved);
        }
        saveTheses(state.probability.theses);
        renderProbabilityTab();
      } else if (act === 'value') {
        document.getElementById('ticker').value = btn.dataset.tic;
        switchTab('valuation');
        loadValuation();
      }
    });
  });
}

function featureMomentum(history, currentPrice) {
  if (!history || history.length < 60) return null;
  const last = history[history.length - 1].price;
  // Look-back periods (trading days)
  const periods = [5, 20, 60, 120];
  const scores = [];
  for (const p of periods) {
    if (history.length < p + 1) continue;
    const past = history[history.length - 1 - p].price;
    if (past <= 0) continue;
    const ret = (last / past) - 1;
    // Convert return to a 0-1 score using sigmoid
    scores.push(1 / (1 + Math.exp(-10 * ret)));
  }
  if (scores.length === 0) return null;
  // Equal-weighted combo
  return scores.reduce((s, x) => s + x, 0) / scores.length;
}

function featureMeanReversion(history, currentPrice, strike, direction, daysAhead) {
  if (!history || history.length < 60) return null;
  const recent = history.slice(-60).map(h => h.price);
  const mean = recent.reduce((s, x) => s + x, 0) / recent.length;
  const variance = recent.reduce((s, x) => s + (x - mean) ** 2, 0) / recent.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  const z = (currentPrice - mean) / std;
  // Strong negative z (price oversold) → bullish signal for "above" theses
  // Strong positive z (overbought) → bearish signal for "above" theses
  // Use a calibrated tanh-based mapping
  const reversionScore = -Math.tanh(z / 2); // -1 to +1, +1 = bullish reversion
  // Convert to probability for the direction
  const p = 0.5 + 0.25 * reversionScore;
  return direction === 'above' ? p : 1 - p;
}

function featureTrendStrength(history) {
  if (!history || history.length < 30) return null;
  const recent = history.slice(-30);
  const n = recent.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  recent.forEach((h, i) => {
    sumX += i;
    sumY += h.price;
    sumXY += i * h.price;
    sumX2 += i * i;
    sumY2 += h.price * h.price;
  });
  const meanX = sumX / n;
  const meanY = sumY / n;
  const slope = (sumXY - n * meanX * meanY) / (sumX2 - n * meanX * meanX);
  const r2num = (sumXY - n * meanX * meanY) ** 2;
  const r2den = (sumX2 - n * meanX * meanX) * (sumY2 - n * meanY * meanY);
  if (r2den === 0) return null;
  const r2 = r2num / r2den;
  // Sign of slope tells direction; magnitude of r2 tells confidence
  return { slope, r2, slopePerDayPct: slope / meanY };
}

function featureVolRegime(history) {
  if (!history || history.length < 60) return null;
  const returns = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i - 1].price > 0) {
      returns.push(Math.log(history[i].price / history[i - 1].price));
    }
  }
  if (returns.length < 60) return null;
  const recent = returns.slice(-20);
  const long = returns.slice(-60);
  const stdRecent = Math.sqrt(recent.reduce((s, x) => s + x * x, 0) / recent.length);
  const stdLong = Math.sqrt(long.reduce((s, x) => s + x * x, 0) / long.length);
  if (stdLong === 0) return null;
  return stdRecent / stdLong;
}

async function probAIInference(thesis, sbRow) {
  const ticker = thesis.ticker.toUpperCase();
  const history = await getPriceHistory(ticker).catch(() => null);
  if (!history || history.length < 30) {
    return { p: null, error: 'Need 30+ days of price history for AI inference' };
  }

  const currentPrice = history[history.length - 1].price;
  const strike = thesis.strike;
  const direction = thesis.direction;
  const daysAhead = thesisRemainingDays(thesis);

  // === FEATURE EXTRACTION ===
  const features = {};

  // 1. Log-normal baseline (the original historical signal)
  const baseline = probHistorical(history, currentPrice, strike, direction, daysAhead);
  features.baseline = baseline?.p ?? 0.5;

  // 2. Momentum
  const momentum = featureMomentum(history, currentPrice);
  features.momentum = momentum;

  // 3. Mean reversion
  const reversion = featureMeanReversion(history, currentPrice, strike, direction, daysAhead);
  features.reversion = reversion;

  // 4. Trend strength
  const trend = featureTrendStrength(history);
  features.trendDirection = trend ? Math.tanh(trend.slopePerDayPct * 50) : 0; // -1 to +1
  features.trendConfidence = trend ? trend.r2 : 0; // 0 to 1

  // 5. Volatility regime
  const volRegime = featureVolRegime(history);
  features.volRegime = volRegime;

  // 6. Distance to strike (in %)
  const pctToStrike = (strike - currentPrice) / currentPrice;
  features.pctToStrike = pctToStrike;

  // 7. Fundamental: P/E percentile if available
  if (sbRow?.pe) {
    // Cheap P/E is bullish for "above" theses; expensive is bearish
    const peScore = 1 / (1 + Math.exp((sbRow.pe - 25) / 10)); // 0 (expensive) to 1 (cheap)
    features.fundamental = direction === 'above' ? peScore : 1 - peScore;
  }

  // === FEATURE COMBINATION via logistic regression ===
  // Weights are hand-tuned; in a real ML model these would be learned from data.
  // Each weight reflects the empirical importance of that feature.

  // Start with baseline log-odds
  const logit = (p) => Math.log(Math.max(0.001, Math.min(0.999, p)) / (1 - Math.max(0.001, Math.min(0.999, p))));
  const invLogit = (x) => 1 / (1 + Math.exp(-x));

  let score = logit(features.baseline);

  // Momentum adjustment — strong upmomentum boosts above-theses, dampens below
  if (features.momentum != null) {
    const momAdjust = (features.momentum - 0.5) * 1.5;
    score += direction === 'above' ? momAdjust : -momAdjust;
  }

  // Mean reversion adjustment — only weight if mean reversion strongly disagrees with momentum
  if (features.reversion != null) {
    score += (logit(features.reversion) - 0) * 0.5; // 50% weight
  }

  // Trend adjustment, weighted by R²
  if (features.trendDirection !== 0 && features.trendConfidence > 0.3) {
    const trendAdjust = features.trendDirection * features.trendConfidence * 1.0;
    score += direction === 'above' ? trendAdjust : -trendAdjust;
  }

  // Volatility regime: expanding vol increases uncertainty (pull toward 0.5)
  if (features.volRegime != null && features.volRegime > 1.3) {
    score *= 0.8; // shrink toward 0
  }

  // Fundamental adjustment
  if (features.fundamental != null) {
    score += (logit(features.fundamental) - 0) * 0.3; // small weight
  }

  // Calibration: sigmoid back to probability
  const p = invLogit(score);

  return {
    p,
    features,
    interpretation: interpretAIFeatures(features, direction),
  };
}

function interpretAIFeatures(f, direction) {
  const tags = [];
  if (f.momentum != null) {
    if (f.momentum > 0.7) tags.push(direction === 'above' ? 'strong momentum favors thesis' : 'strong momentum against thesis');
    else if (f.momentum < 0.3) tags.push(direction === 'above' ? 'weak momentum opposes thesis' : 'weak momentum supports thesis');
  }
  if (f.reversion != null) {
    if (Math.abs(f.reversion - 0.5) > 0.15) {
      tags.push(f.reversion > 0.5 ? 'oversold (mean reversion)' : 'overbought (mean reversion)');
    }
  }
  if (f.trendConfidence > 0.5) {
    tags.push(f.trendDirection > 0 ? 'strong uptrend' : 'strong downtrend');
  }
  if (f.volRegime != null) {
    if (f.volRegime > 1.5) tags.push('expanding volatility');
    else if (f.volRegime < 0.7) tags.push('contracting volatility');
  }
  if (f.fundamental != null && Math.abs(f.fundamental - 0.5) > 0.15) {
    tags.push(f.fundamental > 0.5 ? 'attractive valuation' : 'expensive valuation');
  }
  return tags.join(' · ') || 'mixed signals';
}
