const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_skus (
      sku TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      product_name TEXT,
      wpid TEXT,
      gtin TEXT,
      item_id TEXT,
      published_status TEXT,
      raw JSONB,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reviews (
      review_id TEXT PRIMARY KEY,
      sku TEXT REFERENCES review_skus(sku),
      collection TEXT,
      rating INT,
      title TEXT,
      body TEXT,
      review_date DATE,
      sentiment TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { pool, initDb };
