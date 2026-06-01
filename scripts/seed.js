'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const BATCH_SIZE = 1_000;
const USER_COUNT = 10_000;
const MARKET_COUNT = 100;

// Seed balances: 1M dollars = 1_000_000 * 1_000_000 micro-units
const SEED_BALANCE = 1_000_000_000_000n; // 1 trillion micro-units = 1M dollars

async function seed() {
  const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('Seeding database...');

    // ---- Users ----
    console.log(`Inserting ${USER_COUNT} users in batches of ${BATCH_SIZE}...`);
    let userCount = 0;
    for (let offset = 0; offset < USER_COUNT; offset += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, USER_COUNT - offset);
      // Build multi-row INSERT: INSERT INTO users (balance) VALUES ($1), ($2), ...
      const placeholders = Array.from({ length: batchSize }, (_, i) => `($${i + 1})`).join(', ');
      const values = Array.from({ length: batchSize }, () => SEED_BALANCE.toString());
      await client.query(
        `INSERT INTO users (balance) VALUES ${placeholders}`,
        values
      );
      userCount += batchSize;
      console.log(`  users: ${userCount}/${USER_COUNT}`);
    }

    // ---- Markets ----
    console.log(`Inserting ${MARKET_COUNT} markets...`);
    // All markets in one batch (100 rows is small)
    const marketPlaceholders = Array.from(
      { length: MARKET_COUNT },
      (_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
    ).join(', ');
    const marketValues = [];
    for (let i = 1; i <= MARKET_COUNT; i++) {
      marketValues.push(
        `Will event ${i} happen?`,  // question
        100,                         // b — liquidity parameter
        'open'                       // state
      );
    }
    await client.query(
      `INSERT INTO markets (question, b, state) VALUES ${marketPlaceholders}`,
      marketValues
    );
    console.log(`  markets: ${MARKET_COUNT}/${MARKET_COUNT}`);

    console.log('Seed complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
