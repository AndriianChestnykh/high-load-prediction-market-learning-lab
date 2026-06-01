import 'dotenv/config';
import { getRedis } from '@hli/shared';

// ── TODO: flesh out consumer groups, XACK, pending entries ───────────────

const STREAM   = 'orders:events';
const GROUP    = process.env.GROUP    || 'processors';
const CONSUMER = process.env.CONSUMER || `worker-${process.pid}`;
const BATCH    = parseInt(process.env.BATCH) || 10;

const redis = getRedis();

async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    console.log(`[consumer] created group "${GROUP}"`);
  } catch (e) {
    if (!e.message.includes('BUSYGROUP')) throw e;
  }
}

async function consume() {
  await ensureGroup();
  console.log(`[consumer] ${CONSUMER} reading from "${STREAM}" group "${GROUP}" batch=${BATCH}`);
  let processed = 0;
  while (true) {
    const results = await redis.xreadgroup(
      'GROUP', GROUP, CONSUMER,
      'COUNT', BATCH,
      'BLOCK', 2000,
      'STREAMS', STREAM, '>'
    );

    if (!results) continue; // timeout — no new messages

    for (const [, messages] of results) {
      for (const [id, fields] of messages) {
        // TODO: do real work here (e.g. write to Postgres)
        await redis.xack(STREAM, GROUP, id);
        processed++;
        if (processed % 100 === 0) console.log(`[consumer] processed ${processed} events`);
      }
    }
  }
}

consume().catch(err => { console.error(err); process.exit(1); });
