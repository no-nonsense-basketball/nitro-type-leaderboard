// main.js
document.addEventListener('DOMContentLoaded', () => {
  // Constants
  const MAX_24H_RACES = 2600; // anomaly cutoff
  const EVENT_FILES = {
    apiBefore: 'API_before.json',
    apiNow: 'API_now.json',
    dataBefore: 'BeforeEventData.json',
    dataNow: 'AfterEventData.json'
  };
  const WPM_METHOD = 'weighted'; // 'weighted' | 'current'

  // Tabs
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

  // Fetch main snapshots (Data current/previous)
  Promise.all([
    fetchJSONFlexible('sample_data.json'),               // current data
    fetchJSONFlexible('sample_data_prev.json', true)     // previous data (optional)
  ])
  .then(([curData, prevData]) => {
    const cur = normalizeData(curData);
    const prev = normalizeData(prevData);

    // Leaderboard + RacesPerDay
    renderLeaderboard(cur.racers);
    enableSorting('leaderboardTable');

    renderRacesPerDay(cur.racers);
    enableSorting('racesPerDayTable');

    // 24-hour diffs (from Data)
    const prevMap = new Map((prev.racers || []).map(r => [String(r.username || '').toLowerCase(), r]));
    renderChanges24(cur.racers, prevMap);
    enableSorting('changes24Table');

    // Event (four files)
    initEventTab();
  })
  .catch(err => {
    console.error('Failed loading main snapshots:', err);
    const msg = document.createElement('p');
    msg.textContent = 'Error loading main snapshots – check console.';
    msg.style.color = '#ff5c5c';
    msg.style.textAlign = 'center';
    document.body.appendChild(msg);
    initEventTab(); // still attempt event
  });

  // Event initialization
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

  // Files: flexible JSON (supports JSON array, object with racers, or NDJSON lines)
  async function fetchJSONFlexible(url, allowEmpty = false) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        if (allowEmpty && (res.status === 404 || res.status === 204)) return { racers: [] };
        throw new Error(`${url}: HTTP ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      const trimmed = text.trim();
      if (!trimmed) return allowEmpty ? { racers: [] } : JSON.parse(''); // force catch
      const firstChar = trimmed[0];

      if (firstChar === '{' || firstChar === '[') {
        // Regular JSON
        return JSON.parse(trimmed);
      }

      // NDJSON fallback
      const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const arr = [];
      for (const line of lines) {
        try {
          arr.push(JSON.parse(line));
        } catch (e) {
          // skip bad lines
        }
      }
      return arr;
    } catch (e) {
      if (allowEmpty) return { racers: [] };
      throw e;
    }
  }

  // Normalize: { updatedAt, racers } | [ ... ] -> { updatedAt, racers: [] }
  function normalizeData(payload) {
    if (Array.isArray(payload)) return { updatedAt: null, racers: payload };
    if (payload && Array.isArray(payload.racers)) return { updatedAt: payload.updatedAt || null, racers: payload.racers };
    return { updatedAt: null, racers: [] };
  }

  // Leaderboard render (Data current) — 16 columns to align with CSS
  // 1 Rank, 2 Display Name, 3 Username, 4 Team Tag, 5 Title, 6 Total Races,
  // 7 Avg WPM, 8 Top WPM, 9 Profile Views, 10 Member Since, 11 Garage Cars,
  // 12 Membership, 13 Profile URL, 14 Nitros Used, 15 Longest Session, 16 League Tier
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

  // Races Per Day (Data current) — 6 columns to align with CSS
  // 1 Rank, 2 Display Name, 3 Total Races, 4 Days Active, 5 Races / Day, 6 Member Since
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

  // 24-Hour diffs (Data current vs previous) — 6 columns
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

  // Event: load four files and compute period metrics (7-column render)
  // 1 Rank, 2 Display Name, 3 Δ Total Races, 4 Avg WPM, 5 Avg Accuracy, 6 Δ Profile Views, 7 Δ Nitros Used
  async function loadEventFourFiles(files) {
    const [apiBeforeRaw, apiNowRaw, dataBeforeRaw, dataNowRaw] = await Promise.all([
      fetchJSONFlexible(files.apiBefore, true),
      fetchJSONFlexible(files.apiNow, true),
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

      // Accuracy (%)
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

  // UI helpers
  function clearEventTable() {
    const tbody = document.querySelector('#eventTable tbody');
    if (tbody) tbody.innerHTML = '';
  }
  function setEventStatus(text) {
    const el = document.getElementById('eventStatus');
    if (el) el.textContent = text || '';
  }
  function setNote(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }

  // Sorting (numeric-aware + rank renumbering)
  function enableSorting(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const headers = table.querySelectorAll('th');
    headers.forEach((th, idx) => {
      th.addEventListener('click', () => {
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const asc = !th.classList.contains('asc');

        rows.sort((a, b) => {
          const aText = (a.children[idx]?.textContent || '').trim();
          const bText = (b.children[idx]?.textContent || '').trim();
          const aNum = parseFloat(aText.replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
          const bNum = parseFloat(bText.replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
          if (!isNaN(aNum) && !isNaN(bNum)) return asc ? aNum - bNum : bNum - aNum;
          return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
        });

        headers.forEach(h => h.classList.remove('asc', 'desc'));
        th.classList.add(asc ? 'asc' : 'desc');

        rows.forEach((row, i) => {
          if (row.children[0]) row.children[0].textContent = i + 1;
        });

        tbody.innerHTML = '';
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }

  // Utilities
  function ntRacerURL(username) {
    const slug = String(username || '').trim();
    return slug ? `https://www.nitrotype.com/racer/${encodeURIComponent(slug)}` : '#';
  }
  function ntTeamURL(tag) {
    const t = String(tag || '').trim();
    return t ? `https://www.nitrotype.com/team/${encodeURIComponent(t)}` : '#';
  }
  function prettyNameFromSlug(slug) {
    return String(slug || '');
  }
  function safeNumber(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  function clamp(min, v, max) {
    return Math.max(min, Math.min(max, v));
  }
  function parseLocalDate(input) {
    const raw = String(input || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-').map(n => parseInt(n, 10));
      const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
      if (!isNaN(dt.getTime())) return dt;
    }
    const dt2 = new Date(raw);
    if (!isNaN(dt2.getTime())) return dt2;
    return new Date();
  }
  function escapeHTML(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return escapeHTML(s).replace(/"/g, '&quot;');
  }
  function formatDeltaInt(n) {
    const v = safeNumber(n);
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toLocaleString()}`;
  }
  function toArray(maybeArray) {
    if (Array.isArray(maybeArray)) return maybeArray;
    if (maybeArray && typeof maybeArray === 'object' && Array.isArray(maybeArray.racers)) return maybeArray.racers;
    return [];
  }
  function indexByKey(arr, keyFn) {
    const out = Object.create(null);
    for (const item of arr || []) {
      const k = String(keyFn(item) || '').toLowerCase();
      if (!k) continue;
      out[k] = item;
    }
    return out;
  }
  function pickFirstNonEmpty(arr, fallback) {
    for (const v of arr) {
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return fallback;
  }
});
