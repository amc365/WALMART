const express = require('express');
const fetch = require('node-fetch');
const { walmartHeaders } = require('../lib/walmartAuth');
const { pool, initDb } = require('../lib/db');

const router = express.Router();
const COLLECTIONS = ['BMELM', 'BMGL', 'BMIM', 'BMESS'];
const getCollection = (sku) =>
  COLLECTIONS.find(p => (sku || '').toUpperCase().startsWith(p)) || null;

// GET /api/reviews/sync-skus — pull SKUs of required collections into DB
router.get('/sync-skus', async (req, res) => {
  try {
    await initDb();
    let items = [], cursor = '*', page = 0;
    do {
      const headers = await walmartHeaders();
      const r = await fetch(`https://marketplace.walmartapis.com/v3/items?limit=200&nextCursor=${encodeURIComponent(cursor)}`, { headers });
      if (!r.ok) return res.status(r.status).json({ error: 'Walmart items fetch failed', detail: await r.text() });
      const data = await r.json();
      items = items.concat(data.ItemResponse || data.itemResponse || []);
      cursor = data.nextCursor || null;
      page++;
    } while (cursor && page < 50);

    const matched = items.filter(i => getCollection(i.sku));
    const byCollection = {};
    for (const i of matched) {
      const col = getCollection(i.sku);
      byCollection[col] = (byCollection[col] || 0) + 1;
      await pool.query(
        `INSERT INTO review_skus (sku, collection, product_name, wpid, gtin, published_status, raw, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (sku) DO UPDATE SET collection=EXCLUDED.collection, product_name=EXCLUDED.product_name,
           wpid=EXCLUDED.wpid, gtin=EXCLUDED.gtin, published_status=EXCLUDED.published_status,
           raw=EXCLUDED.raw, updated_at=NOW()`,
        [i.sku, col, i.productName || null, i.wpid || null, i.gtin || null, i.publishedStatus || null, i]
      );
    }

    res.json({ totalItems: items.length, matched: matched.length, byCollection, sample: matched[0] || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
