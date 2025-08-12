(function () {
  const THRESHOLD = 2650;
  const TAB_SELECTOR = 'div.tab.active[data-target="changes24Section"]';
  const ROW_SELECTOR = 'table tr';

  function parseRaceDelta(cellText) {
    const match = cellText.match(/\+?([\d,]+)/);
    return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
  }

  function removeGlitchedRows() {
    const tab = document.querySelector(TAB_SELECTOR);
    if (!tab) return;

    const rows = document.querySelectorAll(ROW_SELECTOR);
    rows.forEach(row => {
      const raceCell = row.querySelector('td[data-label="Δ Total Races"]');
      if (!raceCell) return;

      const raceDelta = parseRaceDelta(raceCell.textContent);
      if (raceDelta > THRESHOLD) {
        row.remove(); // 🚫 Remove glitched racer row
        console.log(`Removed glitched racer with Δ Total Races: ${raceDelta}`);
      }
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeGlitchedRows);
  } else {
    removeGlitchedRows();
  }
})();
