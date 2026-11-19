/* ==========================================================================
   creditdesk.js — BONDS & CDS (z139). Data & Research → Bonds & CDS, and each company's own
   bonds and credit default swaps on its Valuation page. Load after app.js and charts.js.

   Data: TRAPP2-CREDIT/data (pipeline: fetch_cds_dtcc.py → fetch_bonds.py → build_credit_index.py,
   daily 0730 ET).
   • CDS: single-name trades from DTCC's SEC swap repository public tape — the 5-year spread
     (median of 4–6-year trades that day, in basis points), its 1-week / 1-month change, trades.
     Corporate names trade thinly: no trade = no point, never a filled-in value.
   • Bonds: every outstanding bond under the company's name (OpenFIGI): coupon, maturity, the
     maturity wall by year. Prices / yields arrive once FINRA TRACE access is confirmed.
   • Ratings (z194, data/ratings.json): a model-implied rating on the S&P scale for every company
     (fundamentals x distance to default x CDS), funds / futures / indices by look-through, sovereigns
     for country funds and FX, NR where there is no issuer. Not an agency rating - labelled as such.
   ========================================================================== */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const BASE = () => `${RAW()}/TRAPP2-CREDIT/main/data/`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { idx: null, at: 0, filter: 'all', q: '', sel: null, sort: 'cds', docs: {}, rat: null, ratAt: 0 };
  async function getJSON(f) { const r = await fetch(BASE() + f + '?_=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function loadIndex() { if (S.idx && Date.now() - S.at < 5 * 60000) return S.idx; try { S.idx = await getJSON('credit_index.json'); } catch (e) { S.idx = null; } S.at = Date.now(); return S.idx; }
  // z194: ratings - one file for every instrument, read on demand (never stored in the browser)
  async function loadRatings() { if (S.rat && Date.now() - S.ratAt < 5 * 60000) return S.rat; try { S.rat = await getJSON('ratings.json'); } catch (e) { S.rat = null; } S.ratAt = Date.now(); return S.rat; }
  const rOf = t => (S.rat && S.rat.ratings && S.rat.ratings[t]) || null;
  const BUS = ['excellent', 'strong', 'satisfactory', 'fair', 'weak', 'vulnerable'], FIN = ['minimal', 'modest', 'intermediate', 'significant', 'aggressive', 'highly leveraged'];
  const lab = (arr, v) => (v == null ? '—' : arr[Math.max(0, Math.min(5, Math.round(v) - 1))]);
  const rColor = n => (n == null ? 'var(--ink-faint)' : n <= 7 ? 'var(--pos)' : n <= 10 ? 'var(--amber)' : n <= 16 ? '#e0803a' : 'var(--neg)');
  const SC = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
  const letter = x => (x == null ? 'NR' : SC[Math.max(0, Math.min(21, Math.round(x) - 1))]);
  const badge = (r, big) => `<span style="display:inline-block;min-width:${big ? 44 : 34}px;text-align:center;padding:${big ? '3px 8px' : '1px 5px'};border:1px solid ${rColor(r && r.n)};color:${rColor(r && r.n)};font-family:var(--mono);font-weight:700;font-size:${big ? 17 : 11}px;border-radius:3px">${esc((r && r.r) || 'NR')}</span>`;
  const OUT = { negative: ['negative', 'var(--neg)'], positive: ['positive', 'var(--pos)'], 'watch-neg': ['watch ↓', 'var(--neg)'], 'watch-pos': ['watch ↑', 'var(--pos)'] };
  const outlook = o => { const v = OUT[o]; return v ? `<span style="color:${v[1]}">${v[0]}</span>` : 'stable'; };
  const KIND = { co: 'company', etf: 'fund', etp: 'leveraged / inverse', idx: 'index', fut: 'future', fx: 'FX', opt: 'option', nr: '—' };
  const sgn = v => (v == null ? '—' : `<span style="color:${v > 0 ? 'var(--pos)' : v < 0 ? 'var(--neg)' : 'inherit'}">${v > 0 ? '+' : ''}${(+v).toFixed(2)}</span>`);
  function basisTxt(r) {
    if (!r) return '';
    if (r.src === 'nr') return esc(r.why || 'no issuer to rate');
    if (r.src === 'event') return 'bankruptcy filing (8-K 1.03) or a …Q ticker';
    if (r.src === 'agency') return 'agency rating (config)';
    if (r.src === 'sovereign') return r.fx ? `long ${esc(r.fx.base)} ${esc(r.fx.bR)} / short ${esc(r.fx.quote)} ${esc(r.fx.qR)}` : `sovereign · ${esc(r.sov === 'blend' ? 'country blend' : r.sov || '')}`;
    if (r.src === 'bond') return esc(r.basis || r.sleeve || 'bond sleeve');
    if (r.src === 'lookthrough') return r.basket === 'stock' || r.basket === 'underlying' ? `look-through · ${esc(r.of || '')}` : `look-through · ${esc(r.basket === 'list' ? 'named holdings' : (r.basket || '').replace(/^SPX_SECTOR:/, 'S&P 500 ').replace(/^IND(_EQ|_NASDAQ)?:/, '').replace('SPX', 'S&P 500').replace('NDX', 'Nasdaq-100 (proxy)').replace('DJIA', 'Dow 30').replace('US_SMALL', 'US small caps (proxy)').replace('US_TOTAL', 'US market'))}`;
    return 'model: fundamentals · distance to default · CDS';
  }
  // the rating panel: company pillars, or a fund's look-through, or the sovereign / NR basis
  function ratingBlock(t, r, asOf) {
    if (!r) return '';
    const head = `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-bottom:6px">${badge(r, true)}
      <div style="font-family:var(--mono);font-size:10.5px;line-height:1.5"><div>outlook ${outlook(r.o)}${r.d30 ? ` · ${r.d30 > 0 ? '−' : '+'}${Math.abs(r.d30)} notch${Math.abs(r.d30) > 1 ? 'es' : ''} in 30 days` : ''}${r.lc ? ` · was ${esc(r.lc.from)} until ${esc(r.lc.on)}` : ''}</div>
      <div style="color:var(--ink-faint)">${esc(KIND[r.k] || '')}${r.lev != null && r.lev !== 1 ? ` · ${r.lev > 0 ? '+' : ''}${r.lev}× daily` : ''} · ${basisTxt(r)}${asOf ? ' · ' + esc(asOf) : ''}</div></div>
      <div style="margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-faint);text-align:right">credit trend ${sgn(r.tr)}<br>bot signal ${sgn(r.sig)}${r.k === 'etp' ? ' (unlevered)' : ''}</div></div>`;
    let body = '';
    const p = r.p || {}, f = r.fund || {}, w = r.w || {};
    if (r.k === 'co' && (p.fund || p.eq || p.cds)) {
      const pill = (name, arr, txt, wk) => `<div style="flex:1 1 180px;min-width:170px;border:1px solid var(--rule);padding:6px 8px"><div style="color:var(--ink-faint);font-size:9px">${name}${w[wk] != null ? ` · weight ${Math.round(w[wk] * 100)}%` : ''}</div><div style="font-size:13px;font-weight:700;color:${rColor(arr && arr[0])}">${arr ? letter(arr[0]) : '—'}</div><div style="font-size:9.5px;color:var(--ink-dim);line-height:1.45">${txt}</div></div>`;
      const fx = f.m === 'bank' || f.m === 'insurer'
        ? `${f.m} scorecard · equity/assets ${f.eqa != null ? (f.eqa * 100).toFixed(1) + '%' : '—'} · ROA ${f.roa != null ? (f.roa * 100).toFixed(2) + '%' : '—'} · assets $${f.assets != null ? f.assets.toLocaleString('en-US') + 'B' : '—'}`
        : f.rule ? `cash burn · runway ${f.runway != null ? f.runway + ' y' : '—'}`
          : `business ${lab(BUS, f.b)} · financial ${lab(FIN, f.f)}${f.lev != null ? ` · net debt/EBITDA ${f.lev.toFixed(1)}×` : ''}${f.ffo != null ? ` · FFO/debt ${f.ffo.toFixed(0)}%` : ''}${f.focf != null ? ` · FOCF/debt ${f.focf.toFixed(0)}%` : ''}${f.cov != null ? ` · EBITDA/interest ${f.cov.toFixed(1)}×` : ''}${f.captive ? ' · captive finance arm excluded' : ''}${f.liq ? ' · thin liquidity' : ''}`;
      body = `<div style="display:flex;flex-wrap:wrap;gap:6px;font-family:var(--mono);font-size:11px">
        ${pill('Fundamentals (S&P method)', p.fund, fx, 'fund')}
        ${pill('Distance to default', p.eq, p.eq ? `DD ${p.eq[1] != null ? p.eq[1].toFixed(1) : '—'} · equity vol ${p.eq[2] != null ? Math.round(p.eq[2] * 100) + '%' : '—'}${p.eq[3] ? ' (' + esc(p.eq[3]) + ')' : ''}` : 'not used (bank / insurer, or barely levered)', 'eq')}
        ${pill('CDS-implied', p.cds, p.cds ? `${bp(p.cds[1])} 5Y · liquidity ${Math.round((p.cds[2] || 0) * 100)}%${r.gap != null ? ` · market gap ${r.gap > 0 ? '+' : ''}${r.gap} notch${r.gap > 0 ? ' (priced worse)' : r.gap < 0 ? ' (priced better)' : ''}` : ''}` : 'no single-name CDS trades', 'cds')}</div>`;
    } else if (r.lt) {
      const lt = r.lt;
      body = `<div style="font-family:var(--mono);font-size:10.5px;line-height:1.6">${lt.rated} of ${lt.members} holdings rated (${Math.round(lt.coverage * 100)}% of the weight) · WARF ${lt.warf} → ${esc(letter(lt.n))} (default-weighted) · average ${esc(letter(lt.avg))} (${lt.avg}) · ${Math.round(lt.ig * 100)}% investment grade
        ${lt.top && lt.top.length ? `<div style="color:var(--ink-dim)">largest: ${lt.top.map(x => `${esc(x[0])} ${esc(x[2])} (${(x[1] * 100).toFixed(1)}%)`).join(' · ')}</div>` : ''}
        ${r.issuer ? `<div style="color:var(--ink-dim)">ETN issuer ${esc(r.issuer.name)} ${esc(r.issuer.r)} - the note is its unsecured debt</div>` : ''}${r.proxy ? `<div style="color:var(--ink-faint)">${esc(r.proxy)}</div>` : ''}</div>`;
    } else if (r.why || r.proxy) {
      body = `<div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim)">${esc(r.why || '')}${r.proxy ? ' · ' + esc(r.proxy) : ''}</div>`;
    }
    return `${head}${body}<div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:5px;line-height:1.5">Model-implied on the S&amp;P scale (TRAPP2-CREDIT, z194) - not an agency rating. ${r.k === 'co' ? 'Fundamentals: S&amp;P corporate methodology anchor; distance to default: Merton (Bharath–Shumway); CDS: 5-year spread vs ICE BofA OAS by rating.' : r.lt ? 'Holdings combined by Moody\'s WARF (a junk holding weighs more than a linear average).' : ''} The bot uses it in every trade: signal, no new longs CCC+ or worse, smaller longs in weaker credits, exits on distress / confirmed downgrades.</div>`;
  }

  async function doc(kind, t) { const k = kind + ':' + t; if (k in S.docs) return S.docs[k]; let d = null; try { d = await getJSON(`${kind}/issuers/${encodeURIComponent(t)}.json`); } catch (e) {} S.docs[k] = d; return d; }
  const bp = v => (v == null ? '—' : `${(+v).toFixed(0)} bp`);
  const chg = v => (v == null ? '—' : `<span style="color:${v > 0 ? 'var(--neg)' : v < 0 ? 'var(--pos)' : 'inherit'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}</span>`);   // wider = worse
  const dt = d => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
  const yrs = d => (d ? ((Date.parse(d) - Date.now()) / 31557600000) : null);
  const pct2 = v => (Math.round(v * 100 + (v >= 0 ? 1e-9 : -1e-9)) / 100).toFixed(2) + '%';   // 5.225 → 5.23 (half up, not binary-float 5.22)
  const openVal = t => { const i = document.getElementById('ticker'); if (i) i.value = t; if (typeof switchTab === 'function') switchTab('valuation'); if (typeof loadValuation === 'function') loadValuation(); };

  // maturity wall: bars of equal width, height ∝ count (exact), one per year present
  function wallSvg(wall, W = 320, H = 70) {
    const ys = Object.keys(wall || {}).sort();
    if (!ys.length) return '';
    const mx = Math.max(...ys.map(y => wall[y])), bw = W / ys.length;
    const lab = k => (ys.length <= 12 || k % Math.ceil(ys.length / 12) === 0);
    return `<svg viewBox="0 0 ${W} ${H + 14}" style="width:100%;max-width:520px;height:auto;display:block" role="img" aria-label="Bonds maturing by year">
      ${ys.map((y, k) => { const h = wall[y] / mx * (H - 4); return `<rect x="${(k * bw + bw * 0.15).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${(bw * 0.7).toFixed(2)}" height="${h.toFixed(2)}" fill="var(--amber)" opacity="0.85"><title>${y}: ${wall[y]} bond(s)</title></rect>${lab(k) ? `<text x="${(k * bw + bw / 2).toFixed(2)}" y="${H + 11}" font-size="8" text-anchor="middle" fill="var(--ink-faint)" font-family="var(--mono)">'${y.slice(2)}</text>` : ''}`; }).join('')}
      <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--rule)"/></svg>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint)">bonds maturing per year (count; tallest ${mx})</div>`;
  }

  async function detail(host, t) {
    host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">Loading…</div>';
    const [cd, bd] = await Promise.all([doc('cds', t), doc('bonds', t), loadRatings()]);
    const ix = ((S.idx || {}).tickers || {})[t] || {};
    const cds = ix.cds || {};
    const series = ((cd && cd.daily) || []).filter(d => d.bps5y != null).map(d => ({ d: d.date, c: d.bps5y }));
    const trades = ((cd && cd.trades) || []).slice(-25).reverse();
    const bonds = (bd && bd.bonds) || [];
    const rr0 = rOf(t);
    if (!(cd && (cd.trades || []).length) && !(bd && (bd.bonds || []).length) && rr0 && rr0.k !== 'co') {                                  // z194: a fund / future / FX - no bonds or CDS of its own
      host.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;margin-bottom:8px">
        <a href="#" data-cd-open="${esc(t)}" style="color:var(--amber);font-family:var(--mono);font-weight:700;font-size:14px;text-decoration:none;border-bottom:1px dotted var(--amber)">${esc(t)}</a>
        <span style="font-family:var(--mono);font-size:11px;color:var(--ink-dim)">${esc(rr0.name || '')}</span></div>
        <h4 style="margin-top:6px">Credit rating</h4>${ratingBlock(t, rr0, S.rat && S.rat.date)}`;
      host.querySelectorAll('[data-cd-open]').forEach(a => a.onclick = e => { e.preventDefault(); openVal(a.dataset.cdOpen); });
      return;
    }
    host.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;margin-bottom:8px">
        <a href="#" data-cd-open="${esc(t)}" style="color:var(--amber);font-family:var(--mono);font-weight:700;font-size:14px;text-decoration:none;border-bottom:1px dotted var(--amber)">${esc(t)}</a>
        <span style="font-family:var(--mono);font-size:11px;color:var(--ink-dim)">${esc(ix.name || (bd && bd.name) || '')}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-faint)">CDS 5Y ${bp(cds.bps5y)} · 1W ${chg(cds.chg1w)} · 1M ${chg(cds.chg1m)} bp</span></div>
      ${rOf(t) ? `<h4 style="margin-top:6px">Credit rating</h4>${ratingBlock(t, rOf(t), S.rat && S.rat.date)}` : ''}
      <h4 style="margin-top:10px">Credit default swaps <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${esc(((cd && cd.entities) || []).join(' · ') || 'no single-name CDS trades on file')}</span></h4>
      ${series.length >= 2 ? '<div class="cd-chart"></div>' : `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin:4px 0 8px">${series.length ? `One 5-year print so far: ${bp(series[0].c)} on ${dt(series[0].d)}.` : 'No 5-year spread prints yet.'} Corporate CDS trade thinly — the line fills in as trades are reported.</div>`}
      ${trades.length ? `<div style="overflow-x:auto;margin-top:6px"><table class="sb-table" style="width:100%;min-width:460px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Traded</th><th style="text-align:left">Entity</th><th style="text-align:right">Tenor</th><th style="text-align:right">Spread</th><th style="text-align:right">Upfront</th><th style="text-align:right">Notional</th></tr></thead><tbody>
        ${trades.map(x => `<tr><td style="white-space:nowrap">${esc(dt(x.date))}</td><td>${esc(x.entity)}</td><td style="text-align:right">${x.tenor != null ? x.tenor.toFixed(1) + 'y' : '—'}</td><td style="text-align:right">${bp(x.bps)}</td><td style="text-align:right">${x.upfront != null ? x.upfront.toFixed(2) : '—'}</td><td style="text-align:right">${x.notional != null ? (x.ccy ? esc(x.ccy) + ' ' : '') + (+x.notional).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:3px">DTCC public tape: notional is capped in dissemination; some trades are quoted as upfront points rather than a spread.</div>` : ''}
      <h4 style="margin-top:12px">Bonds outstanding <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${bonds.length} · OpenFIGI${bd && bd.updatedAt ? ' · ' + esc(bd.updatedAt.slice(0, 10)) : ''}</span></h4>
      ${bonds.length ? wallSvg(ix.wall || bonds.reduce((w, b) => { const y = b.maturity.slice(0, 4); w[y] = (w[y] || 0) + 1; return w; }, {})) + `
        <div style="overflow-x:auto;margin-top:6px;max-height:360px;overflow-y:auto"><table class="sb-table" style="width:100%;min-width:460px;font-family:var(--mono);font-size:11px"><thead><tr><th style="text-align:left">Bond</th><th style="text-align:right">Coupon</th><th style="text-align:right">Maturity</th><th style="text-align:right">Years left</th><th style="text-align:left">Type</th></tr></thead><tbody>
        ${bonds.map(b => `<tr><td>${esc(b.desc)}</td><td style="text-align:right">${b.coupon != null ? b.coupon.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%' : 'floating'}</td><td style="text-align:right;white-space:nowrap">${esc(dt(b.maturity))}</td><td style="text-align:right">${(yrs(b.maturity) || 0).toFixed(1)}</td><td>${esc(b.type || '')}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:3px">Terms only — prices and yields come from FINRA TRACE once its access is confirmed (no invented prices).</div>` : '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint)">No bonds on file for this company yet (lists refresh in batches every run).</div>'}`;
    host.querySelectorAll('[data-cd-open]').forEach(a => a.onclick = e => { e.preventDefault(); openVal(a.dataset.cdOpen); });
    const ch = host.querySelector('.cd-chart');
    if (ch && window.VChart && VChart.mountSeriesChart) VChart.mountSeriesChart(ch, { key: 'cds-' + t, title: `${t} CDS 5Y`, daily: series, range: '1Y', ranges: ['1M', '3M', '6M', '1Y', 'ALL'], upIsBad: true, bars: false,
      axisFmt: v => v.toFixed(0) + ' bp', fmt: v => v.toFixed(0) + ' bp', note: 'Median 4–6-year single-name CDS trade per day (basis points); red when wider.' });
  }

  async function render(host) {
    if (!host) return;
    if (!S.idx) host.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);padding:20px 0">Loading bonds &amp; CDS…</div>';
    const [idx] = await Promise.all([loadIndex(), loadRatings()]);
    if (!host.isConnected) return;
    const rat = S.rat && S.rat.ratings;
    if ((!idx || !idx.tickers) && !rat) {
      host.innerHTML = `<div class="company-card"><h4>Bonds &amp; CDS</h4><div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);line-height:1.6">Waiting for the first run of <strong>TRAPP2-CREDIT → Credit (bonds + CDS)</strong>. Create the repo, add the files, then run the workflow once with backfill = 60 (Actions tab). CDS come from DTCC's public swap tape, bond lists from OpenFIGI, prices from FINRA TRACE once confirmed.</div></div>`;
      return;
    }
    if (S.filter === 'ratings' && !rat) S.filter = 'all';
    if (S.filter !== 'ratings' && (!idx || !idx.tickers)) S.filter = 'ratings';
    const Q = S.q.toUpperCase();
    const byQ = r => !Q || r.t.includes(Q) || String(r.name || '').toUpperCase().includes(Q);
    const rk = r => (r.rat && r.rat.n ? 100 - r.rat.n : -1);            // best first, NR last
    let rows, key;
    if (S.filter === 'ratings') {
      rows = Object.entries(rat).map(([t, v]) => ({ t, name: v.name, rat: v })).filter(byQ);
      key = { t: r => r.t, rating: rk, sig: r => (r.rat.sig != null ? r.rat.sig : -9), tr: r => (r.rat.tr != null ? r.rat.tr : -9) }[S.sort] || rk;
    } else {
      rows = Object.entries(idx.tickers).map(([t, v]) => ({ t, ...v, rat: rat ? rat[t] : null }))
        .filter(r => S.filter === 'all' || (S.filter === 'cds' ? !!r.cds : (r.bonds || 0) > 0)).filter(byQ);
      key = { cds: r => (r.cds && r.cds.bps5y != null ? r.cds.bps5y : -1), chg: r => (r.cds && r.cds.chg1m != null ? r.cds.chg1m : -1e9), bonds: r => r.bonds || 0, t: r => r.t, mat: r => r.nextMaturity || '9999', rating: rk }[S.sort] || (r => r.t);
    }
    rows.sort((a, b) => { const x = key(a), y = key(b); return typeof x === 'string' ? x.localeCompare(y) : (y - x) || a.t.localeCompare(b.t); });
    const nC = idx && idx.tickers ? Object.values(idx.tickers).filter(v => v.cds).length : 0, nB = idx && idx.tickers ? Object.values(idx.tickers).filter(v => v.bonds).length : 0;
    const nR = rat ? Object.values(rat).filter(v => v.n).length : 0;
    const prog = (idx && idx.bondsProgress) || {};                  // z146: bond lists fill in over runs - say how far along
    const progress = prog.issuers ? ` (bond lists checked for ${prog.checked} of ${prog.issuers} companies${prog.checked < prog.issuers ? ' so far — the rest fill in with the next runs' : ''})` : '';
    const th = (k, l, al = 'right') => `<th data-cd-sort="${k}" style="text-align:${al};cursor:pointer;${S.sort === k ? 'color:var(--amber)' : ''}">${l}${S.sort === k ? ' ▾' : ''}</th>`;
    const table = S.filter === 'ratings'
      ? `<table class="sb-table" style="width:100%;min-width:720px;font-family:var(--mono);font-size:11px">
          <thead><tr>${th('t', 'Ticker', 'left')}<th style="text-align:left">Name</th>${th('rating', 'Rating', 'center')}<th style="text-align:left">Outlook</th><th style="text-align:left">Type</th><th style="text-align:left">Basis</th>${th('tr', 'Trend')}${th('sig', 'Bot signal')}</tr></thead>
          <tbody>${rows.slice(0, 600).map(r => `<tr data-cd-row="${esc(r.t)}" style="cursor:pointer;${S.sel === r.t ? 'background:rgba(212,160,23,0.10)' : ''}"><td style="color:var(--amber);font-weight:700">${esc(r.t)}</td><td>${esc(r.name || '')}</td><td style="text-align:center">${badge(r.rat)}</td><td>${outlook(r.rat.o)}</td><td>${esc(KIND[r.rat.k] || '')}${r.rat.lev != null && r.rat.lev !== 1 ? ' ' + (r.rat.lev > 0 ? '+' : '') + r.rat.lev + '×' : ''}</td><td style="color:var(--ink-dim)">${basisTxt(r.rat)}</td><td style="text-align:right">${sgn(r.rat.tr)}</td><td style="text-align:right">${sgn(r.rat.sig)}</td></tr>`).join('')}</tbody></table>`
      : `<table class="sb-table" style="width:100%;min-width:700px;font-family:var(--mono);font-size:11px">
          <thead><tr>${th('t', 'Ticker', 'left')}<th style="text-align:left">Company</th>${th('rating', 'Rating', 'center')}${th('bonds', 'Bonds')}${th('mat', 'Next maturity')}<th style="text-align:right">Avg coupon</th>${th('cds', 'CDS 5Y')}<th style="text-align:right">1W</th>${th('chg', '1M')}<th style="text-align:right">Trades 30d</th></tr></thead>
          <tbody>${rows.slice(0, 400).map(r => `<tr data-cd-row="${esc(r.t)}" style="cursor:pointer;${S.sel === r.t ? 'background:rgba(212,160,23,0.10)' : ''}"><td style="color:var(--amber);font-weight:700">${esc(r.t)}</td><td>${esc(r.name || '')}</td><td style="text-align:center">${r.rat ? badge(r.rat) : '—'}</td><td style="text-align:right">${r.bonds || '—'}</td><td style="text-align:right;white-space:nowrap">${esc(dt(r.nextMaturity))}</td><td style="text-align:right">${r.avgCoupon != null ? pct2(r.avgCoupon) : '—'}</td><td style="text-align:right">${bp(r.cds && r.cds.bps5y)}</td><td style="text-align:right">${chg(r.cds && r.cds.chg1w)}</td><td style="text-align:right">${chg(r.cds && r.cds.chg1m)}</td><td style="text-align:right">${r.cds ? r.cds.n30 : '—'}</td></tr>`).join('')}</tbody></table>`;
    host.innerHTML = `
      <section class="company-card" style="margin:0 0 12px">
        <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">BONDS &amp; CDS · ${nB} companies with bonds${esc(progress)} · ${nC} with CDS trades${rat ? ` · ${nR} instruments rated` : ''}</div>
          <span class="seg-control" style="font-size:10px">${[['all', 'All'], ['cds', 'With CDS'], ['bonds', 'With bonds'], ['ratings', 'Ratings']].filter(([k]) => k !== 'ratings' || rat).map(([k, l]) => `<button class="seg-btn ${S.filter === k ? 'active' : ''}" data-cd-f="${k}" style="font-size:10px">${l}</button>`).join('')}</span>
          <input data-cd-q placeholder="ticker or name" value="${esc(S.q)}" style="font-family:var(--mono);font-size:11px;padding:4px 6px;background:var(--bg-elev);border:1px solid var(--rule);color:var(--ink);min-width:120px">
          <div style="margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">CDS ${esc(((idx && idx.cdsAsOf) || '').slice(0, 10) || '—')} · index ${esc(((idx && idx.asOf) || '').slice(0, 10) || '—')}${rat ? ' · ratings ' + esc(S.rat.date || '') : ''}</div></div>
        <div style="overflow-x:auto;margin-top:8px;max-height:460px;overflow-y:auto">${table}</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--ink-faint);margin-top:6px;line-height:1.5">${S.filter === 'ratings'
          ? 'Ratings: model-implied on the S&amp;P scale (not agency ratings) - companies from fundamentals, distance to default and CDS; funds, futures and indices by look-through of their holdings (Moody\'s WARF); country funds, Treasuries and FX by sovereign; NR where there is no issuer. Trend: CDS, option-implied volatility and rating migration, −1..+1. Bot signal: what the bot\'s \'credit\' component reads (a leveraged / inverse fund\'s before its sign). Tap a row for the detail.'
          : 'CDS 5Y = median single-name CDS trade with 4–6 years to maturity on its latest trading day (DTCC SEC swap repository, public tape); change in basis points, red = wider (worse credit). Bonds = outstanding bonds under the company\'s name (OpenFIGI). Rating = the model-implied rating (Ratings tab for every instrument). Tap a row for the bonds and trades.'}</div>
      </section>
      <section class="company-card cd-detail" style="margin:0 0 12px;${S.sel ? '' : 'display:none'}"></section>`;
    host.querySelectorAll('[data-cd-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.cdF; if (S.filter === 'ratings' && !['t', 'rating', 'sig', 'tr'].includes(S.sort)) S.sort = 'rating'; if (S.filter !== 'ratings' && ['sig', 'tr'].includes(S.sort)) S.sort = 'cds'; render(host); });
    host.querySelectorAll('[data-cd-sort]').forEach(b => b.onclick = () => { S.sort = b.dataset.cdSort; render(host); });
    const q = host.querySelector('[data-cd-q]'); if (q) q.onchange = () => { S.q = q.value.trim(); render(host); };
    host.querySelectorAll('[data-cd-row]').forEach(tr => tr.onclick = () => { S.sel = tr.dataset.cdRow; render(host); });
    if (S.sel) detail(host.querySelector('.cd-detail'), S.sel);
  }

  // ---- each company's own bonds & CDS on its Valuation page (under the earnings card) ----
  async function renderTicker(t) {
    const anchor = document.getElementById('ern-ticker-section') || document.getElementById('price-chart-section');
    if (!anchor || !t) return;
    let sec = document.getElementById('credit-ticker-section');
    if (!sec) { sec = document.createElement('div'); sec.id = 'credit-ticker-section'; sec.className = 'section'; }
    if (sec.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', sec);
    sec.dataset.ticker = t;
    const [idx] = await Promise.all([loadIndex(), loadRatings()]);
    if (sec.dataset.ticker !== t) return;
    const v = idx && idx.tickers && idx.tickers[t];
    const rr = rOf(t);                                                          // z194: every instrument has a rating (or NR)
    if (!v && !rr) { sec.innerHTML = ''; sec.style.display = 'none'; return; }  // nothing on file: nothing to show
    sec.style.display = '';
    const c = (v && v.cds) || {};
    sec.innerHTML = `<div class="company-card"><h4>Credit${v ? ' · bonds &amp; CDS' : ''} <span style="color:var(--ink-faint);font-size:9px;text-transform:none;letter-spacing:0;font-weight:400">· ${esc(t)}</span></h4>
      ${rr ? `<div style="margin-bottom:10px">${ratingBlock(t, rr, S.rat && S.rat.date)}</div>` : ''}
      ${v ? `<div style="display:flex;flex-wrap:wrap;gap:10px 22px;font-family:var(--mono);font-size:11px;margin-bottom:8px">
        <div><div style="color:var(--ink-faint);font-size:9px">CDS 5Y</div><div style="font-size:15px;font-weight:700">${bp(c.bps5y)}</div><div style="font-size:9px;color:var(--ink-faint)">${c.bps5yDate ? 'as of ' + esc(dt(c.bps5yDate)) : 'no 5-year print'}</div></div>
        <div><div style="color:var(--ink-faint);font-size:9px">1W / 1M</div><div style="font-size:13px">${chg(c.chg1w)} / ${chg(c.chg1m)} bp</div><div style="font-size:9px;color:var(--ink-faint)">${c.n30 != null ? c.n30 + ' trades in 30 days' : 'no CDS trades on file'}</div></div>
        <div><div style="color:var(--ink-faint);font-size:9px">Bonds outstanding</div><div style="font-size:15px;font-weight:700">${v.bonds || 0}</div><div style="font-size:9px;color:var(--ink-faint)">${v.nextMaturity ? 'next ' + esc(dt(v.nextMaturity)) + ' · last ' + esc(dt(v.lastMaturity)) : ''}</div></div>
        <div><div style="color:var(--ink-faint);font-size:9px">Avg coupon</div><div style="font-size:13px">${v.avgCoupon != null ? pct2(v.avgCoupon) : '—'}</div></div></div>
      ${v.wall ? wallSvg(v.wall) : ''}` : ''}
      <div style="margin-top:6px"><a href="#" data-cd-desk="${esc(t)}" style="font-family:var(--mono);font-size:10px;color:var(--amber)">Open in Data &amp; Research → Bonds &amp; CDS ›</a></div></div>`;
    const a = sec.querySelector('[data-cd-desk]');
    if (a) a.onclick = e => { e.preventDefault(); S.sel = t; S.filter = v ? 'all' : 'ratings'; if (!v) S.sort = 'rating'; if (typeof switchTab === 'function') switchTab('creditdesk'); const h = document.getElementById('creditdesk-mount'); if (h) render(h); };
  }
  (function () {
    const orig = window.renderSummary;
    if (typeof orig !== 'function' || orig._z139) return;
    const w = function () { const r = orig.apply(this, arguments); try { const st = arguments[0] || (typeof state !== 'undefined' ? state.stock : null); if (st && st.ticker) setTimeout(() => renderTicker(String(st.ticker).toUpperCase()), 50); } catch (e) {} return r; };
    w._z139 = true; Object.keys(orig).forEach(k => { w[k] = orig[k]; });
    window.renderSummary = w;
  })();
  window.CreditDesk = { render, renderTicker, ratingOf: t => rOf(String(t || '').toUpperCase()), loadRatings, _S: S };
})();
