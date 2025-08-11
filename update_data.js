/**
 * update_data.js
 *
 * - Runs at 8:00 PM America/Chicago every day
 * - Renames sample_data.json → sample_data_prev.json
 * - Fetches new stats from YOUR_DATA_SOURCE_URL
 * - Writes sample_data.json with:
 *     {
 *       updatedAt: "2025-08-10T20:00:00-05:00",
 *       racers: [ … ]
 *     }
 */

import fs      from 'fs/promises';
import fetch   from 'node-fetch';
import cron    from 'node-cron';
import path    from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = __dirname;
const SRC_URL   = 'https://your-data-source.example.com/top-1000'; 
// Replace with your real API endpoint

async function backupAndFetch() {
  try {
    const prevPath = path.join(DATA_DIR, 'sample_data.json');
    const oldPath  = path.join(DATA_DIR, 'sample_data_prev.json');
    // Rename current → prev (overwrite any existing prev)
    await fs.rename(prevPath, oldPath).catch(() => {});
    
    // Fetch fresh data
    const resp = await fetch(SRC_URL);
    if (!resp.ok) throw new Error(`Fetch error ${resp.status}`);
    const racers = await resp.json();
    if (!Array.isArray(racers)) {
      throw new Error('Expected JSON array of racers');
    }

    // Build payload with timestamp
    const now = new Date();
    const payload = {
      updatedAt: now.toISOString(),
      racers
    };

    // Write new sample_data.json
    await fs.writeFile(
      path.join(DATA_DIR, 'sample_data.json'),
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
    console.log(`[${now.toLocaleString()}] sample_data.json updated.`);
  } catch (err) {
    console.error('Auto-update failed:', err);
  }
}

// Schedule: at minute 0, hour 20 CST (America/Chicago)
cron.schedule('0 20 * * *', () => {
  console.log('Running daily update…');
  backupAndFetch();
}, {
  timezone: 'America/Chicago'
});

// If you want an immediate run on start uncomment below:
// backupAndFetch();
