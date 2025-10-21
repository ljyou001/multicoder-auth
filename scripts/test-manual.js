/**
 * 手动测试脚本 - 测试多Provider认证和Profile持久化
 *
 * 运行方式: node test-manual.js
 */

import { ProfileManager } from '../dist/core/profile/profileManager.js';
import { CredentialManager } from '../dist/core/auth/credentialManager.js';
import path from 'node:path';
import os from 'node:os';

const TEST_CONFIG_DIR = path.join(os.tmpdir(), 'multicoder-manual-test');

async function main() {
  console.log('\n🧪 开始手动测试...\n');

  // 1. 初始化
  console.log('📦 步骤 1: 初始化 ProfileManager');
  const profileManager = new ProfileManager({ configDir: TEST_CONFIG_DIR });
  await profileManager.initialize();
  console.log('✓ ProfileManager 初始化成功\n');

  // 2. 检测原生凭证
  console.log('🔍 步骤 2: 检测原生凭证');
  const credManager = profileManager.getCredentialManager();

  const providers = ['claude', 'gemini', 'codex', 'q'];
  for (const providerId of providers) {
    try {
      const credInfo = await credManager.getCredentialInfo(providerId, 'native-check');
      if (credInfo && credInfo.source === 'native') {
        const isValid = credManager.isCredentialValid(credInfo);
        console.log(`  ✓ ${providerId}: 检测到原生凭证 (${credInfo.path})`);
        console.log(`    - 来源: ${credInfo.source}`);
        console.log(`    - 有效: ${isValid ? '是' : '否'}`);
        if (credInfo.expiresAt) {
          const expiryDate = new Date(credInfo.expiresAt);
          console.log(`    - 过期时间: ${expiryDate.toLocaleString()}`);
        }
      } else {
        console.log(`  ○ ${providerId}: 未检测到原生凭证`);
      }
    } catch (error) {
      console.log(`  ○ ${providerId}: 未安装或未登录`);
    }
  }
  console.log('');

  // 3. 创建测试用Profile（使用API Key）
  console.log('📝 步骤 3: 创建测试Profile');

  // 检查环境变量
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasGoogleKey = !!process.env.GOOGLE_API_KEY;

  if (hasAnthropicKey) {
    const profile = await profileManager.createProfileWithApiKey(
      'test-anthropic',
      'anthropic',
      process.env.ANTHROPIC_API_KEY,
      { model: 'claude-3-5-sonnet-20241022', permissionMode: 'ask' }
    );
    console.log(`  ✓ 创建 Anthropic API Profile: ${profile.name}`);
    console.log(`    - Model: ${profile.model}`);
    console.log(`    - Permission: ${profile.permissionMode}`);
  } else {
    console.log('  ○ 跳过 Anthropic (未设置 ANTHROPIC_API_KEY)');
  }

  if (hasGoogleKey) {
    const profile = await profileManager.createProfileWithApiKey(
      'test-gemini',
      'gemini',
      process.env.GOOGLE_API_KEY,
      { model: 'gemini-2.0-flash-exp', permissionMode: 'allow' }
    );
    console.log(`  ✓ 创建 Gemini API Profile: ${profile.name}`);
    console.log(`    - Model: ${profile.model}`);
    console.log(`    - Permission: ${profile.permissionMode}`);
  } else {
    console.log('  ○ 跳过 Gemini (未设置 GOOGLE_API_KEY)');
  }

  // 从原生凭证创建Profile
  for (const providerId of ['claude', 'codex']) {
    try {
      const credInfo = await credManager.getCredentialInfo(providerId, 'test-check');
      if (credInfo && credInfo.source === 'native') {
        const profile = await profileManager.createProfileFromNative(
          `test-${providerId}`,
          providerId,
          { copyToManaged: false }
        );
        console.log(`  ✓ 创建 ${providerId} Profile (使用原生凭证): ${profile.name}`);
        console.log(`    - Credential Source: ${profile.credentialSource}`);
      }
    } catch (error) {
      // 忽略
    }
  }
  console.log('');

  // 4. 列出所有Profile
  console.log('📋 步骤 4: 列出所有Profile');
  const profiles = profileManager.list();
  console.log(`  总共 ${profiles.length} 个Profile:\n`);
  for (const profile of profiles) {
    console.log(`  - ${profile.name}`);
    console.log(`    Provider: ${profile.providerId || '未设置'}`);
    console.log(`    Model: ${profile.model || '未设置'}`);
    console.log(`    Permission: ${profile.permissionMode}`);
    console.log(`    Credential Source: ${profile.credentialSource || 'N/A'}`);
    console.log('');
  }

  // 5. 测试Profile切换
  if (profiles.length > 0) {
    console.log('🔄 步骤 5: 测试Profile切换');
    const firstProfile = profiles[0];

    if (firstProfile.providerId) {
      try {
        const result = await profileManager.switchProfile(firstProfile.name);
        console.log(`  ✓ 切换到Profile: ${result.profile.name}`);
        console.log(`    - Needs Restart: ${result.needsRestart ? '是' : '否'}`);
        console.log(`    - Env Vars Set: ${Object.keys(result.envVars).length} 个`);
        if (Object.keys(result.envVars).length > 0) {
          for (const [key, value] of Object.entries(result.envVars)) {
            console.log(`      ${key}: ${value.substring(0, 20)}...`);
          }
        }
        console.log('');
      } catch (error) {
        console.log(`  ✗ 切换失败: ${error.message}\n`);
      }
    }
  }

  // 6. 测试持久化
  console.log('💾 步骤 6: 测试Profile持久化');
  const profilesPath = path.join(TEST_CONFIG_DIR, 'profiles.json');

  // 等待自动保存
  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    const { promises: fs } = await import('node:fs');
    const content = await fs.readFile(profilesPath, 'utf-8');
    const data = JSON.parse(content);

    console.log(`  ✓ profiles.json 已创建`);
    console.log(`    路径: ${profilesPath}`);
    console.log(`    当前Profile: ${data.current || '未设置'}`);
    console.log(`    已保存Profile数: ${data.profiles.length}`);
    console.log('');
  } catch (error) {
    console.log(`  ✗ 持久化失败: ${error.message}\n`);
  }

  // 7. 模拟应用重启
  console.log('🔄 步骤 7: 模拟应用重启（重新加载Profile）');
  const profileManager2 = new ProfileManager({ configDir: TEST_CONFIG_DIR });
  await profileManager2.initialize();

  const loadedProfiles = profileManager2.list();
  const currentProfile = profileManager2.getCurrent();

  console.log(`  ✓ 从文件加载了 ${loadedProfiles.length} 个Profile`);
  console.log(`  ✓ 当前Profile: ${currentProfile ? currentProfile.name : '未设置'}`);
  console.log('');

  // 8. 验证凭证有效性
  console.log('✅ 步骤 8: 验证凭证有效性');
  for (const profile of loadedProfiles) {
    if (profile.providerId) {
      const hasValid = await profileManager2.hasValidCredentials(profile.name);
      console.log(`  ${hasValid ? '✓' : '✗'} ${profile.name}: ${hasValid ? '凭证有效' : '凭证无效或不存在'}`);
    }
  }
  console.log('');

  // 9. 测试清理
  console.log('🧹 步骤 9: 清理测试数据');
  const { promises: fs } = await import('node:fs');
  await fs.rm(TEST_CONFIG_DIR, { recursive: true, force: true });
  console.log('  ✓ 测试数据已清理\n');

  console.log('✅ 手动测试完成！\n');
  console.log('📊 测试总结:');
  console.log(`  - 检测到的原生凭证Provider数: ${providers.length}`);
  console.log(`  - 创建的Profile数: ${profiles.length}`);
  console.log(`  - 持久化: ${profiles.length > 0 ? '成功' : '跳过'}`);
  console.log(`  - Profile加载: ${loadedProfiles.length === profiles.length ? '成功' : '失败'}`);
  console.log('');
}

main().catch(error => {
  console.error('\n❌ 测试失败:', error);
  process.exit(1);
});
