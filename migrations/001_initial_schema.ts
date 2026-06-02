import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable("users", {
    id: { type: "serial", primaryKey: true },
    balance: { type: "bigint", notNull: true },
  });

  pgm.createTable("markets", {
    id: { type: "serial", primaryKey: true },
    question: { type: "text", notNull: true },
    b: { type: "float", notNull: true },
    q_yes: { type: "float", notNull: true, default: 0 },
    q_no: { type: "float", notNull: true, default: 0 },
    version: { type: "integer", notNull: true, default: 0 },
    state: { type: "varchar(10)", notNull: true, default: "open" },
    winning_outcome: { type: "varchar(3)" },
  });

  pgm.createTable("trades", {
    id: { type: "serial", primaryKey: true },
    user_id: { type: "integer", notNull: true, references: "users" },
    market_id: { type: "integer", notNull: true, references: "markets" },
    outcome: { type: "varchar(3)", notNull: true },
    shares: { type: "float", notNull: true },
    cost: { type: "bigint", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.createTable("positions", {
    user_id: { type: "integer", notNull: true, references: "users" },
    market_id: { type: "integer", notNull: true, references: "markets" },
    outcome: { type: "varchar(3)", notNull: true },
    shares: { type: "float", notNull: true, default: 0 },
  });

  pgm.addConstraint("positions", "positions_pkey", {
    primaryKey: ["user_id", "market_id", "outcome"],
  });

  pgm.createTable("outbox", {
    id: { type: "serial", primaryKey: true },
    event_type: { type: "varchar(50)", notNull: true },
    payload: { type: "jsonb", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    published_at: { type: "timestamptz" },
  });

  pgm.createIndex("trades", ["user_id"]);
  pgm.createIndex("trades", ["market_id"]);
  pgm.createIndex("outbox", ["published_at"], {
    where: "published_at IS NULL",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("outbox");
  pgm.dropTable("positions");
  pgm.dropTable("trades");
  pgm.dropTable("markets");
  pgm.dropTable("users");
}
