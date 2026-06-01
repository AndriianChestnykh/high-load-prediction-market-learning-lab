import Redis from 'ioredis';
import { config } from './config.js';

let _client = null;

export function getRedis() {
  if (!_client) {
    _client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    _client.on('error', (err) => {
      console.error('[redis] error', err.message);
    });
  }
  return _client;
}

export async function closeRedis() {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
