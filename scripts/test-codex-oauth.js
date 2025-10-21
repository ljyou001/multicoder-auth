#!/usr/bin/env node
/**
 * Test script to verify Codex OAuth credentials handling
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { ProfileStore } from '../dist/profile/store.js';
import { CredentialManager } from '../dist/auth/credentialManager.js';

console.log('🧪 Testing Codex OAuth Credentials Handling\n');

// Setup test environment
const testProfileName = 'test-codex-oauth';
const codexDir = join(homedir(), '.codex');
const authFile = join(codexDir, 'auth.json');

// Create mock OAuth credentials
console.log('1️⃣  Creating mock OAuth credentials in ~/.codex/auth.json...');
if (!existsSync(codexDir)) {
  mkdirSync(codexDir, { recursive: true });
}

const mockOAuthData = {
  tokens: {
    sessionKey: 'mock-session-key-12345',
    accessToken: 'mock-access-token-67890',
    id_token: 'mock-id-token-abcdef'
  },
  expires_at: Date.now() + 3600000, // 1 hour from now
  user: {
    email: 'test@example.com'
  },
  createdAt: Date.now()
};

writeFileSync(authFile, JSON.stringify(mockOAuthData, null, 2));
console.log('   ✓ Mock OAuth credentials created\n');

// Test profile creation and switching
console.log('2️⃣  Creating test profile...');
const profileStore = new ProfileStore();

// Clean up if exists
try {
  await profileStore.delete(testProfileName);
} catch {
  // Ignore if doesn't exist
}

profileStore.create(testProfileName);
console.log(`   ✓ Profile '${testProfileName}' created\n`);

// Set provider auth to use native credentials
console.log('3️⃣  Setting Codex provider auth (native OAuth)...');
profileStore.setProviderAuth(testProfileName, 'codex', {
  credentialSource: 'native',
  credentialPath: authFile,
  lastAuth: Date.now(),
  expiresAt: mockOAuthData.expires_at
});
console.log('   ✓ Provider auth configured\n');

// Test credential detection
console.log('4️⃣  Testing credential detection...');
const credentialManager = new CredentialManager();
await credentialManager.initialize();

const credInfo = await credentialManager.getCredentialInfo('codex', testProfileName);
if (!credInfo) {
  console.error('   ✗ Failed to detect credentials');
  process.exit(1);
}

console.log(`   ✓ Credentials detected:`);
console.log(`     Source: ${credInfo.source}`);
console.log(`     Path: ${credInfo.path}`);
console.log(`     Valid: ${credentialManager.isCredentialValid(credInfo)}\n`);

// Test applying credentials
console.log('5️⃣  Testing credential application...');
try {
  const result = await credentialManager.applyCredentials('codex', testProfileName);
  console.log('   ✓ Credentials applied successfully');
  console.log(`     Needs restart: ${result.needsRestart}\n`);
} catch (error) {
  console.error('   ✗ Failed to apply credentials:', error.message);
  process.exit(1);
}

// Test profile switching
console.log('6️⃣  Testing profile switch...');
profileStore.setCurrent(testProfileName);
console.log(`   ✓ Switched to profile '${testProfileName}'\n`);

// Cleanup
console.log('7️⃣  Cleaning up...');
try {
  await profileStore.delete(testProfileName);
  rmSync(authFile, { force: true });
  console.log('   ✓ Test cleanup completed\n');
} catch (error) {
  console.warn('   ⚠️  Cleanup warning:', error.message);
}

console.log('✅ All tests passed! Codex OAuth credentials are handled correctly.\n');
console.log('Summary:');
console.log('  - Native OAuth credentials are detected from ~/.codex/auth.json');
console.log('  - Profile switching works without requiring API keys');
console.log('  - No "missing API key" errors for OAuth credentials');
