const express = require('express');
const fetch = require('node-fetch');
const { walmartHeaders } = require('../lib/walmartAuth');

const router = express.Router();

// GET /api/listings — fetch all items and flag ones needing attention
router.get('/', async (req, res) => {
  try {
    const headers = await walmartHeaders();
    let allItems = [];
    let nextCursor = null;
    let page = 0;

    do {
      const url = nextCursor
        ? `https://marketplace.walmartapis.com/v3/items?nextCursor=${encodeURIComponent(nextCursor)}`
        : `https://marketplace.walmartapis.com/v3/items?limit=50`;

      const r = await fetch(url, { headers });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ error: 'Walmart items fetch failed', detail: text });
      }
      const data = await r.json();
      allItems = allItems.concat(data.ItemResponse || []);
      nextCursor = data.nextCursor || null;
      page++;
    } while (nextCursor && page < 20); // safety cap

    const flagged = allItems.map(item => {
      const issues = [];
      if (item.lifecycleStatus && item.lifecycleStatus !== 'ACTIVE') {
        issues.push(`Lifecycle: ${item.lifecycleStatus}`);
      }
      if (item.publishedStatus && item.publishedStatus !== 'PUBLISHED') {
        issues.push(`Not published: ${item.publishedStatus}`);
      }
      if (typeof item.availableQty === 'number' && item.availableQty === 0) {
        issues.push('Out of stock');
      }
      return {
        sku: item.sku,
        productName: item.productName,
        lifecycleStatus: item.lifecycleStatus,
        publishedStatus: item.publishedStatus,
        availableQty: item.availableQty,
        issues
      };
    });

    res.json({
      totalItems: allItems.length,
      flaggedCount: flagged.filter(f => f.issues.length > 0).length,
      items: flagged
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
