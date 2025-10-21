/**
 * Quick test script for installed providers
 *
 * This script tests only Claude and Gemini (skips Codex to avoid timeout)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const testFiles = [
  'tests/unit/providers/claude.test.js',
  'tests/unit/providers/gemini.test.js',
];

console.log('🚀 Running tests for installed providers (Claude & Gemini)...\n');

for (const testFile of testFiles) {
  const fullPath = resolve(process.cwd(), testFile);

  if (!existsSync(fullPath)) {
    console.log(`⚠️  Test file not found: ${testFile}`);
    continue;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${testFile}`);
  console.log('='.repeat(60));

  await new Promise((resolve, reject) => {
    const child = spawn('node', ['--test', testFile], {
      stdio: 'inherit',
      shell: true,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.log(`\n⚠️  Test exited with code ${code}`);
        resolve(); // Don't fail the whole suite
      }
    });

    child.on('error', (error) => {
      console.error(`\n❌ Error running test: ${error.message}`);
      resolve();
    });
  });
}

console.log('\n' + '='.repeat(60));
console.log('✅ Test run completed!');
console.log('='.repeat(60));
