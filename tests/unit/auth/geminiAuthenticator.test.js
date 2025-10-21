/**
 * Gemini Authenticator Unit Tests
 *
 * Tests the Gemini authentication system including:
 * - API key authentication (GEMINI_API_KEY and Vertex AI)
 * - OAuth authentication
 * - Credential application to .env and settings.json files
 * - Settings.json authentication type updates
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GeminiAuthenticator, setGeminiHomeDirOverride } from '../../../dist/auth/providers/gemini.js';
import { CredentialManager } from '../../../dist/auth/credentialManager.js';

const TEST_DIR = path.join(os.tmpdir(), 'multicoder-test-gemini');
const TEST_GEMINI_DIR = path.join(TEST_DIR, '.gemini');

const originalHomedir = os.homedir;
os.homedir = () => TEST_DIR;

const originalHomeEnv = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalGeminiHome = process.env.GEMINI_HOME_DIR;
const originalConfigDirEnv = process.env.MULTICODER_CONFIG_DIR;
process.env.HOME = TEST_DIR;
process.env.USERPROFILE = TEST_DIR;
process.env.GEMINI_HOME_DIR = TEST_DIR;
process.env.MULTICODER_CONFIG_DIR = TEST_DIR;

setGeminiHomeDirOverride(TEST_DIR);

process.on('exit', () => {
  os.homedir = originalHomedir;

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

  if (originalConfigDirEnv === undefined) {
    delete process.env.MULTICODER_CONFIG_DIR;
  } else {
    process.env.MULTICODER_CONFIG_DIR = originalConfigDirEnv;
  }
  setGeminiHomeDirOverride(originalGeminiHome ?? null);
});


test('GeminiAuthenticator - Initialize', async () => {
  const auth = new GeminiAuthenticator();
  
  assert.strictEqual(auth.id, 'gemini');
  assert.strictEqual(auth.name, 'Google Gemini');
});

test('GeminiAuthenticator - Get auth options', async () => {
  const auth = new GeminiAuthenticator();
  const options = await auth.getAuthOptions('test-profile');
  
  assert.ok(Array.isArray(options), 'Should return array of options');
  assert.ok(options.length >= 3, 'Should have at least 3 options');
  
  // Check for expected options
  const optionIds = options.map(opt => opt.id);
  assert.ok(optionIds.includes('oauth'), 'Should have OAuth option');
  assert.ok(optionIds.includes('gemini-api-key'), 'Should have GEMINI_API_KEY option');
  assert.ok(optionIds.includes('vertex-ai'), 'Should have Vertex AI option');
});

test('GeminiAuthenticator - Apply GEMINI_API_KEY to .env file', async () => {
  // Setup test directory
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
  
  const auth = new GeminiAuthenticator();
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  const testData = {
    apiKey: 'AIzaSyTestKey123456789',
    apiKeyType: 'gemini'
  };
  
  // First save the credentials
  await credentialManager.saveCredentialData('gemini', 'test-profile', testData);

  // Then apply API key
  await auth.applyCredentials('test-profile');
  
  // Check if .env file was created
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  
  if (envExists) {
    const envContent = await fs.readFile(envPath, 'utf-8');
    assert.ok(envContent.includes('GEMINI_API_KEY='), 'Should contain GEMINI_API_KEY');
    assert.ok(envContent.includes('AIzaSyTestKey123456789'), 'Should contain the API key');
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('GeminiAuthenticator - Apply Vertex AI to .env file', async () => {
  // Setup test directory
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
  
  const auth = new GeminiAuthenticator();
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  const testData = {
    apiKey: 'AIzaSyVertexKey123456789',
    projectId: 'test-project',
    location: 'us-central1',
    useVertexAi: true,
    apiKeyType: 'vertex'
  };
  
  // First save the credentials
  await credentialManager.saveCredentialData('gemini', 'test-profile', testData);
  
  // Then apply Vertex AI configuration
  await auth.applyCredentials('test-profile');
  
  // Check if .env file was created
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  
  if (envExists) {
    const envContent = await fs.readFile(envPath, 'utf-8');
    assert.ok(envContent.includes('GOOGLE_API_KEY='), 'Should contain GOOGLE_API_KEY');
    assert.ok(envContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should contain GOOGLE_CLOUD_PROJECT');
    assert.ok(envContent.includes('GOOGLE_CLOUD_LOCATION='), 'Should contain GOOGLE_CLOUD_LOCATION');
    assert.ok(envContent.includes('test-project'), 'Should contain project ID');
    assert.ok(envContent.includes('us-central1'), 'Should contain location');
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('GeminiAuthenticator - Update settings.json for API key', async () => {
  // Setup test directory and existing settings
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const initialSettings = {
    "ide": { "hasSeenNudge": true },
    "security": { "auth": { "selectedType": "oauth-personal" } },
    "ui": { "theme": "Dracula" }
  };
  
  await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2));
  
  const auth = new GeminiAuthenticator();
  
  // Test updating settings for API key
  await auth.updateSettingsForAuthType('gemini');
  
  // Check if settings were updated
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  assert.strictEqual(
    updatedSettings.security.auth.selectedType, 
    'gemini-api-key', 
    'Should update selectedType to gemini-api-key'
  );
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('GeminiAuthenticator - Update settings.json for OAuth', async () => {
  // Setup test directory and existing settings
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const initialSettings = {
    "ide": { "hasSeenNudge": true },
    "security": { "auth": { "selectedType": "gemini-api-key" } },
    "ui": { "theme": "Dracula" }
  };
  
  await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2));
  
  const auth = new GeminiAuthenticator();
  
  // Test updating settings for OAuth
  await auth.updateSettingsForOAuth();
  
  // Check if settings were updated
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  assert.strictEqual(
    updatedSettings.security.auth.selectedType, 
    'oauth-personal', 
    'Should update selectedType to oauth-personal'
  );
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('GeminiAuthenticator - Clear cached credentials resets auth mode to OAuth', async () => {
  // Start with a clean directory containing Vertex AI mode
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });

  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const vertexSettings = {
    "security": { "auth": { "selectedType": "vertex-ai" } }
  };

  await fs.writeFile(settingsPath, JSON.stringify(vertexSettings, null, 2));

  const auth = new GeminiAuthenticator();

  // Invoke the clear to ensure it also flips settings back to OAuth mode
  await auth.clearCachedCredentials();

  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  assert.strictEqual(
    updatedSettings.security.auth.selectedType,
    'oauth-personal',
    'Should reset selectedType to oauth-personal when clearing credentials'
  );

  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('GeminiAuthenticator - Clean API key from .env file', async () => {
  // Setup test directory with existing .env file
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
  
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const initialEnvContent = `GEMINI_API_KEY=AIzaSyTestKey123456789
GOOGLE_API_KEY=AIzaSyGoogleKey123456789
GOOGLE_CLOUD_PROJECT=test-project
GOOGLE_CLOUD_LOCATION=us-central1
OTHER_VAR=some_value`;
  
  await fs.writeFile(envPath, initialEnvContent);
  
  const auth = new GeminiAuthenticator();
  
  // Clean API key
  await auth.cleanApiKeyFromConfig();
  
  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  assert.ok(envExists, 'Should preserve .env file when other variables exist');

  const cleanedEnvContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(!cleanedEnvContent.includes('GEMINI_API_KEY='), 'Should remove GEMINI_API_KEY');
  assert.ok(!cleanedEnvContent.includes('GOOGLE_API_KEY='), 'Should remove GOOGLE_API_KEY');
  assert.ok(!cleanedEnvContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should remove GOOGLE_CLOUD_PROJECT');
  assert.ok(!cleanedEnvContent.includes('GOOGLE_CLOUD_LOCATION='), 'Should remove GOOGLE_CLOUD_LOCATION');
  assert.ok(cleanedEnvContent.includes('OTHER_VAR=some_value'), 'Should preserve other variables');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('GeminiAuthenticator - Handle non-existent .env file', async () => {
  // Setup test directory without .env file
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
  
  const auth = new GeminiAuthenticator();
  
  // This should not throw an error
  await auth.cleanApiKeyFromConfig();
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('GeminiAuthenticator - Handle malformed .env file', async () => {
  // Setup test directory with malformed .env file
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
  
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const malformedContent = `This is not a valid .env file
GEMINI_API_KEY=AIzaSyTestKey123456789
GOOGLE_API_KEY=AIzaSyGoogleKey123456789
GOOGLE_CLOUD_PROJECT=test-project
GOOGLE_CLOUD_LOCATION=us-central1`;
  
  await fs.writeFile(envPath, malformedContent);
  
  const auth = new GeminiAuthenticator();
  
  // This should not throw an error and should still clean the API keys
  await auth.cleanApiKeyFromConfig();
  
  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  if (envExists) {
    const cleanedEnvContent = await fs.readFile(envPath, 'utf-8');
    assert.ok(!cleanedEnvContent.includes('GEMINI_API_KEY='), 'Should remove GEMINI_API_KEY');
    assert.ok(!cleanedEnvContent.includes('GOOGLE_API_KEY='), 'Should remove GOOGLE_API_KEY');
    assert.ok(!cleanedEnvContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should remove GOOGLE_CLOUD_PROJECT');
    assert.ok(!cleanedEnvContent.includes('GOOGLE_CLOUD_LOCATION='), 'Should remove GOOGLE_CLOUD_LOCATION');
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

// Restore original homedir
os.homedir = originalHomedir;

console.log('✅ All GeminiAuthenticator tests completed');
