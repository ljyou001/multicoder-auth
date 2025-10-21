/**
 * 示例：从环境变量创建Profile
 * 
 * 使用方法：
 * 1. 设置环境变量：export ANTHROPIC_API_KEY="sk-ant-..."
 * 2. 运行脚本：node examples/create-profile-from-env.js
 */

import { ProfileManager } from '../dist/core/profile/profileManager.js';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'unycode-env-example');

async function createProfileFromEnv() {
  console.log('\n🚀 从环境变量创建Profile示例\n');

  // 1. 初始化ProfileManager
  console.log('📦 初始化ProfileManager...');
  const profileManager = new ProfileManager({ configDir: TEST_DIR });
  await profileManager.initialize();
  console.log('✓ 初始化完成\n');

  // 2. 检测可用的环境变量
  console.log('🔍 检测可用的API Key环境变量...');
  const envVars = [
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'OPENAI_API_KEY',
    "AZURE_OPENAI_API_KEY",
    'GEMINI_API_KEY'
  ];

  const availableVars = envVars.filter(envVar => process.env[envVar]);
  
  if (availableVars.length === 0) {
    console.log('❌ 没有找到任何API Key环境变量');
    console.log('请设置以下环境变量之一：');
    envVars.forEach(envVar => console.log(`  - ${envVar}`));
    return;
  }

  console.log(`✓ 找到 ${availableVars.length} 个可用的环境变量：`);
  availableVars.forEach(envVar => {
    const value = process.env[envVar];
    console.log(`  - ${envVar}: ${value.substring(0, 20)}...`);
  });
  console.log('');

  // 3. 为每个环境变量创建Profile
  for (const envVar of availableVars) {
    const apiKey = process.env[envVar];
    const providerId = getProviderFromEnvVar(envVar);
    
    if (!providerId) {
      console.log(`⚠️  跳过未知的环境变量: ${envVar}`);
      continue;
    }

    // 生成唯一的profile名称
    const baseName = providerId;
    let profileName = baseName;
    let counter = 1;
    
    while (profileManager.get(profileName)) {
      profileName = `${baseName}-${counter}`;
      counter++;
    }

    try {
      console.log(`📝 创建Profile: ${profileName} (${envVar})`);
      
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
      console.log(`  ✓ Credential Source: ${profile.credentialSource}`);
      console.log('');

    } catch (error) {
      console.log(`  ❌ 创建失败: ${error.message}\n`);
    }
  }

  // 4. 列出所有Profile
  console.log('📋 所有Profile列表：');
  const profiles = profileManager.list();
  if (profiles.length === 0) {
    console.log('  (无Profile)');
  } else {
    profiles.forEach(profile => {
      console.log(`  - ${profile.name}`);
      console.log(`    Provider: ${profile.providerId}`);
      console.log(`    Model: ${profile.model || 'default'}`);
      console.log(`    Credential Source: ${profile.credentialSource || 'N/A'}`);
      console.log('');
    });
  }

  // 5. 测试Profile切换
  if (profiles.length > 0) {
    console.log('🔄 测试Profile切换...');
    const firstProfile = profiles[0];
    
    try {
      const result = await profileManager.switchProfile(firstProfile.name);
      console.log(`✓ 切换到Profile: ${result.profile.name}`);
      console.log(`  - Needs Restart: ${result.needsRestart ? '是' : '否'}`);
      console.log(`  - 环境变量设置: ${Object.keys(result.envVars).length} 个`);
      
      if (Object.keys(result.envVars).length > 0) {
        for (const [key, value] of Object.entries(result.envVars)) {
          console.log(`    ${key}: ${value.substring(0, 20)}...`);
        }
      }
    } catch (error) {
      console.log(`❌ 切换失败: ${error.message}`);
    }
  }

  console.log('\n✅ 示例完成！');
  console.log(`📁 配置文件位置: ${TEST_DIR}`);
}

// 辅助函数
function getProviderFromEnvVar(envVar) {
  const mapping = {
    'ANTHROPIC_API_KEY': 'anthropic',
    'GOOGLE_API_KEY': 'gemini',
    'GEMINI_API_KEY': 'gemini',
    'OPENAI_API_KEY': 'codex',
    'AZURE_OPENAI_API_KEY': 'codex'
  };
  return mapping[envVar] || null;
}

function getDefaultModel(providerId) {
  const models = {
    'anthropic': 'claude-3-5-sonnet-20241022',
    'gemini': 'gemini-2.0-flash-exp',
    'codex': 'gpt-4'
  };
  return models[providerId] || 'default';
}

// 运行示例
createProfileFromEnv().catch(console.error);



