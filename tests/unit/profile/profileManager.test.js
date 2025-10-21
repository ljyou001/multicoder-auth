/**
 * ProfileManager Unit Tests with Credential Management
 *
 * Tests the enhanced ProfileManager with:
 * - Profile creation with different credential types
 * - Profile switching with credential application
 * - Credential validation
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProfileManager } from '../../../dist/core/profile/profileManager.js';
import { CredentialManager } from '../../../dist/core/auth/credentialManager.js';

const TEST_DIR = path.join(os.tmpdir(), 'unycode-test-profiles');

test('ProfileManager - Initialize with credential manager', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });

  await profileManager.initialize();

  const credDir = path.join(TEST_DIR, 'credentials');
  const stat = await fs.stat(credDir);
  assert.ok(stat.isDirectory(), 'Should initialize credentials directory');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - Create profile with API key', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  const apiKey = 'test-api-key-xyz';
  const profile = await profileManager.createProfileWithApiKey(
    'gemini-test',
    'gemini',
    apiKey,
    {
      model: 'gemini-2.0-flash-exp',
      permissionMode: 'allow',
    },
  );

  assert.strictEqual(profile.name, 'gemini-test');
  assert.strictEqual(profile.providerId, 'gemini');
  assert.strictEqual(profile.model, 'gemini-2.0-flash-exp');
  assert.strictEqual(profile.permissionMode, 'allow');
  assert.strictEqual(profile.credentialSource, 'managed');

  // Verify credential was saved
  const credInfo = await profileManager.getCredentialInfo('gemini-test');
  assert.ok(credInfo, 'Credential should exist');
  assert.strictEqual(credInfo.source, 'managed');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - Check valid credentials', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  await profileManager.createProfileWithApiKey('test-prof', 'gemini', 'api-key');

  const hasValid = await profileManager.hasValidCredentials('test-prof');
  assert.strictEqual(hasValid, true, 'Should have valid credentials');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - Switch profile with credentials', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  // Create two profiles
  const profile1 = await profileManager.createProfileWithApiKey('gemini1', 'gemini', 'key1');
  const profile2 = await profileManager.createProfileWithApiKey('gemini2', 'gemini', 'key2');

  // Switch to profile1
  const { profile, needsRestart, envVars } = await profileManager.switchProfile('gemini1');

  assert.strictEqual(profile.name, 'gemini1');
  assert.strictEqual(needsRestart, false, 'API key switch should not need restart');
  assert.ok(envVars.GOOGLE_API_KEY, 'Should set env var');
  assert.strictEqual(envVars.GOOGLE_API_KEY, 'key1');

  assert.ok(profile.lastUsedAt, 'Should update lastUsedAt timestamp');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - List and delete profiles', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  await profileManager.createProfileWithApiKey('prof1', 'gemini', 'key1');
  await profileManager.createProfileWithApiKey('prof2', 'codex', 'key2');

  let profiles = profileManager.list();
  assert.strictEqual(profiles.length, 2, 'Should have 2 profiles');

  const deleted = profileManager.delete('prof1');
  assert.strictEqual(deleted, true, 'Should delete successfully');

  profiles = profileManager.list();
  assert.strictEqual(profiles.length, 1, 'Should have 1 profile left');
  assert.strictEqual(profiles[0].name, 'prof2');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - Fail to switch to non-existent profile', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  try {
    await profileManager.switchProfile('nonexistent');
    assert.fail('Should throw for non-existent profile');
  } catch (error) {
    assert.ok(error.message.includes('not found'), 'Should throw not found error');
  }

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - Fail to switch profile without provider', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  const profile = profileManager.ensure('test-prof');
  // Profile has no providerId

  try {
    await profileManager.switchProfile('test-prof');
    assert.fail('Should throw for profile without provider');
  } catch (error) {
    assert.ok(
      error.message.includes('does not have a provider'),
      'Should throw no provider error',
    );
  }

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - Fail to create duplicate profile', async () => {
  const credManager = new CredentialManager(TEST_DIR);
  const profileManager = new ProfileManager({ credentialManager: credManager });
  await profileManager.initialize();

  await profileManager.createProfileWithApiKey('dup', 'gemini', 'key1');

  try {
    await profileManager.createProfileWithApiKey('dup', 'gemini', 'key2');
    assert.fail('Should throw for duplicate profile');
  } catch (error) {
    assert.ok(error.message.includes('already exists'), 'Should throw already exists error');
  }

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

console.log('✅ All ProfileManager tests completed');
