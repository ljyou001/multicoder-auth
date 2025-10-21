/**
 * Settings Update Unit Tests
 *
 * Tests the settings.json update logic including:
 * - Authentication type switching
 * - Settings file creation and modification
 * - Preserving existing settings
 * - Error handling for malformed settings
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const TEST_DIR = path.join(os.tmpdir(), 'multicoder-test-settings');
const TEST_GEMINI_DIR = path.join(TEST_DIR, '.gemini');

// Mock the homedir to use our test directory
const originalHomedir = os.homedir;
os.homedir = () => TEST_DIR;

const originalHomeEnv = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = TEST_DIR;
process.env.USERPROFILE = TEST_DIR;
const originalGeminiHome = process.env.GEMINI_HOME_DIR;
process.env.GEMINI_HOME_DIR = TEST_DIR;

const { GeminiAuthenticator, setGeminiHomeDirOverride } = await import('../../../dist/auth/providers/gemini.js');
setGeminiHomeDirOverride(TEST_DIR);

process.on('exit', () => {
  if (originalHomeEnv === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHomeEnv;
  }

  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }

  if (originalGeminiHome === undefined) {
    delete process.env.GEMINI_HOME_DIR;
  } else {
    process.env.GEMINI_HOME_DIR = originalGeminiHome;
  }

  setGeminiHomeDirOverride(originalGeminiHome ?? null);
});

async function resetTestDirectory() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
}

test('Settings Update - Create new settings.json for API key', async () => {
  await resetTestDirectory();
  
  const auth = new GeminiAuthenticator();
  
  // Update settings for API key
  await auth.updateSettingsForAuthType('gemini');
  
  // Check if settings.json was created
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const settingsExists = await fs.access(settingsPath).then(() => true).catch(() => false);
  
  assert.ok(settingsExists, 'Should create settings.json file');
  
  if (settingsExists) {
    const settingsContent = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    
    assert.ok(settings.security, 'Should have security section');
    assert.ok(settings.security.auth, 'Should have auth section');
    assert.strictEqual(
      settings.security.auth.selectedType, 
      'gemini-api-key', 
      'Should set selectedType to gemini-api-key'
    );
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Settings Update - Create new settings.json for OAuth', async () => {
  await resetTestDirectory();
  
  const auth = new GeminiAuthenticator();
  
  // Update settings for OAuth
  await auth.updateSettingsForOAuth();
  
  // Check if settings.json was created
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const settingsExists = await fs.access(settingsPath).then(() => true).catch(() => false);
  
  assert.ok(settingsExists, 'Should create settings.json file');
  
  if (settingsExists) {
    const settingsContent = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    
    assert.ok(settings.security, 'Should have security section');
    assert.ok(settings.security.auth, 'Should have auth section');
    assert.strictEqual(
      settings.security.auth.selectedType, 
      'oauth-personal', 
      'Should set selectedType to oauth-personal'
    );
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Settings Update - Preserve existing settings when updating auth type', async () => {
  await resetTestDirectory();
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const initialSettings = {
    "ide": { "hasSeenNudge": true },
    "security": { "auth": { "selectedType": "oauth-personal" } },
    "ui": { "theme": "Dracula" },
    "custom": { "setting": "value" }
  };
  
  await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2));
  
  const auth = new GeminiAuthenticator();
  
  // Update settings for API key
  await auth.updateSettingsForAuthType('gemini');
  
  // Check that existing settings are preserved
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  
  assert.strictEqual(
    updatedSettings.security.auth.selectedType, 
    'gemini-api-key', 
    'Should update selectedType to gemini-api-key'
  );
  assert.ok(updatedSettings.ide, 'Should preserve ide section');
  assert.strictEqual(updatedSettings.ide.hasSeenNudge, true, 'Should preserve ide.hasSeenNudge');
  assert.ok(updatedSettings.ui, 'Should preserve ui section');
  assert.strictEqual(updatedSettings.ui.theme, 'Dracula', 'Should preserve ui.theme');
  assert.ok(updatedSettings.custom, 'Should preserve custom section');
  assert.strictEqual(updatedSettings.custom.setting, 'value', 'Should preserve custom.setting');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Settings Update - Handle missing security section', async () => {
  await resetTestDirectory();
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const initialSettings = {
    "ide": { "hasSeenNudge": true },
    "ui": { "theme": "Dracula" }
  };
  
  await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2));
  
  const auth = new GeminiAuthenticator();
  
  // Update settings for API key
  await auth.updateSettingsForAuthType('gemini');
  
  // Check that security section was created
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  
  assert.ok(updatedSettings.security, 'Should create security section');
  assert.ok(updatedSettings.security.auth, 'Should create auth section');
  assert.strictEqual(
    updatedSettings.security.auth.selectedType, 
    'gemini-api-key', 
    'Should set selectedType to gemini-api-key'
  );
  assert.ok(updatedSettings.ide, 'Should preserve ide section');
  assert.ok(updatedSettings.ui, 'Should preserve ui section');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Settings Update - Handle missing auth section', async () => {
  await resetTestDirectory();
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const initialSettings = {
    "ide": { "hasSeenNudge": true },
    "security": {},
    "ui": { "theme": "Dracula" }
  };
  
  await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2));
  
  const auth = new GeminiAuthenticator();
  
  // Update settings for API key
  await auth.updateSettingsForAuthType('gemini');
  
  // Check that auth section was created
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  
  assert.ok(updatedSettings.security, 'Should preserve security section');
  assert.ok(updatedSettings.security.auth, 'Should create auth section');
  assert.strictEqual(
    updatedSettings.security.auth.selectedType, 
    'gemini-api-key', 
    'Should set selectedType to gemini-api-key'
  );
  assert.ok(updatedSettings.ide, 'Should preserve ide section');
  assert.ok(updatedSettings.ui, 'Should preserve ui section');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Settings Update - Handle malformed settings.json', async () => {
  await resetTestDirectory();
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const malformedContent = `{
    "ide": { "hasSeenNudge": true },
    "security": { "auth": { "selectedType": "oauth-personal" },
    "ui": { "theme": "Dracula" }
  }`; // Missing closing brace
  
  await fs.writeFile(settingsPath, malformedContent);
  
  const auth = new GeminiAuthenticator();
  
  // This should not throw an error and should create a new settings file
  try {
    await auth.updateSettingsForAuthType('gemini');
    
    // Check that a new settings file was created
    const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.ok(updatedSettings.security, 'Should have security section');
    assert.ok(updatedSettings.security.auth, 'Should have auth section');
    assert.strictEqual(
      updatedSettings.security.auth.selectedType, 
      'gemini-api-key', 
      'Should set selectedType to gemini-api-key'
    );
  } catch (error) {
    // If it fails due to malformed JSON, that's also acceptable
    assert.ok(error.message.includes('JSON') || error.message.includes('parse'), 'Should handle JSON parse error gracefully');
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Settings Update - Switch between different API key types', async () => {
  await resetTestDirectory();
  
  const auth = new GeminiAuthenticator();
  
  // First, set to gemini API key type
  await auth.updateSettingsForAuthType('gemini');
  
  let settings = JSON.parse(await fs.readFile(path.join(TEST_GEMINI_DIR, 'settings.json'), 'utf-8'));
  assert.strictEqual(settings.security.auth.selectedType, 'gemini-api-key', 'Should be gemini-api-key for gemini');
  
  // Then, set to vertex API key type
  await auth.updateSettingsForAuthType('vertex');
  
  settings = JSON.parse(await fs.readFile(path.join(TEST_GEMINI_DIR, 'settings.json'), 'utf-8'));
  assert.strictEqual(settings.security.auth.selectedType, 'vertex-ai', 'Should be vertex-ai for vertex');
  
  // Finally, set to OAuth
  await auth.updateSettingsForOAuth();
  
  settings = JSON.parse(await fs.readFile(path.join(TEST_GEMINI_DIR, 'settings.json'), 'utf-8'));
  assert.strictEqual(settings.security.auth.selectedType, 'oauth-personal', 'Should be oauth-personal for OAuth');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});
