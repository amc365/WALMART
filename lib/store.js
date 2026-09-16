const fs = require('fs');
const path = require('path');

// Approval queues are small but must survive a restart — Render restarts a
// service on every redeploy and whenever it wakes from idle, which previously
// wiped every staged and approved action without trace.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    // A corrupt file must not take the server down and must not be silently
    // discarded — move it aside so it can still be recovered by hand.
    const backup = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, backup); } catch { /* best effort */ }
    console.error(`[store] ${path.basename(file)} was unreadable (${err.message}); moved to ${path.basename(backup)}`);
    return [];
  }
}

function save(file, rows) {
  ensureDir();
  // Write-then-rename: a crash mid-write leaves the previous good file intact
  // rather than a half-written one.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * A tiny append-and-update store backed by one JSON file.
 * Sufficient for a single-user tool; swap for a real DB if this ever goes
 * multi-user.
 */
function createStore(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  let rows = load(file);

  return {
    all() {
      return rows;
    },
    add(item) {
      rows.push(item);
      save(file, rows);
      return item;
    },
    find(id) {
      return rows.find(r => r.id === id);
    },
    update(id, patch) {
      const row = rows.find(r => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      save(file, rows);
      return row;
    },
    // Test/support hook: re-read from disk.
    reload() {
      rows = load(file);
      return rows;
    },
    file
  };
}

module.exports = { createStore, DATA_DIR };
