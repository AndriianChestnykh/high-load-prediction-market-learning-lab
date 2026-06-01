import 'dotenv/config';
import { getRedis } from '@hli/shared';

// ── TODO: flesh out producer → consumer group experiment ─────────────────
// See README for the full scenario.

const STREAM = 'orders:events';
const RATE_MS = parseInt(process.env.RATE_MS) || 50; // events per RATE_MS

const redis = getRedis();

async function produce() {
  let seq = 0;
  console.log(`[producer] writing to stream "${STREAM}" every ${RATE_MS}ms`);
  while (true) {
    await redis.xadd(STREAM, '*',
      'type',      'order.created',
      'order_id',  ++seq,
      'user_id',   Math.floor(Math.random() * 1000) + 1,
      'amount',    (Math.random() * 500).toFixed(2),
      'ts',        Date.now(),
    );
    if (seq % 100 === 0) console.log(`[producer] produced ${seq} events`);
    await new Promise(r => setTimeout(r, RATE_MS));
  }
}

produce().catch(err => { console.error(err); process.exit(1); });
