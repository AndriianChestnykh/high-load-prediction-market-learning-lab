import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });

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
