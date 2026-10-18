/* ==========================================================================
   botsync.js — App ↔ Runner communication for the bot (z100, z118). After app.js.

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

   z118
   * ACCESS DIAGNOSIS, not a guess. On a 401/403/404 (or Check access) four
     side-effect-free probes run with the token: who owns it (GET /user), what
     owns the repo (GET /users/<owner>), can it write git data (POST git/blobs:
     an unreferenced blob - no commit, no file), can it start the workflow
     (dispatch to a ref that doesn't exist: 422 when allowed - no run starts).
     The line then says exactly what to change. z111's check read the repo's
     permissions.push, which describes the ACCOUNT, not the token: it could say
     "can write" while every PUT was refused with 403.
   * TRADES ONLY THIS DEVICE KNOWS. The runner can only trim / close trades in
     its journal. Trades opened here before the outbox existed (or that a save
     missed) are not in it, so their trims / closes are HELD instead of being
     sent to be skipped, and "Send to runner" adopts them: one action per trade
     carrying this device's current version, stored by the runner as an app trade.
   * Queue times in local time; actions queued while a send is in flight are
     never dropped (the outbox is re-read before it is written back).

   z119
   * The verdict names the two settings that look right but don't grant this
     token anything: Repository access "Public repositories" (read-only) and
     the repo's Settings → Actions → General → Workflow permissions (that one
     is the GITHUB_TOKEN of workflow runs). Classic tokens show their scopes
     (X-OAuth-Scopes). The line shows the botsync version, so a stale cached
     copy is visible at a glance.
   ========================================================================== */
(function () {
  'use strict';
  const VERSION = 'z122';
  // z122: one-book trading (botmirror.js) - the bot is autonomous, so this device queues and
  // sends NOTHING; leftovers from before are kept aside for audit, and the line is hidden.
  const ONE_BOOK = () => { try { return localStorage.getItem('valuatio.bot.appTrading') !== '1'; } catch (e) { return true; } };
  function retireOutbox() {
    try {
      const box = JSON.parse(localStorage.getItem('valuatio.bot.outbox.v1') || '[]');
      if (Array.isArray(box) && box.length) {
        const old = JSON.parse(localStorage.getItem('valuatio.bot.outbox.retired.v1') || '[]');
        localStorage.setItem('valuatio.bot.outbox.retired.v1', JSON.stringify(old.concat(box).slice(-500)));
      }
      localStorage.removeItem('valuatio.bot.outbox.v1');
    } catch (e) {}
  }
  const OUTBOX = 'valuatio.bot.outbox.v1', BASE = 'valuatio.bot.syncBaseline.v1', LAST = 'valuatio.bot.lastSent.v1';
  const DIAG = 'valuatio.bot.tokenDiag.v1', SENT_IDS = 'valuatio.bot.sentTradeIds.v1', BLOCK = 'valuatio.bot.authBlocked.v1';
  const OWNER = () => { try { if (typeof VALUATIO_OWNER !== 'undefined' && VALUATIO_OWNER) return String(VALUATIO_OWNER); } catch (e) {} return 'TheMostLocal'; };
  const API = () => (typeof GH_API_REPOS !== 'undefined' ? GH_API_REPOS : 'https://api.github.com/repos/' + OWNER()) + '/TRAPP2-BOT';
  const RAW = () => (typeof GH_RAW !== 'undefined' ? GH_RAW : 'https://raw.githubusercontent.com/' + OWNER());
  const j = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { sending: false, error: null, suppress: 0, authBlocked: null, showQueue: false, diagBusy: false, stranded: null, held: 0 };
  // z111: an auth failure won't fix itself - stop retrying until the token CHANGES (or you press Send now)
  const tokenTag = () => { const t = localStorage.getItem('valuatio.github.token') || ''; return t ? t.length + ':' + t.slice(-6) : ''; };
  try { S.authBlocked = JSON.parse(localStorage.getItem(BLOCK) || 'null'); } catch (e) {}
  const fmtT = ts => { const d = new Date(ts || 0); return isFinite(d) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : String(ts || ''); };
  const money = v => `${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

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
          targetPrice: b.targetPrice, components: b.components, regimeContext: b.regimeContext || null, origin: 'app' } });
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
      // z112: stamp updatedAt on trades THIS device opened / closed / trimmed, so
      // the shared merge rule (Supabase + runner) knows they're the newer copy.
      // Imports from the runner / Supabase are merges, not changes - no stamp.
      const merging = S.suppress > 0 || (window.__botMerging || 0) > 0;
      try {
        const prev0 = j(BASE, null);
        if (prev0 && !merging && bot && Array.isArray(bot.bets)) {
          const now = new Date().toISOString();
          for (const b of bot.bets) {
            const was = b && b.id ? prev0.bets[b.id] : null;
            const sig = b && { status: b.status, shares: +b.shares || 0, trims: (b.partialSells || []).length + (b.trims || []).length };
            if (b && b.id && (!was || was.status !== sig.status || Math.abs((was.shares || 0) - sig.shares) > 1e-9 || was.trims !== sig.trims)) b.updatedAt = now;
          }
        }
      } catch (e) {}
      const r = origSave.apply(this, arguments);
      try {
        const prev = j(BASE, null);
        if (!prev) { put(BASE, snap(bot)); return r; }                 // first sight: baseline only
        if (merging || ONE_BOOK()) { put(BASE, snap(bot)); return r; }   // z122: nothing is queued in one-book mode
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

  // ---- z118: what the runner's book holds (raw file, plain GET - no CORS preflight) ----
  const RB = { ids: null, at: 0, pending: null };
  function runnerIds(force) {
    if (!force && RB.ids && Date.now() - RB.at < 10 * 60 * 1000) return Promise.resolve(RB.ids);
    if (RB.pending) return RB.pending;
    RB.pending = (async () => {
      try {
        const r = await fetch(`${RAW()}/TRAPP2-BOT/main/data/bot_training_data.json?_v=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
        if (r.ok) { const d = await r.json(); RB.ids = new Set((d.trades || []).map(t => t && t.id).filter(Boolean)); RB.at = Date.now(); }
      } catch (e) {}
      RB.pending = null;
      return RB.ids;
    })();
    return RB.pending;
  }
  const sentIds = () => new Set(j(SENT_IDS, []));
  function markSent(ids) { if (ids.length) put(SENT_IDS, [...new Set(j(SENT_IDS, []).concat(ids))].slice(-500)); }
  function localBot() { try { return typeof window.loadBotState === 'function' ? window.loadBotState() : null; } catch (e) { return null; } }
  // trades on this device the runner's journal doesn't have (runner-made ids and void rows excluded)
  function strandedOf(bot, ids) {
    if (!bot || !ids) return [];
    const sent = sentIds();
    return (bot.bets || []).filter(b => b && b.id && b.ticker && !ids.has(b.id) && !sent.has(b.id) && b.status !== 'void'
      && !b._fromRepo && !String(b.id).includes('-runner-'));
  }
  function realizedOf(b) {
    const tr = typeof window._betTrimEvents === 'function' ? window._betTrimEvents(b).reduce((s, x) => s + (+x.realized || 0), 0) : 0;
    const ex = b.status === 'closed' ? (typeof window._betExitRealized === 'function' ? window._betExitRealized(b) : (+b.pnl || 0)) : 0;
    return tr + ex;
  }
  async function refreshStranded(force) {
    const ids = await runnerIds(force), bot = localBot();
    const st = strandedOf(bot, ids);
    S.stranded = st.length ? { n: st.length, open: st.filter(b => b.status === 'open').length, realized: st.reduce((s, b) => s + realizedOf(b), 0) } : null;
    badge();
    return st;
  }
  async function adoptStranded() {
    const st = await refreshStranded(true);
    if (!st.length) { if (typeof flashStatus === 'function') flashStatus('Every trade on this device is already in the runner\'s book', 'success'); return 0; }
    const open = st.filter(b => b.status === 'open').length, real = st.reduce((s, b) => s + realizedOf(b), 0);
    if (!confirm(`Send ${st.length} trade(s) (${open} open) that exist only on this device to the runner?\n\nThe runner adopts them into its book as app trades (one book): their realized P/L (${money(real)}) enters its bankroll, and their open positions are managed from then on. Queued trims/closes for them are folded in.`)) return 0;
    const sids = new Set(st.map(b => b.id)), now = new Date().toISOString();
    const keep = j(OUTBOX, []).filter(a => !(a.tradeId && sids.has(a.tradeId)) && !(a.type === 'adopt' && a.trade && sids.has(a.trade.id)));
    for (const b of st) keep.push({ id: uid('adopt'), ts: now, type: 'adopt', trade: Object.assign(JSON.parse(JSON.stringify(b)), { origin: b.origin || 'app' }) });
    put(OUTBOX, keep);
    schedule(300);
    return st.length;
  }

  // ---- sender ----
  let timer = null;
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(flush, ms == null ? 3000 : ms); badge(); }
  async function flush(manual) {
    if (ONE_BOOK()) { retireOutbox(); badge(); return; }          // z122: the bot is autonomous - nothing is sent
    const box = j(OUTBOX, []);
    if (!box.length || S.sending) { badge(); return; }
    if (!manual && S.authBlocked && S.authBlocked.token === tokenTag()) { badge(); return; }
    const token = localStorage.getItem('valuatio.github.token');
    if (!token) { S.error = 'no GitHub token on this device'; badge(); return; }
    S.sending = true; S.error = null; badge();
    // z118: trims / closes of trades the runner has never seen would only be skipped there - hold them
    const ids = await runnerIds(), sent0 = sentIds();
    const queuedNew = new Set(box.filter(a => (a.type === 'open' || a.type === 'adopt') && a.trade).map(a => a.trade.id));
    const known = id => !ids || ids.has(id) || sent0.has(id) || queuedNew.has(id);
    const sendable = box.filter(a => !((a.type === 'trim' || a.type === 'close') && a.tradeId && !known(a.tradeId)));
    S.held = box.length - sendable.length;
    const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    const done = new Set(), newIds = [];
    let sent = 0, authFail = false;
    for (const a of sendable) {
      try {
        const body = { message: `app action ${a.type} ${a.trade ? a.trade.ticker : (a.tradeId || a.amount || '')}`.trim(),
                       content: btoa(unescape(encodeURIComponent(JSON.stringify(a, null, 1)))) };
        const r = await fetch(`${API()}/contents/data/app_actions/${encodeURIComponent(a.id)}.json`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
        if (r.ok || r.status === 422) { sent++; done.add(a.id); if (a.trade && a.trade.id) newIds.push(a.trade.id); }   // 422 = already there (resend)
        else if (r.status === 401 || r.status === 403 || r.status === 404) {
          S.authBlocked = { token: tokenTag(), status: r.status, at: new Date().toISOString() };
          put(BLOCK, S.authBlocked);
          S.error = r.status === 401 ? 'GitHub token rejected (expired or revoked)' : `GitHub token can't write to TRAPP2-BOT (HTTP ${r.status})`;
          authFail = true;
          break;                                                          // the rest would fail the same way
        } else S.error = `HTTP ${r.status}`;
      } catch (e) { S.error = e.message; }
    }
    put(OUTBOX, j(OUTBOX, box).filter(a => !done.has(a.id)));          // re-read: keep anything queued meanwhile
    markSent(newIds);
    if (sent) { S.authBlocked = null; localStorage.removeItem(BLOCK); }
    if (sent) {
      put(LAST, { at: new Date().toISOString(), n: sent });
      try {
        const r = await fetch(`${API()}/actions/workflows/bot-actions.yml/dispatches`, { method: 'POST', headers: H, body: JSON.stringify({ ref: 'main' }) });
        if (r.status !== 204) S.error = (S.error ? S.error + '; ' : '') + `runner not woken (HTTP ${r.status}) — it will pick these up within 15 min in market hours`;
      } catch (e) {}
      if (typeof flashStatus === 'function') flashStatus(`Sent ${sent} bot action${sent > 1 ? 's' : ''} to the runner`, 'success');
    }
    S.sending = false;
    if (authFail) { const dg = j(DIAG, null); if (!dg || dg.token !== tokenTag()) await diagnose(); }
    badge();
    if (!authFail && j(OUTBOX, []).length > S.held) schedule(60000);
  }

  // ---- z118: access diagnosis (side-effect free) ----
  async function diagnose() {
    if (S.diagBusy) return j(DIAG, null);
    const token = localStorage.getItem('valuatio.github.token'), owner = OWNER();
    const d = { at: new Date().toISOString(), token: tokenTag(), owner,
                kind: !token ? 'none' : /^github_pat_/.test(token) ? 'fine-grained' : /^gh[pousr]_/.test(token) ? 'classic' : 'unknown' };
    if (!token) { d.verdict = 'none'; d.text = verdictText(d); put(DIAG, d); badge(); return d; }
    S.diagBusy = true; badge();
    const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    const msgOf = async r => { try { return ((await r.json()) || {}).message || ''; } catch (e) { return ''; } };
    try {
      let r = await fetch('https://api.github.com/user', { headers: H });
      if (r.status === 401) d.verdict = 'rejected';
      else {
        try { const sc = r.headers && r.headers.get ? r.headers.get('x-oauth-scopes') : null; if (sc != null) d.scopes = sc; } catch (e) {}
        try { d.login = ((await r.json()) || {}).login || null; } catch (e) { d.login = null; }
        r = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, { headers: H });
        try { d.ownerType = ((await r.json()) || {}).type || null; } catch (e) { d.ownerType = null; }
        // write probe 1: an unreferenced git blob - needs Contents: write; no commit, no file, no ref moves
        r = await fetch(`${API()}/git/blobs`, { method: 'POST', headers: H, body: JSON.stringify({ content: 'valuatio access probe', encoding: 'utf-8' }) });
        d.contents = r.status; d.contentsMsg = r.ok ? '' : await msgOf(r);
        // write probe 2: dispatch to a ref that doesn't exist - 422 when Actions: write is granted; no run starts
        r = await fetch(`${API()}/actions/workflows/bot-actions.yml/dispatches`, { method: 'POST', headers: H, body: JSON.stringify({ ref: 'refs/heads/valuatio-access-probe-none' }) });
        d.actions = r.status; d.actionsMsg = r.status === 204 ? '' : await msgOf(r);
        const canC = d.contents === 201 || d.contents === 200, canA = d.actions === 422 || d.actions === 204;
        d.verdict = canC ? (canA ? 'ok' : 'no-actions') : /rate limit/i.test(d.contentsMsg) ? 'rate' : 'no-contents';
      }
    } catch (e) { d.verdict = 'network'; d.err = e.message; }
    S.diagBusy = false;
    d.text = verdictText(d);
    put(DIAG, d);
    if (d.verdict === 'ok' || d.verdict === 'no-actions') {
      S.authBlocked = null; localStorage.removeItem(BLOCK); S.error = null;
      if (j(OUTBOX, []).length) schedule(300);
    }
    badge();
    return d;
  }
  function verdictText(d) {
    const o = d.owner, who = d.login ? '@' + d.login : 'this token', url = 'github.com/settings/personal-access-tokens';
    const gh = d.contentsMsg ? ` (GitHub: “${d.contentsMsg}”)` : '';
    const repos = 'Repository access: Only select repositories → XTRAPP, TRAPP2-PORT, TRAPP2-OPTIONS, TRAPP2-BOT · Repository permissions: Contents Read and write, Actions Read and write';
    const wf = ' (The repo\'s Settings → Actions → General → Workflow permissions is for workflow runs - it never applies to this token.)';
    switch (d.verdict) {
      case 'none': return 'No GitHub token on this device — Home 🏠 → Connections & API keys → GitHub token.';
      case 'rejected': return `GitHub rejected the token (expired or revoked). Signed in as ${o}: ${url} → Generate new token (${repos}).`;
      case 'network': return `Couldn't reach GitHub to check access (${d.err || 'network'}).`;
      case 'rate': return `GitHub rate limit${gh} — try Check access again in a few minutes.`;
      case 'ok': return `✓ ${d.kind} token (${who}) can write to ${o}/TRAPP2-BOT and wake the runner.`;
      case 'no-actions': return `Inbox writes ✓ (${who}), but the token can't start the runner — TRAPP2-BOT needs Actions: Read and write. Actions still apply within 15 min in market hours.`;
    }
    if (d.login && d.login.toLowerCase() !== String(o).toLowerCase() && d.ownerType === 'User')
      return d.kind === 'classic'
        ? `This is a classic token for @${d.login}, who can't write to ${o}/TRAPP2-BOT${gh}. Use a fine-grained token made while signed in as ${o}.`
        : `This token belongs to @${d.login}; TRAPP2-BOT belongs to @${o}. A fine-grained token only reaches repositories of its Resource owner, so it can't write here${gh}. Sign in to GitHub as ${o} → ${url} → Generate new token → Resource owner ${o} → ${repos} → paste it in Home 🏠 → Connections.${wf}`;
    if (d.ownerType === 'Organization')
      return `TRAPP2-BOT is in the ${o} organization: the token needs Resource owner ${o}, TRAPP2-BOT with Contents: Read and write, and approval (${o} → Settings → Personal access tokens → Pending requests)${gh}.`;
    if (d.kind === 'classic')
      return `Classic token (${who}) can't write TRAPP2-BOT${gh}${d.scopes != null ? ` · its scopes: ${d.scopes || 'none'}` : ''}. A classic token needs the "repo" scope, made while signed in as ${o} (or by a collaborator with write access).${wf}`;
    return `${who === 'this token' ? 'This token' : `The token (${who})`} can't write TRAPP2-BOT${gh}. ${url} → this token → ${repos} → Update. "Public repositories" access is read-only whatever the permissions say.${wf}`;
  }
  function discardAll() {
    const n = j(OUTBOX, []).length;
    if (!n || !confirm(`Discard ${n} queued bot action(s)? They were already applied in this browser; the runner just won't hear about them.`)) return;
    put(OUTBOX, []); S.error = null; S.held = 0; S.authBlocked = null; localStorage.removeItem(BLOCK); badge();
  }

  // ---- status line in the Bets tab ----
  function badge() {
    const body = document.getElementById('bets-body'); if (!body) return;
    let el = document.getElementById('botsync-badge');
    if (ONE_BOOK()) { if (el) el.remove(); return; }            // z122: no APP ↔ RUNNER line - nothing to send
    if (!el) { el = document.createElement('div'); el.id = 'botsync-badge'; body.insertBefore(el, body.firstChild); }
    const box = j(OUTBOX, []), last = j(LAST, null), dg = j(DIAG, null);
    const blocked = S.authBlocked && S.authBlocked.token === tokenTag();
    const diag = dg && dg.token === tokenTag() ? dg : null;
    const bad = blocked || (diag && diag.verdict !== 'ok' && diag.verdict !== 'no-actions' && (S.error || box.length));
    const col = (S.error || bad) ? 'var(--red)' : (box.length || S.stranded) ? 'var(--amber)' : 'var(--pos)';
    const state = S.sending ? 'sending to the runner…' : S.diagBusy ? 'checking the token…'
      : blocked ? `${box.length} action(s) waiting — GitHub refused the write (HTTP ${S.authBlocked.status}). Nothing is lost: they send once the token has access.`
      : S.error ? `${box.length} queued · ${S.error}` : box.length ? `${box.length} action(s) queued for the runner${S.held ? ` · ${S.held} held` : ''}` :
      `in sync${last ? ` · last sent ${new Date(last.at).toLocaleString()}` : ''}`;
    const btn = (label, fn) => `<button class="btn btn-ghost" style="padding:3px 9px;font-size:10px" onclick="${fn}">${label}</button>`;
    const why = diag && (bad || diag.verdict === 'no-actions' || S.showQueue)
      ? `<div style="flex-basis:100%;color:${diag.verdict === 'ok' ? 'var(--pos)' : 'var(--ink-dim)'};line-height:1.5">${esc(diag.text)} <span style="color:var(--ink-faint)">· checked ${esc(fmtT(diag.at))}</span></div>`
      : blocked ? `<div style="flex-basis:100%;color:var(--ink-faint)">Tap Check access to see exactly what the token is missing.</div>` : '';
    const strand = S.stranded
      ? `<div style="flex-basis:100%;color:var(--ink-dim);line-height:1.5">⚠ ${S.stranded.n} trade(s) on this device (${S.stranded.open} open, realized ${money(S.stranded.realized)}) aren't in the runner's book — opened here before the outbox existed or missed by it. Their trims/closes are held${S.held ? ` (${S.held})` : ''} until they're adopted. ${btn('Send to runner', 'BotSync.adoptStranded()')}</div>` : '';
    const list = S.showQueue && box.length ? `<div style="flex-basis:100%;max-height:180px;overflow:auto;border-top:1px solid var(--rule);padding-top:6px">${box.map(a => `<div style="color:var(--ink-dim)">${esc(fmtT(a.ts))} · ${esc(a.type.toUpperCase())} ${esc(a.trade ? a.trade.ticker + ' ' + (a.trade.shares || '') + (a.type === 'open' ? ' @ ' + (a.trade.entryPrice || '') : ` · ${a.trade.status || ''}`) : a.tradeId ? (a.tradeId + (a.shares ? ' · ' + a.shares + ' sh' : '') + (a.price ? ' @ ' + a.price : '')) : (a.amount != null ? '$' + a.amount : ''))}</div>`).join('')}</div>` : '';
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-family:var(--mono);font-size:10.5px;padding:7px 12px;border:1px solid var(--rule);border-left:3px solid ${col};border-radius:4px;margin:8px 0;background:var(--bg-elev)">
      <span style="color:${col};font-weight:700">APP ↔ RUNNER</span><span style="color:var(--ink-faint)">${VERSION}</span><span style="color:var(--ink-dim)">${esc(state)}</span>
      <span style="color:var(--ink-faint)">· runner trades on schedule; app trades only when you press Run</span>
      ${(box.length || bad) ? `<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        ${box.length ? btn(`${S.showQueue ? 'Hide' : 'View'} queue`, 'BotSync.toggleQueue()') : ''}
        ${btn('Check access', 'BotSync.checkAccess()')}
        ${box.length ? btn('Send now', 'BotSync.flush(true)') + btn('Discard', 'BotSync.discardAll()') : ''}</span>` : ''}
      ${why}${strand}${list}</div>`;
  }

  if (!hook()) document.addEventListener('DOMContentLoaded', hook);
  setTimeout(() => { if (ONE_BOOK()) { retireOutbox(); badge(); return; } if (j(OUTBOX, []).length) schedule(2000); refreshStranded(); badge(); }, 6000);
  setInterval(badge, 30000);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.tab-btn[data-tab="bets"]')) setTimeout(() => { refreshStranded(); badge(); }, 400); }, true);
  window.BotSync = { flush, diff, snap, checkAccess: diagnose, diagnose, discardAll, adoptStranded, refreshStranded,
                     outbox: () => j(OUTBOX, []), toggleQueue: () => { S.showQueue = !S.showQueue; badge(); }, _state: S };
})();
