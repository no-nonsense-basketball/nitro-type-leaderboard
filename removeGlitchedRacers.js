// ==UserScript==
// @name         Remove Glitched Racers (>2600 Δ Total Races)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hide rows where Δ Total Races exceeds threshold
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const THRESHOLD = 2600;

  // Normalize text (handles odd spaces)
  const norm = (s) => String(s || '')
    .replace(/[\u00A0\u202F\u2007]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Parse things like “+36,099” or “−1,234”
  const parseDelta = (text) => {
    const cleaned = String(text || '')
      .replace(/\u2212/g, '-')       // Unicode minus → ASCII minus
      .replace(/[^0-9-]/g, '');      // keep only digits and minus sign
    if (!cleaned) return NaN;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : NaN;
  };

  // Find all tables with a “Total Races” column
  const findTables = () => {
    const all = Array.from(document.querySelectorAll('table'));
    return all.filter((table) => {
      if (table.querySelector('tbody td[data-label*="Total Races"]')) return true;
      const ths = table.tHead ? Array.from(table.tHead.querySelectorAll('th')) : [];
      return ths.some((th) => /total races/i.test(norm(th.textContent)));
    });
  };

  // Build a function that retrieves the cell for Δ Total Races in a given row
  function makeCellGetter(table) {
    if (table.querySelector('tbody td[data-label*="Total Races"]')) {
      return (row) =>
        row.querySelector('td[data-label="Δ Total Races"]') ||
        row.querySelector('td[data-label*="Total Races"]');
    }
    if (table.tHead) {
      const ths = Array.from(table.tHead.querySelectorAll('th'));
      const idx = ths.findIndex((th) => /total races/i.test(norm(th.textContent)));
      if (idx >= 0) {
        return (row) => row.children[idx] || null;
      }
    }
    return () => null;
  }

  // Remove rows exceeding threshold
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

  // Keep watching for rows being added
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
    applyAll();
    // Retry every 200 ms for ~4 s in case table renders late
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
