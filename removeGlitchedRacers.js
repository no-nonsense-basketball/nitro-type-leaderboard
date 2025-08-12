/* removeGlitchedRacers.js
   Hides rows in any table where the "Δ Total Races" cell > threshold (default 2600).
   - Finds the correct column by data-label="Δ Total Races" OR matching <th> text.
   - Fast: single pass, minimal DOM writes (class toggle).
   - Resilient: auto-reapplies on mutations (sorting, reloads).
   - Usable: adds a small toggle UI and counter.
*/
(() => {
  'use strict';

  const CONFIG = {
    // If your page has multiple tables, we’ll filter each that contains Δ Total Races
    tableSelector: 'table',
    deltaHeaderText: 'Δ Total Races',
    threshold: 2600,
    attachUI: true,
    observeMutations: true,
    debug: false,
  };

  // Lightweight logger
  const log = (...args) => CONFIG.debug && console.log('[GlitchFilter]', ...args);

  // Ensure style once
  const ensureStyle = (() => {
    let injected = false;
    return () => {
      if (injected) return;
      injected = true;
      const css = `
        .glitch-hidden { display: none !important; }
        .glitch-filter-ui {
          font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          display: inline-flex; align-items: center; gap: .5rem;
          padding: .35rem .5rem; border: 1px solid #ddd; border-radius: 6px;
          background: #f8f9fa; color: #111; margin: .5rem 0;
        }
        .glitch-filter-ui button {
          cursor: pointer; padding: .25rem .5rem; border: 1px solid #ccc; border-radius: 4px;
          background: white;
        }
        .glitch-filter-ui input[type="number"] {
          width: 6rem; padding: .2rem .3rem; border: 1px solid #ccc; border-radius: 4px;
          background: white;
        }
        .glitch-filter-ui .stat { opacity: .8; }
      `;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    };
  })();

  // Normalize header/cell text for matching
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

  // Get numeric value from a cell like "+36,043"
  const parseDelta = text => {
    const cleaned = String(text || '').replace(/[^\d-]/g, '');
    if (!cleaned) return NaN;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : NaN;
  };

  // Find the Δ Total Races column index for a given table
  function findDeltaColIndex(table) {
    // Priority 1: use data-label on any row (mobile-responsive tables)
    const probe = table.querySelector(`tbody td[data-label="${CONFIG.deltaHeaderText}"]`);
    if (probe) {
      // Return a resolver that fetches by data-label (index-agnostic)
      return { mode: 'data-label' };
    }

    // Priority 2: find by <th> text
    const ths = table.querySelectorAll('thead th, thead tr th');
    let idx = -1;
    ths.forEach((th, i) => {
      if (idx >= 0) return;
      if (norm(th.textContent) === CONFIG.deltaHeaderText) idx = i;
    });
    if (idx >= 0) return { mode: 'index', index: idx };

    return null;
  }

  // Get the Δ Total Races cell from a row based on resolver
  function getDeltaCell(row, resolver) {
    if (resolver.mode === 'data-label') {
      return row.querySelector(`td[data-label="${CONFIG.deltaHeaderText}"]`);
    }
    const cells = row.querySelectorAll('td');
    return cells[resolver.index] || null;
  }

  // Filter a single table; returns stats
  function filterTable(table, state) {
    const resolver = findDeltaColIndex(table);
    if (!resolver) {
      log('Δ Total Races column not found in table, skipping.');
      return { processed: 0, hidden: 0 };
    }

    const tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return { processed: 0, hidden: 0 };

    let processed = 0;
    let hidden = 0;
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
      processed++;
      const cell = getDeltaCell(row, resolver);
      if (!cell) return;
      const n = parseDelta(cell.textContent);
      const shouldHide = Number.isFinite(n) && n > state.threshold;

      // Toggle class only if changed to minimize layout thrash
      const has = row.classList.contains('glitch-hidden');
      if (shouldHide && !has) {
        row.classList.add('glitch-hidden');
        hidden++;
      } else if (!shouldHide && has) {
        row.classList.remove('glitch-hidden');
      }
    });

    return { processed, hidden: table.querySelectorAll('tbody tr.glitch-hidden').length };
  }

  // Build a compact UI for threshold/toggle and stats
  function attachUI(nearTable, applyAll, state) {
    ensureStyle();

    const ui = document.createElement('div');
    ui.className = 'glitch-filter-ui';
    ui.innerHTML = `
      <strong>Glitch filter</strong>
      <label>Threshold:
        <input type="number" min="0" step="100" value="${state.threshold}" />
      </label>
      <button type="button" data-action="toggle">${state.enabled ? 'Disable' : 'Enable'}</button>
      <span class="stat">Hidden: <b class="count">0</b></span>
    `;

    const input = ui.querySelector('input');
    const btn = ui.querySelector('button[data-action="toggle"]');
    const countEl = ui.querySelector('.count');

    const updateStats = () => {
      const allHidden = document.querySelectorAll('tbody tr.glitch-hidden').length;
      countEl.textContent = String(allHidden);
    };

    let rafId = 0;
    const scheduleApply = () => {
      if (!state.enabled) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        applyAll();
        updateStats();
      });
    };

    input.addEventListener('change', () => {
      const v = Number(input.value);
      state.threshold = Number.isFinite(v) && v >= 0 ? v : state.threshold;
      input.value = String(state.threshold);
      scheduleApply();
    });

    btn.addEventListener('click', () => {
      state.enabled = !state.enabled;
      btn.textContent = state.enabled ? 'Disable' : 'Enable';
      if (state.enabled) {
        scheduleApply();
      } else {
        // Show everything
        document.querySelectorAll('tbody tr.glitch-hidden').forEach(tr => tr.classList.remove('glitch-hidden'));
        updateStats();
      }
    });

    // Place UI just before the table
    nearTable.parentElement.insertBefore(ui, nearTable);
    // Initial stats after first apply
    setTimeout(updateStats, 0);
    return { updateStats };
  }

  // Main init
  function init() {
    const state = {
      threshold: CONFIG.threshold,
      enabled: true,
    };

    const tables = Array.from(document.querySelectorAll(CONFIG.tableSelector))
      .filter(t => !!findDeltaColIndex(t));

    if (tables.length === 0) {
      log('No applicable tables found.');
      return;
    }

    // One function to apply to all target tables
    const applyAll = () => {
      if (!state.enabled) return;
      tables.forEach(table => filterTable(table, state));
    };

    // Initial apply (after a microtask to allow any late DOM)
    requestAnimationFrame(applyAll);

    // Optional UI: attach near the first relevant table
    let uiCtl = null;
    if (CONFIG.attachUI) {
      uiCtl = attachUI(tables[0], applyAll, state);
    }

    // Mutation observer to re-apply on dynamic changes (sorting, data refresh)
    if (CONFIG.observeMutations) {
      const observer = new MutationObserver(() => {
        // Debounce via rAF
        requestAnimationFrame(applyAll);
      });
      tables.forEach(table => {
        const tbody = table.tBodies && table.tBodies[0];
        if (!tbody) return;
        observer.observe(tbody, { childList: true, subtree: true, characterData: false });
      });
    }

    // Expose a tiny API if needed
    window.GlitchFilter = {
      setThreshold(v) {
        if (!Number.isFinite(v) || v < 0) return;
        state.threshold = v;
        applyAll();
        uiCtl && (document.querySelector('.glitch-filter-ui input').value = String(v));
      },
      enable() { state.enabled = true; applyAll(); },
      disable() {
        state.enabled = false;
        document.querySelectorAll('tbody tr.glitch-hidden').forEach(tr => tr.classList.remove('glitch-hidden'));
      },
      reapply: applyAll,
      config: CONFIG,
    };
  }

  // Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
