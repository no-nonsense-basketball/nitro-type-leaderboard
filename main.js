document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ============================================================
  // Config
  // ============================================================
  const MAX_24H_RACES = 2600; // anomaly cutoff for daily Δ races

  const EVENT_FILES = {
    apiBefore: 'API_before.json',
    apiNow: 'API_now.json',
    dataBefore: 'BeforeEventData.json',
    dataNow: 'AfterEventData.json'
  };

  const ENRICH_FROM_API_NOW = true; // use API_now to enrich display names and team tags
  const WPM_METHOD = 'weighted';    // 'weighted' or 'current'

  // ============================================================
  // DOM
  // ============================================================
  const tabs = document.querySelectorAll('.tab');
  const sections = document.querySelectorAll('.table-container');
  const lastUpdatedSpan = document.querySelector('#lastUpdated span');
  const lastUpdatedEl = lastUpdatedSpan || document.getElementById('lastUpdated');

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.target);
      if (target) target.classList.add('active');
    });
  });

  // ============================================================
  // Bootstrap: load current/prev Data and optional API_now enrich
  // ============================================================
  Promise.all([
    fetchJSONFlexible('sample_data.json'),
    fetchJSONFlexible('sample_data_prev.json', true), // allow empty
    ENRICH_FROM_API_NOW ? fetchJSONFlexible(EVENT_FILES.apiNow, true) : { racers: [] }
  ])
  .then(([curRaw, prevRaw, apiNowMaybe]) => {
    const current = normalizeData(curRaw);
    const previous = normalizeData(prevRaw);
    const apiNowArr = toArray(apiNowMaybe);

    // Last updated
    if (lastUpdatedEl) {
      const ts = current.updatedAt ? new Date(current.updatedAt) : new Date();
      if (lastUpdatedSpan) {
        lastUpdatedSpan.textContent = ts.toLocaleString();
      } else {
        lastUpdatedEl.textContent = `Last updated: ${ts.toLocaleString()}`;
      }
    }

    // Enrichment maps (username lowercase -> value)
    const displayNameMap = buildDisplayNameMap(apiNowArr);
    const teamTagMap = buildTeamTagMap(apiNowArr);

    // Prev map for diffs
    const prevMap = new Map((previous.racers || [])
      .map(r => [String(r.username || '').toLowerCase(), r]));

    // Render sections
    renderLeaderboard(current.racers, displayNameMap, teamTagMap);
    renderRacesPerDay(current.racers, displayNameMap);
    renderChanges24(current.racers, prevMap, displayNameMap);

    // Sorting
    enableSorting('leaderboardTable');
    enableSorting('racesPerDayTable');
    enableSorting('changes24Table');

    // Event tab init
    initEventTab();
  })
  .catch(err => {
    console.error('Error loading data:', err);
    if (lastUpdatedEl) {
      const ts = new Date().toLocaleString();
      if (lastUpdatedSpan) lastUpdatedSpan.textContent = ts;
      else lastUpdatedEl.textContent = `Last updated: ${ts}`;
    }
    const msg = document.createElement('p');
    msg.textContent = 'Error loading data – check console.';
    msg.style.color = '#ff5252';
    msg.style.textAlign = 'center';
    document.body.appendChild(msg);

    // Still try to bring up Event tab status
    initEventTab();
  });

  // ============================================================
  // Fetch helpers (JSON, object, or NDJSON)
  // ============================================================
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

      const first = trimmed[0];
      if (first === '{' || first === '[') return JSON.parse(trimmed);

      // NDJSON fallback
      const arr = [];
      trimmed.split(/\r?\n/).forEach(line => {
        const l = line.trim();
        if (!l) return;
        try { arr.push(JSON.parse(l)); } catch { /* skip bad line */ }
      });
      return arr;
    } catch (e) {
      if (allowEmpty) return { racers: [] };
      throw e;
    }
  }

  // ============================================================
  // Normalization and maps
  // ============================================================
  function normalizeData(payload) {
    if (Array.isArray(payload)) return { updatedAt: null, racers: payload };
    if (payload && Array.isArray(payload.racers)) return { updatedAt: payload.updatedAt || null, racers: payload.racers };
    return { updatedAt: null, racers: [] };
  }

  function toArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.racers)) return payload.racers;
    return [];
  }

  function buildDisplayNameMap(apiNowArray) {
    const map = new Map();
    for (const r of apiNowArray || []) {
      const u = String(r.username || '').toLowerCase();
      const dn = String(r.displayName || '').trim();
      if (u && dn) map.set(u, dn);
    }
    return map;
  }

  function buildTeamTagMap(apiNowArray) {
    const map = new Map();
    for (const r of apiNowArray || []) {
      const u = String(r.username || '').toLowerCase();
      const tg = String(r.teamTag || '').trim();
      if (u && tg) map.set(u, tg);
    }
    return map;
  }

  // ============================================================
  // Utils
  // ============================================================
  function safeNumber(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
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

  function parseLocalDate(input) {
    const raw = String(input || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-').map(n => parseInt(n, 10));
      const dt = new Date(y, m - 1, d);
      if (!isNaN(dt.getTime())) return dt;
    }
    const dt2 = new Date(raw);
    return isNaN(dt2.getTime()) ? new Date() : dt2;
  }

  function formatDeltaInt(n) {
    const v = safeNumber(n);
    return `${v > 0 ? '+' : ''}${v.toLocaleString()}`;
  }

  function formatPercent(v, min = 2, max = 2) {
    return `${safeNumber(v).toLocaleString(undefined, { minimumFractionDigits: min, maximumFractionDigits: max })}%`;
  }

  function formatFixed(v, min = 0, max = 2) {
    return safeNumber(v).toLocaleString(undefined, { minimumFractionDigits: min, maximumFractionDigits: max });
  }

  function ntRacerURL(username) {
    const slug = String(username || '').trim();
    return slug ? `https://www.nitrotype.com/racer/${encodeURIComponent(slug)}` : '#';
  }

  function ntTeamURL(tag) {
    const t = String(tag || '').trim();
    return t ? `https://www.nitrotype.com/team/${encodeURIComponent(t)}` : '#';
  }

  // ============================================================
  // Sorting (numeric-aware + rank renumbering)
  // ============================================================
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

  // ============================================================
  // Render: Leaderboard (Total snapshot)
  // Columns:
  // Rank | Display Name | Team Tag | Title | Total Races | Avg WPM |
  // Top WPM | Profile Views | Member Since | Garage Cars | Nitros Used |
  // Longest Session | League Tier
  // ============================================================
  function renderLeaderboard(data, displayNameMap, teamTagMap) {
    const list = [...(data || [])].map(r => {
      const slug = String(r.username || '');
      const key = slug.toLowerCase();
      const displayName = displayNameMap?.get(key) || slug;
      const tagEnrich = teamTagMap?.get(key) || '';
      const tag = String(r.tag || tagEnrich || '');
      return {
        slug,
        displayName,
        tag,
        title: String(r.title || ''),
        racesPlayed: safeNumber(r.racesPlayed),
        avgSpeed: safeNumber(r.avgSpeed),
        highestSpeed: safeNumber(r.highestSpeed),
        profileViews: safeNumber(r.profileViews),
        joinDate: String(r.joinDate || ''),
        garageCars: safeNumber(r.garageCars),
        nitrosUsed: safeNumber(r.nitrosUsed),
        longestSession: safeNumber(r.longestSession),
        leagueTier: safeNumber(r.leagueTier)
      };
    });

    list.sort((a, b) => b.racesPlayed - a.racesPlayed);

    const tbody = document.querySelector('#leaderboardTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();
    list.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(ntRacerURL(r.slug))}" target="_blank">${escapeHTML(r.displayName)}</a>
        </td>
        <td data-label="Team Tag">
          ${r.tag ? `<a class="tag-link" href="${escapeAttr(ntTeamURL(r.tag))}" target="_blank">${escapeHTML(r.tag)}</a>` : '<span>-</span>'}
        </td>
        <td data-label="Title">${escapeHTML(r.title)}</td>
        <td data-label="Total Races">${r.racesPlayed.toLocaleString()}</td>
        <td data-label="Avg WPM">${r.avgSpeed.toLocaleString()}</td>
        <td data-label="Top WPM">${r.highestSpeed.toLocaleString()}</td>
        <td data-label="Profile Views">${r.profileViews.toLocaleString()}</td>
        <td data-label="Member Since">${escapeHTML(r.joinDate)}</td>
        <td data-label="Garage Cars">${r.garageCars.toLocaleString()}</td>
        <td data-label="Nitros Used">${r.nitrosUsed.toLocaleString()}</td>
        <td data-label="Longest Session">${r.longestSession.toLocaleString()}</td>
        <td data-label="League Tier">${r.leagueTier.toLocaleString()}</td>
      `.trim();
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    const note = document.getElementById('leaderboardNote');
    if (note) note.textContent = `${list.length.toLocaleString()} racers loaded.`;
  }

  // ============================================================
  // Render: Races Per Day
  // ============================================================
  function renderRacesPerDay(data, displayNameMap) {
    const now = Date.now();
    const list = (data || []).map(r => {
      const slug = String(r.username || '');
      const key = slug.toLowerCase();
      const displayName = displayNameMap?.get(key) || slug;
      const joined = parseLocalDate(r.joinDate).getTime();
      const days = Math.max(1, Math.floor((now - joined) / 86400000));
      const total = safeNumber(r.racesPlayed);
      return { slug, displayName, total, days, perDay: total / days };
    }).sort((a, b) => b.perDay - a.perDay);

    const tbody = document.querySelector('#racesPerDayTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();
    list.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(ntRacerURL(r.slug))}" target="_blank">${escapeHTML(r.displayName)}</a>
        </td>
        <td data-label="Total Races">${r.total.toLocaleString()}</td>
        <td data-label="Days Active">${r.days.toLocaleString()}</td>
        <td data-label="Races / Day">${r.perDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      `.trim();
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    const note = document.getElementById('rpdNote');
    if (note) note.textContent = `${list.length.toLocaleString()} racers computed for lifetime average.`;
  }

  // ============================================================
  // Render: 24-Hour Leaderboard (daily diffs)
  // - Exclude current racers with total races == 0
  // - Filter Δ Total Races >= MAX_24H_RACES (anomaly) and Δ == 0
  // - Columns: Rank | Display Name | Δ Total Races | Δ Top WPM | Δ Profile Views | Δ Nitros Used
  // ============================================================
  function renderChanges24(currentRacers, prevMap, displayNameMap) {
    const filtered = (currentRacers || []).filter(r => safeNumber(r.racesPlayed) > 0);

    const diffs = filtered.map(r => {
      const key = String(r.username || '').toLowerCase();
      const p = prevMap.get(key) || {};
      return {
        slug: String(r.username || ''),
        displayName: displayNameMap?.get(key) || String(r.username || ''),
        dRaces: safeNumber(r.racesPlayed) - safeNumber(p.racesPlayed),
        dTop: safeNumber(r.highestSpeed) - safeNumber(p.highestSpeed),
        dViews: safeNumber(r.profileViews) - safeNumber(p.profileViews),
        dNitros: safeNumber(r.nitrosUsed) - safeNumber(p.nitrosUsed)
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
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(ntRacerURL(d.slug))}" target="_blank">${escapeHTML(d.displayName)}</a>
        </td>
        <td data-label="Δ Total Races">${formatDeltaInt(d.dRaces)}</td>
        <td data-label="Δ Top WPM">${formatDeltaInt(d.dTop)}</td>
        <td data-label="Δ Profile Views">${formatDeltaInt(d.dViews)}</td>
        <td data-label="Δ Nitros Used">${formatDeltaInt(d.dNitros)}</td>
      `.trim();
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    const note = document.getElementById('dailyNote');
    if (note) note.textContent = `${diffs.length.toLocaleString()} racers with activity in the last snapshot window.`;
  }

  // ============================================================
  // Event tab: four-file engine
  // ============================================================
  function initEventTab() {
    loadEventFourFiles(EVENT_FILES)
      .then(result => {
        if (!result || result.beforeCount === 0) {
          showEventComingSoon(true);
          clearEventTable();
          setEventStatus('Event BEFORE data missing or empty.');
          return;
        }
        showEventComingSoon(false);
        renderEventComputed(result.rows);
        enableSorting('eventTable');
        setEventStatus(
          `Loaded API_before: ${result.beforeCount.toLocaleString()} | API_now: ${result.nowCount.toLocaleString()} | ` +
          `Computed rows (Δ races > 0): ${result.rows.length.toLocaleString()}`
        );
      })
      .catch(err => {
        console.error('Event computation error:', err);
        showEventComingSoon(true);
        clearEventTable();
        setEventStatus('Error loading event data.');
      });
  }

  async function loadEventFourFiles(files) {
    const [apiBeforeRaw, apiNowRaw, dataBeforeRaw, dataNowRaw] = await Promise.all([
      fetchJSONFlexible(files.apiBefore, true),
      fetchJSONFlexible(files.apiNow, true),
      fetchJSONFlexible(files.dataBefore, true),
      fetchJSONFlexible(files.dataNow, true)
    ]);

    const apiBefore = toArray(apiBeforeRaw);
    const apiNow = toArray(apiNowRaw);
    const dataBefore = normalizeData(dataBeforeRaw).racers;
    const dataNow = normalizeData(dataNowRaw).racers;

    const beforeCount = apiBefore.length;
    const nowCount = apiNow.length;

    if (beforeCount === 0) {
      return { beforeCount, nowCount, rows: [] };
    }

    // Index by lowercase username
    const apiB = indexByKey(apiBefore, o => o.username);
    const apiN = indexByKey(apiNow, o => o.username);
    const dataB = indexByKey(dataBefore, o => o.username);
    const dataN = indexByKey(dataNow, o => o.username);

    // Union of keys
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
      const tag = pickFirstNonEmpty([dN.tag, dB.tag, aN.teamTag, aB.teamTag], '');
      const displayName = pickFirstNonEmpty([aN.displayName, aB.displayName, dN.username, dB.username, slug], '');

      // Δ races: prefer Data, fallback to API lifetime
      const racesDeltaData = safeNumber(dN.racesPlayed) - safeNumber(dB.racesPlayed);
      const racesDeltaAPI  = safeNumber(aN.lifetimeRaces) - safeNumber(aB.lifetimeRaces);
      const dRaces = (Number.isFinite(racesDeltaData) && racesDeltaData !== 0) ? racesDeltaData : racesDeltaAPI;
      if (dRaces <= 0) return;

      // Typed/errs deltas from API
      const typedDelta = Math.max(0, safeNumber(aN.typed) - safeNumber(aB.typed));
      const errsDelta  = Math.max(0, safeNumber(aN.errs)  - safeNumber(aB.errs));

      // Accuracy (%)
      const acc = clamp(0, 100 * (1 - (typedDelta > 0 ? errsDelta / typedDelta : 0)), 100);

      // WPM (weighted by played), fallback to current avgWpm
      const playedDelta = safeNumber(aN.played) - safeNumber(aB.played);
      let wpm;
      if (WPM_METHOD === 'weighted' && playedDelta > 0) {
        const weightedNumerator = safeNumber(aN.avgWpm) * safeNumber(aN.played) - safeNumber(aB.avgWpm) * safeNumber(aB.played);
        wpm = weightedNumerator / playedDelta;
      } else {
        wpm = safeNumber(aN.avgWpm);
      }
      if (!Number.isFinite(wpm) || wpm < 0) wpm = 0;

      // Points per race
      const points = 100 + (wpm / 2) * (acc / 100);

      // Mistakes per race
      const mistakesPerRace = errsDelta / Math.max(1, dRaces);

      // Δ nitros from Data
      const nitrosDelta = Math.max(0, safeNumber(dN.nitrosUsed) - safeNumber(dB.nitrosUsed));

      rows.push({
        slug, tag, displayName,
        dRaces,
        wpm,
        acc,
        points,
        mistakesPerRace,
        nitrosDelta
      });
    });

    rows.sort((a, b) => b.dRaces - a.dRaces);
    return { beforeCount, nowCount, rows };

    // Helpers for event scope
    function indexByKey(arr, keyFn) {
      const out = Object.create(null);
      for (const item of arr || []) {
        const k = String(keyFn(item) || '').toLowerCase();
        if (k) out[k] = item;
      }
      return out;
    }
    function pickFirstNonEmpty(arr, fallback) {
      for (const v of arr) {
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
      }
      return fallback;
    }
    function clamp(min, v, max) {
      return Math.max(min, Math.min(max, v));
    }
  }

  // ============================================================
  // Event render + UI helpers
  // ============================================================
  function renderEventComputed(rows) {
    const tbody = document.querySelector('#eventTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(ntRacerURL(r.slug))}" target="_blank">${escapeHTML(r.displayName)}</a>
        </td>
        <td data-label="Team Tag">
          ${r.tag ? `<a class="tag-link" href="${escapeAttr(ntTeamURL(r.tag))}" target="_blank">${escapeHTML(r.tag)}</a>` : '<span>-</span>'}
        </td>
        <td data-label="Δ Total Races">${formatDeltaInt(r.dRaces)}</td>
        <td data-label="Avg WPM">${formatFixed(r.wpm, 0, 2)}</td>
        <td data-label="Avg Accuracy">${formatPercent(r.acc, 2, 2)}</td>
        <td data-label="Avg Points">${formatFixed(r.points, 2, 2)}</td>
        <td data-label="Mistakes / Race">${formatFixed(r.mistakesPerRace, 2, 2)}</td>
        <td data-label="Δ Nitros Used">${formatDeltaInt(r.nitrosDelta)}</td>
      `.trim();
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function showEventComingSoon(show) {
    const note = document.getElementById('eventComingSoon');
    const table = document.getElementById('eventTable');
    if (!note || !table) return;
    if (show) {
      note.classList.remove('hidden');
      table.classList.add('hidden');
    } else {
      note.classList.add('hidden');
      table.classList.remove('hidden');
    }
  }

  function clearEventTable() {
    const tbody = document.querySelector('#eventTable tbody');
    if (tbody) tbody.innerHTML = '';
  }

  function setEventStatus(text) {
    const el = document.getElementById('eventStatus');
    if (el) el.textContent = text || '';
  }

  // Scoped helpers used above (clamp reused here)
  function clamp(min, v, max) { return Math.max(min, Math.min(max, v)); }
  function pickFirstNonEmpty(arr, fallback) {
    for (const v of arr) {
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return fallback;
  }
});
