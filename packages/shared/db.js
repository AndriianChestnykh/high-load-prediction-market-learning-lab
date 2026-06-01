import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

let _pool = null;

export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host:               config.pg.host,
      port:               config.pg.port,
      user:               config.pg.user,
      password:           config.pg.password,
      database:           config.pg.database,
      max:                config.pg.poolMax,
      idleTimeoutMillis:  30_000,
      connectionTimeoutMillis: 3_000,
      statement_timeout:  config.pg.statementTimeout || undefined,
    });

    _pool.on('error', (err) => {
      console.error('[pg pool] idle client error', err.message);
    });
  }
  return _pool;
}

export async function query(sql, params) {
  return getPool().query(sql, params);
}

export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// Expose pool stats for metrics (totalCount, idleCount, waitingCount)
export function poolStats() {
  if (!_pool) return { total: 0, idle: 0, waiting: 0 };
  return {
    total:   _pool.totalCount,
    idle:    _pool.idleCount,
    waiting: _pool.waitingCount,
  };
}
