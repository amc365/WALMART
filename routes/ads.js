const express = require('express');
const router = express.Router();

// In-memory pending-approval queue (fine for a single-user, on-demand tool).
// Nothing here executes automatically — every write action is staged until approved.
const pendingActions = [];

router.get('/status', (req, res) => {
  const configured = Boolean(process.env.WALMART_ADS_API_KEY && process.env.WALMART_ADVERTISER_ID);
  res.json({
    configured,
    message: configured
      ? 'Walmart Connect credentials found.'
      : 'Walmart Connect (Ads) credentials not set yet — add WALMART_ADS_API_KEY and WALMART_ADVERTISER_ID to enable this section.'
  });
});

// GET /api/ads/pending — actions staged and waiting for your approval
router.get('/pending', (req, res) => {
  res.json({ pending: pendingActions });
});

// POST /api/ads/pending — stage an action (e.g. pause campaign, change bid) — does NOT execute it
router.post('/pending', (req, res) => {
  const { type, target, details } = req.body || {};
  if (!type || !target) {
    return res.status(400).json({ error: 'type and target are required' });
  }
  const action = {
    id: Date.now().toString(36),
    type,
    target,
    details: details || {},
    status: 'awaiting_approval',
    createdAt: new Date().toISOString()
  };
  pendingActions.push(action);
  res.json({ staged: action });
});

// POST /api/ads/pending/:id/approve — actually execute a staged action
router.post('/pending/:id/approve', async (req, res) => {
  const action = pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'Action not found' });

  // TODO: once Walmart Connect (Ads) credentials are added, replace this with the real
  // Walmart Connect API call for action.type (e.g. pause campaign, update bid/budget).
  action.status = 'approved_not_yet_wired';
  res.json({
    result: action,
    note: 'Approval recorded. Actual Walmart Connect API call is not wired up yet — needs WALMART_ADS_API_KEY / WALMART_ADVERTISER_ID.'
  });
});

router.post('/pending/:id/reject', (req, res) => {
  const idx = pendingActions.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Action not found' });
  pendingActions[idx].status = 'rejected';
  res.json({ result: pendingActions[idx] });
});

module.exports = router;
