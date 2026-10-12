/* ==========================================================================
   botsync.js — App ↔ Runner communication for the bot (z100). After app.js.

   Both the app and the scheduled runner (TRAPP2-BOT) may trade the bot's book.
   The runner runs on a schedule; the app trades only when you press Run (or
   add cash). Whatever the app does is SENT to the runner so there is one book:

     1. Every bot-state save is compared with the last synced snapshot. New
        app-opened trades, app closes, app trims and cash in/out become ACTIONS.
        (Loads of runner data are not actions - no echo loop.)
     2. Actions queue in an outbox (survives reloads/offline), and each is
        written as its own file  TRAPP2-BOT/data/app_actions/<id>.json  - a NEW
        file never conflicts with the runner's commits - then the
        bot-actions.yml workflow is dispatched so the runner applies it within
        minutes (it also sweeps the inbox every 15 min in market hours).
     3. The runner applies them with its accounting and commits; the app then
        imports the runner's state and updates closes/trims it already has.

   Needs the GitHub token (Home → Connections) with, on TRAPP2-BOT:
   Contents: Read and write (inbox files) and Actions: Read and write (dispatch).
   ========================================================================== */
(function () {
  'use strict';
  const OUTBOX = 'valuatio.bot.outbox.v1', BASE = 'valuatio.bot.syncBaseline.v1', LAST = 'valuatio.bot.lastSent.v1';
  const API = () => (typeof GH_API_REPOS !== 'undefined' ? GH_API_REPOS : 'https://api.github.com/repos/TheMostLocal') + '/TRAPP2-BOT';
  const j = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = { sending: false, error: null, suppress: 0 };

  // ---- snapshot / diff ----
  function snap(bot) {
    const bets = {};
    for (const b of (bot.bets || [])) if (b && b.id) bets[b.id] = { status: b.status, shares: +b.shares || 0, trims: (b.partialSells || []).length + (b.trims || []).length, fromRepo: !!b._fromRepo };
    const tx = (bot.transactions || []).filter(t => t && (t.type === 'deposit' || t.type === 'withdrawal')).map(t => t.id);
    return { bets, tx };
  }
  const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  function diff(prev, bot) {
    const out = [], now = new Date().toISOString(), today = now.slice(0, 10);
    for (const b of (bot.bets || [])) {
      if (!b || !b.id) continue;
      const was = prev.bets[b.id];
      if (!was) {
        if (b.origin !== 'app' || b._fromRepo) continue;               // only trades the APP opened
        out.push({ id: uid('open'), ts: now, type: 'open', trade: {
          id: b.id, ticker: b.ticker, direction: b.direction || 'long', instrument: b.instrument || 'shares',
          entryPrice: b.entryPrice, shares: b.shares, notional: b.notional ?? b.dollars, entryDate: b.entryDate || today,
          conviction: b.conviction, confidence: b.confidence, horizonDays: b.horizonDays, stopPrice: b.stopPrice,
          targetPrice: b.targetPrice, components: b.components, origin: 'app' } });
        if (b.status === 'closed' && b.closedBy === 'app') out.push({ id: uid('close'), ts: now, type: 'close', tradeId: b.id, price: b.exitPrice, date: b.exitDate || today, reason: b.exitReason || 'app' });
        continue;
      }
      if (b._runnerSynced && was.status !== b.status) continue;          // runner closed it - not ours
      const trimsNow = (b.partialSells || []).length + (b.trims || []).length;
      const lastPs = Array.isArray(b.partialSells) && b.partialSells.length ? b.partialSells[b.partialSells.length - 1] : null;
      if (trimsNow > was.trims && lastPs && lastPs.origin === 'app') {
        const ps = lastPs;
        const sold = Math.max(0, (was.shares || 0) - (+b.shares || 0)) || ((was.shares || 0) * (+ps.fraction || 0));
        const d = b.direction === 'short' ? -1 : 1;
        const px = sold > 0 ? (+b.entryPrice || 0) + (+ps.realized || 0) / (d * sold) : null;
        if (sold > 0 && px) out.push({ id: uid('trim'), ts: now, type: 'trim', tradeId: b.id, shares: +sold.toFixed(6), price: +px.toFixed(4), date: ps.date || today });
      }
      if (was.status === 'open' && b.status === 'closed' && b.exitPrice && b.closedBy === 'app')
        out.push({ id: uid('close'), ts: now, type: 'close', tradeId: b.id, price: b.exitPrice, date: b.exitDate || today, reason: b.exitReason || 'app' });
    }
    const seenTx = new Set(prev.tx || []);
    for (const t of (bot.transactions || [])) {
      if (!t || !t.id || seenTx.has(t.id) || (t.type !== 'deposit' && t.type !== 'withdrawal') || t.origin === 'runner') continue;
      out.push({ id: uid(t.type), ts: t.ts || now, type: t.type, amount: +t.amount || 0, ref: t.id });
    }
    return out;
  }

  // ---- hooks: every save diffs; runner imports only move the baseline ----
  function hook() {
    if (typeof window.saveBotState !== 'function' || window.saveBotState._z100) return false;
    const origSave = window.saveBotState;
    const w = function (bot) {
      const r = origSave.apply(this, arguments);
      try {
        const prev = j(BASE, null);
        if (!prev) { put(BASE, snap(bot)); return r; }                 // first sight: baseline only
        if (S.suppress > 0) { put(BASE, snap(bot)); return r; }
        const acts = diff(prev, bot);
        put(BASE, snap(bot));
        if (acts.length) { put(OUTBOX, j(OUTBOX, []).concat(acts)); schedule(); }
      } catch (e) { console.warn('[botsync] diff failed', e); }
      return r;
    };
    w._z100 = true;
    window.saveBotState = w;
    if (typeof window._mergeBotTrainingData === 'function' && !window._mergeBotTrainingData._z100) {
      const origMerge = window._mergeBotTrainingData;
      const m = function () { S.suppress++; try { return origMerge.apply(this, arguments); } finally { S.suppress--; } };
      m._z100 = true;
      window._mergeBotTrainingData = m;
    }
    if (typeof window.renderBetsTab === 'function' && !window.renderBetsTab._z100) {
      const origR = window.renderBetsTab;
      const rr = function () { const r = origR.apply(this, arguments); try { badge(); } catch (e) {} return r; };
      rr._z100 = true;
      window.renderBetsTab = rr;
    }
    return true;
  }

  // ---- sender ----
  let timer = null;
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(flush, ms == null ? 3000 : ms); badge(); }
  async function flush() {
    const box = j(OUTBOX, []);
    if (!box.length || S.sending) { badge(); return; }
    const token = localStorage.getItem('valuatio.github.token');
    if (!token) { S.error = 'no GitHub token on this device'; badge(); return; }
    S.sending = true; S.error = null; badge();
    const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    const left = [];
    let sent = 0;
    for (const a of box) {
      try {
        const body = { message: `app action ${a.type} ${a.trade ? a.trade.ticker : (a.tradeId || a.amount || '')}`.trim(),
                       content: btoa(unescape(encodeURIComponent(JSON.stringify(a, null, 1)))) };
        const r = await fetch(`${API()}/contents/data/app_actions/${encodeURIComponent(a.id)}.json`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
        if (r.ok || r.status === 422) sent++;                            // 422 = already there (resend) - fine
        else { left.push(a); S.error = `HTTP ${r.status}${r.status === 403 || r.status === 404 ? ' — token needs Contents: write on TRAPP2-BOT' : ''}`; }
      } catch (e) { left.push(a); S.error = e.message; }
    }
    put(OUTBOX, left);
    if (sent) {
      put(LAST, { at: new Date().toISOString(), n: sent });
      try {
        const r = await fetch(`${API()}/actions/workflows/bot-actions.yml/dispatches`, { method: 'POST', headers: H, body: JSON.stringify({ ref: 'main' }) });
        if (r.status !== 204) S.error = (S.error ? S.error + '; ' : '') + `runner not woken (HTTP ${r.status}) — it will pick these up within 15 min in market hours`;
      } catch (e) {}
      if (typeof flashStatus === 'function') flashStatus(`Sent ${sent} bot action${sent > 1 ? 's' : ''} to the runner`, 'success');
    }
    S.sending = false; badge();
    if (left.length) schedule(60000);
  }

  // ---- status line in the Bets tab ----
  function badge() {
    const body = document.getElementById('bets-body'); if (!body) return;
    let el = document.getElementById('botsync-badge');
    if (!el) { el = document.createElement('div'); el.id = 'botsync-badge'; body.insertBefore(el, body.firstChild); }
    const box = j(OUTBOX, []), last = j(LAST, null);
    const col = S.error ? 'var(--red)' : box.length ? 'var(--amber)' : 'var(--pos)';
    const state = S.sending ? 'sending to the runner…' : S.error ? `${box.length} queued · ${S.error}` : box.length ? `${box.length} action(s) queued for the runner` :
      `in sync${last ? ` · last sent ${new Date(last.at).toLocaleString()}` : ''}`;
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-family:var(--mono);font-size:10.5px;padding:7px 12px;border:1px solid var(--rule);border-left:3px solid ${col};border-radius:4px;margin:8px 0;background:var(--bg-elev)">
      <span style="color:${col};font-weight:700">APP ↔ RUNNER</span><span style="color:var(--ink-dim)">${state}</span>
      <span style="color:var(--ink-faint)">· runner trades on schedule; app trades only when you press Run</span>
      ${box.length ? `<button class="btn btn-ghost" style="margin-left:auto;padding:3px 9px;font-size:10px" onclick="BotSync.flush()">Send now</button>` : ''}</div>`;
  }

  if (!hook()) document.addEventListener('DOMContentLoaded', hook);
  setTimeout(() => { if (j(OUTBOX, []).length) schedule(2000); badge(); }, 6000);
  setInterval(badge, 30000);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.tab-btn[data-tab="bets"]')) setTimeout(badge, 400); }, true);
  window.BotSync = { flush, diff, snap, outbox: () => j(OUTBOX, []) };
})();
