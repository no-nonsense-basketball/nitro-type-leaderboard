/* removeGlitchedRacers.js
   Remove leaderboard rows where "Δ Total Races" > 2600.
   - Detects the target column by data-label or header text containing "Total Races".
   - Normalizes spaces and symbols; parses "+36,099" -> 36099.
   - Applies initially, retries briefly for late DOM, and observes tbody for changes.
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

  // Parse deltas like "+36,099" or "−1,234" (minus can be ASCII or Unicode)
  const parseDelta = (text) => {
    const cleaned = String(text || '')
      .replace(/[+\u2212]/g, '')   // strip ASCII plus and Unicode minus sign
      .replace(/[^\d-]/g, '');     // keep ascii minus if present, and digits
    if (!cleaned) return NaN;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : NaN;
  };

  // Identify candidate tables that actually have a "Total Races" column
  const findTables = () => {
    const all = Array.from(document.querySelectorAll('table'));
    return all.filter((table) => {
      // Fast path: any td with a data-label containing "Total Races"
      if (table.querySelector('tbody td[data-label*="Total Races"]')) return true;
      // Header path: any th whose text contains "Total Races"
      const ths = table.tHead ? Array.from(table.tHead.querySelectorAll('th')) : [];
      return ths.some((th) => /total races/i.test(norm(th.textContent)));
    });
  };

  // For a given table, find a getter that returns the Δ Total Races cell for a row
  function makeCellGetter(table) {
    // Prefer data-label on cells (works regardless of column order)
    const hasDataLabel = !!table.querySelector('tbody td[data-label*="Total Races"]');
    if (hasDataLabel) {
      return (row) =>
        row.querySelector('td[data-label="Δ Total Races"]') ||
        row.querySelector('td[data-label*="Total Races"]');
    }

    // Fallback to header index detection by header text
    if (table.tHead) {
      const ths = Array.from(table.tHead.querySelectorAll('th'));
      const idx = ths.findIndex((th) => /total races/i.test(norm(th.textContent)));
      if (idx >= 0) {
        return (row) => {
          const cells = row.children;
          return cells[idx] || null;
        };
      }
    }
    // No way to resolve the column
    return () => null;
  }

  // Remove rows exceeding threshold; returns number removed
  function filterTable(table) {
    // Support first tbody; if multiple tbodies exist, iterate all
    const tbodies = table.tBodies && table.tBodies.length ? Array.from(table.tBodies) : [];
    if (!tbodies.length) return 0;

    const getCell = makeCellGetter(table);
    let removed = 0;

    for (const tbody of tbodies) {
      const rows = Array.from(tbody.rows);
      const toRemove = [];
      for (const row of rows) {
        // Skip header-like rows that leaked into tbody
        if (!row || !row.children || row.children.length === 0) continue;

        const cell = getCell(row);
        if (!cell) continue;

        const n = parseDelta(cell.textContent);
        if (Number.isFinite(n) && n > THRESHOLD) {
          toRemove.push(row);
        }
      }
      for (const r of toRemove) {
        r.remove();
        removed++;
      }
    }

    return removed;
  }

  // Observe tbody changes and re-apply removal
  function observeTable(table) {
    const tbodies = table.tBodies && table.tBodies.length ? Array.from(table.tBodies) : [];
    for (const tbody of tbodies) {
      const mo = new MutationObserver((muts) => {
        // Cheap check: only if nodes were added
        if (muts.some((m) => m.type === 'childList' && m.addedNodes && m.addedNodes.length)) {
          filterTable(table);
        }
      });
      mo.observe(tbody, { childList: true, subtree: true });
    }
  }

  function init() {
    const applyAll = () => {
      const tables = findTables();
      for (const t of tables) {
        filterTable(t);
        observeTable(t);
      }
    };

    // Immediate attempt, then a short retry window for late-rendered tables
    applyAll();
    let tries = 0;
    const maxTries = 20; // ~4s with 200ms interval
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
