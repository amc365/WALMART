require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const listingsRoute = require('./routes/listings');
const adsRoute = require('./routes/ads');
const promotionsRoute = require('./routes/promotions');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/listings', listingsRoute);
app.use('/api/ads', adsRoute);
app.use('/api/promotions', promotionsRoute);

app.get('/api/health', (req, res) => res.json({
  ok: true,
  hasClientId: Boolean(process.env.WALMART_CLIENT_ID),
  hasClientSecret: Boolean(process.env.WALMART_CLIENT_SECRET),
  clientIdLength: (process.env.WALMART_CLIENT_ID || '').length,
  clientSecretLength: (process.env.WALMART_CLIENT_SECRET || '').length
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Walmart automation tool running on port ${PORT}`));
