/* removeGlitchedRacers.js
   Remove rows where "Δ Total Races" > 2600.
   - Finds the target column by data-label containing "Total Races" or header text.
   - Normalizes weird spaces; parses "+36,099" reliably.
   - Runs now, retries briefly for late DOM, and re-applies on tbody mutations.
*/
(() => {
  'use strict';

  const THRESHOLD = 2600;

  // Normalize text: collapse whitespace, convert NBSP variants
  const norm = (s) =>
    String(s || '')
      .replace(/[\u00A0\u202F\u2007]/g, ' ') // NBSP, NNBSP, figure space
      .replace(/\s+/g, ' ')
      .trim();

  // Parse deltas like "+36,099" or "−1,234" (handle Unicode minus)
  const parseDelta = (text) => {
    const cleaned = String(text || '')
      .replace(/\u2212/g, '-')   // Unicode minus → ASCII minus
      .replace(/[^\d-]/g, '');   // keep digits and ASCII minus
    if (!cleaned) return NaN;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : NaN;
  };

  // Identify tables that actually have a "Total Races" column
  const findTables = () => {
    const all = Array.from(document.querySelectorAll('table'));
    return all.filter((table) => {
      if (table.querySelector('tbody td[data-label*="Total Races"]')) return true;
      const ths = table.tHead ? Array.from(table.tHead.querySelectorAll('th')) : [];
      return ths.some((th) => /total races/i.test(norm(th.textContent)));
    });
  };

  // Build a row→cell resolver
  function makeCellGetter(table) {
    // Prefer responsive data-labels
    if (table.querySelector('tbody td[data-label*="Total Races"]')) {
      return (row) =>
        row.querySelector('td[data-label="Δ Total Races"]') ||
        row.querySelector('td[data-label*="Total Races"]');
    }
    // Fallback: column index via header text
    if (table.tHead) {
      const ths = Array.from(table.tHead.querySelectorAll('th'));
      const idx = ths.findIndex((th) => /total races/i.test(norm(th.textContent)));
      if (idx >= 0) {
        return (row) => row.children[idx] || null;
      }
    }
    return () => null;
  }

  // Remove rows exceeding threshold; returns number removed
  function filterTable(table) {
    const tbodies = table.tBodies && table.tBodies.length ? Array.from(table.tBodies) : [];
    if (!tbodies.length) return 0;

    const getCell = makeCellGetter(table);
    let removed = 0;

    for (const tbody of tbodies) {
      const rows = Array.from(tbody.rows);
      const toRemove = [];
      for (const row of rows) {
        const cell = getCell(row);
        if (!cell) continue;
        const n = parseDelta(cell.textContent);
        if (Number.isFinite(n) && n > THRESHOLD) toRemove.push(row);
      }
      for (const r of toRemove) {
        r.remove();
        removed++;
      }
    }
    return removed;
  }

  // Observe tbody additions to re-apply after data loads or sorts
  function observeTable(table) {
    const tbodies = table.tBodies && table.tBodies.length ? Array.from(table.tBodies) : [];
    for (const tbody of tbodies) {
      const mo = new MutationObserver((muts) => {
        if (muts.some((m) => m.type === 'childList' && m.addedNodes.length)) {
          filterTable(table);
        }
      });
      mo.observe(tbody, { childList: true, subtree: true });
    }
  }

  function applyAll() {
    const tables = findTables();
    for (const t of tables) {
      filterTable(t);
      observeTable(t);
    }
  }

  function init() {
    // Immediate pass
    applyAll();
    // Short retry window for late-rendered content (~4s total)
    let tries = 0;
    const maxTries = 20;
    const iv = setInterval(() => {
      applyAll();
      if (++tries >= maxTries) clearInterval(iv);
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
