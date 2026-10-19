/* ==========================================================================
   navgroups.js — A SIMPLER HOME (z125). Load after app.js.

   The top bar shows six things instead of seventeen:
     News · Bets · Stock Book & Valuation · Macro Data · Data & Research · Review
   A group opens its last-used page and shows its own sub-tabs underneath:
     Stock Book & Valuation : Stock Book · Valuation · Options (new: every chain)
     Macro Data             : Regime · Macro Quad · Bonds & Treasuries · Fed ·
                              Supply Chains · Global Trade
     Data & Research        : Data · Research · Scenarios · Risk Calculator · Probability
   Nothing is removed: every page is the same panel, rendered by the same code,
   opened through the same switchTab(). The original tab buttons stay in the page
   (hidden), so links, shortcuts and the command bar keep working; sub-tabs are
   ordinary .tab-btn elements, so the app marks the active one itself.
   ========================================================================== */
(function () {
  'use strict';
  const GROUPS = [
    { id: 'book', label: 'Stock Book & Valuation', icon: '📒', tabs: [['stockbook', 'Stock Book'], ['valuation', 'Valuation'], ['options', 'Options']] },
    { id: 'macro', label: 'Macro Data', icon: '🌐', tabs: [['regime', 'Regime'], ['macro', 'Macro Quad'], ['bonds', 'Bonds & Treasuries'], ['fed', 'Fed'], ['supplychain', 'Supply Chains'], ['globaltrade', 'Global Trade']] },
    { id: 'lab', label: 'Data & Research', icon: '🔬', tabs: [['data', 'Data'], ['research', 'Research'], ['scenarios', 'Scenarios'], ['risk', 'Risk Calculator'], ['probability', 'Probability']] },
  ];
  const LAST = 'valuatio.nav.lastTab.v1';
  const groupOf = tab => GROUPS.find(g => g.tabs.some(([t]) => t === tab)) || null;
  const lastTabs = () => { try { return JSON.parse(localStorage.getItem(LAST) || '{}') || {}; } catch (e) { return {}; } };

  function build() {
    const nav = document.querySelector('.tab-nav');
    if (!nav || nav._z125) return !!nav;
    nav._z125 = true;
    const members = new Set(GROUPS.flatMap(g => g.tabs.map(([t]) => t)));
    nav.querySelectorAll('.tab-btn').forEach(b => { if (members.has(b.dataset.tab)) b.classList.add('nav-hidden'); });
    let after = nav.querySelector('.tab-btn[data-tab="bets"]') || nav.querySelector('.tab-btn[data-tab="news"]');
    for (const g of GROUPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-group-btn';
      b.dataset.group = g.id;
      b.title = g.tabs.map(x => x[1]).join(' · ');
      b.innerHTML = `<span class="tab-num">${g.icon}</span> <span class="tab-label">${g.label}</span>`;
      b.addEventListener('click', () => {
        const t = lastTabs()[g.id];
        window.switchTab(g.tabs.some(([x]) => x === t) ? t : g.tabs[0][0]);
      });
      if (after) after.insertAdjacentElement('afterend', b); else nav.appendChild(b);
      after = b;
    }
    const review = nav.querySelector('.tab-btn[data-tab="review"]');
    if (review) nav.appendChild(review);                       // Review last
    if (!document.getElementById('sub-nav')) {
      const sub = document.createElement('div');
      sub.className = 'sub-nav';
      sub.id = 'sub-nav';
      sub.hidden = true;
      nav.insertAdjacentElement('afterend', sub);
    }
    return true;
  }

  function paint(tab) {
    const g = groupOf(tab);
    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.toggle('active', !!g && b.dataset.group === g.id));
    const sub = document.getElementById('sub-nav');
    if (!sub) return;
    if (!g) { sub.hidden = true; return; }
    if (sub.dataset.group !== g.id) {
      sub.dataset.group = g.id;
      sub.innerHTML = g.tabs.map(([t, label]) => `<button type="button" class="tab-btn sub-tab-btn" data-tab="${t}"><span class="tab-label">${label}</span></button>`).join('');
      sub.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => window.switchTab(b.dataset.tab)));
    }
    sub.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    sub.hidden = false;
    const last = lastTabs();
    last[g.id] = tab;
    try { localStorage.setItem(LAST, JSON.stringify(last)); } catch (e) {}
  }

  function wrap() {
    if (typeof window.switchTab !== 'function' || window.switchTab._z125) return !!window.switchTab;
    const orig = window.switchTab;
    const w = function (tab) {
      const r = orig.apply(this, arguments);
      try { paint(tab); } catch (e) {}
      if (tab === 'options') {
        const sub = document.getElementById('masthead-sub');
        if (sub) sub.textContent = 'Options · every ticker with a chain · IV, expected move, skew, term structure · tap one for its chain';
        const host = document.getElementById('options-hub-mount');
        if (host && window.OptionsHub) window.OptionsHub.render(host);
      }
      return r;
    };
    w._z125 = true;
    window.switchTab = w;
    return true;
  }

  function init() {
    build();
    wrap();
    const active = document.querySelector('.tab-panel.active');
    paint(active ? active.dataset.panel : 'valuation');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.NavGroups = { GROUPS, paint, groupOf };
})();
