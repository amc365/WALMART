const express = require('express');
const { buildReport } = require('../lib/analytics');

const router = express.Router();

// GET /api/analytics/report?days=30 — per-SKU performance and flagged findings.
// Read-only: this endpoint changes nothing on the account.
router.get('/report', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  try {
    const report = await buildReport({ days });
    const c = report.coverage;
    const broken = ['items', 'orders', 'returns'].filter(k => !c[k].ok);
    // A report missing a data source is not a report — say so at the top level.
    report.status = broken.length ? 'incomplete' : (c.stock.ok ? 'ok' : 'incomplete');
    report.incompleteSources = broken.concat(c.stock.ok ? [] : ['stock']);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
