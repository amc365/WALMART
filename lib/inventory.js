const fetch = require('node-fetch');
const zlib = require('zlib');
const { walmartHeaders } = require('./walmartAuth');

// How many per-SKU inventory calls we're willing to make when the bulk report
// is unavailable. Beyond this, remaining SKUs are reported as unknown rather
// than silently treated as "fine".
const PER_SKU_LIMIT = Number(process.env.WALMART_PER_SKU_INVENTORY_LIMIT || 500);
const PER_SKU_CONCURRENCY = 4;

// Minimal RFC4180 parser — product names in the report contain commas and
// quoted segments, so a naive split(',') corrupts every row after them.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function findColumn(header, candidates) {
  const norm = header.map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  for (const cand of candidates) {
    const idx = norm.indexOf(cand);
    if (idx !== -1) return idx;
  }
  // Fall back to a substring match so minor header renames don't break us.
  for (const cand of candidates) {
    const idx = norm.findIndex(h => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Primary path: the bulk inventory report. Returns gzipped CSV in one call.
async function fetchInventoryReport() {
  const headers = await walmartHeaders();
  const res = await fetch('https://marketplace.walmartapis.com/v3/getReport?type=inventory', { headers });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`inventory report HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const buf = await res.buffer();
  // Gzip magic bytes — the endpoint normally returns gzip, but not always.
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const text = (isGzip ? zlib.gunzipSync(buf) : buf).toString('utf8');

  const rows = parseCsv(text).filter(r => r.length > 1);
  if (rows.length < 2) throw new Error('inventory report was empty');

  const header = rows[0];
  const skuIdx = findColumn(header, ['sku', 'merchantsku', 'sellersku']);
  const qtyIdx = findColumn(header, [
    'availabletosellqty', 'availabletosellquantity', 'availableqty',
    'onhandqty', 'quantity', 'qty'
  ]);

  if (skuIdx === -1 || qtyIdx === -1) {
    throw new Error(`could not locate sku/qty columns in report header: ${header.join('|').slice(0, 300)}`);
  }

  const qtyBySku = {};
  for (let i = 1; i < rows.length; i++) {
    const sku = (rows[i][skuIdx] || '').trim();
    const raw = (rows[i][qtyIdx] || '').trim();
    if (!sku || raw === '') continue;
    const amt = Number(raw);
    if (Number.isFinite(amt)) qtyBySku[sku] = amt;
  }

  if (Object.keys(qtyBySku).length === 0) throw new Error('inventory report contained no usable rows');
  return qtyBySku;
}

// Fallback path: /v3/inventory?sku=X, one SKU at a time. This is the endpoint
// that actually accepts a single SKU — unlike /v3/inventories, which the old
// code called bare and which never returned a full account listing.
async function fetchOneSku(sku) {
  const headers = await walmartHeaders();
  const url = `https://marketplace.walmartapis.com/v3/inventory?sku=${encodeURIComponent(sku)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const amt = data.quantity?.amount ?? data.availableQuantity ?? null;
  return typeof amt === 'number' ? amt : null;
}

async function fetchPerSku(skus) {
  const target = skus.slice(0, PER_SKU_LIMIT);
  const qtyBySku = {};
  let cursor = 0;

  async function worker() {
    while (cursor < target.length) {
      const sku = target[cursor++];
      try {
        const amt = await fetchOneSku(sku);
        if (amt !== null) qtyBySku[sku] = amt;
      } catch {
        // Leave this SKU unknown; the caller reports unknowns explicitly.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PER_SKU_CONCURRENCY, target.length) }, worker)
  );

  return { qtyBySku, attempted: target.length, skipped: skus.length - target.length };
}

/**
 * Resolve stock for the given SKUs.
 * Always reports how the data was obtained and what failed, so an inventory
 * outage can never be rendered as a healthy account.
 */
async function getStockBySku(skus) {
  const meta = { source: null, errors: [], resolved: 0, requested: skus.length, perSkuSkipped: 0 };

  try {
    const qtyBySku = await fetchInventoryReport();
    meta.source = 'report';
    meta.resolved = skus.filter(s => qtyBySku[s] !== undefined).length;
    return { qtyBySku, meta };
  } catch (err) {
    meta.errors.push(`report: ${err.message}`);
  }

  try {
    const { qtyBySku, skipped } = await fetchPerSku(skus);
    meta.source = 'per-sku';
    meta.perSkuSkipped = skipped;
    meta.resolved = Object.keys(qtyBySku).length;
    if (skipped > 0) {
      meta.errors.push(`per-sku cap reached: ${skipped} SKUs not checked (limit ${PER_SKU_LIMIT})`);
    }
    return { qtyBySku, meta };
  } catch (err) {
    meta.errors.push(`per-sku: ${err.message}`);
  }

  meta.source = 'none';
  return { qtyBySku: {}, meta };
}

module.exports = { getStockBySku, parseCsv, findColumn };
