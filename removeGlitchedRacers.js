/* removeGlitchedRacers.js
   Removes rows where "Δ Total Races" > 2600.
   - Robust matching: uses data-label="Δ Total Races" if present; otherwise finds the header index by text containing "Total Races".
   - Fast: single pass with batched removals.
   - Resilient: auto-reapplies when rows are added/changed via MutationObserver.
*/
(() => {
  'use strict';

  const THRESHOLD = 2600;

  // Normalize header/cell text (handle weird spaces)
  const norm = s =>
    String(s || '')
      .replace(/[\u00A0\u202F]/g, ' ') // NBSP, NNBSP -> space
      .replace(/\s+/g, ' ')
      .trim();

  // Parse something like "+36,099" -> 36099
  const parseDelta = text => {
    const cleaned = String(text || '').replace(/[^\d-]/g, ''); // keep digits and minus
    if (!cleaned) return NaN;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : NaN;
  };

  // Find tables that have a "Total Races" column (by header text or data-label in body)
  function findTargetTables(root = document) {
    const tables = Array.from(root.querySelectorAll('table'));
    return tables.filter(table => {
      if (table.querySelector('td[data-label*="Total Races"]')) return true;
      const ths = table.tHead ? table.tHead.querySelectorAll('th') : [];
      for (const th of ths) {
        if (/total races/i.test(norm(th.textContent))) return true;
      }
      return false;
    });
  }

  // Find the Δ Total Races cell for a given row
  function getDeltaCell(row) {
    // Prefer explicit data-label (responsive tables)
    let cell = row.querySelector('td[data-label="Δ Total Races"]');
    if (!cell) cell = row.querySelector('td[data-label*="Total Races"]');
    if (cell) return cell;

    // Fallback: find header index by text containing "Total Races"
    const table = row.closest('table');
    if (!table || !table.tHead) return null;
    const ths = Array.from(table.tHead.querySelectorAll('th'));
    const idx = ths.findIndex(th => /total races/i.test(norm(th.textContent)));
    if (idx < 0) return null;

    const cells = row.children;
    return cells[idx] || null;
  }

  // Remove rows that exceed threshold; returns removed count
  function filterTable(table) {
    const tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return 0;

    const rows = Array.from(tbody.rows);
    const toRemove = [];

    for (const row of rows) {
      const cell = getDeltaCell(row);
      if (!cell) continue;
      const n = parseDelta(cell.textContent);
      if (Number.isFinite(n) && n > THRESHOLD) {
        toRemove.push(row);
      }
    }

    // Batch remove to limit reflows
    for (const row of toRemove) row.remove();
    return toRemove.length;
  }

  // Observe row insertions to re-apply the filter
  function observeTable(table) {
    const tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return;

    const mo = new MutationObserver(muts => {
      let needsFilter = false;
      for (const m of muts) {
        if (m.type === 'childList' && (m.addedNodes && m.addedNodes.length)) {
          needsFilter = true;
          break;
        }
      }
      if (needsFilter) filterTable(table);
    });

    mo.observe(tbody, { childList: true });
  }

  function init() {
    // Initial pass (allow a tick for any late DOM writes)
    const applyAll = () => {
      const tables = findTargetTables();
      for (const table of tables) {
        filterTable(table);
        observeTable(table);
      }
    };

    // If table builds after DOMContentLoaded, keep a short watch for new target tables
    let scanCount = 0;
    const maxScans = 20; // ~4s total if interval=200ms
    const interval = setInterval(() => {
      applyAll();
      scanCount++;
      if (scanCount >= maxScans) clearInterval(interval);
    }, 200);

    // Also run once right away after a microtask
    setTimeout(applyAll, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
