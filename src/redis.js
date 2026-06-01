'use strict';

require('dotenv').config();
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL, {
  // Lazy connect so the process can start even if Redis is temporarily down.
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis client error:', err.message);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

module.exports = { redis };
