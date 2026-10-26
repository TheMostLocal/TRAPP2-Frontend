/* ==========================================================================
   pages/portfolio.js — z160 (Phase 3). Moved verbatim from app.js; loaded the first time the page opens
   (app.js keeps a stub for renderStockBookPortfolio that loads this file, then calls the real function).
   Every function here is used only by this page (checked against app.js, every other script and index.html).
   ========================================================================== */
function exportGoodGlobeIndexAsTxt({ manualOnly = false } = {}) {
  const entries = getGoodGlobeIndexEntries();
  const filtered = manualOnly
    ? entries.filter(e => e.source === 'manual_import' || (e.flags || []).includes('Manual'))
    : entries;
  return filtered.map(e => e.ticker).join('\n');
}

function findPortfolioEntry(id) {
  return loadPortfolio().find(e => e.id === id) || null;
}

function _ledgerCheckBannerHtml() {
  const over = findLedgerOversells();
  const voided = loadAllTransactions().filter(t => t && t.void);
  if (!over.length && !voided.length) return '';
  const d = ts => { const x = ts ? new Date(ts) : null; return (x && isFinite(x)) ? x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; };
  const rows = over.map(o => {
    const t = o.tx, proceeds = (t.proceeds != null) ? +t.proceeds : (+t.qty || 0) * (+t.price || 0) - (+t.fee || 0);
    return `<div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-top:6px">
      <span><strong>${escapeHtml(o.ticker)}</strong> — SELL ${t.qty} on ${d(t.ts)} @ ${fmt$(+t.price || 0)}, but the ledger held ${o.heldBefore} (over by ${o.excess}).</span>
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:10px" onclick="if(confirm('Void this SELL and reverse ${fmt$(proceeds)} from cash? The row stays in the ledger, marked VOID.')){voidTransaction('${t.id}','oversell: sold ${o.excess} more than the ledger held');}">Void sale · reverse ${fmt$(proceeds)}</button>
    </div>`;
  }).join('');
  const vrows = voided.map(t => `<div style="margin-top:4px;color:var(--ink-faint)"><s>${escapeHtml((t.type || '').toUpperCase())} ${escapeHtml(t.ticker || '')} ${t.qty} @ ${fmt$(+t.price || 0)} · ${d(t.ts)}</s> — VOID ${d(t.voidedAt)} (${escapeHtml(t.voidReason || '')}${t.cashReversed ? ', cash ' + fmt$(t.cashReversed) : ''})</div>`).join('');
  return `<div style="padding:10px 14px;background:var(--bg-elev);font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);line-height:1.6;border-left:2px solid ${over.length ? 'var(--red)' : 'var(--ink-faint)'};margin-bottom:14px">
    <strong style="color:${over.length ? 'var(--red)' : 'var(--ink-dim)'}">LEDGER CHECK</strong>${over.length ? ` · ${over.length} sale${over.length > 1 ? 's exceed' : ' exceeds'} what the ledger held` : ''}${rows}${vrows ? `<div style="margin-top:8px">Voided rows (kept for audit, excluded from all totals):</div>${vrows}` : ''}
  </div>`;
}

function _cashReconHtml() {
  const r = cashReconciliation();
  const box = 'padding:10px 14px;background:var(--bg-elev);font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);line-height:1.7;margin-bottom:14px';
  const row = (k, v, extra = '') => `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><span>${k}</span><span style="${extra}">${v}</span></div>`;
  const signed = v => `${v >= 0 ? '+' : '−'}${fmt$(Math.abs(v))}`;
  const input = `<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap">
      <input id="cash-recon-opening" inputmode="decimal" placeholder="e.g. 100000" value="${r.opening != null ? r.opening : ''}" style="width:130px;background:var(--bg-card);border:1px solid var(--rule);color:var(--ink);font-family:var(--mono);font-size:11px;padding:4px 6px;border-radius:4px">
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:10px" onclick="setCashOpeningFromInput()">${r.opening != null ? 'Update' : 'Save'}</button></span>`;
  if (r.opening == null) {
    return `<div style="${box};border-left:2px solid var(--amber)">
      <strong style="color:var(--amber)">CASH RECONCILIATION</strong> · enter the cash you started with to check the balance against the ledger
      ${row('Opening capital (before the first transaction)', input)}
      ${row('Ledger cash flow', signed(r.flow))}
      ${row('Stored cash', fmt$(r.stored))}
      ${row('Opening implied by stored cash', fmt$(r.implied), 'color:var(--ink-faint)')}
    </div>`;
  }
  const ok = Math.abs(r.diff) < 0.005;
  return `<div style="${box};border-left:2px solid ${ok ? 'var(--pos)' : 'var(--red)'}">
    <strong style="color:${ok ? 'var(--pos)' : 'var(--red)'}">CASH RECONCILIATION</strong> · ${ok ? 'balanced' : 'stored cash does not match the ledger'}
    <div style="color:var(--ink-faint);font-size:9.5px">Ledger cash flow = every non-void buy, sell, short, option, deposit and withdrawal.</div>
    ${row('Opening capital', input)}
    ${row('+ Ledger cash flow', signed(r.flow))}
    ${row('= Expected cash', fmt$(r.expected), 'color:var(--ink)')}
    ${row('Stored cash', fmt$(r.stored))}
    ${row('Difference', signed(r.diff), ok ? '' : 'color:var(--red);font-weight:700')}
    ${r.adjusted ? row('Corrections already posted', signed(r.adjusted), 'color:var(--ink-faint)') : ''}
    ${ok ? '' : `<div style="margin-top:6px"><button class="btn" style="padding:5px 12px;font-size:10px" onclick="if(confirm('Set cash to ${fmt$(r.expected)} and record a ${signed(r.expected - r.stored)} ADJUSTMENT row?')){postCashCorrection();}">Post correction → ${fmt$(r.expected)}</button>
      <span style="color:var(--ink-faint);margin-left:8px">records an ADJUSTMENT row; nothing is deleted</span></div>`}
  </div>`;
}

function updatePortfolioEntry(id, patch) {
  const arr = loadPortfolio();
  const i = arr.findIndex(e => e.id === id);
  if (i < 0) return;
  arr[i] = { ...arr[i], ...patch };
  savePortfolio(arr);
}

function renderStockBookPortfolio(content) {
  const portfolio = loadPortfolio();
  const sbRows = state.stockbook?.rows || [];

  // Helper: parse changepct from sheet (1.21 → 0.0121)
  function parsePct(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s.toUpperCase().startsWith('#')) return null;
    const isNeg = /^\(/.test(s) || /^-/.test(s);
    const n = parseFloat(s.replace(/[%$,\s()+]/g, '').replace(/^-/, ''));
    if (!isFinite(n)) return null;
    return (isNeg ? -n : n) / 100;
  }

  // ============================================================
  //   POSITION MULTIPLIER — handles options contract multiplier
  //
  //   Options are quoted PER SHARE but each contract represents 100 shares.
  //   So a "100 calls at $0.35" position is worth 100 × $0.35 × 100 = $3,500,
  //   NOT $35. The same multiplier applies to P/L calculations.
  //
  //   Most equities/ETFs/crypto are 1× (no multiplier). Standard equity
  //   options are 100×. Futures vary by contract (S&P 500 e-mini is 50×,
  //   crude oil is 1000×, etc.) — for now we treat futures as 1× since
  //   the user's spec didn't include multiplier metadata. When/if they
  //   add it we can plumb it through positionMultiplier the same way.
  // ============================================================
  // positionMultiplier is now a top-level function (defined above
  // renderStockBookPortfolio) so the portfolio chart impl, which lives at
  // top level, can also call it. Calls here resolve via the scope chain.

  // Compute P/L for a single entry. Returns { plPct, plDollar } or {plPct: null, plDollar: null}
  // Uses ENTRY PRICE (costBasis) — NOT sheet's "P/L since" column.
  //
  // Math by asset class:
  //   • Equity Long:  P/L $ = (price - cost) × qty - fees
  //   • Equity Short: P/L $ = (cost - price) × qty - fees       (sign-flipped)
  //   • Option Long:  P/L $ = (price - cost) × qty × 100 - fees (100× contract multiplier)
  //   • Option Short: P/L $ = (cost - price) × qty × 100 - fees
  //
  //   For options without a current price (Yahoo didn't return one), we still
  //   show "—" for plPct — but the cost basis carries the correct ×100 in
  //   the aggregate so portfolio totals are right.
  function computePL(entry, currentPrice) {
    if (!entry.costBasis || !currentPrice || !isFinite(entry.costBasis) || !isFinite(currentPrice)) {
      return { plPct: null, plDollar: null };
    }
    const direction = entry.position === 'Short' ? -1 : 1;
    const multiplier = positionMultiplier(entry);
    // P/L % is per-unit (doesn't depend on multiplier — it's just price move)
    const plPct = direction * (currentPrice - entry.costBasis) / entry.costBasis;
    const qty = entry.qty || 0;
    const fees = parseFloat(entry.fees) || 0;
    const isActive = ACTIVE_POSITIONS.includes(entry.position);
    // P/L $ — multiplier baked in for options
    const plDollar = (isActive && qty > 0)
      ? direction * (currentPrice - entry.costBasis) * qty * multiplier - fees
      : null;
    return { plPct, plDollar };
  }

  // Join portfolio entries with live stockbook data
  const enriched = portfolio.map(entry => {
    const sbRow = sbRows.find(r => r.ticker === entry.ticker);
    const livePrice = sbRow?.price ?? sbRow?.fmpPrice ?? null;
    const { plPct, plDollar } = computePL(entry, livePrice);
    return { ...entry, sbRow, livePrice, plPct, plDollar };
  });

  // Aggregate stats — only across ACTIVE positions.
  // Long and Short are tracked separately so we can surface the short LIABILITY
  // and compute true Net Equity (the most-asked Q after seeing the +$14,515
  // ghost cash inflow from a short opening). Net equity below = what it'd
  // cost to flatten everything.
  let totalCost = 0, totalValue = 0, totalPL = 0, totalFees = 0;
  let totalShortLiability = 0;   // current MV of open shorts — what it'd cost to cover
  let totalShortProceeds = 0;    // original cash credited when shorts were opened
  let activeCount = 0, watchingCount = 0, trackingCount = 0, avoidCount = 0;
  enriched.forEach(e => {
    if (ACTIVE_POSITIONS.includes(e.position)) {
      activeCount++;
      const fees = parseFloat(e.fees) || 0;
      totalFees += fees;
      if (e.qty && e.costBasis) {
        // Options contract multiplier (100×) baked into both cost basis and
        // market value so the dollar totals are sized correctly. A 100-call
        // position at $0.35 premium is $3,500 of cost basis, not $35.
        const mult = positionMultiplier(e);
        const cost = e.qty * e.costBasis * mult;
        const direction = e.position === 'Short' ? -1 : 1;
        const value = e.qty * (e.livePrice || e.costBasis) * mult;
        const positionPL = direction * (value - cost) - fees;
        totalCost += cost;
        totalValue += value;
        totalPL += positionPL;
        if (e.position === 'Short') {
          totalShortLiability += value;
          totalShortProceeds  += cost;
        }
      }
    }
    if (e.position === 'Watching') watchingCount++;
    if (e.position === 'Tracking') trackingCount++;
    if (e.position === 'Avoid')    avoidCount++;
  });
  const totalPLPct = totalCost > 0 ? totalPL / totalCost : null;

  // Use the global fmt$ which adds commas under $1M and compact notation above.
  // Local fmtPct keeps direction prefix (used for P/L percentages).
  const fmtPct = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
  const fmtMcap = v => !v ? '—' : fmt$(v);

  // ── PORTFOLIO PERFORMANCE CHART ──
  // Shows price evolution from entry date for each position.
  // - Active w/ qty: portfolio value (qty × price), shorts inverted
  // - Active w/o qty: equally-weighted index from entry date
  // - Watching/Tracking: price-only, normalized to 100 at entry
  // Always renders when at least 1 position with a ticker that has history exists.
  // Portfolio chart — shows total portfolio value over time across active positions.
  // Hidden on Watching/Tracking/Transactions tabs since those don't have positions to chart.
  const showChart = enriched.length > 0
    && ['all', 'trading'].includes(state.portfolioSubTab || 'all')
    && enriched.some(e => ACTIVE_POSITIONS.includes(e.position));
  const chartHtml = showChart
    ? `<section class="portfolio-chart-section">
        <div class="portfolio-chart-head">
          <div class="portfolio-chart-title">Position Performance</div>
          <div class="portfolio-range" id="portfolio-range">
            ${['1W', '1M', '3M', '6M', '1Y', '3Y', 'ALL'].map(r =>
              `<button class="portfolio-range-btn ${r === '3M' ? 'active' : ''}" data-range="${r}">${r}</button>`
            ).join('')}
          </div>
        </div>
        <svg id="portfolio-chart-svg" viewBox="0 0 1100 280" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block"></svg>
        <div id="portfolio-chart-legend" style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:8px;display:flex;gap:14px;flex-wrap:wrap"></div>
      </section>`
    : '';

  // ── REGIME ALIGNMENT ──
  // Compute how aligned the active portfolio is with the current market regime.
  // For each active position, score its sector against the regime's signal profile.
  const regime = state.marketRegime;
  let regimeCardHtml = '';
  if (regime && activeCount > 0) {
    const info = REGIME_LABELS[regime.regime] || REGIME_LABELS.neutral;
    const bias = REGIME_SECTOR_BIAS[regime.regime] || REGIME_SECTOR_BIAS.neutral;
    let alignedValue = 0, misalignedValue = 0, totalActiveValue = 0;
    const sectorBreakdown = {};
    enriched.forEach(e => {
      if (!ACTIVE_POSITIONS.includes(e.position) || !e.qty || !e.costBasis) return;
      const sector = e.sbRow?.sector || 'Unknown';
      // Multiplier so option positions don't under-weight in the alignment calc
      const value = e.qty * (e.livePrice || e.costBasis) * positionMultiplier(e);
      totalActiveValue += value;
      sectorBreakdown[sector] = (sectorBreakdown[sector] || 0) + value;
      if (bias.favor.includes(sector)) alignedValue += value;
      else if (bias.disfavor.includes(sector)) misalignedValue += value;
    });
    const alignedPct = totalActiveValue > 0 ? alignedValue / totalActiveValue : 0;
    const misalignedPct = totalActiveValue > 0 ? misalignedValue / totalActiveValue : 0;
    const neutralPct = 1 - alignedPct - misalignedPct;
    // Color: aligned-dominant = green, misaligned-dominant = red, else amber
    const cardColor = alignedPct > misalignedPct + 0.15 ? 'var(--pos)'
                    : misalignedPct > alignedPct + 0.15 ? 'var(--neg)'
                    : 'var(--amber)';
    const verdict = alignedPct > misalignedPct + 0.15 ? 'Aligned'
                  : misalignedPct > alignedPct + 0.15 ? 'Vulnerable'
                  : 'Mixed';
    regimeCardHtml = `
      <div class="portfolio-stat" style="border-left:3px solid ${info.color}">
        <div class="portfolio-stat-label">Regime Alignment</div>
        <div class="portfolio-stat-value" style="font-size:18px;color:${cardColor}">${verdict}</div>
        <div class="portfolio-stat-sub" style="line-height:1.5">
          vs <span style="color:${info.color}">${info.label}</span><br>
          ${(alignedPct * 100).toFixed(0)}% favored · ${(misalignedPct * 100).toFixed(0)}% disfavored
        </div>
      </div>
    `;
  }

  const cashPosition = getCashPosition();
  const summary = `
    <div class="portfolio-summary">
      <div class="portfolio-stat">
        <div class="portfolio-stat-label">Positions</div>
        <div class="portfolio-stat-value">${portfolio.length}</div>
        <div class="portfolio-stat-sub">${activeCount} active · ${watchingCount} watching · ${trackingCount} tracking</div>
      </div>
      ${activeCount > 0 ? `
      <div class="portfolio-stat">
        <div class="portfolio-stat-label">Cost Basis</div>
        <div class="portfolio-stat-value">${fmt$(totalCost)}</div>
        <div class="portfolio-stat-sub">across ${activeCount} active</div>
      </div>
      <div class="portfolio-stat">
        <div class="portfolio-stat-label">Market Value</div>
        <div class="portfolio-stat-value">${fmt$(totalValue)}</div>
        <div class="portfolio-stat-sub">active positions only</div>
      </div>
      <div class="portfolio-stat">
        <div class="portfolio-stat-label">Unrealized P/L</div>
        <div class="portfolio-stat-value" style="color:${totalPL >= 0 ? 'var(--pos)' : 'var(--neg)'}">${totalPL >= 0 ? '+' : ''}${fmt$(totalPL)}</div>
        <div class="portfolio-stat-sub" style="color:${totalPL >= 0 ? 'var(--pos)' : 'var(--neg)'}">${totalPLPct != null ? (totalPLPct >= 0 ? '+' : '') + (totalPLPct * 100).toFixed(2) + '%' : ''}${totalFees > 0 ? ` · net of ${fmt$(totalFees)} fees` : ''}</div>
      </div>
      ` : ''}
      <div class="portfolio-stat" style="border-left:3px solid var(--amber)">
        <div class="portfolio-stat-label">Cash Position</div>
        <div class="portfolio-stat-value" style="color:var(--amber)">${fmt$(cashPosition)}</div>
        <div class="portfolio-stat-sub">${totalShortProceeds > 0 ? `incl. ${fmt$(totalShortProceeds)} short proceeds <span style="color:#a85a3a">(collateral · not free cash)</span>` : 'net of all transactions'}</div>
      </div>
      ${totalShortLiability > 0 ? `
      <div class="portfolio-stat" style="border-left:3px solid #a85a3a" title="Current market value of all open short positions — what it would cost to buy back and close them now">
        <div class="portfolio-stat-label">Short Liability</div>
        <div class="portfolio-stat-value" style="color:#a85a3a">−${fmt$(totalShortLiability)}</div>
        <div class="portfolio-stat-sub">cost to cover open shorts</div>
      </div>
      <div class="portfolio-stat" style="border-left:3px solid var(--pos)" title="Cash + long positions market value − short liability. This is what your portfolio is actually worth right now.">
        <div class="portfolio-stat-label">Net Equity</div>
        <div class="portfolio-stat-value" style="color:var(--pos)">${fmt$(cashPosition + (totalValue - totalShortLiability) - totalShortLiability)}</div>
        <div class="portfolio-stat-sub">cash + long MV − short liability</div>
      </div>
      ` : ''}
      ${regimeCardHtml}
    </div>
  `;

  // ── PORTFOLIO SUB-TABS ──
  // Asset class counts — derived from ticker pattern (crypto/future/fx/etc.)
  const classCounts = { crypto: 0, future: 0, fx: 0, etf: 0, index: 0, mutual: 0, equity: 0 };
  enriched.forEach(e => {
    const c = classifyAsset(e.ticker);
    classCounts[c] = (classCounts[c] || 0) + 1;
  });
  // Build asset-class subtab buttons (only show classes with positions)
  const classTabs = [
    { key: 'crypto',    label: 'Crypto'      },
    { key: 'future',    label: 'Futures'     },
    { key: 'fx',        label: 'FX'          },
    { key: 'etf',       label: 'ETFs'        },
    { key: 'index',     label: 'Indexes'     },
    { key: 'mutual',    label: 'Mutual Fund' },
    { key: 'equity',    label: 'Equity'      },
  ];
  const classTabsHtml = classTabs
    .filter(c => classCounts[c.key] > 0)
    .map(c => `<button class="portfolio-subtab ${state.portfolioSubTab === 'class:' + c.key ? 'active' : ''}" data-sub="class:${c.key}">${c.label} <span class="count">${classCounts[c.key]}</span></button>`)
    .join('');

  // All / Trading / Watching / Tracking + per-asset-class tabs
  const txCount = loadTransactions().length;
  const subTabs = `
    <div class="portfolio-subtabs">
      <button class="portfolio-subtab ${state.portfolioSubTab === 'all' ? 'active' : ''}" data-sub="all">All <span class="count">${portfolio.length}</span></button>
      <button class="portfolio-subtab ${state.portfolioSubTab === 'trading' ? 'active' : ''}" data-sub="trading">Trading <span class="count">${enriched.filter(e => ACTIVE_POSITIONS.includes(e.position)).length}</span></button>
      <button class="portfolio-subtab ${state.portfolioSubTab === 'watching' ? 'active' : ''}" data-sub="watching">Watching <span class="count">${watchingCount}</span></button>
      <button class="portfolio-subtab ${state.portfolioSubTab === 'tracking' ? 'active' : ''}" data-sub="tracking">Tracking <span class="count">${trackingCount}</span></button>
      <button class="portfolio-subtab ${state.portfolioSubTab === 'avoid' ? 'active' : ''}" data-sub="avoid" title="Tickers explicitly excluded — kept visible so the choice is auditable">Avoid <span class="count">${avoidCount}</span></button>
      <button class="portfolio-subtab ${state.portfolioSubTab === 'transactions' ? 'active' : ''}" data-sub="transactions">Transactions <span class="count">${txCount}</span></button>
      <button class="portfolio-subtab ${state.portfolioSubTab === 'goodglobe' ? 'active' : ''}" data-sub="goodglobe" title="Master roster of every ticker you've flagged — exportable to a .txt for GitHub pipeline ingestion">GoodGlobe Index <span class="count">${(typeof getGoodGlobeIndexEntries === 'function' ? getGoodGlobeIndexEntries().length : 0)}</span></button>
      ${classTabsHtml ? `<span class="portfolio-subtab-divider"></span>${classTabsHtml}` : ''}
    </div>
  `;

  const toolbar = `
    <div class="portfolio-toolbar">
      <button class="btn portfolio-add-pill" id="portfolio-add-btn" title="Add equity, option, future, FX/crypto, or bulk-import"><span class="add-pill-icon">+</span> ADD</button>
      <button class="btn btn-ghost" id="portfolio-load-repo" title="Pull the latest portfolio_data.json from the TRAPP2-PORT repo and merge it in (no duplicates). Restores positions + transactions + GoodGlobe index on any device.">⤓ Load from Repo</button>
      <button class="btn btn-ghost" id="portfolio-save-repo" title="Save the portfolio straight to TRAPP2-PORT on GitHub (needs a GitHub token via Connect GitHub — otherwise copies JSON + opens the editor). No manual download needed.">↑ Save to Repo</button>
      <button class="btn btn-ghost" id="portfolio-import-watch" title="Add positions from sheet status">Import from Sheet Status</button>
      <button class="btn btn-ghost" id="portfolio-export" title="Download as JSON">Export</button>
    </div>
  `;

  if (portfolio.length === 0) {
    content.innerHTML = summary + toolbar + `
      <div class="empty" style="text-align:center;padding:60px 20px;font-family:var(--mono);font-size:13px;line-height:1.7">
        <div style="color:var(--ink);font-family:var(--serif);font-style:italic;font-size:24px;margin-bottom:14px">Empty Portfolio</div>
        <div style="color:var(--ink-dim);max-width:520px;margin:0 auto">
          Track positions you own, are watching, or are considering.<br>
          Click <strong style="color:var(--amber)">+ Add Position</strong> to start, or pull from your sheet's Status column.
        </div>
      </div>
    `;
    wirePortfolioToolbar();
    return;
  }

  // Filter rows by sub-tab
  let filtered = enriched;
  if (state.portfolioSubTab === 'trading') filtered = enriched.filter(e => ACTIVE_POSITIONS.includes(e.position));
  else if (state.portfolioSubTab === 'watching') filtered = enriched.filter(e => e.position === 'Watching');
  else if (state.portfolioSubTab === 'tracking') filtered = enriched.filter(e => e.position === 'Tracking');
  else if (state.portfolioSubTab === 'avoid')    filtered = enriched.filter(e => e.position === 'Avoid');
  else if (state.portfolioSubTab === 'goodglobe') {
    // Special-case: render the GoodGlobe Index master roster instead of positions
    return renderGoodGlobeIndexView(content, summary, subTabs);
  }
  else if (state.portfolioSubTab === 'transactions') {
    // Special-case: render the immutable transactions ledger instead of positions
    return renderTransactionsLedger(content, summary, subTabs);
  }
  else if (state.portfolioSubTab?.startsWith?.('class:')) {
    const cls = state.portfolioSubTab.slice(6);
    filtered = enriched.filter(e => classifyAsset(e.ticker) === cls);
  }

  // Sort: Sold positions sink to the bottom of every list (per user spec).
  // Other rows preserve their natural order (legacy add order).
  filtered.sort((a, b) => {
    const aSold = a.position === 'Sold' ? 1 : 0;
    const bSold = b.position === 'Sold' ? 1 : 0;
    return aSold - bSold;
  });

  const positionColor = pos => {
    if (pos === 'Trading' || pos === 'Long') return 'var(--pos)';
    if (pos === 'Short') return '#a85a3a';
    if (pos === 'Watching') return 'var(--data-amber)';
    if (pos === 'Tracking') return '#7faaca';
    if (pos === 'Sold') return 'var(--ink-faint)';
    if (pos === 'Avoid') return 'var(--neg)';
    return 'var(--ink)';
  };

  const rowsHtml = filtered.map(e => {
    const r = e.sbRow;
    const todayPct = r?.rawRow ? parsePct(r.rawRow['changepct']) : null;
    const noteCount = (e.notes || []).length;
    const lastNote = noteCount > 0 ? e.notes[e.notes.length - 1] : null;
    const isActive = ACTIVE_POSITIONS.includes(e.position);
    const isPassive = e.position === 'Watching' || e.position === 'Tracking';
    const entryDateDisplay = e.addedAt ? new Date(e.addedAt).toISOString().slice(0, 10) : '—';
    // Market value of this position at current price.
    // For options: qty × price × 100 (contract multiplier). Equity stays 1×.
    const mktValue = (isActive && e.qty && e.livePrice)
      ? e.qty * e.livePrice * positionMultiplier(e)
      : null;
    // For watching/tracking: show today's % change (no $ value since no qty)
    return `
      <tr data-id="${e.id}" data-tic="${e.ticker}" data-pos="${e.position || ''}">
        <td class="sb-tic">${e.ticker}</td>
        <td>${r?.name || e.ticker}</td>
        <td>
          <select class="portfolio-position" data-id="${e.id}" style="color:${positionColor(e.position)};font-weight:600">
            ${(() => {
              // Active rows (Trading/Long/Short) can only transition to Sold (via sell modal).
              // Passive rows (Watching/Tracking/Avoid) can switch among the passive set + go to Trading.
              // Sold rows are terminal — no transitions out.
              let allowed;
              if (e.position === 'Trading' || e.position === 'Long' || e.position === 'Short') {
                allowed = [e.position, 'Sold'];
              } else if (e.position === 'Sold') {
                allowed = ['Sold'];
              } else {
                allowed = ['Watching', 'Tracking', 'Avoid', 'Trading'];
              }
              return allowed.map(p => `<option value="${p}" ${e.position === p ? 'selected' : ''}>${p}</option>`).join('');
            })()}
          </select>
        </td>
        <td>${r?.sector || '—'}</td>
        <td>${fmtMcap(r?.marketCap)}</td>
        <td style="font-family:var(--mono);font-size:11px">${mktValue != null ? fmt$(mktValue) : (isPassive ? '—' : '—')}</td>
        <td>${e.livePrice != null ? fmt$(e.livePrice) : '—'}</td>
        <td style="font-family:var(--mono);font-size:11px">${isPassive ? `<span style="color:${todayPct > 0 ? 'var(--pos)' : todayPct < 0 ? 'var(--neg)' : 'var(--ink-dim)'}">${fmtPct(todayPct)}</span>` : (e.qty != null ? e.qty : '—')}</td>
        <td style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);white-space:nowrap" title="${e.addedAt || ''}">${entryDateDisplay}</td>
        <td style="font-family:var(--mono);font-size:11px">${e.costBasis != null && isActive ? fmt$(e.costBasis) : '—'}</td>
        <td style="color:${e.plPct == null ? 'var(--ink-faint)' : e.plPct > 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:${e.plPct != null ? '600' : '400'}">${fmtPct(e.plPct)}</td>
        <td style="color:${e.plDollar == null ? 'var(--ink-faint)' : e.plDollar > 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:${e.plDollar != null ? '600' : '400'}">${e.plDollar == null ? '—' : (e.plDollar >= 0 ? '+' : '') + fmt$(e.plDollar)}</td>
        <td>
          <button class="sb-icon-btn portfolio-notes-btn" data-id="${e.id}" title="${noteCount === 0 ? 'No notes' : `${noteCount} note${noteCount === 1 ? '' : 's'}\nLast: ${lastNote ? lastNote.text.slice(0, 100) : ''}`}">
            ${noteCount === 0 ? '+ Note' : `📝 ${noteCount}`}
          </button>
        </td>
        <td class="sb-action-cell">
          <button class="sb-icon-btn" data-portfolio-act="value" data-tic="${e.ticker}">Value</button>
          <button class="sb-icon-btn" data-portfolio-act="edit" data-id="${e.id}" title="Edit fees and quantity">Edit</button>
          <button class="sb-icon-btn danger" data-portfolio-act="remove" data-id="${e.id}">×</button>
        </td>
      </tr>
    `;
  }).join('');

  // Ray Dalio All Weather comparison — shown on the funded-portfolio views.
  const awPanelHtml = (['all', 'trading'].includes(state.portfolioSubTab || 'all') && typeof renderAllWeatherPanel === 'function')
    ? renderAllWeatherPanel() : '';

  // z97: account value (cash + positions) from the ledger + real closes (charts.js)
  const acctHtml = (['all', 'trading'].includes(state.portfolioSubTab || 'all') && typeof window !== 'undefined' && window.VChart && window.VChart.mountAccountChart)
    ? `<section class="portfolio-chart-section"><div class="portfolio-chart-head"><div class="portfolio-chart-title">Account Value · cash + positions</div></div><div id="acct-value-mount"></div></section>` : '';
  // z111: ONE portfolio chart. The Account Value chart (cash + holdings from the
  // ledger, flows marked) replaces the older Position Performance chart, which
  // stays only as the fallback when charts.js isn't loaded.
  content.innerHTML = summary + acctHtml + (acctHtml ? '' : chartHtml) + subTabs + awPanelHtml + toolbar + `
    <div class="sb-table-wrap">
      <table class="sb-table portfolio-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Name</th>
            <th>Position</th>
            <th>Sector</th>
            <th>Mkt Cap</th>
            <th>Mkt Value</th>
            <th>Price</th>
            <th>${(['watching','tracking'].includes(state.portfolioSubTab)) ? 'Today' : 'Qty'}</th>
            <th>Entry Date</th>
            <th>Entry Price</th>
            <th>P/L %</th>
            <th>P/L $</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="14" style="text-align:center;padding:30px;color:var(--ink-faint);font-style:italic">No positions in this category</td></tr>'}</tbody>
      </table>
    </div>
  `;

  // Wire sub-tabs
  document.querySelectorAll('.portfolio-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.portfolioSubTab = btn.dataset.sub;
      renderStockBookPortfolio(content);
    });
  });

  // Wire range buttons + render the chart
  if (acctHtml) { try { window.VChart.mountAccountChart(); } catch (e) { console.warn('[acct-chart]', e); } }
  if (chartHtml && !acctHtml) {
    document.querySelectorAll('.portfolio-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.portfolio-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderPortfolioChart(enriched, btn.dataset.range);
      });
    });
    // Single paint. renderPortfolioChart handles its own history priming
    // internally (full fallback chain: sheet → cache → GitHub → Twelve → FMP →
    // Stooq) and re-renders itself when data arrives. No separate prime call
    // here — the old GitHub-only primeHistoryForTickers path was removed
    // because it silently no-op'd when the GitHub manifest wasn't configured.
    renderPortfolioChart(enriched, '3M');
  }

  wirePortfolioToolbar();
  wirePortfolioRowEvents();
}

function renderPortfolioChart(enriched, range) {
  // Surface any exception inside the SVG instead of leaving a blank box.
  // The user reported a completely blank chart with no diagnostic text, which
  // means something was throwing mid-render and being swallowed. Now any error
  // is visible right in the chart area so we can see what's wrong.
  try {
    return _renderPortfolioChartImpl(enriched, range);
  } catch (e) {
    console.error('[portfolio-chart] render threw:', e);
    const svg = document.getElementById('portfolio-chart-svg');
    if (svg) {
      svg.innerHTML = `<text x="50%" y="45%" text-anchor="middle" fill="var(--neg)" font-family="var(--mono)" font-size="11">Chart error: ${escapeHtml(String(e.message || e))}</text>` +
        `<text x="50%" y="58%" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)" font-size="9">see console (Ctrl+Shift+I) for details</text>`;
    }
    renderPortfolioChart._priming = false;  // unlock so a retry can happen
  }
}

function _renderPortfolioChartImpl(enriched, range) {
  const svg = document.getElementById('portfolio-chart-svg');
  const legend = document.getElementById('portfolio-chart-legend');
  if (!svg) return;

  const dayMap = { '1W': 7, '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 1095 };
  const days = dayMap[range] || null; // null = ALL (from earliest entry date)

  // Helper: get history via unified accessor (sheet → cache → in-memory GitHub manifest)
  function getHist(t) {
    return getHistoryForTicker(t);
  }

  // ===== Proactive history priming =====
  // BEFORE filtering candidates, check if any active position with a cost
  // basis is missing history. If so, prime it via the full getPriceHistory
  // fallback chain and re-render. This runs even when SOME positions already
  // have history — previously the chart would render with partial data and
  // silently drop positions whose history wasn't cached yet (the MSFT-missing,
  // MOH-present case the user hit). Valuation works because it calls the async
  // getPriceHistory directly; this brings the portfolio chart to parity.
  {
    const activeWithCost = enriched.filter(e =>
      e.position !== 'Sold' && e.position !== 'Avoid' &&
      ACTIVE_POSITIONS.includes(e.position) && e.costBasis
    );
    const missingHist = activeWithCost.filter(e => !getHist(e.ticker)).map(e => e.ticker);
    if (missingHist.length > 0 && !renderPortfolioChart._priming) {
      renderPortfolioChart._priming = true;
      console.log(`[portfolio-chart] priming history for ${missingHist.length} position(s): ${missingHist.join(', ')}`);
      (async () => {
        let loadedAny = false;
        for (const t of missingHist) {
          try {
            let h = await getPriceHistory(t).catch(() => null);
            // z98: fall back to the books' own daily history files (same source as
            // the Account Value chart) - "Not enough data points" came from holdings
            // whose live-API history fetch failed.
            if ((!h || h.length < 2) && window.VChart && window.VChart.fetchDaily) {
              const d = await window.VChart.fetchDaily(t).catch(() => null);
              if (d && d.length >= 2) h = d.map(b => ({ date: b.d, close: b.c, price: b.c }));
            }
            if (h && h.length >= 2) {
              const cache = loadPriceHistCache();
              cache[t] = { t: Date.now(), data: h };
              savePriceHistCache(cache);
              loadedAny = true;
              console.log(`[portfolio-chart] loaded ${h.length} points for ${t}`);
            } else {
              console.warn(`[portfolio-chart] no history available for ${t} from any source`);
            }
          } catch (e) { console.warn(`[portfolio-chart] prime failed for ${t}:`, e.message); }
        }
        renderPortfolioChart._priming = false;
        if (loadedAny) {
          const stillActive = document.getElementById('portfolio-chart-svg');
          if (stillActive) renderPortfolioChart(enriched, range);
        }
      })();
    }
  }

  // ===== Active candidates =====
  // Filter to currently-charteable positions (have ticker history + entry data).
  // 'Sold' is excluded here — sold positions come in via the transactions
  // ledger below, which preserves their historical contribution.
  const candidates = enriched.filter(e =>
    e.position !== 'Sold' && e.position !== 'Avoid' &&
    e.costBasis && getHist(e.ticker)
  );

  // Diagnostic: log what the chart sees so a blank chart is debuggable.
  console.log(`[portfolio-chart] range=${range} · enriched=${enriched.length} · candidates=${candidates.length}`,
    candidates.map(c => ({ t: c.ticker, pos: c.position, qty: c.qty, cost: c.costBasis, histPts: getHist(c.ticker)?.length })));

  // ===== Historical positions from the transactions ledger =====
  // Every sell transaction represents a position that LIVED between entryDate
  // and soldDate with a known quantity. We resurrect that lifetime for the
  // chart so the user sees their portfolio's actual history, not just current
  // holdings. After the sell date, the position converts to cash and is no
  // longer chart contribution (cash itself is added separately below).
  const txLedger = (typeof loadTransactions === 'function' ? loadTransactions() : []) || [];
  const soldHistoricals = txLedger
    .filter(tx => tx.type === 'sell' && tx.ticker && tx.qty && tx.entryPrice && tx.entryDate && tx.soldDate)
    .map(tx => {
      const hist = getHist(tx.ticker);
      if (!hist || hist.length === 0) return null;
      // The position lived from entryDate to soldDate. We need history points
      // bracketed by that window so the chart shows the actual price path.
      return {
        ticker: tx.ticker,
        qty: tx.qty,
        cost: tx.entryPrice,
        direction: 1,           // current implementation only logs long sells
        isActive: false,
        position: 'Sold',
        fees: parseFloat(tx.fee) || 0,
        addedAt: tx.entryDate,
        soldAt:  tx.soldDate,
        sellPrice: tx.price,
        sbRow: null,
        _historical: true,
      };
    }).filter(Boolean);

  if (candidates.length === 0 && soldHistoricals.length === 0) {
    // Diagnose WHY there's nothing to chart so the user isn't staring at a blank box.
    const enrichedActive = enriched.filter(e => e.position !== 'Sold' && e.position !== 'Avoid' && ACTIVE_POSITIONS.includes(e.position));
    const withCost = enrichedActive.filter(e => e.costBasis);
    const withHist = enrichedActive.filter(e => getHist(e.ticker));
    let msg;
    if (enrichedActive.length === 0) {
      msg = 'No active positions (Trading/Long/Short) to chart. Watching/Tracking/Avoid are excluded.';
    } else if (withCost.length === 0) {
      msg = `${enrichedActive.length} active position(s) but none have an entry/cost basis recorded.`;
    } else if (withHist.length === 0) {
      msg = `${withCost.length} position(s) with cost basis — loading price history…`;
    } else {
      msg = 'No positions with entry price + history yet';
    }
    svg.innerHTML = `<text x="50%" y="42%" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)" font-size="11">${escapeHtml(msg)}</text>` +
      (withCost.length > 0 && withHist.length === 0
        ? `<text x="50%" y="56%" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)" font-size="9">trying GitHub, then Stooq / Twelve Data / FMP…</text>`
        : '');
    if (legend) legend.innerHTML = '';
    // Prime history using the FULL fallback chain (getPriceHistory tries
    // sheet → cache → GitHub → Twelve Data → FMP → Stooq). This is more robust
    // than the GitHub-only primeHistoryForTickers — it loads MSFT etc. even
    // when the GitHub manifest isn't configured, and handles FX/index tickers
    // that GitHub doesn't generate files for. Guard against infinite re-render
    // with a per-render flag.
    if (withCost.length > 0 && withHist.length === 0 && !renderPortfolioChart._priming) {
      renderPortfolioChart._priming = true;
      const need = withCost.map(e => e.ticker);
      (async () => {
        let loadedAny = false;
        for (const t of need) {
          try {
            let h = await getPriceHistory(t).catch(() => null);
            // z98: fall back to the books' own daily history files (same source as
            // the Account Value chart) - "Not enough data points" came from holdings
            // whose live-API history fetch failed.
            if ((!h || h.length < 2) && window.VChart && window.VChart.fetchDaily) {
              const d = await window.VChart.fetchDaily(t).catch(() => null);
              if (d && d.length >= 2) h = d.map(b => ({ date: b.d, close: b.c, price: b.c }));
            }
            if (h && h.length >= 2) {
              // Persist into the price-hist cache so getHist() (sync) finds it next render
              const cache = loadPriceHistCache();
              cache[t] = { t: Date.now(), data: h };
              savePriceHistCache(cache);
              loadedAny = true;
            }
          } catch {}
        }
        renderPortfolioChart._priming = false;
        if (loadedAny) {
          const stillActive = document.getElementById('portfolio-chart-svg');
          if (stillActive) renderPortfolioChart(enriched, range);
        }
      })();
    }
    return;
  }

  // Find latest available date across all positions (active + historical)
  let latestDate = null;
  const allTickersInPlay = new Set([...candidates.map(e => e.ticker), ...soldHistoricals.map(h => h.ticker)]);
  for (const t of allTickersInPlay) {
    const h = getHist(t);
    if (!h?.length) continue;
    const last = h[h.length - 1].date;
    if (!latestDate || last > latestDate) latestDate = last;
  }
  if (!latestDate) {
    svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)" font-size="11">No history available</text>`;
    if (legend) legend.innerHTML = '';
    return;
  }
  const latestTime = new Date(latestDate + 'T00:00:00Z').getTime();

  // Build aggregate portfolio value series.
  const hasAnyQty = candidates.some(e => ACTIVE_POSITIONS.includes(e.position) && e.qty);

  // Per-position: build a windowed series. Active positions follow current
  // price; historical (sold) positions only have a window from entryDate to
  // soldDate, after which they contribute zero (replaced by cash).
  const buildContribution = (e, isHistorical) => {
    const hist = getHist(e.ticker);
    if (!hist || hist.length === 0) return null;
    const direction = e.position === 'Short' ? -1 : (e.direction || 1);
    const isActive = !isHistorical && ACTIVE_POSITIONS.includes(e.position);
    const qty = isHistorical
      ? e.qty
      : (isActive && e.qty ? e.qty : (hasAnyQty ? 0 : 1));
    if (qty === 0) return null;

    const entryTime = e.addedAt ? new Date(e.addedAt).getTime() : 0;
    const soldTime  = e.soldAt  ? new Date(e.soldAt).getTime()  : null;
    let startTime, endTime;
    if (range === 'ALL') {
      startTime = entryTime || new Date(hist[0].date + 'T00:00:00Z').getTime();
    } else {
      const cutoff = latestTime - days * 86400000;
      startTime = Math.max(cutoff, entryTime);
    }
    endTime = soldTime || Date.now();
    if (startTime > endTime) return null;

    const startIso = new Date(startTime).toISOString().slice(0, 10);
    const endIso   = new Date(endTime).toISOString().slice(0, 10);
    let windowed = hist.filter(p => p.date >= startIso && p.date <= endIso);

    // For historical positions, ensure the sell-date price point is captured
    // so the equity curve closes cleanly at sale.
    if (isHistorical && e.sellPrice && e.soldAt) {
      const sellIso = e.soldAt.slice(0, 10);
      if (!windowed.find(p => p.date === sellIso)) {
        windowed.push({ date: sellIso, price: e.sellPrice });
        windowed.sort((a, b) => a.date.localeCompare(b.date));
      }
    }

    // Synthesize entry point if window is too sparse (intraday adds)
    if (windowed.length < 2 && e.cost && e.addedAt) {
      const entryIso = e.addedAt.slice(0, 10);
      const lastP = isHistorical && e.sellPrice
        ? { date: (e.soldAt || endIso).slice(0, 10), price: e.sellPrice }
        : { date: hist[hist.length - 1].date, price: hist[hist.length - 1].price };
      windowed = [{ date: entryIso, price: e.cost }, lastP];
    }
    if (windowed.length < 2) return null;

    return {
      ticker: e.ticker,
      qty,
      cost: e.cost ?? e.costBasis,
      direction,
      isActive,
      position: e.position,
      fees: parseFloat(e.fees) || 0,
      windowed,
      sbRow: e.sbRow,
      isHistorical: !!isHistorical,
      soldAt: e.soldAt || null,
      // Contract multiplier carried through so chart MTM math sizes options
      // correctly. For equities/futures/FX this is 1, for options it's 100.
      multiplier: positionMultiplier(e),
    };
  };

  const positionContributions = [
    ...candidates.map(e => buildContribution({ ...e, cost: e.costBasis }, false)),
    ...soldHistoricals.map(e => buildContribution(e, true)),
  ].filter(Boolean);

  if (positionContributions.length === 0) {
    svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)" font-size="11">No history in this range</text>`;
    if (legend) legend.innerHTML = '';
    return;
  }

  // Master date timeline = union of all windowed dates
  const dateSet = new Set();
  positionContributions.forEach(p => p.windowed.forEach(b => dateSet.add(b.date)));
  const allDates = Array.from(dateSet).sort();

  if (allDates.length < 2) {
    svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)" font-size="11">Not enough data points</text>`;
    if (legend) legend.innerHTML = '';
    return;
  }

  // Build price-by-date map per ticker with forward-fill
  positionContributions.forEach(p => {
    p.priceByDate = new Map();
    p.windowed.forEach(b => p.priceByDate.set(b.date, b.price));
  });

  // ============================================================
  //   PORTFOLIO VALUE TIMELINE — proper double-entry mark-to-market
  //
  //   Every transaction is a CASH FLOW EVENT. Every open position is a
  //   MARK-TO-MARKET CONTRIBUTION. They're tracked independently and summed.
  //
  //   Cash flow events (cumulative step function over time):
  //     BUY    →  cash -= cost+fee          (cash leaves to buy stock)
  //     SELL   →  cash += proceeds-fee      (cash returns when selling stock)
  //     SHORT  →  cash += proceeds-fee      (broker credits short sale proceeds)
  //     COVER  →  cash -= cost+fee          (cash leaves to buy back shorted stock)
  //
  //   Mark-to-market contributions (current snapshot of each open position):
  //     LONG     →  +qty × current_price       (asset you own, valued at market)
  //     SHORT    →  -qty × current_price       (liability — what it'd cost to cover now)
  //     LONG sold position →  zero (already converted to cash via SELL event above)
  //     SHORT covered      →  zero (already converted via COVER event above)
  //
  //   NAV at any date = cash_at(date) + sum of open-position MTM at that date
  //
  //   This makes shorts self-balance at entry (the +proceeds cash and the
  //   -liability MTM cancel), then any price drift becomes pure P/L. No more
  //   ghost +$14,515 inflating the chart when you open a short.
  // ============================================================

  // Build a unified cash event timeline from EVERY transaction type.
  const cashEvents = [];
  for (const tx of txLedger) {
    const dateIso = (tx.soldDate || tx.entryDate || tx.ts || '').slice(0, 10);
    if (!dateIso) continue;
    const fee = parseFloat(tx.fee) || 0;
    let delta = 0;
    // Equity / generic types
    if (tx.type === 'buy')               delta = -((tx.cost) || (tx.qty * tx.price + fee));
    else if (tx.type === 'sell')         delta = (tx.proceeds != null) ? tx.proceeds : (tx.qty * tx.price - fee);
    else if (tx.type === 'short')        delta = (tx.qty * tx.price) - fee;
    else if (tx.type === 'cover')        delta = -((tx.qty * tx.price) + fee);
    // Option types — the tx.cost field already carries qty × premium × 100
    // so we just consume it directly. buy-to-open uses cash (premium paid);
    // sell-to-open credits proceeds; buy-to-close/sell-to-close mirror them
    // on the unwind side.
    else if (tx.type === 'buy-to-open')  delta = -((tx.cost) || (tx.qty * tx.price * 100 + fee));
    else if (tx.type === 'sell-to-open') delta = (tx.proceeds != null) ? tx.proceeds : (tx.qty * tx.price * 100 - fee);
    else if (tx.type === 'sell-to-close')delta = (tx.proceeds != null) ? tx.proceeds : (tx.qty * tx.price * 100 - fee);
    else if (tx.type === 'buy-to-close') delta = -((tx.cost) || (tx.qty * tx.price * 100 + fee));
    if (delta !== 0) cashEvents.push({ date: dateIso, cashDelta: delta });
  }

  // CRITICAL: a position added DIRECTLY (not through a logged buy/short tx) has
  // no cash event, so its market value would inflate the chart with no
  // offsetting cash outflow — exactly the "+$30K jump when I add SNK" bug.
  // Buying is a CASH→ASSET swap: at entry, cash falls by cost and the position's
  // MTM rises by the same amount, so NAV is UNCHANGED until prices move. We
  // synthesize that entry cash event for every active position whose entry isn't
  // already represented by a transaction on/near its entry date.
  const _txKeyset = new Set(txLedger
    .filter(t => t.entryDate && t.ticker && (t.type === 'buy' || t.type === 'short' || t.type === 'buy-to-open' || t.type === 'sell-to-open'))
    .map(t => `${(t.ticker || '').toUpperCase()}|${(t.entryDate || '').slice(0,10)}`));
  for (const p of positionContributions) {
    if (p.isHistorical) continue;                       // sold positions handled via ledger
    if (!ACTIVE_POSITIONS.includes(p.position)) continue;
    const entryIso = (p.windowed[0]?.date) || null;
    if (!entryIso) continue;
    const key = `${(p.ticker || '').toUpperCase()}|${entryIso}`;
    if (_txKeyset.has(key)) continue;                   // a real tx already covers this entry
    const mult = p.multiplier || 1;
    const cost = (p.cost != null ? p.cost : 0) * p.qty * mult + (p.fees || 0);
    if (!cost) continue;
    if (p.position === 'Short') {
      // Short entry CREDITS cash (broker pays you the sale proceeds); the
      // negative MTM liability already cancels it, so NAV is flat at entry.
      cashEvents.push({ date: entryIso, cashDelta: +(p.cost * p.qty * mult - (p.fees || 0)) });
    } else {
      // Long/Trading entry SPENDS cash equal to the position's cost.
      cashEvents.push({ date: entryIso, cashDelta: -cost });
    }
  }
  cashEvents.sort((a, b) => a.date.localeCompare(b.date));

  // Cumulative cash at any date. Reconciled to current Cash Position so the
  // chart's final point matches what the user sees in the Cash Position panel.
  // Any difference is treated as pre-existing balance and back-filled.
  function cashAtDate(dateIso) {
    let total = 0;
    for (const ev of cashEvents) {
      if (ev.date <= dateIso) total += ev.cashDelta;
      else break;
    }
    return total;
  }
  const expectedCash = (typeof getCashPosition === 'function') ? getCashPosition() : 0;
  const computedFinalCash = cashEvents.reduce((s, ev) => s + ev.cashDelta, 0);
  const cashOffset = expectedCash - computedFinalCash;

  // Aggregate portfolio value at each date — proper MTM model
  const portfolioSeries = [];
  for (const date of allDates) {
    let openPositionMtm = 0;
    let totalFees = 0;
    let contributors = 0;
    for (const p of positionContributions) {
      // Historical positions only contribute up to their sold date — after
      // that, the proceeds are reflected in the cash event timeline instead.
      if (p.isHistorical && p.soldAt && date > p.soldAt.slice(0, 10)) continue;

      // Forward-fill: last known price ≤ this date
      let price = p.priceByDate.get(date);
      if (price == null) {
        for (let i = p.windowed.length - 1; i >= 0; i--) {
          if (p.windowed[i].date <= date) { price = p.windowed[i].price; break; }
        }
      }
      if (price == null) continue;

      // Don't backdate positions before their entry — they didn't exist yet
      const entryIso = p.windowed[0]?.date;
      if (entryIso && date < entryIso) continue;

      if (p.isHistorical || p.position !== 'Short') {
        // OPEN LONG or pre-sale historical long — asset = qty × price × multiplier
        openPositionMtm += p.qty * price * (p.multiplier || 1);
      } else {
        // OPEN SHORT — liability = qty × price × multiplier (cost to cover)
        openPositionMtm -= p.qty * price * (p.multiplier || 1);
      }
      totalFees += p.fees;
      contributors++;
    }
    // Cash component — sum of transaction events ≤ date + offset to match Cash Position
    const cash = cashAtDate(date) + cashOffset;
    const total = openPositionMtm + cash;
    if (contributors > 0 || cashEvents.some(ev => ev.date <= date)) {
      portfolioSeries.push({ date, value: total, positions: openPositionMtm, cash });
    }
  }

  if (portfolioSeries.length < 2) {
    svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)" font-size="11">No data points in range</text>`;
    if (legend) legend.innerHTML = '';
    return;
  }

  // ── Chart layout ──
  const W = 1100, H = 320;
  const margin = { top: 36, right: 24, bottom: 38, left: 80 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  // Y range with subtle padding
  let yMin = Infinity, yMax = -Infinity;
  portfolioSeries.forEach(p => {
    if (p.value < yMin) yMin = p.value;
    if (p.value > yMax) yMax = p.value;
  });
  const yRange = yMax - yMin;
  const yPad = yRange > 0 ? yRange * 0.10 : Math.max(yMax * 0.02, 1);
  yMin -= yPad;
  yMax += yPad;

  const xScale = i => margin.left + (i / Math.max(1, portfolioSeries.length - 1)) * innerW;
  const yScale = v => margin.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  // Find high/low
  let hiIdx = 0, loIdx = 0;
  portfolioSeries.forEach((p, i) => {
    if (p.value > portfolioSeries[hiIdx].value) hiIdx = i;
    if (p.value < portfolioSeries[loIdx].value) loIdx = i;
  });
  const hi = portfolioSeries[hiIdx];
  const lo = portfolioSeries[loIdx];
  const startVal = portfolioSeries[0].value;
  const endVal = portfolioSeries[portfolioSeries.length - 1].value;
  const periodChange = endVal - startVal;
  const periodPct = startVal > 0 ? periodChange / startVal : 0;
  const isUp = periodChange >= 0;
  const lineColor = isUp ? 'var(--pos)' : 'var(--neg)';
  const fillColor = isUp ? 'rgba(91,138,114,0.12)' : 'rgba(165,100,90,0.12)';

  // Format helpers
  // Local helper for long-form decimal display (no compact notation).
  // Use the global fmt$ for compact mode (it now adds commas).
  const fmt$L = v => v == null ? '—' : '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Build line path
  let linePath = '';
  let areaPath = '';
  portfolioSeries.forEach((p, i) => {
    const x = xScale(i).toFixed(2);
    const y = yScale(p.value).toFixed(2);
    if (i === 0) {
      linePath = `M ${x} ${y}`;
      areaPath = `M ${x} ${(margin.top + innerH).toFixed(2)} L ${x} ${y}`;
    } else {
      linePath += ` L ${x} ${y}`;
      areaPath += ` L ${x} ${y}`;
    }
  });
  areaPath += ` L ${xScale(portfolioSeries.length - 1).toFixed(2)} ${(margin.top + innerH).toFixed(2)} Z`;

  // ── Y-axis ticks (5 evenly spaced) ──
  const yTicks = [];
  for (let i = 0; i <= 4; i++) yTicks.push(yMin + (yMax - yMin) * (i / 4));

  let s = '';

  // Header line — portfolio value + period change
  s += `<text x="${margin.left}" y="22" font-family="var(--mono)" font-size="11" fill="var(--ink-dim)" letter-spacing="0.1em">PORTFOLIO VALUE</text>`;
  s += `<text x="${margin.left + 130}" y="22" font-family="var(--mono)" font-size="16" fill="var(--ink)" font-weight="700">${fmt$L(endVal)}</text>`;
  s += `<text x="${margin.left + 130}" y="36" font-family="var(--mono)" font-size="11" fill="${lineColor}" font-weight="600">${isUp ? '▲ +' : '▼ '}${fmt$L(periodChange)} (${(periodPct * 100).toFixed(2)}%)</text>`;

  // High/low badges right side
  s += `<text x="${margin.left + innerW}" y="18" text-anchor="end" font-family="var(--mono)" font-size="10" fill="var(--pos)">HIGH ${fmt$(hi.value)}</text>`;
  s += `<text x="${margin.left + innerW}" y="32" text-anchor="end" font-family="var(--mono)" font-size="10" fill="var(--neg)">LOW ${fmt$(lo.value)}</text>`;

  // Y grid (subtle)
  s += `<g stroke="var(--rule)" stroke-width="0.5" stroke-dasharray="2 3" opacity="0.5">`;
  yTicks.forEach(v => {
    const y = yScale(v);
    s += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + innerW}" y2="${y}"/>`;
  });
  s += `</g>`;

  // Y-axis labels
  s += `<g font-family="var(--mono)" font-size="10" fill="var(--ink-dim)">`;
  yTicks.forEach(v => {
    s += `<text x="${margin.left - 10}" y="${yScale(v) + 4}" text-anchor="end">${fmt$(v)}</text>`;
  });
  s += `</g>`;

  // Area fill + line
  s += `<path d="${areaPath}" fill="${fillColor}" stroke="none"/>`;
  s += `<path d="${linePath}" stroke="${lineColor}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;

  // High/low triangle markers
  const hiX = xScale(hiIdx), hiY = yScale(hi.value);
  s += `<circle cx="${hiX}" cy="${hiY}" r="3.5" fill="var(--pos)" stroke="var(--bg)" stroke-width="1.5"/>`;
  const loX = xScale(loIdx), loY = yScale(lo.value);
  s += `<circle cx="${loX}" cy="${loY}" r="3.5" fill="var(--neg)" stroke="var(--bg)" stroke-width="1.5"/>`;

  // Endpoint dot
  const endX = xScale(portfolioSeries.length - 1);
  const endY = yScale(endVal);
  s += `<circle cx="${endX}" cy="${endY}" r="4" fill="${lineColor}" stroke="var(--bg)" stroke-width="2"/>`;

  // X-axis date labels (6 ticks evenly spaced)
  const numXTicks = Math.min(6, portfolioSeries.length);
  s += `<g font-family="var(--mono)" font-size="10" fill="var(--ink-faint)">`;
  for (let i = 0; i < numXTicks; i++) {
    const idx = Math.floor(i * (portfolioSeries.length - 1) / (numXTicks - 1));
    const d = portfolioSeries[idx].date;
    const [y, mo, day] = d.split('-');
    const short = `${mo}/${day}/${y.slice(2)}`;
    s += `<text x="${xScale(idx)}" y="${margin.top + innerH + 22}" text-anchor="middle">${short}</text>`;
  }
  s += `</g>`;

  // Hover layer
  s += `<rect id="pc-hover-rect" x="${margin.left}" y="${margin.top}" width="${innerW}" height="${innerH}" fill="transparent" style="cursor:crosshair"/>`;
  s += `<g id="pc-tooltip" style="display:none;pointer-events:none">
    <line id="pc-vline" x1="0" y1="${margin.top}" x2="0" y2="${margin.top + innerH}" stroke="var(--amber)" stroke-width="0.8" stroke-dasharray="3 3"/>
    <circle id="pc-dot" r="5" fill="var(--amber)" stroke="var(--bg)" stroke-width="1.5"/>
    <rect id="pc-tip-bg" rx="3" ry="3" fill="var(--bg)" stroke="var(--amber)" stroke-width="1" fill-opacity="0.96"/>
    <g id="pc-tip-text"></g>
  </g>`;

  svg.innerHTML = s;

  svg._pcCtx = { dataPoints: portfolioSeries, margin, innerW, innerH, xScale, yScale, lineColor };

  const hoverRect = svg.querySelector('#pc-hover-rect');
  if (hoverRect) {
    hoverRect.addEventListener('mousemove', e => {
      const rect = svg.getBoundingClientRect();
      const vbX = (e.clientX - rect.left) / rect.width * W;
      const ratio = (vbX - margin.left) / innerW;
      const idx = Math.max(0, Math.min(portfolioSeries.length - 1, Math.round(ratio * (portfolioSeries.length - 1))));
      showPCTooltip(idx);
    });
    hoverRect.addEventListener('mouseleave', () => {
      const tip = document.getElementById('pc-tooltip');
      if (tip) tip.style.display = 'none';
    });
  }

  // Legend — only show CURRENTLY-HELD positions. Sold positions contributed
  // their lifetime value to the equity curve already; they don't belong as
  // line items in the legend (their realized P&L is part of cash now).
  if (legend) {
    const items = positionContributions
      .filter(p => !p.isHistorical)   // hide sold-history reconstructions
      .map(p => {
        const last = p.windowed[p.windowed.length - 1];
        const positionPct = p.direction * (last.price - p.cost) / p.cost;
        const color = positionPct >= 0 ? 'var(--pos)' : 'var(--neg)';
        return `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap">
          <span style="color:var(--amber);font-weight:700">${p.ticker}</span>
          <span style="color:var(--ink-faint);font-size:9px">${p.position}${p.qty && p.isActive ? ` · ${p.qty}sh` : ''}</span>
          <span style="color:${color};font-weight:600">${positionPct >= 0 ? '+' : ''}${(positionPct * 100).toFixed(2)}%</span>
        </span>`;
      }).join('');
    // Cash chip — current live cash balance from getCashPosition() so the
    // legend agrees with both the chart NAV and the Cash Position panel.
    const liveCash = (typeof getCashPosition === 'function') ? getCashPosition() : 0;
    const cashChip = Math.abs(liveCash) > 0.01
      ? `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding-left:10px;border-left:1px solid var(--rule)">
           <span style="color:#7faaca;font-weight:700">CASH</span>
           <span style="color:var(--ink-faint);font-size:9px">current balance</span>
           <span style="color:#7faaca;font-weight:600">${fmt$(liveCash)}</span>
         </span>`
      : '';
    legend.innerHTML = items + cashChip;
  }
}

function showPCTooltip(idx) {
  const svg = document.getElementById('portfolio-chart-svg');
  if (!svg?._pcCtx) return;
  const ctx = svg._pcCtx;
  const pt = ctx.dataPoints[idx];
  if (!pt) return;
  const tip = document.getElementById('pc-tooltip');
  const vline = document.getElementById('pc-vline');
  const dot = document.getElementById('pc-dot');
  const tipBg = document.getElementById('pc-tip-bg');
  const tipText = document.getElementById('pc-tip-text');
  if (!tip) return;

  const cx = ctx.xScale(idx);
  const cy = ctx.yScale(pt.value);
  vline.setAttribute('x1', cx);
  vline.setAttribute('x2', cx);
  dot.setAttribute('cx', cx);
  dot.setAttribute('cy', cy);

  // Compute change from start of visible window for context
  const startVal = ctx.dataPoints[0].value;
  const startDate = ctx.dataPoints[0].date;
  const change = pt.value - startVal;
  const pct = startVal > 0 ? change / startVal : 0;
  const changeColor = change >= 0 ? 'var(--pos)' : 'var(--neg)';

  const fmt$L = v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let prettyDate = pt.date;
  let prettyStart = startDate;
  try {
    prettyDate = new Date(pt.date + 'T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    prettyStart = new Date(startDate + 'T12:00:00Z').toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' });
  } catch {}

  const lines = [
    { t: prettyDate, color: 'var(--amber)', weight: '700', size: 12 },
    { t: fmt$L(pt.value), color: 'var(--ink)', weight: '700', size: 14 },
    { t: `${change >= 0 ? '+' : ''}${fmt$L(change)} (${(pct * 100).toFixed(2)}%) since ${prettyStart}`, color: changeColor, size: 11 },
  ];

  tipText.innerHTML = '';
  const tipW = 260, lineH = 18;
  const tipH = lines.length * lineH + 10;
  const W = 1100;
  const flipped = (cx + tipW + 16) > (ctx.margin.left + ctx.innerW);
  const bgX = flipped ? cx - tipW - 12 : cx + 12;
  const bgY = Math.max(ctx.margin.top + 4, Math.min(cy - tipH / 2, ctx.margin.top + ctx.innerH - tipH - 4));

  lines.forEach((line, i) => {
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', bgX + 10);
    txt.setAttribute('y', bgY + 16 + i * lineH);
    txt.setAttribute('fill', line.color);
    txt.setAttribute('font-family', 'var(--mono)');
    txt.setAttribute('font-size', line.size || 11);
    if (line.weight) txt.setAttribute('font-weight', line.weight);
    txt.textContent = line.t;
    tipText.appendChild(txt);
  });
  tipBg.setAttribute('x', bgX);
  tipBg.setAttribute('y', bgY);
  tipBg.setAttribute('width', tipW);
  tipBg.setAttribute('height', tipH);
  tip.style.display = '';
}

function wirePortfolioToolbar() {
  document.getElementById('portfolio-add-btn')?.addEventListener('click', () => {
    openAddPositionModal();
  });
  document.getElementById('portfolio-load-repo')?.addEventListener('click', async () => {
    const btn = document.getElementById('portfolio-load-repo');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
    try {
      if (typeof importPortfolioData === 'function') await importPortfolioData();
      // Make sure every loaded position is in the GoodGlobe index, dated from its
      // real entry — then refresh the view.
      if (typeof backfillGoodGlobeIndexFromPortfolio === 'function') backfillGoodGlobeIndexFromPortfolio();
      if (typeof renderStockBook === 'function') renderStockBook();
      else if (typeof renderPortfolioTab === 'function') renderPortfolioTab();
    } catch (e) {
      if (typeof flashStatus === 'function') flashStatus('Load from repo failed — see console', 'error');
    } finally {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
    }
  });
  document.getElementById('portfolio-import-watch')?.addEventListener('click', () => {
    const sbRows = state.stockbook?.rows || [];
    // Map sheet status values to portfolio positions
    const statusMap = {
      'trading': 'Trading',
      'long': 'Long',
      'short': 'Short',
      'watching': 'Watching',
      'tracking': 'Tracking',
      'avoid': 'Avoid',
      'sold': 'Sold',
    };
    let added = 0;
    sbRows.forEach(r => {
      const status = (r.status || '').toLowerCase().trim();
      if (statusMap[status]) {
        const existing = loadPortfolio().find(e => e.ticker === r.ticker);
        if (!existing) {
          addToPortfolio({ ticker: r.ticker, position: statusMap[status], notes: [] });
          added++;
        }
      }
    });
    flashStatus(`Imported ${added} positions from sheet status`, 'success');
    renderStockBook();
  });
  document.getElementById('portfolio-save-repo')?.addEventListener('click', async () => {
    const btn = document.getElementById('portfolio-save-repo');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      if (typeof commitTarget === 'function') {
        await commitTarget('portfolio', 'portfolio: app save');   // routes to the configured repo
      }
      // Also mirror to Supabase if configured.
      try { if (typeof portSupabaseSyncAll === 'function' && typeof portSupabaseConfigured === 'function' && portSupabaseConfigured()) await portSupabaseSyncAll(); } catch {}
    } finally { if (btn) { btn.textContent = orig; btn.disabled = false; } }
  });
  document.getElementById('portfolio-export')?.addEventListener('click', () => {
    // Use the FULL snapshot (positions + transactions + cash + GoodGlobe index),
    // not just the raw positions array — this is the shape importPortfolioData()
    // reads, so Export → Import round-trips cleanly. (The old handler dumped only
    // loadPortfolio(), which the importer couldn't restore.)
    if (typeof exportPortfolioData === 'function') { exportPortfolioData(); return; }
    const data = loadPortfolio();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function wirePortfolioRowEvents() {
  // Position dropdown
  document.querySelectorAll('.portfolio-position').forEach(sel => {
    sel.addEventListener('change', () => {
      const id = sel.dataset.id;
      const entry = findPortfolioEntry(id);
      if (!entry) return;
      const newPos = sel.value;
      // ENFORCE: only allow change to "Sold" via the sell modal (so we capture price/qty/fee)
      if (newPos === 'Sold' && entry.position !== 'Sold') {
        openSellModal(id);
        // Revert the dropdown until sell modal saves
        sel.value = entry.position;
        return;
      }
      updatePortfolioEntry(id, {
        position: newPos,
        // Clear qty if moving to non-active state
        ...((!ACTIVE_POSITIONS.includes(newPos)) ? { qty: null } : {}),
      });
      renderStockBook();
    });
  });
  // Notes button — id-based
  document.querySelectorAll('.portfolio-notes-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const entry = findPortfolioEntry(id);
      if (entry) openNotesModal(entry.ticker, id);
    });
  });
  // Actions — id-based for edit/remove, ticker-based for value (goes to Valuation tab)
  document.querySelectorAll('[data-portfolio-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.portfolioAct;
      const id = btn.dataset.id;
      const tic = btn.dataset.tic;
      if (act === 'value') {
        switchTab('valuation');
        document.getElementById('ticker').value = tic;
        loadValuation();
      } else if (act === 'edit') {
        openEditPositionModal(id);
      } else if (act === 'remove') {
        const entry = findPortfolioEntry(id);
        if (!entry) return;
        if (await appConfirm(`Remove ${entry.ticker} (added ${entry.addedAt?.slice(0,10) || 'unknown'}) from portfolio?\n\nThis only affects the position. Any sell transactions remain in the Transactions tab.`)) {
          removeFromPortfolio(id);
          renderStockBook();
        }
      }
    });
  });
}

function renderGoodGlobeIndexView(content, summary, subTabs) {
  // Make sure every current portfolio position (held, watched, OR tracked) is in
  // the index roster before we render — the index should always mirror the
  // portfolio. This is why the roster looked empty after a refresh: nothing
  // re-populated it from the loaded portfolio.
  try { if (typeof backfillGoodGlobeIndexFromPortfolio === 'function') backfillGoodGlobeIndexFromPortfolio(); } catch {}
  const entries = (typeof getGoodGlobeIndexEntries === 'function') ? getGoodGlobeIndexEntries() : [];
  // Per-member live return % since each was added (equal-weight index members).
  // Built once here so each row can show its contribution to the index.
  let _memberReturns = {};
  try {
    const _perf = (typeof goodGlobeIndexPerformance === 'function') ? goodGlobeIndexPerformance(state.goodglobeView?.perfWindow || 'all') : null;
    if (_perf && Array.isArray(_perf.perMember)) {
      for (const pm of _perf.perMember) _memberReturns[pm.ticker] = pm;
    }
  } catch {}

  // Tally counts
  const byAssetType = {};
  const byFlag = {};
  let manualCount = 0;
  for (const e of entries) {
    const at = e.assetType || 'equity';
    byAssetType[at] = (byAssetType[at] || 0) + 1;
    for (const f of (e.flags || [])) byFlag[f] = (byFlag[f] || 0) + 1;
    if (e.source === 'manual_import' || (e.flags || []).includes('Manual')) manualCount++;
  }
  const totalCount = entries.length;

  // Search/filter state (lives on state.goodglobeView so it persists across re-renders)
  state.goodglobeView = state.goodglobeView || { search: '', assetFilter: 'all', flagFilter: 'all' };
  const gv = state.goodglobeView;

  // Apply current filters
  let visible = entries;
  if (gv.search) {
    const q = gv.search.toUpperCase();
    visible = visible.filter(e => e.ticker.toUpperCase().includes(q));
  }
  if (gv.assetFilter !== 'all') {
    visible = visible.filter(e => (e.assetType || 'equity') === gv.assetFilter);
  }
  if (gv.flagFilter !== 'all') {
    visible = visible.filter(e => (e.flags || []).includes(gv.flagFilter));
  }

  // Tabs of asset types as quick filters — only show types that have content
  const assetTypes = Object.keys(byAssetType).sort((a, b) => byAssetType[b] - byAssetType[a]);
  const assetTypeButtons = `
    <button class="gg-filter-btn ${gv.assetFilter === 'all' ? 'active' : ''}" data-filter-type="asset" data-val="all">All (${totalCount})</button>
    ${assetTypes.map(at => `<button class="gg-filter-btn ${gv.assetFilter === at ? 'active' : ''}" data-filter-type="asset" data-val="${escapeHtml(at)}">${escapeHtml(at)} (${byAssetType[at]})</button>`).join('')}
  `;

  const flagOptions = Object.keys(byFlag).sort();
  const flagDropdown = `
    <select class="gg-flag-select" id="gg-flag-filter">
      <option value="all">All flags</option>
      ${flagOptions.map(f => `<option value="${escapeHtml(f)}" ${gv.flagFilter === f ? 'selected' : ''}>${escapeHtml(f)} (${byFlag[f]})</option>`).join('')}
    </select>
  `;

  // Row renderer for the table
  const rowHtml = visible.map(e => {
    const flagsBadges = (e.flags || []).map(f => {
      const color = f === 'Avoid'    ? 'var(--neg)'
                  : f === 'Watching' ? 'var(--data-amber)'
                  : f === 'Tracking' ? '#7faaca'
                  : f === 'Trading' || f === 'Long' ? 'var(--pos)'
                  : f === 'Short'    ? '#a85a3a'
                  : f === 'Sold'     ? 'var(--ink-faint)'
                  : f === 'Manual'   ? 'var(--amber)'
                  : 'var(--ink-dim)';
      return `<span class="gg-flag" style="border-color:${color};color:${color}">${escapeHtml(f)}</span>`;
    }).join(' ');
    const firstDate = e.firstFlaggedAt ? new Date(e.firstFlaggedAt).toISOString().slice(0, 10) : '—';
    const lastDate  = e.lastFlaggedAt  ? new Date(e.lastFlaggedAt).toISOString().slice(0, 10)  : '—';
    // Realized P/L cell — CUMULATIVE across every closed trade of this ticker,
    // computed from the transaction ledger ($ gained/lost + blended % on capital
    // deployed). Falls back to the index trade-journal figure if no transactions.
    const cumPL = (typeof cumulativeTickerPL === 'function') ? cumulativeTickerPL(e.ticker) : null;
    const hasTxPL = cumPL && cumPL.trades > 0;
    const hasTradePL = e.realizedPL != null && e.tradeCount > 0;
    let plCell;
    if (hasTxPL) {
      const v = cumPL.totalPL;
      const plColor = v >= 0 ? 'var(--pos)' : 'var(--neg)';
      plCell = `<span style="color:${plColor};font-weight:600">${v >= 0 ? '+' : ''}$${Math.abs(v) >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(2)}</span>`
        + (cumPL.pctOfCost != null ? ` <span style="color:${plColor};font-size:9px">(${cumPL.pctOfCost >= 0 ? '+' : ''}${cumPL.pctOfCost}%)</span>` : '')
        + `<br><span style="font-size:8px;color:var(--ink-faint)">${cumPL.trades} trade${cumPL.trades === 1 ? '' : 's'} cumulative${cumPL.winRate != null ? ` · ${Math.round(cumPL.winRate * 100)}% win` : ''}</span>`;
    } else if (hasTradePL) {
      const plColor = e.realizedPL >= 0 ? 'var(--pos)' : 'var(--neg)';
      plCell = `<span style="color:${plColor};font-weight:600">${e.realizedPL >= 0 ? '+' : ''}$${Math.abs(e.realizedPL) >= 1000 ? (e.realizedPL/1000).toFixed(1) + 'k' : e.realizedPL.toFixed(2)}</span>`
        + `<br><span style="font-size:8px;color:var(--ink-faint)">${e.tradeCount} trade${e.tradeCount === 1 ? '' : 's'}${e.winRate != null ? ` · ${Math.round(e.winRate * 100)}% win` : ''}</span>`;
    } else {
      plCell = '<span style="color:var(--ink-faint)">—</span>';
    }
    // Live "% since added" — this member's contribution to the equal-weighted
    // index, measured from its entry price to the current price.
    const mr = _memberReturns[e.ticker];
    const sinceColor = !mr ? 'var(--ink-faint)' : mr.returnPct >= 0 ? 'var(--pos)' : 'var(--neg)';
    const isShortRow = mr && mr.direction === 'short';
    const sinceCell = mr
      ? `<span style="color:${sinceColor};font-weight:700">${mr.returnPct >= 0 ? '+' : ''}${mr.returnPct}%</span>`
        + (isShortRow ? `<span style="font-size:8px;color:#a85a3a;font-weight:700"> SHORT</span>` : '')
        + `<br><span style="font-size:8px;color:var(--ink-faint)">$${mr.entryPrice} → $${mr.current}${isShortRow ? ' (inv)' : ''}</span>`
      : '<span style="color:var(--ink-faint)">—</span>';
    return `
      <tr>
        <td><strong class="gg-ticker-link" data-tic="${escapeHtml(e.ticker)}" style="color:var(--amber);font-family:var(--mono);cursor:pointer;text-decoration:underline;text-decoration-style:dotted" title="Open ${escapeHtml(e.ticker)} in Valuation">${escapeHtml(e.ticker)}</strong></td>
        <td><span class="gg-asset-pill">${escapeHtml(e.assetType || 'equity')}</span></td>
        <td>${flagsBadges || '<span style="color:var(--ink-faint)">—</span>'}</td>
        <td style="font-family:var(--mono);font-size:10px">${sinceCell}</td>
        <td style="font-family:var(--mono);font-size:10px">${plCell}</td>
        <td style="font-family:var(--mono);font-size:10px;color:var(--ink-dim)">${firstDate}</td>
        <td style="font-family:var(--mono);font-size:10px;color:var(--ink-dim)">${lastDate}</td>
        <td>
          <button class="btn btn-ghost gg-row-remove" data-tic="${escapeHtml(e.ticker)}" title="Remove from GoodGlobe Index (does NOT affect portfolio positions)">×</button>
        </td>
      </tr>
    `;
  }).join('');

  content.innerHTML = summary + subTabs + `
    ${(() => {
      // ===== EQUAL-WEIGHTED INDEX PERFORMANCE PANEL =====
      const perf = (typeof goodGlobeIndexPerformance === 'function') ? goodGlobeIndexPerformance(state.goodglobeView?.perfWindow || 'all') : null;
      if (!perf || perf.memberCount === 0) {
        return `<div class="company-card" style="margin:0 0 14px"><div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:6px 0">Index performance tracks once members with an entry price are added. Add tickers via Tracking/Trading and a price is captured at add time; the equal-weighted index builds from there.</div></div>`;
      }
      const win = state.goodglobeView?.perfWindow || 'all';
      // Headline = weighted return since each member was added (the user's spec).
      const headlinePct = perf.headlineReturn != null ? perf.headlineReturn : (perf.weightedSinceAdd != null ? perf.weightedSinceAdd : (perf.equalWeightSinceAdd ?? 0));
      const allTimePct = headlinePct;
      const c = allTimePct == null ? 'var(--ink-dim)' : allTimePct >= 0 ? 'var(--pos)' : 'var(--neg)';
      const weightLabel = perf.weightMode === 'mktcap' ? 'market-cap weighted' : 'equal-weighted';
      // Floating area performance chart with hover. No baseline label, no axis
      // numbers — just the curve, a soft gradient fill, and a crosshair on hover
      // that reads out the index price + % change at that point.
      let chart = '';
      const pts = perf.levelSeries;
      if (pts.length >= 2) {
        const vals = pts.map(p => p.level);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const pad = (hi - lo) * 0.12 || (hi * 0.02) || 1; const L = lo - pad, H = hi + pad;
        const W = 600, HT = 130;
        const x = i => pts.length > 1 ? (i / (pts.length - 1)) * W : 0;
        const y = v => HT - ((v - L) / (H - L)) * HT;
        const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.level).toFixed(1)}`).join(' ');
        const area = `${line} L${W},${HT} L0,${HT} Z`;
        const up = pts[pts.length - 1].level >= pts[0].level;
        const stroke = up ? 'var(--pos)' : 'var(--neg)';
        const gid = 'ggGrad' + (up ? 'U' : 'D');
        const base0 = pts[0].level;   // baseline = first point of the window (for % readout)
        // Serialize points for the hover handler (date + level + pct vs window start).
        const ptData = pts.map(p => ({ d: p.date, l: p.level, p: +(((p.level - base0) / base0) * 100).toFixed(2) }));
        chart = `<div class="gg-chart-wrap" style="position:relative;margin-top:10px">
          <svg id="gg-perf-svg" viewBox="0 0 ${W} ${HT}" preserveAspectRatio="none" style="width:100%;height:130px;display:block;overflow:visible">
            <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${stroke}" stop-opacity="0.28"/>
              <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
            </linearGradient></defs>
            <path d="${area}" fill="url(#${gid})" stroke="none"/>
            <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" vector-effect="non-scaling-stroke"/>
            <line id="gg-cross" x1="0" y1="0" x2="0" y2="${HT}" stroke="var(--ink-dim)" stroke-width="1" stroke-dasharray="3,3" opacity="0" vector-effect="non-scaling-stroke"/>
            <circle id="gg-dot" r="3.5" fill="${stroke}" opacity="0"/>
          </svg>
          <div id="gg-hover" style="position:absolute;top:0;left:0;transform:translate(-50%,-100%);background:var(--bg-card);border:1px solid var(--rule);border-radius:4px;padding:4px 8px;font-family:var(--mono);font-size:10px;white-space:nowrap;pointer-events:none;opacity:0;box-shadow:0 4px 14px rgba(0,0,0,.4);z-index:5"></div>
          <div id="gg-hit" data-pts='${escapeHtml(JSON.stringify(ptData))}' style="position:absolute;inset:0;cursor:crosshair"></div>
        </div>`;
      }
      return `<div class="company-card" style="margin:0 0 14px;border-left:3px solid ${c}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase">GoodGlobe Index · ${weightLabel} · ${perf.memberCount} member${perf.memberCount===1?'':'s'}</div>
            <div style="display:flex;align-items:baseline;gap:10px;margin-top:3px">
              <span id="gg-price-readout" style="font-family:var(--mono);font-size:30px;font-weight:800;color:${c};line-height:1">$${perf.indexValue}</span>
              <span id="gg-pct-readout" style="font-family:var(--mono);font-size:14px;font-weight:700;color:${c}">${allTimePct >= 0 ? '+' : ''}${allTimePct}%</span>
            </div>
            <div id="gg-sub-readout" style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-top:2px">since inception · hover to scrub</div>
          </div>
          ${(typeof window !== 'undefined' && window.VChart) ? '' : `          <div class="seg-control" style="font-size:10px">
            ${['week','month','quarter','year','all'].map(w => `<button class="seg-btn ${win===w?'active':''}" data-ggperfwin="${w}" style="font-size:10px;text-transform:capitalize">${w==='all'?'All':w==='week'?'1W':w==='month'?'1M':w==='quarter'?'1Q':'1Y'}</button>`).join('')}
          </div>`}
        </div>
        ${(typeof window !== 'undefined' && window.VChart) ? '<div id="gg-hist-mount"></div>' : chart}
        <div style="font-family:var(--mono);font-size:8px;color:var(--ink-faint);margin-top:8px;opacity:0.8">${perf.weightMode === 'mktcap' ? 'Market-cap weighted: bigger companies move the index more.' : 'Equal-weighted: every member counts the same.'} Shorts tracked inverse. Removed tickers freeze (no retro change). <button id="gg-weight-toggle" class="btn btn-ghost" style="font-size:8px;padding:2px 8px;margin-left:6px">Switch to ${perf.weightMode === 'mktcap' ? 'equal weight' : 'market-cap'}</button> <button id="gg-ledger-btn" class="btn btn-ghost" style="font-size:8px;padding:2px 8px">Membership ledger ↗</button></div>
      </div>`;
    })()}
    <div class="gg-toolbar">
      <input type="text" class="gg-search" id="gg-search" placeholder="Search tickers…" value="${escapeHtml(gv.search)}">
      ${flagDropdown}
      <button class="btn" id="gg-export-all" title="Copy all tickers to clipboard">Copy All</button>
      <button class="btn" id="gg-export-manual" title="Copy only Manual-imported tickers (the ones not yet in your pipeline)">Copy Manual</button>
      <button class="btn btn-ghost" id="gg-download-all" title="Download as tickers.txt">Download All .txt</button>
      <button class="btn btn-ghost" id="gg-download-manual" title="Download only Manual-imported as .txt for pasting into pipeline tickers.txt">Download Manual .txt</button>
    </div>
    <div class="gg-asset-filters">${assetTypeButtons}</div>
    <div class="gg-info-strip">
      <div><strong style="color:var(--amber)">${totalCount}</strong> ticker${totalCount === 1 ? '' : 's'} tracked · <strong style="color:var(--amber)">${manualCount}</strong> from manual import · ${visible.length} visible after filters${(() => {
        const traded = entries.filter(e => e.tradeCount > 0);
        if (traded.length === 0) return '';
        const totalPL = traded.reduce((s, e) => s + (e.realizedPL || 0), 0);
        const totalTrades = traded.reduce((s, e) => s + (e.tradeCount || 0), 0);
        const c = totalPL >= 0 ? 'var(--pos)' : 'var(--neg)';
        return ` · <strong style="color:${c}">${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(2)}</strong> realized across ${totalTrades} trade${totalTrades === 1 ? '' : 's'} on ${traded.length} ticker${traded.length === 1 ? '' : 's'}`;
      })()}</div>
      <div style="color:var(--ink-faint);font-family:var(--mono);font-size:10px">Auto-recorded whenever you add a position · trade P/L (incl. shorts + options ×100) tracked on close · Manual import only adds to this list (no portfolio impact)</div>
    </div>
    ${visible.length === 0
      ? `<div style="padding:40px;text-align:center;color:var(--ink-faint);font-family:var(--mono);font-size:12px">${entries.length === 0 ? 'No tickers in the GoodGlobe Index yet — add a position or use Import .txt from the ADD button to populate.' : 'No matches for current filters.'}</div>`
      : `<div class="gg-table-wrap">
          <table class="gg-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Asset Type</th>
                <th>Flags</th>
                <th title="Live return since this ticker entered the index (entry price → current). This is its contribution to the equal-weighted index.">Since Added</th>
                <th title="Lifetime realized P/L from closed trades — shorts and options (premium × 100) included">Realized P/L</th>
                <th>First Flagged</th>
                <th>Last Flagged</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rowHtml}</tbody>
          </table>
        </div>`
    }
  `;

  // ===== WIRING =====
  // Sub-tab buttons (rebind because we replaced innerHTML)
  document.querySelectorAll('.portfolio-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.portfolioSubTab = btn.dataset.sub;
      renderStockBookPortfolio(content);
    });
  });

  // Search
  document.getElementById('gg-search')?.addEventListener('input', e => {
    gv.search = e.target.value.trim();
    renderStockBookPortfolio(content);
  });
  // Flag dropdown
  document.getElementById('gg-flag-filter')?.addEventListener('change', e => {
    gv.flagFilter = e.target.value;
    renderStockBookPortfolio(content);
  });
  // Asset type filter buttons
  document.querySelectorAll('.gg-filter-btn[data-filter-type="asset"]').forEach(btn => {
    btn.addEventListener('click', () => {
      gv.assetFilter = btn.dataset.val;
      renderStockBookPortfolio(content);
    });
  });

  // Export buttons — clipboard
  const copyToClipboard = async (txt, label) => {
    try {
      await navigator.clipboard.writeText(txt);
      flashStatus(`${label} copied to clipboard`, 'success');
    } catch {
      // Fallback: textarea trick
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flashStatus(`${label} copied`, 'success'); } catch { appAlert(txt); }
      ta.remove();
    }
  };
  document.getElementById('gg-export-all')?.addEventListener('click', () => {
    const txt = exportGoodGlobeIndexAsTxt({ manualOnly: false });
    copyToClipboard(txt, `${totalCount} tickers`);
  });
  document.getElementById('gg-export-manual')?.addEventListener('click', () => {
    const txt = exportGoodGlobeIndexAsTxt({ manualOnly: true });
    copyToClipboard(txt, `${manualCount} manual tickers`);
  });

  // Export buttons — file download
  const downloadTxt = (txt, filename) => {
    const blob = new Blob([txt + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  document.getElementById('gg-download-all')?.addEventListener('click', () => {
    const txt = exportGoodGlobeIndexAsTxt({ manualOnly: false });
    downloadTxt(txt, 'goodglobe-tickers-all.txt');
  });
  document.getElementById('gg-download-manual')?.addEventListener('click', () => {
    const txt = exportGoodGlobeIndexAsTxt({ manualOnly: true });
    downloadTxt(txt, 'goodglobe-tickers-manual.txt');
  });

  // Per-row remove
  // Click a GoodGlobe Index ticker → open it in the Valuation tab.
  document.querySelectorAll('.gg-ticker-link').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const tk = el.dataset.tic;
      if (!tk) return;
      if (typeof executeCommand === 'function') executeCommand(tk);
      else {
        const inp = document.getElementById('ticker');
        if (inp) inp.value = tk;
        if (typeof switchTab === 'function') switchTab('valuation');
        setTimeout(() => document.getElementById('fetch-btn')?.click(), 100);
      }
    });
  });
  // GoodGlobe Index weighting toggle (equal ↔ market-cap / SPY-style).
  document.getElementById('gg-weight-toggle')?.addEventListener('click', () => {
    const cur = (typeof getIndexWeightMode === 'function') ? getIndexWeightMode() : 'equal';
    if (typeof setIndexWeightMode === 'function') setIndexWeightMode(cur === 'mktcap' ? 'equal' : 'mktcap');
    if (typeof flashStatus === 'function') flashStatus(`Index now ${cur === 'mktcap' ? 'equal-weighted' : 'market-cap weighted (SPY-style)'}`, 'success');
    renderStockBookPortfolio(content);
  });

  // z89: real index chart from member price histories (charts.js). The old
  // snapshot chart below stays as the fallback when charts.js isn't loaded.
  try { if (window.VChart && document.getElementById('gg-hist-mount')) window.VChart.mountGoodGlobeChart(); } catch (e) { console.warn('[gg] chart', e); }
  // ---- Floating chart hover: scrub the curve, read out price + % ----
  (function wireGgHover() {
    const hit = document.getElementById('gg-hit');
    const svg = document.getElementById('gg-perf-svg');
    if (!hit || !svg) return;
    let data; try { data = JSON.parse(hit.dataset.pts || '[]'); } catch { data = []; }
    if (!data.length) return;
    const cross = document.getElementById('gg-cross');
    const dot = document.getElementById('gg-dot');
    const tip = document.getElementById('gg-hover');
    const priceEl = document.getElementById('gg-price-readout');
    const pctEl = document.getElementById('gg-pct-readout');
    const subEl = document.getElementById('gg-sub-readout');
    const VBW = 600, VBH = 130;
    const vals = data.map(d => d.l);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || (hi * 0.02) || 1; const L = lo - pad, H = hi + pad;
    const base = (typeof goodGlobeIndexPerformance === 'function') ? goodGlobeIndexPerformance(state.goodglobeView?.perfWindow || 'all') : null;
    const baseVal = base ? base.baseValue : 20;
    const firstLevel = data[0].l;
    const move = (clientX) => {
      const r = hit.getBoundingClientRect();
      let frac = (clientX - r.left) / r.width;
      frac = Math.max(0, Math.min(1, frac));
      const idx = Math.round(frac * (data.length - 1));
      const d = data[idx];
      const xv = (idx / (data.length - 1)) * VBW;
      const yv = VBH - ((d.l - L) / (H - L)) * VBH;
      if (cross) { cross.setAttribute('x1', xv); cross.setAttribute('x2', xv); cross.style.opacity = '0.6'; }
      if (dot) { dot.setAttribute('cx', xv); dot.setAttribute('cy', yv); dot.style.opacity = '1'; }
      // Index $ price at this point = base value scaled by level vs first level.
      const dollar = (baseVal * (d.l / firstLevel)).toFixed(2);
      if (priceEl) priceEl.textContent = '$' + dollar;
      if (pctEl) { pctEl.textContent = (d.p >= 0 ? '+' : '') + d.p + '%'; }
      if (subEl) subEl.textContent = d.d + ' · hover to scrub';
      if (tip) {
        tip.style.opacity = '1';
        tip.style.left = (frac * 100) + '%';
        tip.style.top = ((yv / VBH) * 130) + 'px';
        tip.innerHTML = `<span style="color:var(--ink)">$${dollar}</span> <span style="color:${d.p>=0?'var(--pos)':'var(--neg)'}">${d.p>=0?'+':''}${d.p}%</span><br><span style="color:var(--ink-faint);font-size:9px">${d.d}</span>`;
      }
    };
    const reset = () => {
      if (cross) cross.style.opacity = '0';
      if (dot) dot.style.opacity = '0';
      if (tip) tip.style.opacity = '0';
      const perf2 = (typeof goodGlobeIndexPerformance === 'function') ? goodGlobeIndexPerformance(state.goodglobeView?.perfWindow || 'all') : null;
      if (perf2 && priceEl) priceEl.textContent = '$' + perf2.indexValue;
      const hp = perf2 ? (perf2.headlineReturn ?? perf2.weightedSinceAdd ?? perf2.equalWeightSinceAdd ?? 0) : 0;
      if (pctEl) pctEl.textContent = (hp >= 0 ? '+' : '') + hp + '%';
      if (subEl) subEl.textContent = 'since inception · hover to scrub';
    };
    hit.addEventListener('mousemove', e => move(e.clientX));
    hit.addEventListener('mouseleave', reset);
    hit.addEventListener('touchmove', e => { if (e.touches[0]) { move(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
    hit.addEventListener('touchend', reset);
  })();

  // Membership ledger page (added/removed tickers + their in-index performance).
  document.getElementById('gg-ledger-btn')?.addEventListener('click', () => {
    if (typeof openGoodGlobeLedger === 'function') openGoodGlobeLedger();
  });
  document.querySelectorAll('.gg-row-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tic = btn.dataset.tic;
      if (!await appConfirm(`Take ${tic} off the GoodGlobe Index?\n\nThe index price won't change \u2014 ${tic}'s performance up to now stays baked in. ${tic} moves to the membership ledger with its final in-index return recorded.`, { title: 'Remove from index' })) return;
      const idx = loadGoodGlobeIndex();
      const entry = idx[tic];
      if (entry) {
        const cur = (typeof _currentPriceFor === 'function') ? _currentPriceFor(tic) : null;
        const dir = (typeof _memberDirection === 'function') ? _memberDirection(entry) : 1;
        if (entry.entryPrice && cur != null) {
          const raw = ((cur - entry.entryPrice) / entry.entryPrice) * 100;
          entry.finalReturnPct = +(raw * dir).toFixed(2);
          entry.exitPrice = cur;
        }
        entry.removedFromIndex = true;
        entry.removedAt = new Date().toISOString();
        idx[tic] = entry;
        saveGoodGlobeIndex(idx);
      }
      try { if (typeof portSupabaseConfigured === 'function' && portSupabaseConfigured() && typeof portSupabaseUpsert === 'function') {
        portSupabaseUpsert({ id: '__goodglobe_index__', _kind: 'index', value: loadGoodGlobeIndex() });
      } } catch {}
      if (typeof flashStatus === 'function') flashStatus(`${tic} moved to membership ledger (index price unchanged)`, 'success');
      renderStockBookPortfolio(content);
    });
  });
}

function renderTransactionsLedger(content, summary, subTabs) {
  const transactions = loadTransactions();
  const cash = getCashPosition();

  // Aggregate stats — split between cash flow (signed across all tx) and realized P/L (sells only)
  let totalCashFlow = 0;
  let totalCostBuys = 0;     // for computing total realized P/L %
  let totalProceedsSells = 0;
  const totalRealizedPL = transactions.reduce((s, t) => s + ((t.realizedPL != null && isFinite(t.realizedPL)) ? t.realizedPL : (t.type === 'sell' && t.entryPrice != null && t.qty ? (t.price - t.entryPrice) * t.qty - (t.fee || 0) : 0)), 0);
  const totalFees = transactions.reduce((s, t) => s + (t.fee || 0), 0);

  transactions.forEach(tx => {
    if (tx.type === 'buy')   { totalCashFlow -= (tx.cost || tx.qty * tx.price + (tx.fee || 0)); totalCostBuys += (tx.qty * tx.price); }
    else if (tx.type === 'short') totalCashFlow += (tx.qty * tx.price - (tx.fee || 0));
    else if (tx.type === 'sell')  { totalCashFlow += (tx.proceeds || tx.qty * tx.price - (tx.fee || 0)); totalProceedsSells += (tx.qty * tx.price); }
    else if (tx.type === 'deposit' || tx.type === 'withdrawal' || tx.type === 'adjustment') totalCashFlow += (+tx.amount || 0);
  });
  // Realized P/L % = realized P/L / total cost basis of sold lots
  const realizedCostBasis = transactions
    .filter(t => t.type === 'sell' && t.entryPrice && t.qty)
    .reduce((s, t) => s + (t.qty * t.entryPrice), 0);
  const totalRealizedPLPct = realizedCostBasis > 0 ? (totalRealizedPL / realizedCostBasis) * 100 : 0;

  // ============================================================
  //   UNREALIZED P/L COMPUTATION (per OPEN transaction)
  //
  //   For BUY / SHORT / BUY-TO-OPEN / SELL-TO-OPEN that haven't been closed,
  //   compute current paper P/L using the latest Stock Book price.
  //
  //   Options use the 100× contract multiplier (detected by OCC ticker shape
  //   or buy-to-open/sell-to-open type).
  //
  //   Direction: long types (buy/buy-to-open) gain when price > entry;
  //              short types (short/sell-to-open) gain when price < entry.
  //
  //   Closed transactions (matched sell/cover for an earlier entry) show '—'.
  //   This is best-effort: we don't perfectly FIFO-match buys against sells,
  //   so we use a simpler heuristic — sells/covers themselves show realized P/L,
  //   and OPEN trade rows show unrealized P/L from the live price.
  // ============================================================
  const sbRowsForTx = state.stockbook?.rows || [];
  const sbPriceFor = (tic) => {
    const r = sbRowsForTx.find(row => row.ticker === tic);
    return r ? (r.price ?? r.fmpPrice ?? null) : null;
  };
  const isOcc = (tic) => /^[A-Z]+\d{6}[CP]\d{8}$/.test(String(tic || '').toUpperCase());
  const txMultiplier = (tx) => {
    // Use 100× contract multiplier for option-shaped tickers or option tx types
    if (isOcc(tx.ticker)) return 100;
    if (tx.type === 'buy-to-open' || tx.type === 'sell-to-open' ||
        tx.type === 'buy-to-close' || tx.type === 'sell-to-close') return 100;
    return 1;
  };
  const txUnrealizedPL = (tx) => {
    // Only OPEN entry-side transactions get unrealized P/L
    const isOpenEntry = (tx.type === 'buy' || tx.type === 'short' ||
                        tx.type === 'buy-to-open' || tx.type === 'sell-to-open');
    if (!isOpenEntry) return null;
    const livePrice = sbPriceFor(tx.ticker);
    if (!isFinite(livePrice) || !livePrice || !tx.price || !tx.qty) return null;
    const isShort = tx.type === 'short' || tx.type === 'sell-to-open';
    const direction = isShort ? -1 : 1;
    const mult = txMultiplier(tx);
    let pl = direction * (livePrice - tx.price) * tx.qty * mult - (tx.fee || 0);
    // SHORT negative carry: deduct the owed dividend, prorated from open date.
    if (isShort && tx.ts) {
      const notional = tx.price * tx.qty * mult;
      const days = Math.max(0, (Date.now() - new Date(tx.ts).getTime()) / 86400000);
      const carry = (typeof shortDividendCarry === 'function') ? shortDividendCarry(tx.ticker, notional, days) : 0;
      pl -= carry;
    }
    return pl;
  };

  // Sum unrealized P/L across all open trades for the summary stat
  let totalUnrealizedPL = 0;
  let openTradeCount = 0;
  for (const tx of transactions) {
    const u = txUnrealizedPL(tx);
    if (u != null) { totalUnrealizedPL += u; openTradeCount++; }
  }

  // Each row is now a "receipt" — for sells, it shows the full ledger with notes.
  // BUYs and SHORTs are compact; SELLs expand to show entry, sell, and notes.
  const txRowsHtml = transactions.slice().reverse().map(tx => {
    const ts = new Date(tx.ts).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const typeColor = tx.type === 'buy' ? 'var(--pos)'
                    : tx.type === 'short' ? 'var(--data-amber)'
                    : 'var(--neg)';
    const typeBg = tx.type === 'buy' ? 'rgba(91,138,114,0.15)'
                 : tx.type === 'short' ? 'rgba(196,150,90,0.15)'
                 : 'rgba(165,100,90,0.15)';
    let cashFlow = 0;
    if (tx.type === 'buy')   cashFlow = -((tx.cost) || (tx.qty * tx.price + (tx.fee || 0)));
    else if (tx.type === 'short') cashFlow = tx.qty * tx.price - (tx.fee || 0);
    else if (tx.type === 'sell')  cashFlow = tx.proceeds || (tx.qty * tx.price - (tx.fee || 0));
    else if (tx.type === 'deposit' || tx.type === 'withdrawal' || tx.type === 'adjustment') cashFlow = +tx.amount || 0;
    const cashColor = cashFlow >= 0 ? 'var(--pos)' : 'var(--neg)';
    const _rpl = (tx.realizedPL != null && isFinite(tx.realizedPL)) ? tx.realizedPL : (tx.type === 'sell' && tx.entryPrice != null && tx.qty ? (tx.price - tx.entryPrice) * tx.qty * txMultiplier(tx) - (tx.fee || 0) : null);
    const showPL = tx.type === 'sell' && _rpl != null;
    const plColor = (_rpl || 0) >= 0 ? 'var(--pos)' : 'var(--neg)';
    const plPct = tx.realizedPLPct != null ? tx.realizedPLPct
                : (tx.type === 'sell' && tx.entryPrice ? ((tx.price - tx.entryPrice) / tx.entryPrice) * 100 : null);

    // Unrealized P/L for OPEN entry-side transactions (paper P/L if you marked
    // to market right now). Skipped for sells/covers (those have realized P/L
    // already), and skipped if no live price is available.
    const unrealizedPL = txUnrealizedPL(tx);
    const showUPL = unrealizedPL != null;
    const uplColor = (unrealizedPL || 0) >= 0 ? 'var(--pos)' : 'var(--neg)';

    // For SELL transactions, build the expanded receipt with all details and the position's note history
    let receiptDetail = '';
    if (tx.type === 'sell') {
      const notesArr = tx.positionNotes || [];
      const notesHtml = notesArr.length > 0
        ? `<div style="margin-top:10px"><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">Position notes</div>${notesArr.map(n => `
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);padding:4px 0;border-bottom:1px dashed var(--rule)">
            <span style="color:var(--ink-faint)">${(n.ts || '').slice(0, 10)}</span>
            ${n.priceAtNote != null ? ` <span style="color:var(--ink-faint)">@ ${fmt$(n.priceAtNote)}</span>` : ''}
            <span style="margin-left:6px">${escapeHtml(n.text || '')}</span>
          </div>`).join('')}</div>`
        : '';
      receiptDetail = `
        <tr class="tx-receipt" data-tx="${tx.id}" style="display:none">
          <td colspan="10" style="padding:0;background:var(--bg-elev);border-bottom:2px solid var(--rule)">
            <div style="padding:14px 18px;font-family:var(--mono);font-size:11px;line-height:1.7">
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-bottom:10px">
                <div><span style="color:var(--ink-faint);font-size:9px;letter-spacing:0.08em">COST BASIS</span><br><strong style="color:var(--ink)">${fmt$(tx.entryPrice)}</strong></div>
                <div><span style="color:var(--ink-faint);font-size:9px;letter-spacing:0.08em">SELL PRICE</span><br><strong style="color:var(--ink)">${fmt$(tx.price)}</strong></div>
                <div><span style="color:var(--ink-faint);font-size:9px;letter-spacing:0.08em">PROFIT / LOSS</span><br><strong style="color:${plColor}">${(_rpl || 0) >= 0 ? '+' : ''}${fmt$(_rpl || 0)}${plPct != null ? ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%)` : ''}</strong></div>
                <div><span style="color:var(--ink-faint);font-size:9px;letter-spacing:0.08em">DATE PURCHASED</span><br><strong style="color:var(--ink-dim)">${tx.entryDate?.slice(0, 10) || '—'}</strong></div>
                <div><span style="color:var(--ink-faint);font-size:9px;letter-spacing:0.08em">DATE SOLD</span><br><strong style="color:var(--ink-dim)">${(tx.soldDate || tx.ts).slice(0, 10)}</strong></div>
              </div>
              ${tx.notes ? `<div style="margin-top:6px;padding:8px 10px;background:rgba(212,162,76,0.08);border-left:2px solid var(--amber);color:var(--ink-dim);font-style:italic">"${escapeHtml(tx.notes)}"</div>` : ''}
              ${notesHtml}
            </div>
          </td>
        </tr>
      `;
    }

    return `
      <tr class="tx-row ${tx.type === 'sell' ? 'tx-expandable' : ''}" data-tx="${tx.id}" ${tx.type === 'sell' ? 'style="cursor:pointer"' : ''}>
        <td style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);white-space:nowrap">${ts}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:2px;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:0.1em;color:${typeColor};background:${typeBg}">${tx.type.toUpperCase()}</span></td>
        <td class="sb-tic">${tx.ticker}</td>
        <td style="font-family:var(--mono);font-size:11px">${tx.qty}</td>
        <td style="font-family:var(--mono);font-size:11px">${fmt$(tx.price || 0)}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--ink-dim)">${tx.fee ? fmt$(tx.fee) : '—'}</td>
        <td style="font-family:var(--mono);font-size:11px;color:${cashColor};font-weight:600">${cashFlow >= 0 ? '+' : ''}${fmt$(cashFlow)}</td>
        <td style="font-family:var(--mono);font-size:11px;color:${showPL ? plColor : 'var(--ink-faint)'};font-weight:${showPL ? '600' : '400'}">${showPL ? ((_rpl || 0) >= 0 ? '+' : '') + fmt$(_rpl || 0) : '—'}</td>
        <td style="font-family:var(--mono);font-size:11px;color:${showUPL ? uplColor : 'var(--ink-faint)'};font-weight:${showUPL ? '600' : '400'}" title="${showUPL ? `Mark-to-market vs entry @ ${fmt$(tx.price)} · live ${fmt$(sbPriceFor(tx.ticker))}${txMultiplier(tx) > 1 ? ` · ${txMultiplier(tx)}× contract` : ''}` : 'No live price · or position already closed'}">${showUPL ? ((unrealizedPL || 0) >= 0 ? '+' : '') + fmt$(unrealizedPL) : '—'}</td>
        <td style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">${tx.entryPrice != null && tx.type === 'sell' ? fmt$(tx.entryPrice) + ' @ ' + (tx.entryDate?.slice(0,10) || '—') : '—'}</td>
      </tr>
      ${receiptDetail}
    `;
  }).join('');

  content.innerHTML = summary + subTabs + `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;margin-bottom:20px">
      <div class="portfolio-stat" style="border-left:3px solid var(--amber)">
        <div class="portfolio-stat-label">Cash Position</div>
        <div style="display:flex;align-items:baseline;gap:8px">
          <div class="portfolio-stat-value" style="color:var(--amber)">${fmt$(cash)}</div>
          <button class="sb-icon-btn" id="edit-cash-btn" title="Manually edit cash balance">Edit</button>
        </div>
        <div class="portfolio-stat-sub">running balance of all transactions</div>
      </div>
      <div class="portfolio-stat" title="Sum of all cash deltas across every transaction. Shorts ADD to this number because broker credits proceeds — but those proceeds are pledged collateral, not free profit. Look at Realized P/L for actual gains.">
        <div class="portfolio-stat-label">Total Cash Flow</div>
        <div class="portfolio-stat-value" style="color:${totalCashFlow >= 0 ? 'var(--pos)' : 'var(--neg)'}">${totalCashFlow >= 0 ? '+' : ''}${fmt$(totalCashFlow)}</div>
        <div class="portfolio-stat-sub">net in/out across ${transactions.length} transaction${transactions.length === 1 ? '' : 's'}${(() => {
          const shortProceeds = transactions.filter(t => t.type === 'short').reduce((s, t) => s + (t.qty * t.price - (t.fee || 0)), 0);
          return shortProceeds > 0 ? ` · <span style="color:#a85a3a">incl. ${fmt$(shortProceeds)} short collateral</span>` : '';
        })()}</div>
      </div>
      <div class="portfolio-stat">
        <div class="portfolio-stat-label">Realized P/L</div>
        <div class="portfolio-stat-value" style="color:${totalRealizedPL >= 0 ? 'var(--pos)' : 'var(--neg)'}">${totalRealizedPL >= 0 ? '+' : ''}${fmt$(totalRealizedPL)}</div>
        <div class="portfolio-stat-sub" style="color:${totalRealizedPLPct >= 0 ? 'var(--pos)' : 'var(--neg)'}">${totalRealizedPLPct >= 0 ? '+' : ''}${totalRealizedPLPct.toFixed(2)}% on ${transactions.filter(t => t.type === 'sell').length} sell${transactions.filter(t => t.type === 'sell').length === 1 ? '' : 's'}</div>
      </div>
      <div class="portfolio-stat" title="Paper P/L if you marked every open position to market right now. Excludes already-closed trades.">
        <div class="portfolio-stat-label">Unrealized P/L</div>
        <div class="portfolio-stat-value" style="color:${totalUnrealizedPL >= 0 ? 'var(--pos)' : 'var(--neg)'}">${openTradeCount === 0 ? '—' : (totalUnrealizedPL >= 0 ? '+' : '') + fmt$(totalUnrealizedPL)}</div>
        <div class="portfolio-stat-sub">${openTradeCount === 0 ? 'no open trades' : `mark-to-market across ${openTradeCount} open ${openTradeCount === 1 ? 'trade' : 'trades'}`}</div>
      </div>
      <div class="portfolio-stat">
        <div class="portfolio-stat-label">Total Broker Fees</div>
        <div class="portfolio-stat-value" style="color:var(--ink-dim)">${fmt$(totalFees)}</div>
      </div>
    </div>
    <div style="padding:10px 14px;background:var(--bg-elev);font-family:var(--mono);font-size:10px;color:var(--ink-faint);line-height:1.7;border-left:2px solid var(--amber);margin-bottom:14px">
      Immutable transaction ledger — no edits or deletions allowed (a proven error is VOIDED, never deleted — see the ledger check below). <strong style="color:var(--ink-dim)">Click any SELL row to expand the full receipt</strong> with cost basis, dates, P/L, and notes. <strong style="color:var(--ink-dim)">Unrealized P/L</strong> shows mark-to-market on open BUY/SHORT/BUY-TO-OPEN/SELL-TO-OPEN rows using the latest live price.
    </div>
    ${(typeof _ledgerCheckBannerHtml === 'function') ? _ledgerCheckBannerHtml() : ''}
    ${(typeof _cashReconHtml === 'function') ? _cashReconHtml() : ''}
    <div class="sb-table-wrap">
      <table class="sb-table portfolio-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Type</th>
            <th>Ticker</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Fee</th>
            <th>Cash Flow</th>
            <th>Realized P/L</th>
            <th title="Mark-to-market against live price for open entry-side trades">Unrealized P/L</th>
            <th>Original Entry</th>
          </tr>
        </thead>
        <tbody>${txRowsHtml || '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--ink-faint);font-style:italic">No transactions yet · add a position or sell one to create the first record</td></tr>'}</tbody>
      </table>
    </div>
  `;

  // Wire sub-tabs
  document.querySelectorAll('.portfolio-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.portfolioSubTab = btn.dataset.sub;
      renderStockBookPortfolio(content);
    });
  });

  // Wire "Edit cash" button — opens a small inline prompt to manually adjust balance
  const editCashBtn = document.getElementById('edit-cash-btn');
  if (editCashBtn) {
    editCashBtn.addEventListener('click', async () => {
      const current = getCashPosition();
      // Two modes: ADD (logged as a deposit/withdrawal the backend understands)
      // or SET (silent reconcile to a brokerage statement). Default to ADD since
      // that's the common "feed the portfolio more cash" case and it's recorded.
      const choice = await appPrompt(
        'Cash: $' + current.toFixed(2) + '\n\n' +
        'Type an AMOUNT TO ADD (e.g. 10000, or -5000 to withdraw) — this is logged\n' +
        'as a capital deposit the backend tracks (raises buying power, not a gain).\n\n' +
        'OR type "set 12345" to overwrite the balance for a brokerage reconcile\n' +
        '(no deposit logged).', '10000');
      if (choice == null) return;
      const trimmed = choice.trim();
      const setMatch = /^set\s+(-?[\d,.]+)/i.exec(trimmed);
      if (setMatch) {
        const v = parseFloat(setMatch[1].replace(/[,$\s]/g, ''));
        if (!isFinite(v)) { appAlert('Not a valid number'); return; }
        setCashPosition(v);
        flashStatus(`Cash reconciled to ${fmt$(v)} (no deposit logged)`, 'success');
        renderStockBookPortfolio(content);
        return;
      }
      const amt = parseFloat(trimmed.replace(/[,$\s]/g, ''));
      if (!isFinite(amt) || amt === 0) { appAlert('Enter an amount to add (e.g. 10000), or "set 12345" to reconcile.'); return; }
      if (typeof addCashToPortfolio === 'function') addCashToPortfolio(amt);
      renderStockBookPortfolio(content);
    });
  }

  // Wire SELL row expansion — clicking the row toggles the receipt detail row
  document.querySelectorAll('.tx-expandable').forEach(row => {
    row.addEventListener('click', () => {
      const txId = row.dataset.tx;
      const receipt = document.querySelector(`.tx-receipt[data-tx="${txId}"]`);
      if (receipt) {
        receipt.style.display = receipt.style.display === 'none' ? 'table-row' : 'none';
      }
    });
  });
}

function openSellModal(entryId) {
  const entry = findPortfolioEntry(entryId);
  if (!entry) return;
  // Default sell price = current live price from stockbook
  const sbRows = state.stockbook?.rows || [];
  const sbRow = sbRows.find(r => r.ticker === entry.ticker);
  const defaultPrice = sbRow?.price ?? entry.costBasis ?? '';
  const maxQty = entry.qty || 0;

  const html = `
    <div class="modal-backdrop" id="portfolio-sell-modal" style="display:flex" onclick="if(event.target.id==='portfolio-sell-modal')this.remove()">
      <div class="modal-box" style="max-width:440px">
        <div class="modal-head">
          <div class="modal-title">Sell · ${entry.ticker}</div>
          <button class="modal-close" onclick="document.getElementById('portfolio-sell-modal').remove()">×</button>
        </div>
        <div class="modal-section" style="padding:10px 14px;background:var(--bg-elev);font-family:var(--mono);font-size:10px;color:var(--ink-faint);line-height:1.7;border-left:2px solid var(--amber)">
          Entry: <strong style="color:var(--ink-dim)">${maxQty} @ ${fmt$(entry.costBasis)}</strong> on <strong style="color:var(--ink-dim)">${entry.addedAt?.slice(0,10) || '—'}</strong>
        </div>
        <div class="modal-section">
          <div class="modal-label">Sell Quantity</div>
          <input type="number" class="modal-input" id="sell-qty" step="any" min="0" max="${maxQty}" value="${maxQty}" placeholder="${maxQty}">
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:4px">Max: ${maxQty}. Partial sells supported — remaining qty stays in the position.</div>
        </div>
        <div class="modal-section">
          <div class="modal-label">Sell Price (per share)</div>
          <input type="number" class="modal-input" id="sell-price" step="0.01" value="${defaultPrice}" placeholder="0.00">
        </div>
        <div class="modal-section">
          <div class="modal-label">Broker Fee</div>
          <input type="number" class="modal-input" id="sell-fee" step="0.01" value="0" placeholder="0.00">
        </div>
        <div class="modal-section">
          <div class="modal-label">Note (recommended)</div>
          <textarea class="modal-input" id="sell-note" rows="2" placeholder="Why you sold (e.g. took profit, stop loss, thesis broken, rebalance)"></textarea>
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:4px">Saved to ${entry.ticker}'s notes history and to this transaction's record</div>
        </div>
        <div class="modal-section" id="sell-preview" style="background:var(--bg-elev);padding:14px;font-family:var(--mono);font-size:11px;line-height:1.7">
          <!-- live-computed preview here -->
        </div>
        <div class="modal-section" style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--rule);padding-top:14px">
          <button class="btn btn-ghost" onclick="document.getElementById('portfolio-sell-modal').remove()">Cancel</button>
          <button class="btn" id="sell-confirm">Confirm Sale</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const updatePreview = () => {
    const qty = parseFloat(document.getElementById('sell-qty').value) || 0;
    const price = parseFloat(document.getElementById('sell-price').value) || 0;
    const fee = parseFloat(document.getElementById('sell-fee').value) || 0;
    const proceeds = qty * price - fee;
    const grossPL = (price - (entry.costBasis || 0)) * qty - fee;
    const plPct = entry.costBasis ? ((price - entry.costBasis) / entry.costBasis) * 100 : 0;
    const plColor = grossPL >= 0 ? 'var(--pos)' : 'var(--neg)';
    document.getElementById('sell-preview').innerHTML = `
      <div>Gross proceeds: <strong>${fmt$(qty * price)}</strong></div>
      <div>Less broker fee: −${fmt$(fee)}</div>
      <div style="border-top:1px solid var(--rule);margin-top:6px;padding-top:6px">
        Net to cash: <strong style="color:var(--amber)">${fmt$(proceeds)}</strong>
      </div>
      <div style="margin-top:6px;color:${plColor}">
        Realized P/L: <strong>${grossPL >= 0 ? '+' : ''}${fmt$(grossPL)}</strong>
        (${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%)
      </div>
    `;
  };
  ['sell-qty', 'sell-price', 'sell-fee'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePreview);
  });
  updatePreview();

  document.getElementById('sell-confirm').addEventListener('click', async () => {
    const qty = parseFloat(document.getElementById('sell-qty').value) || 0;
    const price = parseFloat(document.getElementById('sell-price').value) || 0;
    const fee = parseFloat(document.getElementById('sell-fee').value) || 0;
    if (qty <= 0 || qty > maxQty + 0.0001) {
      await appAlert(`Quantity must be between 0 and ${maxQty}`, { title: 'Invalid quantity' });
      return;
    }
    // GUARD: never sell more than is actually HELD across all lots of this
    // ticker (long positions). Selling more than you own would only be valid as
    // a short, which is a different trade style entered explicitly — not here.
    try {
      const heldSameTicker = loadPortfolio()
        .filter(p => (p.ticker || '').toUpperCase() === (entry.ticker || '').toUpperCase() && ACTIVE_POSITIONS.includes(p.position) && (p.position || '').toLowerCase() !== 'short')
        .reduce((s, p) => s + (+p.qty || 0), 0);
      if (qty > heldSameTicker + 0.0001) {
        await appAlert(`You only hold ${heldSameTicker} shares of ${entry.ticker}. Can't sell ${qty}.\n\n(Selling more than you own would be a short — open that as a separate short position instead.)`, { title: 'Not enough shares' });
        return;
      }
      // z88: the TRANSACTION LEDGER is the book of record. If it tracks this
      // ticker (first trade is a buy) and shows fewer shares than this sale,
      // the position on screen is stale (e.g. restored from an old copy).
      const L = ledgerPositionForTicker(entry.ticker, loadTransactions());
      if (L.tracked && qty > L.held + 0.0001) {
        await appAlert(`The transaction ledger shows ${L.held} ${entry.ticker} shares held (bought ${L.bought}, sold ${L.sold}). Can't sell ${qty}.\n\nThis position looks restored from an old copy — remove it instead of selling.`, { title: 'Not enough shares in the ledger' });
        return;
      }
    } catch {}
    if (price <= 0) {
      await appAlert('Sell price must be > 0', { title: 'Invalid price' });
      return;
    }
    // The broker fee comes straight from the Broker Fee field above — no second
    // prompt (the field already captures it before the sale).
    const useFee = isFinite(fee) ? fee : 0;
    // Guard against a double-fire: disable the button immediately.
    const confirmBtn = document.getElementById('sell-confirm');
    if (confirmBtn) { if (confirmBtn.disabled) return; confirmBtn.disabled = true; confirmBtn.textContent = 'Selling…'; }
    _executeSale(qty, price, useFee);
  });

  // The actual sale execution, factored out so the fee-confirm step calls it once.
  function _executeSale(qty, price, fee) {
    const proceeds = qty * price - fee;
    const realizedPL = (price - (entry.costBasis || 0)) * qty - fee;
    const realizedPLPct = entry.costBasis ? ((price - entry.costBasis) / entry.costBasis) * 100 : 0;
    const noteText = (document.getElementById('sell-note')?.value || '').trim();
    const soldAt = new Date().toISOString();
    const todayStr = soldAt.slice(0, 10);
    const autoNote = `Sold ${qty} @ ${fmt$(price)} on ${todayStr}${noteText ? ` · ${noteText}` : ''}`;
    const existing = findPortfolioEntry(entry.id);
    if (existing) {
      const updatedNotes = [
        ...(existing.notes || []),
        { ts: soldAt, text: autoNote, priceAtNote: price, soldAction: true },
      ];
      updatePortfolioEntry(entry.id, { notes: updatedNotes });
    }
    appendTransaction({
      type: 'sell',
      ticker: entry.ticker,
      qty,
      price,
      fee,
      proceeds,
      realizedPL,
      realizedPLPct,
      entryId: entry.id,
      entryDate: entry.addedAt,
      entryPrice: entry.costBasis,
      soldDate: soldAt,
      notes: noteText || null,
      positionNotes: existing?.notes || [],
    });
    addToCashPosition(proceeds);
    const remainingQty = maxQty - qty;
    if (remainingQty > 0.0001) {
      updatePortfolioEntry(entry.id, { qty: remainingQty });
    } else {
      // z88: the sale above already booked the proceeds. Without noCashReturn the
      // removal credited the position's market value to cash A SECOND TIME and
      // logged a second SELL (the doubled SNK sale of 2026-06-22).
      removeFromPortfolio(entry.id, { noCashReturn: true, reason: 'sold' });
    }
    const modal = document.getElementById('portfolio-sell-modal');
    if (modal) modal.remove();
    flashStatus(`Sold ${qty} ${entry.ticker} @ ${fmt$(price)} · +${fmt$(proceeds)} to cash (fee ${fmt$(fee)})`, 'success');
    renderStockBook();
  }
}

function openEditPositionModal(entryId) {
  const e = findPortfolioEntry(entryId);
  if (!e) return;
  const ticker = e.ticker;
  const isActive = ACTIVE_POSITIONS.includes(e.position);
  const html = `
    <div class="modal-backdrop" id="portfolio-edit-modal" style="display:flex" onclick="if(event.target.id==='portfolio-edit-modal')this.remove()">
      <div class="modal-box" style="max-width:420px">
        <div class="modal-head">
          <div class="modal-title">Edit Position · ${ticker}</div>
          <button class="modal-close" onclick="document.getElementById('portfolio-edit-modal').remove()">×</button>
        </div>
        <div class="modal-section" style="padding:10px 14px;background:var(--bg-elev);font-family:var(--mono);font-size:10px;color:var(--ink-faint);line-height:1.7;border-left:2px solid var(--rule)">
          Entry price <strong style="color:var(--ink-dim)">${fmt$(e.costBasis)}</strong> and entry date <strong style="color:var(--ink-dim)">${e.addedAt ? new Date(e.addedAt).toISOString().slice(0, 10) : '—'}</strong> are locked. To change them, remove and re-add the position.
        </div>
        <div class="modal-section" style="opacity:${isActive ? 1 : 0.4}">
          <div class="modal-label">Quantity</div>
          <input type="number" class="modal-input" id="port-edit-qty" step="any" value="${e.qty || ''}" placeholder="—" ${!isActive ? 'disabled' : ''}>
          ${!isActive ? '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:6px">Only editable for active positions (Trading/Long/Short)</div>' : ''}
        </div>
        <div class="modal-section">
          <div class="modal-label">Broker Fees</div>
          <input type="number" class="modal-input" id="port-edit-fees" step="0.01" value="${e.fees || ''}" placeholder="1.37">
        </div>
        <div class="modal-section">
          <div class="modal-label">Conviction <span id="port-edit-conviction-val" style="color:var(--amber);font-family:var(--mono)">${e.conviction != null ? e.conviction : 50}</span><span style="color:var(--ink-faint);font-family:var(--mono);font-size:10px">/100</span></div>
          <input type="range" id="port-edit-conviction" min="0" max="100" step="1" value="${e.conviction != null ? e.conviction : 50}" style="width:100%;accent-color:var(--amber)">
          <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:2px"><span>spec</span><span>neutral</span><span>high conviction</span></div>
          <input type="text" class="modal-input" id="port-edit-thesis" value="${(e.thesis || '').replace(/"/g, '&quot;')}" placeholder="one-line thesis (optional)" style="margin-top:8px;font-size:11px">
        </div>
        <div class="modal-section" style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--rule);padding-top:14px">
          <button class="btn btn-ghost" onclick="document.getElementById('portfolio-edit-modal').remove()">Cancel</button>
          <button class="btn" id="port-edit-save">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  // Live conviction readout.
  const convEl = document.getElementById('port-edit-conviction');
  const convValEl = document.getElementById('port-edit-conviction-val');
  if (convEl && convValEl) convEl.addEventListener('input', () => { convValEl.textContent = convEl.value; });
  document.getElementById('port-edit-save').addEventListener('click', () => {
    const patch = {};
    if (isActive) {
      const q = parseFloat(document.getElementById('port-edit-qty').value);
      patch.qty = isFinite(q) ? q : null;
    }
    const f = parseFloat(document.getElementById('port-edit-fees').value);
    patch.fees = isFinite(f) ? f : 0;
    // Conviction slider (0-100) + optional thesis.
    const conv = parseInt(document.getElementById('port-edit-conviction')?.value, 10);
    if (isFinite(conv)) patch.conviction = conv;
    const thesis = document.getElementById('port-edit-thesis')?.value.trim();
    patch.thesis = thesis || '';
    updatePortfolioEntry(entryId, patch);
    // Upsert this edited position to the portfolio Supabase immediately (the
    // "sync on demand / instantly" the user asked for — no manual step).
    try {
      if (typeof portSupabaseUpsert === 'function' && typeof portSupabaseConfigured === 'function' && portSupabaseConfigured()) {
        const updated = Object.assign({}, e, patch);
        portSupabaseUpsert(updated);
      }
    } catch {}
    document.getElementById('portfolio-edit-modal').remove();
    flashStatus(`${ticker} updated`, 'success');
    renderStockBook();
  });
}

function openNotesModal(ticker) {
  const arr = loadPortfolio();
  const entry = arr.find(e => e.ticker === ticker);
  if (!entry) return;
  if (!Array.isArray(entry.notes)) entry.notes = [];

  // Remove any prior modal
  document.getElementById('notes-modal')?.remove();

  const fmtTs = (ts, backdated) => {
    try {
      const d = new Date(ts);
      // Backdated notes (entered at position-add with past date) show date only
      if (backdated) return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return ts; }
  };

  const sbRow = getStockbookRow(ticker);
  const company = sbRow?.name || ticker;

  const renderNotesList = () => {
    const list = document.getElementById('notes-list');
    if (!list) return;
    if (entry.notes.length === 0) {
      list.innerHTML = `<div style="color:var(--ink-faint);font-style:italic;text-align:center;padding:24px">No notes yet</div>`;
      return;
    }
    // Newest first
    const sorted = [...entry.notes].sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    list.innerHTML = sorted.map((n, i) => {
      const realIdx = entry.notes.indexOf(n);
      return `
        <div class="note-entry">
          <div class="note-meta">
            <span class="note-ts">${fmtTs(n.ts, n.backdated)}</span>
            ${n.priceAtNote != null ? `<span class="note-price">@ ${fmt$(n.priceAtNote)}</span>` : ''}
            <button class="note-delete" data-note-idx="${realIdx}" title="Delete this note">×</button>
          </div>
          <div class="note-text">${escapeHtml(n.text)}</div>
        </div>
      `;
    }).join('');
    // Wire delete buttons
    list.querySelectorAll('.note-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await appConfirm('Delete this note?')) return;
        const idx = parseInt(btn.dataset.noteIdx);
        entry.notes.splice(idx, 1);
        savePortfolio(arr);
        renderNotesList();
        renderStockBook();
      });
    });
  };

  const html = `
    <div class="modal-backdrop" id="notes-modal" style="display:flex;z-index:9999">
      <div class="modal-box" style="max-width:680px;max-height:85vh;display:flex;flex-direction:column">
        <div class="modal-head">
          <div class="modal-title">${ticker} — Notes <span style="color:var(--ink-faint);font-weight:400">· ${escapeHtml(company)}</span></div>
          <button class="modal-close" onclick="document.getElementById('notes-modal').remove()">×</button>
        </div>
        <div class="modal-section" style="flex-shrink:0">
          <div class="modal-label">New Note</div>
          <textarea id="note-input" class="modal-input" rows="3" style="resize:vertical;min-height:70px" placeholder="Thesis, entry reason, target, news, sentiment shift, stop loss…"></textarea>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
            <label style="font-family:var(--mono);font-size:11px;color:var(--ink-dim);display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="note-include-price" checked> Stamp current price
            </label>
            <span style="flex:1"></span>
            <button class="btn btn-ghost" onclick="document.getElementById('notes-modal').remove()">Close</button>
            <button class="btn" id="note-save-btn">+ Add Note</button>
          </div>
        </div>
        <div class="modal-section" style="flex:1;overflow-y:auto;border-top:1px solid var(--rule)">
          <div class="modal-label">All Notes <span style="color:var(--ink-faint);font-weight:400;text-transform:none;letter-spacing:0">(newest first)</span></div>
          <div id="notes-list"></div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  renderNotesList();

  // Auto-focus the input
  setTimeout(() => document.getElementById('note-input')?.focus(), 50);

  document.getElementById('note-save-btn').addEventListener('click', () => {
    const input = document.getElementById('note-input');
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const includePrice = document.getElementById('note-include-price').checked;
    const livePrice = sbRow?.price ?? sbRow?.fmpPrice ?? null;
    entry.notes.push({
      ts: new Date().toISOString(),
      text,
      priceAtNote: includePrice && livePrice != null ? livePrice : null,
    });
    savePortfolio(arr);
    input.value = '';
    renderNotesList();
    renderStockBook();
  });

  // Ctrl/Cmd + Enter to save
  document.getElementById('note-input').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('note-save-btn').click();
    }
  });
}
