// Opens one section, waits for it to settle, and decides whether it is healthy.

const fs = require('fs');
const { ERROR_PATTERNS, LOGIN_URL_PATTERN } = require('./sections');
const { withTimeout } = require('./util');
const { isLoginPage, looksChallenged } = require('./session');
const { moveAndClick } = require('./cursor');

const MIN_BODY_TEXT = 200;

// Records server-side failures on the page's own XHR calls. These do not fail
// the check on their own (Seller Center pages fire a lot of side requests) but
// they are logged so a degraded page is visible in the log.
function watchApiErrors(page) {
  const errors = [];
  const onResponse = (response) => {
    if (response.status() < 500) return;
    if (response.request().resourceType() === 'document') return;
    errors.push(`HTTP ${response.status()} ${response.url().split('?')[0]}`);
  };
  page.on('response', onResponse);
  return { errors, stop: () => page.off('response', onResponse) };
}

function hostAllowed(url, section, config) {
  try {
    const host = new URL(url).hostname;
    const base = new URL(config.baseUrl).hostname;
    if (host === base) return true;
    return (section.allowedHosts || []).some((rx) => rx.test(host));
  } catch {
    return false;
  }
}

function bodyProblem(text) {
  for (const { pattern, kind } of ERROR_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { kind, message: `page text matched "${match[0].trim()}"` };
  }
  return null;
}

const ARTIFACT_TIMEOUT_MS = 15000;

// Finds the section's link in the left-hand menu. Seller Center has shipped
// several nav markups, so several shapes are tried before giving up.
function navLink(page, navText) {
  const escaped = navText.replace(/"/g, '\\"');
  return [
    page.getByRole('navigation').getByRole('link', { name: navText, exact: true }),
    page.getByRole('link', { name: navText, exact: true }),
    page.locator(`nav a:text-is("${escaped}")`),
    page.locator(`a:text-is("${escaped}")`),
    page.locator(`[role="navigation"] :text-is("${escaped}")`),
    page.locator(`nav :text-is("${escaped}")`)
  ];
}

// Clicks the menu item and waits for the page behind it to settle. Returns
// false when no menu link matches, so the caller can fall back to a URL.
async function clickNavTo(page, section, config, log) {
  if (!config.clickNav || !section.navText) return false;

  for (const candidate of navLink(page, section.navText)) {
    const target = candidate.first();
    if (!(await target.isVisible().catch(() => false))) continue;
    try {
      await moveAndClick(page, target, { realCursor: config.realCursor, log });
      await page.waitForLoadState('domcontentloaded', { timeout: config.navTimeoutMs }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: config.navTimeoutMs }).catch(() => {});
      await page.waitForTimeout(config.settleMs);
      log.info(`clicked "${section.navText}" in the menu`, { event: 'nav-click', section: section.name });
      return true;
    } catch (err) {
      log.warn(`could not click "${section.navText}": ${err.message.split('\n')[0]}`, { event: 'nav-click-failed', section: section.name });
      return false;
    }
  }
  return false;
}

async function saveFailureArtifacts(page, log, section, cycle) {
  const artifacts = {};

  const shotPath = log.failureArtifactPath(section, cycle, 'png');
  const shot = await withTimeout(page.screenshot({ path: shotPath, fullPage: false, timeout: ARTIFACT_TIMEOUT_MS }), ARTIFACT_TIMEOUT_MS, null);
  if (shot) artifacts.screenshot = shotPath;

  const html = await withTimeout(page.content(), ARTIFACT_TIMEOUT_MS, null);
  if (html) {
    artifacts.html = log.failureArtifactPath(section, cycle, 'html');
    try { fs.writeFileSync(artifacts.html, html); } catch { delete artifacts.html; }
  }
  return artifacts;
}

// Returns { ok, kind, message, url, status, apiErrors, resolvedPath }.
async function checkSection(page, section, config, log, cycle) {
  const started = Date.now();
  const watcher = watchApiErrors(page);
  const paths = section.resolvedPath ? [section.resolvedPath] : section.paths;
  let last = null;

  try {
    // Preferred: click the section's own menu link. This uses whatever URL the
    // account actually has instead of one guessed here, and it is visible.
    if (await clickNavTo(page, section, config, log)) {
      const outcome = await judge(page, section, config, page.url(), null);
      outcome.via = 'menu click';
      outcome.section = section.name;
      outcome.cycle = cycle;
      outcome.durationMs = Date.now() - started;
      outcome.url = outcome.url || page.url();
      outcome.apiErrors = watcher.errors.slice(0, 10);
      if (!outcome.ok) outcome.artifacts = await saveFailureArtifacts(page, log, section.name, cycle);
      return outcome;
    }

    log.warn(`no "${section.navText}" link in the menu — falling back to a direct address`, { event: 'nav-fallback', section: section.name });

    for (const candidate of paths) {
      const url = candidate.startsWith('http') ? candidate : config.baseUrl + candidate;
      let response;
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navTimeoutMs });
      } catch (err) {
        // A hang or a transport error is a real problem with the site, not a
        // sign that this path is the wrong one, so report it rather than
        // falling through to a candidate that will 404 and mask it.
        const timedOut = /timeout/i.test(err.message);
        last = {
          ok: false,
          kind: timedOut ? 'timeout' : 'navigation',
          message: timedOut
            ? `navigation to ${url} did not complete within ${config.navTimeoutMs}ms`
            : `navigation to ${url} failed: ${err.message.split('\n')[0]}`,
          url
        };
        break;
      }

      const status = response ? response.status() : null;
      if (status === 404) {
        last = { ok: false, kind: 'not-found', message: `HTTP 404 at ${url}` };
        continue; // try the next candidate path
      }
      if (status === 401 || status === 403) {
        last = { ok: false, kind: 'access', message: `HTTP ${status} at ${url} — account lacks access or the session was rejected`, url, status };
        break;
      }
      if (status && status >= 500) {
        last = { ok: false, kind: 'http', message: `HTTP ${status} at ${url}`, url, status };
        break;
      }

      await page.waitForLoadState('networkidle', { timeout: config.navTimeoutMs }).catch(() => {});
      await page.waitForTimeout(config.settleMs);

      const finalUrl = page.url();
      const result = await judge(page, section, config, finalUrl, status);
      result.resolvedPath = candidate;
      last = result;
      if (result.ok || result.kind !== 'not-found') break; // only "not found" is worth another path
    }

    const outcome = last || { ok: false, kind: 'navigation', message: 'no candidate URL was reachable' };
    outcome.section = section.name;
    outcome.cycle = cycle;
    outcome.durationMs = Date.now() - started;
    outcome.url = outcome.url || page.url();
    outcome.apiErrors = watcher.errors.slice(0, 10);

    if (!outcome.ok) {
      outcome.artifacts = await saveFailureArtifacts(page, log, section.name, cycle);
    } else if (watcher.errors.length) {
      log.warn(`${section.name}: page rendered but ${watcher.errors.length} background request(s) failed — ${watcher.errors.slice(0, 3).join('; ')}`, {
        event: 'api-errors', section: section.name, cycle, apiErrors: watcher.errors.slice(0, 10)
      });
    }
    return outcome;
  } finally {
    watcher.stop();
  }
}

// Decides whether a loaded page counts as working.
async function judge(page, section, config, finalUrl, status) {
  if (LOGIN_URL_PATTERN.test(finalUrl) || (await isLoginPage(page))) {
    return { ok: false, kind: 'login', message: `redirected to a sign-in page (${finalUrl}) — the session expired or was rejected`, url: finalUrl, status };
  }
  if (await looksChallenged(page)) {
    return { ok: false, kind: 'bot-check', message: `a verification / bot challenge is blocking ${finalUrl}`, url: finalUrl, status };
  }
  if (!hostAllowed(finalUrl, section, config)) {
    return { ok: false, kind: 'redirect', message: `landed on an unexpected host: ${finalUrl}`, url: finalUrl, status };
  }

  const text = ((await withTimeout(page.textContent('body'), 15000, '')) || '').replace(/\s+/g, ' ').trim();
  const problem = bodyProblem(text);
  if (problem) {
    return { ok: false, kind: problem.kind, message: `${problem.message} at ${finalUrl}`, url: finalUrl, status };
  }
  if (text.length < MIN_BODY_TEXT) {
    return { ok: false, kind: 'empty', message: `page rendered only ${text.length} characters of text at ${finalUrl} — it did not finish loading`, url: finalUrl, status };
  }
  if (section.expect && !section.expect.test(text) && !section.expect.test(finalUrl)) {
    return { ok: false, kind: 'unexpected-content', message: `page loaded but nothing matching ${section.expect} was found at ${finalUrl}`, url: finalUrl, status };
  }
  return { ok: true, kind: 'ok', message: 'page loaded', url: finalUrl, status };
}

module.exports = { checkSection };
