#!/usr/bin/env node

/**
 * Quick verification script to check if all providers load correctly.
 * This is NOT a unit test - just a sanity check for development.
 */

import { ProviderRegistry } from '../dist/core/provider/providerRegistry.js';
import { registerDefaultProviders } from '../dist/core/provider/registerDefaultProviders.js';

console.log('🔍 Verifying Provider Adapters...\n');

try {
  const registry = new ProviderRegistry();
  registerDefaultProviders(registry);

  const providers = registry.list();

  console.log(`✅ Successfully loaded ${providers.length} providers:\n`);

  for (const desc of providers) {
    console.log(`📦 ${desc.title} (${desc.id})`);
    console.log(`   Binary: ${desc.binary}`);
    console.log(`   Env Var: ${desc.binaryEnvVar || 'N/A'}`);
    console.log(`   Default Model: ${desc.defaultModel || 'N/A'}`);
    console.log('');
  }

  // Verify specific providers
  console.log('🔍 Verifying specific providers:\n');

  const codex = registry.get('codex');
  console.log(codex ? '✅ Codex: OK' : '❌ Codex: MISSING');

  const gemini = registry.get('gemini');
  console.log(gemini ? '✅ Gemini: OK' : '❌ Gemini: MISSING');

  const claude = registry.get('claude');
  console.log(claude ? '✅ Claude: OK' : '❌ Claude: MISSING');

  console.log('\n✅ All provider adapters loaded successfully!');
  console.log('\n💡 To run actual unit tests, use:');
  console.log('   npm test              # Run all tests');
  console.log('   npm run test:codex    # Test Codex provider');
  console.log('   npm run test:gemini   # Test Gemini provider');
  console.log('   npm run test:claude   # Test Claude provider');

  process.exit(0);
} catch (error) {
  console.error('\n❌ Error loading providers:', error);
  process.exit(1);
}
