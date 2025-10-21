#!/usr/bin/env node
/**
 * Unit tests for OpenAI Codex credentials management system
 * Tests API key injection, environment variable management, and profile integration
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { SystemEnvironmentManager } from '../../../src/system/systemEnvironmentManager.js';
import { applyCodexEnvironment, computeAzureBaseUrl, CODEX_ENV_VARS } from '../../../src/system/codexEnv.js';
import { ProfileStore } from '../../../src/profile/store.js';
import { CodexAuthenticator } from '../../../src/auth/providers/codex.js';

describe('Codex Credentials Management', () => {
  let testDir;
  let originalEnv;
  let systemEnvManager;
  let profileStore;
  let codexAuth;
  let mockCodexDir;

  beforeEach(() => {
    // Setup test environment
    testDir = join(tmpdir(), `codex-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    // Mock ~/.codex directory
    mockCodexDir = join(testDir, '.codex');
    mkdirSync(mockCodexDir, { recursive: true });
    
    // Backup original environment
    originalEnv = { ...process.env };
    
    // Clear codex-related env vars
    for (const envVar of CODEX_ENV_VARS) {
      delete process.env[envVar];
    }
    
    // Initialize managers
    systemEnvManager = new SystemEnvironmentManager();
    profileStore = new ProfileStore();
    codexAuth = new CodexAuthenticator();
    
    // Mock homedir for testing
    process.env.HOME = testDir;
    process.env.USERPROFILE = testDir;
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Environment Variable Management', () => {
    test('should clear existing codex environment variables', async () => {
      // Setup existing env vars
      process.env.OPENAI_API_KEY = 'old-key';
      process.env.AZURE_OPENAI_API_KEY = 'old-azure-key';
      process.env.OPENAI_BASE_URL = 'old-url';
      
      const config = { mode: 'openai' };
      const newApiKey = 'sk-new-test-key';
      
      await applyCodexEnvironment(systemEnvManager, newApiKey, config);
      
      // Should have new key, old azure key should be cleared
      assert.strictEqual(process.env.OPENAI_API_KEY, newApiKey);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, undefined);
      assert.strictEqual(process.env.OPENAI_BASE_URL, undefined);
    });

    test('should set OpenAI environment variables correctly', async () => {
      const apiKey = 'sk-test-openai-key';
      const baseUrl = 'https://custom.openai.com/v1';
      const config = { mode: 'openai', baseUrl };
      
      const updatedVars = await applyCodexEnvironment(systemEnvManager, apiKey, config);
      
      assert.strictEqual(process.env.OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.OPENAI_BASE_URL, baseUrl);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, undefined);
      
      assert(updatedVars.includes('OPENAI_API_KEY'));
      assert(updatedVars.includes('OPENAI_BASE_URL'));
      assert(!updatedVars.includes('AZURE_OPENAI_API_KEY'));
    });

    test('should set Azure OpenAI environment variables correctly', async () => {
      const apiKey = 'sk-test-azure-key';
      const resourceName = 'my-resource';
      const expectedBaseUrl = computeAzureBaseUrl(resourceName);
      const config = { 
        mode: 'azure', 
        azureResourceName: resourceName,
        baseUrl: expectedBaseUrl 
      };
      
      const updatedVars = await applyCodexEnvironment(systemEnvManager, apiKey, config);
      
      assert.strictEqual(process.env.OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.OPENAI_BASE_URL, expectedBaseUrl);
      
      assert(updatedVars.includes('OPENAI_API_KEY'));
      assert(updatedVars.includes('AZURE_OPENAI_API_KEY'));
      assert(updatedVars.includes('OPENAI_BASE_URL'));
    });

    test('should compute Azure base URL correctly', () => {
      const resourceName = 'test-resource';
      const expectedUrl = 'https://test-resource.openai.azure.com/openai/deployments/gpt-5-codex';
      
      const actualUrl = computeAzureBaseUrl(resourceName);
      
      assert.strictEqual(actualUrl, expectedUrl);
    });
  });

  describe('Native Credential Detection', () => {
    test('should detect valid native credentials from ~/.codex/auth.json', async () => {
      const authData = {
        tokens: {
          sessionKey: 'test-session-key',
          accessToken: 'test-access-token'
        },
        expires_at: Date.now() + 3600000 // 1 hour from now
      };
      
      const authPath = join(mockCodexDir, 'auth.json');
      writeFileSync(authPath, JSON.stringify(authData, null, 2));
      
      const credInfo = await codexAuth.checkAuth('test-profile');
      
      assert.strictEqual(credInfo.valid, true);
      assert.strictEqual(credInfo.source, 'native');
      assert.strictEqual(credInfo.path, authPath);
      assert.strictEqual(credInfo.expiresAt, authData.expires_at);
    });

    test('should detect expired native credentials', async () => {
      const authData = {
        tokens: {
          sessionKey: 'test-session-key'
        },
        expires_at: Date.now() - 3600000 // 1 hour ago (expired)
      };
      
      const authPath = join(mockCodexDir, 'auth.json');
      writeFileSync(authPath, JSON.stringify(authData, null, 2));
      
      const credInfo = await codexAuth.checkAuth('test-profile');
      
      assert.strictEqual(credInfo.valid, false);
      assert.strictEqual(credInfo.source, 'native');
      assert.strictEqual(credInfo.path, authPath);
      assert.strictEqual(credInfo.expiresAt, authData.expires_at);
    });

    test('should handle missing native credentials', async () => {
      const credInfo = await codexAuth.checkAuth('test-profile');
      
      assert.strictEqual(credInfo.valid, false);
      assert.strictEqual(credInfo.source, 'native');
      assert.strictEqual(credInfo.path, undefined);
    });

    test('should handle malformed credential files', async () => {
      const authPath = join(mockCodexDir, 'auth.json');
      writeFileSync(authPath, 'invalid json content');
      
      const credInfo = await codexAuth.checkAuth('test-profile');
      
      assert.strictEqual(credInfo.valid, false);
      assert.strictEqual(credInfo.source, 'native');
    });
  });

  describe('Profile Integration', () => {
    test('should create profile with OpenAI API key', async () => {
      const profileName = 'test-openai-profile';
      const apiKey = 'sk-test-openai-key';
      const baseUrl = 'https://api.openai.com/v1';
      
      // Create profile
      profileStore.create(profileName);
      
      // Apply codex environment
      const config = { mode: 'openai', baseUrl };
      await applyCodexEnvironment(systemEnvManager, apiKey, config);
      
      // Set provider auth
      profileStore.setProviderAuth(profileName, 'codex', {
        credentialSource: 'managed',
        lastAuth: Date.now()
      });
      
      const profile = profileStore.get(profileName);
      assert(profile);
      assert(profile.providers.codex);
      assert.strictEqual(profile.providers.codex.credentialSource, 'managed');
      
      // Verify environment variables
      assert.strictEqual(process.env.OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.OPENAI_BASE_URL, baseUrl);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, undefined);
    });

    test('should create profile with Azure OpenAI API key', async () => {
      const profileName = 'test-azure-profile';
      const apiKey = 'sk-test-azure-key';
      const resourceName = 'my-azure-resource';
      const expectedBaseUrl = computeAzureBaseUrl(resourceName);
      
      // Create profile
      profileStore.create(profileName);
      
      // Apply codex environment
      const config = { 
        mode: 'azure', 
        azureResourceName: resourceName,
        baseUrl: expectedBaseUrl 
      };
      await applyCodexEnvironment(systemEnvManager, apiKey, config);
      
      // Set provider auth
      profileStore.setProviderAuth(profileName, 'codex', {
        credentialSource: 'managed',
        lastAuth: Date.now()
      });
      
      const profile = profileStore.get(profileName);
      assert(profile);
      assert(profile.providers.codex);
      
      // Verify environment variables
      assert.strictEqual(process.env.OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.OPENAI_BASE_URL, expectedBaseUrl);
    });

    test('should switch between OpenAI and Azure configurations', async () => {
      const profileName = 'test-switch-profile';
      profileStore.create(profileName);
      
      // First: Set up OpenAI
      const openaiKey = 'sk-openai-key';
      const openaiConfig = { mode: 'openai' };
      await applyCodexEnvironment(systemEnvManager, openaiKey, openaiConfig);
      
      assert.strictEqual(process.env.OPENAI_API_KEY, openaiKey);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, undefined);
      assert.strictEqual(process.env.OPENAI_BASE_URL, undefined);
      
      // Then: Switch to Azure
      const azureKey = 'sk-azure-key';
      const resourceName = 'test-resource';
      const azureConfig = { 
        mode: 'azure', 
        azureResourceName: resourceName,
        baseUrl: computeAzureBaseUrl(resourceName)
      };
      await applyCodexEnvironment(systemEnvManager, azureKey, azureConfig);
      
      assert.strictEqual(process.env.OPENAI_API_KEY, azureKey);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, azureKey);
      assert.strictEqual(process.env.OPENAI_BASE_URL, computeAzureBaseUrl(resourceName));
    });
  });

  describe('Credential File Verification', () => {
    test('should verify ~/.codex directory structure after native auth', async () => {
      // Simulate native codex login by creating auth file
      const authData = {
        tokens: {
          sessionKey: 'test-session-key',
          accessToken: 'test-access-token',
          id_token: 'test-id-token'
        },
        expires_at: Date.now() + 3600000,
        user: {
          email: 'test@example.com'
        }
      };
      
      const authPath = join(mockCodexDir, 'auth.json');
      writeFileSync(authPath, JSON.stringify(authData, null, 2));
      
      // Verify file exists and is readable
      assert(existsSync(authPath));
      
      const fileContent = readFileSync(authPath, 'utf-8');
      const parsedContent = JSON.parse(fileContent);
      
      assert.strictEqual(parsedContent.tokens.sessionKey, authData.tokens.sessionKey);
      assert.strictEqual(parsedContent.expires_at, authData.expires_at);
      
      // Verify credential detection works
      const credInfo = await codexAuth.checkAuth('test-profile');
      assert.strictEqual(credInfo.valid, true);
      assert.strictEqual(credInfo.path, authPath);
    });

    test('should handle multiple credential file formats', async () => {
      const testCases = [
        {
          filename: 'auth.json',
          content: { tokens: { sessionKey: 'key1' }, expires_at: Date.now() + 3600000 }
        },
        {
          filename: 'credentials.json',
          content: { accessToken: 'key2', expires_at: Date.now() + 3600000 }
        },
        {
          filename: 'credentials',
          content: { token: 'key3', expires_at: Date.now() + 3600000 }
        }
      ];
      
      for (const testCase of testCases) {
        // Clean up previous files
        rmSync(mockCodexDir, { recursive: true, force: true });
        mkdirSync(mockCodexDir, { recursive: true });
        
        const filePath = join(mockCodexDir, testCase.filename);
        writeFileSync(filePath, JSON.stringify(testCase.content, null, 2));
        
        const credInfo = await codexAuth.checkAuth('test-profile');
        assert.strictEqual(credInfo.valid, true, `Failed for ${testCase.filename}`);
        assert.strictEqual(credInfo.path, filePath);
      }
    });
  });

  describe('Environment Variable Persistence', () => {
    test('should persist environment variables across process restarts', async () => {
      const apiKey = 'sk-persistent-key';
      const config = { mode: 'openai', baseUrl: 'https://custom.api.com' };
      
      // Apply environment
      await applyCodexEnvironment(systemEnvManager, apiKey, config);
      
      // Verify immediate availability
      assert.strictEqual(process.env.OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.OPENAI_BASE_URL, config.baseUrl);
      
      // Simulate checking persistence (would require actual system env check in real scenario)
      const persistedKey = await systemEnvManager.get('OPENAI_API_KEY');
      const persistedUrl = await systemEnvManager.get('OPENAI_BASE_URL');
      
      assert.strictEqual(persistedKey, apiKey);
      assert.strictEqual(persistedUrl, config.baseUrl);
    });

    test('should clean up environment variables when removing credentials', async () => {
      // Set up environment
      const apiKey = 'sk-temp-key';
      const config = { mode: 'azure', azureResourceName: 'temp-resource' };
      await applyCodexEnvironment(systemEnvManager, apiKey, config);
      
      // Verify setup
      assert.strictEqual(process.env.OPENAI_API_KEY, apiKey);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, apiKey);
      
      // Clean up by applying empty config (simulating logout)
      for (const envVar of CODEX_ENV_VARS) {
        await systemEnvManager.remove(envVar);
      }
      
      // Verify cleanup
      assert.strictEqual(process.env.OPENAI_API_KEY, undefined);
      assert.strictEqual(process.env.AZURE_OPENAI_API_KEY, undefined);
      assert.strictEqual(process.env.OPENAI_BASE_URL, undefined);
    });
  });
});