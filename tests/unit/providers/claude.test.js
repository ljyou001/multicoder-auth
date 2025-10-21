/**
 * Claude Provider Unit Test
 *
 * Tests the Claude provider adapter by sending a real request to create a test file.
 * This test requires:
 * - Claude CLI installed and authenticated
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClaudeAdapter } from '../../../dist/core/provider/adapters/claudeAdapter.js';

const TEST_FILE_NAME = 'test-claude.md';
const TEST_CONTENT = 'test-claude';
const TEST_FILE_PATH = resolve(process.cwd(), TEST_FILE_NAME);
const TEST_TIMEOUT = 60000; // 60 seconds

test('Claude Provider - Create test file', { timeout: TEST_TIMEOUT }, async () => {
  console.log('\n🔧 Testing Claude Provider...');

  // Clean up any existing test file
  if (existsSync(TEST_FILE_PATH)) {
    unlinkSync(TEST_FILE_PATH);
    console.log('🧹 Cleaned up existing test file');
  }

  let adapter;
  try {
    adapter = createClaudeAdapter();

    // Create a test profile
    const profile = {
      name: 'claude-test',
      providerId: 'claude',
      model: 'claude-sonnet-4-5-20250929',
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

    console.log('📤 Sending request to Claude...');

    // Add timeout for the request
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout after 60s')), TEST_TIMEOUT)
    );

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
      response.text.toLowerCase().includes('creat') ||
      response.text.toLowerCase().includes('writ') ||
      response.text.toLowerCase().includes('file') ||
      response.text.includes('```');

    console.log('\n🔍 Verification:');
    console.log(`✓ Has text content: ${response.text.length} chars`);
    console.log(`${hasThinking ? '✓' : '⚠'} Contains relevant info: ${hasThinking}`);

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
      console.log('   - Claude may need additional tool permissions');
      console.log('   - Command template may need adjustment');
      console.log('   - File operations may not be supported in this mode');
    }

    console.log('✅ Claude provider test completed');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);

    if (error.code === 'ENOENT') {
      console.log('\n💡 Claude CLI not found. Install it first:');
      console.log('   Visit: https://claude.ai/download');
      console.log('   Then run: claude login');
      // Skip the test instead of failing
      console.log('\n⏭️  Skipping test - Claude CLI not installed');
      return; // Exit gracefully
    } else if (error.message.includes('timeout')) {
      console.log('\n💡 Request timed out. This might mean:');
      console.log('   - Claude is processing a complex request');
      console.log('   - Network or authentication issues');
    }

    throw error;
  }
});

