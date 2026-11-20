/* ==========================================================================
   businessweb.js — THE BUSINESS WEB (z197, STATUS §1e).

   Owner 11-19: "I need the system to understand every single business inside of the system … how different
   companies are invested in each other and how they also use each other … Nvidia in the circular financing … it
   needs to be understood for their profits and their debts as well."

   Reads TRAPP2-ANALYTICS data/web/ (pipeline/web_build.py, weekdays with the early-warning run):
     money.json   - typed, sourced money edges (owns / funds / commits / supplies / underwrites), LOOPS (money that
                    comes back to where it started) and per-company circularity
     chains.json  - every supply chain; the app merges the subsector chains it doesn't have, and adopts each link's
                    audited confidence (filing / disclosed / reported / inferred) for the chains it does
     nodes.json   - per ticker: chains + stage, SEC money structure, index weights, rating, money links, IPO events
                    (loaded only when a company page opens)
   z198 (P1): the SEC money structure adds backlog (RPO), purchase obligations and equity stakes (equity-method, listed,
   private); 'backlog from tracked buyers' sets the commitments in the web against the backlog a company reports.
   z199 (P1): WHO OWNS 5 %+ OF IT, from the filings - the company card reads the company's SEC doc
   (TRAPP2-ANALYTICS data/sec/<T>.json, ~30 KB, only when its page opens) for its Schedule 13D / 13G holders (name,
   % of the class, passive 13G vs active 13D, the filer type, a 13D's stated purpose, exits below 5 %) and its SEC
   profile (SIC industry, incorporation, fiscal year end, former names). A holder that is itself a company in the
   universe is a money edge with confidence 'filing'; the money panel lists those stakes.
   z199: CUSIPs from the same filings (data/sec/cusips.json) let the app's 13F holders section match by CUSIP instead
   of by name.
   z200: Macro Data → "Supply Chains & Business Web" - the Supply Chains page gains four Business Web views (Companies,
   Money links, Ownership, Loops & circularity): sortable, filterable tables; ▸ opens a company's full Business Web in
   place; config chains marked `rev` replace the app's copy (dead tickers fixed in data, not in app.js).
   Gives the app:
     WEB (3D)  - lenses "Money web" and "Money web - loops only" (arrows = the direction money / value flows)
     Company   - a Business Web card on the company page (money links, circularity, chains, index weights, the SEC
                 money structure, IPO lock-ups / quiet period / underwriters)
   In-memory only - nothing is written to browser storage.
   ========================================================================== */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const raw = () => { try { if (typeof GH_RAW !== 'undefined') return GH_RAW; } catch (e) {} return 'https://raw.githubusercontent.com/TheMostLocal'; };
  const TTL = 30 * 60 * 1000;
  const C = {}, AT = {}, PEND = {}, FAIL = {};
  const SEC = new Map();                       // ticker -> { at, doc } - one company's SEC doc, in memory only

  async function getSec(t) {
    const hit = SEC.get(t);
    if (hit && Date.now() - hit.at < TTL) return hit.doc;
    let doc = null;
    try {
      const r = await fetch(`${raw()}/TRAPP2-ANALYTICS/main/data/sec/${encodeURIComponent(t)}.json`, { cache: 'no-cache' });
      if (r.ok) doc = await r.json();
    } catch (e) {}
    if (SEC.size > 40) SEC.delete(SEC.keys().next().value);
    SEC.set(t, { at: Date.now(), doc });
    return doc;
  }

  async function get(name, force) {
    if (!force && C[name] && Date.now() - AT[name] < TTL) return C[name];
    if (PEND[name]) return PEND[name];
    PEND[name] = (async () => {
      try {
        const r = await fetch(`${raw()}/TRAPP2-ANALYTICS/main/data/web/${name}.json`, { cache: 'no-cache' });
        if (r.ok) { C[name] = await r.json(); AT[name] = Date.now(); FAIL[name] = false; } else FAIL[name] = true;
      } catch (e) { FAIL[name] = true; }
      PEND[name] = null;
      return C[name] || null;
    })();
    return PEND[name];
  }

  const usd = v => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    return (v < 0 ? '−$' : '$') + (a >= 1e12 ? (a / 1e12).toFixed(2) + 'tn' : a >= 1e9 ? (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'bn' : a >= 1e6 ? (a / 1e6).toFixed(0) + 'M' : a.toFixed(0));
  };
  const mono = 'font-family:var(--mono)';
  const small = `${mono};font-size:9.5px;color:var(--ink-faint)`;
  const TYPE_COL = { owns: '#8a8fd4', funds: '#4ec9a8', commits: '#d4a24c', supplies: '#7faaca', underwrites: '#c47ba0' };
  const TYPE_WORD = { owns: 'owns', funds: 'funds', commits: 'commits to buy from', supplies: 'supplies', underwrites: 'underwrote' };
  const CONF_COL = { filing: 'var(--pos)', disclosed: '#7faaca', reported: '#c0a060', inferred: 'var(--data-amber)' };
  const SECTOR_COL = { Technology: '#5b9ad4', 'Financial Services': '#8a8fd4', Financials: '#8a8fd4', 'Communication Services': '#c47ba0',
                       'Consumer Cyclical': '#c47ba0', Industrials: '#7faaca', Energy: '#d4a24c', Utilities: '#6db3b3', 'Real Estate': '#9a7b5a' };

  // ---- money direction: who pays whom (mirrors pipeline/web_build.py flow()) ----------------------------------
  function flow(e) {
    if (e.type === 'owns') return e.instrument === 'warrant' ? [e.to, e.from] : [e.from, e.to];
    if (e.type === 'supplies' || e.type === 'underwrites') return [e.to, e.from];
    return [e.from, e.to];
  }
  const backTxt = c => [c.committedBackUSD ? usd(c.committedBackUSD) : null, c.committedBackGW ? `${c.committedBackGW} GW` : null].filter(Boolean).join(' / ') || '—';
  function edgeAmount(e) {
    const bits = [];
    if (e.amountUSD) bits.push(usd(e.amountUSD));
    if (e.gw) bits.push(`${e.gw} GW`);
    if (e.valueUSD) bits.push(`${usd(e.valueUSD)} (13F)`);
    if (e.pct) bits.push(e.pctApprox ? `≈${e.pct}%` : e.confidence === 'filing' && e.kind13 ? `${e.pct}%` : `~${e.pct}%`);
    if (e.pctFiled != null && e.pctFiled !== e.pct) bits.push(`filed ${e.pctFiled}%`);
    if (e.f13 && e.f13.valueUSD) bits.push(`13F ${usd(e.f13.valueUSD)}`);
    if (e.instrument === 'warrant') bits.push('warrant');
    return bits.join(' · ');
  }

  // ---- 1) supply chains: merge subsector chains, adopt audited confidence --------------------------------------
  let merged = null;
  async function mergeChains() {
    if (merged) return merged;
    const d = await get('chains');
    if (!d || !Array.isArray(d.chains) || typeof SUPPLY_CHAINS === 'undefined' || !Array.isArray(SUPPLY_CHAINS)) return { added: 0, relabelled: 0 };
    const have = new Map(SUPPLY_CHAINS.map(c => [c.id, c]));
    let added = 0, relabelled = 0, revised = 0;
    for (const c of d.chains) {
      if (!c || !c.id) continue;
      const mine = have.get(c.id);
      if (!mine) {
        SUPPLY_CHAINS.push(Object.assign({}, c, { _source: 'TRAPP2-ANALYTICS config/supply_chains.json' }));
        added++;
        continue;
      }
      if (c.rev) {                                    // z200: a revised chain in the config replaces the app's copy (members, description)
        for (const k of ['upstream', 'midstream', 'downstream']) mine[k] = (c[k] || []).map(m => Object.assign({}, m));
        if (c.description) mine.description = c.description;
        mine._rev = c.rev;
        revised++;
        continue;
      }
      for (const k of ['upstream', 'midstream', 'downstream']) {
        const theirs = new Map((c[k] || []).map(m => [String(m.ticker || m.name || '').toUpperCase(), m]));
        for (const m of mine[k] || []) {
          const t = theirs.get(String(m.ticker || m.name || '').toUpperCase());
          if (t && t.confidence && (t.confidence !== m.confidence || t.audit !== m.audit)) {
            m.confidence = t.confidence;
            if (t.audit) m.audit = t.audit; else delete m.audit;
            relabelled++;
          }
        }
      }
    }
    merged = { added, relabelled, revised, at: d.asOf };
    try {
      if ((added || revised) && typeof renderSupplyChainTab === 'function' && document.getElementById('sc-content') && document.getElementById('sc-content').offsetParent) renderSupplyChainTab();
      if (added && typeof window.webLensRefresh === 'function') window.webLensRefresh();
    } catch (e) {}
    return merged;
  }

  // ---- 2) the WEB money lens ----------------------------------------------------------------------------------
  function graph(lens) {
    const m = C.money;
    if (!m || !Array.isArray(m.edges)) { get('money').then(d => { if (d && typeof window.webRebuild === 'function') window.webRebuild(); }); return null; }
    const loopEdges = new Set((m.loops || []).flatMap(L => L.edges || []));
    const onlyLoops = lens === 'money:loops';
    const edges = (m.edges || []).filter(e => !onlyLoops || loopEdges.has(e.id));
    const ids = new Map();
    const nodes = [];
    const names = m.names || {}, sectors = m.sectors || {}, ents = m.entities || {}, circ = m.circularity || {};
    const node = t => {
      if (ids.has(t)) return ids.get(t);
      const ent = ents[t] || {};
      const sector = sectors[t] || ent.sector || 'Other';
      const n = { ticker: t, name: names[t] || ent.name || t, sector, chains: new Set(), tiers: new Set(), degree: 0,
                  color: ent.kind === 'private' ? '#9a8fb0' : (SECTOR_COL[sector] || '#9a9387'),
                  money: { kind: ent.kind || 'public', out: [], in: [], circ: circ[t] || null, loops: 0, note: (m.nodeNotes || {})[t] || null } };
      ids.set(t, nodes.length);
      nodes.push(n);
      return ids.get(t);
    };
    const out = [];
    for (const e of edges) {
      const [a, b] = flow(e);
      const ia = node(a), ib = node(b);
      nodes[ia].degree++; nodes[ib].degree++;
      nodes[ia].money.out.push(e); nodes[ib].money.in.push(e);
      out.push({ a: ia, b: ib, w: 1, col: TYPE_COL[e.type] || '#999', dir: true, loop: loopEdges.has(e.id), type: e.type, id: e.id });
    }
    for (const L of m.loops || []) for (const t of new Set((L.path || []).slice(0, -1))) if (ids.has(t)) nodes[ids.get(t)].money.loops++;
    nodes.forEach((n, i, arr) => {
      const phi = Math.acos(1 - 2 * (i + 0.5) / arr.length), th = Math.PI * (1 + Math.sqrt(5)) * i, R = 200;
      Object.assign(n, { x: R * Math.sin(phi) * Math.cos(th), y: R * Math.sin(phi) * Math.sin(th), z: R * Math.cos(phi), vx: 0, vy: 0, vz: 0 });
    });
    return { nodes, edges: out };
  }

  function tooltip(n) {
    const mo = n.money || {};
    const line = (e, dirWord) => `<div style="color:var(--ink-dim)"><span style="color:${TYPE_COL[e.type]}">■</span> ${esc(e.label || `${e.from} ${TYPE_WORD[e.type]} ${e.to}`)}${edgeAmount(e) ? ` <span style="color:var(--ink-faint)">(${esc(edgeAmount(e))})</span>` : ''}</div>`;
    const all = [...(mo.out || []), ...(mo.in || [])];
    const c = mo.circ;
    return `<strong style="color:var(--amber)">${esc(n.ticker)}</strong> · ${esc(n.name)}${mo.kind === 'private' ? ' <span style="color:var(--ink-faint)">(private)</span>' : ''}<br>
      <span style="color:var(--ink-faint)">${all.length} money link${all.length === 1 ? '' : 's'} · in ${mo.loops || 0} loop${mo.loops === 1 ? '' : 's'}</span>
      ${all.slice(0, 5).map(e => line(e)).join('')}${all.length > 5 ? `<div style="color:var(--ink-faint)">+${all.length - 5} more - see the list below</div>` : ''}
      ${c ? `<div style="margin-top:4px;color:var(--ink)">Funds its own buyers: ${esc(usd(c.investedUSD))} in → ${esc(backTxt(c))} committed back${c.committedBackToRevenue != null ? ` (${(c.committedBackToRevenue * 100).toFixed(0)}% of a year's revenue)` : ''}</div>` : ''}`;
  }

  function panelHtml(lens) {
    const m = C.money;
    if (!m) return `<div style="${small};padding:8px">${FAIL.money ? 'No money web yet: TRAPP2-ANALYTICS data/web/money.json appears after the Early warning workflow runs with the z197 Business Web step (weekdays 0920 / 1840 ET).' : 'Loading the money web…'}</div>`;
    const byId = Object.fromEntries((m.edges || []).map(e => [e.id, e]));
    const loops = (m.loops || []).map(L => {
      const steps = (L.edges || []).map(id => byId[id]).filter(Boolean);
      return `<li style="margin:3px 0;line-height:1.5"><strong style="color:var(--ink)">${esc((L.path || []).join(' → '))}</strong>
        <span style="color:var(--ink-faint)"> · </span>${steps.map(e => `<span title="${esc((e.events || []).map(v => `${v.date || ''} ${v.text || ''}`).join(' | '))}"><span style="color:${TYPE_COL[e.type]}">${esc(e.type)}</span> ${esc(edgeAmount(e) || '')} <span style="color:${CONF_COL[e.confidence] || 'var(--ink-faint)'}">${esc(e.confidence || '')}</span></span>`).join('<span style="color:var(--ink-faint)"> → </span>')}</li>`;
    }).join('');
    const circ = Object.entries(m.circularity || {}).sort((a, b) => (b[1].committedBackUSD || 0) - (a[1].committedBackUSD || 0)).map(([t, c]) =>
      `<tr><td style="text-align:left;color:var(--amber)">${esc(t)}</td><td style="text-align:left">${esc((c.fundedBuyers || []).map(f => `${f.to} (${f.how})`).join(', '))}</td>
        <td>${esc(usd(c.investedUSD))}</td><td>${esc(backTxt(c))}</td>
        <td>${c.committedBackToRevenue != null ? (c.committedBackToRevenue * 100).toFixed(0) + '%' : '<span style="color:var(--ink-faint)" title="no current SEC revenue on file">—</span>'}</td><td>${c.loops}</td></tr>`).join('');
    const blog = Object.entries(m.backlog || {}).filter(([, b]) => b.commitIn || b.commitGW).sort((a, b) => (b[1].commitIn || 0) - (a[1].commitIn || 0)).map(([t, b]) =>
      `<tr><td style="text-align:left;color:var(--amber)">${esc(t)}</td><td style="text-align:left">${esc((b.from || []).map(x => x.buyer).join(', '))}</td>
        <td>${esc([b.commitIn ? usd(b.commitIn) : null, b.commitGW ? b.commitGW + ' GW' : null].filter(Boolean).join(' / '))}</td><td>${b.rpo ? esc(usd(b.rpo)) : '<span style="color:var(--ink-faint)" title="no RPO on file yet (SEC facts refresh)">—</span>'}</td>
        <td>${b.shareOfRpo != null ? Math.round(b.shareOfRpo * 100) + '%' : '—'}</td><td>${b.yearsOfRevenue != null ? b.yearsOfRevenue : '—'}</td></tr>`).join('');
    const own = (m.edges || []).filter(e => e.type === 'owns' && (e.kind13 || e.pctFiled != null))
      .sort((a, b) => ((b.pctFiled != null ? b.pctFiled : b.pct) || 0) - ((a.pctFiled != null ? a.pctFiled : a.pct) || 0)).map(e => {
        const ev = (e.events || []).filter(v => v.src === 'SEC').slice(-1)[0] || {};
        const pct = e.pctFiled != null ? e.pctFiled : e.pct;
        const pctTxt = pct != null ? (e.pctApprox && e.pctFiled == null ? '≈' : '') + esc(pct) + '%' : e.valueUSD ? esc(usd(e.valueUSD)) : '—';
        return `<tr><td style="text-align:left;color:var(--amber)">${esc(e.from)}</td><td style="text-align:left">${esc(e.to)}</td><td>${pctTxt}</td>
          <td style="text-align:left">${esc(e.kind13 ? `13${e.kind13.slice(-1)}` : 'confirms curated')}${e.kind13 === '13D' ? ' <span style="color:var(--ink-faint)">(active)</span>' : ''}</td>
          <td style="text-align:left;color:var(--ink-faint)">${esc(ev.date || '')}</td><td style="text-align:left;color:var(--ink-faint)">${esc(e.purpose || '')}</td></tr>`;
      }).join('');
    const legend = Object.entries(TYPE_COL).map(([k, c]) => `<span><span style="color:${c}">■</span> ${esc(k)}</span>`).join(' · ');
    const notes = Object.entries(m.nodeNotes || {}).map(([t, n]) => `<div><strong style="color:var(--ink)">${esc(t)}</strong>: ${esc(Object.entries(n).filter(([k]) => !/src$/i.test(k)).map(([, v]) => v).join(' · '))}</div>`).join('');
    const src = Object.entries(m.sources || {}).map(([k, s]) => `<div>${esc(k)} · ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--ink-dim)">${esc(s.title)}</a>` : esc(s.title)}</div>`).join('');
    return `<div style="${mono};font-size:10px;color:var(--ink-dim);padding:8px 2px 2px;line-height:1.5">
      <div>${legend} · arrows point the way money or value flows (a warrant: from the issuer to the holder; underwriting fees: issuer → bank) · <span style="color:var(--ink)">thick = part of a loop</span></div>
      <div style="margin-top:6px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Loops - money that comes back to where it started (${(m.loops || []).length})</div>
      <ul style="list-style:none;margin:2px 0 0;padding:0">${loops || '<li>none</li>'}</ul>
      ${circ ? `<div style="margin-top:8px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Funding its own customers</div>
      <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:560px;${mono};font-size:10px;margin-top:4px"><thead><tr><th style="text-align:left">Company</th><th style="text-align:left">Funds / owns these buyers</th><th>Invested</th><th>Committed back</th><th title="multi-year commitments vs one year's revenue - a scale, not like for like">÷ revenue</th><th>Loops</th></tr></thead><tbody>${circ}</tbody></table></div>` : ''}
      ${blog ? `<div style="margin-top:8px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Backlog from tracked buyers - who the sellers' order books depend on</div>
      <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:560px;${mono};font-size:10px;margin-top:4px"><thead><tr><th style="text-align:left">Seller</th><th style="text-align:left">Committed buyers</th><th>Commitments</th><th>Reported backlog (RPO)</th><th title="announced commitments may not all be booked yet - over 100% means announced beyond what is booked">÷ backlog</th><th>Years of revenue</th></tr></thead><tbody>${blog}</tbody></table></div>` : ''}
      ${own ? `<div style="margin-top:8px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Ownership from the filings - 5%+ stakes between companies in the universe (Schedule 13D / 13G)</div>
      <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:560px;${mono};font-size:10px;margin-top:4px"><thead><tr><th style="text-align:left">Owner</th><th style="text-align:left">Owns</th><th>% of class</th><th style="text-align:left">Filing</th><th style="text-align:left">Event</th><th style="text-align:left">Stated purpose (13D)</th></tr></thead><tbody>${own}</tbody></table></div>
      <div style="${small};margin-top:2px">Asset managers', banks' and brokers' passive 13G stakes hold clients' money and are left out; a 13D (activist / control) from anyone stays in. 13F rows: a company's own quarter-end holdings as a filing manager (≈% = its shares ÷ the issuer's latest diluted count).</div>` : ''}
      ${notes ? `<div style="margin-top:8px">${notes}</div>` : ''}
      <details style="margin-top:6px"><summary style="cursor:pointer;color:var(--ink-faint)">Sources (${Object.keys(m.sources || {}).length}) · confidence: <span style="color:${CONF_COL.filing}">filing</span> · <span style="color:${CONF_COL.disclosed}">disclosed</span> · <span style="color:${CONF_COL.reported}">reported</span> · <span style="color:${CONF_COL.inferred}">inferred</span></summary>${src}</details>
      <div style="${small};margin-top:6px">Amounts as announced / filed; "up to" commitments and capacity (GW) are not cash; ÷ revenue compares multi-year commitments with one year's revenue. Built ${esc(m.asOf || '')} from TRAPP2-ANALYTICS config/web_relationships.json and the SEC's Schedule 13D / 13G filings - every edge carries its source and confidence; corrections go there.</div>
    </div>`;
  }

  // ---- 3) the company page card --------------------------------------------------------------------------------
  function factsHtml(f) {
    if (!f) return '';
    const cells = [['Revenue', f.rev], ['Operating income', f.opInc], ['Net income', f.ni], ['Operating cash flow', f.ocf], ['Capex', f.capex], ['Cash', f.cash], ['Long-term debt', f.debt], ['Equity', f.eq],
                   ['Backlog (RPO)', f.rpo], ['Purchase obligations', f.purchOb], ['Equity-method stakes', f.eqMethod], ['Listed equity stakes', f.eqListed], ['Private equity stakes', f.eqPrivate]]
      .filter(([, v]) => v != null);
    if (!cells.length) return '';
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-top:6px">${cells.map(([k, v]) => `<div style="border:1px solid var(--rule);border-radius:3px;padding:5px 7px"><div style="${small};text-transform:uppercase;letter-spacing:.06em">${esc(k)}</div><div style="${mono};font-size:12px;color:var(--ink)">${esc(usd(v))}</div></div>`).join('')}</div>
      <div style="${small};margin-top:3px">SEC XBRL as filed (TTM where available), latest period ${esc(f.fy || '—')}${f.staleKeys && f.staleKeys.length ? ` · not shown, older than ~15 months: ${esc(f.staleKeys.join(', '))}` : ''}${f.v === 1 ? ' · refresh to the merged series pending' : ''}</div>`;
  }

  const TYPE13 = { IA: 'investment adviser', HC: 'parent holding company', BK: 'bank', BD: 'broker-dealer', IC: 'insurance company',
                   IV: 'investment company', EP: 'employee benefit plan / endowment', SA: 'savings association', CP: 'church plan',
                   CO: 'corporation', PN: 'partnership', IN: 'individual', FI: 'non-US institution', OO: 'other' };
  const typeWords = ty => String(ty || '').split('/').map(x => TYPE13[x.trim()] || x.trim()).filter(Boolean).join(', ');

  function holdersHtml(t, doc, money) {
    const hs = (doc && doc.holders) || [];
    const pf = (doc && doc.profile) || {};
    const parts = [];
    const bits = [];
    if (pf.sic) bits.push(`SIC ${esc(pf.sic)}${pf.sicDescription ? ' ' + esc(pf.sicDescription) : ''}`);
    if (pf.stateOfIncorporation) bits.push(`incorporated ${esc(pf.stateOfIncorporation)}`);
    if (pf.fiscalYearEnd && /^\d{4}$/.test(pf.fiscalYearEnd)) bits.push(`fiscal year ends ${esc(pf.fiscalYearEnd.slice(0, 2))}/${esc(pf.fiscalYearEnd.slice(2))}`);
    if (pf.category) bits.push(esc(pf.category));
    if ((pf.formerNames || []).length) bits.push(`formerly ${pf.formerNames.map(f => `${esc(f.name)}${f.to ? ` <span style="color:var(--ink-faint)">(to ${esc(f.to.slice(0, 7))})</span>` : ''}`).join(', ')}`);
    if (bits.length) parts.push(`<div style="${mono};font-size:10px;color:var(--ink-dim);margin-top:6px;line-height:1.5">SEC profile: ${bits.join(' · ')}</div>`);
    if (hs.length) {
      const corp = new Map(((money && money.edges) || []).filter(e => e.to === t && e.type === 'owns' && e.holder).map(e => [e.holder, e.from]));
      const rows = hs.slice(0, 15).map(h => {
        const out = h.pct != null && h.pct < 5;
        const who = corp.get(h.name);
        return `<tr style="${out ? 'opacity:.55' : ''}"><td style="text-align:left">${esc(h.name)}${who ? ` <span style="color:var(--amber)">${esc(who)}</span>` : ''}${h.n > 1 ? ` <span style="color:var(--ink-faint)" title="reporting persons filing together">+${h.n - 1}</span>` : ''}</td>
          <td>${h.pct != null ? esc(h.pct) + '%' : '—'}${out ? ' <span title="the latest filing reports under 5% - an exit or a cut">↓</span>' : ''}</td>
          <td style="text-align:left" title="13G: passive (no intent to influence control) · 13D: active - the filer may seek to influence or control${h.rule ? ' · Rule ' + esc(h.rule) + ' - (b) an institution holding in the ordinary course, (c) a passive investor under 20%, (d) held before the company registered (pre-IPO)' : ''}">${esc(h.kind || '')}${h.kind === '13D' ? ' active' : ''}${h.rule ? ` <span style="color:var(--ink-faint)">${esc(h.rule.replace('13d-1', ''))}</span>` : ''}</td>
          <td style="text-align:left;color:var(--ink-faint)" title="${esc(typeWords(h.type))}">${esc(h.type || '')}</td>
          <td style="text-align:left;color:var(--ink-faint)">${esc(h.event || h.filed || '')}</td>
          <td style="text-align:left;color:var(--ink-faint)">${esc(h.cls || '')}</td></tr>${h.purpose ? `<tr><td colspan="6" style="text-align:left;color:var(--ink-dim);white-space:normal">↳ purpose (Item 4): ${esc(h.purpose)}</td></tr>` : ''}`;
      }).join('');
      const n5 = hs.filter(h => (h.pct || 0) >= 5);
      const byCls = {};
      n5.forEach(h => { const k = h.cusip || ''; byCls[k] = (byCls[k] || 0) + 1; });
      const main = Object.keys(byCls).sort((a, b) => byCls[b] - byCls[a])[0];
      const sum = n5.filter(h => (h.cusip || '') === main).reduce((a, h) => a + (h.pct || 0), 0);
      const multi = Object.keys(byCls).length > 1;
      parts.push(`<div style="margin-top:8px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">5%+ holders - Schedule 13D / 13G filed about it (${n5.length}${n5.length ? `, ${sum.toFixed(1)}% of the ${multi ? 'main ' : ''}class between them` : ''})</div>
        <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:520px;${mono};font-size:10px;margin-top:4px"><thead><tr><th style="text-align:left">Holder</th><th>% of class</th><th style="text-align:left">Filing</th><th style="text-align:left">Type</th><th style="text-align:left">Event</th><th style="text-align:left">Class</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div style="${small};margin-top:2px">Filed on the SEC's structured schedules (Dec 2024 on), latest filing per holder and class; a holder that is a company in the universe is marked with its ticker. Index funds' 5% stakes are passive client money; a 13D says the filer may act.</div>`);
    }
    const st = (doc && doc.stakes) || [];
    if (st.length) {
      const own = new Map(((money && money.edges) || []).filter(e => e.from === t && e.type === 'owns').map(e => [e.to, e]));
      const tick = s => { for (const [to, e] of own) if (e.holder && (e.events || []).some(v => v.acc === s.acc)) return to; return null; };
      const rows = st.slice(0, 15).map(s => {
        const out = s.pct != null && s.pct < 5;
        const to = tick(s);
        return `<tr style="${out ? 'opacity:.55' : ''}"><td style="text-align:left">${esc(s.issuer || ('CIK ' + s.issuerCik))}${to ? ` <span style="color:var(--amber)">${esc(to)}</span>` : ''}</td>
          <td>${s.pct != null ? esc(s.pct) + '%' : '—'}${out ? ' <span title="the latest filing reports under 5% - an exit or a cut">↓</span>' : ''}</td>
          <td style="text-align:left">${esc(s.kind || '')}${s.kind === '13D' ? ' active' : ''}${s.rule ? ` <span style="color:var(--ink-faint)" title="13d-1(b): an institution holding in the ordinary course · 13d-1(c): a passive investor under 20% · 13d-1(d): held before the company registered (pre-IPO)">${esc(s.rule)}</span>` : ''}</td>
          <td style="text-align:left;color:var(--ink-faint)">${esc(s.event || s.filed || '')}</td></tr>${s.purpose ? `<tr><td colspan="4" style="text-align:left;color:var(--ink-dim);white-space:normal">↳ purpose (Item 4): ${esc(s.purpose)}</td></tr>` : ''}`;
      }).join('');
      parts.push(`<div style="margin-top:8px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Its own 5%+ stakes in other companies - Schedule 13D / 13G it filed (${st.filter(x => (x.pct || 0) >= 5).length})</div>
        <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px;${mono};font-size:10px;margin-top:4px"><thead><tr><th style="text-align:left">Company</th><th>% of class</th><th style="text-align:left">Filing</th><th style="text-align:left">Event</th></tr></thead><tbody>${rows}</tbody></table></div>`);
    }
    const f3 = doc && doc.f13;
    if (f3 && (f3.holdings || []).length) {
      const eq = f3.holdings.filter(h => !h.putCall), opt = f3.holdings.length - eq.length;
      const rows = eq.slice(0, 15).map(h => {
        const tk = T_BY_CUSIP && T_BY_CUSIP[h.cusip];
        const tick = Array.isArray(tk) ? tk.join(' / ') : tk;
        return `<tr><td style="text-align:left">${esc(h.name)}${tick ? ` <span style="color:var(--amber)">${esc(tick)}</span>` : ''}</td><td>${esc(usd(h.value))}</td>
          <td>${h.shares != null ? esc(Math.round(h.shares).toLocaleString('en-US')) : '—'}</td><td style="text-align:left;color:var(--ink-faint)">${esc(h.cls || '')}</td></tr>`;
      }).join('');
      parts.push(`<div style="margin-top:8px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Its 13F holdings at ${esc(f3.period || '')} - ${esc(f3.n)} position${f3.n === 1 ? '' : 's'}, ${esc(usd(f3.total))} (it files 13F-HR as a manager)</div>
        <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:420px;${mono};font-size:10px;margin-top:4px"><thead><tr><th style="text-align:left">Holding</th><th>Value</th><th>Shares</th><th style="text-align:left">Class</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div style="${small};margin-top:2px">Quarter-end market value as filed${opt ? ` · ${opt} option position${opt === 1 ? '' : 's'} not shown` : ''}${eq.length > 15 ? ` · ${eq.length - 15} more` : ''}.</div>`);
    } else if (f3 && f3.skipped) {
      parts.push(`<div style="${small};margin-top:6px">13F-HR ${esc(f3.period || '')}: ${esc(f3.skipped)} - not read.</div>`);
    }
    return parts.join('');
  }

  function companyCardHtml(t, n, money, chainsDoc, ipo, secDoc, inline) {
    const edges = ((money && money.edges) || []).filter(e => e.from === t || e.to === t);
    const chainName = id => ((chainsDoc && chainsDoc.chains) || []).find(c => c.id === id)?.name || id;
    const parts = [];
    if (edges.length) {
      const rows = edges.map(e => `<tr><td style="text-align:left"><span style="color:${TYPE_COL[e.type]}">■</span> ${esc(e.label || `${e.from} ${TYPE_WORD[e.type]} ${e.to}`)}</td>
        <td>${esc(edgeAmount(e) || '—')}</td><td style="color:${CONF_COL[e.confidence] || 'var(--ink-faint)'}">${esc(e.confidence || '')}</td>
        <td style="text-align:left;color:var(--ink-faint)">${esc(((e.events || []).slice(-1)[0] || {}).date || '')}</td></tr>`).join('');
      parts.push(`<div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:480px;${mono};font-size:10px"><thead><tr><th style="text-align:left">Money link</th><th>Size</th><th>Confidence</th><th style="text-align:left">Latest</th></tr></thead><tbody>${rows}</tbody></table></div>`);
    }
    const c = n && n.circularity;
    const bl = n && n.backlog;
    if (bl && (bl.commitIn || bl.commitGW)) parts.push(`<div style="${mono};font-size:10.5px;color:var(--ink);margin-top:6px;line-height:1.5">Commitments into it from tracked buyers: ${esc([bl.commitIn ? usd(bl.commitIn) : null, bl.commitGW ? bl.commitGW + ' GW' : null].filter(Boolean).join(' / '))} (${esc((bl.from || []).map(x => x.buyer).join(', '))})${bl.shareOfRpo != null ? ` - <strong>${Math.round(bl.shareOfRpo * 100)}%</strong> of the backlog it reports (RPO ${esc(usd(bl.rpo))})${bl.shareOfRpo > 1 ? ', i.e. announced beyond what is booked' : ''}` : ''}${bl.yearsOfRevenue != null ? ` · ${bl.yearsOfRevenue} years of revenue` : ''}.</div>`);
    if (c) parts.push(`<div style="${mono};font-size:10.5px;color:var(--ink);margin-top:6px;line-height:1.5">Funds or owns companies that are committed buyers of it: ${esc(usd(c.investedUSD))} in, ${esc(backTxt(c))} committed back${c.committedBackToRevenue != null ? ` - ${(c.committedBackToRevenue * 100).toFixed(0)}% of a year's revenue (multi-year)` : ''} · in ${c.loops} money loop${c.loops === 1 ? '' : 's'}.</div>`);
    if (n && n.notes) parts.push(`<div style="${mono};font-size:10px;color:var(--ink-dim);margin-top:4px;line-height:1.5">${esc(Object.entries(n.notes).filter(([k]) => !/src$/i.test(k)).map(([, v]) => v).join(' · '))}</div>`);
    if (n && n.facts) parts.push(factsHtml(n.facts));
    const own = holdersHtml(t, secDoc, money);
    if (own) parts.push(own);
    const bits = [];
    if (n && n.idx) bits.push(`Index weight: ${Object.entries(n.idx).map(([k, v]) => `${esc(k)} ${v == null ? '—' : (+v).toFixed(2) + '%'}`).join(' · ')}`);
    if (n && n.rating && n.rating.r) bits.push(`Model credit rating: ${esc(n.rating.r)}`);
    if (n && n.chains && n.chains.length) bits.push(`In ${n.chains.length} chain${n.chains.length === 1 ? '' : 's'}: ${n.chains.slice(0, 8).map(r => `${esc(chainName(r[0]))} <span style="color:var(--ink-faint)">(${esc(r[1])}stream · ${esc(r[2] || '')})</span>`).join(' · ')}${n.chains.length > 8 ? ' …' : ''}`);
    if (bits.length) parts.push(`<div style="${mono};font-size:10px;color:var(--ink-dim);margin-top:6px;line-height:1.6">${bits.join('<br>')}</div>`);
    const info = ipo && ipo.ipos && ipo.ipos[t];
    const ev = ((ipo && ipo.events) || []).filter(e => e.ticker === t);
    if (info || ev.length) {
      const uw = (info && info.underwriters) || {}, fees = (info && info.fees) || {};
      parts.push(`<div style="${mono};font-size:10px;color:var(--ink-dim);margin-top:8px;line-height:1.55;border-left:2px solid #c47ba0;padding-left:8px">
        <strong style="color:var(--ink)">IPO ${esc((info && info.firstTrade) || '')}${info && info.price ? ` at $${esc(info.price)}` : ''}</strong>${uw.lead ? ` · lead underwriters ${esc(uw.lead.join(', '))}${uw.count ? ` (+${uw.count - uw.lead.length} in the syndicate)` : ''}` : ''}${fees.owner || (fees.estimates || []).length ? ` · fees ${esc(fees.owner || '')}${(fees.estimates || []).length ? ` (estimates: ${esc(fees.estimates.map(x => `${usd(x.usd)} ${x.by}`).join('; '))})` : ''}` : ''}.
        Conflicted coverage: the syndicate's banks earned the fees, and FINRA Rule 2241 only delays their research by 10 days after the IPO. In the academic record (Michaely &amp; Womack 1999) underwriters' own buy ratings on their IPOs did worse than independent analysts' - weigh their initiations and targets accordingly, and watch the lock-up releases.
        ${ev.length ? `<div style="margin-top:4px">${ev.map(e => `<div><span style="color:${e.major ? 'var(--neg)' : 'var(--ink)'}">${esc(e.date || e.rule || '')}</span> · ${esc(e.kind)}${e.daysAway != null ? ` <span style="color:var(--ink-faint)">(${e.daysAway >= 0 ? 'in ' + e.daysAway + ' d' : -e.daysAway + ' d ago'})</span>` : ''} - ${esc(e.text || '')}</div>`).join('')}</div>` : ''}
        <div style="${small}">The bot: no new long from 3 sessions before a major release to 1 after; longs ×0.85 in the first 5 sessions of syndicate initiations.</div></div>`);
    }
    if (!parts.length) return '';
    return `<div class="company-card" ${inline ? 'data-bw-inline="1"' : 'id="company-business-web"'} data-ticker="${esc(t)}">
      <h4>Business Web <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· who it owns, funds and buys from, who funds it - money that comes back · WEB → Money web for the whole map</span></h4>
      ${parts.join('')}
      <div style="${small};margin-top:6px">TRAPP2-ANALYTICS data/web (${esc((money && money.asOf) || '')}) - every money link carries its source and confidence (filing / disclosed / reported / inferred).</div></div>`;
  }

  let cardBusy = false;
  async function renderCompanyCard() {
    const anchor = document.getElementById('company-13f-holders');
    if (!anchor || cardBusy) return;
    let t = null;
    try { t = (typeof state !== 'undefined' && state && state.stock && state.stock.ticker) ? String(state.stock.ticker).toUpperCase() : null; } catch (e) {}
    if (!t) return;
    const old = document.getElementById('company-business-web');
    if (old && old.dataset.ticker === t) return;
    if (anchor.dataset.bwDone === t) return;
    cardBusy = true;
    try {
      const [nodes, money, chainsDoc, ipo, secDoc] = await Promise.all([get('nodes'), get('money'), get('chains'), get('ipo'), getSec(t), loadCusips()]);
      const a2 = document.getElementById('company-13f-holders');
      if (!a2) return;
      let now = null;
      try { now = state.stock && state.stock.ticker ? String(state.stock.ticker).toUpperCase() : null; } catch (e) {}
      if (now !== t) return;                                   // the user moved on while it loaded
      const n = nodes && nodes.nodes ? nodes.nodes[t] : null;
      const html = companyCardHtml(t, n, money, chainsDoc, ipo, secDoc);
      const cur = document.getElementById('company-business-web');
      if (cur) cur.remove();
      a2.dataset.bwDone = t;
      if (html) a2.insertAdjacentHTML('beforebegin', html);
    } finally { cardBusy = false; }
  }

  // ---- 4) CUSIPs for the 13F holders section (z199) ------------------------------------------------------------------
  // The app finds a ticker's 13F holders by CUSIP (TRAPP2-1 data/13f/by_ticker.json is keyed by CUSIP) and falls back to
  // name matching when the stockbook row has none - most rows have none. Every Schedule 13D / 13G names its issuer's
  // CUSIP, so TRAPP2-ANALYTICS data/sec/cusips.json maps them; only unambiguous ones are used (one CIK with two listed
  // classes - GOOG / GOOGL - maps to both, so those stay on name matching).
  let CUSIP_BY_T = null, T_BY_CUSIP = null, CUSIP_P = null;
  function loadCusips() {
    if (CUSIP_P) return CUSIP_P;
    CUSIP_P = (async () => {
      try {
        const r = await fetch(`${raw()}/TRAPP2-ANALYTICS/main/data/sec/cusips.json`, { cache: 'no-cache' });
        if (!r.ok) { setTimeout(() => { CUSIP_P = null; }, TTL); return; }           // not there yet: ask again later
        const j = await r.json();
        const by = (j && j.byCusip) || {};
        T_BY_CUSIP = by;
        CUSIP_BY_T = {};
        for (const [cu, t] of Object.entries(by)) if (typeof t === 'string') (CUSIP_BY_T[t] = CUSIP_BY_T[t] || []).push(cu);
      } catch (e) {}
    })();
    return CUSIP_P;
  }
  function cusipFor(t) {
    const l = CUSIP_BY_T && CUSIP_BY_T[String(t || '').toUpperCase()];
    return l && l.length === 1 ? l[0] : null;                 // two CUSIPs for one ticker: not sure which class - skip
  }
  function hookCusip() {
    try {
      if (typeof window._tickerCusip !== 'function' || window._tickerCusip.__bw) return;
      const orig = window._tickerCusip;
      const hooked = function (ticker) { return orig.apply(this, arguments) || cusipFor(ticker); };
      hooked.__bw = true;
      window._tickerCusip = hooked;                           // a top-level function in app.js: callers resolve it on the window
    } catch (e) {}
  }


  // ---- 5) Macro Data → Supply Chains & Business Web (z200) -----------------------------------------------------------
  // Owner 11-20: "Can we throw this into Macro Data as a table similar to that of Supply chains? … supply chains and the
  // Business Web in the same tab for easier research." The Supply Chains page keeps its three chain views and gains four
  // Business Web views (index.html: the view menu's "Business Web" group); app.js's renderSupplyChainTab is wrapped (a
  // top-level function: every caller resolves it on the window), so the chain views run unchanged.
  const TAB = {
    sort: { companies: ['links', -1], links: ['date', -1], ownership: ['pct', -1], conc: ['sum5', -1] },
    filter: { companies: 'web', links: 'all', ownership: 'all' },
    limit: 100, open: null, seq: 0,
  };
  const VIEW_INFO = {
    'bw:companies': ['Companies', 'every company in the web: its money links, the commitments into and out of it, loops, 5%+ holders, the stakes it holds, chains'],
    'bw:links': ['Money links', 'every typed link - owns / funds / commits / supplies / underwrites - with its size, confidence, date and source'],
    'bw:ownership': ['Ownership', 'stakes between companies from the filings (13D / 13G / 13F) and how concentrated each company\'s 5%+ holders are'],
    'bw:loops': ['Loops & circularity', 'money that comes back to where it started, companies funding their own customers, backlog that rests on tracked buyers'],
  };
  const fmtN = v => v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US');
  const pctTxt = (v, approx) => v == null || !isFinite(v) ? '—' : `${approx ? '≈' : ''}${(+v).toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, '')}%`;
  const valueIt = t => `<span class="bw-tic" data-bw-value="${esc(t)}" title="Value ${esc(t)}" style="color:var(--amber);font-weight:700;cursor:pointer">${esc(t)}</span>`;
  const chip = (group, key, label, on, n) => `<button type="button" class="sc-chain-meta-pill${on ? ' exposed' : ''}" data-bw-filter="${esc(group)}:${esc(key)}" style="cursor:pointer;font-family:var(--mono)">${esc(label)}${n != null ? ` <span style="color:var(--ink-faint)">${n}</span>` : ''}</button>`;
  const th = (view, key, label, title, left) => {
    const [k, d] = TAB.sort[view] || [];
    return `<th class="sortable" data-bw-sort="${esc(view)}:${esc(key)}" style="cursor:pointer;${left ? 'text-align:left;' : ''}white-space:nowrap"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}${k === key ? (d < 0 ? ' ▾' : ' ▴') : ''}</th>`;
  };
  function sortRows(rows, view, getters) {
    const [k, d] = TAB.sort[view] || [];
    const g = getters[k];
    if (!g) return rows;
    return rows.slice().sort((a, b) => {
      const x = g(a), y = g(b);
      const xn = x == null || x === '', yn = y == null || y === '';
      if (xn || yn) return xn && yn ? 0 : xn ? 1 : -1;               // blanks last either way
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d;
    });
  }
  const introBox = html => `<div style="background:var(--bg-elev);border:1px solid var(--rule);border-left:3px solid var(--amber);border-radius:0 4px 4px 0;padding:12px 16px;margin-bottom:14px;font-family:var(--mono);font-size:10px;color:var(--ink);line-height:1.7">${html}</div>`;
  const tableWrap = (min, head, body) => `<div data-bw-wrap="1" style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table class="sb-table" style="width:100%;min-width:${min}px;${mono};font-size:10.5px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  const moreBtn = (shown, total) => total > shown ? `<div style="text-align:center;margin:10px 0"><button type="button" class="btn btn-ghost" data-bw-more="1" style="font-size:10px">Show more (${shown} of ${total})</button></div>` : '';
  const threeD = `<button type="button" class="btn btn-ghost" data-bw-3d="1" style="font-size:10px;margin-left:6px">Open the 3D money web</button>`;
  const matchQ = (q, ...xs) => !q || xs.some(x => String(x || '').toLowerCase().includes(q));

  function chainNames(chainsDoc) {
    const m = {};
    for (const c of (chainsDoc && chainsDoc.chains) || []) m[c.id] = c.name;
    try { if (typeof SUPPLY_CHAINS !== 'undefined') for (const c of SUPPLY_CHAINS) if (!m[c.id]) m[c.id] = c.name; } catch (e) {}
    return m;
  }
  function companyRows(nodes) {
    const out = [];
    for (const [t, n] of Object.entries((nodes && nodes.nodes) || {})) {
      const mo = n.money || {};
      out.push({ t, n, name: n.name || t, sector: n.sector || '', industry: n.industry || (n.sic && n.sic[1]) || '',
                 links: (mo.edges || []).length, owns: mo.owns || 0, ownedBy: mo.ownedBy || 0, funds: mo.funds || 0,
                 cin: mo.commitsInUSD || null, cout: mo.commitsOutUSD || null, loops: (n.circularity && n.circularity.loops) || null,
                 circ: n.circularity ? n.circularity.committedBackToRevenue : null, rpoShare: n.backlog ? n.backlog.shareOfRpo : null,
                 n5: n.own ? n.own.n5 : null, sum5: n.own ? n.own.sum5 : null, top: n.own ? n.own.top : null,
                 stakes: (n.stakes ? n.stakes.n5 : 0) + (n.f13 ? n.f13.n || 0 : 0) || null,
                 chains: (n.chains || []).length || null, rev: n.facts ? n.facts.rev : null, mc: n.mc || null,
                 spy: n.idx ? (n.idx.SPY != null ? n.idx.SPY : null) : null });
    }
    return out;
  }
  const CO_FILTERS = [['web', 'In the money web', r => r.links > 0], ['holders', 'With 5%+ holders on file', r => r.n5 > 0],
                      ['stakes', 'Holds stakes (13D / 13G / 13F)', r => r.stakes > 0], ['circular', 'Funds its own buyers', r => r.circ != null || (r.n.circularity && true)],
                      ['chains', 'In a supply chain', r => r.chains > 0], ['all', 'All companies', () => true]];

  function viewCompanies(nodes, money, chainsDoc, q) {
    const all = companyRows(nodes);
    const f = CO_FILTERS.find(x => x[0] === TAB.filter.companies) || CO_FILTERS[0];
    let rows = all.filter(f[2]).filter(r => matchQ(q, r.t, r.name, r.sector, r.industry, r.top && r.top[0]));
    rows = sortRows(rows, 'companies', { ticker: r => r.t, name: r => r.name.toLowerCase(), sector: r => r.sector || null, links: r => r.links || null,
                                         cin: r => r.cin, cout: r => r.cout, loops: r => r.loops, circ: r => r.circ, n5: r => r.n5, sum5: r => r.sum5,
                                         stakes: r => r.stakes, chains: r => r.chains, rev: r => r.rev, mc: r => r.mc, spy: r => r.spy });
    const cn = chainNames(chainsDoc);
    const shown = rows.slice(0, TAB.limit);
    const head = th('companies', 'ticker', 'Ticker', '', true) + th('companies', 'name', 'Company', '', true) + th('companies', 'sector', 'Sector · industry', '', true)
      + th('companies', 'links', 'Money links', 'owns · owned by · funds — every typed link it is part of') + th('companies', 'cin', 'Committed to it', 'purchase / capacity commitments from tracked buyers (USD)')
      + th('companies', 'cout', 'It commits', 'its own purchase commitments to tracked sellers (USD)') + th('companies', 'loops', 'Loops', 'money loops it is part of')
      + th('companies', 'circ', 'Back ÷ revenue', 'commitments back from companies it funds or owns, as a share of one year\'s revenue (multi-year vs one year - a scale)')
      + th('companies', 'n5', '5%+ holders', 'holders with 5% or more of a class, from Schedule 13D / 13G') + th('companies', 'sum5', 'Held by them', 'their stakes added up, within the main share class')
      + th('companies', 'stakes', 'Its stakes', '5%+ stakes it filed (13D / 13G) + positions in its own 13F') + th('companies', 'chains', 'Chains', 'supply chains it is placed in')
      + th('companies', 'rev', 'Revenue', 'SEC, trailing twelve months where available') + th('companies', 'spy', 'S&P 500 wt', 'index weight');
    const body = shown.map(r => {
      const open = TAB.open === r.t;
      const lk = r.links ? `${r.links}<span style="color:var(--ink-faint)"> · ${[r.owns ? r.owns + ' owns' : '', r.ownedBy ? r.ownedBy + ' owned by' : '', r.funds ? r.funds + ' funds' : ''].filter(Boolean).join(' · ')}</span>` : '—';
      const chainsTitle = (r.n.chains || []).map(c => `${cn[c[0]] || c[0]} (${c[1]}stream)`).join(' · ');
      return `<tr data-bw-row="${esc(r.t)}"${open ? ' style="background:var(--bg-elev)"' : ''}>
        <td style="text-align:left;white-space:nowrap"><button type="button" data-bw-open="${esc(r.t)}" title="${open ? 'Close' : 'Open'} ${esc(r.t)}'s Business Web" style="background:none;border:none;color:var(--ink-faint);cursor:pointer;padding:0 4px 0 0;font-family:var(--mono)">${open ? '▾' : '▸'}</button>${valueIt(r.t)}</td>
        <td style="text-align:left;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.name)}">${esc(r.name)}${r.n.kind === 'private' ? ' <span style="color:var(--ink-faint)">(private)</span>' : ''}</td>
        <td style="text-align:left;color:var(--ink-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc([r.sector, r.industry].filter(Boolean).join(' · '))}">${esc([r.sector, r.industry].filter(Boolean).join(' · ') || '—')}</td>
        <td style="white-space:nowrap">${lk}</td><td>${r.cin ? esc(usd(r.cin)) : '—'}</td><td>${r.cout ? esc(usd(r.cout)) : '—'}</td><td>${r.loops || '—'}</td>
        <td>${r.circ != null ? Math.round(r.circ * 100) + '%' : '—'}</td>
        <td title="${r.top ? esc(`largest: ${r.top[0]} ${r.top[1]}%`) : ''}">${r.n5 || '—'}</td><td>${r.sum5 != null ? esc(r.sum5) + '%' : '—'}</td>
        <td>${r.stakes || '—'}</td><td title="${esc(chainsTitle)}">${r.chains || '—'}</td><td>${r.rev ? esc(usd(r.rev)) : '—'}</td><td>${r.spy != null ? (+r.spy).toFixed(2) + '%' : '—'}</td></tr>
        ${open ? `<tr data-bw-detail="${esc(r.t)}"><td colspan="14" style="text-align:left;white-space:normal;padding:8px 6px 12px"><div data-bw-sticky="1" style="position:sticky;left:6px;max-width:100%"><div data-bw-card="${esc(r.t)}" style="${small}">Loading ${esc(r.t)}'s filings…</div></div></td></tr>` : ''}`;
    }).join('');
    const counts = Object.fromEntries(CO_FILTERS.map(([k, , fn]) => [k, all.filter(fn).length]));
    return introBox(`<strong style="color:var(--amber)">Business Web · Companies</strong> - ${esc(VIEW_INFO['bw:companies'][1])}. ${rows.length} shown of ${all.length}${q ? ` matching "${esc(q)}"` : ''}.
        Click a ticker to value it, ▸ to open its Business Web (money links, 5%+ holders, its stakes and 13F holdings, SEC money structure, chains). Column headers sort.${threeD}
        <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap">${CO_FILTERS.map(([k, label]) => chip('companies', k, label, TAB.filter.companies === k, counts[k])).join('')}</div>`)
      + (rows.length ? tableWrap(1180, head, body) + moreBtn(shown.length, rows.length) : `<div style="padding:30px;text-align:center;${small}">No company matches${q ? ` "${esc(q)}"` : ''} in this view.</div>`)
      + `<div style="${small};margin-top:6px">TRAPP2-ANALYTICS data/web (${esc((nodes && nodes.asOf) || '')}) · holders and stakes fill in as the SEC run reads each company's 13D / 13G / 13F filings.</div>`;
  }

  const LINK_TYPES = ['owns', 'funds', 'commits', 'supplies', 'underwrites'];
  function viewLinks(money, q) {
    const loopEdges = new Set((money.loops || []).flatMap(L => L.edges || []));
    const names = money.names || {};
    const all = (money.edges || []).map(e => ({ e, date: ((e.events || []).slice(-1)[0] || {}).date || '', loop: loopEdges.has(e.id),
                                                size: e.amountUSD || e.valueUSD || (e.f13 && e.f13.valueUSD) || (e.gw ? e.gw * 1e10 : null) }));
    const fk = TAB.filter.links;
    let rows = all.filter(r => fk === 'all' || (fk === 'loops' ? r.loop : LINK_TYPES.includes(fk) ? r.e.type === fk : r.e.confidence === fk))
                  .filter(r => matchQ(q, r.e.from, r.e.to, names[r.e.from], names[r.e.to], r.e.label));
    rows = sortRows(rows, 'links', { from: r => r.e.from, type: r => r.e.type, to: r => r.e.to, size: r => r.size, conf: r => r.e.confidence || null, date: r => r.date || null });
    const src = money.sources || {};
    const shown = rows.slice(0, TAB.limit);
    const head = th('links', 'from', 'From', '', true) + th('links', 'type', 'Link', '', true) + th('links', 'to', 'To', '', true) + '<th style="text-align:left">What</th>'
      + th('links', 'size', 'Size', '$ / GW / % (13F value for filed holdings)') + th('links', 'conf', 'Confidence') + th('links', 'date', 'Latest', '', true) + '<th style="text-align:left">Source</th>';
    const body = shown.map(({ e, date, loop }) => {
      const sids = [...new Set((e.events || []).map(v => v.src).filter(x => x && x !== 'SEC'))];
      const s0 = sids.map(id => src[id]).filter(Boolean)[0];
      const sec = (e.events || []).some(v => v.src === 'SEC');
      return `<tr><td style="text-align:left">${valueIt(e.from)}</td>
        <td style="text-align:left;white-space:nowrap"><span style="color:${TYPE_COL[e.type] || 'var(--ink)'}">■ ${esc(TYPE_WORD[e.type] || e.type)}</span>${loop ? ' <span title="part of a money loop" style="color:var(--amber)">⟲</span>' : ''}</td>
        <td style="text-align:left">${valueIt(e.to)}</td>
        <td style="text-align:left;max-width:340px;white-space:normal;color:var(--ink-dim)">${esc(e.label || '')}</td>
        <td style="white-space:nowrap">${esc(edgeAmount(e) || '—')}</td>
        <td style="color:${CONF_COL[e.confidence] || 'var(--ink-faint)'}">${esc(e.confidence || '')}</td>
        <td style="text-align:left;color:var(--ink-faint);white-space:nowrap">${esc(date)}</td>
        <td style="text-align:left;max-width:220px;white-space:normal">${s0 && s0.url ? `<a href="${esc(s0.url)}" target="_blank" rel="noopener" style="color:var(--ink-dim)">${esc(s0.title || sids[0])}</a>` : s0 ? esc(s0.title) : ''}${sec ? `${s0 ? ' · ' : ''}<span style="color:${CONF_COL.filing}">SEC filing</span>` : ''}${!s0 && !sec ? '<span style="color:var(--ink-faint)">—</span>' : ''}</td></tr>`;
    }).join('');
    const cnt = k => k === 'all' ? all.length : k === 'loops' ? all.filter(r => r.loop).length : LINK_TYPES.includes(k) ? all.filter(r => r.e.type === k).length : all.filter(r => r.e.confidence === k).length;
    const chips = [['all', 'All'], ['loops', 'In a loop'], ...LINK_TYPES.map(k => [k, k]), ['filing', 'filing'], ['disclosed', 'disclosed'], ['reported', 'reported'], ['inferred', 'inferred']]
      .map(([k, l]) => chip('links', k, l, fk === k, cnt(k))).join('');
    return introBox(`<strong style="color:var(--amber)">Business Web · Money links</strong> - ${esc(VIEW_INFO['bw:links'][1])}. ${rows.length} shown of ${all.length}.
        Direction is the way money or value flows (a warrant: issuer → holder; underwriting fees: issuer → bank).${threeD}
        <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap">${chips}</div>`)
      + (rows.length ? tableWrap(980, head, body) + moreBtn(shown.length, rows.length) : `<div style="padding:30px;text-align:center;${small}">No link matches.</div>`)
      + `<div style="${small};margin-top:6px">Curated in TRAPP2-ANALYTICS config/web_relationships.json (every edge with its source and confidence) + the SEC's 13D / 13G / 13F filings · built ${esc(money.asOf || '')}.</div>`;
  }

  function viewOwnership(nodes, money, q) {
    const names = money.names || {};
    const nn = (nodes && nodes.nodes) || {};
    const all = (money.edges || []).filter(e => e.type === 'owns').map(e => {
      const ev = (e.events || []).filter(v => v.src === 'SEC').slice(-1)[0] || {};
      const filedPct = e.pctFiled != null ? e.pctFiled : e.kind13 ? e.pct : null;
      return { e, pct: filedPct != null ? filedPct : e.pct, approx: e.pctFiled == null && !!e.pctApprox, filed: filedPct != null || !!e.kind13,
               value: e.valueUSD || (e.f13 && e.f13.valueUSD) || null, form: e.kind13 || (e.pctFiled != null ? 'curated + filing' : e.f13 ? 'curated + 13F' : 'curated'),
               date: ev.date || ((e.events || []).slice(-1)[0] || {}).date || '' };
    });
    const fk = TAB.filter.ownership;
    let rows = all.filter(r => fk === 'all' || (fk === 'filed' ? r.filed : fk === '13F' ? (r.e.kind13 === '13F' || !!r.e.f13) : fk === 'activist' ? r.e.kind13 === '13D' : !r.filed))
                  .filter(r => matchQ(q, r.e.from, r.e.to, names[r.e.from], names[r.e.to], r.e.holder));
    rows = sortRows(rows, 'ownership', { owner: r => r.e.from, company: r => r.e.to, pct: r => r.pct, value: r => r.value, form: r => r.form, date: r => r.date || null });
    const head = th('ownership', 'owner', 'Owner', '', true) + th('ownership', 'company', 'Owns', '', true) + th('ownership', 'pct', '% of company', 'filed % (13D / 13G); ≈ = 13F shares ÷ diluted shares; ~ = reported')
      + th('ownership', 'value', '13F value', 'quarter-end market value in the owner\'s 13F') + th('ownership', 'form', 'Source', '', true) + th('ownership', 'date', 'Event', '', true) + '<th style="text-align:left">Stated purpose (13D)</th>';
    const nm = t => names[t] && names[t] !== t ? ` <span style="color:var(--ink-faint)">${esc(names[t])}</span>` : '';
    const body = rows.slice(0, TAB.limit).map(r => `<tr><td style="text-align:left">${valueIt(r.e.from)}${nm(r.e.from)}</td>
        <td style="text-align:left">${valueIt(r.e.to)}${nm(r.e.to)}</td>
        <td>${r.pct != null ? (r.filed && !r.approx ? '' : r.approx ? '' : '~') + pctTxt(r.pct, r.approx) : '—'}</td><td>${r.value ? esc(usd(r.value)) : '—'}</td>
        <td style="text-align:left;color:${r.filed ? CONF_COL.filing : 'var(--ink-dim)'}">${esc(r.form)}${r.e.rule ? ` <span style="color:var(--ink-faint)">${esc(r.e.rule)}</span>` : ''}</td>
        <td style="text-align:left;color:var(--ink-faint);white-space:nowrap">${esc(r.date)}</td><td style="text-align:left;white-space:normal;max-width:320px;color:var(--ink-dim)">${esc(r.e.purpose || '')}</td></tr>`).join('');
    // concentration: every company's 5%+ holders, from nodes
    let conc = Object.entries(nn).filter(([, n]) => n.own && n.own.n5).map(([t, n]) => ({ t, name: n.name || t, n5: n.own.n5, sum5: n.own.sum5, top: n.own.top || [] }))
      .filter(r => matchQ(q, r.t, r.name, r.top[0]));
    conc = sortRows(conc, 'conc', { ticker: r => r.t, n5: r => r.n5, sum5: r => r.sum5, top: r => r.top[1] });
    const chead = th('conc', 'ticker', 'Company', '', true) + th('conc', 'n5', '5%+ holders') + th('conc', 'sum5', 'Held by them', 'within the main share class') + th('conc', 'top', 'Largest', '', true);
    const cbody = conc.slice(0, 50).map(r => `<tr><td style="text-align:left">${valueIt(r.t)}${r.name !== r.t ? ` <span style="color:var(--ink-faint)">${esc(r.name)}</span>` : ''}</td><td>${r.n5}</td><td>${r.sum5 != null ? esc(r.sum5) + '%' : '—'}</td>
        <td style="text-align:left">${esc(r.top[0] || '')}${r.top[1] != null ? ` <span style="color:var(--ink-faint)">${esc(r.top[1])}%</span>` : ''}</td></tr>`).join('');
    const cnt = k => all.filter(r => k === 'all' || (k === 'filed' ? r.filed : k === '13F' ? (r.e.kind13 === '13F' || !!r.e.f13) : k === 'activist' ? r.e.kind13 === '13D' : !r.filed)).length;
    const chips = [['all', 'All stakes'], ['filed', 'From filings'], ['13F', 'With 13F'], ['activist', '13D (active)'], ['curated', 'Curated only']].map(([k, l]) => chip('ownership', k, l, fk === k, cnt(k))).join('');
    return introBox(`<strong style="color:var(--amber)">Business Web · Ownership</strong> - ${esc(VIEW_INFO['bw:ownership'][1])}. ${rows.length} stakes shown of ${all.length}.
        Asset managers' and banks' passive client holdings are left out (they show on each company's 5%+ holder list).${threeD}
        <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap">${chips}</div>`)
      + (rows.length ? tableWrap(900, head, body) + moreBtn(Math.min(rows.length, TAB.limit), rows.length) : `<div style="padding:24px;text-align:center;${small}">No stake matches.</div>`)
      + `<div style="margin-top:14px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px;${mono}">Ownership concentration - 5%+ holders filed about each company (${conc.length})</div>`
      + (conc.length ? tableWrap(560, chead, cbody) + (conc.length > 50 ? `<div style="${small};margin-top:4px">Top 50 by the sort above · search to find any company.</div>` : '')
                     : `<div style="padding:16px;${small}">No holders on file yet - the SEC run reads every company's Schedule 13D / 13G filings, ~600 a run (Business Web names first).</div>`);
  }

  function viewLoops(money) {
    return introBox(`<strong style="color:var(--amber)">Business Web · Loops & circularity</strong> - ${esc(VIEW_INFO['bw:loops'][1])}.${threeD}`) + panelHtml('money');
  }

  let tabWired = null;
  function wireTab(el) {
    if (tabWired === el) return;
    tabWired = el;
    el.addEventListener('click', ev => {
      const a = ev.target.closest('[data-bw-sort],[data-bw-filter],[data-bw-more],[data-bw-open],[data-bw-value],[data-bw-3d]');
      if (!a || !el.contains(a)) return;
      const mode = curMode();
      if (!mode || !mode.startsWith('bw:')) return;
      if (a.dataset.bwValue) { try { if (typeof executeCommand === 'function') executeCommand(a.dataset.bwValue); } catch (e) {} return; }
      if (a.hasAttribute('data-bw-3d')) { open3d(); return; }       // (a digit after the dash: no dataset camel-case)
      if (a.dataset.bwSort) {
        const [view, key] = a.dataset.bwSort.split(':');
        const cur = TAB.sort[view] || [];
        TAB.sort[view] = [key, cur[0] === key ? -cur[1] : (['ticker', 'name', 'owner', 'company', 'from', 'to', 'type', 'form', 'sector'].includes(key) ? 1 : -1)];
      } else if (a.dataset.bwFilter) {
        const [g, k] = a.dataset.bwFilter.split(':');
        TAB.filter[g] = k; TAB.limit = 100;
      } else if (a.dataset.bwMore) TAB.limit += 200;
      else if (a.dataset.bwOpen) TAB.open = TAB.open === a.dataset.bwOpen ? null : a.dataset.bwOpen;
      renderTab(el, mode, curQuery());
    });
  }
  const curMode = () => { try { return state.supplychain.viewMode; } catch (e) { return null; } };
  const curQuery = () => { try { return (state.supplychain.searchQuery || '').toLowerCase().trim(); } catch (e) { return ''; } };
  function open3d() {
    try {
      if (typeof WEB_STATE !== 'undefined' && WEB_STATE) WEB_STATE.lens = 'money';
      if (typeof fnWEB !== 'function') return;
      fnWEB();
      const sel = document.getElementById('web-lens');
      if (sel && sel.value !== 'money' && [...sel.options].some(o => o.value === 'money')) { sel.value = 'money'; sel.dispatchEvent(new Event('change')); }
    } catch (e) {}
  }

  async function renderTab(el, mode, q) {
    if (!el) return;
    wireTab(el);
    const seq = ++TAB.seq;
    const search = document.getElementById('sc-search');
    if (search && search.dataset.bwPh !== mode) { search.placeholder = 'Search ticker, company, holder…'; search.dataset.bwPh = mode; }
    if (!C.money || !C.nodes) el.innerHTML = `<div style="padding:30px;text-align:center;${small}">Loading the Business Web…</div>`;
    const [nodes, money, chainsDoc] = await Promise.all([get('nodes'), get('money'), get('chains')]);
    if (seq !== TAB.seq || curMode() !== mode) return;                       // superseded by a newer render / view
    if (!money || !nodes) {
      el.innerHTML = introBox(`<strong style="color:var(--amber)">Business Web</strong> - ${FAIL.money || FAIL.nodes ? 'not reachable right now (TRAPP2-ANALYTICS data/web). It is rebuilt weekdays with the Early warning run (0920 / 1840 ET).' : 'loading…'}`);
      return;
    }
    el.innerHTML = mode === 'bw:links' ? viewLinks(money, q) : mode === 'bw:ownership' ? viewOwnership(nodes, money, q)
      : mode === 'bw:loops' ? viewLoops(money) : viewCompanies(nodes, money, chainsDoc, q);
    if (mode === 'bw:companies' && TAB.open) {
      const t = TAB.open, host = [...el.querySelectorAll('[data-bw-card]')].find(x => x.dataset.bwCard === t);
      if (host) {
        const [ipo, secDoc] = await Promise.all([get('ipo'), getSec(t), loadCusips()]);
        if (seq !== TAB.seq) return;
        const html = companyCardHtml(t, nodes.nodes[t], money, chainsDoc, ipo, secDoc, true);
        host.outerHTML = html || `<div style="${small}">Nothing on file for ${esc(t)} yet.</div>`;
      }
      fitOpen(el);
    }
  }
  // the open company's card sits inside a wide, sideways-scrolling table: pin it to the visible width (phones too)
  function fitOpen(el) {
    const st = el && el.querySelector('[data-bw-sticky]'), wrap = st && st.closest('[data-bw-wrap]');
    if (st && wrap && wrap.clientWidth > 0) st.style.width = Math.max(260, wrap.clientWidth - 14) + 'px';
  }
  let fitT = null;
  window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => fitOpen(document.getElementById('sc-content')), 150); });

  function hookChainTab() {
    try {
      if (typeof window.renderSupplyChainTab !== 'function' || window.renderSupplyChainTab.__bw) return !!window.renderSupplyChainTab;
      const orig = window.renderSupplyChainTab;
      const hooked = function () {
        const el = document.getElementById('sc-content');
        const mode = curMode();
        if (el && mode && String(mode).startsWith('bw:')) return renderTab(el, mode, curQuery());
        const search = document.getElementById('sc-search');
        if (search && search.dataset.bwPh) { delete search.dataset.bwPh; if (mode !== 'byticker') search.placeholder = 'Search ticker, company, or chain…'; }
        const r = orig.apply(this, arguments);
        if (el && mode === 'bychain' && !el.querySelector('[data-bw-hint]')) {
          el.insertAdjacentHTML('afterbegin', `<div data-bw-hint="1" style="${small};margin:0 0 8px">Business Web views (companies, money links, ownership, loops) are in the view menu above, under "Business Web".</div>`);
        }
        return r;
      };
      hooked.__bw = true;
      window.renderSupplyChainTab = hooked;
      return true;
    } catch (e) { return false; }
  }
  hookChainTab();                                               // app.js has loaded (this file comes after it)

  setInterval(() => { if (document.getElementById('company-13f-holders')) renderCompanyCard(); }, 1500);
  const boot = () => { hookChainTab(); mergeChains().catch(() => {}); loadCusips().then(hookCusip); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 2500));
  else setTimeout(boot, 2500);

  window.BusinessWeb = { get, getSec, mergeChains, graph, tooltip, panelHtml, renderCompanyCard, companyCardHtml, holdersHtml, flow,
                         loadCusips, cusipFor, hookCusip, renderTab, hookChainTab, TAB,
                         ready: () => !!C.money, failed: name => !!FAIL[name] };
})();
