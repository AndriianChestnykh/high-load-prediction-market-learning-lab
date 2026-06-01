#!/usr/bin/env node
// Usage: pnpm exp:load <experiment-number>
// Runs k6 via the Docker Compose profile.
// Passes EXP_SCRIPT so the k6 container runs the right loadtest file.

import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg  = process.argv[2];

if (!arg) {
  console.error('Usage: pnpm exp:load <experiment-number>  e.g. pnpm exp:load 01');
  process.exit(1);
}

const dirs  = readdirSync(path.join(ROOT, 'experiments'));
const match = dirs.find(d => d.startsWith(arg.padStart(2, '0') + '-') || d.startsWith(arg + '-'));

if (!match) {
  console.error(`No experiment matching "${arg}". Available:`, dirs.join(', '));
  process.exit(1);
}

const script = `${match}/loadtest.k6.js`;
console.log(`\n▶  Running k6 for: ${match}`);
console.log(`   Script: /experiments/${script}\n`);

const compose = `docker compose -f infra/docker-compose.yml --profile load`;
const env = `EXP_SCRIPT=${script}`;

execSync(
  `${env} ${compose} run --rm k6 run /experiments/${script} --out experimental-prometheus-rw`,
  { stdio: 'inherit', cwd: ROOT }
);
