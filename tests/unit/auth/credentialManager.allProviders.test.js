/**
 * CredentialManager Unit Tests - All Providers
 *
 * Tests credential management for all supported providers:
 * - Claude
 * - Gemini
 * - Codex
 * - Amazon Q
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CredentialManager } from '../../../dist/core/auth/credentialManager.js';

const TEST_DIR = path.join(os.tmpdir(), 'multicoder-test-all-providers');

// Test all providers with API key support
const API_KEY_PROVIDERS = [
  { id: 'anthropic', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'gemini', envVar: 'GOOGLE_API_KEY' },
  { id: 'codex', envVar: null },
  { id: 'q', envVar: null },
];

// Test native credential detection
const OAUTH_PROVIDERS = [
  { id: 'claude', nativePath: path.join(os.homedir(), '.claude', '.credentials.json') },
  { id: 'gemini', nativePath: path.join(os.homedir(), '.gemini', 'oauth_creds.json') },
  { id: 'codex', nativePath: path.join(os.homedir(), '.codex', 'auth.json') },
  { id: 'q', nativePath: path.join(os.homedir(), '.aws', 'sso', 'cache') },  // OAuth cache dir
];

test('CredentialManager - Save API keys for all providers', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  const testData = [
    { provider: 'anthropic', profile: 'anthropic-test', key: 'sk-ant-api03-abc123' },
    { provider: 'gemini', profile: 'gemini-test', key: 'gemini-api-key-123' },
    { provider: 'codex', profile: 'codex-test', key: 'codex-api-key-456' },
    { provider: 'q', profile: 'q-test', key: 'q-api-key-789' },
  ];

  for (const { provider, profile, key } of testData) {
    console.log(`Testing ${provider}...`);
    await credManager.saveApiKey(provider, profile, key);

    const credInfo = await credManager.getCredentialInfo(provider, profile);
    assert.ok(credInfo, `${provider} credential should exist`);
    assert.strictEqual(credInfo.source, 'managed', `${provider} should be managed`);
    assert.strictEqual(credInfo.providerId, provider);

    // Verify file contents
    const fileContent = await fs.readFile(credInfo.path, 'utf-8');
    const data = JSON.parse(fileContent);
    assert.strictEqual(data.apiKey, key, `${provider} API key should match`);
  }

  console.log('✅ All providers saved successfully');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - List profiles across providers', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  // Create multiple profiles per provider
  await credManager.saveApiKey('anthropic', 'anthropic-1', 'key0');
  await credManager.saveApiKey('gemini', 'gemini-1', 'key1');
  await credManager.saveApiKey('gemini', 'gemini-2', 'key2');
  await credManager.saveApiKey('codex', 'codex-1', 'key3');
  await credManager.saveApiKey('codex', 'codex-2', 'key4');
  await credManager.saveApiKey('codex', 'codex-3', 'key5');
  await credManager.saveApiKey('q', 'q-1', 'key6');

  const anthropicProfiles = await credManager.listManagedProfiles('anthropic');
  const geminiProfiles = await credManager.listManagedProfiles('gemini');
  const codexProfiles = await credManager.listManagedProfiles('codex');
  const qProfiles = await credManager.listManagedProfiles('q');

  assert.strictEqual(anthropicProfiles.length, 1, 'Should have 1 anthropic profile');
  assert.strictEqual(geminiProfiles.length, 2, 'Should have 2 gemini profiles');
  assert.strictEqual(codexProfiles.length, 3, 'Should have 3 codex profiles');
  assert.strictEqual(qProfiles.length, 1, 'Should have 1 q profile');

  console.log(`✅ Profiles: Anthropic(${anthropicProfiles.length}), Gemini(${geminiProfiles.length}), Codex(${codexProfiles.length}), Q(${qProfiles.length})`);

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Apply credentials with env vars', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  // Gemini supports GOOGLE_API_KEY
  await credManager.saveApiKey('gemini', 'test', 'gemini-key');
  const geminiResult = await credManager.applyCredentials('gemini', 'test');

  assert.strictEqual(geminiResult.needsRestart, false, 'Gemini should not need restart');
  assert.ok(geminiResult.envVars.GOOGLE_API_KEY, 'Should set GOOGLE_API_KEY');
  assert.strictEqual(geminiResult.envVars.GOOGLE_API_KEY, 'gemini-key');

  console.log('✅ Gemini env var applied');

  // Codex doesn't have env var support (requires native file)
  await credManager.saveApiKey('codex', 'test', 'codex-key');
  const codexResult = await credManager.applyCredentials('codex', 'test');

  // Should attempt to copy to native location (which will need restart)
  assert.strictEqual(codexResult.needsRestart, true, 'Codex should need restart');

  console.log('✅ Codex requires restart (expected)');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Check native credential detection', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  for (const { id, nativePath } of OAUTH_PROVIDERS) {
    console.log(`Checking ${id} native credentials at ${nativePath}...`);

    // This test just checks if the detection logic works
    // We don't actually verify the file exists (depends on user's system)
    const credInfo = await credManager.getCredentialInfo(id, 'test-native');

    if (credInfo && credInfo.source === 'native') {
      console.log(`  ✓ ${id} has native credentials`);

      // For q provider, path is a cache file inside the directory, not the directory itself
      if (id === 'q') {
        assert.ok(credInfo.path.startsWith(nativePath), `${id} path should start with ${nativePath}`);
      } else {
        assert.strictEqual(credInfo.path, nativePath);
      }
    } else {
      console.log(`  ○ ${id} no native credentials found (expected if not logged in)`);
    }
  }

  console.log('✅ Native credential detection tested');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Clear credentials for all providers', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  const providers = ['anthropic', 'gemini', 'codex', 'q'];

  // Save managed credentials
  for (const provider of providers) {
    await credManager.saveApiKey(provider, 'test', 'key');
  }

  // Verify saved as managed
  for (const provider of providers) {
    const credInfo = await credManager.getCredentialInfo(provider, 'test');
    assert.ok(credInfo, `${provider} should have credentials`);
    assert.strictEqual(credInfo.source, 'managed', `${provider} should be managed initially`);
  }

  // Clear managed credentials
  for (const provider of providers) {
    await credManager.clearCredentials(provider, 'test');
  }

  // Verify managed credentials are cleared
  // Note: May still find native credentials if they exist on the system
  for (const provider of providers) {
    const credInfo = await credManager.getCredentialInfo(provider, 'test');

    if (credInfo && credInfo.source === 'native') {
      console.log(`  ✓ ${provider} managed cleared (native still exists, which is ok)`);
    } else {
      assert.strictEqual(credInfo, null, `${provider} managed credentials should be cleared`);
      console.log(`  ✓ ${provider} fully cleared`);
    }
  }

  console.log('✅ All providers cleared successfully');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Handle provider-specific errors', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  // Test invalid provider
  try {
    await credManager.getCredentialInfo('invalid-provider', 'test');
    assert.fail('Should throw for invalid provider');
  } catch (error) {
    assert.ok(error.message.includes('Unknown provider'));
  }

  // Test missing managed credentials (check that managed storage is empty)
  // Note: Native credentials may exist on the system, which is fine
  const managedProfiles = await credManager.listManagedProfiles('gemini');
  assert.strictEqual(managedProfiles.length, 0, 'Should have no managed profiles initially');

  console.log('✅ Error handling works correctly');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Provider directory structure', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  // Create profiles for different providers
  await credManager.saveApiKey('anthropic', 'profile1', 'key0');
  await credManager.saveApiKey('gemini', 'profile1', 'key1');
  await credManager.saveApiKey('codex', 'profile1', 'key2');
  await credManager.saveApiKey('q', 'profile1', 'key3');

  // Check directory structure
  const credDir = path.join(TEST_DIR, 'credentials');

  const anthropicDir = path.join(credDir, 'anthropic');
  const geminiDir = path.join(credDir, 'gemini');
  const codexDir = path.join(credDir, 'codex');
  const qDir = path.join(credDir, 'q');

  assert.ok((await fs.stat(anthropicDir)).isDirectory(), 'Anthropic dir should exist');
  assert.ok((await fs.stat(geminiDir)).isDirectory(), 'Gemini dir should exist');
  assert.ok((await fs.stat(codexDir)).isDirectory(), 'Codex dir should exist');
  assert.ok((await fs.stat(qDir)).isDirectory(), 'Q dir should exist');

  // Check files exist
  const anthropicFile = path.join(anthropicDir, 'profile1.json');
  const geminiFile = path.join(geminiDir, 'profile1.json');
  const codexFile = path.join(codexDir, 'profile1.json');
  const qFile = path.join(qDir, 'profile1.json');

  assert.ok((await fs.stat(anthropicFile)).isFile(), 'Anthropic file should exist');
  assert.ok((await fs.stat(geminiFile)).isFile(), 'Gemini file should exist');
  assert.ok((await fs.stat(codexFile)).isFile(), 'Codex file should exist');
  assert.ok((await fs.stat(qFile)).isFile(), 'Q file should exist');

  console.log('✅ Directory structure correct for all providers');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

console.log('✅ All multi-provider tests completed');
