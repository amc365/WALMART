const express = require('express');
const fetch = require('node-fetch');
const { walmartHeaders } = require('../lib/walmartAuth');

const router = express.Router();

// Pending fix queue — nothing here executes automatically, same pattern as /api/ads
const pendingFixes = [];

// GET /api/listings — fetch all items, but only flag a real mismatch:
//   - has stock but isn't live  -> should be turned ON
//   - is live but has zero stock -> should be turned OFF (or restocked)
// Retired / Archived / intentionally discontinued items are left alone.
router.get('/', async (req, res) => {
  try {
    const headers = await walmartHeaders();
    let allItems = [];
    let nextCursor = null;
    let page = 0;

    do {
      const cursor = nextCursor || '*';
      const url = `https://marketplace.walmartapis.com/v3/items?limit=200&nextCursor=${encodeURIComponent(cursor)}`;

      const r = await fetch(url, { headers });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ error: 'Walmart items fetch failed', detail: text });
      }
      const data = await r.json();
      allItems = allItems.concat(data.ItemResponse || data.itemResponse || []);
      nextCursor = data.nextCursor || null;
      page++;
    } while (nextCursor && page < 20);

    if (allItems.length > 0) {
      console.log('SAMPLE_ITEM:', JSON.stringify(allItems[0]));
    }

    // Items API doesn't include stock — fetch it separately from the Inventory API and merge by SKU.
    const qtyBySku = {};
    let invCursor = null;
    let invPage = 0;
    let invDebug = { calls: 0, totalFetched: 0, sampleRaw: null, lastStatus: null, lastError: null };
    do {
      const invUrl = invCursor
        ? `https://marketplace.walmartapis.com/v3/inventories?limit=50&nextCursor=${encodeURIComponent(invCursor)}`
        : `https://marketplace.walmartapis.com/v3/inventories?limit=50`;
      const invHeaders = await walmartHeaders();
      const invRes = await fetch(invUrl, { headers: invHeaders });
      invDebug.calls++;
      invDebug.lastStatus = invRes.status;
      if (!invRes.ok) {
        invDebug.lastError = await invRes.text();
        break;
      }
      const invData = await invRes.json();
      if (invDebug.sampleRaw === null) invDebug.sampleRaw = invData;
      const list = invData.elements?.inventories || invData.inventories || invData.ItemResponse || [];
      invDebug.totalFetched += list.length;
      list.forEach(inv => {
        const amt = inv.quantity?.amount ?? inv.availableQuantity ?? null;
        if (inv.sku && amt !== null) qtyBySku[inv.sku] = amt;
      });
      invCursor = invData.nextCursor || null;
      invPage++;
    } while (invCursor && invPage < 100);

    allItems = allItems.map(item => ({
      ...item,
      availableQty: qtyBySku[item.sku] ?? null
    }));

    const isIntentionallyDown = (item) =>
      ['RETIRED', 'ARCHIVED'].includes(item.lifecycleStatus);

    const isLive = (item) => item.publishedStatus === 'PUBLISHED';

    const results = allItems.map(item => {
      const qty = typeof item.availableQty === 'number' ? item.availableQty : null;
      let issueType = null;
      let issue = null;

      if (!isIntentionallyDown(item) && qty !== null) {
        if (qty > 0 && !isLive(item)) {
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

    const flagged = results.filter(r => r.issueType);

    res.json({
      totalItems: allItems.length,
      ignoredRetiredArchived: allItems.filter(isIntentionallyDown).length,
      flaggedCount: flagged.length,
      flagged,
      items: results,
      _invDebug: invDebug
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/pending — stage a fix (publish or deactivate) for one SKU. Does NOT execute it.
router.post('/pending', (req, res) => {
  const { sku, issueType } = req.body || {};
  if (!sku || !issueType) return res.status(400).json({ error: 'sku and issueType are required' });

  const action = issueType === 'has_stock_not_live' ? 'publish' : 'deactivate';
  const fix = {
    id: Date.now().toString(36),
    sku,
    issueType,
    action,
    status: 'awaiting_approval',
    createdAt: new Date().toISOString()
  };
  pendingFixes.push(fix);
  res.json({ staged: fix });
});

router.get('/pending', (req, res) => {
  res.json({ pending: pendingFixes });
});

// POST /api/listings/pending/:id/approve — actually execute the fix
router.post('/pending/:id/approve', async (req, res) => {
  const fix = pendingFixes.find(f => f.id === req.params.id);
  if (!fix) return res.status(404).json({ error: 'Fix not found' });

  // TODO: wire to the real Walmart Marketplace API call for fix.action
  // (item Setup/Feeds API to publish, or Inventory API to zero out / pause).
  fix.status = 'approved_not_yet_wired';
  res.json({
    result: fix,
    note: 'Approval recorded. Actual Walmart API call for this fix is not wired up yet.'
  });
});

router.post('/pending/:id/reject', (req, res) => {
  const idx = pendingFixes.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Fix not found' });
  pendingFixes[idx].status = 'rejected';
  res.json({ result: pendingFixes[idx] });
});

module.exports = router;
