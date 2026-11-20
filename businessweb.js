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
    if (e.pct) bits.push(`~${e.pct}%`);
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
    let added = 0, relabelled = 0;
    for (const c of d.chains) {
      if (!c || !c.id) continue;
      const mine = have.get(c.id);
      if (!mine) {
        SUPPLY_CHAINS.push(Object.assign({}, c, { _source: 'TRAPP2-ANALYTICS config/supply_chains.json' }));
        added++;
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
    merged = { added, relabelled, at: d.asOf };
    try {
      if (added && typeof renderSupplyChainTab === 'function' && document.getElementById('sc-content') && document.getElementById('sc-content').offsetParent) renderSupplyChainTab();
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
    const legend = Object.entries(TYPE_COL).map(([k, c]) => `<span><span style="color:${c}">■</span> ${esc(k)}</span>`).join(' · ');
    const notes = Object.entries(m.nodeNotes || {}).map(([t, n]) => `<div><strong style="color:var(--ink)">${esc(t)}</strong>: ${esc(Object.entries(n).filter(([k]) => !/src$/i.test(k)).map(([, v]) => v).join(' · '))}</div>`).join('');
    const src = Object.entries(m.sources || {}).map(([k, s]) => `<div>${esc(k)} · ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--ink-dim)">${esc(s.title)}</a>` : esc(s.title)}</div>`).join('');
    return `<div style="${mono};font-size:10px;color:var(--ink-dim);padding:8px 2px 2px;line-height:1.5">
      <div>${legend} · arrows point the way money or value flows (a warrant: from the issuer to the holder; underwriting fees: issuer → bank) · <span style="color:var(--ink)">thick = part of a loop</span></div>
      <div style="margin-top:6px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Loops - money that comes back to where it started (${(m.loops || []).length})</div>
      <ul style="list-style:none;margin:2px 0 0;padding:0">${loops || '<li>none</li>'}</ul>
      ${circ ? `<div style="margin-top:8px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;font-size:9px">Funding its own customers</div>
      <div style="overflow-x:auto"><table class="sb-table" style="width:100%;min-width:560px;${mono};font-size:10px;margin-top:4px"><thead><tr><th style="text-align:left">Company</th><th style="text-align:left">Funds / owns these buyers</th><th>Invested</th><th>Committed back</th><th title="multi-year commitments vs one year's revenue - a scale, not like for like">÷ revenue</th><th>Loops</th></tr></thead><tbody>${circ}</tbody></table></div>` : ''}
      ${notes ? `<div style="margin-top:8px">${notes}</div>` : ''}
      <details style="margin-top:6px"><summary style="cursor:pointer;color:var(--ink-faint)">Sources (${Object.keys(m.sources || {}).length}) · confidence: <span style="color:${CONF_COL.filing}">filing</span> · <span style="color:${CONF_COL.disclosed}">disclosed</span> · <span style="color:${CONF_COL.reported}">reported</span> · <span style="color:${CONF_COL.inferred}">inferred</span></summary>${src}</details>
      <div style="${small};margin-top:6px">Amounts as announced / filed; "up to" commitments and capacity (GW) are not cash; ÷ revenue compares multi-year commitments with one year's revenue. Built ${esc(m.asOf || '')} from TRAPP2-ANALYTICS config/web_relationships.json - every edge carries its source and confidence; corrections go there.</div>
    </div>`;
  }

  // ---- 3) the company page card --------------------------------------------------------------------------------
  function factsHtml(f) {
    if (!f) return '';
    const cells = [['Revenue', f.rev], ['Operating income', f.opInc], ['Net income', f.ni], ['Operating cash flow', f.ocf], ['Capex', f.capex], ['Cash', f.cash], ['Long-term debt', f.debt], ['Equity', f.eq]]
      .filter(([, v]) => v != null);
    if (!cells.length) return '';
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-top:6px">${cells.map(([k, v]) => `<div style="border:1px solid var(--rule);border-radius:3px;padding:5px 7px"><div style="${small};text-transform:uppercase;letter-spacing:.06em">${esc(k)}</div><div style="${mono};font-size:12px;color:var(--ink)">${esc(usd(v))}</div></div>`).join('')}</div>
      <div style="${small};margin-top:3px">SEC XBRL as filed (TTM where available), latest period ${esc(f.fy || '—')}${f.staleKeys && f.staleKeys.length ? ` · not shown, older than ~15 months: ${esc(f.staleKeys.join(', '))}` : ''}${f.v === 1 ? ' · refresh to the merged series pending' : ''}</div>`;
  }

  function companyCardHtml(t, n, money, chainsDoc, ipo) {
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
    if (c) parts.push(`<div style="${mono};font-size:10.5px;color:var(--ink);margin-top:6px;line-height:1.5">Funds or owns companies that are committed buyers of it: ${esc(usd(c.investedUSD))} in, ${esc(backTxt(c))} committed back${c.committedBackToRevenue != null ? ` - ${(c.committedBackToRevenue * 100).toFixed(0)}% of a year's revenue (multi-year)` : ''} · in ${c.loops} money loop${c.loops === 1 ? '' : 's'}.</div>`);
    if (n && n.notes) parts.push(`<div style="${mono};font-size:10px;color:var(--ink-dim);margin-top:4px;line-height:1.5">${esc(Object.entries(n.notes).filter(([k]) => !/src$/i.test(k)).map(([, v]) => v).join(' · '))}</div>`);
    if (n && n.facts) parts.push(factsHtml(n.facts));
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
    return `<div class="company-card" id="company-business-web" data-ticker="${esc(t)}">
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
      const [nodes, money, chainsDoc, ipo] = await Promise.all([get('nodes'), get('money'), get('chains'), get('ipo')]);
      const a2 = document.getElementById('company-13f-holders');
      if (!a2) return;
      const n = nodes && nodes.nodes ? nodes.nodes[t] : null;
      const html = companyCardHtml(t, n, money, chainsDoc, ipo);
      const cur = document.getElementById('company-business-web');
      if (cur) cur.remove();
      a2.dataset.bwDone = t;
      if (html) a2.insertAdjacentHTML('beforebegin', html);
    } finally { cardBusy = false; }
  }

  setInterval(() => { if (document.getElementById('company-13f-holders')) renderCompanyCard(); }, 1500);
  const boot = () => { mergeChains().catch(() => {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 2500));
  else setTimeout(boot, 2500);

  window.BusinessWeb = { get, mergeChains, graph, tooltip, panelHtml, renderCompanyCard, companyCardHtml, flow,
                         ready: () => !!C.money, failed: name => !!FAIL[name] };
})();
