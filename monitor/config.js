// Runtime configuration for the Seller Center monitor.
// Everything is overridable from the CLI or the environment so the same
// script can run a 10-minute smoke test or an 8-hour babysit.

const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, value] = raw.slice(2).split('=');
    args[key] = value === undefined ? 'true' : value;
  }
  return args;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined) return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function buildConfig(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const env = process.env;
  const root = path.join(__dirname);
  const userDataDir = args.userDataDir || env.MONITOR_USER_DATA_DIR || path.join(root, '.session', 'profile');

  return {
    baseUrl: (args.baseUrl || env.WALMART_SC_BASE_URL || 'https://seller.walmart.com').replace(/\/+$/, ''),

    // How long the whole monitoring run lasts, and how it is paced.
    hours: num(args.hours, num(env.MONITOR_HOURS, 4)),
    cycleDelayMs: num(args.cycleDelay, num(env.MONITOR_CYCLE_DELAY_MS, 60000)),
    sectionDelayMs: num(args.sectionDelay, num(env.MONITOR_SECTION_DELAY_MS, 3000)),

    // Per-section patience.
    navTimeoutMs: num(args.navTimeout, num(env.MONITOR_NAV_TIMEOUT_MS, 45000)),
    settleMs: num(args.settle, num(env.MONITOR_SETTLE_MS, 2500)),

    // Stop on the first problem (what the task asks for) unless told otherwise.
    stopOnError: bool(args.continueOnError, false) === false ? bool(args.stopOnError, true) : false,
    continueOnError: bool(args.continueOnError, false),

    headless: bool(args.headed, false) ? false : bool(env.MONITOR_HEADLESS, true),
    slowMoMs: num(args.slowMo, 0),

    // Chromium binary. Playwright's own download is used unless overridden
    // (some CI images ship a pre-installed browser at a fixed path).
    browserPath: args.browserPath || env.MONITOR_BROWSER_PATH || null,
    // An installed browser to drive instead: 'msedge' or 'chrome'.
    browserChannel: args.channel || env.MONITOR_BROWSER_CHANNEL || null,

    // Draw a pointer in the page and click the menu rather than jumping
    // straight to URLs, so the run can be followed by eye.
    showCursor: bool(args.showCursor, true),
    // Move the operating system's real pointer too (Windows only).
    realCursor: bool(args.realCursor, false),
    clickNav: bool(args.clickNav, true),

    // Login. A saved session is strongly preferred over scripted credentials
    // because Seller Center challenges new sessions with 2FA. The cookie jar
    // lives beside the browser profile it came from, so two different profiles
    // never borrow each other's sign-in.
    userDataDir,
    storageStatePath: args.storageState || env.MONITOR_STORAGE_STATE || path.join(path.dirname(userDataDir), 'storage-state.json'),
    email: env.WALMART_SC_EMAIL || null,
    password: env.WALMART_SC_PASSWORD || null,
    manualLoginTimeoutMs: num(args.loginTimeout, num(env.MONITOR_LOGIN_TIMEOUT_MS, 300000)),

    // Re-check a failing section before declaring it broken. Default 0 keeps
    // the strict "stop at the first problem" behaviour; 1 or 2 is useful on a
    // long run where a single blip should not end the watch.
    // Set when the run must never pause for a human (a server, a cron job).
    noAutoLogin: bool(args.noAutoLogin, false),

    retries: num(args.retries, num(env.MONITOR_RETRIES, 0)),
    retryDelayMs: num(args.retryDelay, num(env.MONITOR_RETRY_DELAY_MS, 5000)),

    logDir: args.logDir || env.MONITOR_LOG_DIR || path.join(root, 'logs'),
    sectionsFile: args.sections || env.MONITOR_SECTIONS_FILE || null,
    only: args.only ? args.only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null
  };
}

module.exports = { buildConfig, parseArgs };
