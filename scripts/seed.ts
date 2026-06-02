import "dotenv/config";
import pg from "pg";

const USERS = 10_000;
const MARKETS = 100;
const STARTING_BALANCE = 1_000_000_000n;
const LIQUIDITY_B = 100;

const QUESTIONS = [
  "Will this event happen by end of Q1?",
  "Will the price exceed $100 this month?",
  "Will the team win the championship?",
  "Will the product launch on time?",
  "Will the legislation pass this year?",
  "Will the merger be approved?",
  "Will the record be broken?",
  "Will the election result be contested?",
  "Will the new feature ship before the deadline?",
  "Will the experiment succeed?",
];

// Admin/bulk task — connect directly to Postgres, bypassing PgBouncer.
const pool = new pg.Pool({
  connectionString:
    process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  max: 10,
});

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("Seeding users...");
    await client.query("BEGIN");

    const existingUsers = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM users"
    );
    const userCount = parseInt(
      (existingUsers.rows[0] as { count: string }).count,
      10
    );

    if (userCount === 0) {
      const BATCH = 1000;
      for (let offset = 0; offset < USERS; offset += BATCH) {
        const batchSize = Math.min(BATCH, USERS - offset);
        const values: string[] = [];
        const params: string[] = [];
        for (let i = 0; i < batchSize; i++) {
          values.push(`($${i + 1})`);
          params.push(STARTING_BALANCE.toString());
        }
        await client.query(
          `INSERT INTO users (balance) VALUES ${values.join(",")}`,
          params
        );
        process.stdout.write(`\r  Users: ${offset + batchSize}/${USERS}`);
      }
      console.log();
    } else {
      console.log(`  Skipping: ${userCount} users already exist`);
    }

    const existingMarkets = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM markets"
    );
    const marketCount = parseInt(
      (existingMarkets.rows[0] as { count: string }).count,
      10
    );

    if (marketCount === 0) {
      console.log("Seeding markets...");
      const values: string[] = [];
      const params: (string | number)[] = [];
      for (let i = 0; i < MARKETS; i++) {
        const question = `${QUESTIONS[i % QUESTIONS.length] ?? "Will this happen?"} (market #${i + 1})`;
        const b = LIQUIDITY_B + Math.floor(Math.random() * 50);
        values.push(
          `($${i * 2 + 1}, $${i * 2 + 2})`
        );
        params.push(question, b);
      }
      await client.query(
        `INSERT INTO markets (question, b) VALUES ${values.join(",")}`,
        params
      );
      console.log(`  Created ${MARKETS} markets`);
    } else {
      console.log(`  Skipping: ${marketCount} markets already exist`);
    }

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
