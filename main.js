/* ============================================================================
   Nitro Type Leaderboard + Event Viewer (Full Script, No Streamlining)
   - Loads Data snapshots (Before/After) for general leaderboards
   - Loads API snapshots (Before/After, NDJSON) + Data (Before/After) for Event
   - Renders: Leaderboard, Races Per Day, 24-Hour (snapshot) Changes, Event Table
   - Includes robust helpers, sorting, NDJSON parsing, escaping, and UX notes
   ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ---------------------------------------------------------------------------
  // Constants and configuration
  // ---------------------------------------------------------------------------

  // Anomaly cutoff for 24h diffs (ignore insane values)
  const MAX_24H_RACES = 2600;

  // File set for the Event view
  // API snapshots are NDJSON, Data snapshots are JSON (array or { racers: [] })
  const EVENT_FILES = {
    apiBefore: 'API_before.ndjson',       // REQUIRED: NDJSON
    apiNow: 'API_now.ndjson',             // REQUIRED: NDJSON
    dataBefore: 'BeforeEventData.json',   // REQUIRED: JSON or { racers: [] }
    dataNow: 'AfterEventData.json'        // REQUIRED: JSON or { racers: [] }
  };

  // For the general leaderboards, we will use AfterEventData.json as "current"
  // and BeforeEventData.json as "previous" to populate the 24h-like changes.
  const DATA_CURRENT = 'AfterEventData.json';
  const DATA_PREVIOUS = 'BeforeEventData.json';

  // WPM calculation preference for the Event period:
  // - 'weighted': derive period WPM from (avgWpm * played) deltas
  // - 'current' : use end snapshot avgWpm only
  const WPM_METHOD = 'weighted';

  // ---------------------------------------------------------------------------
  // Tabs behavior (HTML should have .tabs .tab elements with data-target)
  // ---------------------------------------------------------------------------

  const tabs = document.querySelectorAll('.tabs .tab');
  const sections = document.querySelectorAll('.table-container');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      const targetId = tab.dataset.target;
      const section = document.getElementById(targetId);
      if (section) section.classList.add('active');
    });
  });

  // ---------------------------------------------------------------------------
  // Load "main" snapshots (Data current/previous) then render the three tabs
  // ---------------------------------------------------------------------------

  Promise.all([
    fetchJSONFlexible(DATA_CURRENT),           // "current" Data (array or { racers })
    fetchJSONFlexible(DATA_PREVIOUS, true)     // "previous" Data (optional)
  ])
  .then(([curData, prevData]) => {
    const cur = normalizeData(curData);
    const prev = normalizeData(prevData);

    // Leaderboard
    renderLeaderboard(cur.racers);
    enableSorting('leaderboardTable');

    // Races Per Day
    renderRacesPerDay(cur.racers);
    enableSorting('racesPerDayTable');

    // 24-hour-like changes (current vs previous snapshots)
    const prevMap = new Map((prev.racers || []).map(r => [String(r.username || '').toLowerCase(), r]));
    renderChanges24(cur.racers, prevMap);
    enableSorting('changes24Table');

    // Event (four-file computation)
    initEventTab();
  })
  .catch(err => {
    console.error('Failed loading main snapshots:', err);
    showPageMessage('Error loading main snapshots – check console.', '#ff5c5c');
    // Still try to initialize event
    initEventTab();
  });

  // ---------------------------------------------------------------------------
  // Event initialization (four-file load + render)
  // ---------------------------------------------------------------------------

  function initEventTab() {
    loadEventFourFiles(EVENT_FILES)
      .then(result => {
        if (!result) {
          clearEventTable();
          setEventStatus('No event data available.');
          return;
        }
        renderEventComputed(result.rows);
        enableSorting('eventTable');
        setEventStatus(`Loaded ${result.beforeCount.toLocaleString()} (before API) and ${result.nowCount.toLocaleString()} (now API); ${result.rows.length.toLocaleString()} racers with Δ races > 0.`);
      })
      .catch(err => {
        console.error('Event computation error:', err);
        clearEventTable();
        setEventStatus('Error loading event data.');
      });
  }

  // ---------------------------------------------------------------------------
  // Flexible fetcher: JSON array/object or NDJSON (one JSON object per line)
  // When allowEmpty is true: return { racers: [] } for 404/204
  // ---------------------------------------------------------------------------

  async function fetchJSONFlexible(url, allowEmpty = false) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        if (allowEmpty && (res.status === 404 || res.status === 204)) return { racers: [] };
        throw new Error(`${url}: HTTP ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      const trimmed = text.trim();
      if (!trimmed) return allowEmpty ? { racers: [] } : JSON.parse(''); // force catch for empty when not allowed

      const firstChar = trimmed[0];
      if (firstChar === '{' || firstChar === '[') {
        // JSON object/array
        return JSON.parse(trimmed);
      }

      // NDJSON fallback: split by lines and parse each line
      const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const arr = [];
      for (const line of lines) {
        try {
          arr.push(JSON.parse(line));
        } catch (e) {
          console.warn('Skipping bad NDJSON line:', line);
        }
      }
      return arr;
    } catch (e) {
      if (allowEmpty) return { racers: [] };
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Normalization helpers
  // ---------------------------------------------------------------------------

  // Normalize Data payload to { updatedAt, racers: [] }
  function normalizeData(payload) {
    if (Array.isArray(payload)) return { updatedAt: null, racers: payload };
    if (payload && Array.isArray(payload.racers)) return { updatedAt: payload.updatedAt || null, racers: payload.racers };
    return { updatedAt: null, racers: [] };
  }

  // Ensure we have an array (for API snapshots that may come in array or object)
  function toArray(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.racers)) return payload.racers;
    return [];
  }

  // Build an index (object) keyed by a computed key function
  function indexByKey(arr, keyFn) {
    const out = Object.create(null);
    for (const item of arr || []) {
      const key = keyFn(item);
      if (!key) continue;
      out[key] = item;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Render: Leaderboard (Data current)
  //
  // Columns (16):
  // 1 Rank, 2 Display Name, 3 Username, 4 Team Tag, 5 Title, 6 Total Races,
  // 7 Avg WPM, 8 Top WPM, 9 Profile Views, 10 Member Since, 11 Garage Cars,
  // 12 Membership, 13 Profile URL, 14 Nitros Used, 15 Longest Session, 16 League Tier
  // ---------------------------------------------------------------------------

  function renderLeaderboard(data) {
    const list = [...(data || [])].map(r => ({
      slug: String(r.username || ''),
      tag: String(r.tag || ''),
      title: String(r.title || ''),
      racesPlayed: safeNumber(r.racesPlayed),
      avgSpeed: safeNumber(r.avgSpeed),
      highestSpeed: safeNumber(r.highestSpeed),
      profileViews: safeNumber(r.profileViews),
      joinDate: String(r.joinDate || ''),
      garageCars: safeNumber(r.garageCars),
      membership: String(r.membership || ''),
      profileURL: String(r.profileURL || ''),
      nitrosUsed: safeNumber(r.nitrosUsed),
      longestSession: safeNumber(r.longestSession),
      leagueTier: safeNumber(r.leagueTier)
    }));

    list.sort((a, b) => b.racesPlayed - a.racesPlayed);

    const tbody = document.querySelector('#leaderboardTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();

    list.forEach((r, i) => {
      const tr = document.createElement('tr');
      const racerUrl = r.profileURL || ntRacerURL(r.slug);
      const teamUrl = r.tag ? ntTeamURL(r.tag) : '#';
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(racerUrl)}" target="_blank">${escapeHTML(prettyNameFromSlug(r.slug))}</a>
        </td>
        <td data-label="Username">${escapeHTML(r.slug)}</td>
        <td data-label="Team Tag">
          ${r.tag ? `<a class="tag-link" href="${escapeAttr(teamUrl)}" target="_blank">${escapeHTML(r.tag)}</a>` : '<span>-</span>'}
        </td>
        <td data-label="Title">${escapeHTML(r.title)}</td>
        <td data-label="Total Races">${r.racesPlayed.toLocaleString()}</td>
        <td data-label="Avg WPM">${r.avgSpeed.toLocaleString()}</td>
        <td data-label="Top WPM">${r.highestSpeed.toLocaleString()}</td>
        <td data-label="Profile Views">${r.profileViews.toLocaleString()}</td>
        <td data-label="Member Since">${escapeHTML(r.joinDate)}</td>
        <td data-label="Garage Cars">${r.garageCars.toLocaleString()}</td>
        <td data-label="Membership">${escapeHTML(r.membership || 'basic')}</td>
        <td data-label="Profile URL">
          ${r.profileURL ? `<a class="link-quiet" href="${escapeAttr(r.profileURL)}" target="_blank">${escapeHTML(r.profileURL)}</a>` : '<span>-</span>'}
        </td>
        <td data-label="Nitros Used">${r.nitrosUsed.toLocaleString()}</td>
        <td data-label="Longest Session">${r.longestSession.toLocaleString()}</td>
        <td data-label="League Tier">${r.leagueTier.toLocaleString()}</td>
      `.trim();
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
    setNote('leaderboardNote', `${list.length.toLocaleString()} racers loaded.`);
  }

  // ---------------------------------------------------------------------------
  // Render: Races Per Day (Data current)
  //
  // Columns (6):
  // 1 Rank, 2 Display Name, 3 Total Races, 4 Days Active, 5 Races / Day, 6 Member Since
  // ---------------------------------------------------------------------------

  function renderRacesPerDay(data) {
    const now = Date.now();
    const list = (data || []).map(r => {
      const parsed = parseLocalDate(r.joinDate);
      const joined = parsed.getTime();
      const days = Math.max(1, Math.floor((now - joined) / 86400000));
      const total = safeNumber(r.racesPlayed);
      return {
        slug: String(r.username || ''),
        total,
        days,
        perDay: total / days,
        joinDate: String(r.joinDate || '')
      };
    }).sort((a, b) => b.perDay - a.perDay);

    const tbody = document.querySelector('#racesPerDayTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();

    list.forEach((r, i) => {
      const racerUrl = ntRacerURL(r.slug);
      const name = prettyNameFromSlug(r.slug);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(racerUrl)}" target="_blank">${escapeHTML(name)}</a>
        </td>
        <td data-label="Total Races">${r.total.toLocaleString()}</td>
        <td data-label="Days Active">${r.days.toLocaleString()}</td>
        <td data-label="Races / Day">${r.perDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td data-label="Member Since">${escapeHTML(r.joinDate)}</td>
      `.trim();
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  }

  // ---------------------------------------------------------------------------
  // Render: 24-Hour-like diffs (Data current vs previous)
  //
  // Columns (6):
  // 1 Rank, 2 Display Name, 3 Δ Total Races, 4 Δ Top WPM, 5 Δ Profile Views, 6 Δ Nitros Used
  // ---------------------------------------------------------------------------

  function renderChanges24(currentRacers, prevMap) {
    const filtered = (currentRacers || []).filter(r => safeNumber(r.racesPlayed) > 0);

    const diffs = filtered.map(r => {
      const key = String(r.username || '').toLowerCase();
      const p = prevMap.get(key) || {};
      const dRaces = safeNumber(r.racesPlayed) - safeNumber(p.racesPlayed);
      const dTop = safeNumber(r.highestSpeed) - safeNumber(p.highestSpeed);
      const dViews = safeNumber(r.profileViews) - safeNumber(p.profileViews);
      const dNitro = safeNumber(r.nitrosUsed) - safeNumber(p.nitrosUsed);
      return {
        slug: String(r.username || ''),
        dRaces, dTop, dViews, dNitro
      };
    })
    .filter(d => d.dRaces !== 0 && d.dRaces < MAX_24H_RACES)
    .sort((a, b) => b.dRaces - a.dRaces);

    const tbody = document.querySelector('#changes24Table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();

    diffs.forEach((d, i) => {
      const tr = document.createElement('tr');
      const racerUrl = ntRacerURL(d.slug);
      const name = prettyNameFromSlug(d.slug);
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name"><a class="link-quiet" href="${escapeAttr(racerUrl)}" target="_blank">${escapeHTML(name)}</a></td>
        <td data-label="Δ Total Races">${formatDeltaInt(d.dRaces)}</td>
        <td data-label="Δ Top WPM">${formatDeltaInt(d.dTop)}</td>
        <td data-label="Δ Profile Views">${formatDeltaInt(d.dViews)}</td>
        <td data-label="Δ Nitros Used">${formatDeltaInt(d.dNitro)}</td>
      `.trim();
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
    setNote('dailyNote', `${diffs.length.toLocaleString()} racers with activity in the last snapshot window.`);
  }

  // ---------------------------------------------------------------------------
  // Event: load four files, compute period metrics, and render
  //
  // Output Columns (7):
  // 1 Rank, 2 Display Name, 3 Δ Total Races, 4 Avg WPM, 5 Avg Accuracy, 6 Δ Profile Views, 7 Δ Nitros Used
  // ---------------------------------------------------------------------------

  async function loadEventFourFiles(files) {
    const [apiBeforeRaw, apiNowRaw, dataBeforeRaw, dataNowRaw] = await Promise.all([
      fetchJSONFlexible(files.apiBefore, true), // NDJSON
      fetchJSONFlexible(files.apiNow, true),    // NDJSON
      fetchJSONFlexible(files.dataBefore, true),
      fetchJSONFlexible(files.dataNow, true)
    ]);

    // Normalize API (flat arrays) and Data (object or array)
    const apiBefore = toArray(apiBeforeRaw);
    const apiNow = toArray(apiNowRaw);
    const dataBefore = normalizeData(dataBeforeRaw).racers;
    const dataNow = normalizeData(dataNowRaw).racers;

    const beforeCount = apiBefore.length;
    const nowCount = apiNow.length;

    // Indexes by lowercase username (slug)
    const apiB = indexByKey(apiBefore, o => String(o.username || '').toLowerCase());
    const apiN = indexByKey(apiNow, o => String(o.username || '').toLowerCase());
    const dataB = indexByKey(dataBefore, o => String(o.username || '').toLowerCase());
    const dataN = indexByKey(dataNow, o => String(o.username || '').toLowerCase());

    // Union of all usernames seen across inputs
    const keys = new Set([
      ...Object.keys(apiB), ...Object.keys(apiN),
      ...Object.keys(dataB), ...Object.keys(dataN)
    ]);

    const rows = [];
    keys.forEach(k => {
      const aB = apiB[k] || {};
      const aN = apiN[k] || {};
      const dB = dataB[k] || {};
      const dN = dataN[k] || {};

      const slug = pickFirstNonEmpty([dN.username, dB.username, aN.username, aB.username], '');
      const displayName = pickFirstNonEmpty([aN.displayName, aB.displayName, dN.username, dB.username, slug], '');

      // Period races: prefer Data lifetime races delta; fallback to API lifetimeRaces delta
      const racesDeltaData = safeNumber(dN.racesPlayed) - safeNumber(dB.racesPlayed);
      const racesDeltaAPI = safeNumber(aN.lifetimeRaces) - safeNumber(aB.lifetimeRaces);
      const dRaces = (Number.isFinite(racesDeltaData) && racesDeltaData !== 0) ? racesDeltaData : racesDeltaAPI;
      if (dRaces <= 0) return; // only positive activity

      // Typed/errs deltas (API)
      const typedDelta = Math.max(0, safeNumber(aN.typed) - safeNumber(aB.typed));
      const errsDelta  = Math.max(0, safeNumber(aN.errs)  - safeNumber(aB.errs));

      // Accuracy (%) for period
      const acc = clamp(0, 100 * (typedDelta > 0 ? (1 - (errsDelta / typedDelta)) : 0), 100);

      // WPM (period): weighted by played deltas if available, else current avg
      const playedDelta = safeNumber(aN.played) - safeNumber(aB.played);
      let wpm;
      if (WPM_METHOD === 'weighted' && playedDelta > 0) {
        const num = safeNumber(aN.avgWpm) * safeNumber(aN.played) - safeNumber(aB.avgWpm) * safeNumber(aB.played);
        wpm = num / playedDelta;
      } else {
        wpm = safeNumber(aN.avgWpm);
      }
      if (!Number.isFinite(wpm) || wpm < 0) wpm = 0;

      // Profile Views delta (from Data snapshots)
      const viewsDelta = Math.max(0, safeNumber(dN.profileViews) - safeNumber(dB.profileViews));

      // Nitros delta (from Data snapshots)
      const nitrosDelta = Math.max(0, safeNumber(dN.nitrosUsed) - safeNumber(dB.nitrosUsed));

      rows.push({
        slug, displayName,
        dRaces, wpm, acc, viewsDelta, nitrosDelta
      });
    });

    // Default sort by Δ Total Races desc
    rows.sort((a, b) => b.dRaces - a.dRaces);

    return { beforeCount, nowCount, rows };
  }

  function renderEventComputed(rows) {
    const tbody = document.querySelector('#eventTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const racerUrl = ntRacerURL(r.slug);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(racerUrl)}" target="_blank">${escapeHTML(r.displayName)}</a>
        </td>
        <td data-label="Δ Total Races">${formatDeltaInt(r.dRaces)}</td>
        <td data-label="Avg WPM">${safeNumber(r.wpm).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
        <td data-label="Avg Accuracy">${safeNumber(r.acc).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
        <td data-label="Δ Profile Views">${formatDeltaInt(r.viewsDelta)}</td>
        <td data-label="Δ Nitros Used">${formatDeltaInt(r.nitrosDelta)}</td>
      `.trim();
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  // ---------------------------------------------------------------------------
  // Sorting, formatting, and DOM utilities
  // ---------------------------------------------------------------------------

  function enableSorting(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const thead = table.tHead || table.querySelector('thead');
    const tbody = table.tBodies[0] || table.querySelector('tbody');
    if (!thead || !tbody) return;

    const headers = Array.from(thead.querySelectorAll('th'));
    headers.forEach((th, idx) => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const currentDir = th.dataset.sortDir === 'asc' ? 'asc' : (th.dataset.sortDir === 'desc' ? 'desc' : null);
        // Reset all headers
        headers.forEach(h => { if (h !== th) delete h.dataset.sortDir; });
        const nextDir = currentDir === 'asc' ? 'desc' : 'asc';
        th.dataset.sortDir = nextDir;

        const rows = Array.from(tbody.querySelectorAll('tr'));
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

        rows.sort((a, b) => {
          const ta = extractCellValue(a, idx);
          const tb = extractCellValue(b, idx);
          const na = parseMaybeNumber(ta);
          const nb = parseMaybeNumber(tb);

          let cmp;
          if (Number.isFinite(na) && Number.isFinite(nb)) {
            cmp = na - nb;
          } else {
            cmp = collator.compare(ta, tb);
          }
          return nextDir === 'asc' ? cmp : -cmp;
        });

        // Re-append in sorted order
        for (const r of rows) tbody.appendChild(r);
      });
    });
  }

  function extractCellValue(tr, index) {
    const cell = tr.children[index];
    if (!cell) return '';
    // Extract text content without labels or links
    let value = cell.textContent || '';
    value = value.replace(/\s+/g, ' ').trim();
    // Remove thousands separators and % signs for numeric detection
    value = value.replace(/,/g, '');
    return value;
  }

  function parseMaybeNumber(value) {
    if (typeof value !== 'string') return NaN;
    // Allow +/- and decimals
    const cleaned = value.replace(/%$/, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
    }

  function setNote(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setEventStatus(text) {
    const el = document.getElementById('eventStatus');
    if (el) {
      el.textContent = text;
    } else {
      console.log('[Event Status]', text);
    }
  }

  function clearEventTable() {
    const tbody = document.querySelector('#eventTable tbody');
    if (tbody) tbody.innerHTML = '';
  }

  function showPageMessage(text, color = '#999') {
    const msg = document.createElement('p');
    msg.textContent = text;
    msg.style.color = color;
    msg.style.textAlign = 'center';
    document.body.appendChild(msg);
  }

  // ---------------------------------------------------------------------------
  // Math and safety helpers
  // ---------------------------------------------------------------------------

  function safeNumber(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  function clamp(min, v, max) {
    return Math.max(min, Math.min(max, v));
  }

  function pickFirstNonEmpty(arr, fallback = '') {
    for (const v of arr || []) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return v;
      }
    }
    return fallback;
  }

  function parseLocalDate(input) {
    // Try YYYY-MM-DD quickly; otherwise fall back to Date parse
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const [y, m, d] = input.split('-').map(s => parseInt(s, 10));
      // Months are zero-based
      const dt = new Date(y, m - 1, d, 12, 0, 0, 0); // noon to avoid TZ shifts
      return Number.isNaN(dt.getTime()) ? new Date() : dt;
    }
    const dt = new Date(input);
    return Number.isNaN(dt.getTime()) ? new Date() : dt;
  }

  // ---------------------------------------------------------------------------
  // Escaping and URL builders
  // ---------------------------------------------------------------------------

  function escapeHTML(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeAttr(str) {
    return escapeHTML(str);
  }

  function ntRacerURL(slug) {
    return `https://www.nitrotype.com/racer/${encodeURIComponent(slug)}`;
  }

  function ntTeamURL(tag) {
    return `https://www.nitrotype.com/team/${encodeURIComponent(tag)}`;
  }

  function prettyNameFromSlug(slug) {
    // Heuristic prettifier: split on underscores/dashes, capitalize words
    const s = String(slug || '').trim();
    if (!s) return '';
    return s
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : ''))
      .join(' ');
  }

  function formatDeltaInt(n) {
    const v = safeNumber(n);
    const sign = v > 0 ? '+' : (v < 0 ? '−' : '');
    const abs = Math.abs(v).toLocaleString();
    return `${sign}${abs}`;
  }
});
