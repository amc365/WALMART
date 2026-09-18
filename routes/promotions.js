const express = require('express');
const { createStore } = require('../lib/store');
const { getPromotions, validatePromo, applyPromotion } = require('../lib/promotions');

const router = express.Router();

// Staged promotions, persisted like the other approval queues.
const pendingPromos = createStore('promotions');

// Opt-in safety valve for testing: stage and approve as normal, but never send
// anything to Walmart.
const DRY_RUN = process.env.PROMOTIONS_DRY_RUN === 'true';

// GET /api/promotions/sku/:sku — promotions currently live on a SKU
router.get('/sku/:sku', async (req, res) => {
  try {
    const result = await getPromotions(req.params.sku);
    res.json({
      sku: req.params.sku,
      readable: result.parsed,
      promos: result.promos,
      error: result.error || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/promotions/pending — validate and stage a promotion. Sends nothing.
router.post('/pending', async (req, res) => {
  const { sku, promoPrice, comparisonPrice, startsAt, endsAt } = req.body || {};

  let existing;
  try {
    existing = sku ? await getPromotions(sku) : null;
  } catch (err) {
    existing = { promos: [], parsed: false, error: err.message };
  }

  const check = validatePromo({ sku, promoPrice, comparisonPrice, startsAt, endsAt }, existing);
  if (!check.ok) {
    return res.status(400).json({ error: 'Promotion is not valid', errors: check.errors, warnings: check.warnings });
  }

  const promo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sku,
    promoPrice: Number(promoPrice),
    comparisonPrice: Number(comparisonPrice),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    status: 'awaiting_approval',
    warnings: check.warnings,
    createdAt: new Date().toISOString()
  };
  pendingPromos.add(promo);
  res.json({ staged: promo, warnings: check.warnings });
});

router.get('/pending', (req, res) => {
  res.json({ pending: pendingPromos.all(), dryRun: DRY_RUN });
});

// POST /api/promotions/pending/:id/approve — THIS CHANGES A LIVE PRICE.
router.post('/pending/:id/approve', async (req, res) => {
  const promo = pendingPromos.find(req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promotion not found' });
  if (promo.status !== 'awaiting_approval') {
    return res.status(409).json({ error: `Promotion is already ${promo.status}` });
  }

  // Re-validate at execution time. The 4-hour lead rule and overlap checks can
  // both have gone stale between staging and approval.
  let existing;
  try {
    existing = await getPromotions(promo.sku);
  } catch (err) {
    existing = { promos: [], parsed: false, error: err.message };
  }
  const recheck = validatePromo(promo, existing);
  if (!recheck.ok) {
    pendingPromos.update(promo.id, {
      status: 'rejected_on_revalidation',
      revalidationErrors: recheck.errors,
      rejectedAt: new Date().toISOString()
    });
    return res.status(409).json({
      error: 'Promotion is no longer valid and was NOT sent to Walmart',
      errors: recheck.errors
    });
  }

  let result;
  try {
    result = await applyPromotion(promo, { dryRun: DRY_RUN });
  } catch (err) {
    const updated = pendingPromos.update(promo.id, {
      status: 'failed',
      failedAt: new Date().toISOString(),
      failure: err.message
    });
    return res.status(502).json({ error: 'Walmart request failed', detail: err.message, result: updated });
  }

  // Record exactly what was sent and what came back, success or failure.
  const updated = pendingPromos.update(promo.id, {
    status: result.ok ? (result.dryRun ? 'dry_run_ok' : 'applied') : 'failed',
    appliedAt: new Date().toISOString(),
    walmartStatus: result.status ?? null,
    walmartResponse: result.response ?? null,
    sentPayload: result.sentPayload,
    dryRun: Boolean(result.dryRun)
  });

  if (!result.ok) {
    return res.status(502).json({ error: 'Walmart rejected the promotion', result: updated });
  }
  res.json({ result: updated, note: result.note || 'Promotion sent to Walmart.' });
});

router.post('/pending/:id/reject', (req, res) => {
  if (!pendingPromos.find(req.params.id)) return res.status(404).json({ error: 'Promotion not found' });
  const updated = pendingPromos.update(req.params.id, {
    status: 'rejected',
    rejectedAt: new Date().toISOString()
  });
  res.json({ result: updated });
});

module.exports = router;
