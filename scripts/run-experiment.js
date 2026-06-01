#!/usr/bin/env node
// Usage: pnpm exp <experiment-number>
// Example: pnpm exp 01
//          PG_POOL_MAX=20 pnpm exp 01

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg  = process.argv[2];

if (!arg) {
  console.error('Usage: pnpm exp <experiment-number>  e.g. pnpm exp 01');
  process.exit(1);
}

const dirs = readdirSync(path.join(ROOT, 'experiments'));
const match = dirs.find(d => d.startsWith(arg.padStart(2, '0') + '-') || d.startsWith(arg + '-'));

if (!match) {
  console.error(`No experiment matching "${arg}". Available:`, dirs.join(', '));
  process.exit(1);
}

const expDir = path.join(ROOT, 'experiments', match);
const appJs  = path.join(expDir, 'app.js');

if (!existsSync(appJs)) {
  console.error(`No app.js in ${expDir}`);
  process.exit(1);
}

console.log(`\n▶  Starting experiment: ${match}`);
console.log(`   Dir: ${expDir}\n`);

// Load .env from repo root if present
process.chdir(ROOT);
execSync(`node --env-file=.env ${appJs}`, {
  stdio: 'inherit',
  env: { ...process.env },
  cwd: expDir,
});
