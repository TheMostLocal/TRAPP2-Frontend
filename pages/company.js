/* ==========================================================================
   pages/company.js — z160 (Phase 3). Moved verbatim from app.js; loaded the first time the page opens
   (app.js keeps a stub for renderCompanyOverview, renderFinancials that loads this file, then calls the real function).
   Every function here is used only by this page (checked against app.js, every other script and index.html).
   ========================================================================== */
function renderFinancials() {
  const el = document.getElementById('financials-content');
  if (!el || !state.financials.data) return;

  const view = state.financials.view || 'overview';
  // Toggle the statement-picker control visibility based on view
  const stmtCtrl = document.getElementById('fin-statement-control');
  if (stmtCtrl) stmtCtrl.style.display = view === 'statements' ? '' : 'none';

  if (view === 'overview') {
    renderFinancialsOverview(el, state.financials.data, state.stock);
    return;
  }
  // 'statements' view — original income/balance/cashflow tables
  const stmt = state.financials.statement;
  const data = state.financials.data;
  let rows, table;
  if (stmt === 'income') {
    rows = data.income;
    table = renderIncomeStatement(rows);
  } else if (stmt === 'balance') {
    rows = data.balance;
    table = renderBalanceSheet(rows);
  } else {
    rows = data.cashflow;
    table = renderCashFlow(rows);
  }
  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="empty" style="padding:40px;text-align:center;color:var(--ink-dim)">No ${stmt} data available.</div>`;
    return;
  }
  const periodLabel = state.financials.period === 'annual' ? 'Annual' : 'Quarterly';
  el.innerHTML = `
    ${table}
    <div class="financials-meta">
      ${periodLabel} · ${rows.length} periods · Source: Financial Modeling Prep · Reported in millions unless noted
    </div>
  `;
}

function computeFinancialRatios(income, balance, cashflow, currentPrice, marketCap) {
  if (!income?.length || !balance?.length) return null;
  // Statements are sorted newest first by FMP; use newest as "current"
  const ic = income[0]   || {};
  const bc = balance[0]  || {};
  const cc = cashflow?.[0] || {};
  const safe = (v) => (v == null || !isFinite(v)) ? null : v;
  const ratio = (a, b) => (b && isFinite(b) && b !== 0) ? a / b : null;

  // Build per-period rows so we can sparkline trends
  const periodMap = {};
  for (const r of (income || []))    periodMap[r.date] = { ...(periodMap[r.date]   || {}), date: r.date, ...r };
  for (const r of (balance || []))   periodMap[r.date] = { ...(periodMap[r.date]   || {}), date: r.date, ...r };
  for (const r of (cashflow || []))  periodMap[r.date] = { ...(periodMap[r.date]   || {}), date: r.date, ...r };
  const periods = Object.values(periodMap).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Build a sparkline series for a derived metric. Accepts a function that
  // computes the metric from a single period row.
  const series = (computeFn) => periods.map(p => {
    const v = computeFn(p);
    return { date: p.date, value: (v == null || !isFinite(v)) ? null : v };
  }).filter(s => s.value != null);

  // === Define metrics ===
  // Each metric: { value, history[], formula, description, gradeFn, format }
  const metrics = {};

  // ---- LIQUIDITY ----
  metrics.currentRatio = {
    label: 'Current Ratio',
    group: 'Liquidity',
    formula: 'Current Assets / Current Liabilities',
    description: 'Measures short-term liquidity. Above 1.5 = healthy. Below 1.0 = potential liquidity risk.',
    value: ratio(safe(bc.totalCurrentAssets), safe(bc.totalCurrentLiabilities)),
    history: series(p => ratio(p.totalCurrentAssets, p.totalCurrentLiabilities)),
    format: v => v?.toFixed(2),
    gradeFn: v => v == null ? null : v > 2 ? 'strong' : v > 1.5 ? 'good' : v > 1 ? 'neutral' : v > 0.5 ? 'weak' : 'poor',
  };
  metrics.quickRatio = {
    label: 'Quick Ratio',
    group: 'Liquidity',
    formula: '(Current Assets − Inventory) / Current Liabilities',
    description: 'Like current ratio but excludes inventory. The most conservative liquidity test. Above 1.0 is healthy.',
    value: ratio(safe(bc.totalCurrentAssets) - safe(bc.inventory ?? 0), safe(bc.totalCurrentLiabilities)),
    history: series(p => ratio((p.totalCurrentAssets || 0) - (p.inventory || 0), p.totalCurrentLiabilities)),
    format: v => v?.toFixed(2),
    gradeFn: v => v == null ? null : v > 1.5 ? 'strong' : v > 1 ? 'good' : v > 0.7 ? 'neutral' : v > 0.4 ? 'weak' : 'poor',
  };
  metrics.cashRatio = {
    label: 'Cash Ratio',
    group: 'Liquidity',
    formula: 'Cash & Equivalents / Current Liabilities',
    description: 'Strictest liquidity measure. How well current liabilities are covered by cash alone.',
    value: ratio(safe(bc.cashAndCashEquivalents), safe(bc.totalCurrentLiabilities)),
    history: series(p => ratio(p.cashAndCashEquivalents, p.totalCurrentLiabilities)),
    format: v => v?.toFixed(2),
    gradeFn: v => v == null ? null : v > 1 ? 'strong' : v > 0.5 ? 'good' : v > 0.2 ? 'neutral' : v > 0.1 ? 'weak' : 'poor',
  };

  // ---- LEVERAGE ----
  metrics.debtToEquity = {
    label: 'Debt / Equity',
    group: 'Leverage',
    formula: 'Total Debt / Total Equity',
    description: 'How much debt is used to finance the company relative to shareholder equity. Lower = lower financial risk.',
    value: ratio(safe(bc.totalDebt), safe(bc.totalStockholdersEquity)),
    history: series(p => ratio(p.totalDebt, p.totalStockholdersEquity)),
    format: v => v?.toFixed(2),
    gradeFn: v => v == null ? null : v < 0.3 ? 'strong' : v < 1 ? 'good' : v < 2 ? 'neutral' : v < 3 ? 'weak' : 'poor',
  };
  metrics.debtRatio = {
    label: 'Debt Ratio',
    group: 'Leverage',
    formula: 'Total Debt / Total Assets',
    description: 'Fraction of assets financed by debt. Lower = more solvent. Above 0.6 typically signals significant leverage.',
    value: ratio(safe(bc.totalDebt), safe(bc.totalAssets)),
    history: series(p => ratio(p.totalDebt, p.totalAssets)),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v < 0.2 ? 'strong' : v < 0.4 ? 'good' : v < 0.6 ? 'neutral' : v < 0.8 ? 'weak' : 'poor',
  };
  metrics.interestCoverage = {
    label: 'Interest Coverage',
    group: 'Leverage',
    formula: 'EBIT / Interest Expense',
    description: 'How many times operating income covers interest payments. Above 5 = strong. Below 1.5 = at risk.',
    value: ratio(safe(ic.operatingIncome), safe(ic.interestExpense)),
    history: series(p => ratio(p.operatingIncome, p.interestExpense)),
    format: v => v == null ? null : v.toFixed(1) + 'x',
    gradeFn: v => v == null ? null : v > 8 ? 'strong' : v > 5 ? 'good' : v > 2.5 ? 'neutral' : v > 1.5 ? 'weak' : 'poor',
  };

  // ---- PROFITABILITY ----
  metrics.grossMargin = {
    label: 'Gross Margin',
    group: 'Profitability',
    formula: '(Revenue − Cost of Goods Sold) / Revenue',
    description: 'Pricing power and production efficiency. Software typically >70%, retail 20-40%, commodities <20%.',
    value: ratio(safe(ic.grossProfit), safe(ic.revenue)),
    history: series(p => ratio(p.grossProfit, p.revenue)),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.6 ? 'strong' : v > 0.4 ? 'good' : v > 0.25 ? 'neutral' : v > 0.10 ? 'weak' : 'poor',
  };
  metrics.operatingMargin = {
    label: 'Operating Margin',
    group: 'Profitability',
    formula: 'Operating Income / Revenue',
    description: 'Core business profitability after operating costs but before interest and taxes.',
    value: ratio(safe(ic.operatingIncome), safe(ic.revenue)),
    history: series(p => ratio(p.operatingIncome, p.revenue)),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.25 ? 'strong' : v > 0.15 ? 'good' : v > 0.05 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };
  metrics.netMargin = {
    label: 'Net Margin',
    group: 'Profitability',
    formula: 'Net Income / Revenue',
    description: 'Bottom-line profitability — what falls to shareholders after every cost. Above 20% is excellent.',
    value: ratio(safe(ic.netIncome), safe(ic.revenue)),
    history: series(p => ratio(p.netIncome, p.revenue)),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.20 ? 'strong' : v > 0.10 ? 'good' : v > 0.05 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };
  metrics.roa = {
    label: 'Return on Assets',
    group: 'Profitability',
    formula: 'Net Income / Total Assets',
    description: 'How efficiently total assets are converted to profit. Asset-light businesses score higher.',
    value: ratio(safe(ic.netIncome), safe(bc.totalAssets)),
    history: series(p => ratio(p.netIncome, p.totalAssets)),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.15 ? 'strong' : v > 0.08 ? 'good' : v > 0.04 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };
  metrics.roe = {
    label: 'Return on Equity',
    group: 'Profitability',
    formula: 'Net Income / Shareholders Equity',
    description: 'Profit generated per dollar of shareholder equity. Buffett favorite — above 15% sustained is excellent.',
    value: ratio(safe(ic.netIncome), safe(bc.totalStockholdersEquity)),
    history: series(p => ratio(p.netIncome, p.totalStockholdersEquity)),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.20 ? 'strong' : v > 0.12 ? 'good' : v > 0.06 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };
  metrics.rotce = {
    label: 'Return on Tangible Common Equity',
    group: 'Profitability',
    formula: 'Net Income / (Equity − Goodwill − Intangibles)',
    description: 'Return on the hard capital actually in the business, stripping out acquisition goodwill and intangibles. More demanding than ROE — the gold standard for capital-allocation quality, especially for banks and acquisitive companies. Above 20% sustained signals a durable advantage.',
    value: (() => {
      const eq = safe(bc.totalStockholdersEquity);
      const ni = safe(ic.netIncome);
      if (eq == null || ni == null) return null;
      const tangible = eq - (safe(bc.goodwill) || 0) - (safe(bc.intangibleAssets) || 0);
      return tangible > 0 ? ni / tangible : null;
    })(),
    history: series(p => {
      const tangible = (p.totalStockholdersEquity || 0) - (p.goodwill || 0) - (p.intangibleAssets || 0);
      return tangible > 0 ? ratio(p.netIncome, tangible) : null;
    }),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.20 ? 'strong' : v > 0.12 ? 'good' : v > 0.06 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };
  metrics.roic = {
    label: 'Return on Invested Capital',
    group: 'Profitability',
    formula: 'NOPAT / (Debt + Equity)',
    description: 'True economic return on all capital employed. Above the cost of capital = value creation.',
    value: ratio(safe(ic.operatingIncome) * (1 - 0.21), safe(bc.totalDebt) + safe(bc.totalStockholdersEquity)),
    history: series(p => ratio((p.operatingIncome || 0) * 0.79, (p.totalDebt || 0) + (p.totalStockholdersEquity || 0))),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.15 ? 'strong' : v > 0.10 ? 'good' : v > 0.05 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };

  // ---- EFFICIENCY ----
  metrics.assetTurnover = {
    label: 'Asset Turnover',
    group: 'Efficiency',
    formula: 'Revenue / Total Assets',
    description: 'How much revenue is generated per dollar of assets. Retailers high, banks low.',
    value: ratio(safe(ic.revenue), safe(bc.totalAssets)),
    history: series(p => ratio(p.revenue, p.totalAssets)),
    format: v => v == null ? null : v.toFixed(2) + 'x',
    gradeFn: v => v == null ? null : v > 1.5 ? 'strong' : v > 1 ? 'good' : v > 0.5 ? 'neutral' : v > 0.2 ? 'weak' : 'poor',
  };
  metrics.inventoryTurnover = {
    label: 'Inventory Turnover',
    group: 'Efficiency',
    formula: 'Cost of Goods Sold / Inventory',
    description: 'How quickly inventory is sold and replaced. Higher = leaner operations (n/a for service companies).',
    value: ratio(safe(ic.costOfRevenue), safe(bc.inventory)),
    history: series(p => ratio(p.costOfRevenue, p.inventory)),
    format: v => v == null ? null : v.toFixed(1) + 'x',
    gradeFn: v => v == null ? null : v > 12 ? 'strong' : v > 6 ? 'good' : v > 3 ? 'neutral' : v > 1 ? 'weak' : 'poor',
  };

  // ---- CASH FLOW ----
  metrics.freeCashFlow = {
    label: 'Free Cash Flow',
    group: 'Cash Flow',
    formula: 'Operating Cash Flow − Capital Expenditures',
    description: 'Cash available after maintaining/growing the business. The lifeblood of a healthy company.',
    value: safe(cc.freeCashFlow) ?? (safe(cc.operatingCashFlow) - Math.abs(safe(cc.capitalExpenditure) ?? 0)),
    history: series(p => p.freeCashFlow ?? ((p.operatingCashFlow || 0) - Math.abs(p.capitalExpenditure || 0))),
    format: v => formatLargeCurrency(v),
    gradeFn: v => v == null ? null : v > 1e10 ? 'strong' : v > 1e9 ? 'good' : v > 0 ? 'neutral' : v > -1e9 ? 'weak' : 'poor',
  };
  metrics.fcfMargin = {
    label: 'FCF Margin',
    group: 'Cash Flow',
    formula: 'Free Cash Flow / Revenue',
    description: 'How much of every revenue dollar converts to free cash. Above 15% sustained is excellent.',
    value: (() => {
      const fcf = safe(cc.freeCashFlow) ?? (safe(cc.operatingCashFlow) - Math.abs(safe(cc.capitalExpenditure) ?? 0));
      return ratio(fcf, safe(ic.revenue));
    })(),
    history: series(p => {
      const fcf = p.freeCashFlow ?? ((p.operatingCashFlow || 0) - Math.abs(p.capitalExpenditure || 0));
      return ratio(fcf, p.revenue);
    }),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.20 ? 'strong' : v > 0.10 ? 'good' : v > 0.05 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };
  metrics.fcfYield = {
    label: 'FCF Yield',
    group: 'Cash Flow',
    formula: 'Free Cash Flow / Market Cap',
    description: 'Free cash return relative to market value. Higher = cheaper relative to cash generation.',
    value: (() => {
      const fcf = safe(cc.freeCashFlow) ?? (safe(cc.operatingCashFlow) - Math.abs(safe(cc.capitalExpenditure) ?? 0));
      return ratio(fcf, marketCap);
    })(),
    history: [],  // requires historical mcap which we don't track
    format: v => v == null ? null : (v * 100).toFixed(2) + '%',
    gradeFn: v => v == null ? null : v > 0.08 ? 'strong' : v > 0.05 ? 'good' : v > 0.02 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };

  metrics.sbcIntensity = {
    label: 'Stock-Based Comp % of Revenue',
    group: 'Cash Flow',
    formula: 'Stock-Based Compensation / Revenue',
    description: 'SBC is a REAL cost paid to employees/board in equity — it dilutes shareholders, yet it is added back to operating cash flow (inflating OCF/FCF) and is usually EXCLUDED from "adjusted" EBITDA and non-GAAP EPS. Above ~5% of revenue is high, above 10% severe. When this is large, treat any "adjusted" profitability figure with skepticism — GAAP net income includes SBC; the adjusted version hides it.',
    value: ratio(safe(cc.stockBasedCompensation), safe(ic.revenue)),
    history: series(p => ratio(p.stockBasedCompensation, p.revenue)),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    // Higher SBC is WORSE, so the grade scale is inverted vs. a normal metric.
    gradeFn: v => v == null ? null : v < 0.02 ? 'strong' : v < 0.05 ? 'good' : v < 0.08 ? 'neutral' : v < 0.12 ? 'weak' : 'poor',
  };
  metrics.sbcAdjFcf = {
    label: 'SBC-Adjusted FCF Margin',
    group: 'Cash Flow',
    formula: '(Free Cash Flow − Stock-Based Comp) / Revenue',
    description: 'Free cash flow with SBC subtracted back out — the more honest owner-cash figure, since the standard FCF add-back treats equity comp as free. The gap between this and the headline FCF margin is exactly how much SBC is flattering the cash numbers.',
    value: (() => {
      const fcf = safe(cc.freeCashFlow) ?? (safe(cc.operatingCashFlow) - Math.abs(safe(cc.capitalExpenditure) ?? 0));
      const sbc = safe(cc.stockBasedCompensation) ?? 0;
      return ratio(fcf - sbc, safe(ic.revenue));
    })(),
    history: series(p => {
      const fcf = p.freeCashFlow ?? ((p.operatingCashFlow || 0) - Math.abs(p.capitalExpenditure || 0));
      return ratio(fcf - (p.stockBasedCompensation || 0), p.revenue);
    }),
    format: v => v == null ? null : (v * 100).toFixed(1) + '%',
    gradeFn: v => v == null ? null : v > 0.20 ? 'strong' : v > 0.10 ? 'good' : v > 0.05 ? 'neutral' : v > 0 ? 'weak' : 'poor',
  };

  // ---- VALUATION ----
  metrics.pe = {
    label: 'P / E (TTM)',
    group: 'Valuation',
    formula: 'Price / Earnings per Share',
    description: 'Price paid per dollar of trailing earnings. Lower = cheaper. Compare to sector median.',
    value: ratio(currentPrice, safe(ic.eps)),
    history: [],
    format: v => v == null ? null : v.toFixed(1),
    gradeFn: v => v == null ? null : v < 0 ? 'poor' : v < 12 ? 'strong' : v < 20 ? 'good' : v < 35 ? 'neutral' : v < 60 ? 'weak' : 'poor',
  };
  metrics.priceToBook = {
    label: 'Price / Book',
    group: 'Valuation',
    formula: 'Market Cap / Book Value of Equity',
    description: 'How much investors pay per dollar of net assets. Below 1 = trading below book.',
    value: ratio(marketCap, safe(bc.totalStockholdersEquity)),
    history: [],
    format: v => v == null ? null : v.toFixed(2),
    gradeFn: v => v == null ? null : v < 1 ? 'strong' : v < 3 ? 'good' : v < 6 ? 'neutral' : v < 10 ? 'weak' : 'poor',
  };
  metrics.priceToSales = {
    label: 'Price / Sales',
    group: 'Valuation',
    formula: 'Market Cap / Revenue',
    description: 'Used when earnings are negative or volatile. Useful for growth companies and SaaS.',
    value: ratio(marketCap, safe(ic.revenue)),
    history: [],
    format: v => v == null ? null : v.toFixed(2),
    gradeFn: v => v == null ? null : v < 2 ? 'strong' : v < 5 ? 'good' : v < 10 ? 'neutral' : v < 20 ? 'weak' : 'poor',
  };

  // ---- PER SHARE ----
  metrics.eps = {
    label: 'EPS (TTM)',
    group: 'Per Share',
    formula: 'Net Income / Shares Outstanding',
    description: 'Earnings attributable to each share. The numerator of P/E.',
    value: safe(ic.eps),
    history: series(p => p.eps),
    format: v => v == null ? null : fmt$(v),
    gradeFn: v => v == null ? null : v > 5 ? 'strong' : v > 2 ? 'good' : v > 0 ? 'neutral' : 'poor',
  };
  metrics.bps = {
    label: 'Book Value / Share',
    group: 'Per Share',
    formula: 'Shareholders Equity / Shares Outstanding',
    description: 'Theoretical liquidation value per share. Compared to price for the P/B ratio.',
    value: ratio(safe(bc.totalStockholdersEquity), safe(ic.weightedAverageShsOut)),
    history: series(p => ratio(p.totalStockholdersEquity, p.weightedAverageShsOut)),
    format: v => v == null ? null : fmt$(v),
    gradeFn: null,
  };

  // Pull individual metric "currents" into the canonical stockbook row so the
  // health engine consumes them. Same data, no parallel sources.
  const sbRow = getCanonicalStockData(state.stock?.ticker);
  if (sbRow) {
    sbRow.currentRatio  = metrics.currentRatio.value  ?? sbRow.currentRatio;
    sbRow.debtToEquity  = metrics.debtToEquity.value  ?? sbRow.debtToEquity;
    sbRow.netMargin     = metrics.netMargin.value     ?? sbRow.netMargin;
    sbRow.roe           = metrics.roe.value           ?? sbRow.roe;
    sbRow.priceToBook   = metrics.priceToBook.value   ?? sbRow.priceToBook;
    sbRow.priceToSales  = metrics.priceToSales.value  ?? sbRow.priceToSales;
    sbRow.cash          = safe(bc.cashAndCashEquivalents) ?? sbRow.cash;
    sbRow.totalDebt     = safe(bc.totalDebt) ?? sbRow.totalDebt;
  }

  return {
    metrics,
    topLine: {
      // Balance sheet totals
      totalAssets:           safe(bc.totalAssets),
      totalCurrentAssets:    safe(bc.totalCurrentAssets),
      totalLiabilities:      safe(bc.totalLiabilities),
      totalCurrentLiab:      safe(bc.totalCurrentLiabilities),
      totalEquity:           safe(bc.totalStockholdersEquity),
      cash:                  safe(bc.cashAndCashEquivalents),
      totalDebt:             safe(bc.totalDebt),
      // Income statement totals
      revenue:               safe(ic.revenue),
      netIncome:             safe(ic.netIncome),
      freeCashFlow:          metrics.freeCashFlow.value,
      sharesOutstanding:     safe(ic.weightedAverageShsOut),
      revenueGrowth:         (income.length >= 2 && income[1]?.revenue) ? ((ic.revenue - income[1].revenue) / Math.abs(income[1].revenue)) : null,
      earningsGrowth:        (income.length >= 2 && income[1]?.netIncome) ? ((ic.netIncome - income[1].netIncome) / Math.abs(income[1].netIncome)) : null,

      // === Income statement composition — for revenue waterfall pie ===
      // Each piece of revenue is consumed by COGS, opex, interest, taxes,
      // leaving net income as the residual. Components may be null if FMP
      // doesn't supply them; we'll filter nulls before charting.
      costOfRevenue:         safe(ic.costOfRevenue),
      grossProfit:           safe(ic.grossProfit),
      operatingExpenses:     safe(ic.operatingExpenses),
      operatingIncome:       safe(ic.operatingIncome),
      researchAndDev:        safe(ic.researchAndDevelopmentExpenses),
      sellingGenAdmin:       safe(ic.sellingGeneralAndAdministrativeExpenses),
      interestExpense:       safe(ic.interestExpense),
      incomeTaxExpense:      safe(ic.incomeTaxExpense),
      ebitda:                safe(ic.ebitda),
      depreciation:          safe(ic.depreciationAndAmortization),

      // === Balance sheet composition — for asset + liability pies ===
      // Asset side: cash / receivables / inventory / PP&E / intangibles + goodwill / other
      receivables:           safe(bc.netReceivables),
      inventory:             safe(bc.inventory),
      ppe:                   safe(bc.propertyPlantEquipmentNet),
      goodwill:              safe(bc.goodwill),
      intangibles:           safe(bc.intangibleAssets),
      shortTermInvestments:  safe(bc.shortTermInvestments),
      longTermInvestments:   safe(bc.longTermInvestments),
      // Liability side: short-term debt / long-term debt / payables / accrued / deferred / other
      shortTermDebt:         safe(bc.shortTermDebt),
      longTermDebt:          safe(bc.longTermDebt),
      accountsPayable:       safe(bc.accountPayables),
      deferredRevenue:       safe(bc.deferredRevenue),
    },
    asOf: ic.date || bc.date,
    periodCount: periods.length,
  };
}

function formatLargeCurrency(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs/1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs/1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs/1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs/1e3).toFixed(0)}K`;
  return `${sign}${fmt$(abs, 0)}`;
}

function renderSparkline(data, gradeColor) {
  if (!data || data.length < 2) {
    return `<div style="width:100%;height:30px;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:9px;color:var(--ink-faint)">no trend data</div>`;
  }
  const w = 100, h = 30;
  const values = data.map(d => d.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d.value - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastVal = values[values.length - 1];
  const firstVal = values[0];
  const direction = lastVal > firstVal ? 'up' : lastVal < firstVal ? 'down' : 'flat';
  const trendArrow = direction === 'up' ? '↗' : direction === 'down' ? '↘' : '→';
  const trendColor = direction === 'up' ? 'var(--pos)' : direction === 'down' ? 'var(--neg)' : 'var(--ink-faint)';
  return `
    <div style="display:flex;align-items:center;gap:6px;height:30px">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="flex:1;height:100%;overflow:visible">
        <polyline points="${pts}" fill="none" stroke="${gradeColor || 'var(--amber)'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${(data.length - 1) / (data.length - 1) * w}" cy="${h - ((lastVal - min) / range) * h}" r="2" fill="${gradeColor || 'var(--amber)'}"/>
      </svg>
      <span style="font-family:var(--mono);font-size:11px;color:${trendColor};line-height:1">${trendArrow}</span>
    </div>
  `;
}

function renderMetricCard(key, m) {
  const grade = m.gradeFn ? gradeFromScore(m.gradeFn(m.value) === 'strong' ? 90 : m.gradeFn(m.value) === 'good' ? 70 : m.gradeFn(m.value) === 'neutral' ? 50 : m.gradeFn(m.value) === 'weak' ? 30 : m.gradeFn(m.value) === 'poor' ? 15 : null) : null;
  const color = grade?.color || 'var(--ink)';
  const valueStr = m.value == null ? '—' : (m.format ? m.format(m.value) : String(m.value));

  // Custom tooltip content — shows the FULL formula + description with
  // proper wrapping. Native title attribute truncates on some browsers,
  // so we use a data-attribute consumed by the global custom-tooltip system.
  const tipHtml = `
    <div class="ttip-title">${escapeHtml(m.label)}</div>
    <div class="ttip-formula"><span class="ttip-key">Formula</span>${escapeHtml(m.formula)}</div>
    <div class="ttip-desc">${escapeHtml(m.description)}</div>
    ${grade ? `<div class="ttip-grade" style="color:${grade.color}">${grade.icon} ${escapeHtml(grade.label || '')}</div>` : ''}
  `;

  return `
    <div class="metric-card" data-tip-full="${escapeHtml(tipHtml)}">
      <div class="metric-card-header">
        <span class="metric-card-label">${escapeHtml(m.label)}</span>
        ${grade ? `<span class="metric-card-grade" style="color:${grade.color}">${grade.icon}</span>` : ''}
      </div>
      <div class="metric-card-value" style="color:${color}">${valueStr}</div>
      <div class="metric-card-spark">${renderSparkline(m.history, grade?.color)}</div>
      <div class="metric-card-formula">${escapeHtml(m.formula)}</div>
    </div>
  `;
}

function renderPieChart(slices, opts = {}) {
  const size       = opts.size || 200;
  const innerRatio = opts.innerRatio ?? 0.55;
  const center     = size / 2;
  const radius     = size / 2 - 4;
  const innerR     = radius * innerRatio;
  const showCenter = opts.centerLabel !== false;
  const centerValueTxt = opts.centerValue || '';
  const centerSubtitle = opts.centerSubtitle || '';

  const positive = slices
    .filter(s => s.value != null && isFinite(s.value) && s.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = positive.reduce((sum, s) => sum + s.value, 0);

  if (total === 0 || positive.length === 0) {
    return `<div style="height:${size}px;display:flex;align-items:center;justify-content:center;color:var(--ink-faint);font-family:var(--mono);font-size:10px">no chartable data</div>`;
  }

  let cumAngle = -Math.PI / 2;
  const slicePaths = positive.map((slice) => {
    const sweepAngle = (slice.value / total) * Math.PI * 2;
    const startAngle = cumAngle;
    const endAngle   = cumAngle + sweepAngle;
    cumAngle = endAngle;

    const ox1 = center + radius * Math.cos(startAngle);
    const oy1 = center + radius * Math.sin(startAngle);
    const ox2 = center + radius * Math.cos(endAngle);
    const oy2 = center + radius * Math.sin(endAngle);
    const ix1 = center + innerR * Math.cos(endAngle);
    const iy1 = center + innerR * Math.sin(endAngle);
    const ix2 = center + innerR * Math.cos(startAngle);
    const iy2 = center + innerR * Math.sin(startAngle);

    const largeArc = sweepAngle > Math.PI ? 1 : 0;
    const path = innerRatio > 0
      ? `M ${ox1} ${oy1} A ${radius} ${radius} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`
      : `M ${center} ${center} L ${ox1} ${oy1} A ${radius} ${radius} 0 ${largeArc} 1 ${ox2} ${oy2} Z`;

    const pctStr = ((slice.value / total) * 100).toFixed(1);
    return `
      <path d="${path}" fill="${slice.color}" stroke="var(--bg)" stroke-width="2" class="pie-slice">
        <title>${escapeHtml(slice.label)}: ${formatLargeCurrency(slice.value)} (${pctStr}%)</title>
      </path>
    `;
  }).join('');

  const centerLabelHtml = showCenter ? `
    <text x="${center}" y="${center - 4}" text-anchor="middle" font-family="var(--mono)" font-size="${Math.max(10, size * 0.10)}" font-weight="700" fill="var(--ink)">${escapeHtml(centerValueTxt)}</text>
    <text x="${center}" y="${center + size * 0.075}" text-anchor="middle" font-family="var(--mono)" font-size="${Math.max(8, size * 0.055)}" fill="var(--ink-faint)">${escapeHtml(centerSubtitle)}</text>
  ` : '';

  const legendHtml = positive.map(s => `
    <div class="pie-legend-row">
      <span class="pie-legend-swatch" style="background:${s.color}"></span>
      <span class="pie-legend-label">${escapeHtml(s.label)}</span>
      <span class="pie-legend-value">${formatLargeCurrency(s.value)}</span>
      <span class="pie-legend-pct">${((s.value / total) * 100).toFixed(1)}%</span>
    </div>
  `).join('');

  return `
    <div class="pie-wrap">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="pie-svg">
        ${slicePaths}
        ${centerLabelHtml}
      </svg>
      <div class="pie-legend">${legendHtml}</div>
    </div>
  `;
}

function renderFinancialsOverview(el, data, stock) {
  if (!data || !stock) {
    el.innerHTML = `<div class="empty" style="padding:40px;text-align:center;color:var(--ink-dim)">Load a ticker to see financial overview.</div>`;
    return;
  }
  const result = computeFinancialRatios(data.income, data.balance, data.cashflow, stock.price, stock.marketCap);
  if (!result) {
    el.innerHTML = `<div class="empty" style="padding:40px;text-align:center;color:var(--ink-dim)">Insufficient statement data to compute ratios.</div>`;
    return;
  }
  const { metrics, topLine, asOf, periodCount } = result;

  // Group metrics by group
  const groups = {};
  for (const [key, m] of Object.entries(metrics)) {
    if (!groups[m.group]) groups[m.group] = [];
    groups[m.group].push([key, m]);
  }

  // Top-line cards (level-1 framework)
  const topLineCards = [
    { label: 'Total Assets',         value: topLine.totalAssets,          format: formatLargeCurrency, tooltip: 'Everything the company owns — cash, receivables, inventory, property, equipment, intangibles, goodwill.' },
    { label: 'Total Liabilities',    value: topLine.totalLiabilities,     format: formatLargeCurrency, tooltip: 'Everything the company owes — debt, payables, deferred revenue, lease obligations.' },
    { label: 'Total Equity',         value: topLine.totalEquity,          format: formatLargeCurrency, tooltip: 'Assets minus liabilities — the residual value belonging to shareholders.' },
    { label: 'Current Assets',       value: topLine.totalCurrentAssets,   format: formatLargeCurrency, tooltip: 'Assets convertible to cash within 12 months — cash, receivables, inventory.' },
    { label: 'Current Liabilities',  value: topLine.totalCurrentLiab,     format: formatLargeCurrency, tooltip: 'Obligations due within 12 months — short-term debt, payables, accrued expenses.' },
    { label: 'Cash & Equivalents',   value: topLine.cash,                 format: formatLargeCurrency, tooltip: 'Most liquid assets — physical cash, demand deposits, money market funds.' },
    { label: 'Total Debt',           value: topLine.totalDebt,            format: formatLargeCurrency, tooltip: 'All interest-bearing obligations — short-term + long-term debt.' },
    { label: 'Revenue (TTM)',        value: topLine.revenue,              format: formatLargeCurrency, tooltip: 'Top-line sales over the trailing twelve months.' },
    { label: 'Net Income (TTM)',     value: topLine.netIncome,            format: formatLargeCurrency, tooltip: 'Bottom-line profit after all expenses, interest, and taxes.' },
    { label: 'Free Cash Flow (TTM)', value: topLine.freeCashFlow,         format: formatLargeCurrency, tooltip: 'Operating cash flow minus capital expenditures — cash available for dividends, buybacks, debt paydown, M&A.' },
  ];
  const topLineHtml = topLineCards.map(c => {
    const v = c.value;
    const valColor = v == null ? 'var(--ink-faint)' : v < 0 ? 'var(--neg)' : 'var(--ink)';
    const tipHtml = `<div class="ttip-title">${escapeHtml(c.label)}</div><div class="ttip-desc">${escapeHtml(c.tooltip)}</div>`;
    return `
      <div class="top-line-card" data-tip-full="${escapeHtml(tipHtml)}">
        <div class="top-line-label">${escapeHtml(c.label)}</div>
        <div class="top-line-value" style="color:${valColor}">${c.format(v)}</div>
      </div>
    `;
  }).join('');

  // ============================================================
  //   PIE CHARTS — visual composition of balance sheet + income statement
  //
  //   Three pies side-by-side:
  //     1. Asset composition — what the company owns, broken down by type
  //     2. Funding composition — how those assets are financed (debt + equity + other)
  //     3. Revenue → Net Income — where each dollar of revenue goes
  //
  //   Net loss case: revenue pie shows positive components only (COGS/Opex/etc)
  //   and the legend notes the net loss separately so the visual still works.
  // ============================================================
  const pieColors = {
    cash: 'var(--pos)', receivables: '#7faaca', inventory: 'var(--data-amber)',
    invShortTerm: '#9bc7d6', ppe: '#a89e6c', intangibles: '#a07b8f',
    goodwill: '#8b7baa', other: '#5e5754',
    shortDebt: '#d97757', longDebt: 'var(--neg)', payables: 'var(--data-amber)',
    deferred: '#7faaca', otherLiab: '#5e5754', equity: 'var(--pos)',
    cogs: 'var(--neg)', opex: '#d97757', randd: 'var(--data-amber)',
    sga: '#a89e6c', interest: '#8b7baa', taxes: '#5e5754',
    netIncome: 'var(--pos)',
  };

  // ----- ASSET COMPOSITION -----
  const assetNamed = [
    { label: 'Cash & Equivalents',     value: topLine.cash,                color: pieColors.cash },
    { label: 'Short-Term Investments', value: topLine.shortTermInvestments, color: pieColors.invShortTerm },
    { label: 'Receivables',            value: topLine.receivables,         color: pieColors.receivables },
    { label: 'Inventory',              value: topLine.inventory,           color: pieColors.inventory },
    { label: 'PP&E (Net)',             value: topLine.ppe,                 color: pieColors.ppe },
    { label: 'Goodwill',               value: topLine.goodwill,            color: pieColors.goodwill },
    { label: 'Intangibles',            value: topLine.intangibles,         color: pieColors.intangibles },
    { label: 'Long-Term Investments',  value: topLine.longTermInvestments, color: pieColors.invShortTerm },
  ];
  const assetNamedTotal = assetNamed.reduce((s, x) => s + (x.value || 0), 0);
  const assetOther = (topLine.totalAssets || 0) - assetNamedTotal;
  if (assetOther > (topLine.totalAssets || 0) * 0.01) {
    assetNamed.push({ label: 'Other Assets', value: assetOther, color: pieColors.other });
  }
  const assetPieHtml = renderPieChart(assetNamed, {
    size: 200,
    centerValue: formatLargeCurrency(topLine.totalAssets),
    centerSubtitle: 'Total Assets',
  });

  // ----- FUNDING COMPOSITION -----
  const fundingNamed = [
    { label: 'Short-Term Debt',    value: topLine.shortTermDebt,    color: pieColors.shortDebt },
    { label: 'Long-Term Debt',     value: topLine.longTermDebt,     color: pieColors.longDebt },
    { label: 'Accounts Payable',   value: topLine.accountsPayable,  color: pieColors.payables },
    { label: 'Deferred Revenue',   value: topLine.deferredRevenue,  color: pieColors.deferred },
    { label: 'Stockholder Equity', value: topLine.totalEquity,      color: pieColors.equity },
  ];
  const fundingNamedTotal = fundingNamed.reduce((s, x) => s + (x.value || 0), 0);
  const fundingOther = (topLine.totalAssets || 0) - fundingNamedTotal;
  if (fundingOther > (topLine.totalAssets || 0) * 0.01) {
    fundingNamed.push({ label: 'Other Liabilities', value: fundingOther, color: pieColors.otherLiab });
  }
  const fundingPieHtml = renderPieChart(fundingNamed, {
    size: 200,
    centerValue: formatLargeCurrency(topLine.totalAssets),
    centerSubtitle: 'Total Funding',
  });

  // ----- INCOME WATERFALL -----
  const incomeSlices = [];
  if (topLine.costOfRevenue != null && topLine.costOfRevenue > 0) {
    incomeSlices.push({ label: 'Cost of Revenue', value: topLine.costOfRevenue, color: pieColors.cogs });
  }
  const hasBrokenOpex = (topLine.researchAndDev > 0) || (topLine.sellingGenAdmin > 0);
  if (hasBrokenOpex) {
    if (topLine.researchAndDev > 0)  incomeSlices.push({ label: 'R&D', value: topLine.researchAndDev, color: pieColors.randd });
    if (topLine.sellingGenAdmin > 0) incomeSlices.push({ label: 'SG&A', value: topLine.sellingGenAdmin, color: pieColors.sga });
  } else if (topLine.operatingExpenses > 0) {
    incomeSlices.push({ label: 'Operating Expenses', value: topLine.operatingExpenses, color: pieColors.opex });
  }
  if (topLine.interestExpense > 0)  incomeSlices.push({ label: 'Interest Expense', value: topLine.interestExpense, color: pieColors.interest });
  if (topLine.incomeTaxExpense > 0) incomeSlices.push({ label: 'Taxes', value: topLine.incomeTaxExpense, color: pieColors.taxes });
  if (topLine.netIncome != null && topLine.netIncome > 0) {
    incomeSlices.push({ label: 'Net Income', value: topLine.netIncome, color: pieColors.netIncome });
  }
  const slicedTotal = incomeSlices.reduce((s, x) => s + x.value, 0);
  const unaccounted = (topLine.revenue || 0) - slicedTotal;
  if (unaccounted > (topLine.revenue || 0) * 0.02) {
    incomeSlices.push({ label: 'Other / Non-Op', value: unaccounted, color: pieColors.other });
  }
  const lossNote = (topLine.netIncome != null && topLine.netIncome < 0)
    ? `<div style="margin-top:8px;padding:6px 10px;background:rgba(165,100,90,0.1);border-left:3px solid var(--neg);border-radius:2px;font-family:var(--mono);font-size:10px;color:var(--neg)">Net loss of ${formatLargeCurrency(Math.abs(topLine.netIncome))} — slice not shown (pies require positive values).</div>`
    : '';
  const incomePieHtml = renderPieChart(incomeSlices, {
    size: 200,
    centerValue: formatLargeCurrency(topLine.revenue),
    centerSubtitle: 'Total Revenue',
  });

  const piesSectionHtml = `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;flex-wrap:wrap;gap:10px">
        <div style="font-family:var(--mono);font-size:11px;color:var(--amber);letter-spacing:0.12em;text-transform:uppercase">Visual Composition</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">Hover slices for exact values</div>
      </div>
      <div class="pie-grid">
        <div class="pie-card">
          <div class="pie-card-title">Asset Composition</div>
          ${assetPieHtml}
        </div>
        <div class="pie-card">
          <div class="pie-card-title">Funding Mix · Liabilities + Equity</div>
          ${fundingPieHtml}
        </div>
        <div class="pie-card">
          <div class="pie-card-title">Revenue → Net Income</div>
          ${incomePieHtml}
          ${lossNote}
        </div>
      </div>
    </div>
  `;

  // YoY growth indicators
  const growthHtml = (() => {
    const items = [];
    if (topLine.revenueGrowth != null) {
      const g = topLine.revenueGrowth;
      const col = g > 0.10 ? 'var(--pos)' : g > 0 ? 'var(--amber)' : 'var(--neg)';
      items.push(`<span style="color:${col};font-family:var(--mono);font-size:11px">Revenue YoY: <strong>${(g >= 0 ? '+' : '') + (g * 100).toFixed(1)}%</strong></span>`);
    }
    if (topLine.earningsGrowth != null) {
      const g = topLine.earningsGrowth;
      const col = g > 0.10 ? 'var(--pos)' : g > 0 ? 'var(--amber)' : 'var(--neg)';
      items.push(`<span style="color:${col};font-family:var(--mono);font-size:11px">EPS YoY: <strong>${(g >= 0 ? '+' : '') + (g * 100).toFixed(1)}%</strong></span>`);
    }
    return items.join(' · ');
  })();

  // Ratio groups
  const groupHtml = Object.entries(groups).map(([groupName, items]) => `
    <div class="ratio-group">
      <div class="ratio-group-title">${escapeHtml(groupName)}</div>
      <div class="ratio-group-grid">
        ${items.map(([k, m]) => renderMetricCard(k, m)).join('')}
      </div>
    </div>
  `).join('');

  el.innerHTML = `
    <style>
      .fin-overview { display: flex; flex-direction: column; gap: 24px; padding: 8px 0; }
      .top-line-section { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
      .top-line-card {
        background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 4px;
        padding: 12px 14px; cursor: help; transition: border-color 0.15s;
      }
      .top-line-card:hover { border-color: var(--amber); }
      .top-line-label {
        font-family: var(--mono); font-size: 9px; color: var(--ink-faint);
        text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;
      }
      .top-line-value { font-family: var(--mono); font-size: 18px; font-weight: 700; }
      .ratio-group { display: flex; flex-direction: column; gap: 10px; }
      .ratio-group-title {
        font-family: var(--mono); font-size: 11px; color: var(--amber);
        letter-spacing: 0.12em; text-transform: uppercase;
        padding-bottom: 6px; border-bottom: 1px solid var(--rule);
      }
      .ratio-group-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;
      }
      .metric-card {
        background: var(--bg-card); border: 1px solid var(--rule); border-radius: 4px;
        padding: 12px; cursor: help; transition: border-color 0.15s; display: flex;
        flex-direction: column; gap: 8px;
      }
      .metric-card:hover { border-color: var(--amber); }
      .metric-card-header { display: flex; justify-content: space-between; align-items: center; }
      .metric-card-label {
        font-family: var(--mono); font-size: 10px; color: var(--ink-faint);
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .metric-card-grade { font-size: 12px; font-weight: 700; }
      .metric-card-value { font-family: var(--mono); font-size: 20px; font-weight: 700; }
      .metric-card-spark { height: 30px; }
      .metric-card-formula {
        font-family: var(--mono); font-size: 9px; color: var(--ink-faint);
        line-height: 1.3; padding-top: 4px; border-top: 1px dashed var(--rule);
      }

      /* ----- Pie chart cards ----- */
      .pie-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 14px;
      }
      .pie-card {
        background: var(--bg-elev);
        border: 1px solid var(--rule);
        border-radius: 4px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pie-card-title {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--ink-dim);
        letter-spacing: 0.10em;
        text-transform: uppercase;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--rule);
      }
      .pie-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
      .pie-svg .pie-slice {
        transition: opacity 0.12s, transform 0.15s;
        transform-origin: center;
        cursor: default;
      }
      .pie-svg:hover .pie-slice:not(:hover) {
        opacity: 0.55;
      }
      .pie-svg .pie-slice:hover {
        transform: scale(1.03);
      }
      .pie-legend {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
      }
      .pie-legend-row {
        display: grid;
        grid-template-columns: 12px 1fr auto auto;
        gap: 8px;
        align-items: center;
        font-family: var(--mono);
        font-size: 10px;
      }
      .pie-legend-swatch {
        width: 10px; height: 10px;
        border-radius: 2px;
      }
      .pie-legend-label {
        color: var(--ink);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pie-legend-value { color: var(--ink-dim); }
      .pie-legend-pct {
        color: var(--ink-faint);
        font-weight: 600;
        min-width: 38px;
        text-align: right;
      }
    </style>
    <div class="fin-overview">
      ${piesSectionHtml}
      <div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;flex-wrap:wrap;gap:10px">
          <div style="font-family:var(--mono);font-size:11px;color:var(--amber);letter-spacing:0.12em;text-transform:uppercase">Top-Line Snapshot · Balance Sheet · Income Statement · Cash Flow</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim)">${growthHtml}</div>
        </div>
        <div class="top-line-section">${topLineHtml}</div>
      </div>
      ${groupHtml}
      <div class="financials-meta">
        Computed from FMP statements · ${periodCount} period${periodCount === 1 ? '' : 's'} available · As of ${asOf || 'unknown'} · Hover any card for the full formula + description
      </div>
    </div>
  `;
}

function renderStatementTable(rows, rowSpec) {
  const cols = rows.map(r => {
    if (state.financials.period === 'quarter') {
      // e.g. "Q3 2024"
      const date = r.date || '';
      const period = r.period || '';
      const yr = date.slice(0, 4);
      return period ? `${period} ${yr}` : date.slice(0, 7);
    }
    return r.calendarYear || r.date?.slice(0, 4) || '—';
  });

  // Compact display + exact hover. Sub-thousand values (EPS, share counts in
  // billions are different beasts so use the magnitude check) get fixed decimals
  // with no thousands sep; thousands and above use grouping commas.
  const fmt = (n) => {
    if (n == null || !isFinite(n)) return '<span style="color:var(--ink-faint)">—</span>';
    const abs = Math.abs(n);
    const exact = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    let display;
    if (abs >= 1e9) display = (n / 1e9).toFixed(2) + 'B';
    else if (abs >= 1e6) display = (n / 1e6).toFixed(2) + 'M';
    else if (abs >= 1e3) display = (n / 1e3).toFixed(2) + 'K';
    else display = n.toFixed(2);
    return `<span title="${exact}" style="cursor:help">${display}</span>`;
  };

  return `
    <table class="financials-table">
      <thead>
        <tr>
          <th>Line Item</th>
          ${cols.map(c => `<th>${c}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rowSpec.map(spec => `
          <tr class="${spec.subtotal ? 'subtotal' : spec.indent ? 'indent' : ''}">
            <td>${spec.label}</td>
            ${rows.map(r => `<td>${fmt(r[spec.key])}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderIncomeStatement(rows) {
  return renderStatementTable(rows, [
    { label: 'Revenue', key: 'revenue', subtotal: true },
    { label: 'Cost of Revenue', key: 'costOfRevenue', indent: true },
    { label: 'Gross Profit', key: 'grossProfit', subtotal: true },
    { label: 'R&D Expense', key: 'researchAndDevelopmentExpenses', indent: true },
    { label: 'SG&A Expense', key: 'sellingGeneralAndAdministrativeExpenses', indent: true },
    { label: 'Operating Expenses', key: 'operatingExpenses', indent: true },
    { label: 'Operating Income', key: 'operatingIncome', subtotal: true },
    { label: 'Interest Expense', key: 'interestExpense', indent: true },
    { label: 'Income Before Tax', key: 'incomeBeforeTax' },
    { label: 'Income Tax Expense', key: 'incomeTaxExpense', indent: true },
    { label: 'Net Income', key: 'netIncome', subtotal: true },
    { label: 'EPS (Basic)', key: 'eps' },
    { label: 'EPS (Diluted)', key: 'epsdiluted' },
    { label: 'EBITDA', key: 'ebitda' },
    { label: 'Weighted Avg Shares (Diluted)', key: 'weightedAverageShsOutDil' },
  ]);
}

function renderBalanceSheet(rows) {
  return renderStatementTable(rows, [
    { label: 'ASSETS', key: '_section', subtotal: true },
    { label: 'Cash & Equivalents', key: 'cashAndCashEquivalents', indent: true },
    { label: 'Short-Term Investments', key: 'shortTermInvestments', indent: true },
    { label: 'Net Receivables', key: 'netReceivables', indent: true },
    { label: 'Inventory', key: 'inventory', indent: true },
    { label: 'Total Current Assets', key: 'totalCurrentAssets', subtotal: true },
    { label: 'Property, Plant & Equipment', key: 'propertyPlantEquipmentNet', indent: true },
    { label: 'Goodwill', key: 'goodwill', indent: true },
    { label: 'Intangible Assets', key: 'intangibleAssets', indent: true },
    { label: 'Total Non-Current Assets', key: 'totalNonCurrentAssets', subtotal: true },
    { label: 'Total Assets', key: 'totalAssets', subtotal: true },
    { label: 'LIABILITIES', key: '_section', subtotal: true },
    { label: 'Accounts Payable', key: 'accountPayables', indent: true },
    { label: 'Short-Term Debt', key: 'shortTermDebt', indent: true },
    { label: 'Total Current Liabilities', key: 'totalCurrentLiabilities', subtotal: true },
    { label: 'Long-Term Debt', key: 'longTermDebt', indent: true },
    { label: 'Total Non-Current Liabilities', key: 'totalNonCurrentLiabilities', subtotal: true },
    { label: 'Total Liabilities', key: 'totalLiabilities', subtotal: true },
    { label: 'Total Debt', key: 'totalDebt' },
    { label: 'Net Debt', key: 'netDebt' },
    { label: "EQUITY", key: '_section', subtotal: true },
    { label: 'Common Stock', key: 'commonStock', indent: true },
    { label: 'Retained Earnings', key: 'retainedEarnings', indent: true },
    { label: 'Total Stockholders\' Equity', key: 'totalStockholdersEquity', subtotal: true },
  ]);
}

function renderCashFlow(rows) {
  return renderStatementTable(rows, [
    { label: 'OPERATING ACTIVITIES', key: '_section', subtotal: true },
    { label: 'Net Income', key: 'netIncome', indent: true },
    { label: 'D&A', key: 'depreciationAndAmortization', indent: true },
    { label: 'Stock-Based Compensation', key: 'stockBasedCompensation', indent: true },
    { label: 'Change in Working Capital', key: 'changeInWorkingCapital', indent: true },
    { label: 'Operating Cash Flow', key: 'operatingCashFlow', subtotal: true },
    { label: 'INVESTING ACTIVITIES', key: '_section', subtotal: true },
    { label: 'Capital Expenditure', key: 'capitalExpenditure', indent: true },
    { label: 'Acquisitions (Net)', key: 'acquisitionsNet', indent: true },
    { label: 'Investments Purchased', key: 'purchasesOfInvestments', indent: true },
    { label: 'Investments Sold', key: 'salesMaturitiesOfInvestments', indent: true },
    { label: 'Net Cash from Investing', key: 'netCashUsedForInvestingActivites', subtotal: true },
    { label: 'FINANCING ACTIVITIES', key: '_section', subtotal: true },
    { label: 'Debt Repayment', key: 'debtRepayment', indent: true },
    { label: 'Common Stock Issued', key: 'commonStockIssued', indent: true },
    { label: 'Common Stock Repurchased', key: 'commonStockRepurchased', indent: true },
    { label: 'Dividends Paid', key: 'dividendsPaid', indent: true },
    { label: 'Net Cash from Financing', key: 'netCashUsedProvidedByFinancingActivities', subtotal: true },
    { label: 'Free Cash Flow', key: 'freeCashFlow', subtotal: true },
    { label: 'Net Change in Cash', key: 'netChangeInCash' },
    { label: 'Cash at End of Period', key: 'cashAtEndOfPeriod' },
  ]);
}

async function renderCompanyHealthScore(s, wd) {
  const health = computeCompanyHealth(s);
  if (!health || health.composite == null) return '';
  const dimOrder = [
    { key: 'scale',    label: 'Scale' },
    { key: 'profit',   label: 'Profitability' },
    { key: 'value',    label: 'Valuation' },
    { key: 'strength', label: 'Financial Strength' },
    { key: 'growth',   label: 'Growth' },
    { key: 'income',   label: 'Income' },
    { key: 'risk',     label: 'Risk Profile' },
    { key: 'technical', label: 'Technical Posture' },
  ];
  const dimensionsHtml = dimOrder.map(({ key, label }) => {
    const d = health.dimensions[key];
    if (!d) return '';
    const grade = gradeFromScore(d.score);
    return `
      <div style="display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--rule);border-radius:3px;background:var(--bg-elev)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase">${label}</span>
          <span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:10px;font-weight:700;color:${grade.color}">
            ${grade.icon}
            <span>${d.score != null ? d.score.toFixed(0) : '?'}</span>
          </span>
        </div>
        <div style="height:4px;background:rgba(0,0,0,0.2);border-radius:2px;overflow:hidden">
          <div style="height:100%;background:${grade.color};width:${d.score || 0}%;transition:width 0.4s"></div>
        </div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);line-height:1.5">${escapeHtml(d.reason || '')}</div>
      </div>
    `;
  }).join('');
  const stageLabel = health.stage === 'growth' ? 'Growth-stage company'
                    : health.stage === 'dividend' ? 'Mature dividend payer'
                    : 'Blended characteristics';
  const stageNote = health.stage === 'growth' ? 'revenue growth and valuation most heavily'
                    : health.stage === 'dividend' ? 'income, profitability, and balance-sheet strength most heavily'
                    : 'all dimensions evenly';
  return `
    <div class="company-card">
      <h4>Financial Health · Composite Score</h4>
      <div style="display:flex;align-items:center;gap:24px;padding:16px;background:var(--bg-elev);border-radius:4px;margin-bottom:16px;border-left:4px solid ${health.grade.color}">
        <div style="text-align:center;flex-shrink:0">
          <div style="font-family:var(--mono);font-size:48px;font-weight:700;line-height:1;color:${health.grade.color}">${health.composite.toFixed(0)}</div>
          <div style="font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:0.15em;color:${health.grade.color};margin-top:4px">${health.grade.label}</div>
        </div>
        <div style="flex:1">
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Classification</div>
          <div style="font-size:13px;color:var(--ink);line-height:1.6">
            <strong>${stageLabel}</strong> — composite weighs ${stageNote}.
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:10px">
        ${dimensionsHtml}
      </div>
      ${health.chain ? `
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--rule)">
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">
          Multi-step reasoning · conviction ${health.chain.conviction != null ? health.chain.conviction.toFixed(0) : '—'}/100
        </div>
        <div style="font-size:13px;color:var(--ink);line-height:1.6;margin-bottom:10px;font-style:italic">${escapeHtml(health.chain.verdict)}</div>
        <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
          ${health.chain.steps.filter(st => st.points != null).map(st => {
            const g = gradeFromScore(st.points);
            return `<li style="font-family:var(--mono);font-size:11px;color:var(--ink-dim);line-height:1.5">
              <span style="color:${g.color};font-weight:700">${st.name} (${st.points.toFixed(0)})</span> — ${escapeHtml(st.note)}
            </li>`;
          }).join('')}
        </ol>
      </div>` : ''}
    </div>
  `;
}

async function enrichCompanyData(ticker, baseStock) {
  if (!ticker) return baseStock || {};
  const enriched = { ticker, ...(baseStock || {}) };

  // ---- Source 1: Stockbook canonical row (already in enriched via baseStock) ----

  // ---- Source 2: GitHub Wikidata facts (existing path) ----
  let wd = null;
  try {
    wd = await fetchTrapp2CompanyFacts(ticker);
  } catch (e) {
    console.warn('[enrichCompany] wikidata fetch failed:', e.message);
  }
  if (wd) {
    enriched.name         = enriched.name         || wd.name;
    enriched.description  = enriched.description  || wd.description;
    enriched.industry     = enriched.industry     || wd.industry;
    enriched.isin         = enriched.isin         || wd.isin;
    enriched.employees    = enriched.employees    ?? wd.employees;
    enriched.ipoDate      = enriched.ipoDate      || wd.inception;
    enriched.headquarters = enriched.headquarters || wd.headquarters;
    enriched.website      = enriched.website      || wd.website;
    enriched.cik          = enriched.cik          || wd.cik;
    enriched._wikidata    = wd;
  }

  // ---- Source 3: FMP company profile (description, sector, CEO, etc) ----
  // The free tier covers this endpoint with no extra cost beyond the user's
  // existing FMP key. Provides a rich English description that's often MORE
  // complete than Wikidata's, plus structured fields like CEO, address, image.
  const fmpKey = (typeof getFmpKey === 'function') ? getFmpKey() : '';
  if (fmpKey) {
    try {
      const fmpProfile = await fetchFmpCompanyProfile(ticker, fmpKey);
      if (fmpProfile) {
        // FMP fields tend to be authoritative for current values. Fill in
        // whatever's missing; don't overwrite stockbook fields.
        enriched.name         = enriched.name         || fmpProfile.companyName;
        enriched.description  = enriched.description  || fmpProfile.description;
        enriched.sector       = enriched.sector       || fmpProfile.sector;
        enriched.industry     = enriched.industry     || fmpProfile.industry;
        enriched.exchange     = enriched.exchange     || fmpProfile.exchangeShortName || fmpProfile.exchange;
        enriched.currency     = enriched.currency     || fmpProfile.currency;
        enriched.employees    = enriched.employees    ?? (fmpProfile.fullTimeEmployees ? parseInt(fmpProfile.fullTimeEmployees, 10) : null);
        enriched.ipoDate      = enriched.ipoDate      || fmpProfile.ipoDate;
        enriched.headquarters = enriched.headquarters || [fmpProfile.city, fmpProfile.state, fmpProfile.country].filter(Boolean).join(', ');
        enriched.website      = enriched.website      || fmpProfile.website;
        enriched.country      = enriched.country      || fmpProfile.country;
        enriched.ceo          = enriched.ceo          || fmpProfile.ceo;
        enriched.beta         = enriched.beta         ?? fmpProfile.beta;
        enriched.marketCap    = enriched.marketCap    ?? fmpProfile.mktCap;
        enriched.image        = enriched.image        || fmpProfile.image;
        enriched.phone        = enriched.phone        || fmpProfile.phone;
        enriched.address      = enriched.address      || fmpProfile.address;
        enriched.city         = enriched.city         || fmpProfile.city;
        enriched.state        = enriched.state        || fmpProfile.state;
        enriched.zip          = enriched.zip          || fmpProfile.zip;
        enriched.cik          = enriched.cik          || fmpProfile.cik;
        enriched._fmpProfile  = fmpProfile;
      }
    } catch (e) {
      console.warn('[enrichCompany] FMP profile fetch failed:', e.message);
    }
  }

  // ---- Source 4: SUPPLY_CHAINS — which chains is this ticker in? ----
  // Wraps findChainsForTicker(). Each match gives us: chain name, tier (up/mid/down),
  // role text. These are great for the Products + Geography subtabs because the
  // role text is often a one-line summary of what the company sells in that chain.
  try {
    if (typeof findChainsForTicker === 'function') {
      const chainMatches = findChainsForTicker(ticker);
      if (chainMatches?.length) {
        enriched._chainMatches = chainMatches;
      }
    }
  } catch (e) {
    console.warn('[enrichCompany] supply chain lookup failed:', e.message);
  }

  // ---- Source 5: Parse description for products ----
  // Even without external data, a good business description usually mentions
  // products by name. Run a lightweight extractor regardless of source.
  if (enriched.description) {
    enriched._products = extractProductsFromDescription(enriched.description, ticker);
  }

  // ---- Source 6: Wikidata products field (if Wikidata fetch returned them) ----
  if (wd?.products?.length) {
    enriched._wikidataProducts = wd.products;
  }

  // ---- Human product edits fold into the canonical lists (display + engine) ----
  try {
    if (typeof getOverride === 'function') {
      const rem = getOverride(ticker, 'productsRemoved') || [];
      const add = getOverride(ticker, 'productsAdded') || [];
      if (rem.length) {
        enriched._wikidataProducts = (enriched._wikidataProducts || []).filter(p => !rem.includes(p.name || p));
        enriched._products = (enriched._products || []).filter(p => !rem.includes(p));
      }
      // Human additions are authoritative — prepend so chain matching / display
      // treat them as known products, marked verified (not heuristic).
      if (add.length) enriched._humanProducts = add.slice();
    }
  } catch {}

  // ---- Human leadership edits fold into facts so the engine's leadership read
  // and the company preview share one record ----
  try {
    if (wd && typeof getEffectiveLeadership === 'function') {
      const eff = getEffectiveLeadership(ticker, wd);
      wd.executives = eff.executives;
      wd.board = eff.board;
      wd.founders = eff.founders;
    }
  } catch {}

  console.log(`[enrichCompany] ${ticker} final:`, {
    hasDescription: !!enriched.description,
    hasWikidata: !!wd,
    hasFmp: !!enriched._fmpProfile,
    chainMatches: enriched._chainMatches?.length || 0,
    extractedProducts: enriched._products?.length || 0,
    wikidataProducts: enriched._wikidataProducts?.length || 0,
  });

  return enriched;
}

async function fetchFmpCompanyProfile(ticker, apiKey) {
  if (!ticker || !apiKey) return null;
  // FMP has both /stable/ and /api/v3/ endpoints; v3 profile is more stable.
  const urls = [
    `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(ticker)}?apikey=${apiKey}`,
    `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        console.log(`[fmp-profile] ${url.replace(apiKey, '***')} → HTTP ${r.status}`);
        continue;
      }
      const j = await r.json();
      // v3 returns array, stable returns array or object
      const profile = Array.isArray(j) ? j[0] : (j?.profile || j);
      if (profile && (profile.companyName || profile.symbol)) {
        console.log(`[fmp-profile] ✓ ${ticker} loaded from ${url.split('?')[0].split('/').slice(-2).join('/')}`);
        return profile;
      }
    } catch (e) {
      console.log(`[fmp-profile] ${url.replace(apiKey, '***')} → error ${e.message}`);
    }
  }
  return null;
}

async function renderCompanyOverview() {
  const s = state.stock;
  if (!s) {
    console.warn('[company-overview] state.stock is null, aborting');
    return;
  }
  const el = document.getElementById('company-overview-body');
  if (!el) {
    console.error('[company-overview] #company-overview-body element NOT FOUND in DOM');
    // Try to find any container we could render into for diagnostic visibility
    const fallbackEl = document.querySelector('[data-cpanel="overview"]') || document.querySelector('.val-subpanel[data-subpanel="company"]');
    if (fallbackEl) {
      fallbackEl.innerHTML = `<div style="padding:30px;color:var(--red);font-family:var(--mono);font-size:11px;line-height:1.7">
        <strong>DOM ERROR:</strong> #company-overview-body element not found in the page.<br>
        Your index.html may be out of date. Please make sure you have the latest version.<br>
        Click ⚙ for full debug log.
      </div>`;
    }
    return;
  }
  console.log(`[company-overview] starting render for ${s.ticker}`);

  // ===== SYNCHRONOUS BASELINE RENDER (zero async dependencies) =====
  // Render real company info from the stockbook row + canonical data IMMEDIATELY,
  // before any network fetch. This guarantees the tab is never blank even if
  // every external source (Wikidata/FMP) fails or hangs. Enrichment below then
  // layers richer data on top when it arrives.
  try {
    const sb = (typeof getCanonicalStockData === 'function' ? getCanonicalStockData(s.ticker) : null) || s;
    const stockbookLoaded = !!(state.stockbook?.rows?.length);
    const hasCanonical = (typeof getCanonicalStockData === 'function') && !!getCanonicalStockData(s.ticker);
    const ctry = (typeof tickerCountry === 'function') ? tickerCountry(s.ticker) : { country: '—', flag: '' };
    const baselineFields = [
      ['Name', sb.name || s.name || s.ticker],
      ['Ticker', s.ticker],
      ['Sector', sb.sector || s.sector || '—'],
      ['Industry', sb.industry || s.industry || '—'],
      ['Sub-Sector', sb.subSector || s.subSector || '—'],
      ['Country', ctry.country !== '—' ? `${ctry.flag} ${ctry.country}` : '—'],
      ['Price', sb.price != null ? fmt$(sb.price) : '—'],
      ['Market Cap', sb.marketCap != null ? fmt$(sb.marketCap) : '—'],
      ['P/E', sb.pe != null ? sb.pe.toFixed(2) : '—'],
      ['Beta', sb.beta != null ? sb.beta.toFixed(2) : '—'],
      ['EPS', sb.eps != null ? fmt$(sb.eps) : '—'],
      ['Dividend Yield', sb.dividendYield != null ? (sb.dividendYield * 100).toFixed(2) + '%' : '—'],
    ];
    const descText = sb.description || s.description || '';
    const loadingHint = (!hasCanonical && !stockbookLoaded)
      ? `<div style="margin-top:10px;font-family:var(--mono);font-size:10px;color:var(--data-amber);line-height:1.6">⏳ Stockbook still loading — figures will fill in once it finishes. Richer company data (leadership, filings, products) loads below.</div>`
      : (!hasCanonical
        ? `<div style="margin-top:10px;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No stockbook row for ${escapeHtml(s.ticker)} yet — showing what's available. Click Fetch &amp; Value to populate fully.</div>`
        : '');
    el.innerHTML = `
      <div class="company-card">
        <h4>${escapeHtml(sb.name || s.ticker)} <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${escapeHtml(s.ticker)} · loading more…</span></h4>
        <div class="company-kv">
          ${baselineFields.map(([k, v]) => `<div class="company-kv-label">${k}</div><div class="company-kv-value">${escapeHtml(String(v))}</div>`).join('')}
        </div>
        ${descText ? `<div style="margin-top:14px;font-family:var(--serif);font-size:13px;line-height:1.6;color:var(--ink)">${escapeHtml(descText)}</div>` : ''}
        ${loadingHint}
      </div>
      <div id="company-overview-enriched" style="margin-top:0"></div>
    `;
    console.log('[company-overview] baseline rendered synchronously', { stockbookLoaded, hasCanonical });
  } catch (e) {
    console.error('[company-overview] baseline render failed:', e.message);
  }

  // Show diagnostic loading state immediately. If everything past this point
  // throws, at least the user sees the function actually fired.
  // (Baseline already rendered above — we only write into the enriched sub-div,
  // so the baseline stays visible while enrichment loads.)
  const _enrichedEl = document.getElementById('company-overview-enriched');

  // Run the multi-source enrichment chain. Pulls from Wikidata (GitHub) + FMP
  // profile + supply chain matches + description parsing. Returns a unified
  // object with everything the renderer needs, even when one or more sources
  // come back empty. This eliminates the "blank tab" failure mode that
  // happens when GitHub doesn't have a company JSON for this ticker.
  const enriched = await enrichCompanyData(s.ticker, s);
  const wd = enriched._wikidata || null;
  const fmpProfile = enriched._fmpProfile || null;
  console.log(`[company-overview] enriched data:`, {
    hasWikidata: !!wd, hasFmp: !!fmpProfile,
    chains: enriched._chainMatches?.length || 0,
    products: enriched._products?.length || 0,
  });

  // Merge canonical stock data with everything the enricher pulled. The
  // enriched object already has nested precedence done; pluck out the fields
  // the rest of this renderer expects.
  const merged = {
    name:         enriched.name         || s.ticker,
    description:  enriched.description  || null,
    sector:       enriched.sector       || null,
    industry:     enriched.industry     || null,
    subSector:    s.subSector           || null,
    exchange:     enriched.exchange     || null,
    currency:     enriched.currency     || 'USD',
    isin:         enriched.isin         || null,
    country:      enriched.country      || null,
    employees:    enriched.employees    ?? null,
    ipoDate:      enriched.ipoDate      || null,
    headquarters: enriched.headquarters || null,
    website:      enriched.website      || null,
    ceo:          enriched.ceo          || null,
  };
  console.log(`[company-overview] merged data:`, merged);

  const fmtMcap = v => fmt$(v);
  const fmtN = v => v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : String(v));

  // Source attribution badge — now reflects ALL the sources contributing
  const sources = [];
  if (wd) sources.push('WIKIDATA');
  if (fmpProfile) sources.push('FMP');
  if (s.name && s !== enriched) sources.push('STOCKBOOK');
  if (enriched._chainMatches?.length) sources.push('SUPPLY-CHAINS');
  const srcBadgeColor = sources.length >= 2 ? 'var(--pos)' : sources.length === 1 ? 'var(--amber)' : 'var(--ink-faint)';
  const srcBgColor    = sources.length >= 2 ? 'rgba(91,138,114,0.15)' : sources.length === 1 ? 'rgba(212,162,76,0.12)' : 'rgba(196,150,90,0.06)';
  const srcBadge = `<span style="display:inline-block;padding:1px 6px;background:${srcBgColor};color:${srcBadgeColor};font-family:var(--mono);font-size:9px;letter-spacing:0.1em;border-radius:2px;margin-left:8px" title="Active data sources">${sources.length ? sources.join(' · ') : 'STOCKBOOK ONLY'}</span>`;

  // Build sections piece by piece to avoid template-literal-with-await issues
  let identitySection = '';
  try {
    identitySection = `
      <div class="company-card">
        <h4>Identity ${srcBadge} <button class="btn btn-ghost" style="font-size:9px;padding:1px 7px;float:right" onclick="openContactEditor('${escapeHtml(s.ticker)}')">✎ contact</button></h4>
        <div class="company-kv">
          <div class="company-kv-label">Legal Name</div>     <div class="company-kv-value">${escapeHtml(merged.name)}</div>
          <div class="company-kv-label">Ticker</div>         <div class="company-kv-value" style="color:var(--amber);font-weight:700">${escapeHtml(s.ticker)}</div>
          <div class="company-kv-label">Exchange</div>       <div class="company-kv-value">${escapeHtml(merged.exchange || '—')}</div>
          <div class="company-kv-label">Currency</div>       <div class="company-kv-value">${escapeHtml(merged.currency)}</div>
          <div class="company-kv-label">ISIN</div>           <div class="company-kv-value">${escapeHtml(merged.isin || '—')}</div>
          <div class="company-kv-label">Headquarters</div>   <div class="company-kv-value">${escapeHtml(merged.headquarters || merged.country || '—')}</div>
        </div>
      </div>
    `;
  } catch (e) {
    console.error('[company-overview] identitySection build failed:', e.message);
  }

  let classificationSection = '';
  try {
    classificationSection = `
      <div class="company-card">
        <h4>Classification</h4>
        <div class="company-kv">
          <div class="company-kv-label">Sector</div>         <div class="company-kv-value">${escapeHtml(merged.sector || '—')}</div>
          <div class="company-kv-label">Industry</div>       <div class="company-kv-value">${escapeHtml(merged.industry || '—')}</div>
          <div class="company-kv-label">Sub-sector</div>     <div class="company-kv-value">${escapeHtml(merged.subSector || '—')}</div>
          <div class="company-kv-label">Market Cap</div>     <div class="company-kv-value">${fmtMcap(s.marketCap)}</div>
          <div class="company-kv-label">Employees</div>      <div class="company-kv-value">${fmtN(merged.employees)}</div>
          <div class="company-kv-label">Founded / IPO</div>  <div class="company-kv-value">${escapeHtml(merged.ipoDate || '—')}</div>
        </div>
      </div>
    `;
  } catch (e) {
    console.error('[company-overview] classificationSection build failed:', e.message);
  }

  const descriptionSection = `
    <div class="company-card">
      <h4>Business Description ${enriched._fmpProfile ? '<span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· from FMP</span>' : wd?.description ? '<span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· from Wikidata</span>' : ''}</h4>
      <div style="font-size:13px;line-height:1.7;color:var(--ink);font-family:var(--sans)">
        ${merged.description
          ? escapeHtml(merged.description)
          : `<div style="padding:14px;background:var(--bg-elev);border-left:3px solid var(--amber);border-radius:0 3px 3px 0;font-family:var(--mono);font-size:11px;color:var(--ink-dim);line-height:1.7">
              No description available from any data source for <strong style="color:var(--amber)">${escapeHtml(s.ticker)}</strong>.
              <br><br>
              <strong>To populate this section:</strong>
              <ul style="margin:8px 0 4px;padding-left:20px;line-height:1.7">
                <li>Add an FMP API key in <strong>Data Sources</strong> (free tier covers company profile)</li>
                <li>Wait for the nightly GitHub pipeline to fetch Wikidata coverage for this ticker</li>
                <li>Or manually edit <code style="color:var(--amber)">data/company/${escapeHtml(s.ticker)}.json</code> in the repo</li>
              </ul>
            </div>`
        }
      </div>
    </div>
  `;

  let foundersSection = '';
  const _effFounders = (typeof getEffectiveLeadership === 'function') ? getEffectiveLeadership(s.ticker, wd).founders : (wd?.founders || []);
  if (_effFounders.length) {
    try {
      foundersSection = `
        <div class="company-card">
          <h4>Founders</h4>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${_effFounders.map(f => `<span class="company-tag">${escapeHtml(f.name || f)}${f._humanAdded ? ' ✎' : ''}</span>`).join('')}
          </div>
        </div>
      `;
    } catch (e) {
      console.error('[company-overview] foundersSection build failed:', e.message);
    }
  }

  // Health score — build separately, await fully resolved, fall back gracefully
  let healthSection = '';
  if (typeof renderCompanyHealthScore === 'function') {
    try {
      healthSection = await renderCompanyHealthScore(s, wd);
    } catch (e) {
      console.error('[company-overview] renderCompanyHealthScore failed:', e.message);
      healthSection = '';
    }
  }

  // Stock-based comp disclosure — shows what SBC is doing to the numbers when
  // it's material. SBC inflates cash metrics and is excluded from "adjusted"
  // figures, so flagging it protects against being misled by non-GAAP results.
  let sbcSection = '';
  if (typeof analyzeStockBasedComp === 'function') {
    const sbcA = analyzeStockBasedComp(s);
    if (sbcA?.available) {
      const sevColor = sbcA.severity === 'severe' ? 'var(--neg)' : sbcA.severity === 'high' ? 'var(--data-amber)' : sbcA.severity === 'moderate' ? '#7faaca' : 'var(--pos)';
      const pct = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
      sbcSection = `
        <div class="company-card" style="border-left:3px solid ${sevColor}">
          <h4>Stock-Based Compensation <span style="color:${sevColor};font-size:9px;text-transform:uppercase;letter-spacing:0.05em">${sbcA.severity}</span></h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:10px">
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase">SBC</div><div style="font-family:var(--mono);font-size:15px;font-weight:700">${fmt$(sbcA.sbc)}</div></div>
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase">% of Revenue</div><div style="font-family:var(--mono);font-size:15px;font-weight:700;color:${sevColor}">${pct(sbcA.pctRevenue)}</div></div>
            ${sbcA.pctOcf != null ? `<div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase">% of Op Cash Flow</div><div style="font-family:var(--mono);font-size:15px;font-weight:700">${pct(sbcA.pctOcf)}</div></div>` : ''}
            ${sbcA.adjFcf != null ? `<div><div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase">SBC-Adjusted FCF</div><div style="font-family:var(--mono);font-size:15px;font-weight:700">${fmt$(sbcA.adjFcf)}</div></div>` : ''}
          </div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);line-height:1.7">
            <strong style="color:var(--ink)">What includes SBC:</strong><br>
            · GAAP net income & EPS — <span style="color:var(--pos)">expensed (included)</span><br>
            · Adjusted EBITDA / non-GAAP EPS — <span style="color:var(--neg)">usually excluded</span> (flatters results)<br>
            · Operating cash flow / FCF — <span style="color:var(--data-amber)">added back as non-cash</span>, inflating the cash figure${sbcA.fcfHaircut != null ? ` by ~${(sbcA.fcfHaircut*100).toFixed(0)}%` : ''}<br>
            ${sbcA.severity === 'high' || sbcA.severity === 'severe' ? `<span style="color:var(--neg)">⚠ At ${pct(sbcA.pctRevenue)} of revenue, SBC materially dilutes holders and inflates "adjusted" profitability. Lean on GAAP and the SBC-adjusted FCF above.</span>` : `SBC is modest here — limited distortion to the headline numbers.`}
          </div>
        </div>`;
    }
  }

  // ===== Leadership preview =====
  // Show the top 5 executives + 5 board members directly on Overview so the user
  // doesn't need to click into the Leadership subtab to see who runs the company.
  let leadershipPreviewSection = '';
  try {
    const eff = (typeof getEffectiveLeadership === 'function') ? getEffectiveLeadership(s.ticker, wd) : { executives: wd?.executives || [], board: wd?.board || [], founders: wd?.founders || [] };
    const execs = eff.executives.slice(0, 6);
    const board = eff.board.slice(0, 5);
    const founders = eff.founders.slice(0, 3);
    if (execs.length || board.length || founders.length) {
      const renderList = (label, people) => people.length ? `
        <div style="margin-bottom:14px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">${label} · ${people.length}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${people.map(p => `<span class="company-tag" title="${escapeHtml(p.role || label)}">${escapeHtml(p.name || p)}</span>`).join('')}
          </div>
        </div>
      ` : '';
      leadershipPreviewSection = `
        <div class="company-card">
          <h4>Leadership <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· top tracked individuals · click Leadership subtab for full career profiles</span>${(typeof editedMarker === 'function') ? editedMarker(s.ticker, 'leadership') : ''} <button class="btn btn-ghost" style="font-size:9px;padding:1px 7px;float:right" onclick="openLeadershipEditor('${escapeHtml(s.ticker)}')">✎ edit</button></h4>
          ${renderList('Executives', execs)}
          ${renderList('Board Members', board)}
          ${renderList('Founders', founders)}
        </div>
      `;
    }
  } catch (e) {
    console.error('[company-overview] leadership preview failed:', e.message);
  }

  // ===== SEC filings + external research links =====
  // Direct deep links to SEC EDGAR, IR pages, and other primary sources.
  // These cost nothing to render — they're just URLs — and they're the meat
  // of any serious company research workflow.
  const tic = s.ticker.toUpperCase();
  const isUSEquity = !tic.includes('=') && !tic.includes('-') && !tic.startsWith('^');
  const cikCandidate = wd?.cik || null;
  let filingsSection = '';
  if (isUSEquity) {
    const edgarSearch = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tic)}&type=&dateb=&owner=include&count=40`;
    const edgar10K   = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tic)}&type=10-K&dateb=&owner=include&count=10`;
    const edgar10Q   = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tic)}&type=10-Q&dateb=&owner=include&count=10`;
    const edgar8K    = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tic)}&type=8-K&dateb=&owner=include&count=20`;
    const edgarDEF14A = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tic)}&type=DEF+14A&dateb=&owner=include&count=10`;
    const edgarS1    = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tic)}&type=S-1&dateb=&owner=include&count=10`;
    const edgar13F   = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tic)}&type=13F&dateb=&owner=include&count=10`;
    filingsSection = `
      <div class="company-card">
        <h4>SEC Filings & External Research <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· direct deep links · primary sources only</span></h4>
        <div style="margin-bottom:14px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">SEC EDGAR — Primary Filings</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            <a class="company-tag amber" href="${edgar10K}"   target="_blank" rel="noopener" style="text-decoration:none">10-K (Annual) ↗</a>
            <a class="company-tag amber" href="${edgar10Q}"   target="_blank" rel="noopener" style="text-decoration:none">10-Q (Quarterly) ↗</a>
            <a class="company-tag amber" href="${edgar8K}"    target="_blank" rel="noopener" style="text-decoration:none">8-K (Current Events) ↗</a>
            <a class="company-tag amber" href="${edgarDEF14A}" target="_blank" rel="noopener" style="text-decoration:none">DEF 14A (Proxy) ↗</a>
            <a class="company-tag amber" href="${edgarS1}"    target="_blank" rel="noopener" style="text-decoration:none">S-1 (Reg. Statement) ↗</a>
            <a class="company-tag amber" href="${edgar13F}"   target="_blank" rel="noopener" style="text-decoration:none">13F (Institutional Hldrs) ↗</a>
            <a class="company-tag amber" href="${edgarSearch}" target="_blank" rel="noopener" style="text-decoration:none">All Filings ↗</a>
          </div>
        </div>
        <div style="margin-bottom:14px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">External Research</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${merged.website ? `<a class="company-tag" href="${escapeHtml(merged.website)}" target="_blank" rel="noopener" style="text-decoration:none">Company Website ↗</a>` : ''}
            <a class="company-tag" href="https://www.google.com/search?q=${encodeURIComponent(tic + ' investor relations')}" target="_blank" rel="noopener" style="text-decoration:none">Find IR Page ↗</a>
            <a class="company-tag" href="https://finance.yahoo.com/quote/${encodeURIComponent(tic)}" target="_blank" rel="noopener" style="text-decoration:none">Yahoo Finance ↗</a>
            <a class="company-tag" href="https://www.google.com/finance/quote/${encodeURIComponent(tic)}:NASDAQ" target="_blank" rel="noopener" style="text-decoration:none">Google Finance ↗</a>
            <a class="company-tag" href="https://www.morningstar.com/stocks/xnas/${encodeURIComponent(tic.toLowerCase())}/quote" target="_blank" rel="noopener" style="text-decoration:none">Morningstar ↗</a>
            <a class="company-tag" href="https://stockanalysis.com/stocks/${encodeURIComponent(tic.toLowerCase())}/" target="_blank" rel="noopener" style="text-decoration:none">Stock Analysis ↗</a>
            ${wd?.qid ? `<a class="company-tag" href="https://www.wikidata.org/wiki/${wd.qid}" target="_blank" rel="noopener" style="text-decoration:none">Wikidata ${wd.qid} ↗</a>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // ===== Products & Segments =====
  // Combines THREE sources so this card has content even when one fails:
  //   (a) Wikidata `products` field (when GitHub data is available)
  //   (b) Roles played in each Supply Chain (text descriptions like "Galaxy phones")
  //   (c) Products extracted from the business description (proper-noun heuristic)
  //
  // Each source gets its own labeled subsection so the user can see what came
  // from where. False positives in the heuristic-extracted list are marked
  // INFERRED so the user knows not to trust them blindly.
  let productsSection = '';
  try {
    const _pRemoved = getOverride(s.ticker, 'productsRemoved') || [];
    const _pAdded = getOverride(s.ticker, 'productsAdded') || [];
    const wdProducts = (enriched._wikidataProducts || []).filter(p => !_pRemoved.includes(p.name || p));
    // human additions come from enrichment now (so they also feed the engine)
    if (enriched._humanProducts?.length) _pAdded.push(...enriched._humanProducts.filter(p => !_pAdded.includes(p)));
    const chainRoles = (enriched._chainMatches || []).flatMap(m => m.roles || []);
    const extracted  = enriched._products || [];

    // Build the subsections only if they have content
    const wdProductsHtml = wdProducts.length ? `
      <div style="margin-bottom:14px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">From Wikidata · ${wdProducts.length} item${wdProducts.length === 1 ? '' : 's'}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${wdProducts.slice(0, 30).map(p => `<span class="company-tag">${escapeHtml(typeof p === 'string' ? p : (p.name || p.label || ''))}</span>`).join('')}
        </div>
      </div>
    ` : '';

    const chainRolesHtml = chainRoles.length ? `
      <div style="margin-bottom:14px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">Supply-Chain Roles · ${chainRoles.length}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${chainRoles.map(r => {
            const conf = r.confidence || 'inferred';
            const confColor = conf === 'verified' ? 'var(--pos)' : conf === 'disclosed' ? '#7faaca' : 'var(--data-amber)';
            return `<span class="company-tag" style="border-left:2px solid ${confColor}" title="${escapeHtml(r.tier + ' · ' + conf)}">${escapeHtml(r.role || '')}</span>`;
          }).join('')}
        </div>
      </div>
    ` : '';

    const extractedHtml = extracted.length ? `
      <div style="margin-bottom:14px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">
          Extracted from Description · ${extracted.length} candidate${extracted.length === 1 ? '' : 's'}
          <span style="color:var(--data-amber);font-size:9px;letter-spacing:0;text-transform:none;margin-left:6px">heuristic — may include false positives</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${extracted.map(p => `<span class="company-tag" style="opacity:0.75;border-left:2px solid var(--data-amber)" title="Inferred from text — verify against 10-K or company site">${escapeHtml(p)}</span>`).join('')}
        </div>
      </div>
    ` : '';

    const addedHtml = _pAdded.length ? `
      <div style="margin-bottom:14px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--amber);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">Human-Added · ${_pAdded.length}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${_pAdded.map(p => `<span class="company-tag" style="border-left:2px solid var(--amber)">${escapeHtml(p)} ✎</span>`).join('')}
        </div>
      </div>` : '';

    // Render whenever ANY source OR a human addition exists, so the manage
    // button (and added products) are always reachable.
    if (wdProductsHtml || chainRolesHtml || extractedHtml || addedHtml) {
      productsSection = `
        <div class="company-card">
          <h4>Products & Segments <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· multi-source · click Products subtab for full detail</span> <button class="btn btn-ghost" style="font-size:9px;padding:1px 7px;float:right" onclick="openProductsEditor('${escapeHtml(s.ticker)}')">✎ manage</button></h4>
          ${addedHtml}
          ${wdProductsHtml}
          ${chainRolesHtml}
          ${extractedHtml}
        </div>
      `;
    }
  } catch (e) {
    console.error('[company-overview] productsSection build failed:', e.message);
  }

  // ===== Supply Chain Position =====
  // Lists every supply chain this ticker participates in, with the tier
  // (upstream / midstream / downstream) and a link to the related chains
  // for deeper exploration. Even when the company tab has NO other data,
  // a ticker that's part of a supply chain still gets meaningful context.
  let supplyChainSection = '';
  try {
    const matches = enriched._chainMatches || [];
    if (matches.length) {
      const matchHtml = matches.map(m => {
        const tiers = m.tiers || [];
        const tierBadges = tiers.map(t => {
          const tierColor = t === 'upstream' ? 'var(--pos)' : t === 'midstream' ? '#7faaca' : 'var(--data-amber)';
          return `<span style="padding:1px 6px;background:rgba(91,138,114,0.12);color:${tierColor};border:1px solid ${tierColor};border-radius:2px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin-right:4px">${escapeHtml(t)}</span>`;
        }).join('');
        return `
          <div style="padding:10px 12px;background:var(--bg-elev);border:1px solid var(--rule);border-radius:3px;margin-bottom:8px;cursor:pointer" onclick="state.supplychain && (state.supplychain.viewMode='bychain', state.supplychain.searchQuery='${escapeHtml(m.chain.name).replace(/'/g, '')}', switchTab('supplychain'), renderSupplyChainTab())">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:6px">
              <strong style="color:var(--amber);font-family:var(--mono);font-size:11px;letter-spacing:0.04em">${escapeHtml(m.chain.name)}</strong>
              <div>${tierBadges}</div>
            </div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);line-height:1.5">${escapeHtml(m.chain.description || '')}</div>
            ${m.roles?.length ? `<div style="margin-top:6px;font-size:11px;color:var(--ink)">${m.roles.map(r => escapeHtml(r.role)).join(' · ')}</div>` : ''}
          </div>
        `;
      }).join('');
      supplyChainSection = `
        <div class="company-card">
          <h4>Supply Chain Position <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· click any chain to explore</span></h4>
          ${matchHtml}
        </div>
      `;
    }
  } catch (e) {
    console.error('[company-overview] supplyChainSection build failed:', e.message);
  }

  // ===== Connected Companies =====
  // The actual counterparties, not just chain names: for every chain this
  // ticker is in, list the OTHER companies by tier with their verified roles.
  // For AAPL this answers "who makes their chips" directly — TSM (foundry),
  // ASML (litho equipment), etc. Every chip is clickable to value that
  // company; these same links feed the engine's supplyChain signal (peer
  // momentum moves conviction) — display and engine read ONE dataset.
  let connectedSection = '';
  try {
    const matches = enriched._chainMatches || [];
    if (matches.length) {
      const me = (typeof _normalizeTickerForChainLookup === 'function') ? _normalizeTickerForChainLookup(enriched.ticker) : enriched.ticker;
      const tierMeta = {
        upstream:   { label: 'Suppliers & equipment',   note: 'upstream — they supply into this chain', color: 'var(--pos)' },
        midstream:  { label: 'Manufacturing & foundry', note: 'midstream — they make/process it',       color: '#7faaca' },
        downstream: { label: 'Customers & designers',   note: 'downstream — they buy/design on it',     color: 'var(--data-amber)' },
      };
      const blocks = [];
      for (const m of matches) {
        const tierHtml = ['upstream', 'midstream', 'downstream'].map(tk => {
          const entries = (m.chain[tk] || []).filter(e => {
            const et = (typeof _normalizeTickerForChainLookup === 'function') ? _normalizeTickerForChainLookup(e.ticker) : e.ticker;
            return et !== me;
          }).slice(0, 10);
          if (!entries.length) return '';
          const meta = tierMeta[tk];
          const chips = entries.map(e => {
            const conf = e.confidence === 'verified' ? '✓' : e.confidence === 'disclosed' ? '◐' : '?';
            const nm = e.name ? ` <span style="color:var(--ink-faint)">${escapeHtml(e.name)}</span>` : '';
            return `<div style="display:flex;align-items:baseline;gap:6px;padding:3px 0;border-bottom:1px dotted var(--rule)">
              <a href="#" onclick="event.preventDefault();openTickerInValuation('${escapeHtml(e.ticker)}')" style="font-family:var(--mono);font-weight:700;font-size:11px;color:${meta.color};text-decoration:none;min-width:64px">${escapeHtml(e.ticker)}</a>
              <span style="font-size:10px;color:var(--ink-dim);flex:1">${escapeHtml(e.role || '')}${nm}</span>
              <span title="${e.confidence || 'inferred'}" style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">${conf}</span>
            </div>`;
          }).join('');
          return `<div style="margin-bottom:10px">
            <div style="font-family:var(--mono);font-size:9px;letter-spacing:0.06em;text-transform:uppercase;color:${meta.color};margin-bottom:3px" title="${meta.note}">${meta.label}</div>
            ${chips}
          </div>`;
        }).join('');
        if (tierHtml) blocks.push(`<div style="margin-bottom:12px">
          <div style="font-family:var(--mono);font-size:10px;color:var(--amber);margin-bottom:6px">${escapeHtml(m.chain.name)}</div>
          ${tierHtml}
        </div>`);
      }
      if (blocks.length) {
        connectedSection = `
          <div class="company-card">
            <h4>Connected Companies <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ✓ verified filings · ◐ disclosed · tap any ticker to value it · these links feed the engine's supply-chain signal</span></h4>
            ${blocks.join('')}
          </div>`;
      }
    }
  } catch (e) {
    console.error('[company-overview] connectedSection build failed:', e.message);
  }

  // ===== Cross-Asset Context =====
  // Surfaces the cross-asset signals relevant to THIS ticker's sector. The
  // mapping is intentional: a Materials stock cares more about industrial
  // demand + dollar; an Energy stock cares more about energy + dollar; an
  // Industrial cares about logistics + chain performance; a Tech stock about
  // global indices + safe-haven (defensive rotation hurts it).
  //
  // We don't try to be comprehensive — each sector gets 3-4 most-relevant
  // signals. Less noise, more signal. The Macro Quad tab shows the full set
  // when the user wants the broad view.
  let crossAssetSection = '';
  try {
    const xa = extractCrossAssetSignals();
    const sectorRaw = (s.sector || '').toLowerCase();
    // Pick which signals to surface based on sector
    let keys = [];
    if (/material|chem|metal/.test(sectorRaw))         keys = ['industrialDemand', 'dollarStrength', 'logisticsMomentum', 'chainPerformance'];
    else if (/energy/.test(sectorRaw))                 keys = ['energyComplex', 'dollarStrength', 'logisticsMomentum', 'macroAlignment'];
    else if (/industrial/.test(sectorRaw))             keys = ['logisticsMomentum', 'industrialDemand', 'energyComplex', 'chainPerformance'];
    else if (/financial/.test(sectorRaw))              keys = ['globalIndices', 'macroAlignment', 'dollarStrength', 'safeHavenBid'];
    else if (/utilit/.test(sectorRaw))                 keys = ['safeHavenBid', 'energyComplex', 'macroAlignment', 'dollarStrength'];
    else if (/consumer.*defensive|staples/.test(sectorRaw)) keys = ['safeHavenBid', 'agriculturalGoods', 'dollarStrength', 'macroAlignment'];
    else if (/consumer.*cyclical|discretionary/.test(sectorRaw)) keys = ['globalIndices', 'macroAlignment', 'dollarStrength', 'logisticsMomentum'];
    else if (/tech/.test(sectorRaw))                   keys = ['globalIndices', 'macroAlignment', 'safeHavenBid', 'chainPerformance'];
    else if (/health/.test(sectorRaw))                 keys = ['safeHavenBid', 'macroAlignment', 'dollarStrength', 'globalIndices'];
    else if (/real.?estate/.test(sectorRaw))           keys = ['safeHavenBid', 'macroAlignment', 'dollarStrength', 'logisticsMomentum'];
    else if (/communication/.test(sectorRaw))          keys = ['globalIndices', 'macroAlignment', 'dollarStrength', 'chainPerformance'];
    // Foreign-listing tickers care extra about FX
    else if (/\.(ks|tw|hk|t|l|sr|sz|ss)$/i.test(s.ticker)) keys = ['dollarStrength', 'globalIndices', 'macroAlignment', 'chainPerformance'];
    else keys = ['macroAlignment', 'globalIndices', 'safeHavenBid', 'dollarStrength'];

    crossAssetSection = `
      <div class="company-card">
        <h4>Cross-Asset Context
          <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· market signals most relevant to ${escapeHtml(s.sector || s.ticker)}</span>
        </h4>
        <div class="cross-asset-grid">${renderCrossAssetSignalCards(xa.signals, keys)}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);line-height:1.6;margin-top:8px;padding-top:8px;border-top:1px dashed var(--rule)">
          These signals are LIVE intraday observations + the CACHED regime call. They are <em>context</em> for valuing this ticker — not a buy/sell signal. See Macro Quad for the full cross-asset dashboard.
        </div>
      </div>
    `;
  } catch (e) {
    console.warn('[company-overview] cross-asset section failed:', e.message);
  }

  // ===== News Per Ticker =====
  // Surfaces ONLY articles where this ticker appears (either as the primary
  // ticker field or in the entities array — covers both "AAPL beats" and
  // "Microsoft, Apple, Google announce…" cases).
  //
  // The user asked specifically: "news only for the unique ticker being valued
  // or when the unique ticker is mentioned." So we check both fields.
  //
  // Top 8 most recent, sorted by datetime descending. Click → opens News tab.
  let tickerNewsSection = '';
  try {
    const allItems = (state.news?.items?.length ? state.news.items : null)
      || ((typeof loadNewsCache === 'function') ? (loadNewsCache()?.items || []) : []);
    const tic = (s.ticker || '').toUpperCase();
    if (allItems.length > 0 && tic) {
      // Match if tx.ticker === ticker OR entities array contains the ticker
      const tickerArticles = allItems.filter(n => {
        if (!n.headline) return false;
        const primaryMatch = (n.ticker || '').toUpperCase() === tic;
        const entityMatch = Array.isArray(n.entities) && n.entities.some(e =>
          (typeof e === 'string' ? e : e?.ticker || '').toUpperCase() === tic
        );
        const headlineMention = (n.headline || '').toUpperCase().includes(tic + ' ')
                             || (n.headline || '').toUpperCase().includes(' ' + tic);
        return primaryMatch || entityMatch || headlineMention;
      });
      // Sort by datetime desc
      tickerArticles.sort((a, b) => {
        const ta = new Date(a.datetime || a.publishedAt || 0).getTime();
        const tb = new Date(b.datetime || b.publishedAt || 0).getTime();
        return tb - ta;
      });
      // Show 8 by default, all when expanded (per-ticker toggle).
      const _expandKey = `_companyNewsExpanded_${tic}`;
      const expanded = !!window[_expandKey];
      const shown = expanded ? tickerArticles : tickerArticles.slice(0, 8);
      const articles = shown;
      const articleStates = typeof loadArticleStates === 'function' ? loadArticleStates() : {};
      const articleRows = tickerArticles.length === 0
        ? `<div style="color:var(--ink-faint);font-family:var(--mono);font-size:11px;padding:14px 0;font-style:italic">No news articles yet mentioning ${escapeHtml(tic)}. The news pipeline pulls market-cap-sorted articles nightly — check back after the next refresh.</div>`
        : articles.map(n => {
            const dt = n.datetime || n.publishedAt;
            const when = dt ? (typeof fmtRelativeTime === 'function' ? fmtRelativeTime(dt) : new Date(dt).toLocaleDateString()) : '';
            const priorityColor = n.priority === 'critical' ? 'var(--red)'
                                : n.priority === 'high'     ? '#e0b04c'
                                : n.priority === 'medium'   ? '#7faaca'
                                : 'var(--ink-faint)';
            const isRead = articleStates?.[typeof articleKey === 'function' ? articleKey(n) : '']?.status === 'read';
            const aKey = (typeof articleKey === 'function' ? articleKey(n) : (n.url || n.headline || '')).replace(/'/g, "\\'");
            return `
              <div class="ticker-news-row${isRead ? ' read' : ''}" style="cursor:pointer;display:flex;align-items:flex-start;gap:6px">
                <div class="ticker-news-priority" style="background:${priorityColor}"></div>
                <div class="ticker-news-content" onclick="switchTab('news')" style="flex:1">
                  <div class="ticker-news-headline">${escapeHtml(n.headline)}</div>
                  <div class="ticker-news-meta">
                    ${n.source ? `<span>${escapeHtml(n.source)}</span> · ` : ''}
                    ${when ? `<span>${escapeHtml(when)}</span>` : ''}
                    ${n.priority ? ` · <span style="color:${priorityColor};text-transform:uppercase;font-weight:600">${escapeHtml(n.priority)}</span>` : ''}
                  </div>
                </div>
                <button onclick="event.stopPropagation();removeCompanyNewsArticle('${aKey}','${escapeHtml(tic)}')" title="Remove this article and send it to Review (wrong ticker / didn't pull right)" style="background:transparent;border:none;color:var(--ink-faint);cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0" onmouseover="this.style.color='var(--neg)'" onmouseout="this.style.color='var(--ink-faint)'">✕</button>
              </div>
            `;
          }).join('');
      tickerNewsSection = `
        <div class="company-card">
          <h4>News for ${escapeHtml(tic)}
            <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· articles where ${escapeHtml(tic)} appears · ✕ removes &amp; sends to Review</span>
          </h4>
          <div class="ticker-news-list">
            ${articleRows}
          </div>
          ${tickerArticles.length > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:10px">
            <span style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.08em">Showing ${articles.length} of ${tickerArticles.length}</span>
            ${tickerArticles.length > 8 ? `<button onclick="window['${_expandKey}']=${!expanded};renderCompanyOverview()" style="background:transparent;border:1px solid var(--rule);color:var(--amber);font-family:var(--mono);font-size:9px;padding:4px 10px;border-radius:3px;cursor:pointer">${expanded ? '▲ Show less' : `▼ See all ${tickerArticles.length}`}</button>` : ''}
          </div>` : ''}
        </div>
      `;
    }
  } catch (e) {
    console.warn('[company-overview] ticker-news section failed:', e.message);
  }

  // Final assembly — done as string concatenation, not template literal, so a
  // failure in one section doesn't blank the whole page. Written into the
  // enriched sub-div so the synchronous baseline stays put if this is sparse.
  const html =
    '<div class="company-grid-two">' +
      identitySection +
      classificationSection +
    '</div>' +
    descriptionSection +
    productsSection +
    supplyChainSection +
    connectedSection +
    crossAssetSection +
    tickerNewsSection +
    leadershipPreviewSection +
    foundersSection +
    '<div id="company-13f-holders"></div>' +
    '<div id="company-sec-filings"></div>' +
    filingsSection +
    sbcSection +
    healthSection;

  const target = document.getElementById('company-overview-enriched') || el;
  target.innerHTML = html;
  // Remove the "loading more…" hint from the baseline header now enrichment is in
  const hint = el.querySelector('.company-card h4 span');
  if (hint && /loading more/.test(hint.textContent)) hint.remove();
  console.log(`[company-overview] enriched innerHTML written, length=${target.innerHTML.length}`);

  // Async-fill the institutional holders section (13F). Non-blocking; if no
  // 13F data is staged, it stays empty rather than showing an error.
  if (typeof renderCompany13fHolders === 'function') {
    renderCompany13fHolders(s.ticker).catch(() => {});
    if (typeof renderCompanySecFilings === 'function') renderCompanySecFilings(s.ticker).catch(() => {});
  }
}

async function renderCompany13fHolders(ticker) {
  const host = document.getElementById('company-13f-holders');
  if (!host || !ticker) return;
  if (typeof load13fByCusip !== 'function') return;
  let byCusip = {};
  try { byCusip = await load13fByCusip(); } catch { return; }
  if (!byCusip || !Object.keys(byCusip).length) return;  // no data staged yet

  const tic = ticker.toUpperCase();
  const cusip = (typeof _tickerCusip === 'function') ? _tickerCusip(tic) : null;
  let holders = [];
  if (cusip && byCusip[cusip]) {
    holders = byCusip[cusip];
  } else {
    const row = (typeof getStockbookRow === 'function') ? getStockbookRow(tic) : null;
    const firstWord = (row?.name || tic).toLowerCase().split(' ')[0];
    if (firstWord && firstWord.length >= 4) {
      for (const entries of Object.values(byCusip)) {
        for (const e of entries) {
          if ((e.name || '').toLowerCase().includes(firstWord)) holders.push(e);
        }
      }
    }
  }
  if (!holders.length) return;  // no tracked institution holds it — stay silent

  holders.sort((a, b) => (b.value || 0) - (a.value || 0));
  const changeColor = (typeof _13fChangeColor === 'function') ? _13fChangeColor : () => 'var(--ink-dim)';
  const changeLabel = (typeof _13fChangeLabel === 'function') ? _13fChangeLabel : (c) => c;
  // Format a 13F period (quarter-end date) into a readable "as of" label.
  const _fmtPeriod = (p) => {
    if (!p) return '—';
    const d = new Date(p + (p.length === 10 ? 'T00:00:00Z' : ''));
    if (isNaN(d)) return p;
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Q${q} ${d.getUTCFullYear()}`;
  };
  // The newest period present across holders — surfaced in the header so the
  // whole table's "as of" date is obvious at a glance.
  const _periods = holders.map(h => h.period).filter(Boolean).sort();
  const _latestPeriod = _periods.length ? _periods[_periods.length - 1] : null;
  const rows = holders.map(h => {
    const isOpt = h.option === 'PUT' || h.option === 'CALL';
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px;font-weight:700">${escapeHtml(h.institution)}</td>
      <td style="font-family:var(--mono);font-size:11px;text-align:right">$${(h.value / 1e6).toFixed(1)}M</td>
      <td style="font-family:var(--mono);font-size:11px;text-align:right">${(h.shares || 0).toLocaleString()}</td>
      <td style="font-family:var(--mono);font-size:11px;font-weight:700;color:${changeColor(h.change)}">${changeLabel(h.change)}</td>
      <td style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);white-space:nowrap" title="13F reporting period (quarter-end the filing covers)${h.period ? ' · ' + h.period : ''}">${_fmtPeriod(h.period)}</td>
      <td style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">${isOpt ? h.option + ' (mkt value)' : 'equity'}</td>
    </tr>`;
  }).join('');
  host.innerHTML = `
    <div class="company-card">
      <h4>Institutional Holders (13F) <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· tracked institutions${_latestPeriod ? ' · as of ' + _fmtPeriod(_latestPeriod) + ' (' + _latestPeriod + ')' : ''} · Q/Q changes</span></h4>
      <div style="overflow-x:auto">
        <table class="sb-table" style="width:100%;min-width:580px">
          <thead><tr><th>Institution</th><th style="text-align:right">Market Value</th><th style="text-align:right">Shares</th><th>Q/Q Change</th><th>Reported</th><th>Type</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:8px">Among ${holders.length} tracked institution(s). "Reported" = the 13F period each filing covers (quarter-end); filings post ~45 days after. Press F2 → THF for full institutional portfolios.</div>
    </div>`;
}

async function renderCompanySecFilings(ticker) {
  const host = document.getElementById('company-sec-filings');
  if (!host || !ticker) return;
  if (typeof loadSecFilings !== 'function') return;
  let filings = {};
  try { filings = await loadSecFilings(); } catch { return; }
  const rec = filings[ticker.toUpperCase()];
  if (!rec || !rec.filings || !rec.filings.length) return;  // nothing staged

  const formColor = (f) => f.startsWith('10-K') || f === '20-F' ? 'var(--pos)'
    : f.startsWith('10-Q') || f === '6-K' ? '#7faaca'
    : f.startsWith('8-K') ? 'var(--data-amber)' : 'var(--ink-dim)';
  const rows = rec.filings.slice(0, 10).map(f => `
    <tr>
      <td style="font-family:var(--mono);font-size:11px;font-weight:700;color:${formColor(f.form)}">${escapeHtml(f.form)}</td>
      <td style="font-family:var(--mono);font-size:11px">${f.filed || '—'}</td>
      <td style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">${f.period || ''}</td>
      <td style="text-align:right">${f.url ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener" style="color:var(--amber);text-decoration:none;font-size:10px">view ↗</a>` : ''}</td>
    </tr>`).join('');
  const le = rec.latestEarnings;
  const leNote = le?.filed
    ? `Latest earnings filing: <strong>${le.form}</strong> on ${le.filed}`
    : '';
  host.innerHTML = `
    <div class="company-card">
      <h4>Recent SEC Filings <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· EDGAR · 10-K/10-Q earnings · 8-K events</span></h4>
      ${leNote ? `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);margin-bottom:8px">${leNote}</div>` : ''}
      <div style="overflow-x:auto">
        <table class="sb-table" style="width:100%;min-width:420px">
          <thead><tr><th>Form</th><th>Filed</th><th>Period</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
