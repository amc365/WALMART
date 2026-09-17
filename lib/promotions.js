const fetch = require('node-fetch');
const { walmartHeaders } = require('./walmartAuth');

const BASE = 'https://marketplace.walmartapis.com';

// Walmart's documented promotion constraints. Enforced here so an invalid
// promotion is rejected before it is ever staged, rather than failing at the
// moment of execution.
const MIN_LEAD_MS = 4 * 60 * 60 * 1000;   // start must be >= 4 hours out
const LEAD_BUFFER_MS = 5 * 60 * 1000;     // margin so approval doesn't land under the wire
const MAX_DURATION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_PROMOS_PER_SKU = 10;

function parseDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function money(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

/** Read the promotions already configured for a SKU. */
async function getPromotions(sku) {
  const headers = await walmartHeaders();
  const res = await fetch(`${BASE}/v3/promo/sku/${encodeURIComponent(sku)}`, { headers });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { promos: [], parsed: false, error: `HTTP ${res.status}: ${detail.slice(0, 300)}` };
  }

  const data = await res.json().catch(() => null);
  if (!data) return { promos: [], parsed: false, error: 'response was not JSON' };

  // Shape varies by account/version; look for the pricing array wherever it sits.
  const list =
    data.pricing ||
    data.mart?.pricing ||
    data.promoPricing ||
    (Array.isArray(data) ? data : null);

  if (!Array.isArray(list)) {
    return { promos: [], parsed: false, error: 'could not locate a pricing array in the response', raw: data };
  }

  const promos = list.map(p => ({
    startsAt: p.effectiveDate || p.promoEffectiveDate || null,
    endsAt: p.expirationDate || p.promoExpirationDate || null,
    priceType: p.currentPriceType || p.priceType || null,
    amount: p.currentPrice?.amount ?? p.price?.amount ?? null
  }));

  return { promos, parsed: true };
}

/**
 * Check a proposed promotion against Walmart's rules and against the
 * promotions already on the SKU.
 * `existing` is the result of getPromotions(). If those could not be read the
 * overlap and count checks cannot be performed — that is reported as a warning
 * rather than being passed off as a clean result.
 */
function validatePromo(input, existing) {
  const errors = [];
  const warnings = [];

  const { sku, promoPrice, comparisonPrice, startsAt, endsAt } = input || {};

  if (!sku) errors.push('sku is required');

  const price = Number(promoPrice);
  const compare = Number(comparisonPrice);
  if (!Number.isFinite(price) || price <= 0) errors.push('promoPrice must be a positive number');
  if (!Number.isFinite(compare) || compare <= 0) errors.push('comparisonPrice must be a positive number');
  if (Number.isFinite(price) && Number.isFinite(compare) && price >= compare) {
    errors.push(`promoPrice (${price}) must be below comparisonPrice (${compare}) — this would not be a discount`);
  }

  const start = parseDate(startsAt);
  const end = parseDate(endsAt);
  if (!start) errors.push('startsAt is not a valid date');
  if (!end) errors.push('endsAt is not a valid date');

  if (start && end) {
    const now = Date.now();
    if (start.getTime() - now < MIN_LEAD_MS + LEAD_BUFFER_MS) {
      errors.push('startsAt must be at least 4 hours from now (Walmart rule)');
    }
    if (end.getTime() <= start.getTime()) {
      errors.push('endsAt must be after startsAt');
    }
    if (end.getTime() - start.getTime() > MAX_DURATION_MS) {
      errors.push('promotion cannot run longer than 180 days (Walmart rule)');
    }
  }

  if (!existing || existing.parsed !== true) {
    warnings.push(
      'Existing promotions for this SKU could not be read' +
      (existing?.error ? ` (${existing.error})` : '') +
      ' — the 10-promotion limit and overlap checks were NOT performed. Walmart may still reject this.'
    );
  } else if (start && end) {
    if (existing.promos.length >= MAX_PROMOS_PER_SKU) {
      errors.push(`SKU already has ${existing.promos.length} promotions — Walmart allows a maximum of ${MAX_PROMOS_PER_SKU}`);
    }
    const clash = existing.promos.find(p => {
      const ps = parseDate(p.startsAt);
      const pe = parseDate(p.endsAt);
      if (!ps || !pe) return false;
      return start.getTime() < pe.getTime() && end.getTime() > ps.getTime();
    });
    if (clash) {
      errors.push(`overlaps an existing promotion (${clash.startsAt} → ${clash.endsAt}) — Walmart rejects overlapping dates on the same SKU`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function buildPayload({ sku, promoPrice, comparisonPrice, startsAt, endsAt }, processMode = 'UPSERT') {
  return {
    sku,
    pricing: [{
      currentPrice: { currency: 'USD', amount: money(promoPrice) },
      currentPriceType: 'REDUCED',
      comparisonPriceType: 'BASE',
      comparisonPrice: { currency: 'USD', amount: money(comparisonPrice) },
      priceDisplayCodes: 'CART',
      effectiveDate: new Date(startsAt).toISOString(),
      expirationDate: new Date(endsAt).toISOString(),
      processMode
    }]
  };
}

/** Send the promotion to Walmart. This changes a live price. */
async function applyPromotion(promo, { dryRun = false, processMode = 'UPSERT' } = {}) {
  const payload = buildPayload(promo, processMode);

  if (dryRun) {
    return { ok: true, dryRun: true, sentPayload: payload, note: 'PROMOTIONS_DRY_RUN is on — nothing was sent to Walmart.' };
  }

  const headers = await walmartHeaders();
  const res = await fetch(`${BASE}/v3/price`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await res.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }

  return { ok: res.ok, status: res.status, response: body, sentPayload: payload };
}

module.exports = {
  getPromotions,
  validatePromo,
  buildPayload,
  applyPromotion,
  MIN_LEAD_MS,
  MAX_DURATION_MS,
  MAX_PROMOS_PER_SKU
};
