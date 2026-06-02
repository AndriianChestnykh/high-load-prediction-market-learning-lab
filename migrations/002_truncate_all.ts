import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

// Wipes all data and resets sequences — use to return to a clean seeded state
// without tearing down the schema (faster than down + up).
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    TRUNCATE TABLE outbox, positions, trades, markets, users
    RESTART IDENTITY CASCADE
  `);
}

export function down(_pgm: MigrationBuilder): void {
  // Data cannot be restored from a truncation.
}
