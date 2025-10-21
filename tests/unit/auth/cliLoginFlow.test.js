/**
 * CLI Login Flow Unit Tests
 *
 * Tests the CLI login flow including:
 * - Interactive login with credential application
 * - Command line login with credential application
 * - Profile switching with credential application
 * - The bug fix for credentials not being applied to files
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const TEST_DIR = path.join(os.tmpdir(), 'unycode-test-cli-login');
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

async function resetTestDirectory() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_GEMINI_DIR, { recursive: true });
}

test('CLI Login Flow - Save and apply GEMINI_API_KEY credentials', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  const auth = new GeminiAuthenticator();
  
  // Simulate saving GEMINI_API_KEY credentials
  const credentialData = {
    apiKey: 'AIzaSyTestKey123456789',
    apiKeyType: 'gemini'
  };
  
  await credentialManager.saveCredentialData('gemini', 'test-profile', credentialData);
  // Apply credentials (this is what was missing in the bug)
  const result = await credentialManager.applyCredentials('gemini', 'test-profile');
  
  assert.strictEqual(result.needsRestart, true, 'Should need restart for file changes');
  
  // Check if .env file was created
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  
  assert.ok(envExists, 'Should create .env file');
  
  if (envExists) {
    const envContent = await fs.readFile(envPath, 'utf-8');
    assert.ok(envContent.includes('GEMINI_API_KEY='), 'Should contain GEMINI_API_KEY');
    assert.ok(envContent.includes('AIzaSyTestKey123456789'), 'Should contain the API key');
  }
  
  // Check if settings.json was updated
  const settingsPath = path.join(TEST_GEMINI_DIR, 'settings.json');
  const settingsExists = await fs.access(settingsPath).then(() => true).catch(() => false);
  
  if (settingsExists) {
    const settingsContent = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    assert.strictEqual(
      settings.security.auth.selectedType, 
      'gemini-api-key', 
      'Should update selectedType to gemini-api-key'
    );
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CLI Login Flow - Save and apply Vertex AI credentials', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  const auth = new GeminiAuthenticator();
  
  // Simulate saving Vertex AI credentials
  const credentialData = {
    apiKey: 'AIzaSyVertexKey123456789',
    projectId: 'test-project',
    location: 'us-central1',
    useVertexAi: true,
    apiKeyType: 'vertex'
  };
  
  await credentialManager.saveCredentialData('gemini', 'test-profile', credentialData);
  
  // Apply credentials
  const result = await credentialManager.applyCredentials('gemini', 'test-profile');
  
  assert.strictEqual(result.needsRestart, true, 'Should need restart for file changes');
  
  // Check if .env file was created with Vertex AI configuration
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  
  assert.ok(envExists, 'Should create .env file');
  
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

test('CLI Login Flow - Switch from GEMINI_API_KEY to Vertex AI', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  // First, save GEMINI_API_KEY credentials
  const geminiData = {
    apiKey: 'AIzaSyGeminiKey123456789',
    apiKeyType: 'gemini'
  };
  
  await credentialManager.saveCredentialData('gemini', 'test-profile', geminiData);
  await credentialManager.applyCredentials('gemini', 'test-profile');
  
  // Check initial .env file
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  let envContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(envContent.includes('GEMINI_API_KEY='), 'Should initially contain GEMINI_API_KEY');
  assert.ok(!envContent.includes('GOOGLE_API_KEY='), 'Should not initially contain GOOGLE_API_KEY');
  
  // Now switch to Vertex AI
  const vertexData = {
    apiKey: 'AIzaSyVertexKey123456789',
    projectId: 'test-project',
    location: 'us-central1',
    useVertexAi: true,
    apiKeyType: 'vertex'
  };
  
  await credentialManager.saveCredentialData('gemini', 'test-profile', vertexData);
  await credentialManager.applyCredentials('gemini', 'test-profile');
  
  // Check updated .env file
  envContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(!envContent.includes('GEMINI_API_KEY='), 'Should remove GEMINI_API_KEY');
  assert.ok(envContent.includes('GOOGLE_API_KEY='), 'Should now contain GOOGLE_API_KEY');
  assert.ok(envContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should contain GOOGLE_CLOUD_PROJECT');
  assert.ok(envContent.includes('GOOGLE_CLOUD_LOCATION='), 'Should contain GOOGLE_CLOUD_LOCATION');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CLI Login Flow - Switch from Vertex AI to GEMINI_API_KEY', async () => {
  await resetTestDirectory();
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  // First, save Vertex AI credentials
  const vertexData = {
    apiKey: 'AIzaSyVertexKey123456789',
    projectId: 'test-project',
    location: 'us-central1',
    useVertexAi: true,
    apiKeyType: 'vertex'
  };
  
  await credentialManager.saveCredentialData('gemini', 'test-profile', vertexData);
  await credentialManager.applyCredentials('gemini', 'test-profile');
  
  // Check initial .env file
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  let envContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(envContent.includes('GOOGLE_API_KEY='), 'Should initially contain GOOGLE_API_KEY');
  assert.ok(envContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should initially contain GOOGLE_CLOUD_PROJECT');
  assert.ok(!envContent.includes('GEMINI_API_KEY='), 'Should not initially contain GEMINI_API_KEY');
  
  // Now switch to GEMINI_API_KEY
  const geminiData = {
    apiKey: 'AIzaSyGeminiKey123456789',
    apiKeyType: 'gemini'
  };
  
  await credentialManager.saveCredentialData('gemini', 'test-profile', geminiData);
  await credentialManager.applyCredentials('gemini', 'test-profile');
  
  // Check updated .env file
  envContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(!envContent.includes('GOOGLE_API_KEY='), 'Should remove GOOGLE_API_KEY');
  assert.ok(!envContent.includes('GOOGLE_CLOUD_PROJECT='), 'Should remove GOOGLE_CLOUD_PROJECT');
  assert.ok(!envContent.includes('GOOGLE_CLOUD_LOCATION='), 'Should remove GOOGLE_CLOUD_LOCATION');
  assert.ok(envContent.includes('GEMINI_API_KEY='), 'Should now contain GEMINI_API_KEY');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CLI Login Flow - Handle missing credentials gracefully', async () => {
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
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test('CLI Login Flow - Preserve existing .env variables', async () => {
  await resetTestDirectory();
  
  const envPath = path.join(TEST_GEMINI_DIR, '.env');
  const initialEnvContent = `OTHER_VAR=some_value
ANOTHER_VAR=another_value
GEMINI_API_KEY=old_key`;
  
  await fs.writeFile(envPath, initialEnvContent);
  
  const credentialManager = new CredentialManager(TEST_DIR);
  await credentialManager.initialize();
  
  // Save new GEMINI_API_KEY credentials
  const credentialData = {
    apiKey: 'AIzaSyNewKey123456789',
    apiKeyType: 'gemini'
  };
  
  await credentialManager.saveCredentialData('gemini', 'test-profile', credentialData);
  await credentialManager.applyCredentials('gemini', 'test-profile');
  
  // Check that existing variables are preserved
  const updatedEnvContent = await fs.readFile(envPath, 'utf-8');
  assert.ok(updatedEnvContent.includes('OTHER_VAR=some_value'), 'Should preserve OTHER_VAR');
  assert.ok(updatedEnvContent.includes('ANOTHER_VAR=another_value'), 'Should preserve ANOTHER_VAR');
  assert.ok(updatedEnvContent.includes('GEMINI_API_KEY=AIzaSyNewKey123456789'), 'Should update GEMINI_API_KEY');
  assert.ok(!updatedEnvContent.includes('GEMINI_API_KEY=old_key'), 'Should remove old GEMINI_API_KEY');
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});
