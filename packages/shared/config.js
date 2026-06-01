import 'dotenv/config';

export const config = {
  pg: {
    host:             process.env.PG_HOST             || 'localhost',
    port:             parseInt(process.env.PG_PORT)   || 5432,
    user:             process.env.PG_USER             || 'app',
    password:         process.env.PG_PASSWORD         || 'app',
    database:         process.env.PG_DATABASE         || 'playground',
    poolMax:          parseInt(process.env.PG_POOL_MAX) || 10,
    statementTimeout: parseInt(process.env.PG_STATEMENT_TIMEOUT) || 0,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },
  app: {
    port:        parseInt(process.env.APP_PORT)     || 8080,
    metricsPort: parseInt(process.env.METRICS_PORT) || 9100,
  },
};
