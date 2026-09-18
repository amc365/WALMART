# Walmart Account Dashboard

On-demand tool (open it when logged in — no 24/7 background jobs).

## What it does now
- Pulls all listings from Walmart Marketplace API and cross-checks each against its real stock level
- Flags only genuine mismatches: in stock but not published, or published with zero stock
- Retired/archived SKUs are skipped; listings whose stock can't be read are reported as **unverified**, never as healthy
- **Promotions**: set a reduced (promotional) price on a SKU through the Marketplace
  Pricing API. Uses your existing `WALMART_CLIENT_ID` / `WALMART_CLIENT_SECRET` — no
  Walmart Connect needed. Validated against Walmart's rules before staging and again
  at approval, then sent with `PUT /v3/price`
- Ads panel: a manual pending-approval queue. **Not connected to Walmart Connect yet** —
  it cannot read or change live campaigns, and credentials alone will not enable it
- Approval queues are saved to disk, so a restart no longer erases staged or approved items

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

## Promotions
Promotional pricing is part of the Marketplace API (Seller Center), separate from
Walmart Connect ads. Rules enforced before anything is sent:

- start at least 4 hours in the future
- end after start, max 180 days
- no overlapping date ranges on the same SKU
- max 10 promotions per SKU
- promo price must be below the comparison price

Approving a promotion **changes a live price**. The promotion is re-validated at that
moment (dates and overlaps can go stale between staging and approval), and both the
payload sent and Walmart's response are recorded.

Set `PROMOTIONS_DRY_RUN=true` to validate and record without sending anything.

## Where approvals are stored
Staged and approved items are written to `data/*.json` (override the location with
`DATA_DIR`). The folder is gitignored.

**On Render:** the normal filesystem is wiped on every redeploy. To keep approval
history across deploys, attach a Persistent Disk and point `DATA_DIR` at its mount
path. Without that, the queue survives restarts within a deploy but not a redeploy.

## Optional env vars
- `WALMART_MAX_ITEM_PAGES` (default 500) — safety ceiling on listing pagination at
  200 items/page. If the cap is hit the dashboard says the list is incomplete
  instead of presenting a truncated total as the real count.
- `WALMART_PER_SKU_INVENTORY_LIMIT` (default 500) — cap on per-SKU inventory calls
  in the fallback path.
- `DATA_DIR` (default `./data`) — where approval queues are stored.
- `PROMOTIONS_DRY_RUN` (default off) — stage and approve promotions without sending
  them to Walmart. Useful for testing.

## Not wired up yet
- **Walmart Connect (Ads) integration is not built.** There is no code that reads
  campaigns from or sends changes to Walmart Connect. Setting
  `WALMART_ADS_API_KEY` / `WALMART_ADVERTISER_ID` does not enable it. Building it
  requires Walmart Connect API access, which is granted separately from the
  Marketplace API keys used for listings.
- Approving a listing fix records the approval but does not yet call Walmart.
  (Promotions **are** wired — approving one sends it to Walmart.)
