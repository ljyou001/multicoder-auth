#!/usr/bin/env node

/**
 * 测试 cli-v2.ts 中的认证状态显示功能
 * 
 * 使用方法：
 * 1. 设置环境变量：export ANTHROPIC_API_KEY="sk-ant-..."
 * 2. 运行测试：node examples/test-cli-v2-auth-status.js
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

async function testCliV2AuthStatus() {
  console.log('🧪 测试 cli-v2.ts 认证状态显示功能\n');

  const cliPath = path.join(process.cwd(), 'dist', 'auth', 'cli-v2.js');
  
  // 测试命令列表
  const testCommands = [
    ['--help'],
    ['profile', 'list'],
    ['profile', 'create-from-env'],
    ['profile', 'current'],
    ['status'],
    ['whoami']
  ];

  for (const [command, ...args] of testCommands) {
    console.log(`\n🔧 测试命令: coders ${[command, ...args].join(' ')}`);
    console.log('─'.repeat(50));
    
    try {
      await runCommand(cliPath, [command, ...args]);
    } catch (error) {
      console.log(`❌ 命令执行失败: ${error.message}`);
    }
    
    console.log('');
  }

  console.log('✅ 测试完成！');
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [command, ...args], {
      stdio: 'inherit',
      shell: true
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command exited with code ${code}`));
      }
    });
  });
}

// 运行测试
testCliV2AuthStatus().catch(console.error);


