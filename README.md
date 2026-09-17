# Walmart Account Dashboard

On-demand tool (open it when logged in — no 24/7 background jobs).

## What it does now
- Pulls all listings from Walmart Marketplace API, flags ones needing attention (not published, inactive, out of stock)
- Ads/Promotions panel: shows a pending-approval queue — nothing executes until you click Approve

## Setup
1. `npm install`
2. Copy `.env.example` to `.env`, fill in `WALMART_CLIENT_ID` / `WALMART_CLIENT_SECRET` (Seller Center → Developer Portal)
3. `npm start`
4. Open http://localhost:3000

## Deploy (Render)
Push to GitHub, then create a Render web service pointing at this repo.
- Build command: `npm install`
- Start command: `npm start`
- Add env vars: WALMART_CLIENT_ID, WALMART_CLIENT_SECRET

## Seller Center monitor (browser agent)

`monitor/` holds a Playwright agent that signs in to Seller Center and cycles
through Dashboard, Orders, Items, Payments, Performance, Advertising and
Reports, returning to the dashboard between sections. It stops and reports the
section name and error on the first page that errors, times out, bounces to
login or denies access, and keeps a status log in `monitor/logs/`.

```bash
npm run monitor -- --hours=8   # opens a sign-in window on first run, then watches
npm run monitor:selftest       # verify the checks against a local mock, no account needed
```

Not comfortable in a terminal? See `START-HERE.md` — double-click
`start-mac.command` or `start-windows.bat` and it does the rest.

See `monitor/README.md` for options, failure kinds and log formats.

## Not wired up yet
- Walmart Connect (Ads) API calls — needs WALMART_ADS_API_KEY / WALMART_ADVERTISER_ID
