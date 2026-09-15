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

## Not wired up yet
- Walmart Connect (Ads) API calls — needs WALMART_ADS_API_KEY / WALMART_ADVERTISER_ID
