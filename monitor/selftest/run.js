#!/usr/bin/env node
// Drives the monitor against the mock Seller Center and asserts that each
// failure mode is detected and reported. Run with: npm run monitor:selftest

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.SELFTEST_PORT || 4321);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { name: 'healthy run completes', fault: {}, args: ['--hours=0.006'], expectExit: 0, expectFailures: 0 },
  { name: 'page error is caught', fault: { FAULT_SECTION: 'payments', FAULT_MODE: 'error' }, expectExit: 1, expectKind: 'page-error', expectSection: 'Payments' },
  { name: 'HTTP 403 is caught', fault: { FAULT_SECTION: 'payments', FAULT_MODE: '403' }, expectExit: 1, expectKind: 'access', expectSection: 'Payments' },
  { name: 'HTTP 500 is caught', fault: { FAULT_SECTION: 'orders', FAULT_MODE: '500' }, expectExit: 1, expectKind: 'http', expectSection: 'Orders' },
  { name: 'lost session is caught', fault: { FAULT_SECTION: 'payments', FAULT_MODE: 'logout' }, expectExit: 1, expectKind: 'login', expectSection: 'Payments' },
  { name: 'missing page is caught', fault: { FAULT_SECTION: 'payments', FAULT_MODE: '404' }, expectExit: 1, expectKind: 'not-found', expectSection: 'Payments' },
  { name: 'blank page is caught', fault: { FAULT_SECTION: 'reports', FAULT_MODE: 'empty' }, expectExit: 1, expectKind: 'empty', expectSection: 'Reports' },
  { name: 'hung page is caught', fault: { FAULT_SECTION: 'catalog', FAULT_MODE: 'timeout' }, expectExit: 1, expectKind: 'timeout', expectSection: 'Catalog' },
  {
    // The sign-in cookie has no expiry, so the browser drops it on exit. This
    // asserts the saved cookie jar carries the session into the next run —
    // otherwise "sign in once" silently becomes "sign in every time".
    name: 'session survives a restart without credentials',
    fault: {}, args: ['--hours=0.004'], secondRunWithoutCredentials: true,
    expectExit: 0, expectFailures: 0
  },
  {
    name: 'transient fault recovers on retry',
    fault: { FAULT_SECTION: 'reports', FAULT_MODE: 'error', FAULT_AFTER: '1', FAULT_UNTIL: '1' },
    args: ['--hours=0.006', '--retries=2', '--retryDelay=1000'],
    expectExit: 0, expectFailures: 0
  }
];

function startMock(fault) {
  const child = spawn(process.execPath, [path.join(__dirname, 'mock-server.js')], {
    env: { ...process.env, PORT: String(PORT), ...fault },
    stdio: 'ignore'
  });
  return child;
}

function runMonitor(logDir, profileDir, extraArgs, withCredentials = true) {
  return new Promise((resolve) => {
    const args = [
      path.join(__dirname, '..', 'run.js'),
      `--baseUrl=${BASE}`,
      '--hours=0.02', '--cycleDelay=500', '--sectionDelay=100', '--settle=200', '--navTimeout=8000',
      `--logDir=${logDir}`, `--userDataDir=${profileDir}`,
      ...(extraArgs || [])
    ];
    const credentials = withCredentials
      ? { WALMART_SC_EMAIL: 'selftest@example.com', WALMART_SC_PASSWORD: 'selftest' }
      : { WALMART_SC_EMAIL: '', WALMART_SC_PASSWORD: '' };
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...credentials },
      stdio: 'ignore'
    });
    child.on('exit', (code) => resolve(code));
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-monitor-selftest-'));
  let failed = 0;

  for (const testCase of CASES) {
    const mock = startMock(testCase.fault);
    await sleep(1500);
    const logDir = path.join(tmp, testCase.name.replace(/\W+/g, '-'), 'logs');
    const profileDir = path.join(tmp, testCase.name.replace(/\W+/g, '-'), 'profile');

    let exitCode = await runMonitor(logDir, profileDir, testCase.args);
    if (testCase.secondRunWithoutCredentials) {
      // Same browser profile, no credentials: it must get in on the saved session.
      exitCode = await runMonitor(logDir, profileDir, testCase.args, false);
    }
    mock.kill();
    await sleep(500);

    const snapshot = JSON.parse(fs.readFileSync(path.join(logDir, 'status.json'), 'utf8'));
    const problems = [];
    if (exitCode !== testCase.expectExit) problems.push(`exit ${exitCode}, expected ${testCase.expectExit}`);
    if (testCase.expectFailures !== undefined && snapshot.failures !== testCase.expectFailures) {
      problems.push(`${snapshot.failures} failures, expected ${testCase.expectFailures}`);
    }
    if (testCase.expectKind && !String(snapshot.stoppedReason).includes(testCase.expectKind)) {
      problems.push(`stop reason "${snapshot.stoppedReason}" does not mention "${testCase.expectKind}"`);
    }
    if (testCase.expectSection && !String(snapshot.stoppedReason).startsWith(testCase.expectSection)) {
      problems.push(`stop reason "${snapshot.stoppedReason}" does not name ${testCase.expectSection}`);
    }

    if (problems.length) {
      failed += 1;
      console.log(`FAIL  ${testCase.name}\n      ${problems.join('\n      ')}`);
    } else {
      console.log(`PASS  ${testCase.name}${snapshot.stoppedReason ? ` — ${snapshot.stoppedReason}` : ''}`);
    }
  }

  console.log(`\n${CASES.length - failed}/${CASES.length} self-tests passed`);
  process.exit(failed ? 1 : 0);
}

main();
