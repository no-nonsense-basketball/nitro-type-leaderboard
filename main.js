document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab');
  const sections = document.querySelectorAll('.table-container');
  const lastUpdatedSpan = document.querySelector('#lastUpdated span');

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
    });
  });

  // Load JSON data
  Promise.all([
    fetch('sample_data.json').then(r => r.json()),
    fetch('sample_data_prev.json').then(r => r.json()).catch(() => ({ racers: [] }))
  ])
  .then(([cur, prev]) => {
    const current = Array.isArray(cur) ? { updatedAt: null, racers: cur } : cur;
    const previous = Array.isArray(prev) ? { racers: prev } : prev;

    if (lastUpdatedSpan) {
      const ts = current.updatedAt ? new Date(current.updatedAt) : new Date();
      lastUpdatedSpan.textContent = ts.toLocaleString();
    }

    const prevMap = new Map((previous.racers || []).map(r => [r.username.toLowerCase(), r]));

    renderLeaderboard(current.racers);
    renderRacesPerDay(current.racers);
    renderChanges24(current.racers, prevMap);

    enableSorting('leaderboardTable');
    enableSorting('racesPerDayTable');
    enableSorting('changes24Table');
  })
  .catch(err => {
    console.error('Error loading data:', err);
    if (lastUpdatedSpan) lastUpdatedSpan.textContent = new Date().toLocaleString();
    const msg = document.createElement('p');
    msg.textContent = 'Error loading data – check console.';
    msg.style.color = '#ff5252';
    msg.style.textAlign = 'center';
    document.body.appendChild(msg);
  });

  function renderLeaderboard(data) {
    const tbody = document.querySelector('#leaderboardTable tbody');
    tbody.innerHTML = '';
    data.sort((a, b) => b.racesPlayed - a.racesPlayed).forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Username"><a href="${r.profileURL}" target="_blank">${r.username}</a></td>
        <td data-label="Team Tag">${r.tag}</td>
        <td data-label="Title">${r.title}</td>
        <td data-label="Total Races">${r.racesPlayed.toLocaleString()}</td>
        <td data-label="Avg WPM">${r.avgSpeed.toLocaleString()}</td>
        <td data-label="Top WPM">${r.highestSpeed.toLocaleString()}</td>
        <td data-label="Profile Views">${r.profileViews.toLocaleString()}</td>
        <td data-label="Member Since">${r.joinDate}</td>
        <td data-label="Garage Cars">${r.garageCars.toLocaleString()}</td>
        <td data-label="Profile URL"><a class="profile-link" href="${r.profileURL}" target="_blank">View Profile</a></td>
        <td data-label="Membership">${r.membership}</td>
        <td data-label="Nitros Used">${r.nitrosUsed.toLocaleString()}</td>
        <td data-label="Longest Session">${r.longestSession.toLocaleString()}</td>
        <td data-label="League Tier">${r.leagueTier.toLocaleString()}</td>
      `.trim();
      tbody.appendChild(tr);
    });
  }

  function renderRacesPerDay(data) {
    const tbody = document.querySelector('#racesPerDayTable tbody');
    tbody.innerHTML = '';
    const list = data.map(r => {
      const days = Math.max(1, Math.floor((Date.now() - new Date(r.joinDate).getTime()) / 86400000));
      return {
        ...r,
        days,
        perDay: r.racesPlayed / days
      };
    }).sort((a, b) => b.perDay - a.perDay);

    list.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Username"><a href="${r.profileURL}" target="_blank">${r.username}</a></td>
        <td data-label="Total Races">${r.racesPlayed.toLocaleString()}</td>
        <td data-label="Days Active">${r.days.toLocaleString()}</td>
        <td data-label="Races / Day">${r.perDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      `.trim();
      tbody.appendChild(tr);
    });
  }

  function renderChanges24(current, prevMap) {
    const tbody = document.querySelector('#changes24Table tbody');
    tbody.innerHTML = '';
    const diffs = current.map(r => {
      const p = prevMap.get(r.username.toLowerCase()) || {};
      return {
        username: r.username,
        profileURL: r.profileURL,
        dRaces: r.racesPlayed - (p.racesPlayed || 0),
        dAvg: r.avgSpeed - (p.avgSpeed || 0),
        dTop: r.highestSpeed - (p.highestSpeed || 0),
        dViews: r.profileViews - (p.profileViews || 0),
        dCars: r.garageCars - (p.garageCars || 0),
        dNitros: r.nitrosUsed - (p.nitrosUsed || 0),
        dSess: r.longestSession - (p.longestSession || 0),
        dTier: r.leagueTier - (p.leagueTier || 0)
      };
    }).sort((a, b) => b.dRaces - a.dRaces);

    diffs.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Rank">${i + 1}</td>
        <td data-label="Username"><a href="${r.profileURL}" target="_blank">${r.username}</a></td>
        <td data-label="ΔRaces">${r.dRaces.toLocaleString()}</td>
        <td data-label="ΔAvg WPM">${r.dAvg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td data-label="ΔTop WPM">${r.dTop.toLocaleString()}</td>
        <td data-label="ΔProfile Views">${r.dViews.toLocaleString()}</td>
        <td data-label="ΔGarage Cars">${r.dCars.toLocaleString()}</td>
        <td data-label="ΔNitros">${r.dNitros.toLocaleString()}</td>
        <td data-label="ΔLongest Session">${r.dSess.toLocaleString()}</td>
        <td data-label="ΔLeague Tier">${r.dTier.toLocaleString()}</td>
      `.trim();
      tbody.appendChild(tr);
    });
  }

  function enableSorting(tableId) {
    const table = document.getElementById(tableId);
    const headers = table.querySelectorAll('th');
    headers.forEach((th, idx) => {
      th.addEventListener('click', () => {
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const asc = !th.classList.contains('asc');
        rows.sort((a, b) => {
          const aText = a.children[idx].textContent.trim();
          const bText = b.children[idx].textContent.trim();
          const aNum = parseFloat(aText.replace(/,/g, ''));
          const bNum = parseFloat(bText.replace(/,/g, ''));
          return !isNaN(aNum) && !isNaN(bNum)
            ? (asc ? aNum - bNum : bNum - aNum)
            : (asc ? aText.localeCompare(bText) : bText.localeCompare(aText));
        });
        headers.forEach(h => h.classList.remove('asc', 'desc'));
        th.classList.add(asc ? 'asc' : 'desc');
        rows.forEach((row, i) => row.children[0].textContent = i + 1);
        tbody.innerHTML = '';
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }
});
