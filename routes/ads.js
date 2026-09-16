const express = require('express');
const { createStore } = require('../lib/store');

const router = express.Router();

// Pending-approval queue, persisted to disk. Nothing here executes
// automatically — every write action is staged until approved.
const pendingActions = createStore('ad-actions');

// The Walmart Connect integration does not exist yet. This flag exists so the
// dashboard can say that plainly instead of implying credentials are the only
// missing piece — they are not.
const INTEGRATION_BUILT = false;

router.get('/status', (req, res) => {
  const hasCredentials = Boolean(process.env.WALMART_ADS_API_KEY && process.env.WALMART_ADVERTISER_ID);

  let message;
  if (!INTEGRATION_BUILT) {
    message = hasCredentials
      ? 'Walmart Connect credentials are set, but the ads integration is not built yet — this dashboard cannot read or change your campaigns. The list below is a manual to-do list only.'
      : 'Ads integration is not built yet — this dashboard cannot read or change your Walmart Connect campaigns. Adding credentials alone will not enable it. The list below is a manual to-do list only.';
  } else {
    message = hasCredentials
      ? 'Walmart Connect connected.'
      : 'Walmart Connect credentials not set — add WALMART_ADS_API_KEY and WALMART_ADVERTISER_ID.';
  }

  res.json({
    built: INTEGRATION_BUILT,
    hasCredentials,
    // Kept for backwards compatibility with anything reading the old field.
    configured: INTEGRATION_BUILT && hasCredentials,
    message
  });
});

// GET /api/ads/pending — actions staged and waiting for your approval
router.get('/pending', (req, res) => {
  res.json({ pending: pendingActions.all() });
});

// POST /api/ads/pending — stage an action (e.g. pause campaign, change bid) — does NOT execute it
router.post('/pending', (req, res) => {
  const { type, target, details } = req.body || {};
  if (!type || !target) {
    return res.status(400).json({ error: 'type and target are required' });
  }
  const action = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    target,
    details: details || {},
    status: 'awaiting_approval',
    createdAt: new Date().toISOString()
  };
  pendingActions.add(action);
  res.json({ staged: action });
});

// POST /api/ads/pending/:id/approve — record approval of a staged action
router.post('/pending/:id/approve', async (req, res) => {
  const action = pendingActions.find(req.params.id);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  if (action.status !== 'awaiting_approval') {
    return res.status(409).json({ error: `Action is already ${action.status}` });
  }

  // TODO: once the Walmart Connect integration is built, perform the real API
  // call for action.type (e.g. pause campaign, update bid/budget) here.
  const updated = pendingActions.update(req.params.id, {
    status: 'approved_not_yet_wired',
    approvedAt: new Date().toISOString()
  });
  res.json({
    result: updated,
    note: 'Approval recorded, but nothing was sent to Walmart — the ads integration is not built yet.'
  });
});

router.post('/pending/:id/reject', (req, res) => {
  if (!pendingActions.find(req.params.id)) return res.status(404).json({ error: 'Action not found' });
  const updated = pendingActions.update(req.params.id, {
    status: 'rejected',
    rejectedAt: new Date().toISOString()
  });
  res.json({ result: updated });
});

module.exports = router;
