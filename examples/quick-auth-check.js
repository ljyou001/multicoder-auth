#!/usr/bin/env node

/**
 * 快速认证状态检查
 * 
 * 使用方法：
 * node examples/quick-auth-check.js
 */

import { ProfileManager } from '../dist/core/profile/profileManager.js';
import path from 'node:path';
import os from 'node:os';

async function quickAuthCheck() {
  console.log('🔍 快速认证状态检查\n');

  const profileManager = new ProfileManager({ 
    configDir: path.join(os.tmpdir(), 'unycode-quick-auth-check') 
  });
  await profileManager.initialize();

  const profiles = profileManager.list();
  
  if (profiles.length === 0) {
    console.log('❌ 没有找到任何Profile');
    console.log('请先创建一些Profile或设置环境变量');
    return;
  }

  console.log(`📋 找到 ${profiles.length} 个Profile:\n`);

  for (const profile of profiles) {
    console.log(`🔧 ${profile.name}`);
    console.log(`   Provider: ${profile.providerId || 'N/A'}`);
    console.log(`   Model: ${profile.model || 'default'}`);
    console.log(`   Credential Source: ${profile.credentialSource || 'N/A'}`);
    
    // 显示认证方式
    if (profile.credentialSource) {
      const authMethod = formatAuthMethod(profile.credentialSource);
      console.log(`   Auth Method: ${authMethod}`);
    }
    
    console.log('');
  }

  // 显示当前profile
  const current = profileManager.getCurrent();
  if (current) {
    console.log(`👉 当前Profile: ${current.name}`);
  }
}

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

quickAuthCheck().catch(console.error);



