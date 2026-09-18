const fetch = require('node-fetch');
const { walmartHeaders } = require('./walmartAuth');
const { getStockBySku } = require('./inventory');

const BASE = 'https://marketplace.walmartapis.com';
const MAX_PAGES = Number(process.env.ANALYTICS_MAX_PAGES || 200);

function pick(obj, ...paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Walmart wraps list responses inconsistently across endpoints and account
 * versions. Pull the elements out wherever they sit, and report failure rather
 * than returning an empty list that reads like "no orders".
 */
function extractList(data, ...candidates) {
  for (const path of candidates) {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), data);
    if (Array.isArray(v)) return { list: v, parsed: true };
    if (v && typeof v === 'object') return { list: asArray(v), parsed: true };
  }
  return { list: [], parsed: false };
}

async function fetchPaged(buildUrl, extractPaths, label) {
  let all = [];
  let cursor = null;
  let pages = 0;
  const meta = { parsed: true, pages: 0, error: null, truncated: false };

  do {
    const url = buildUrl(cursor);
    const headers = await walmartHeaders();
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      meta.parsed = false;
      meta.error = `${label} HTTP ${res.status}: ${detail.slice(0, 300)}`;
      return { rows: all, meta };
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      meta.parsed = false;
      meta.error = `${label}: response was not JSON`;
      return { rows: all, meta };
    }

    const { list, parsed } = extractList(data, ...extractPaths);
    if (!parsed && pages === 0) {
      meta.parsed = false;
      meta.error = `${label}: could not locate the records array in the response`;
      return { rows: all, meta };
    }

    all = all.concat(list);
    cursor = pick(data, 'list.meta.nextCursor', 'meta.nextCursor', 'nextCursor');
    pages++;
  } while (cursor && pages < MAX_PAGES);

  meta.pages = pages;
  meta.truncated = Boolean(cursor);
  return { rows: all, meta };
}

async function fetchOrders(sinceIso) {
  return fetchPaged(
    (cursor) => cursor
      ? `${BASE}/v3/orders${cursor.startsWith('?') ? cursor : '?' + cursor}`
      : `${BASE}/v3/orders?createdStartDate=${encodeURIComponent(sinceIso)}&limit=200`,
    ['list.elements.order', 'elements.order', 'orders'],
    'orders'
  );
}

async function fetchReturns(sinceIso) {
  return fetchPaged(
    (cursor) => cursor
      ? `${BASE}/v3/returns${cursor.startsWith('?') ? cursor : '?' + cursor}`
      : `${BASE}/v3/returns?returnCreationStartDate=${encodeURIComponent(sinceIso)}&limit=200`,
    ['returnOrders', 'list.elements.returnOrder', 'elements.returnOrder'],
    'returns'
  );
}

async function fetchItems() {
  let all = [];
  let cursor = '*';
  let pages = 0;
  const meta = { parsed: true, pages: 0, error: null, truncated: false };

  do {
    const headers = await walmartHeaders();
    const res = await fetch(`${BASE}/v3/items?limit=200&nextCursor=${encodeURIComponent(cursor)}`, { headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      meta.parsed = false;
      meta.error = `items HTTP ${res.status}: ${detail.slice(0, 300)}`;
      return { rows: all, meta };
    }
    const data = await res.json();
    all = all.concat(data.ItemResponse || data.itemResponse || []);
    cursor = data.nextCursor || null;
    pages++;
  } while (cursor && pages < MAX_PAGES);

  meta.pages = pages;
  meta.truncated = Boolean(cursor);
  return { rows: all, meta };
}

/** Flatten order lines into per-SKU sales, cancellations and revenue. */
function summariseOrders(orders) {
  const bySku = {};
  let unparsedLines = 0;

  for (const order of orders) {
    const lines = asArray(pick(order, 'orderLines.orderLine', 'orderLines') || []);
    for (const line of lines) {
      const sku = pick(line, 'item.sku', 'sku');
      if (!sku) { unparsedLines++; continue; }

      const qty = Number(pick(line, 'orderLineQuantity.amount', 'quantity.amount', 'quantity')) || 0;
      const statuses = asArray(pick(line, 'orderLineStatuses.orderLineStatus', 'orderLineStatuses') || []);
      const status = String(pick(statuses[0] || {}, 'status') || '').toUpperCase();

      const chargeList = asArray(pick(line, 'charges.charge', 'charges') || []);
      const revenue = chargeList.reduce((sum, c) => {
        const amt = Number(pick(c, 'chargeAmount.amount')) || 0;
        const type = String(pick(c, 'chargeType') || '').toUpperCase();
        return type === 'PRODUCT' || chargeList.length === 1 ? sum + amt : sum;
      }, 0);

      const rec = bySku[sku] || (bySku[sku] = {
        sku,
        productName: pick(line, 'item.productName', 'productName') || null,
        unitsSold: 0, unitsCancelled: 0, revenue: 0, orderCount: 0
      });

      rec.orderCount++;
      if (status === 'CANCELLED') rec.unitsCancelled += qty;
      else { rec.unitsSold += qty; rec.revenue += revenue; }
    }
  }
  return { bySku, unparsedLines };
}

/** Per-SKU return counts and the reasons customers gave. */
function summariseReturns(returnOrders) {
  const bySku = {};
  let unparsedLines = 0;

  for (const ro of returnOrders) {
    const lines = asArray(pick(ro, 'returnOrderLines.returnOrderLine', 'returnOrderLines') || []);
    for (const line of lines) {
      const sku = pick(line, 'item.sku', 'sku');
      if (!sku) { unparsedLines++; continue; }
      const qty = Number(pick(line, 'quantity.amount', 'returnQuantity.amount', 'quantity')) || 1;
      const reason = String(
        pick(line, 'returnReason', 'reason', 'returnReasonCode', 'customerReason') || 'UNSPECIFIED'
      ).toUpperCase();

      const rec = bySku[sku] || (bySku[sku] = { sku, unitsReturned: 0, reasons: {} });
      rec.unitsReturned += qty;
      rec.reasons[reason] = (rec.reasons[reason] || 0) + qty;
    }
  }
  return { bySku, unparsedLines };
}

function topReason(reasons) {
  const entries = Object.entries(reasons || {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { reason: entries[0][0], count: entries[0][1] };
}

/**
 * Build the per-SKU performance table plus the flagged findings.
 * Every section records whether its source data actually loaded; a section
 * built on a failed fetch is reported as unavailable, never as "nothing found".
 */
async function buildReport({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400e3).toISOString();

  const [itemsRes, ordersRes, returnsRes] = await Promise.all([
    fetchItems(),
    fetchOrders(since),
    fetchReturns(since)
  ]);

  const items = itemsRes.rows;
  const activeItems = items.filter(i => !['RETIRED', 'ARCHIVED'].includes(i.lifecycleStatus) && i.sku);
  const stock = await getStockBySku(activeItems.map(i => i.sku));

  const sales = summariseOrders(ordersRes.rows);
  const returns = summariseReturns(returnsRes.rows);

  const rows = activeItems.map(item => {
    const s = sales.bySku[item.sku] || { unitsSold: 0, unitsCancelled: 0, revenue: 0, orderCount: 0 };
    const r = returns.bySku[item.sku] || { unitsReturned: 0, reasons: {} };
    const qty = typeof stock.qtyBySku[item.sku] === 'number' ? stock.qtyBySku[item.sku] : null;

    const velocity = s.unitsSold / days;
    const daysOfCover = qty === null ? null : (velocity > 0 ? qty / velocity : (qty > 0 ? Infinity : 0));

    return {
      sku: item.sku,
      productName: item.productName || s.productName || null,
      publishedStatus: item.publishedStatus,
      lifecycleStatus: item.lifecycleStatus,
      stock: qty,
      unitsSold: s.unitsSold,
      revenue: Math.round(s.revenue * 100) / 100,
      unitsCancelled: s.unitsCancelled,
      cancelRate: (s.unitsSold + s.unitsCancelled) > 0
        ? s.unitsCancelled / (s.unitsSold + s.unitsCancelled) : null,
      unitsReturned: r.unitsReturned,
      returnRate: s.unitsSold > 0 ? r.unitsReturned / s.unitsSold : null,
      topReturnReason: topReason(r.reasons),
      returnReasons: r.reasons,
      velocityPerDay: Math.round(velocity * 1000) / 1000,
      daysOfCover: daysOfCover === Infinity ? null : (daysOfCover === null ? null : Math.round(daysOfCover * 10) / 10)
    };
  });

  const sold = rows.filter(r => r.unitsSold > 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

  // --- findings -----------------------------------------------------------
  const findings = {};

  findings.stockoutRisk = rows
    .filter(r => r.stock !== null && r.velocityPerDay > 0 && r.daysOfCover !== null && r.daysOfCover <= 14)
    .map(r => ({ ...r, projectedLostUnits30d: Math.round(Math.max(0, 30 - r.daysOfCover) * r.velocityPerDay),
                 projectedLostRevenue30d: Math.round(Math.max(0, 30 - r.daysOfCover) * r.velocityPerDay *
                   (r.unitsSold > 0 ? r.revenue / r.unitsSold : 0) * 100) / 100 }))
    .sort((a, b) => b.projectedLostRevenue30d - a.projectedLostRevenue30d);

  findings.outOfStockWithDemand = rows
    .filter(r => r.stock === 0 && r.unitsSold > 0)
    .sort((a, b) => b.revenue - a.revenue);

  findings.inStockNotPublished = rows
    .filter(r => r.stock !== null && r.stock > 0 && r.publishedStatus !== 'PUBLISHED')
    .sort((a, b) => b.stock - a.stock);

  findings.highReturnRate = rows
    .filter(r => r.unitsSold >= 5 && r.returnRate !== null && r.returnRate >= 0.1)
    .sort((a, b) => b.returnRate - a.returnRate);

  findings.highCancelRate = rows
    .filter(r => (r.unitsSold + r.unitsCancelled) >= 5 && r.cancelRate !== null && r.cancelRate >= 0.05)
    .sort((a, b) => b.cancelRate - a.cancelRate);

  findings.topSellers = [...sold].sort((a, b) => b.revenue - a.revenue).slice(0, 25);

  findings.deadStock = rows
    .filter(r => r.unitsSold === 0 && r.stock !== null && r.stock > 0)
    .sort((a, b) => b.stock - a.stock);

  // Content gaps. Only checks that can be made from fields the items endpoint
  // actually returns — images, bullets and attributes are not in this payload,
  // so they are listed as uncheckable rather than reported as absent.
  findings.contentGaps = activeItems.map(item => {
    const gaps = [];
    const name = item.productName || '';
    if (!name) gaps.push('missing product title');
    else {
      if (name.length < 40) gaps.push(`title very short (${name.length} chars; Walmart allows ~200 and long titles rank better)`);
      if (name.length > 200) gaps.push(`title over Walmart's ~200 char limit (${name.length})`);
    }
    return gaps.length ? { sku: item.sku, productName: name || null, gaps } : null;
  }).filter(Boolean);

  findings.contentChecksNotPerformed = [
    'image count and quality',
    'bullet points / description body',
    'category attributes completeness',
    'variation group setup'
  ];

  return {
    window: { days, since, generatedAt: new Date().toISOString() },
    coverage: {
      items: { ok: itemsRes.meta.parsed, error: itemsRes.meta.error, count: items.length, truncated: itemsRes.meta.truncated },
      orders: { ok: ordersRes.meta.parsed, error: ordersRes.meta.error, count: ordersRes.rows.length, truncated: ordersRes.meta.truncated, unparsedLines: sales.unparsedLines },
      returns: { ok: returnsRes.meta.parsed, error: returnsRes.meta.error, count: returnsRes.rows.length, truncated: returnsRes.meta.truncated, unparsedLines: returns.unparsedLines },
      stock: { ok: stock.meta.source !== 'none', source: stock.meta.source, resolved: stock.meta.resolved, errors: stock.meta.errors },
      // Stated explicitly so a reader never assumes these were considered.
      notAvailableViaApi: [
        'page views / traffic',
        'conversion rate',
        'advertising spend, ROAS, ACOS',
        'customer reviews and complaint text',
        'competitor pricing / buy-box win rate (needs the Buy Box report)'
      ]
    },
    totals: {
      activeSkus: activeItems.length,
      skusWithSales: sold.length,
      unitsSold: rows.reduce((s, r) => s + r.unitsSold, 0),
      revenue: Math.round(totalRevenue * 100) / 100,
      unitsReturned: rows.reduce((s, r) => s + r.unitsReturned, 0),
      unitsCancelled: rows.reduce((s, r) => s + r.unitsCancelled, 0),
      overallReturnRate: rows.reduce((s, r) => s + r.unitsSold, 0) > 0
        ? rows.reduce((s, r) => s + r.unitsReturned, 0) / rows.reduce((s, r) => s + r.unitsSold, 0) : null
    },
    findings,
    rows
  };
}

module.exports = { buildReport, summariseOrders, summariseReturns, extractList, topReason };
