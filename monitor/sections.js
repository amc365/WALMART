// The Seller Center sections to walk, in order.
//
// `paths` is a best-effort list of candidate URLs: Walmart moves these around
// per account type, so the first path that resolves without a "not found" is
// used and remembered for the rest of the run. `navText` is the left-hand nav
// label used as a fallback when none of the paths resolve.
//
// Verify these against your own account and override them with
// `--sections=monitor/sections.local.json` if they differ.

const SECTIONS = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    paths: ['/', '/dashboard'],
    navText: 'Home',
    expect: /dashboard|home|welcome|seller center|overview/i
  },
  {
    key: 'orders',
    name: 'Orders',
    paths: ['/order-management/orders', '/orders'],
    navText: 'Orders',
    expect: /order/i
  },
  {
    key: 'items',
    name: 'Items',
    paths: ['/items', '/item-management/items'],
    navText: 'Items',
    expect: /item|catalog|sku/i
  },
  {
    key: 'payments',
    name: 'Payments',
    paths: ['/payments', '/payments/summary'],
    navText: 'Payments',
    expect: /payment|settlement|payout|invoice/i
  },
  {
    key: 'performance',
    name: 'Performance',
    paths: ['/performance', '/growth/performance', '/scorecard'],
    navText: 'Growth',
    expect: /performance|scorecard|metric/i
  },
  {
    key: 'advertising',
    name: 'Advertising',
    paths: ['/advertising', '/ads'],
    navText: 'Advertising',
    expect: /advertis|campaign|ad group|walmart connect/i,
    // Walmart Connect lives on its own host; a hop off seller.walmart.com here
    // is expected rather than a redirect failure.
    allowedHosts: [/(^|\.)walmart\.com$/i]
  },
  {
    key: 'reports',
    name: 'Reports',
    paths: ['/reports', '/analytics/reports'],
    navText: 'Analytics & Reports',
    expect: /report|analytic|download/i
  }
];

// Text that means the page did not come up healthy.
const ERROR_PATTERNS = [
  { pattern: /something went wrong/i, kind: 'page-error' },
  { pattern: /we('| a)re having trouble/i, kind: 'page-error' },
  { pattern: /an (unexpected )?error (has )?occurred/i, kind: 'page-error' },
  { pattern: /unable to (load|complete|process)/i, kind: 'page-error' },
  { pattern: /failed to (load|fetch)/i, kind: 'page-error' },
  { pattern: /try again later/i, kind: 'page-error' },
  { pattern: /service (is )?(temporarily )?unavailable/i, kind: 'page-error' },
  { pattern: /internal server error/i, kind: 'page-error' },
  { pattern: /page (not found|isn'?t available)/i, kind: 'not-found' },
  { pattern: /404\b.*(not found|error)/i, kind: 'not-found' },
  { pattern: /(access|permission) denied/i, kind: 'access' },
  { pattern: /you (do not|don'?t) have (access|permission)/i, kind: 'access' },
  { pattern: /not authorized|unauthorized access/i, kind: 'access' },
  { pattern: /your session has (expired|timed out)/i, kind: 'login' },
  { pattern: /(please )?sign in to continue/i, kind: 'login' },
  { pattern: /verify you are (a )?human|are you a robot|captcha/i, kind: 'bot-check' }
];

// A URL that looks like this means we got bounced to an auth wall.
const LOGIN_URL_PATTERN = /(\/login|\/signin|\/sign-in|\/identity|\/auth|account\/login)/i;

function loadSections(config) {
  let sections = SECTIONS;
  if (config.sectionsFile) {
    const custom = require(require('path').resolve(config.sectionsFile));
    sections = Array.isArray(custom) ? custom : custom.sections;
  }
  if (config.only) {
    sections = sections.filter((s) => config.only.includes(s.key) || config.only.includes(s.name.toLowerCase()));
  }
  return sections.map((s) => ({ ...s, expect: s.expect ? new RegExp(s.expect, 'i') : null }));
}

module.exports = { SECTIONS, ERROR_PATTERNS, LOGIN_URL_PATTERN, loadSections };
