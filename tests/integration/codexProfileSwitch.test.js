/**
 * Codex Multi-Profile Switching Integration Test
 *
 * Tests real profile switching with Codex provider
 * Requires Codex CLI to be installed and authenticated
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProfileManager } from '../../dist/core/profile/profileManager.js';
import { CredentialManager } from '../../dist/core/auth/credentialManager.js';

const TEST_DIR = path.join(os.tmpdir(), 'unycode-codex-test');

test('Codex Profile Switching - Native Credentials', async () => {
  console.log('\n🔧 Testing Codex Profile Switching...');

  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  try {
    // Check if Codex native credentials exist
    const nativeAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
    let hasNativeAuth = false;

    try {
      await fs.access(nativeAuthPath);
      hasNativeAuth = true;
      console.log('✓ Found Codex native credentials');
    } catch {
      console.log('⏭️  No Codex native credentials found');
      console.log('   Please run: codex login');
      return; // Skip test
    }

    if (!hasNativeAuth) {
      return;
    }

    // Create profile from native credentials
    console.log('\n📝 Creating Codex profile from native credentials...');
    const profile = await profileManager.createProfileFromNative('codex-main', 'codex', {
      model: 'gpt-5-codex',
      permissionMode: 'ask',
      copyToManaged: false, // Use native directly
    });

    assert.ok(profile, 'Profile should be created');
    assert.strictEqual(profile.name, 'codex-main');
    assert.strictEqual(profile.providerId, 'codex');
    assert.strictEqual(profile.credentialSource, 'native');
    console.log('✓ Profile created');

    // Check credential validity
    console.log('\n🔍 Checking credential validity...');
    const isValid = await profileManager.hasValidCredentials('codex-main');
    console.log(`  Credentials valid: ${isValid ? '✓' : '✗'}`);

    if (!isValid) {
      console.log('⚠️  Credentials may be expired. Try: codex login');
    }

    // Get credential info
    const credInfo = await profileManager.getCredentialInfo('codex-main');
    console.log('\n📋 Credential Info:');
    console.log(`  Source: ${credInfo?.source}`);
    console.log(`  Path: ${credInfo?.path}`);
    if (credInfo?.expiresAt) {
      const expiryDate = new Date(credInfo.expiresAt);
      console.log(`  Expires: ${expiryDate.toLocaleString()}`);
    }

    // Switch to profile
    console.log('\n🔄 Switching to Codex profile...');
    const { profile: switched, needsRestart, envVars } =
      await profileManager.switchProfile('codex-main');

    assert.strictEqual(switched.name, 'codex-main');
    console.log('✓ Switched to profile');
    console.log(`  Model: ${switched.model}`);
    console.log(`  Permission: ${switched.permissionMode}`);
    console.log(`  Needs restart: ${needsRestart ? 'Yes' : 'No'}`);

    if (Object.keys(envVars).length > 0) {
      console.log('  Environment variables set:');
      for (const [key, value] of Object.entries(envVars)) {
        console.log(`    ${key}=${value.substring(0, 20)}...`);
      }
    }

    // List profiles
    const profiles = profileManager.list();
    console.log(`\n📋 Total profiles: ${profiles.length}`);

    console.log('\n✅ Codex profile switching test completed');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);

    if (error.message.includes('not found') || error.message.includes('ENOENT')) {
      console.log('\n💡 Make sure Codex CLI is installed and authenticated:');
      console.log('   npm install -g @openai/codex');
      console.log('   codex login');
    }

    throw error;
  } finally {
    // Cleanup
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    console.log('🧹 Cleanup completed');
  }
});

test('Codex Multi-Account Support', async () => {
  console.log('\n🔧 Testing Codex Multi-Account...');

  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  try {
    // Check if native auth exists
    const nativeAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
    try {
      await fs.access(nativeAuthPath);
    } catch {
      console.log('⏭️  Skipping: No Codex credentials');
      return;
    }

    console.log('📝 Testing profile with account hint...');

    // Create profile with account hint (for Codex's internal multi-account)
    const profile = await profileManager.createProfileFromNative('codex-account-1', 'codex', {
      copyToManaged: false,
    });

    // Manually set account hint (simulating multi-account scenario)
    profile.providerAccountHint = '1';
    profileManager.update(profile);

    const retrieved = profileManager.get('codex-account-1');
    assert.strictEqual(retrieved?.providerAccountHint, '1', 'Account hint should be preserved');

    console.log('✓ Multi-account hint stored correctly');
    console.log(`  Account hint: ${retrieved?.providerAccountHint}`);

    console.log('\n✅ Multi-account test completed');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  } finally {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  }
});

console.log('\n💡 Codex Integration Tests');
console.log('   These tests require Codex CLI to be installed and authenticated');
console.log('   Run: codex login');
