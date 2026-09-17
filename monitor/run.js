#!/usr/bin/env node
// Walmart Seller Center monitor.
//
//   node monitor/run.js login                 sign in once, by hand, and save the session
//   node monitor/run.js --hours=6             monitor for six hours
//   node monitor/run.js --continueOnError     log problems instead of stopping at the first one
//
// Each cycle walks Dashboard → Orders → Items → Payments → Performance →
// Advertising → Reports, returning to the dashboard between sections, and
// writes every result to monitor/logs/.

const { buildConfig } = require('./config');
const { loadSections } = require('./sections');
const { StatusLog } = require('./logger');
const { openContext, ensureLoggedIn, interactiveLogin, saveStorageState, canShowWindow, LoginError, BrowserError } = require('./session');
const { checkSection } = require('./check');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reportFailure(log, result) {
  const lines = [
    '',
    '='.repeat(72),
    'MONITORING STOPPED — a section is not healthy',
    '='.repeat(72),
    `  Section : ${result.section}`,
    `  Problem : ${result.kind}`,
    `  Error   : ${result.message}`,
    `  URL     : ${result.url || '-'}`,
    `  Cycle   : ${result.cycle}`,
    `  Time    : ${new Date().toISOString()}`
  ];
  if (result.status) lines.push(`  HTTP    : ${result.status}`);
  if (result.apiErrors && result.apiErrors.length) {
    lines.push(`  Failed requests: ${result.apiErrors.slice(0, 5).join('; ')}`);
  }
  if (result.artifacts && result.artifacts.screenshot) lines.push(`  Screenshot: ${result.artifacts.screenshot}`);
  if (result.artifacts && result.artifacts.html) lines.push(`  Page HTML : ${result.artifacts.html}`);
  lines.push('='.repeat(72), '');
  console.log(lines.join('\n'));
  log.error(`STOPPED on ${result.section}: ${result.kind} — ${result.message}`, { event: 'stop', ...result });
}

// A section is only declared broken after --retries re-checks, so a single
// blip does not end a multi-hour watch. The default is 0 (stop immediately).
async function checkWithRetries(page, section, config, log, cycle) {
  let result = await checkSection(page, section, config, log, cycle);
  for (let attempt = 1; attempt <= config.retries && !result.ok; attempt += 1) {
    log.warn(`${section.name}: ${result.kind} — ${result.message}; retry ${attempt}/${config.retries} in ${config.retryDelayMs}ms`, {
      event: 'retry', section: section.name, cycle, attempt, kind: result.kind
    });
    await sleep(config.retryDelayMs);
    result = await checkSection(page, section, config, log, cycle);
    if (result.ok) result.recoveredAfterRetries = attempt;
  }
  return result;
}

// Walking back to the dashboard between sections is part of the cycle, so a
// failure to get back there is itself a reportable problem.
async function returnToDashboard(page, dashboard, config, log, cycle) {
  const result = await checkWithRetries(page, { ...dashboard, name: 'Dashboard (return)' }, config, log, cycle);
  if (!result.ok) return result;
  log.info(`returned to dashboard (${result.durationMs}ms)`, { event: 'return', cycle });
  return null;
}

// Opens a signed-in browser. If there is no saved session and no credentials,
// and a window can be shown, it opens one and waits for the sign-in rather than
// telling the person to go run a different command first.
async function startSession(config, log) {
  let context = await openContext(config, { log });
  let page = context.pages()[0] || (await context.newPage());

  try {
    await ensureLoggedIn(page, config, log);
    return { context, page };
  } catch (err) {
    const canPrompt = err instanceof LoginError && err.needsInteractiveLogin && !config.noAutoLogin && canShowWindow();
    if (!canPrompt) {
      await context.close().catch(() => {});
      throw err;
    }

    log.info('no saved session — opening a browser window so you can sign in');
    await context.close().catch(() => {});
    await interactiveLogin(config, log);

    context = await openContext(config, { log });
    page = context.pages()[0] || (await context.newPage());
    try {
      await ensureLoggedIn(page, config, log);
    } catch (retryErr) {
      await context.close().catch(() => {});
      throw retryErr;
    }
    return { context, page };
  }
}

async function monitor(config, log) {
  const sections = loadSections(config);
  const dashboard = sections.find((s) => s.key === 'dashboard') || sections[0];
  const endsAt = Date.now() + config.hours * 3600000;

  log.info(`monitoring ${sections.map((s) => s.name).join(', ')}`, { event: 'start', sections: sections.map((s) => s.name) });
  log.info(`run ends at ${new Date(endsAt).toISOString()} (${config.hours}h), cycle pause ${config.cycleDelayMs}ms, retries=${config.retries}, stop-on-error=${!config.continueOnError}`);

  let { context, page } = await startSession(config, log);
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; log.warn('SIGINT received — finishing the current check and stopping'); });

  try {

    let cycle = 0;
    while (Date.now() < endsAt && !stopping) {
      cycle += 1;
      const cycleStarted = Date.now();
      log.cycleStart(cycle);

      for (const section of sections) {
        if (stopping || Date.now() >= endsAt) break;

        const result = await checkWithRetries(page, section, config, log, cycle);
        if (result.resolvedPath && !section.resolvedPath) section.resolvedPath = result.resolvedPath;
        log.check(result);

        if (!result.ok && !config.continueOnError) {
          reportFailure(log, result);
          log.finish('stopped', `${result.section}: ${result.kind} — ${result.message}`);
          return { stopped: true, result };
        }

        if (section.key !== dashboard.key) {
          const backFailure = await returnToDashboard(page, dashboard, config, log, cycle);
          if (backFailure) {
            log.check(backFailure);
            if (!config.continueOnError) {
              reportFailure(log, backFailure);
              log.finish('stopped', `${backFailure.section}: ${backFailure.kind} — ${backFailure.message}`);
              return { stopped: true, result: backFailure };
            }
          }
        }

        await sleep(config.sectionDelayMs);
      }

      log.cycleEnd(cycle, Date.now() - cycleStarted);
      await saveStorageState(context, config).catch(() => {});

      const pause = Math.min(config.cycleDelayMs, Math.max(0, endsAt - Date.now()));
      if (pause > 0 && !stopping) await sleep(pause);
    }

    log.finish(stopping ? 'stopped' : 'completed', stopping ? 'interrupted' : null);
    log.info(`run ${stopping ? 'interrupted' : 'complete'} — ${log.state.cycle} cycles, ${log.state.checks} checks, ${log.state.failures} failures`);
    return { stopped: false };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const config = buildConfig(argv);
  const log = new StatusLog(config);

  try {
    if (argv.includes('login')) {
      await interactiveLogin(config, log);
      log.finish('completed', 'interactive login');
      return 0;
    }
    const outcome = await monitor(config, log);
    return outcome.stopped ? 1 : 0;
  } catch (err) {
    if (err instanceof BrowserError) {
      console.log(`\n${'='.repeat(72)}\nCANNOT START — no browser to drive\n${'='.repeat(72)}`);
      console.log(`  Error   : ${err.message}`);
      if (err.hint) console.log(`  Fix     : ${err.hint}`);
      console.log(`${'='.repeat(72)}\n`);
      log.error(`no usable browser: ${err.message}`, { event: 'stop', kind: 'browser', hint: err.hint });
      log.finish('stopped', `browser: ${err.message}`);
      return 1;
    }
    if (err instanceof LoginError) {
      console.log(`\n${'='.repeat(72)}\nMONITORING STOPPED — login issue\n${'='.repeat(72)}`);
      console.log(`  Section : Login`);
      console.log(`  Error   : ${err.message}`);
      if (err.hint) console.log(`  Fix     : ${err.hint}`);
      console.log(`${'='.repeat(72)}\n`);
      log.error(`STOPPED on Login: ${err.message}`, { event: 'stop', section: 'Login', kind: 'login', message: err.message, hint: err.hint });
      log.finish('stopped', `Login: ${err.message}`);
      return 1;
    }
    log.error(`unexpected failure: ${err.stack || err.message}`, { event: 'crash' });
    log.finish('crashed', err.message);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { monitor, main };
