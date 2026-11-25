/* ============================================================
   >>> DESTINATION: TheMostLocal/TRAPP2-Frontend
   >>> FILE PATH:   trends.js
   z201 - TODAY'S TRENDS (Macro Data → Today's Trends). Owner 11-20 1304 ET: "I need the system to understand trends
   like this and point it out … make a new tab called today's trends … focus on important trends … use close and open
   prices in appropriate times … consider there is likely a sell off going on … understand the weights of each stock in
   the S&P 500 to understand what is making the percentage fall to what it is and how."
   Reads TRAPP2-ANALYTICS data/trends/latest.json (pipeline/trends.py, every 30 min in the session) + history.json, and
   the live tape (TRAPP2-1 data/intraday/latest.json, every 15 min) so the headline - the S&P 500 now and what a red
   or green close would make its run - keeps up between pipeline runs. A red day is a close below the prior close
   (close-to-close); the open is shown where it belongs (the gap, the move from the open). In memory only (no storage).
   ============================================================ */
(function () {
  'use strict';
  const RAW = () => (typeof GH_RAW !== 'undefined' && GH_RAW ? GH_RAW : 'https://raw.githubusercontent.com/TheMostLocal');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mono = 'font-family:var(--mono)';
  const small = `${mono};font-size:9px;color:var(--ink-faint);line-height:1.5`;
  const S = { doc: null, hist: null, tape: null, at: 0, tapeAt: 0, host: null, timer: null, showAll: false, err: null };
  const SPX = '^GSPC';

  const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
  const pc = (v, d = 2) => (num(v) == null ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);
  const col = v => (num(v) == null || +v === 0 ? 'var(--ink)' : +v > 0 ? 'var(--pos)' : 'var(--neg)');
  const bp = (v, d = 0) => { const r = +(+v).toFixed(d); return r === 0 ? (0).toFixed(d) : `${r > 0 ? '+' : ''}${r.toFixed(d)}`; };
  const fmt = (v, d = 2) => (num(v) == null ? '—' : (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const when = d => { try { const x = new Date(d + 'T12:00:00Z'); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return d; } };
  const range = (a, b) => {
    try {
      const x = new Date(a + 'T12:00:00Z'), y = new Date(b + 'T12:00:00Z');
      const m = z => z.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      if (a === b) return when(a);
      if (x.getUTCFullYear() !== y.getUTCFullYear()) return `${when(a)} – ${when(b)}`;
      if (x.getUTCMonth() !== y.getUTCMonth()) return `${m(x)} ${x.getUTCDate()} – ${m(y)} ${y.getUTCDate()}, ${y.getUTCFullYear()}`;
      return `${m(x)} ${x.getUTCDate()}–${y.getUTCDate()}, ${y.getUTCFullYear()}`;
    } catch (e) { return `${a} – ${b}`; }
  };

  async function getJson(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  async function load(force) {
    const now = Date.now();
    if (force || !S.doc || now - S.at > 10 * 60e3) {
      const [doc, hist] = await Promise.all([getJson(`${RAW()}/TRAPP2-ANALYTICS/main/data/trends/latest.json`),
                                              getJson(`${RAW()}/TRAPP2-ANALYTICS/main/data/trends/history.json`)]);
      if (doc) { S.doc = doc; S.at = now; S.err = null; } else if (!S.doc) S.err = 'not reachable';
      if (hist) S.hist = hist;
    }
    if (force || now - S.tapeAt > 110e3) {
      const t = await getJson(`${RAW()}/TRAPP2-1/main/data/intraday/latest.json`);
      if (t) { S.tape = t; S.tapeAt = now; }
    }
  }

  // ---- the headline: the S&P 500 now, from the freshest source (the tape between pipeline runs) ------------------
  function live(doc, tape) {
    const c = ((doc || {}).indices || {})[SPX];
    if (!c) return null;
    const out = { close: c.close, prev: c.prevClose, chg: c.chg, open: c.open, gap: c.gap, fromOpen: c.fromOpen, final: c.final,
                  asOf: c.asOf, date: c.date, source: 'trends' };
    const t = (doc.proxy && doc.proxy[SPX]) ? {} : (tape || {});       // z206: an ETF's read is not mixed with the index's tape
    const p = num((t.p || {})[SPX]), pv = num((t.prevClose || {})[SPX]), cl = num((t.close || {})[SPX]), op = num((t.open || {})[SPX]);
    const trading = t.session === 'regular' || t.session === 'early-close';
    const through = ((c.next || {}).after) || (c.streak || {}).through || '';
    const etMin = +t.etMinute || 0, closeMin = +t.closeMinuteET || 960;
    // the tape is today's session, after the last completed close, and at least as new as the trends doc (same rules
    // as pipeline/trends.py tape_point: final with the official close, or 30 minutes after the bell)
    if (trading && t.date && (cl || p) && pv && t.date > through && t.date >= (c.date || '') && etMin >= 570
        && !(t.date === c.date && c.final)) {
      const px = cl || p;
      out.close = px; out.prev = pv; out.chg = (px / pv - 1) * 100; out.date = t.date;
      out.final = !!cl || etMin >= closeMin + 30; out.asOf = t.etTime; out.source = 'tape';
      if (op) { out.open = op; out.gap = (op / pv - 1) * 100; out.fromOpen = (px / op - 1) * 100; }
      else { out.open = out.gap = out.fromOpen = null; }
    }
    return out;
  }
  const since = cx => (cx && cx.last ? ` — the first since ${esc(range(cx.last.from, cx.last.to))} (${cx.atLeast} since ${String(cx.since || '').slice(0, 4)})`
                                     : cx ? ` — the longest in the record (since ${String(cx.since || '').slice(0, 4)})` : '');
  function runLine(doc, now) {
    const c = ((doc || {}).indices || {})[SPX] || {};
    const s = c.streak, nx = c.next || c.provisional || null;
    if (!s) return '';
    const word = s.dir === 'down' ? 'lower' : 'higher';
    const ctx = s.context || {};
    let t = `<strong>${s.n} straight ${word} close${s.n === 1 ? '' : 's'}</strong> (${esc(range(s.from, s.through))})`;
    if (s.n >= 3) t += since(ctx).replace('the first since', `the first ${s.n}-session ${s.dir === 'down' ? 'losing' : 'winning'} run since`);
    t += '.';
    if (!now || !nx || (nx.after && nx.after !== s.through)) return t;
    const cont = s.dir === 'down' ? 'red' : 'green', other = cont === 'red' ? 'green' : 'red';
    const sc = nx[cont] || {};
    if (now.date > s.through) {                                          // today is not in the run yet
      const nowDir = now.chg < 0 ? 'red' : now.chg > 0 ? 'green' : 'flat';
      const shown = nowDir === 'flat' ? 'flat' : `<span style="color:${col(now.chg)}">${nowDir}</span>`;
      if (now.final) {
        t += nowDir === cont ? ` Today closed ${shown} (${pc(now.chg)}): that makes it <strong>${sc.n}</strong>${since(sc.context)}.`
                             : ` Today closed ${shown} (${pc(now.chg)}): the run ends at ${s.n}.`;
      } else {
        t += ` Today is ${shown} (${pc(now.chg)}${now.asOf ? ` at ${esc(now.asOf)} ET` : ''}): a ${cont} close makes it <strong>${sc.n}</strong>${since(sc.context)}; a ${other} close ends it at ${s.n}.`;
      }
    } else if (sc.n) {                                                    // after the close / before the next open
      t += ` Next session: a ${cont} close makes it <strong>${sc.n}</strong>${since(sc.context)}; a ${other} close ends it at ${s.n}.`;
    }
    return t;
  }

  // ---- sections -------------------------------------------------------------------------------------------------
  const SEV = { 3: '●●●', 2: '●●', 1: '●' };
  const card = (key, title, body, extra) => `<section class="company-card" data-tt-sec="${key}" style="margin:0 0 12px">${title ? `<h4>${title}</h4>` : ''}${body}${extra || ''}</section>`;
  const table = (min, head, rows) => `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table class="sb-table" style="width:100%;min-width:${min}px;${mono};font-size:10.5px"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const th = (x, left) => `<th style="${left ? 'text-align:left;' : 'text-align:right;'}white-space:nowrap">${x}</th>`;
  const td = (x, left, style) => `<td style="${left ? 'text-align:left;' : 'text-align:right;'}${style || ''}">${x}</td>`;
  const tick = t => `<a href="#" data-tt-open="${esc(t)}" style="color:var(--amber);text-decoration:none;font-weight:700">${esc(t)}</a>`;

  const kv = (label, value, sub, size, color) => `<div><div style="font-size:9px;color:var(--ink-faint)">${label}</div> <div style="font-size:${size}px;font-weight:700${color ? `;color:${color}` : ''}">${value}</div> ${sub ? `<div style="font-size:9px;color:var(--ink-faint)">${sub}</div>` : ''}</div> `;
  function headline(doc, now) {
    const read = doc.read || {};
    const phase = { session: 'IN SESSION', premarket: 'PRE-MARKET', 'after-close': 'AFTER THE CLOSE', closed: 'MARKET CLOSED' }[doc.phase] || String(doc.phase || '').toUpperCase();
    const state = now.final ? `final close ${esc(when(now.date))}` : `provisional · ${esc(now.asOf || '')} ET${now.source === 'tape' ? ' (live tape)' : ''}`;
    const rc = read.state === 'heavy sell-off' || read.overlay === 'bear market' ? 'var(--neg)' : read.state === 'sell-off' || read.overlay ? 'var(--amber)' : read.state === 'under pressure' ? 'var(--amber)' : 'var(--pos)';
    const macro = doc.macro;
    return `<section class="company-card" style="margin:0 0 12px">
      <div style="${mono};font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">TODAY'S TRENDS · ${esc(phase)} · ${state}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px 30px;margin-top:10px;${mono};align-items:flex-end">
        ${kv(esc((((doc.indices || {})[SPX] || {}).name) || 'S&P 500'), fmt(now.close), '', 24)}
        ${kv('CLOSE-TO-CLOSE', pc(now.chg), `vs ${fmt(now.prev)} prior close`, 20, col(now.chg))}
        ${num(now.gap) != null ? kv('AT THE OPEN', pc(now.gap), `opened ${fmt(now.open)}`, 16, col(now.gap)) + kv('FROM THE OPEN', pc(now.fromOpen), '', 16, col(now.fromOpen)) : ''}
        ${kv('THE SELL-OFF READ', esc(String(read.label || '—').toUpperCase()), `${read.on != null ? `${read.on} of ${read.of} criteria on` : ''}${now.source === 'tape' && doc.etTime && doc.etTime !== now.asOf ? ` · as of ${esc(doc.etTime)} ET` : read.provisional ? ' · counting today' : ''}`, 16, rc)}
      </div>
      <div style="${mono};font-size:11px;color:var(--ink);margin-top:10px;line-height:1.6">${runLine(doc, now)}</div>
      ${doc.proxy ? `<div style="${mono};font-size:10px;color:var(--amber);margin-top:6px;line-height:1.5">Read on ETFs: ${esc(Object.entries(doc.proxy).filter(([k, v]) => k !== v).map(([k, v]) => `${k} = ${v}`).join(' · '))} (TRAPP2) - the macro book (TRAPP2-1) can't be read, so no VIX, rates, dollar, commodities or crypto until it is back.</div>` : ''}
      ${macro ? `<div style="${small};margin-top:6px">The slower read - early warning (credit, lending, labour, valuation data, ${esc(macro.date || '')}): ${esc(String(macro.level || '').toUpperCase())} risk, ${esc(macro.regime || '')}.</div>` : ''}
    </section>`;
  }

  function notableCard(doc) {
    const all = doc.notable || [];
    const items = S.showAll ? all : all.slice(0, 10);
    const tag = k => ({ provisional: 'today', streak: 'run', move: 'move', regime: 'read', drawdown: 'drawdown', breadth: 'inside', attribution: 'the run', fear: 'fear', distribution: 'selling', trend: 'trend', sectors: 'sectors', history: 'context', data: 'data check', flows: 'positioning', relief: 'base rate', 'follow-through': 'follow-through' }[k] || k);
    const rows = items.map(n => `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--rule);${mono};font-size:11px;line-height:1.5">
        <span style="flex:0 0 34px;color:${n.sev >= 3 ? 'var(--neg)' : n.sev === 2 ? 'var(--amber)' : 'var(--ink-faint)'};letter-spacing:-1px" title="${n.sev >= 3 ? 'rare' : n.sev === 2 ? 'notable' : 'context'}">${SEV[n.sev] || '●'}</span>
        <span style="flex:0 0 64px;color:var(--ink-faint);text-transform:uppercase;font-size:9px;padding-top:2px">${esc(tag(n.kind))}</span>
        <span style="flex:1">${esc(n.text)}</span></div>`).join('');
    const more = all.length > 10 ? `<div style="margin-top:8px"><button type="button" class="btn btn-ghost" data-tt-all="1" style="font-size:10px">${S.showAll ? 'Show the top 10' : `Show all ${all.length}`}</button></div>` : '';
    return card('notable', `Notable today <span style="${small}">(${all.length}; ●●● rare in the record · ●● notable · ● context)</span>`, rows || `<div style="${small}">Nothing unusual.</div>`, more);
  }

  function readCard(doc) {
    const r = doc.read;
    if (!r) return '';
    const rows = (r.criteria || []).map(c => `<tr>${td(c.on === true ? '<span style="color:var(--neg)">✓ on</span>' : c.on === false ? '<span style="color:var(--ink-faint)">✗ off</span>' : '<span style="color:var(--ink-faint)">– n/a</span>', true)}${td(esc(c.k), true)}${td(esc(c.text), true, 'white-space:normal')}</tr>`).join('');
    return card('read', `The sell-off read: <span style="color:${r.on >= 3 ? 'var(--neg)' : 'var(--ink)'}">${esc(r.label)}</span> <span style="${small}">(${r.on} of ${r.of})</span>`,
      table(520, th('', true) + th('Criterion', true) + th('Now', true), rows),
      `<div style="${small};margin-top:6px">0–1 on: calm · 2: under pressure · 3–4: sell-off · 5+: heavy sell-off. Overlays: correction (-10% from the 52-week high), bear market (-20%). The bot reads this: in a sell-off its new longs are sized x0.9 and every trade records the read.</div>`);
  }

  // ---- z206: who was forced to trade - the factor baskets priced live, each in sd of its own year ---------------------
  const FLOW_ROWS = [['si', 'Most-shorted 50 vs the average stock', 'shorts covered ↑ · pressed ↓'],
                     ['mom', 'Momentum: 12-1 winners − losers', 'winners extended ↑ · unwound ↓'],
                     ['rev', "The week's losers − its winners", 'losers bounced ↑ · sold again ↓'],
                     ['beta', 'High beta − low beta', 'risk on ↑ · risk off ↓']];
  const sd1 = v => { const r = Math.round(+v * 10) / 10; return r === 0 ? '0.0' : `${r > 0 ? '+' : ''}${r.toFixed(1)}`; };
  function flowsCard(doc) {
    const f = doc.flows;
    if (!f || f.date !== doc.date) return '';
    if (!f.label && !(f.signals || []).length && !f.z) return '';
    const z = f.z || {}, ret = f.ret || {}, legs = f.legs || {};
    const bar = v => {
      if (num(v) == null) return '<span style="color:var(--ink-faint)">—</span>';
      const w = Math.min(4, Math.abs(v)) / 4 * 50;
      return `<span style="display:inline-block;position:relative;width:160px;height:10px;background:var(--bg-elev);border-radius:2px;vertical-align:middle">
        <span style="position:absolute;top:0;bottom:0;${v < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`};background:${Math.abs(v) >= 2 ? (v < 0 ? 'var(--neg)' : 'var(--pos)') : 'var(--ink-faint)'};opacity:.85"></span>
        <span style="position:absolute;left:25%;top:0;bottom:0;width:1px;background:var(--rule)" title="-2 sd"></span><span style="position:absolute;left:75%;top:0;bottom:0;width:1px;background:var(--rule)" title="+2 sd"></span>
        <span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--ink-faint)"></span></span>`;
    };
    const legTxt = k => k === 'mom' && num(legs.momL) != null ? `winners ${pc(legs.momL)} · losers ${pc(legs.momS)}` : k === 'si' && num(legs.siL) != null ? `the 50 ${pc(legs.siL)} · average stock ${pc(legs.ew)}` : '';
    const rows = FLOW_ROWS.map(([k, name, how]) => `<tr>${td(`<span title="${esc(how)}">${esc(name)}</span>`, true, 'white-space:nowrap')}
      ${td(num(z[k]) != null ? `<strong style="color:${Math.abs(z[k]) >= 2 ? col(z[k]) : 'var(--ink)'}">${sd1(z[k])} sd</strong>` : '—')}${td(`<span style="color:${col(ret[k])}">${pc(ret[k])}</span>`)}${td(bar(z[k]), true)}${td(esc(legTxt(k)), true, 'color:var(--ink-faint);white-space:nowrap')}</tr>`).join('');
    const strong = ['short-covering rally', 'de-grossing', 'momentum unwind', 'losers liquidated', 'shorts pressing'];
    const lc = f.label ? (strong.includes(f.label) ? 'var(--amber)' : /risk-off|selling/.test(f.label) ? 'var(--neg)' : /rally|risk-on|buying/.test(f.label) ? 'var(--pos)' : 'var(--ink)') : 'var(--ink-faint)';
    const sig = (f.signals || []).map(x => `<li style="margin:2px 0">${esc(x.text)}</li>`).join('');
    const rel = f.relief && f.relief.n ? `<div style="${mono};font-size:11px;line-height:1.6;margin-top:8px">A ${pc((((doc.indices || {})[SPX] || {}).sigma), 1).replace('%', '')} sd gain inside a sell-off. In the record since ${esc(String(f.relief.since || '').slice(0, 4))}, <strong>${f.relief.n}</strong> days like it: the next session was down ${Math.round((f.relief.nextDown || 0) * 100)}% of the time (median ${pc(f.relief.next1)}), five sessions on the median was ${pc(f.relief.next5)}, and ${Math.round((f.relief.retest || 0) * 100)}% closed below the pre-rally close within ${f.relief.look} sessions.</div>` : '';
    const aft = f.after ? `<div style="${mono};font-size:11px;line-height:1.6;margin-top:6px;color:var(--amber)">No follow-through${f.provisional ? ' so far' : ''}: ${pc(f.after.chg)} the session after the short-covering rally of ${esc(when(f.after.prior))}${num(f.after.priorChg) != null ? ` (${pc(f.after.priorChg)})` : ''}.</div>` : '';
    const cov = f.coverage && f.coverage.of ? `${f.coverage.priced} of ${f.coverage.of} names priced` : '';
    return card('flows', `Positioning: <span style="color:${lc}">${esc(f.label || 'no signal')}</span> <span style="${small}">(who was forced to trade${f.provisional ? ' · so far today' : ''})</span>`,
      table(620, th('Basket spread', true) + th('vs its year') + th('Today') + th('', true) + th('Legs', true), rows)
      + (sig ? `<ul style="${mono};font-size:11px;line-height:1.5;margin:8px 0 0 16px;padding:0">${sig}</ul>` : '') + rel + aft,
      `<div style="${small};margin-top:6px">A price signature from long-short baskets (US common stocks, $1B+, $5M+ a day, re-formed at each prior close - ${esc(f.formedOn ? `formed ${f.formedOn}` : 'from the nightly series')}${cov ? `, ${cov}` : ''}); each spread is in standard deviations of its own last 252 sessions. No positioning data is fetched - "covered" or "unwound" is what the prices look like, not a reported flow. The bot records this on every trade and, while shorts are being covered, opens no short sale where 10%+ of the float is already short (20%+ any day).</div>`);
  }

  function insideCard(doc) {
    const i = doc.internals;
    if (!i) return '';
    const row = x => `<tr>${td(tick(x.t), true)}${td(esc(x.sector || ''), true, 'color:var(--ink-faint);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}${td(`${(+x.w).toFixed(2)}%`)}${td(`<span style="color:${col(x.move)}">${pc(x.move)}</span>`)}${td(`<strong style="color:${col(x.bp)}">${bp(x.bp, 1)}</strong>`)}</tr>`;
    const head = th('Member', true) + th('Sector', true) + th('Weight') + th('Move') + th('bp of the index');
    const maxAbs = Math.max(1, ...((i.sectors || []).map(s => Math.abs(s.bp))));
    const bars = (i.sectors || []).map(s => {
      const w = Math.abs(s.bp) / maxAbs * 50;
      return `<div style="display:flex;align-items:center;gap:8px;${mono};font-size:10px;padding:2px 0">
        <span style="flex:0 0 170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.sector)} · ${s.n} members · ${(+s.w).toFixed(1)}% of the index">${esc(s.sector)}</span>
        <span style="flex:1;position:relative;height:10px;background:var(--bg-elev);border-radius:2px"><span style="position:absolute;top:0;bottom:0;${s.bp < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`};background:${s.bp < 0 ? 'var(--neg)' : 'var(--pos)'};opacity:.8"></span><span style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--rule)"></span></span>
        <span style="flex:0 0 120px;text-align:right">${bp(s.bp)} bp · ${pc(s.move)}</span></div>`;
    }).join('');
    const conc = i.concentration || {};
    const gap = num(i.cw) != null && num(i.ew) != null ? i.cw - i.ew : null;
    return card('inside', `What is moving the S&amp;P 500 <span style="${small}">(each member's move × its index weight)</span>`,
      `<div style="${mono};font-size:11px;line-height:1.6;margin-bottom:8px">${i.up} of ${i.priced} priced members rose, ${i.down} fell (${(+i.pctUp).toFixed(0)}% up) ·
        cap-weighted <strong style="color:${col(i.cw)}">${pc(i.cw)}</strong> vs equal-weighted <strong style="color:${col(i.ew)}">${pc(i.ew)}</strong>
        ${gap != null ? `- ${Math.abs(gap) >= 0.75 && Math.abs(i.cw) > Math.abs(i.ew) ? 'narrow: the biggest names did most of it' : Math.abs(gap) < 0.4 ? 'broad: the typical stock moved as much as the index' : 'mixed'}` : ''}.
        ${conc.top5 != null ? ` The 5 largest drags = ${Math.round(conc.top5 * 100)}% of all the decliners' weight × move (top 10: ${Math.round(conc.top10 * 100)}%).` : ''}${conc.mega10 != null ? ` The priced members explain ${pc(i.explained)} of the index's ${pc(((doc.indices || {})[SPX] || {}).chg)}: the 10 largest ${pc(conc.mega10)}, the other ${i.priced - 10} ${pc(conc.rest)}.` : ''}</div>
       <div style="display:flex;flex-wrap:wrap;gap:12px">
         <div style="flex:1;min-width:300px"><div style="${small};text-transform:uppercase;letter-spacing:.08em">Largest drags</div>${table(380, head, (i.top || []).map(row).join(''))}</div>
         <div style="flex:1;min-width:300px"><div style="${small};text-transform:uppercase;letter-spacing:.08em">Largest lifts</div>${table(380, head, (i.bottom || []).map(row).join('') || `<tr><td colspan="5" style="${small}">none</td></tr>`)}</div>
       </div>
       <div style="margin-top:10px"><div style="${small};text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">By sector (bp of the index)</div>${bars}</div>`,
      `<div style="${small};margin-top:6px">${i.priced} of ${i.members} members priced (${(i.weightPriced * 100).toFixed(1)}% of the index weight; the rest are in no book yet) · weights: ${esc((doc.weights || {}).source || '')}, ${esc((doc.weights || {}).asOf || '')}, drifted with each member's price.${(i.suspect || []).length ? ` Data check, left out: ${i.suspect.map(x => `${esc(x.t)} ${pc(x.move, 0)}`).join(', ')}.` : ''}</div>`);
  }

  function runCard(doc) {
    const a = doc.runAttribution;
    if (!a || (a.days || 0) < 2) return '';
    const head = th('Member', true) + th('Sector', true) + th('bp of the index');
    const rows = (a.top || []).map(x => `<tr>${td(tick(x.t), true)}${td(esc(x.sector || ''), true, 'color:var(--ink-faint)')}${td(`<strong style="color:${col(x.bp)}">${bp(x.bp)}</strong>`)}</tr>`).join('');
    const sec = (a.sectors || []).slice(0, 6).map(s => `${esc(s.sector)} <span style="color:${col(s.bp)}">${bp(s.bp)}</span>`).join(' · ');
    return card('run', `Across the run <span style="${small}">(${esc(range(a.from, a.to))} · ${a.days} of ${a.sessions || a.days} sessions priced)</span>`,
      `<div style="${mono};font-size:11px;margin-bottom:6px">The priced members took <strong style="color:${col(a.bp)}">${bp(a.bp)} bp</strong> off the S&amp;P 500 across the run. By sector: ${sec}.</div><div style="max-width:720px">${table(360, head, rows)}</div>`,
      `<div style="${small};margin-top:6px">Each session's weight × move, added up (the day files in TRAPP2-ANALYTICS data/trends/daily).</div>`);
  }

  function boardCard(doc) {
    const runTxt = c => {
      const s = c.streak;
      if (!s) return '—';
      return `<span style="color:${s.dir === 'down' ? 'var(--neg)' : 'var(--pos)'}">${s.dir === 'down' ? '▼' : '▲'}${s.n}</span>`;
    };
    const head = th('', true) + th('Last') + th('Today') + th('Gap') + th('From open') + th('Run (closes)') + th('Week') + th('vs 52w high') + th('vs 50-day') + th('vs 200-day');
    const rowOf = c => !c ? '' : `<tr>${td(`<span title="${esc(c.sym)}">${esc(c.name)}</span>`, true, 'white-space:nowrap')}${td(fmt(c.close))}${td(`<span style="color:${col(c.chg)}">${pc(c.chg)}</span>${c.final ? '' : ' <span style="color:var(--ink-faint)">·</span>'}`)}
      ${td(pc(c.gap))}${td(pc(c.fromOpen))}${td(runTxt(c))}${td(c.week ? `<span style="color:${col(c.week.chg)}">${pc(c.week.chg)}</span>` : '—')}${td(c.high52 ? pc(c.high52.dd, 1) : '—')}${td(((c.ma || {})['50'] || {}).pct != null ? pc(c.ma['50'].pct, 1) : '—')}${td(((c.ma || {})['200'] || {}).pct != null ? pc(c.ma['200'].pct, 1) : '—')}</tr>`;
    const grp = (title, obj) => `<tr><td colspan="10" style="text-align:left;${small};text-transform:uppercase;letter-spacing:.08em;padding-top:8px">${title}</td></tr>` + Object.values(obj || {}).map(rowOf).join('');
    return card('board', 'Markets board', table(860, head, grp('Indices', doc.indices) + grp('Volatility', doc.vol) + grp('Sectors (SPDR ETFs)', doc.sectors) + grp('Rates, dollar, commodities, crypto, credit', doc.cross)),
      `<div style="${small};margin-top:6px">Run = consecutive closes in one direction through the last completed session (▼ lower, ▲ higher). Today: the close against the prior close (· = provisional). Gap: the official open against the prior close. From open: today's move from the open.</div>`);
  }

  function nextCard(doc) {
    const n = doc.next;
    if (!n || !n.events) return '';
    const rows = Object.entries(n.h || {}).map(([h, x]) => `<tr>${td(`${h} session${h === '1' ? '' : 's'} on`, true)}${td(x.count)}${td(x.up != null ? `${Math.round(x.up * 100)}%` : '—')}${td(pc(x.median))}${td(`${Math.round(x.baseUp * 100)}%`)}${td(pc(x.baseMedian))}</tr>`).join('');
    return card('next', `What happened next <span style="${small}">(${n.ifToday ? `if today closes ${n.dir === 'down' ? 'red' : 'green'}: ` : ''}after the ${n.events} earlier S&amp;P 500 runs that reached ${n.n} ${n.dir === 'down' ? 'lower' : 'higher'} closes)</span>`,
      table(520, th('Horizon', true) + th('Runs') + th('Higher') + th('Median') + th('Any day: higher') + th('Any day: median'), rows),
      `<div style="${small};margin-top:6px">Each earlier run counted once, from the close on which it reached ${n.n}. ${n.events < 15 ? 'A small sample. ' : ''}A base rate from the record - not a forecast.</div>`);
  }

  function historyCard() {
    const rows = (((S.hist || {}).rows) || []).slice(-15).reverse();
    if (!rows.length) return '';
    const head = th('Session', true) + th('S&amp;P 500') + th('Close-to-close') + th('Gap') + th('From open') + th('Run') + th('vs 52w high') + th('VIX') + th('Members up') + th('Equal-wt') + th('Cap-wt') + th('Read', true) + th('Positioning', true);
    const body = rows.map(r => `<tr>${td(esc(r.date), true)}${td(fmt(r.spx))}${td(`<span style="color:${col(r.chg)}">${pc(r.chg)}</span>`)}${td(pc(r.gap))}${td(pc(r.fromOpen))}
      ${td(r.run ? `<span style="color:${r.run < 0 ? 'var(--neg)' : 'var(--pos)'}">${r.run < 0 ? '▼' : '▲'}${Math.abs(r.run)}</span>` : '—')}${td(pc(r.dd52, 1))}${td(fmt(r.vix))}${td(r.pctUp != null ? `${Math.round(r.pctUp)}%` : '—')}${td(pc(r.ew))}${td(pc(r.cw))}${td(esc(r.read || '—'), true, 'white-space:nowrap')}${td(esc(r.flow || '—'), true, 'white-space:nowrap')}</tr>`).join('');
    return card('history', 'Recent sessions <span style="' + small + '">(stored every session: TRAPP2-ANALYTICS data/trends/daily)</span>', table(980, head, body));
  }

  function render(host) {
    host = host || S.host || document.getElementById('trends-mount');
    if (!host) return;
    S.host = host;
    if (!host._tt) {
      host._tt = true;
      host.addEventListener('click', e => {
        const a = e.target.closest('[data-tt-open],[data-tt-all],[data-tt-refresh]');
        if (!a || !host.contains(a)) return;
        e.preventDefault();
        if (a.dataset.ttAll) { S.showAll = !S.showAll; paint(); return; }
        if (a.dataset.ttRefresh) { load(true).then(paint); return; }
        const i = document.getElementById('ticker');
        if (i) i.value = a.dataset.ttOpen;
        if (typeof switchTab === 'function') switchTab('valuation');
        if (typeof loadValuation === 'function') loadValuation();
      });
    }
    if (!S.doc) host.innerHTML = `<section class="company-card" style="margin:0 0 12px"><div style="${small}">Loading today's trends…</div></section>`;
    load(false).then(paint);
    if (!S.timer) S.timer = setInterval(() => {
      if (!S.host || !S.host.offsetParent) return;                      // only while the tab is on screen
      load(false).then(paint);
    }, 120e3);
  }

  function paint() {
    const host = S.host;
    if (!host) return;
    const doc = S.doc;
    if (!doc) {
      host.innerHTML = `<section class="company-card" style="margin:0 0 12px"><div style="${mono};font-size:11px">Today's trends are not on file yet (TRAPP2-ANALYTICS data/trends/latest.json${S.err ? ' - not reachable right now' : ''}). The Today's trends workflow writes them every 30 minutes in the session (0945–1645 ET) and once more at 1845 ET.</div></section>`;
      return;
    }
    const now = live(doc, S.tape) || {};
    host.innerHTML = headline(doc, now) + notableCard(doc) + flowsCard(doc) + readCard(doc) + insideCard(doc) + runCard(doc) + boardCard(doc) + nextCard(doc) + historyCard()
      + `<div style="${small};margin:4px 0 16px">Method: ${esc(Object.values(doc.method || {}).join(' · '))}. Built ${esc(String(doc.asOf || '').replace('T', ' ').slice(0, 16))} UTC (${esc(doc.build || '')}) · live tape ${S.tape ? esc(S.tape.etTime || '') + ' ET' : '—'} · <a href="#" data-tt-refresh="1" style="color:var(--ink-dim)">refresh</a></div>`;
  }

  window.TodaysTrends = { render, paint, live, runLine, flowsCard, _S: S };
})();
