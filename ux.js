/* ==========================================================================
   ux.js — app-wide UX helpers (z88). Loaded after app.js.

   1. Tickers are clickable everywhere. Any on-screen element whose whole text is
      a ticker in the Stock Book (a table cell, a chip, a "connected company",
      an "also mentioned" tag ...) and any "(TSLA)" / "$TSLA" inside news text
      becomes a link to that ticker's Valuation page. Elements that already have
      their own click behaviour (buttons, inputs, links, onclick rows) are left
      alone - except the existing openTickerInValuation links, which now also
      land you on the Overview at the top of the page (they used to re-value the
      ticker but leave you scrolled deep inside the Company tab, which looked
      like nothing happened).
   ========================================================================== */
(function () {
  'use strict';

  // ---------- known tickers ----------
  let known = null, knownN = 0;
  function knownSet() {
    let rows = null;
    try { rows = (typeof state !== 'undefined' && state.stockbook && state.stockbook.rows) || null; } catch (e) {}
    if (rows && rows.length !== knownN) {
      known = new Set(rows.map(r => String(r.ticker || '').toUpperCase()).filter(Boolean));
      knownN = rows.length;
    }
    return known;
  }
  const SHAPE = /^\$?(?:[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z0-9]{1,4})?(?:=F|=X)?|\^[A-Z0-9]{2,9}|[0-9]{4,6}\.[A-Z]{1,2})$/;
  // Places where a ticker-looking word is NOT a link (inputs, controls, the
  // ticker being valued, the tape, chart internals, code).
  const SKIP = 'input,textarea,select,option,button,a,label,svg,canvas,script,style,code,pre,[contenteditable="true"],' +
               '.tk-nolink,.ticker-tape,#s-tic,#ticker,.val-subtabs,.tabs,.tab-btn,.ta-tools,.ta-tool,.modal-title,[onclick],[role="button"]';

  // Words that are also tickers but appear far more often as UI labels / units.
  // (Explicit "(USD)" / "$ALL" mentions in text still link.)
  const STOP = new Set(['A', 'ALL', 'AI', 'ANY', 'ARE', 'BUY', 'CAN', 'CASH', 'ETF', 'FOR', 'GO', 'HIGH', 'IT', 'KEY', 'LONG',
                        'LOW', 'NEW', 'NOW', 'ON', 'ONE', 'OPEN', 'SELL', 'SHORT', 'TOP', 'TWO', 'USD', 'YOU', 'BE', 'SO', 'UP']);
  function tagLeaf(el, set) {
    if (el.nodeType !== 1 || el.classList.contains('tk-link')) return;
    if (el.children.length) {
      // e.g. <div>XLK <span>(auto)</span></div>: link the ticker text node only
      if (el.children.length > 3 || (el.textContent || '').length > 40 || el.closest(SKIP)) return;
      for (const n of [...el.childNodes]) {
        if (n.nodeType !== 3) continue;
        const raw = n.textContent.trim();
        if (!raw || raw.length > 14 || !SHAPE.test(raw)) continue;
        const t = raw.replace(/^\$/, '');
        if (!set.has(t) || STOP.has(t) || t.length === 1) continue;
        const s = document.createElement('span');
        s.className = 'tk-link'; s.dataset.tk = t; s.tabIndex = 0; s.setAttribute('role', 'link'); s.title = `Value ${t}`;
        s.textContent = n.textContent;
        n.parentNode.replaceChild(s, n);
      }
      return;
    }
    const raw = (el.textContent || '').trim();
    if (raw.length < 1 || raw.length > 14 || !SHAPE.test(raw)) return;
    const t = raw.replace(/^\$/, '');
    if (!set.has(t) || STOP.has(t) || t.length === 1) return;   // single letters = grades/labels (A, B, C, F, X)
    if (el.closest(SKIP)) return;
    el.classList.add('tk-link');
    el.dataset.tk = t;
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    el.setAttribute('role', 'link');
    el.title = el.title || `Value ${t}`;
  }

  // "(TSLA)" and "$TSLA" inside running news / description text
  const INLINE_SCOPES = '.news-item-summary,.news-item-body,.news-summary,.news-item-text,#s-description,.summary-description';
  const INLINE_RE = /\(([A-Z][A-Z0-9.]{0,6})\)|\$([A-Z][A-Z0-9.]{0,6})\b/g;
  function linkifyInline(root, set) {
    const scopes = root.matches && root.matches(INLINE_SCOPES) ? [root] : [...(root.querySelectorAll ? root.querySelectorAll(INLINE_SCOPES) : [])];
    for (const sc of scopes) {
      const walker = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement && !n.parentElement.closest('.tk-link,' + SKIP) && INLINE_RE.test(n.textContent)) nodes.push(n);
        INLINE_RE.lastIndex = 0;
      }
      for (const n of nodes) {
        const txt = n.textContent, frag = document.createDocumentFragment();
        let last = 0, m, changed = false;
        INLINE_RE.lastIndex = 0;
        while ((m = INLINE_RE.exec(txt))) {
          const t = m[1] || m[2];
          if (!set.has(t)) continue;
          const tokStart = m.index + m[0].indexOf(t);
          frag.appendChild(document.createTextNode(txt.slice(last, tokStart)));
          const s = document.createElement('span');
          s.className = 'tk-link'; s.dataset.tk = t; s.tabIndex = 0; s.setAttribute('role', 'link'); s.title = `Value ${t}`;
          s.textContent = t;
          frag.appendChild(s);
          last = tokStart + t.length; changed = true;
        }
        if (!changed) continue;
        frag.appendChild(document.createTextNode(txt.slice(last)));
        n.parentNode.replaceChild(frag, n);
      }
    }
  }

  function scan(root) {
    const set = knownSet();
    if (!set || !set.size || !root) return;
    if (root.nodeType === 1) tagLeaf(root, set);
    const els = root.querySelectorAll ? root.querySelectorAll('span,td,th,div,li,strong,b,em,small,p,h4,h5') : [];
    for (const el of els) tagLeaf(el, set);
    linkifyInline(root, set);
  }

  // Batched re-scan of whatever the app (re)renders.
  const pending = new Set();
  let timer = null;
  function queue(node) {
    pending.add(node);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const nodes = [...pending]; pending.clear();
      for (const n of nodes) if (n.isConnected) scan(n);
    }, 250);
  }
  const mo = new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) queue(n);
    // text-only updates (e.g. a cell's textContent replaced)
    for (const m of muts) if (m.type === 'characterData' && m.target.parentElement) queue(m.target.parentElement);
  });
  function start() {
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    // full pass once the Stock Book has loaded (it arrives after first paint)
    let tries = 0;
    const wait = setInterval(() => {
      const set = knownSet();
      if ((set && set.size) || ++tries > 60) { clearInterval(wait); if (set && set.size) scan(document.body); }
    }, 1000);
  }

  // ---------- navigation ----------
  function goToValuation(t) {
    t = String(t || '').trim().toUpperCase().replace(/^\$/, '');
    if (!t) return;
    const inp = document.getElementById('ticker');
    if (!inp) return;
    inp.value = t;
    try { if (typeof switchTab === 'function') switchTab('valuation'); } catch (e) {}
    // land on the Overview (company summary + chart), at the top
    const ov = document.querySelector('.val-subtab[data-subtab="overview"]');
    if (ov && !ov.classList.contains('active')) ov.click();
    document.getElementById('fetch-btn')?.click();
    const top = () => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); } };
    top();
    setTimeout(top, 400);
  }
  window.openTickerInValuation = goToValuation;      // existing inline links use this name
  window.valueTicker = goToValuation;

  document.addEventListener('click', e => {
    const el = e.target && e.target.closest && e.target.closest('.tk-link');
    if (!el || !el.dataset.tk) return;
    e.preventDefault();
    e.stopPropagation();
    goToValuation(el.dataset.tk);
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('tk-link')) {
      e.preventDefault();
      goToValuation(e.target.dataset.tk);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
