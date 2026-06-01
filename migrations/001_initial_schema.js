'use strict';

/**
 * Phase 0 — initial schema.
 *
 * Tables:
 *   users      — accounts with micro-unit balances
 *   markets    — LMSR binary markets with optimistic version column
 *   trades     — append-only audit log
 *   positions  — maintained per-user per-market share counts
 *   outbox     — transactional outbox for async event relay (Phase 3)
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ---- users ----
  pgm.createTable('users', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    // 1 dollar = 1_000_000 micro-units; default starting balance = 1000 dollars
    balance: {
      type: 'bigint',
      notNull: true,
      default: 1_000_000_000, // 1000 dollars in micro-units
    },
  });

  // ---- markets ----
  pgm.createTable('markets', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    question: {
      type: 'text',
      notNull: true,
    },
    // Liquidity parameter — higher b means lower price impact per trade
    b: {
      type: 'double precision',
      notNull: true,
    },
    q_yes: {
      type: 'double precision',
      notNull: true,
      default: 0,
    },
    q_no: {
      type: 'double precision',
      notNull: true,
      default: 0,
    },
    // Optimistic concurrency version counter
    version: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
    state: {
      type: 'text',
      notNull: true,
      default: 'open',
    },
    winning_outcome: {
      type: 'text',
    },
    created_at: {
      type: 'timestamptz',
      default: pgm.func('now()'),
    },
  });

  // ---- trades ----
  pgm.createTable('trades', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users(id)',
    },
    market_id: {
      type: 'bigint',
      notNull: true,
      references: 'markets(id)',
    },
    outcome: {
      type: 'text',
      notNull: true,
      check: "outcome IN ('yes', 'no')",
    },
    shares: {
      type: 'double precision',
      notNull: true,
    },
    // Cost in micro-units (integer)
    cost: {
      type: 'bigint',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      default: pgm.func('now()'),
    },
  });

  // ---- positions ----
  pgm.createTable('positions', {
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users(id)',
    },
    market_id: {
      type: 'bigint',
      notNull: true,
      references: 'markets(id)',
    },
    outcome: {
      type: 'text',
      notNull: true,
    },
    shares: {
      type: 'double precision',
      notNull: true,
      default: 0,
    },
  });
  pgm.addConstraint('positions', 'positions_pkey', 'PRIMARY KEY (user_id, market_id, outcome)');

  // ---- outbox ----
  pgm.createTable('outbox', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    event_type: {
      type: 'text',
      notNull: true,
    },
    payload: {
      type: 'jsonb',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      default: pgm.func('now()'),
    },
    // Set by the relay when the event is published to Redis
    published_at: {
      type: 'timestamptz',
    },
  });

  // ---- indexes ----

  // Fast open-market queries
  pgm.createIndex('markets', 'state');

  // Trades lookup by user / market (position queries, history)
  pgm.createIndex('trades', 'user_id');
  pgm.createIndex('trades', 'market_id');

  // Outbox relay polls for unpublished rows
  pgm.createIndex('outbox', 'published_at', {
    where: 'published_at IS NULL',
    name: 'outbox_unpublished_idx',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('outbox');
  pgm.dropTable('positions');
  pgm.dropTable('trades');
  pgm.dropTable('markets');
  pgm.dropTable('users');
};
