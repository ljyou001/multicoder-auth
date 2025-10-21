#!/usr/bin/env node

/**
 * 简单示例：直接从环境变量创建Profile
 * 
 * 使用方法：
 * ANTHROPIC_API_KEY="sk-ant-..." node examples/simple-env-profile.js
 * GOOGLE_API_KEY="AI..." node examples/simple-env-profile.js
 */

import { ProfileManager } from '../dist/core/profile/profileManager.js';
import path from 'node:path';
import os from 'node:os';

async function main() {
  console.log('🚀 从环境变量快速创建Profile\n');

  // 检查环境变量
  const envVars = {
    'ANTHROPIC_API_KEY': 'anthropic',
    'GOOGLE_API_KEY': 'gemini',
    'OPENAI_API_KEY': 'codex'
  };

  const foundVars = Object.entries(envVars).filter(([envVar]) => process.env[envVar]);
  
  if (foundVars.length === 0) {
    console.log('❌ 没有找到任何API Key环境变量');
    console.log('请设置以下环境变量之一：');
    Object.keys(envVars).forEach(envVar => console.log(`  export ${envVar}="your-api-key"`));
    process.exit(1);
  }

  // 初始化ProfileManager
  const profileManager = new ProfileManager({ 
    configDir: path.join(os.tmpdir(), 'multicoder-simple-example') 
  });
  await profileManager.initialize();

  // 为每个找到的环境变量创建Profile
  for (const [envVar, providerId] of foundVars) {
    const apiKey = process.env[envVar];
    const profileName = `${providerId}-env-${Date.now()}`;

    try {
      console.log(`📝 创建Profile: ${profileName}`);
      
      const profile = await profileManager.createProfileWithApiKey(
        profileName,
        providerId,
        apiKey,
        {
          model: getDefaultModel(providerId),
          permissionMode: 'ask'
        }
      );

      console.log(`  ✓ Provider: ${providerId}`);
      console.log(`  ✓ Model: ${profile.model}`);
      console.log(`  ✓ API Key: ${apiKey.substring(0, 20)}...`);
      
      // 切换到新创建的Profile
      const result = await profileManager.switchProfile(profileName);
      console.log(`  ✓ 已切换到Profile: ${profileName}`);
      console.log(`  ✓ 环境变量已设置: ${Object.keys(result.envVars).join(', ')}`);
      console.log('');

    } catch (error) {
      console.log(`  ❌ 创建失败: ${error.message}\n`);
    }
  }

  console.log('✅ 完成！现在可以使用这个Profile了。');
}

function getDefaultModel(providerId) {
  const models = {
    'anthropic': 'claude-3-5-sonnet-20241022',
    'gemini': 'gemini-2.0-flash-exp',
    'codex': 'gpt-4'
  };
  return models[providerId] || 'default';
}

main().catch(console.error);



