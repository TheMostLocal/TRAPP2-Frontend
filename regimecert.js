/* ==========================================================================
   regimecert.js — Regime certainty, shown wherever the regime is shown (z93).

   Reads TRAPP2-1/data/regime_certainty.json (pipeline/regime_certainty.py):
     certainty 0-1 = 0.30 classifier margin + 0.25 stability (flips in 20
     sessions) + 0.25 quad agreement (nowcast vs official) + 0.20 cross-check,
     capped at 0.50 if the classifier's 21-session track record doesn't beat
     the naive "SPY rises" rate. dialedIn = certainty >= 0.65.
   When the regime is NOT dialed in the bot trades regime-agnostic, and the app
   says so next to every regime label:
     * a card at the top of the Regime tab: certainty, the four components,
       the reasons, the track record and what the bot is doing about it
     * the company header's REGIME line gets "· certainty N% · not dialed in"
   ========================================================================== */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const raw = () => { try { if (typeof GH_RAW !== 'undefined') return GH_RAW; } catch (e) {} return 'https://raw.githubusercontent.com/TheMostLocal'; };
  let RC = null, at = 0, pending = null;
  async function load() {
    if (RC && Date.now() - at < 15 * 60 * 1000) return RC;
    if (pending) return pending;
    pending = (async () => {
      try { const r = await fetch(`${raw()}/TRAPP2-1/main/data/regime_certainty.json`, { cache: 'no-cache' }); if (r.ok) { RC = await r.json(); at = Date.now(); } } catch (e) {}
      pending = null; return RC;
    })();
    return pending;
  }
  const pct = v => (v == null || !isFinite(v)) ? '—' : `${Math.round(v * 100)}%`;

  function cardHtml(rc) {
    const ok = !!rc.dialedIn, col = ok ? 'var(--pos)' : 'var(--red)';
    const c = rc.components || {}, tr = rc.trackRecord || {};
    const bar = (label, sc, w, note) => `<div style="display:grid;grid-template-columns:110px 1fr 46px;gap:8px;align-items:center;font-family:var(--mono);font-size:10px;margin:3px 0">
        <span style="color:var(--ink-dim)">${label} <span style="color:var(--ink-faint)">×${w}</span></span>
        <span style="height:6px;background:var(--rule);border-radius:3px;overflow:hidden" title="${esc(note || '')}"><span style="display:block;height:100%;width:${Math.round((sc || 0) * 100)}%;background:${(sc || 0) >= 0.65 ? 'var(--pos)' : (sc || 0) >= 0.35 ? 'var(--amber)' : 'var(--red)'}"></span></span>
        <span style="text-align:right;color:var(--ink)">${pct(sc)}</span></div>`;
    return `<section id="regime-cert-card" class="company-card" style="margin:0 0 16px;border-left:3px solid ${col}">
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-dim)">REGIME CERTAINTY</div>
        <div style="font-family:var(--mono);font-size:22px;color:${col}">${pct(rc.certainty)}</div>
        <div style="font-family:var(--mono);font-size:11px;color:${col};font-weight:700">${ok ? 'DIALED IN · regime-aware' : 'NOT DIALED IN · regime-agnostic'}</div>
        <div style="margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)">needs ${pct(rc.threshold)} · ${esc(rc.asOf || '')}</div>
      </div>
      <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);margin:6px 0 8px;line-height:1.55">
        ${ok ? `The bot is using the regime (<strong>${esc(rc.regime)}</strong>, quad ${esc(rc.quadNowcast)}) to tilt signals and grade sectors.`
             : `The regime call isn't trustworthy right now, so the bot <strong>ignores it</strong>: no regime tilts, no regime-based sector grades, pattern trust from all regimes. Trades rest on company-level and price evidence instead.`}
      </div>
      ${bar('Margin', c.margin?.score, '0.30', `top-vs-runner-up probability gap ${c.margin?.value}`)}
      ${bar('Stability', c.stability?.score, '0.25', `${c.stability?.flips20} flips in 20 sessions`)}
      ${bar('Quad agreement', c.quadAgreement?.score, '0.25', `nowcast Q${c.quadAgreement?.nowcast} vs official Q${c.quadAgreement?.official}`)}
      ${bar('Cross-check', c.crossCheck?.score, '0.20', `market family ${c.crossCheck?.family} vs quad growth axis`)}
      <ul style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin:8px 0 0 16px;padding:0;line-height:1.6">${(rc.why || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:6px">Track record: ${tr.n ? `${tr.accuracyPct}% of ${tr.n} past calls were right ${tr.horizonSessions} sessions later vs ${tr.baseRateUpPct}% for "SPY just rises"${tr.capped ? ' — not beating the naive rate, certainty capped' : ''}` : 'no judged calls yet'}. Trades record the regime they were entered under; a win never credits a regime call that was untrusted or later proved wrong.</div>
    </section>`;
  }

  async function renderRegimeCard() {
    const panel = document.querySelector('.tab-panel[data-panel="regime"]');
    if (!panel) return;
    const rc = await load();
    if (!rc) return;
    const html = cardHtml(rc);
    const old = document.getElementById('regime-cert-card');
    if (old) old.outerHTML = html; else panel.insertAdjacentHTML('afterbegin', html);
  }
  async function tagHeader() {
    const tag = document.getElementById('s-regime-tag');
    if (!tag || tag.dataset.cert) return;
    tag.dataset.cert = 'pending';                       // claim it before awaiting (no double tag)
    const rc = await load();
    if (!rc || !tag.isConnected) { if (tag.isConnected) delete tag.dataset.cert; return; }
    const ok = !!rc.dialedIn;
    tag.insertAdjacentHTML('beforeend', ` <span style="font-family:var(--mono);font-size:10px;color:${ok ? 'var(--pos)' : 'var(--red)'};margin-left:8px" title="Regime certainty — see the Regime tab">· certainty ${pct(rc.certainty)}${ok ? '' : ' · not dialed in'}</span>`);
    tag.dataset.cert = '1';
  }
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.tab-btn[data-tab="regime"]');
    if (b) setTimeout(renderRegimeCard, 50);
  }, true);
  setInterval(() => {
    tagHeader();
    const panel = document.querySelector('.tab-panel[data-panel="regime"]');
    if (panel && panel.classList.contains('active') && !document.getElementById('regime-cert-card')) renderRegimeCard();
  }, 1500);
  window.RegimeCertainty = { load, renderRegimeCard };
})();
