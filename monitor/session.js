// Browser lifecycle and Seller Center login.
//
// The session lives in a persistent Chromium profile, so a login done once by
// hand (including 2FA) is reused by every later run. Scripted credentials are
// supported but Walmart challenges fresh automated logins often enough that
// the manual path is the reliable one.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { LOGIN_URL_PATTERN } = require('./sections');
const { withTimeout } = require('./util');
const { CURSOR_SCRIPT } = require('./cursor');

class LoginError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'LoginError';
    this.hint = hint;
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

class BrowserError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'BrowserError';
    this.hint = hint;
  }
}

// Which browser to drive, in order of preference. Downloading Playwright's own
// Chromium is a ~150MB fetch that firewalls and slow links often kill, so an
// already-installed Edge or Chrome is used when that copy is not there. Every
// Windows machine has Edge; most Macs have Chrome.
function launchStrategies(config) {
  if (config.browserPath) {
    return [{ label: `the browser at ${config.browserPath}`, options: { executablePath: config.browserPath } }];
  }
  if (config.browserChannel) {
    return [{ label: config.browserChannel, options: { channel: config.browserChannel } }];
  }
  return [
    { label: "Playwright's Chromium", options: {} },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    { label: 'Google Chrome', options: { channel: 'chrome' } }
  ];
}

async function openContext(config, { headless = config.headless, log = null } = {}) {
  fs.mkdirSync(config.userDataDir, { recursive: true });

  const baseOptions = {
    headless,
    slowMo: config.slowMoMs || undefined,
    viewport: { width: 1440, height: 900 },
    userAgent: USER_AGENT,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      // Keeps a multi-hour run from generating a steady trickle of browser
      // background traffic that has nothing to do with Seller Center.
      '--disable-background-networking',
      '--disable-component-update',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  };

  const attempts = [];
  for (const strategy of launchStrategies(config)) {
    try {
      const context = await chromium.launchPersistentContext(config.userDataDir, {
        ...baseOptions,
        ...strategy.options
      });
      if (log) log.info(`using ${strategy.label}`);
      if (config.showCursor) await context.addInitScript(CURSOR_SCRIPT);
      context.setDefaultTimeout(config.navTimeoutMs);
      context.setDefaultNavigationTimeout(config.navTimeoutMs);
      return context;
    } catch (err) {
      attempts.push(`${strategy.label}: ${err.message.split('\n')[0]}`);
    }
  }

  throw new BrowserError(
    `No usable browser was found. Tried — ${attempts.join(' | ')}`,
    'Install Google Chrome from https://www.google.com/chrome and start this again. ' +
      'Or, on a good connection, run: npx playwright install chromium'
  );
}

async function saveStorageState(context, config) {
  fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
  await context.storageState({ path: config.storageStatePath });
}

// Chromium drops cookies that carry no expiry date when the browser exits, and
// sign-in cookies are often exactly that. The browser profile alone therefore
// does not guarantee a session survives a restart, so the cookie jar is also
// saved to a file and put back when the profile turns out to be signed out.
async function restoreSavedCookies(context, config, log) {
  if (!fs.existsSync(config.storageStatePath)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(config.storageStatePath, 'utf8'));
    if (!saved.cookies || !saved.cookies.length) return false;
    await context.addCookies(saved.cookies);
    log.info(`restored ${saved.cookies.length} saved cookies from the last session`);
    return true;
  } catch (err) {
    log.warn(`could not restore the saved session: ${err.message}`);
    return false;
  }
}

// Whether a browser window can actually be shown to a person. On a headless
// server there is no display, so the manual sign-in prompt is pointless and the
// run should fail with an explanation instead of hanging.
function canShowWindow() {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  return true;
}

async function isLoginPage(page) {
  if (LOGIN_URL_PATTERN.test(page.url())) return true;
  return (await page.locator('input[type="password"]').count()) > 0;
}

async function looksChallenged(page) {
  const text = ((await withTimeout(page.textContent('body'), 10000, '')) || '').slice(0, 20000);
  return /verification code|two[- ]step|2fa|one[- ]time (code|passcode)|captcha|verify you are (a )?human|press and hold/i.test(text);
}

// Fills the Seller Center sign-in form. Selector lists are ordered most to
// least specific because Walmart has shipped several versions of this page.
async function scriptedLogin(page, config, log) {
  log.info('signing in with WALMART_SC_EMAIL');
  const emailField = page.locator('#loginUsername, input[name="loginUsername"], input[type="email"], input[name="email"]').first();
  await emailField.waitFor({ state: 'visible', timeout: config.navTimeoutMs });
  await emailField.fill(config.email);

  const passwordField = page.locator('#loginPassword, input[name="loginPassword"], input[type="password"]').first();
  if (!(await passwordField.isVisible().catch(() => false))) {
    await page.locator('button[type="submit"], button:has-text("Continue")').first().click();
    await passwordField.waitFor({ state: 'visible', timeout: config.navTimeoutMs });
  }
  await passwordField.fill(config.password);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Sign In")').first().click();

  await page.waitForLoadState('networkidle', { timeout: config.navTimeoutMs }).catch(() => {});

  if (await looksChallenged(page)) {
    throw new LoginError(
      'Sign-in hit a verification challenge (2FA / bot check) that cannot be answered automatically.',
      'Run `npm run monitor:login` to clear the challenge once by hand; the saved profile is then reused.'
    );
  }
  if (await isLoginPage(page)) {
    const message = await firstVisibleError(page);
    throw new LoginError(`Sign-in did not complete${message ? `: ${message}` : ' (still on the sign-in page).'}`,
      'Check WALMART_SC_EMAIL / WALMART_SC_PASSWORD, or sign in by hand with `npm run monitor:login`.');
  }
}

async function firstVisibleError(page) {
  const candidates = page.locator('[role="alert"], .alert, .error, [class*="error"]');
  const count = Math.min(await candidates.count().catch(() => 0), 5);
  for (let i = 0; i < count; i += 1) {
    const text = (await candidates.nth(i).innerText().catch(() => '')).trim();
    if (text) return text.replace(/\s+/g, ' ').slice(0, 200);
  }
  return null;
}

// Lands on the dashboard with an authenticated session, or throws LoginError.
async function ensureLoggedIn(page, config, log) {
  const response = await page.goto(config.baseUrl + '/', {
    waitUntil: 'domcontentloaded',
    timeout: config.navTimeoutMs
  });
  if (response && response.status() >= 500) {
    throw new LoginError(`Seller Center returned HTTP ${response.status()} on the dashboard.`,
      'Walmart may be having an outage — check status and retry.');
  }
  await page.waitForLoadState('networkidle', { timeout: config.navTimeoutMs }).catch(() => {});

  // Signed out, but a saved cookie jar may still be good — try it before
  // asking anyone to sign in again.
  if ((await isLoginPage(page)) && (await restoreSavedCookies(page.context(), config, log))) {
    await page.goto(config.baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: config.navTimeoutMs });
    await page.waitForLoadState('networkidle', { timeout: config.navTimeoutMs }).catch(() => {});
  }

  if (await isLoginPage(page)) {
    if (!config.email || !config.password) {
      // Nothing to type. The caller decides whether to open a window and ask.
      const err = new LoginError(
        'Not signed in, and no saved session was found.',
        'Sign in by hand once with `npm run monitor:login` — the session is reused after that. ' +
          'Or set WALMART_SC_EMAIL and WALMART_SC_PASSWORD in .env.'
      );
      err.needsInteractiveLogin = true;
      throw err;
    }
    await scriptedLogin(page, config, log);
    await page.goto(config.baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: config.navTimeoutMs });
    await page.waitForLoadState('networkidle', { timeout: config.navTimeoutMs }).catch(() => {});
    if (await isLoginPage(page)) {
      throw new LoginError('Still on the sign-in page after signing in.', 'The session is not sticking — sign in by hand with `npm run monitor:login`.');
    }
  }

  await saveStorageState(page.context(), config).catch(() => {});
  log.info(`signed in — dashboard reachable at ${page.url()}`);
  return true;
}

// Headed one-off: opens the browser and waits for a human to finish signing in.
async function interactiveLogin(config, log) {
  const context = await openContext(config, { headless: false, log });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.baseUrl + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  log.info('browser open — sign in to Seller Center (2FA included). Waiting…');
  const deadline = Date.now() + config.manualLoginTimeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (page.isClosed()) break;
    if (!(await isLoginPage(page).catch(() => true))) {
      await page.waitForTimeout(3000);
      if (!(await isLoginPage(page).catch(() => true))) {
        await saveStorageState(context, config);
        log.info(`session saved — profile: ${config.userDataDir}`);
        await context.close();
        return true;
      }
    }
  }
  await context.close();
  throw new LoginError('Timed out waiting for the manual sign-in to finish.', `Raise --loginTimeout (currently ${config.manualLoginTimeoutMs}ms) and try again.`);
}

module.exports = { openContext, ensureLoggedIn, interactiveLogin, isLoginPage, looksChallenged, saveStorageState, restoreSavedCookies, canShowWindow, LoginError, BrowserError };
