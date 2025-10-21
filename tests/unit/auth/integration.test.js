/**
 * Auth Integration Tests
 *
 * Tests the complete authentication flow including:
 * - End-to-end login process
 * - Credential application to files
 * - Profile switching
 * - The specific bug fix for credentials not being applied
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const TEST_DIR = path.join(os.tmpdir(), 'unycode-test-integration');
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

const { CredentialManager } = await import('../../../dist/auth/credentialManager.js');
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

  if (originalConfigDirEnv === undefined) {
    delete process.env.UNYCODING_CONFIG_DIR;
  } else {
    process.env.UNYCODING_CONFIG_DIR = originalConfigDirEnv;
  }

  setGeminiHomeDirOverride(originalGeminiHome ?? null);
});

const originalConfigDirEnv = process.env.UNYCODING_CONFIG_DIR;
process.env.UNYCODING_CONFIG_DIR = TEST_DIR;
CredentialManager.prototype.getDefaultConfigDir = function () {
  return TEST_DIR;
};

function createFakeJwt(email) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { email };
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode(header)}.${encode(payload)}.signature`;
}

async function resetTestDirectory() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
}

test('Integration - Complete GEMINI_API_KEY login flow', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  const auth = new GeminiAuthenticator();
  
  // Step 1: Simulate interactive login (save credentials)
  const credentialData = {
    apiKey: 'AIzaSyIntegrationTest123456789',
    apiKeyType: 'gemini'
  };
  
  await credentialManager.saveCredentialData('gemini', 'integration-test', credentialData);
  
  // Step 2: Apply credentials (this was the missing step in the bug)
  const result = await credentialManager.applyCredentials('gemini', 'integration-test');
  
  assert.strictEqual(result.needsRestart, true, 'Should need restart for file changes');
  
  // Step 3: Verify .env file was created
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  
  assert.ok(envExists, 'Should create .env file');
  
  const envContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(envContent.includes('GEMINI_API_KEY='), 'Should contain GEMINI_API_KEY');
  assert.ok(envContent.includes('AIzaSyIntegrationTest123456789'), 'Should contain the API key');
  
  // Step 4: Verify settings.json was updated
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const settingsExists = await fs.access(settingsPath).then(() => true).catch(() => false);
  
  assert.ok(settingsExists, 'Should create settings.json file');
  
  const settingsContent = await fs.readFile(settingsPath, 'utf-8');
  const settings = JSON.parse(settingsContent);
  assert.strictEqual(
    settings.security.auth.selectedType, 
    'gemini-api-key', 
    'Should update selectedType to gemini-api-key'
  );
  
  // Step 5: Verify credential info is correct
  const credInfo = await credentialManager.getCredentialInfo('gemini', 'integration-test');
  assert.ok(credInfo, 'Should have credential info');
  assert.strictEqual(credInfo.source, 'managed', 'Should be managed credential');
  assert.strictEqual(credInfo.providerId, 'gemini');
  assert.strictEqual(credInfo.profileName, 'integration-test');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Integration - Complete Vertex AI login flow', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  const auth = new GeminiAuthenticator();
  
  // Step 1: Simulate interactive login (save credentials)
  const credentialData = {
    apiKey: 'AIzaSyVertexIntegrationTest123456789',
    projectId: 'integration-test-project',
    location: 'us-central1',
    useVertexAi: true,
    apiKeyType: 'vertex'
  };
  
  await credentialManager.saveCredentialData('gemini', 'vertex-integration-test', credentialData);
  
  // Step 2: Apply credentials
  const result = await credentialManager.applyCredentials('gemini', 'vertex-integration-test');
  
  assert.strictEqual(result.needsRestart, true, 'Should need restart for file changes');
  
  // Step 3: Verify .env file was created with Vertex AI configuration
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const envContent = await fs.readFile(envPath, 'utf-8');
  
  assert.ok(envContent.includes('GOOGLE_API_KEY='), 'Should contain GOOGLE_API_KEY');
  assert.ok(envContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should contain GOOGLE_CLOUD_PROJECT');
  assert.ok(envContent.includes('GOOGLE_CLOUD_LOCATION='), 'Should contain GOOGLE_CLOUD_LOCATION');
  assert.ok(envContent.includes('integration-test-project'), 'Should contain project ID');
  assert.ok(envContent.includes('us-central1'), 'Should contain location');
  
  // Step 4: Verify settings.json was updated
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const settingsContent = await fs.readFile(settingsPath, 'utf-8');
  const settings = JSON.parse(settingsContent);
  assert.strictEqual(
    settings.security.auth.selectedType, 
    'vertex-ai', 
    'Should update selectedType to vertex-ai'
  );
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Integration - Profile switching with credential application', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  // Create two profiles with different credentials
  const profile1Data = {
    apiKey: 'AIzaSyProfile1Key123456789',
    apiKeyType: 'gemini'
  };
  
  const profile2Data = {
    apiKey: 'AIzaSyProfile2Key123456789',
    projectId: 'profile2-project',
    location: 'us-west1',
    useVertexAi: true,
    apiKeyType: 'vertex'
  };
  
  await credentialManager.saveCredentialData('gemini', 'profile1', profile1Data);
  await credentialManager.saveCredentialData('gemini', 'profile2', profile2Data);
  
  // Switch to profile1
  await credentialManager.applyCredentials('gemini', 'profile1');
  
  let envContent = await fs.readFile(path.join(TEST_GEMINI_DIR, '.env'), 'utf-8');
  assert.ok(envContent.includes('GEMINI_API_KEY=AIzaSyProfile1Key123456789'), 'Should have profile1 GEMINI_API_KEY');
  assert.ok(!envContent.includes('GOOGLE_API_KEY='), 'Should not have GOOGLE_API_KEY');
  
  // Switch to profile2
  await credentialManager.applyCredentials('gemini', 'profile2');
  
  envContent = await fs.readFile(path.join(TEST_GEMINI_DIR, '.env'), 'utf-8');
  assert.ok(!envContent.includes('GEMINI_API_KEY='), 'Should remove GEMINI_API_KEY');
  assert.ok(envContent.includes('GOOGLE_API_KEY=AIzaSyProfile2Key123456789'), 'Should have profile2 GOOGLE_API_KEY');
  assert.ok(envContent.includes('GOOGLE_CLOUD_PROJECT=profile2-project'), 'Should have profile2 project');
  assert.ok(envContent.includes('GOOGLE_CLOUD_LOCATION=us-west1'), 'Should have profile2 location');
  
  // Switch back to profile1
  await credentialManager.applyCredentials('gemini', 'profile1');
  
  envContent = await fs.readFile(path.join(TEST_GEMINI_DIR, '.env'), 'utf-8');
  assert.ok(envContent.includes('GEMINI_API_KEY=AIzaSyProfile1Key123456789'), 'Should have profile1 GEMINI_API_KEY again');
  assert.ok(!envContent.includes('GOOGLE_API_KEY='), 'Should remove GOOGLE_API_KEY');
  assert.ok(!envContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should remove GOOGLE_CLOUD_PROJECT');
  assert.ok(!envContent.includes('GOOGLE_CLOUD_LOCATION='), 'Should remove GOOGLE_CLOUD_LOCATION');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Integration - OAuth to API key transition', async () => {
  await resetTestDirectory();
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const initialSettings = {
    "ide": { "hasSeenNudge": true },
    "security": { "auth": { "selectedType": "oauth-personal" } },
    "ui": { "theme": "Dracula" }
  };
  
  await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2));
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  // Simulate switching from OAuth to API key
  const credentialData = {
    apiKey: 'AIzaSyOAuthToApiKey123456789',
    apiKeyType: 'gemini'
  };
  
  await credentialManager.saveCredentialData('gemini', 'oauth-to-api-test', credentialData);
  await credentialManager.applyCredentials('gemini', 'oauth-to-api-test');
  
  // Verify .env file was created
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const envContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(envContent.includes('GEMINI_API_KEY='), 'Should contain GEMINI_API_KEY');
  
  // Verify settings.json was updated
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  assert.strictEqual(
    updatedSettings.security.auth.selectedType, 
    'gemini-api-key', 
    'Should update selectedType to gemini-api-key'
  );
  assert.ok(updatedSettings.ide, 'Should preserve ide section');
  assert.ok(updatedSettings.ui, 'Should preserve ui section');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Integration - API key to OAuth transition', async () => {
  await resetTestDirectory();
  
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  // Start with API key credentials applied
  const apiKeyData = {
    apiKey: 'AIzaSyApiToOauth123456789',
    apiKeyType: 'gemini'
  };
  await credentialManager.saveCredentialData('gemini', 'api-to-oauth-test', apiKeyData);
  await credentialManager.applyCredentials('gemini', 'api-to-oauth-test');
  
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  let envExists = await fs.access(envPath).then(() => true).catch(() => false);
  assert.ok(envExists, 'API key flow should create .env file');
  let envContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(envContent.includes('GEMINI_API_KEY=AIzaSyApiToOauth123456789'), 'API key should be present');
  
  const initialSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  assert.strictEqual(
    initialSettings.security.auth.selectedType,
    'gemini-api-key',
    'Settings should reflect API key auth before switching to OAuth'
  );
  
  // Save OAuth credentials for the same profile and apply them
  const oauthData = {
    token_type: 'Bearer',
    access_token: 'ya29.oauth-token',
    refresh_token: '1//refresh-token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    expiry_date: Date.now() + 3600_000,
    id_token: createFakeJwt('oauth-user@test.dev')
  };
  await credentialManager.saveCredentialData('gemini', 'api-to-oauth-test', oauthData);
  await credentialManager.applyCredentials('gemini', 'api-to-oauth-test');
  
  // .env should no longer contain API keys (it may be removed entirely)
  envExists = await fs.access(envPath).then(() => true).catch(() => false);
  if (envExists) {
    envContent = await fs.readFile(envPath, 'utf-8');
    assert.ok(!envContent.includes('GEMINI_API_KEY='), '.env should remove GEMINI_API_KEY when switching to OAuth');
    assert.ok(!envContent.includes('GOOGLE_API_KEY='), '.env should remove GOOGLE_API_KEY when switching to OAuth');
  }
  
  // OAuth credentials should exist in native location
  const oauthPath = path.join(TEST_GEMINI_DIR, 'oauth_creds.json');
  const oauthFileExists = await fs.access(oauthPath).then(() => true).catch(() => false);
  assert.ok(oauthFileExists, 'OAuth flow should write oauth_creds.json');
  const storedOauth = JSON.parse(await fs.readFile(oauthPath, 'utf-8'));
  assert.strictEqual(storedOauth.access_token, oauthData.access_token, 'oauth_creds.json should contain latest access token');
  
  // google_accounts.json should be updated with the active account
  const accountsPath = path.join(TEST_GEMINI_DIR, 'google_accounts.json');
  const accounts = JSON.parse(await fs.readFile(accountsPath, 'utf-8'));
  assert.strictEqual(accounts.active, 'oauth-user@test.dev', 'Active Google account should match OAuth token email');
  
  // settings.json should switch to OAuth
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  assert.strictEqual(
    updatedSettings.security.auth.selectedType,
    'oauth-personal',
    'Settings should reflect OAuth auth after switching'
  );
  
  // Managed credential should now contain OAuth data instead of API key
  const managedData = await credentialManager.loadManagedCredential('gemini', 'api-to-oauth-test');
  assert.ok(managedData, 'Managed credential should exist after OAuth save');
  assert.strictEqual(managedData.access_token, oauthData.access_token, 'Managed credential should store OAuth access token');
  assert.ok(!managedData.apiKey, 'Managed credential should no longer store API key after switching to OAuth');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('Integration - Error handling for invalid credentials', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  // Try to apply credentials for non-existent profile
  try {
    await credentialManager.applyCredentials('gemini', 'non-existent-profile');
    assert.fail('Should throw error for non-existent credentials');
  } catch (error) {
    assert.ok(error.message.includes('No credentials found'), 'Should throw appropriate error');
  }
  
  // Try to apply credentials for invalid provider
  try {
    await credentialManager.applyCredentials('invalid-provider', 'test-profile');
    assert.fail('Should throw error for invalid provider');
  } catch (error) {
    assert.ok(error.message.includes('Unknown provider'), 'Should throw appropriate error');
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});
