/**
 * Profile Persistence Tests
 *
 * Tests that profiles are correctly saved to and loaded from profiles.json
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProfileManager } from '../../../dist/core/profile/profileManager.js';

const TEST_DIR = path.join(os.tmpdir(), 'multicoder-test-profile-persistence');

test('ProfileManager - Save and load profiles', async () => {
  console.log('\n🧪 Testing Profile Persistence...');

  // Create ProfileManager with test directory
  const profileManager1 = new ProfileManager({ configDir: TEST_DIR });
  await profileManager1.initialize();

  // Create some profiles
  const profile1 = profileManager1.ensure('test-profile-1');
  profile1.providerId = 'gemini';
  profile1.model = 'gemini-2.0-flash-exp';
  profileManager1.update(profile1);

  const profile2 = profileManager1.ensure('test-profile-2');
  profile2.providerId = 'claude';
  profile2.model = 'claude-sonnet-4';
  profile2.permissionMode = 'allow';
  profileManager1.update(profile2);

  // Set current profile
  profileManager1.setCurrent(profile2);

  // Wait for auto-save to complete
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('✓ Created 2 profiles');

  // Verify profiles.json exists
  const profilesPath = path.join(TEST_DIR, 'profiles.json');
  const fileExists = await fs.access(profilesPath).then(() => true).catch(() => false);
  assert.ok(fileExists, 'profiles.json should exist');
  console.log('✓ profiles.json created');

  // Read and verify content
  const content = await fs.readFile(profilesPath, 'utf-8');
  const data = JSON.parse(content);

  assert.strictEqual(data.current, 'test-profile-2', 'Current profile should be saved');
  assert.strictEqual(data.profiles.length, 2, 'Should have 2 profiles');
  console.log('✓ File content correct');

  // Create a new ProfileManager instance (simulating app restart)
  const profileManager2 = new ProfileManager({ configDir: TEST_DIR });
  await profileManager2.initialize();

  // Verify profiles were loaded
  const loadedProfiles = profileManager2.list();
  assert.strictEqual(loadedProfiles.length, 2, 'Should load 2 profiles');
  console.log('✓ Profiles loaded after restart');

  // Verify profile details
  const loadedProfile1 = profileManager2.get('test-profile-1');
  assert.ok(loadedProfile1, 'Profile 1 should exist');
  assert.strictEqual(loadedProfile1.providerId, 'gemini');
  assert.strictEqual(loadedProfile1.model, 'gemini-2.0-flash-exp');

  const loadedProfile2 = profileManager2.get('test-profile-2');
  assert.ok(loadedProfile2, 'Profile 2 should exist');
  assert.strictEqual(loadedProfile2.providerId, 'claude');
  assert.strictEqual(loadedProfile2.model, 'claude-sonnet-4');
  assert.strictEqual(loadedProfile2.permissionMode, 'allow');
  console.log('✓ Profile details preserved');

  // Verify current profile was restored
  const currentProfile = profileManager2.getCurrent();
  assert.ok(currentProfile, 'Current profile should be restored');
  assert.strictEqual(currentProfile.name, 'test-profile-2');
  console.log('✓ Current profile restored');

  // Test delete and persistence
  profileManager2.delete('test-profile-1');
  await new Promise(resolve => setTimeout(resolve, 100)); // Wait for auto-save

  // Verify deletion persisted
  const profileManager3 = new ProfileManager({ configDir: TEST_DIR });
  await profileManager3.initialize();

  const remainingProfiles = profileManager3.list();
  assert.strictEqual(remainingProfiles.length, 1, 'Should have 1 profile after delete');
  assert.strictEqual(remainingProfiles[0].name, 'test-profile-2');
  console.log('✓ Delete persisted');

  console.log('\n✅ All profile persistence tests passed');

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('ProfileManager - Handle missing profiles.json gracefully', async () => {
  console.log('\n🧪 Testing missing profiles.json...');

  const testDir = path.join(os.tmpdir(), 'multicoder-test-no-profiles');

  // Ensure directory doesn't exist
  await fs.rm(testDir, { recursive: true, force: true });

  // Create ProfileManager - should not throw
  const profileManager = new ProfileManager({ configDir: testDir });
  await profileManager.initialize();

  const profiles = profileManager.list();
  assert.strictEqual(profiles.length, 0, 'Should start with no profiles');
  console.log('✓ Handles missing file gracefully');

  // Create a profile
  profileManager.ensure('first-profile');
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify file was created
  const profilesPath = path.join(testDir, 'profiles.json');
  const exists = await fs.access(profilesPath).then(() => true).catch(() => false);
  assert.ok(exists, 'Should create profiles.json');
  console.log('✓ Creates profiles.json on first save');

  console.log('\n✅ Missing file test passed');

  // Cleanup
  await fs.rm(testDir, { recursive: true, force: true });
});

console.log('\n💾 Profile Persistence Tests');
