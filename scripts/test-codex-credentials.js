#!/usr/bin/env node
/**
 * Test runner for Codex credentials management
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🧪 Running Codex Credentials Management Tests...\n');

const testFile = join(projectRoot, 'tests', 'unit', 'providers', 'codexCredentials.test.js');

const child = spawn('node', ['--test', testFile], {
  stdio: 'inherit',
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test'
  }
});

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\n✅ All Codex credentials tests passed!');
  } else {
    console.log('\n❌ Some tests failed.');
    process.exit(code);
  }
});

child.on('error', (error) => {
  console.error('Failed to run tests:', error.message);
  process.exit(1);
});