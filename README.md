# Walmart Account Dashboard

On-demand tool (open it when logged in — no 24/7 background jobs).

## What it does now
- Pulls all listings from Walmart Marketplace API and cross-checks each against its real stock level
- Flags only genuine mismatches: in stock but not published, or published with zero stock
- Retired/archived SKUs are skipped; listings whose stock can't be read are reported as **unverified**, never as healthy
- Ads/Promotions panel: shows a pending-approval queue — nothing executes until you click Approve

## How stock is read
Walmart has no bulk "list all inventory" endpoint. Stock comes from the inventory
report (`/v3/getReport?type=inventory`, gzipped CSV). If that is unavailable the
tool falls back to per-SKU lookups (`/v3/inventory?sku=`), capped by
`WALMART_PER_SKU_INVENTORY_LIMIT`.

If stock cannot be read at all, the dashboard shows a red banner and reports the
affected listings as unverified. A "0 need action" result is only meaningful when
the stock source reports `ok`.

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

## Optional env vars
- `WALMART_MAX_ITEM_PAGES` (default 500) — safety ceiling on listing pagination at
  200 items/page. If the cap is hit the dashboard says the list is incomplete
  instead of presenting a truncated total as the real count.
- `WALMART_PER_SKU_INVENTORY_LIMIT` (default 500) — cap on per-SKU inventory calls
  in the fallback path.

## Not wired up yet
- Walmart Connect (Ads) API calls — needs WALMART_ADS_API_KEY / WALMART_ADVERTISER_ID
