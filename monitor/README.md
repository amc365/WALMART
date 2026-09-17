# Seller Center monitor

A browser agent that signs in to Walmart Seller Center and walks the same
rounds over and over: **Dashboard → Orders → Items → Payments → Performance →
Advertising → Reports**, returning to the dashboard between sections. Every
check is written to a status log. The first unhealthy page stops the run and
prints the section name and the error.

It drives a real Chromium through Playwright, so it sees what you would see —
not what an API reports.

## Setup

```bash
npm install
npx playwright install chromium     # once, unless a browser is already installed
```

Non-technical setup lives in `../START-HERE.md` (double-click launchers for Mac
and Windows). This file is the reference.

## Sign in once

Seller Center challenges fresh automated logins with 2FA, so the reliable path
is to sign in by hand a single time. The session is saved to a browser profile
(`monitor/.session/`, gitignored) and reused by every later run:

```bash
npm run monitor:login
```

A browser window opens. Sign in, clear any verification step, and the script
saves the session and exits.

Or just run `npm run monitor` — with no saved session and no credentials it
opens the sign-in window for you, then carries on monitoring once you are in.
(`--noAutoLogin` disables that, for unattended servers that must never block.)

The session is kept two ways: the browser profile itself, and a saved cookie jar
beside it (`storage-state.json`). The jar matters — sign-in cookies frequently
carry no expiry date, so Chromium discards them on exit and the profile alone
would make you sign in on every run.

Scripted login also works if your account allows it — set `WALMART_SC_EMAIL`
and `WALMART_SC_PASSWORD` in `.env`. If Walmart answers with a verification
challenge, the run stops and tells you to use `monitor:login` instead.

## Monitor

```bash
npm run monitor                    # 4 hours, one cycle per minute
npm run monitor -- --hours=8       # run longer
npm run monitor -- --headed        # watch it work
npm run monitor -- --retries=2     # tolerate a blip before calling a page broken
npm run monitor -- --continueOnError   # log problems and keep going
```

Stop any time with Ctrl-C; the current check finishes and the log is closed out.

## What counts as a healthy page

A section passes only when all of these hold:

| Check | Failure kind |
|---|---|
| Navigation completes within the timeout | `timeout` |
| HTTP status is not 401/403 | `access` |
| HTTP status is not 5xx | `http` |
| No candidate URL 404s | `not-found` |
| Not bounced to a sign-in page | `login` |
| No 2FA / captcha wall | `bot-check` |
| Stayed on an expected host | `redirect` |
| No error text ("Something went wrong", "Access denied", …) | `page-error` |
| Rendered more than 200 characters of text | `empty` |
| Content matches what the section should contain | `unexpected-content` |

Background XHRs that return 5xx are logged as warnings but do not stop the run —
Seller Center pages fire a lot of side requests and they are noisy.

## Status log

Everything lands in `monitor/logs/` (gitignored):

- `status.log` — one line per check, meant for `tail -f`
  ```
  2026-09-17T10:00:29.500Z  INFO  cycle 2  Dashboard     OK    737ms  https://seller.walmart.com/
  2026-09-17T10:00:30.439Z  INFO  cycle 2  Orders        OK    740ms  https://seller.walmart.com/order-management/orders
  ```
- `events.jsonl` — the same events as JSON, one per line
- `status.json` — a live snapshot: cycles, per-section pass/fail counts, last error
- `failures/` — screenshot and page HTML captured at the moment of each failure

When a section fails, the run stops and prints:

```
========================================================================
MONITORING STOPPED — a section is not healthy
========================================================================
  Section : Payments
  Problem : access
  Error   : HTTP 403 at https://seller.walmart.com/payments — account lacks access or the session was rejected
  URL     : https://seller.walmart.com/payments
  Cycle   : 3
  Time    : 2026-09-17T10:01:39.454Z
  Screenshot: monitor/logs/failures/..._cycle3_payments.png
========================================================================
```

Exit code is `1` when the run stopped on a problem, `0` when it finished its time.

## Section URLs

`monitor/sections.js` holds the URL candidates for each section. Walmart moves
these around by account type, so each section lists more than one and the first
one that resolves is reused for the rest of the run. If yours differ, copy the
array to `monitor/sections.local.json` and point at it:

```bash
npm run monitor -- --sections=monitor/sections.local.json
```

## Options

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--hours` | `MONITOR_HOURS` | `4` | how long the run lasts |
| `--cycleDelay` | `MONITOR_CYCLE_DELAY_MS` | `60000` | pause between cycles |
| `--sectionDelay` | `MONITOR_SECTION_DELAY_MS` | `3000` | pause between sections |
| `--navTimeout` | `MONITOR_NAV_TIMEOUT_MS` | `45000` | per-page navigation timeout |
| `--settle` | `MONITOR_SETTLE_MS` | `2500` | extra wait after load before judging |
| `--retries` | `MONITOR_RETRIES` | `0` | re-checks before calling a section broken |
| `--continueOnError` | — | off | log problems instead of stopping |
| `--headed` | `MONITOR_HEADLESS` | headless | show the browser |
| `--only` | — | all | comma-separated section keys, e.g. `--only=orders,items` |
| `--baseUrl` | `WALMART_SC_BASE_URL` | `https://seller.walmart.com` | Seller Center host |
| `--logDir` | `MONITOR_LOG_DIR` | `monitor/logs` | where logs go |
| `--browserPath` | `MONITOR_BROWSER_PATH` | Playwright's | Chromium binary to use |

## Self-test

`npm run monitor:selftest` runs the monitor against a local mock Seller Center
that can be told to break in specific ways, and asserts each one is caught:

```
PASS  healthy run completes
PASS  page error is caught — Payments: page-error — page text matched "Something went wrong"
PASS  HTTP 403 is caught — Payments: access — HTTP 403 ...
PASS  HTTP 500 is caught — Orders: http — HTTP 500 ...
PASS  lost session is caught — Payments: login — redirected to a sign-in page ...
PASS  missing page is caught — Payments: not-found — HTTP 404 ...
PASS  blank page is caught — Reports: empty — page rendered only 0 characters ...
PASS  hung page is caught — Items: timeout — navigation did not complete ...
PASS  transient fault recovers on retry

9/9 self-tests passed
```

No Walmart account is involved, so this is safe to run any time.

## Leaving it running

```bash
nohup npm run monitor -- --hours=8 > monitor/logs/run.out 2>&1 &
tail -f monitor/logs/status.log
```

It needs a machine that stays awake for the whole window. Sessions do expire —
if the run stops with a `login` problem hours in, that is the session ageing
out, and `npm run monitor:login` renews it.
