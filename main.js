/* ============================================================================
   main.js — Unified Nitro Type Leaderboards (Long, Auditable, NDJSON-safe)
   - Uses ONLY the previously shared remote files (no local filenames)
   - Endpoints (raw GitHub) for:
       • API_before.ndjson
       • API_now.ndjson
       • BeforeEventData.json
       • AfterEventData.json
   - Renders four sections:
       1) Leaderboard (from AfterEventData.json)
       2) Races Per Day (from AfterEventData.json)
       3) 24-Hour Leaderboard (from API_before/now.ndjson)
       4) Event (Four-file merge: API_before/now + Data Before/After)
   - Robust JSON/NDJSON parser with graceful fallback
   - Weighted WPM and accuracy from typed/errs deltas
   - Points per race = 100 + (WPM/2) * (Accuracy/100), Total Points = Points * Δ Races
   - Sorting, status notes, and clean DOM rendering aligned with your index.html
   ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ---------------------------------------------------------------------------
  // Remote file URLs (raw.githubusercontent.com) — no local files are used.
  // ---------------------------------------------------------------------------
  const URLS = {
    API_BEFORE: 'https://raw.githubusercontent.com/Azrael131/nitro-type-top-1000/refs/heads/main/API_before.ndjson',
    API_NOW:    'https://raw.githubusercontent.com/Azrael131/nitro-type-top-1000/refs/heads/main/API_now.ndjson',
    DATA_BEFORE:'https://raw.githubusercontent.com/Azrael131/nitro-type-top-1000/refs/heads/main/BeforeEventData.json',
    DATA_NOW:   'https://raw.githubusercontent.com/Azrael131/nitro-type-top-1000/refs/heads/main/AfterEventData.json'
  };

  // ---------------------------------------------------------------------------
  // Configuration and thresholds
  // ---------------------------------------------------------------------------
  const CONFIG = {
    MAX_24H_RACES: 2600,               // anomaly cutoff for 24h delta
    EVENT_WPM_METHOD: 'weighted',      // 'weighted' | 'chars' (weighted by played (avgWpm*played))
    H24_WPM_METHOD: 'weighted',        // same options for 24h tab
    AVG_RACE_SECONDS: 28.47,           // used only for 'chars' fallback
    BAKE_ACCURACY_INTO_WPM: false      // if using 'chars', optionally fold accuracy into WPM (not recommended w/ points formula)
  };

  // ---------------------------------------------------------------------------
  // Tabs behavior (index.html tabs structure is already present)
  // ---------------------------------------------------------------------------
  const tabs = document.querySelectorAll('.tabs .tab');
  const sections = document.querySelectorAll('.table-container');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      const id = tab.dataset.target;
      const sec = document.getElementById(id);
      if (sec) sec.classList.add('active');
    });
  });

  // ---------------------------------------------------------------------------
  // Bootstrap: load sections in sequence for clean UX. All remote.
  // ---------------------------------------------------------------------------
  ;(async function init() {
    try {
      // Load Data Now (AfterEventData.json) for Leaderboard & Races/Day
      const dataNowRaw = await fetchJSONFlexible(URLS.DATA_NOW, true);
      const dataNow = normalizeData(dataNowRaw).racers;

      renderLeaderboard(dataNow);
      enableSorting('leaderboardTable');

      renderRacesPerDay(dataNow);
      enableSorting('racesPerDayTable');

      // Load 24h diffs from API NDJSON
      const [apiBeforeRaw, apiNowRaw] = await Promise.all([
        fetchJSONFlexible(URLS.API_BEFORE, true),
        fetchJSONFlexible(URLS.API_NOW, true)
      ]);
      const apiBefore = toArray(apiBeforeRaw);
      const apiNow = toArray(apiNowRaw);

      renderChanges24_fromAPI(apiBefore, apiNow);
      enableSorting('changes24Table');

      // Event (four files)
      await initEventTab(); // handles its own errors
    } catch (e) {
      console.error('Initialization error:', e);
      // Still attempt event, even if earlier parts failed
      await initEventTab();
    }
  })();

  // ---------------------------------------------------------------------------
  // Robust fetcher: JSON first, fallback to NDJSON line-by-line
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
      if (!trimmed) return allowEmpty ? { racers: [] } : [];

      // Try strict JSON first
      try {
        return JSON.parse(trimmed);
      } catch {
        // NDJSON fallback
        const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const arr = [];
        for (const line of lines) {
          try { arr.push(JSON.parse(line)); } catch { /* skip malformed lines */ }
        }
        if (arr.length > 0) return arr;
        if (allowEmpty) return { racers: [] };
        throw new Error(`Failed to parse ${url} as JSON or NDJSON`);
      }
    } catch (e) {
      if (allowEmpty) return { racers: [] };
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Normalizers and array helpers
  // ---------------------------------------------------------------------------
  function normalizeData(payload) {
    if (Array.isArray(payload)) return { updatedAt: null, racers: payload };
    if (payload && Array.isArray(payload.racers)) return { updatedAt: payload.updatedAt || null, racers: payload.racers };
    return { updatedAt: null, racers: [] };
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

  // ---------------------------------------------------------------------------
  // Leaderboard render (from Data Now)
  // Matches your table head in index.html: 13 columns
  // Rank, Display Name, Team Tag, Title, Total Races, Avg WPM, Top WPM,
  // Profile Views, Member Since, Garage Cars, Nitros Used, Longest Session, League Tier
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
      const racerUrl = ntRacerURL(r.slug);
      const teamUrl = r.tag ? ntTeamURL(r.tag) : '#';
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(racerUrl)}" target="_blank">${escapeHTML(prettyNameFromSlug(r.slug))}</a>
        </td>
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
  // Races Per Day (from Data Now)
  // Columns: Rank, Display Name, Total Races, Join Date, Days Active, Races / Day
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
        joinDate: String(r.joinDate || ''),
        days,
        perDay: total / days
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
        <td data-label="Join Date">${escapeHTML(r.joinDate)}</td>
        <td data-label="Days Active">${r.days.toLocaleString()}</td>
        <td data-label="Races / Day">${r.perDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      `.trim();
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  }

  // ---------------------------------------------------------------------------
  // 24-Hour Leaderboard — computed from API NDJSON (before vs now)
  // Columns (in your HTML): Rank, Display Name, Δ Total Races, Δ Top WPM, Δ Profile Views, Δ Nitros Used
  // We will compute deltas from API where available (views/nitros are not in API; left as 0).
  // If you want Data-based views/nitros deltas for daily, you could switch to Data snapshots here.
  // ---------------------------------------------------------------------------
  function renderChanges24_fromAPI(apiBeforeArr, apiNowArr) {
    // Index by username
    const aB = indexByKey(apiBeforeArr, o => String(o.username || '').toLowerCase());
    const aN = indexByKey(apiNowArr,    o => String(o.username || '').toLowerCase());
    const keys = new Set([...Object.keys(aB), ...Object.keys(aN)]);

    const diffs = [];
    keys.forEach(k => {
      const b = aB[k] || {};
      const n = aN[k] || {};
      const dRaces = safeNumber(n.lifetimeRaces) - safeNumber(b.lifetimeRaces);
      const dTop = safeNumber(n.highWpm) - safeNumber(b.highWpm);
      // API snapshots generally don't contain profileViews/nitrosUsed; set deltas to 0
      const dViews = 0;
      const dNitro = 0;

      if (dRaces !== 0 && dRaces < CONFIG.MAX_24H_RACES) {
        diffs.push({
          slug: String(n.username || b.username || ''),
          dRaces, dTop, dViews, dNitro
        });
      }
    });

    diffs.sort((a, b) => b.dRaces - a.dRaces);

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
  // Event tab — four-file merge with audited metrics
  // Columns in your HTML: Rank, Display Name, Team Tag, Δ Total Races, Avg WPM,
  // Avg Accuracy, Avg Points, Δ Nitros Used
  // Behavior:
  //  - Both API+Data: full metrics
  //  - API-only: no nitros delta (blank), rest from API
  //  - Data-only: Δ races and Δ nitros, WPM/Accuracy/Points blank
  // ---------------------------------------------------------------------------
  async function initEventTab() {
    const status = document.getElementById('eventStatus');
    if (status) status.textContent = 'Loading event…';

    try {
      const [apiBeforeRaw, apiNowRaw, dataBeforeRaw, dataNowRaw] = await Promise.all([
        fetchJSONFlexible(URLS.API_BEFORE, true),
        fetchJSONFlexible(URLS.API_NOW, true),
        fetchJSONFlexible(URLS.DATA_BEFORE, true),
        fetchJSONFlexible(URLS.DATA_NOW, true)
      ]);

      const apiBefore = toArray(apiBeforeRaw);
      const apiNow    = toArray(apiNowRaw);
      const dataBefore= normalizeData(dataBeforeRaw).racers;
      const dataNow   = normalizeData(dataNowRaw).racers;

      const result = computeEvent(apiBefore, apiNow, dataBefore, dataNow, CONFIG.EVENT_WPM_METHOD);

      renderEventComputed(result.rows);
      enableSorting('eventTable');

      if (status) {
        status.textContent =
          `Loaded API before ${result.beforeCount.toLocaleString()}, now ${result.nowCount.toLocaleString()}; ` +
          `Data before ${result.dataBeforeCount.toLocaleString()}, now ${result.dataNowCount.toLocaleString()}; ` +
          `${result.rows.length.toLocaleString()} racers with Δ races > 0.`;
      }
    } catch (e) {
      console.error('Event computation error:', e);
      clearEventTable();
      const status = document.getElementById('eventStatus');
      if (status) status.textContent = 'Error loading event data.';
    }
  }

  function computeEvent(apiBeforeArr, apiNowArr, dataBeforeArr, dataNowArr, method) {
    const aB = indexByKey(apiBeforeArr, o => String(o.username || '').toLowerCase());
    const aN = indexByKey(apiNowArr,    o => String(o.username || '').toLowerCase());
    const dB = indexByKey(dataBeforeArr,o => String(o.username || '').toLowerCase());
    const dN = indexByKey(dataNowArr,   o => String(o.username || '').toLowerCase());

    const keys = new Set([
      ...Object.keys(aB), ...Object.keys(aN),
      ...Object.keys(dB), ...Object.keys(dN)
    ]);

    const rows = [];
    keys.forEach(k => {
      const apiB = aB[k];
      const apiN = aN[k];
      const dataB = dB[k];
      const dataN = dN[k];
      const hasAPI = !!(apiB && apiN);
      const hasData = !!(dataB && dataN);

      // Identity
      const slug = pickFirstNonEmpty([dataN?.username, dataB?.username, apiN?.username, apiB?.username], k);
      const tag  = pickFirstNonEmpty([dataN?.tag, dataB?.tag, apiN?.teamTag, apiB?.teamTag], '');
      const displayName = pickFirstNonEmpty([apiN?.displayName, apiB?.displayName, dataN?.username, dataB?.username, slug], slug);

      // Δ Races: prefer Data if non-zero else API lifetimeRaces
      const dataDelta = hasData ? (safeNumber(dataN.racesPlayed) - safeNumber(dataB.racesPlayed)) : 0;
      const apiDelta  = hasAPI ? (safeNumber(apiN.lifetimeRaces) - safeNumber(apiB.lifetimeRaces)) : 0;
      const dRaces    = (hasData && dataDelta !== 0) ? dataDelta : apiDelta;

      if (dRaces <= 0) return;

      // Δ Nitros: from Data only
      const nitrosDelta = hasData ? Math.max(0, safeNumber(dataN.nitrosUsed) - safeNumber(dataB.nitrosUsed)) : null;

      // Accuracy from typed/errs deltas (API)
      let acc = null, wpm = null, points = null;
      let typedDelta = null, errsDelta = null, playedDelta = null;

      if (hasAPI) {
        typedDelta = Math.max(0, safeNumber(apiN.typed) - safeNumber(apiB.typed));
        errsDelta  = Math.max(0, safeNumber(apiN.errs)  - safeNumber(apiB.errs));
        if (typedDelta > 0) {
          acc = clamp(0, 100 * (1 - errsDelta / typedDelta), 100);
        }

        playedDelta = safeNumber(apiN.played) - safeNumber(apiB.played);
        if (method === 'weighted' && playedDelta > 0) {
          const num = safeNumber(apiN.avgWpm) * safeNumber(apiN.played) - safeNumber(apiB.avgWpm) * safeNumber(apiB.played);
          wpm = num / playedDelta;
          if (!Number.isFinite(wpm) || wpm < 0) wpm = 0;
        } else {
          // 'chars' fallback: estimate from typed and Δ races with average race time
          if (typedDelta > 0 && dRaces > 0) {
            const minutes = (CONFIG.AVG_RACE_SECONDS / 60) * dRaces;
            let est = (typedDelta / 5) / minutes;
            if (method === 'chars' && CONFIG.BAKE_ACCURACY_INTO_WPM && acc != null) {
              est = est * (acc / 100);
            }
            wpm = est;
          } else {
            // snapshot fallback
            wpm = safeNumber(apiN.avgWpm);
          }
        }

        if (wpm != null && acc != null) {
          points = 100 + (wpm / 2) * (acc / 100);
        }
      }

      rows.push({
        slug, tag, displayName,
        dRaces,
        wpm: wpm != null ? wpm : null,
        acc: acc != null ? acc : null,
        points: points != null ? points : null,
        nitrosDelta
      });
    });

    // Sort by Δ races desc by default (you can change to total points if you add that column)
    rows.sort((a, b) => b.dRaces - a.dRaces);

    return {
      beforeCount: apiBeforeArr.length,
      nowCount: apiNowArr.length,
      dataBeforeCount: dataBeforeArr.length,
      dataNowCount: dataNowArr.length,
      rows
    };
  }

  function renderEventComputed(rows) {
    const tbody = document.querySelector('#eventTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const racerUrl = ntRacerURL(r.slug);
      const teamUrl = r.tag ? ntTeamURL(r.tag) : '#';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Display Name">
          <a class="link-quiet" href="${escapeAttr(racerUrl)}" target="_blank">${escapeHTML(r.displayName)}</a>
        </td>
        <td data-label="Team Tag">
          ${r.tag ? `<a class="tag-link" href="${escapeAttr(teamUrl)}" target="_blank">${escapeHTML(r.tag)}</a>` : '<span>-</span>'}
        </td>
        <td data-label="Δ Total Races">${formatDeltaInt(r.dRaces)}</td>
        <td data-label="Avg WPM">${r.wpm != null ? safeNumber(r.wpm).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td>
        <td data-label="Avg Accuracy">${r.acc != null ? safeNumber(r.acc).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' : '—'}</td>
        <td data-label="Avg Points">${r.points != null ? safeNumber(r.points).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
        <td data-label="Δ Nitros Used">${r.nitrosDelta != null ? formatDeltaInt(r.nitrosDelta) : '—'}</td>
      `.trim();
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function clearEventTable() {
    const tbody = document.querySelector('#eventTable tbody');
    if (tbody) tbody.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Sorting (numeric-aware + rank renumbering). Works for all tables.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function ntRacerURL(username) {
    const slug = String(username || '').trim();
    return slug ? `https://www.nitrotype.com/racer/${encodeURIComponent(slug)}` : '#';
  }
  function ntTeamURL(tag) {
    const t = String(tag || '').trim();
    return t ? `https://www.nitrotype.com/team/${encodeURIComponent(t)}` : '#';
  }
  function prettyNameFromSlug(slug) {
    // Keep as-is; displayName is not guaranteed in Data snapshots
    return String(slug || '');
  }
  function safeNumber(x, dv = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : dv;
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
});
