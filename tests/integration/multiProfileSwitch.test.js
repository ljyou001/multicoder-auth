/**
 * Multi-Profile Switching Integration Test
 *
 * Tests real profile switching with Gemini provider
 * This test uses API keys to avoid OAuth flow complexity
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProfileManager } from '../../dist/core/profile/profileManager.js';
import { CredentialManager } from '../../dist/core/auth/credentialManager.js';
import { createGeminiAdapter } from '../../dist/core/provider/adapters/geminiCliAdapter.js';

const TEST_DIR = path.join(os.tmpdir(), 'unycode-integration-test');

test('Multi-Profile Switching - Gemini with API Key', { skip: !process.env.GOOGLE_API_KEY }, async () => {
  console.log('\n🔧 Testing Multi-Profile Switching with Gemini...');

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.log('⏭️  Skipping: GOOGLE_API_KEY not set');
    return;
  }

  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  try {
    // Create two profiles with different API keys (same key for testing)
    console.log('📝 Creating profile: gemini-profile-1');
    const profile1 = await profileManager.createProfileWithApiKey(
      'gemini-profile-1',
      'gemini',
      apiKey,
      {
        model: 'gemini-2.0-flash-exp',
        permissionMode: 'allow',
      },
    );

    console.log('📝 Creating profile: gemini-profile-2');
    const profile2 = await profileManager.createProfileWithApiKey(
      'gemini-profile-2',
      'gemini',
      apiKey,
      {
        model: 'gemini-2.0-flash-exp',
        permissionMode: 'ask',
      },
    );

    assert.ok(profile1, 'Profile 1 should be created');
    assert.ok(profile2, 'Profile 2 should be created');

    // Switch to profile 1
    console.log('\n🔄 Switching to profile 1...');
    const switch1 = await profileManager.switchProfile('gemini-profile-1');
    assert.strictEqual(switch1.profile.name, 'gemini-profile-1');
    assert.strictEqual(switch1.needsRestart, false, 'API key switch should not need restart');
    console.log('✓ Switched to profile 1');
    console.log(`  Permission mode: ${switch1.profile.permissionMode}`);

    // Verify environment variable is set
    assert.ok(switch1.envVars.GOOGLE_API_KEY, 'GOOGLE_API_KEY should be set');

    // Switch to profile 2
    console.log('\n🔄 Switching to profile 2...');
    const switch2 = await profileManager.switchProfile('gemini-profile-2');
    assert.strictEqual(switch2.profile.name, 'gemini-profile-2');
    console.log('✓ Switched to profile 2');
    console.log(`  Permission mode: ${switch2.profile.permissionMode}`);

    // List all profiles
    const profiles = profileManager.list();
    console.log(`\n📋 Total profiles: ${profiles.length}`);
    profiles.forEach((p) => {
      console.log(`  - ${p.name} (${p.providerId}, ${p.permissionMode})`);
    });

    assert.strictEqual(profiles.length, 2, 'Should have 2 profiles');

    // Test sending a message with current profile (profile 2)
    console.log('\n📤 Testing message send with profile 2...');
    const adapter = createGeminiAdapter();

    const response = await adapter.sendMessage({
      profile: switch2.profile,
      message: { text: 'Say hello in one word' },
      history: [],
      attachments: [],
      directories: [],
      permissionMode: switch2.profile.permissionMode,
    });

    console.log('📥 Response received:');
    console.log(`  Text: ${response.text.substring(0, 100)}`);
    assert.ok(response.text, 'Should receive response text');

    // Delete profile 1
    console.log('\n🗑️  Deleting profile 1...');
    const deleted = profileManager.delete('gemini-profile-1');
    assert.strictEqual(deleted, true, 'Should delete successfully');

    const remainingProfiles = profileManager.list();
    assert.strictEqual(remainingProfiles.length, 1, 'Should have 1 profile remaining');
    console.log('✓ Profile 1 deleted');

    console.log('\n✅ Multi-Profile switching test completed successfully');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    // Cleanup
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    console.log('🧹 Cleanup completed');
  }
});

console.log('\nℹ️  To run this test with your Gemini API key:');
console.log('   export GOOGLE_API_KEY=your-api-key');
console.log('   node --test tests/integration/multiProfileSwitch.test.js');
