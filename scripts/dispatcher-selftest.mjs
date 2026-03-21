#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const script = path.resolve('F:/openclaw/workspace/scripts/continuous-dispatcher-selftest.mjs');
const raw = execFileSync(process.execPath, [script], { encoding: 'utf8' });
process.stdout.write(raw);
