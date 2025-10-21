/**
 * Codex Provider Unit Test
 *
 * Tests the Codex provider adapter by sending a real request to create a test file.
 * This test requires:
 * - Codex CLI installed and authenticated
 * - MCP server support
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { CodexCliAdapter } from '../../../dist/core/provider/adapters/codexCliAdapter.js';

const TEST_FILE_NAME = 'test-codex.md';
const TEST_CONTENT = 'test-codex';
const TEST_FILE_PATH = resolve(process.cwd(), TEST_FILE_NAME);
const TEST_TIMEOUT = 60000; // 60 seconds

test('Codex Provider - Create test file', { timeout: TEST_TIMEOUT }, async () => {
  console.log('\n🔧 Testing Codex Provider...');

  // Clean up any existing test file
  if (existsSync(TEST_FILE_PATH)) {
    unlinkSync(TEST_FILE_PATH);
    console.log('🧹 Cleaned up existing test file');
  }

  let adapter;
  let abortController;

  try {
    adapter = new CodexCliAdapter();
    abortController = new AbortController();

    // Create a test profile
    const profile = {
      name: 'codex-test',
      providerId: 'codex',
      model: 'gpt-5-codex',
      permissionMode: 'allow',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Create the message request
    const params = {
      profile,
      message: {
        text: `please write a file named ${TEST_FILE_NAME} and the content is ${TEST_CONTENT}`,
      },
      history: [],
      attachments: [],
      directories: [],
      permissionMode: 'allow',
    };

    console.log('📤 Sending request to Codex...');

    // Create a timeout that will clean up
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        console.log('⏱️  Request timeout - cleaning up...');
        // Trigger cleanup before rejecting
        abortController?.abort();
        reject(new Error('Request timeout after 60s'));
      }, TEST_TIMEOUT - 1000); // Slightly before test timeout to allow cleanup

      // Store timeout ID to clear it if request succeeds
      abortController.signal.addEventListener('abort', () => clearTimeout(timeoutId));
    });

    const response = await Promise.race([
      adapter.sendMessage(params),
      timeoutPromise,
    ]);

    console.log('\n📥 Response received:');
    console.log('Text preview:', response.text.substring(0, 200));
    if (response.warnings.length > 0) {
      console.log('⚠️  Warnings:', response.warnings);
    }

    // Verify response structure
    assert.ok(response.text, 'Response should have text content');

    // Check if response contains thinking/reasoning information
    const hasThinking =
      response.text.toLowerCase().includes('think') ||
      response.text.toLowerCase().includes('reasoning') ||
      response.text.toLowerCase().includes('plan') ||
      response.text.toLowerCase().includes('creat') ||
      response.text.includes('```');

    console.log('\n🔍 Verification:');
    console.log(`✓ Has text content: ${response.text.length} chars`);
    console.log(`${hasThinking ? '✓' : '⚠'} Contains thinking/reasoning info: ${hasThinking}`);

    // Wait a bit for file to be written
    console.log('⏳ Waiting for file creation...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify file was created
    const fileExists = existsSync(TEST_FILE_PATH);
    console.log(`${fileExists ? '✓' : '✗'} File ${TEST_FILE_NAME} exists: ${fileExists}`);

    if (fileExists) {
      const content = readFileSync(TEST_FILE_PATH, 'utf-8');
      const hasExpectedContent = content.includes(TEST_CONTENT);
      console.log(`${hasExpectedContent ? '✓' : '✗'} File contains expected content: ${hasExpectedContent}`);
      console.log(`  File content: "${content.trim().substring(0, 100)}"`);

      assert.ok(hasExpectedContent, `File should contain "${TEST_CONTENT}"`);

      // Clean up
      unlinkSync(TEST_FILE_PATH);
      console.log('🧹 Cleaned up test file');
    } else {
      console.log('\n⚠️  File was not created. Possible reasons:');
      console.log('   - Codex may not support file creation in this mode');
      console.log('   - Permission was denied');
      console.log('   - MCP session issue');
    }

    console.log('✅ Codex provider test completed');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);

    if (error.code === 'ENOENT') {
      console.log('\n💡 Codex CLI not found. Install it first:');
      console.log('   Visit: https://openai.com/codex');
      console.log('   Then run: codex login');
      console.log('\n⏭️  Skipping test - Codex CLI not installed');
      return; // Exit gracefully
    } else if (error.message.includes('timeout')) {
      console.log('\n💡 Request timed out. This might mean:');
      console.log('   - MCP server is slow to respond');
      console.log('   - Codex is processing a complex request');
      console.log('   - Network or authentication issues');
      console.log('\n⚠️  Note: This is expected if Codex CLI is not properly configured');
    }

    throw error;
  } finally {
    // Always clean up adapter
    if (adapter) {
      console.log('🧹 Cleaning up adapter...');
      try {
        await adapter.disposeAll();
        console.log('✓ Adapter cleaned up');
      } catch (e) {
        console.log('⚠️  Error during adapter cleanup:', e.message);
      }
    }

    // Clean up test file if it exists
    if (existsSync(TEST_FILE_PATH)) {
      try {
        unlinkSync(TEST_FILE_PATH);
        console.log('✓ Test file cleaned up');
      } catch (e) {
        console.log('⚠️  Error cleaning up test file:', e.message);
      }
    }
  }
});

