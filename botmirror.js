/* ==========================================================================
   botmirror.js — ONE BOOK, ONE TRADER (z121). Load after app.js and botsync.js.

   The GitHub runner (TRAPP2-BOT) is the only thing that trades, and only in the
   NYSE regular session: 09:30–16:00 ET (13:00 on half days), never on weekends
   or exchange holidays. TRAPP2-BOT pipeline/market_hours.py decides; the
   calendar below follows the same rules, so the app and the runner agree.
   Every device shows the runner's journal, so trades, ledger and bankroll are
   identical everywhere — local storage is only a cache of that journal.

   * Sync: on load, when the Bets tab opens, every 2 min while it's open, when
     the app comes back to the foreground, and a few minutes after a Run — the
     runner's journal REPLACES this device's trades, transactions and bankroll.
     Nothing is merged, and botsync sees a merge, so nothing is echoed back.
   * Trades only this device has (opened here before one-book trading) are set
     aside — never counted — until you Send them to the runner (adopt) or
     Discard them.
   * Run asks the runner to run now (workflow dispatch). The runner itself only
     trades if the session is open; the button says when it isn't.
   * The app never opens, closes, trims or rebalances, never exits a position
     while you browse, and never writes bot trades to Supabase. Add cash
     becomes a deposit / withdrawal request that the runner books.
   * Escape hatch: localStorage 'valuatio.bot.appTrading' = '1' restores the
     z100–z120 behaviour (pair it with the runner's RUNNER_APP_TRADES=1).

   z122 — the bot is AUTONOMOUS: the Bets tab offers nothing that runs, trades or
   sends. Removed there: Run Scan, Rebalance Cash, Retrain, Import Repo / File,
   Commit, the editable cash card, Run now, Send to runner / Discard. Nothing is
   dispatched or requested from a device; Run, Add cash and edit-cash calls are
   no-ops. Kept: the journal view, Refresh (re-reads the journal), Export (a
   download) and Repo ↗.
   ========================================================================== */
(function () {
  'use strict';
  const ON = () => { try { return localStorage.getItem('valuatio.bot.appTrading') !== '1'; } catch (e) { return true; } };
  const OWNER = () => { try { if (typeof VALUATIO_OWNER !== 'undefined' && VALUATIO_OWNER) return String(VALUATIO_OWNER); } catch (e) {} return 'TheMostLocal'; };
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/' + OWNER());
  const API = () => (typeof GH_API_REPOS !== 'undefined' ? GH_API_REPOS : 'https://api.github.com/repos/' + OWNER()) + '/TRAPP2-BOT';
  const OUTBOX = 'valuatio.bot.outbox.v1', ASIDE = 'valuatio.bot.deviceOnly.v1', ASIDE_OFF = 'valuatio.bot.deviceOnly.discarded.v1', SYNC = 'valuatio.bot.mirror.v1';
  const j = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const flash = (m, k) => { try { if (typeof flashStatus === 'function') flashStatus(m, k || ''); } catch (e) {} };
  const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const S = { busy: false, err: null };

  // ---- NYSE regular session in ET — the same rules as TRAPP2-BOT market_hours.py ----
  const p2 = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
  const dowOf = s => new Date(s + 'T00:00:00Z').getUTCDay();                 // 0 = Sunday
  const addD = (s, k) => { const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
    return ymd(y, Math.floor(n / 31), (n % 31) + 1);
  }
  const observed = (s, allowFri) => { const w = dowOf(s); return w === 6 ? (allowFri ? addD(s, -1) : null) : w === 0 ? addD(s, 1) : s; };
  const nthWd = (y, m, wd, n) => ymd(y, m, 1 + ((wd - dowOf(ymd(y, m, 1)) + 7) % 7) + 7 * (n - 1));
  const lastWd = (y, m, wd) => { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return ymd(y, m, last - ((dowOf(ymd(y, m, last)) - wd + 7) % 7)); };
  const HC = {};
  function holidays(y) {
    if (HC[y]) return HC[y];
    const h = {}, ny = observed(ymd(y, 1, 1), false);
    if (ny) h[ny] = "New Year's Day";
    h[nthWd(y, 1, 1, 3)] = 'Martin Luther King Jr. Day';
    h[nthWd(y, 2, 1, 3)] = "Washington's Birthday";
    h[addD(easter(y), -2)] = 'Good Friday';
    h[lastWd(y, 5, 1)] = 'Memorial Day';
    if (y >= 2022) h[observed(ymd(y, 6, 19), true)] = 'Juneteenth';
    h[observed(ymd(y, 7, 4), true)] = 'Independence Day';
    h[nthWd(y, 9, 1, 1)] = 'Labor Day';
    h[nthWd(y, 11, 4, 4)] = 'Thanksgiving Day';
    h[observed(ymd(y, 12, 25), true)] = 'Christmas Day';
    return (HC[y] = h);
  }
  const EXTRA = { '2025-01-09': 'National Day of Mourning (President Carter)' };
  function earlyCloses(y) {
    const out = [addD(nthWd(y, 11, 4, 4), 1)], j4 = dowOf(ymd(y, 7, 4)), xe = ymd(y, 12, 24), h = holidays(y);
    if (j4 >= 2 && j4 <= 5) out.push(ymd(y, 7, 3));
    if (dowOf(xe) >= 1 && dowOf(xe) <= 5) out.push(xe);
    return out.filter(s => dowOf(s) >= 1 && dowOf(s) <= 5 && !h[s]);
  }
  function dayStatus(s) {
    const w = dowOf(s);
    if (w === 0 || w === 6) return [false, null, 'weekend'];
    if (EXTRA[s]) return [false, null, EXTRA[s]];
    const y = +s.slice(0, 4), h = holidays(y);
    if (h[s]) return [false, null, h[s]];
    if (earlyCloses(y).includes(s)) return [true, 780, 'early close (1:00 pm ET)'];
    return [true, 960, 'regular'];
  }
  const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function etParts(d) {
    const o = {}; for (const p of ETF.formatToParts(d)) o[p.type] = p.value;
    return { date: `${o.year}-${o.month}-${o.day}`, min: (+o.hour % 24) * 60 + (+o.minute) };
  }
  function session(now) {
    const { date, min } = etParts(now || new Date());
    const [ok, close, label] = dayStatus(date);
    const open = !!(ok && min >= 570 && min < close);
    const state = open ? 'open' : !ok ? label : (min < 570 ? 'pre-market' : 'after the close');
    let next = null;
    if (!open) for (let k = 0; k < 20; k++) { const s = addD(date, k); if (!dayStatus(s)[0] || (k === 0 && min >= 570)) continue; next = s; break; }
    const hm = m => `${p2(Math.floor(m / 60))}${p2(m % 60)}`;              // z135: 24-hour ET ("1600")
    const day = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const text = open ? `NYSE open · closes ${hm(close)} ET${close === 780 ? ' (half day)' : ''}`
      : `NYSE closed (${state})${next ? ` · opens ${next === date ? 'today' : day(next)} 0930 ET` : ''}`;
    return { open, state, label, date, min, closeMin: close, next, text };
  }

  // ---- the runner's journal is the book ----
  async function fetchJournal() {
    const r = await fetch(`${RAW()}/TRAPP2-BOT/main/data/bot_training_data.json?_v=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('journal HTTP ' + r.status);
    const d = await r.json();
    if (!d || !Array.isArray(d.trades)) throw new Error('journal has no trades');
    return d;
  }
  function mirrorFrom(J) {
    if (typeof window.loadBotState !== 'function' || typeof window.saveBotState !== 'function') return null;
    const bot = window.loadBotState() || {};
    const ids = new Set(J.trades.map(t => t && t.id).filter(Boolean));
    const aside = new Map(j(ASIDE, []).filter(b => b && b.id).map(b => [b.id, b]));
    for (const b of (bot.bets || [])) if (b && b.id && !ids.has(b.id) && b.status !== 'void' && !String(b.id).includes('-runner-')) aside.set(b.id, b);
    for (const id of [...aside.keys()]) if (ids.has(id)) aside.delete(id);           // adopted since
    put(ASIDE, [...aside.values()]);
    bot.bets = J.trades.filter(t => t && t.id && t.status !== 'void').map(t => Object.assign({}, t, { _fromRepo: true, _runnerSynced: true }));
    bot.transactions = (J.transactions || []).map(x => Object.assign({}, x, { origin: x.origin || 'runner' }));
    if (isFinite(+J.bankroll)) bot.bankroll = +J.bankroll;
    if (J.learnedWeights && typeof J.learnedWeights === 'object') bot.learnedWeights = J.learnedWeights;
    bot.runnerJournalAt = J.generatedAt || null;
    bot.mirroredAt = new Date().toISOString();
    window.__botMerging = (window.__botMerging || 0) + 1;                     // a merge to botsync: no actions
    try { window.saveBotState(bot); } finally { window.__botMerging--; }
    const info = { at: bot.mirroredAt, journalAt: J.generatedAt || null, trades: bot.bets.length,
                   open: bot.bets.filter(b => b.status === 'open').length, bankroll: +J.bankroll, aside: aside.size };
    put(SYNC, info);
    return info;
  }
  const betsVisible = () => !!document.querySelector('.tab-btn[data-tab="bets"].active') && !document.hidden;
  async function sync(why) {
    if (!ON() || S.busy) return null;
    S.busy = true; badge();
    let info = null;
    try { info = mirrorFrom(await fetchJournal()); S.err = null; } catch (e) { S.err = e.message; }
    S.busy = false;
    try { if (info && betsVisible() && typeof window.renderBetsTab === 'function') window.renderBetsTab(); } catch (e) {}
    badge();
    return info;
  }

  // ---- what the app does instead of trading ----
  // z122: the bot is autonomous - nothing on a device starts it
  async function noRun() { flash('The bot runs on its own: every 30 min while the NYSE is open (entries once per session after 10:00 ET)'); return { skipped: 'autonomous' }; }
  async function runNow() {
    const s = session(), token = localStorage.getItem('valuatio.github.token');
    if (!token) { flash('No GitHub token on this device — Home 🏠 → Connections'); return { skipped: 'no-token' }; }
    if (!s.open && !confirm(`${s.text}.\n\nThe runner trades only while the NYSE is open, so now it would only check in — no trades. Start it anyway?`)) return { skipped: 'closed' };
    let st = 0;
    try {
      const r = await fetch(`${API()}/actions/workflows/bot-runner.yml/dispatches`, { method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: 'main' }) });
      st = r.status;
    } catch (e) { st = -1; }
    if (st === 204) {
      flash(s.open ? 'Runner started — its trades show here in about 3–5 min' : 'Runner started — market closed, so it only checks in', 'success');
      setTimeout(() => sync('after-run'), 4 * 60 * 1000);
      setTimeout(() => sync('after-run-2'), 8 * 60 * 1000);
    } else flash(`Couldn't start the runner (${st > 0 ? 'HTTP ' + st : 'network'}) — Bets → Check access`);
    return { dispatched: st === 204 };
  }
  function requestCash(amount) {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt === 0) return null;
    const a = { id: uid(amt > 0 ? 'deposit' : 'withdrawal'), ts: new Date().toISOString(), type: amt > 0 ? 'deposit' : 'withdrawal', amount: amt };
    put(OUTBOX, j(OUTBOX, []).concat([a]));
    flash(`${amt > 0 ? 'Deposit' : 'Withdrawal'} of $${Math.abs(amt).toLocaleString()} requested — the runner books it on its next pass`, 'success');
    try { if (window.BotSync && typeof window.BotSync.flush === 'function') window.BotSync.flush(true); } catch (e) {}
    badge();
    return a;
  }
  function sendAside() {
    const aside = j(ASIDE, []);
    if (!aside.length) return 0;
    if (!confirm(`Send ${aside.length} trade(s) that exist only on this device to the runner?\n\nIt adopts them into the one book as app trades — their realized P/L enters its bankroll — and every device shows them after its next pass.`)) return 0;
    const now = new Date().toISOString(), ids = new Set(aside.map(b => b.id));
    const box = j(OUTBOX, []).filter(a => !(a.type === 'adopt' && a.trade && ids.has(a.trade.id)));
    for (const b of aside) box.push({ id: uid('adopt'), ts: now, type: 'adopt', trade: Object.assign(JSON.parse(JSON.stringify(b)), { origin: b.origin || 'app' }) });
    put(OUTBOX, box);
    try { if (window.BotSync) window.BotSync.flush(true); } catch (e) {}
    flash(`Sent ${aside.length} trade(s) to the runner`, 'success');
    return aside.length;
  }
  function discardAside() {
    const aside = j(ASIDE, []);
    if (!aside.length || !confirm(`Discard ${aside.length} trade(s) that exist only on this device? They were never in the runner's book. A copy stays in this browser.`)) return 0;
    put(ASIDE_OFF, j(ASIDE_OFF, []).concat(aside).slice(-500));
    put(ASIDE, []);
    badge();
    return aside.length;
  }

  // ---- status line (above botsync's APP ↔ RUNNER line) ----
  function badge() {
    const body = document.getElementById('bets-body');
    if (!body) return;
    let el = document.getElementById('botmirror-badge');
    if (!ON()) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'botmirror-badge'; body.insertBefore(el, body.firstChild); }
    const s = session(), info = j(SYNC, null), aside = j(ASIDE, []);
    const col = S.err ? 'var(--red)' : s.open ? 'var(--pos)' : 'var(--ink-faint)';
    const ago = t => { if (!t) return '—'; const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
    const when = t => { const d = new Date(t || 0); if (!(isFinite(d) && t)) return '—';   // z135: 24-hour ET
      const [h, m] = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).split(':');
      return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) + ' ' + String(+h % 24).padStart(2, '0') + m + ' ET'; };
    const btn = (label, fn) => `<button class="btn btn-ghost" style="padding:3px 9px;font-size:10px" onclick="${fn}">${label}</button>`;
    const line = S.busy ? 'syncing with the runner…' : S.err ? `sync failed: ${esc(S.err)} — showing the last synced copy`
      : info ? `runner journal ${esc(when(info.journalAt))} · ${info.trades} trades (${info.open} open) · bankroll $${(+info.bankroll || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · synced ${ago(info.at)}`
      : 'not synced yet';
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-family:var(--mono);font-size:10.5px;padding:7px 12px;border:1px solid var(--rule);border-left:3px solid ${col};border-radius:4px;margin:8px 0;background:var(--bg-elev)">
      <span style="color:${col};font-weight:700">ONE BOOK · RUNNER</span><span style="color:var(--ink-dim)">${esc(s.text)}</span>
      <span style="flex-basis:100%;color:var(--ink-dim)">${line}</span>
      <span style="color:var(--ink-faint)">The bot is autonomous: only the GitHub runner trades, and only while the NYSE is open — new entries once per session after 10:00 ET, exits every pass. Every device shows the same journal.</span>
      <span style="margin-left:auto;display:flex;gap:6px">${btn('Refresh', "BotMirror.sync('button')")}</span></div>`;
    strip();
  }
  // z122: nothing on the Bets tab runs, trades or sends - the bot is autonomous
  const REMOVE = ['bets-run-btn', 'bets-rebalance-btn', 'bets-retrain-btn', 'bets-import-btn', 'bets-import-file-btn', 'bets-commit-btn'];
  function strip() {
    for (const id of REMOVE) { const el = document.getElementById(id); if (el) el.remove(); }
    const cc = document.getElementById('bets-cash-card');
    if (cc && !cc._z122) {
      const ro = cc.cloneNode(true);                       // a clone carries no click listener (no edit-cash prompt)
      ro._z122 = true;
      ro.style.cursor = 'default';
      ro.title = "The bot's cash — managed by the runner";
      ro.querySelectorAll('span').forEach(sp => { if (/✎\s*edit/.test(sp.textContent)) sp.remove(); });
      cc.replaceWith(ro);
    }
  }

  // ---- take over the app's trading entry points ----
  function wrap(name, fn) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig._z121) return false;
    const w = function () { return ON() ? fn.apply(this, [orig].concat([].slice.call(arguments))) : orig.apply(this, arguments); };
    w._z121 = true;
    window[name] = w;
    return true;
  }
  function install() {
    const ok = wrap('botDailyRun', () => noRun());
    wrap('botRebalanceToPositiveCash', () => { flash('The runner manages cash and positions now (one-book trading)'); return 0; });
    wrap('botPartialSell', () => 0);
    wrap('botAddCash', () => { flash("The bot's cash is managed by the runner"); return null; });
    wrap('botEditCash', async () => { flash("The bot's cash is managed by the runner"); return null; });
    wrap('_betsRetrainHandler', () => { flash('The runner learns from its own closed trades'); return null; });
    wrap('supabaseSyncAllTrades', async () => 0);
    wrap('supabaseUpsertTrade', async () => null);
    wrap('supabaseLoadTrades', async () => null);
    wrap('_botAppManages', () => false);
    wrap('_mergeBotTrainingData', (orig, data, src) => {
      if (data && Array.isArray(data.trades) && /TRAPP2-BOT/.test(String(src || ''))) {
        const info = mirrorFrom(data);
        return { added: 0, updated: info ? info.trades : 0, mirrored: true };
      }
      return orig(data, src);
    });
    wrap('renderBetsTab', (orig, ...a) => { const r = orig.apply(window, a); try { badge(); } catch (e) {} return r; });
    try { localStorage.removeItem('valuatio.bot.appAutoRun'); } catch (e) {}
    return ok;
  }
  if (!install()) document.addEventListener('DOMContentLoaded', install);
  setTimeout(() => { if (ON()) sync('load'); }, 2500);
  setInterval(() => { if (ON() && betsVisible()) sync('timer'); }, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ON() && betsVisible()) sync('resume'); });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.tab-btn[data-tab="bets"]')) setTimeout(() => sync('tab'), 300); }, true);
  window.BotMirror = { sync, session, mirrorFrom, holidays, earlyCloses, strip, on: ON };
})();
