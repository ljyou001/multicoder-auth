/**
 * Codex API key native credential tests
 *
 * Ensures that managed Codex API keys are written to ~/.codex/auth.json
 * instead of mutating OS-level environment variables.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function withTempHome(run) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-api-key-'));
  const nativeCodexDir = path.join(tmpRoot, '.codex');
  const nativeAuthPath = path.join(nativeCodexDir, 'auth.json');

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await fs.mkdir(nativeCodexDir, { recursive: true });
    process.env.HOME = tmpRoot;
    process.env.USERPROFILE = tmpRoot;
    await run(tmpRoot, nativeAuthPath);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

test('writes OpenAI Codex API key to ~/.codex/auth.json', async () => {
  await withTempHome(async (tmpRoot, nativeAuthPath) => {
    const { CredentialManager } = await import(
      `../../../dist/auth/credentialManager.js?${Date.now()}`
    );
    const credentialManager = new CredentialManager(tmpRoot);
    await credentialManager.initialize();

    await credentialManager.saveCredentialData('codex', 'test-profile', {
      apiKey: 'sk-openai-test',
    });
    await credentialManager.applyCredentials('codex', 'test-profile');

    const fileContent = await fs.readFile(nativeAuthPath, 'utf-8');
    const nativeData = JSON.parse(fileContent);

    assert.strictEqual(nativeData.OPENAI_API_KEY, 'sk-openai-test');
    assert.strictEqual(nativeData.OPENAI_BASE_URL, null);
    assert.strictEqual(nativeData.provider, 'openai');
    assert.strictEqual(nativeData.type, 'api-key');
  });
});

test('writes Azure Codex API key with computed base URL', async () => {
  await withTempHome(async (tmpRoot, nativeAuthPath) => {
    const { CredentialManager } = await import(
      `../../../dist/auth/credentialManager.js?${Date.now()}`
    );
    const credentialManager = new CredentialManager(tmpRoot);
    await credentialManager.initialize();

    await credentialManager.saveCredentialData('codex', 'azure-profile', {
      apiKey: 'sk-azure-test',
      provider: 'azure',
      azureResourceName: 'test-resource',
    });
    await credentialManager.applyCredentials('codex', 'azure-profile');

    const fileContent = await fs.readFile(nativeAuthPath, 'utf-8');
    const nativeData = JSON.parse(fileContent);

    assert.strictEqual(nativeData.OPENAI_API_KEY, 'sk-azure-test');
    assert.strictEqual(nativeData.provider, 'azure');
    assert.strictEqual(nativeData.azureResourceName, 'test-resource');
    assert.match(nativeData.OPENAI_BASE_URL, /test-resource\.openai\.azure\.com/);
  });
});
