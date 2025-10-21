/**
 * CredentialManager Unit Tests
 *
 * Tests the credential management system including:
 * - Credential storage and retrieval
 * - API key management
 * - Native credential detection
 * - Credential validation and expiry
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CredentialManager } from '../../../dist/core/auth/credentialManager.js';

const TEST_DIR = path.join(os.tmpdir(), 'multicoder-test-creds');

test('CredentialManager - Initialize and create directories', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  const credDir = path.join(TEST_DIR, 'credentials');
  const stat = await fs.stat(credDir);
  assert.ok(stat.isDirectory(), 'Credentials directory should exist');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Save and retrieve API key', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  const providerId = 'gemini';
  const profileName = 'test-profile';
  const apiKey = 'test-api-key-12345';

  // Save API key
  await credManager.saveApiKey(providerId, profileName, apiKey);

  // Retrieve credential info
  const credInfo = await credManager.getCredentialInfo(providerId, profileName);

  assert.ok(credInfo, 'Credential info should exist');
  assert.strictEqual(credInfo.source, 'managed', 'Should be managed credential');
  assert.strictEqual(credInfo.providerId, providerId);
  assert.strictEqual(credInfo.profileName, profileName);
  assert.ok(credInfo.path, 'Should have a file path');

  // Verify file contents
  const fileContent = await fs.readFile(credInfo.path, 'utf-8');
  const data = JSON.parse(fileContent);
  assert.strictEqual(data.apiKey, apiKey, 'API key should match');
  assert.strictEqual(data.providerId, providerId);

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Validate credentials without expiry', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  await credManager.saveApiKey('gemini', 'test', 'api-key');
  const credInfo = await credManager.getCredentialInfo('gemini', 'test');

  assert.ok(credInfo, 'Credential should exist');
  assert.strictEqual(
    credManager.isCredentialValid(credInfo),
    true,
    'Credential without expiry should be valid',
  );

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Detect expired credentials', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  await credManager.saveApiKey('gemini', 'test', 'api-key');
  const credInfo = await credManager.getCredentialInfo('gemini', 'test');

  // Manually set expiry to the past
  credInfo.expiresAt = Date.now() - 1000;

  assert.strictEqual(
    credManager.isCredentialValid(credInfo),
    false,
    'Expired credential should be invalid',
  );

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Apply credentials with API key', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  const apiKey = 'test-api-key';
  await credManager.saveApiKey('gemini', 'test-profile', apiKey);

  const { envVars, needsRestart } = await credManager.applyCredentials('gemini', 'test-profile');

  assert.strictEqual(needsRestart, false, 'API key switch should not need restart');
  assert.ok(envVars.GOOGLE_API_KEY, 'Should set GOOGLE_API_KEY env var');
  assert.strictEqual(envVars.GOOGLE_API_KEY, apiKey);

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - List managed profiles', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  // Create multiple profiles
  await credManager.saveApiKey('gemini', 'profile1', 'key1');
  await credManager.saveApiKey('gemini', 'profile2', 'key2');
  await credManager.saveApiKey('codex', 'profile3', 'key3');

  const geminiProfiles = await credManager.listManagedProfiles('gemini');
  const codexProfiles = await credManager.listManagedProfiles('codex');

  assert.strictEqual(geminiProfiles.length, 2, 'Should have 2 gemini profiles');
  assert.ok(geminiProfiles.includes('profile1'), 'Should include profile1');
  assert.ok(geminiProfiles.includes('profile2'), 'Should include profile2');

  assert.strictEqual(codexProfiles.length, 1, 'Should have 1 codex profile');
  assert.ok(codexProfiles.includes('profile3'), 'Should include profile3');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Clear credentials', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  await credManager.saveApiKey('gemini', 'test', 'api-key');
  let credInfo = await credManager.getCredentialInfo('gemini', 'test');
  assert.strictEqual(credInfo.source, 'managed', 'Should be managed before clearing');

  await credManager.clearCredentials('gemini', 'test');
  credInfo = await credManager.getCredentialInfo('gemini', 'test');

  // After clearing managed credentials, may still find native credentials
  if (credInfo && credInfo.source === 'native') {
    assert.ok(true, 'Native credentials still exist, which is expected');
  } else {
    assert.strictEqual(credInfo, null, 'No credentials should exist');
  }

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CredentialManager - Handle non-existent provider', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  await credManager.initialize();

  try {
    await credManager.getCredentialInfo('nonexistent', 'test');
    assert.fail('Should throw for unknown provider');
  } catch (error) {
    assert.ok(error.message.includes('Unknown provider'), 'Should throw unknown provider error');
  }

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

console.log('✅ All CredentialManager tests completed');
