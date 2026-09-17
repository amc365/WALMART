// A stand-in Seller Center used to exercise the monitor without touching a
// real account. Fault injection is driven by env vars:
//   FAULT_SECTION=orders FAULT_MODE=error|timeout|404|403|logout|empty
//   FAULT_AFTER=2   (only start faulting on the Nth request to that section)
//   FAULT_UNTIL=3   (stop faulting after the Nth request — simulates recovery)

const express = require('express');

const app = express();
app.use(express.urlencoded({ extended: false }));

const SECTIONS = {
  '/': { title: 'Dashboard', blurb: 'Seller Center home overview: today\'s sales, open orders and alerts.' },
  '/order-management/orders': { title: 'Orders', blurb: 'Order management. Released orders, shipped orders and returns are listed here.' },
  '/items': { title: 'Catalog', blurb: 'Item catalog. Published SKU listings, item quality and inventory status.' },
  '/payments': { title: 'Payments', blurb: 'Payment settlement summary, payout history and invoices.' },
  '/performance': { title: 'Performance', blurb: 'Seller scorecard performance metrics: on-time delivery and cancel rate.' },
  '/advertising': { title: 'Advertising', blurb: 'Walmart Connect advertising campaign and ad group overview.' },
  '/reports': { title: 'Reports', blurb: 'Analytics and reports. Request a report download or view recent report runs.' }
};

const faultSection = (process.env.FAULT_SECTION || '').toLowerCase();
const faultMode = process.env.FAULT_MODE || 'error';
const faultAfter = Number(process.env.FAULT_AFTER || 1);
const faultUntil = Number(process.env.FAULT_UNTIL || 0);
const hits = {};
let signedOut = false;

function isSignedIn(req) {
  return !signedOut && /sc_session=1/.test(req.headers.cookie || '');
}

// A left-hand menu with the same labels as the real Seller Center, so the
// monitor's menu-clicking path is exercised rather than only URL jumps.
const NAV = [
  ['Home', '/'],
  ['Orders', '/order-management/orders'],
  ['Catalog', '/items'],
  ['Payments', '/payments'],
  ['Performance', '/performance'],
  ['Advertising', '/advertising'],
  ['Reports', '/reports']
];

function page(title, body) {
  const links = NAV.map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  return `<!doctype html><html><head><title>${title} | Seller Center</title></head>
<body><nav style="display:block">${links}</nav>
<h1>${title}</h1>${body}</body></html>`;
}

function filler(blurb) {
  return `<p>${blurb}</p><p>${'Row data and account details render here. '.repeat(12)}</p>`;
}

app.get('/login', (req, res) => {
  res.send(page('Sign in', '<form method="post" action="/login"><input type="email" name="loginUsername"><input type="password" name="loginPassword"><button type="submit">Sign in</button></form>'));
});

app.post('/login', (req, res) => {
  if (!req.body.loginUsername || !req.body.loginPassword) {
    return res.send(page('Sign in', '<div role="alert">Enter your email and password.</div><form method="post" action="/login"><input type="password" name="loginPassword"></form>'));
  }
  signedOut = false;
  // No Max-Age: a session cookie, which Chromium drops when it exits. This is
  // deliberate — it is what a real sign-in cookie often looks like.
  res.setHeader('Set-Cookie', 'sc_session=1; Path=/');
  res.redirect('/');
});

for (const [route, meta] of Object.entries(SECTIONS)) {
  app.get(route, async (req, res) => {
    if (!isSignedIn(req)) return res.redirect('/login');

    const key = meta.title.toLowerCase();
    hits[key] = (hits[key] || 0) + 1;
    const faulting = faultSection && key.startsWith(faultSection) && hits[key] >= faultAfter
      && (!faultUntil || hits[key] <= faultUntil);

    if (!faulting) return res.send(page(meta.title, filler(meta.blurb)));

    switch (faultMode) {
      case 'timeout':
        return; // never responds
      case '404':
        return res.status(404).send(page('Page not found', '<p>Page not found.</p>'));
      case '403':
        return res.status(403).send(page('Denied', '<p>Access denied.</p>'));
      case 'logout':
        signedOut = true;
        return res.redirect('/login');
      case 'empty':
        return res.send('<!doctype html><html><body></body></html>');
      case '500':
        return res.status(500).send(page('Error', '<p>Internal server error.</p>'));
      default:
        return res.send(page(meta.title, '<p>Something went wrong. Please try again later.</p>'));
    }
  });
}

app.use((req, res) => res.status(404).send(page('Page not found', '<p>Page not found.</p>')));

const port = Number(process.env.PORT || 4321);
app.listen(port, '127.0.0.1', () => console.log(`mock seller center on http://127.0.0.1:${port}`));
