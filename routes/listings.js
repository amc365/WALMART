const express = require('express');
const fetch = require('node-fetch');
const { walmartHeaders } = require('../lib/walmartAuth');
const { getStockBySku } = require('../lib/inventory');
const { createStore } = require('../lib/store');

const router = express.Router();

const ITEMS_PAGE_SIZE = 200;
// Generous ceiling that exists only to stop a runaway loop. If we ever hit it
// the response says so explicitly rather than presenting a truncated count as
// the real total.
const MAX_ITEM_PAGES = Number(process.env.WALMART_MAX_ITEM_PAGES || 500);

// Pending fix queue — nothing here executes automatically, same pattern as /api/ads.
// Persisted to disk so a restart cannot erase staged or approved work.
const pendingFixes = createStore('listing-fixes');

async function fetchAllItems() {
  let allItems = [];
  let nextCursor = null;
  let page = 0;

  do {
    const cursor = nextCursor || '*';
    const url = `https://marketplace.walmartapis.com/v3/items?limit=${ITEMS_PAGE_SIZE}&nextCursor=${encodeURIComponent(cursor)}`;

    // Refreshed per page: a full pagination run can outlive the 15-minute token.
    const headers = await walmartHeaders();
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      const err = new Error('Walmart items fetch failed');
      err.status = r.status;
      err.detail = detail;
      throw err;
    }

    const data = await r.json();
    allItems = allItems.concat(data.ItemResponse || data.itemResponse || []);
    nextCursor = data.nextCursor || null;
    page++;
  } while (nextCursor && page < MAX_ITEM_PAGES);

  // Truncated only if the cap stopped us while Walmart still had more pages.
  return { allItems, pages: page, truncated: Boolean(nextCursor) };
}

// GET /api/listings — fetch all items, but only flag a real mismatch:
//   - has stock but isn't live  -> should be turned ON
//   - is live but has zero stock -> should be turned OFF (or restocked)
// Retired / Archived / intentionally discontinued items are left alone.
// Items whose stock we could not read are reported as UNKNOWN, never as healthy.
router.get('/', async (req, res) => {
  try {
    const { allItems, pages, truncated } = await fetchAllItems();

    const isIntentionallyDown = (item) =>
      ['RETIRED', 'ARCHIVED'].includes(item.lifecycleStatus);
    const isLive = (item) => item.publishedStatus === 'PUBLISHED';

    // Only items we'd actually act on need a stock lookup.
    const actionable = allItems.filter(i => !isIntentionallyDown(i) && i.sku);
    const { qtyBySku, meta: stockMeta } = await getStockBySku(actionable.map(i => i.sku));

    let stockUnknownCount = 0;

    const results = allItems.map(item => {
      const raw = qtyBySku[item.sku];
      const qty = typeof raw === 'number' ? raw : null;
      const retired = isIntentionallyDown(item);
      let issueType = null;
      let issue = null;

      if (!retired) {
        if (qty === null) {
          // Previously this fell through as "no issue", which made an inventory
          // outage look identical to a clean account.
          stockUnknownCount++;
          issueType = 'stock_unknown';
          issue = 'Stock level could not be read — status unverified';
        } else if (qty > 0 && !isLive(item)) {
          issueType = 'has_stock_not_live';
          issue = `In stock (${qty}) but not published — should be live`;
        } else if (qty === 0 && isLive(item)) {
          issueType = 'live_zero_stock';
          issue = 'Published/live but 0 stock — should be paused or restocked';
        }
      }

      return {
        sku: item.sku,
        productName: item.productName,
        lifecycleStatus: item.lifecycleStatus,
        publishedStatus: item.publishedStatus,
        availableQty: qty,
        issueType,
        issue
      };
    });

    // Actionable mismatches, kept separate from "we don't know".
    const flagged = results.filter(r => r.issueType && r.issueType !== 'stock_unknown');
    const unknown = results.filter(r => r.issueType === 'stock_unknown');

    const stockOk = stockMeta.source !== 'none' && stockUnknownCount === 0;
    const stockFailed = stockMeta.source === 'none' || stockMeta.resolved === 0;

    res.json({
      status: stockFailed ? 'stock_unavailable' : (stockOk ? 'ok' : 'degraded'),
      totalItems: allItems.length,
      truncated,
      pagesFetched: pages,
      ignoredRetiredArchived: allItems.filter(isIntentionallyDown).length,
      flaggedCount: flagged.length,
      stockUnknownCount,
      stock: {
        source: stockMeta.source,
        checked: stockMeta.requested,
        resolved: stockMeta.resolved,
        notChecked: stockMeta.perSkuSkipped,
        errors: stockMeta.errors
      },
      flagged,
      unknown,
      items: results
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, detail: err.detail });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/pending — stage a fix (publish or deactivate) for one SKU. Does NOT execute it.
router.post('/pending', (req, res) => {
  const { sku, issueType } = req.body || {};
  if (!sku || !issueType) return res.status(400).json({ error: 'sku and issueType are required' });

  // Never stage a fix off a stock reading we don't actually have.
  if (issueType === 'stock_unknown') {
    return res.status(400).json({ error: 'Cannot stage a fix for a SKU whose stock level is unknown' });
  }
  if (!['has_stock_not_live', 'live_zero_stock'].includes(issueType)) {
    return res.status(400).json({ error: `Unknown issueType: ${issueType}` });
  }

  const action = issueType === 'has_stock_not_live' ? 'publish' : 'deactivate';
  const fix = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sku,
    issueType,
    action,
    status: 'awaiting_approval',
    createdAt: new Date().toISOString()
  };
  pendingFixes.add(fix);
  res.json({ staged: fix });
});

router.get('/pending', (req, res) => {
  res.json({ pending: pendingFixes.all() });
});

// POST /api/listings/pending/:id/approve — actually execute the fix
router.post('/pending/:id/approve', async (req, res) => {
  const fix = pendingFixes.find(req.params.id);
  if (!fix) return res.status(404).json({ error: 'Fix not found' });
  if (fix.status !== 'awaiting_approval') {
    return res.status(409).json({ error: `Fix is already ${fix.status}` });
  }

  // TODO: wire to the real Walmart Marketplace API call for fix.action
  // (item Setup/Feeds API to publish, or Inventory API to zero out / pause).
  const updated = pendingFixes.update(req.params.id, {
    status: 'approved_not_yet_wired',
    approvedAt: new Date().toISOString()
  });
  res.json({
    result: updated,
    note: 'Approval recorded. Actual Walmart API call for this fix is not wired up yet.'
  });
});

router.post('/pending/:id/reject', (req, res) => {
  if (!pendingFixes.find(req.params.id)) return res.status(404).json({ error: 'Fix not found' });
  const updated = pendingFixes.update(req.params.id, {
    status: 'rejected',
    rejectedAt: new Date().toISOString()
  });
  res.json({ result: updated });
});

module.exports = router;
