#!/usr/bin/env node

/**
 * 示例：显示Profile认证状态
 * 
 * 这个脚本演示如何显示profile的详细认证信息，包括：
 * - 认证方式 (OAuth, API Key, Environment Variable)
 * - Credential路径
 * - 过期时间
 * - 有效性状态
 */

import { ProfileManager } from '../dist/core/profile/profileManager.js';
import { CredentialManager } from '../dist/core/auth/credentialManager.js';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'multicoder-auth-status-example');

async function showProfileAuthStatus() {
  console.log('\n🔍 Profile认证状态示例\n');

  // 1. 初始化
  console.log('📦 初始化ProfileManager...');
  const profileManager = new ProfileManager({ configDir: TEST_DIR });
  await profileManager.initialize();
  const credentialManager = profileManager.getCredentialManager();
  console.log('✓ 初始化完成\n');

  // 2. 创建一些测试profile
  console.log('📝 创建测试Profile...');
  
  // 创建使用环境变量的profile
  if (process.env.ANTHROPIC_API_KEY) {
    const profile1 = await profileManager.createProfileWithApiKey(
      'claude-env',
      'anthropic',
      process.env.ANTHROPIC_API_KEY,
      { model: 'claude-3-5-sonnet-20241022', permissionMode: 'ask' }
    );
    console.log(`✓ 创建Profile: ${profile1.name} (Environment Variable)`);
  }

  if (process.env.GOOGLE_API_KEY) {
    const profile2 = await profileManager.createProfileWithApiKey(
      'gemini-managed',
      'gemini',
      process.env.GOOGLE_API_KEY,
      { model: 'gemini-2.0-flash-exp', permissionMode: 'allow' }
    );
    console.log(`✓ 创建Profile: ${profile2.name} (Managed API Key)`);
  }

  // 尝试从native credentials创建profile
  try {
    const credInfo = await credentialManager.getCredentialInfo('claude', 'native-check');
    if (credInfo && credInfo.source === 'native') {
      const profile3 = await profileManager.createProfileFromNative(
        'claude-native',
        'claude',
        { copyToManaged: false }
      );
      console.log(`✓ 创建Profile: ${profile3.name} (Native OAuth)`);
    }
  } catch (error) {
    console.log('○ 跳过Native Claude credentials (未找到)');
  }

  console.log('');

  // 3. 显示所有profile的认证状态
  console.log('📋 所有Profile认证状态:');
  console.log('='.repeat(60));

  const profiles = profileManager.list();
  if (profiles.length === 0) {
    console.log('❌ 没有找到任何Profile');
    return;
  }

  for (const profile of profiles) {
    console.log(`\n🔧 Profile: ${profile.name}`);
    console.log(`   Provider: ${profile.providerId}`);
    console.log(`   Model: ${profile.model || 'default'}`);
    console.log(`   Permission: ${profile.permissionMode}`);
    console.log(`   Credential Source: ${profile.credentialSource || 'N/A'}`);

    if (profile.providerId) {
      try {
        const credInfo = await credentialManager.getCredentialInfo(profile.providerId, profile.name);
        
        if (credInfo) {
          console.log(`   📍 Auth Method: ${formatAuthMethod(credInfo.source)}`);
          
          if (credInfo.path) {
            console.log(`   📁 Path: ${credInfo.path}`);
          }
          
          if (credInfo.envVar) {
            console.log(`   🌍 Env Var: ${credInfo.envVar}`);
          }
          
          if (credInfo.expiresAt) {
            const expiryDate = new Date(credInfo.expiresAt);
            const isValid = credentialManager.isCredentialValid(credInfo);
            const status = isValid ? '✅ Valid' : '❌ Expired';
            console.log(`   ⏰ Expires: ${expiryDate.toLocaleString()} (${status})`);
          } else {
            const isValid = credentialManager.isCredentialValid(credInfo);
            const status = isValid ? '✅ Valid' : '❌ Invalid';
            console.log(`   📊 Status: ${status}`);
          }
        } else {
          console.log(`   ❌ No credentials found`);
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
  }

  // 4. 测试profile切换
  if (profiles.length > 0) {
    console.log('\n🔄 测试Profile切换...');
    const firstProfile = profiles[0];
    
    try {
      const result = await profileManager.switchProfile(firstProfile.name);
      console.log(`✓ 切换到Profile: ${result.profile.name}`);
      console.log(`   - Needs Restart: ${result.needsRestart ? '是' : '否'}`);
      console.log(`   - 环境变量设置: ${Object.keys(result.envVars).length} 个`);
      
      if (Object.keys(result.envVars).length > 0) {
        for (const [key, value] of Object.entries(result.envVars)) {
          console.log(`     ${key}: ${value.substring(0, 20)}...`);
        }
      }
    } catch (error) {
      console.log(`❌ 切换失败: ${error.message}`);
    }
  }

  console.log('\n✅ 认证状态检查完成！');
  console.log(`📁 配置文件位置: ${TEST_DIR}`);
}

// 辅助函数
function formatAuthMethod(source) {
  switch (source) {
    case 'native':
      return '🌐 Browser Login (OAuth)';
    case 'managed':
      return '🔑 API Key (Managed)';
    case 'env':
      return '🌍 API Key (Environment)';
    default:
      return '❓ Unknown';
  }
}

// 运行示例
showProfileAuthStatus().catch(console.error);



