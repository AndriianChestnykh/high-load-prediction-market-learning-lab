import "dotenv/config";
import pg from "pg";

// Admin task — connect directly to Postgres, bypassing PgBouncer.
const pool = new pg.Pool({
  connectionString:
    process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
});

const client = await pool.connect();
try {
  await client.query(`
    TRUNCATE TABLE outbox, positions, trades, markets, users
    RESTART IDENTITY CASCADE
  `);
  console.log("All tables truncated and sequences reset.");
} finally {
  client.release();
  await pool.end();
}
