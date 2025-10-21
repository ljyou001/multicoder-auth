/**
 * 快速测试 - 只检查核心功能是否正常
 */

import { ProfileManager } from '../dist/core/profile/profileManager.js';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'multicoder-quick-test');

async function quickTest() {
  console.log('\n⚡ 快速测试开始...\n');

  try {
    // 1. 初始化
    console.log('1️⃣ 初始化 ProfileManager...');
    const pm = new ProfileManager({ configDir: TEST_DIR });
    await pm.initialize();
    console.log('   ✓ 初始化成功\n');

    // 2. 创建Profile
    console.log('2️⃣ 创建测试Profile...');
    const profile1 = pm.ensure('test-profile-1');
    profile1.providerId = 'gemini';
    profile1.model = 'gemini-2.0-flash-exp';
    pm.update(profile1);
    console.log('   ✓ Profile 1 创建成功\n');

    const profile2 = pm.ensure('test-profile-2');
    profile2.providerId = 'claude';
    profile2.permissionMode = 'allow';
    pm.update(profile2);
    console.log('   ✓ Profile 2 创建成功\n');

    // 3. 列出Profile
    console.log('3️⃣ 列出所有Profile...');
    const profiles = pm.list();
    console.log(`   ✓ 共 ${profiles.length} 个Profile:`);
    profiles.forEach(p => console.log(`     - ${p.name} (${p.providerId})`));
    console.log('');

    // 4. 设置当前Profile
    console.log('4️⃣ 设置当前Profile...');
    pm.setCurrent(profile2);
    const current = pm.getCurrent();
    console.log(`   ✓ 当前Profile: ${current.name}\n`);

    // 5. 等待自动保存
    console.log('5️⃣ 等待自动保存...');
    await new Promise(r => setTimeout(r, 200));
    console.log('   ✓ 保存完成\n');

    // 6. 验证文件
    console.log('6️⃣ 验证 profiles.json...');
    const { promises: fs } = await import('node:fs');
    const profilesPath = path.join(TEST_DIR, 'profiles.json');
    const content = await fs.readFile(profilesPath, 'utf-8');
    const data = JSON.parse(content);
    console.log(`   ✓ 文件存在: ${profilesPath}`);
    console.log(`   ✓ 保存了 ${data.profiles.length} 个Profile`);
    console.log(`   ✓ 当前Profile: ${data.current}\n`);

    // 7. 模拟重启（重新加载）
    console.log('7️⃣ 模拟重启 - 重新加载...');
    const pm2 = new ProfileManager({ configDir: TEST_DIR });
    await pm2.initialize();
    const loaded = pm2.list();
    const loadedCurrent = pm2.getCurrent();
    console.log(`   ✓ 加载了 ${loaded.length} 个Profile`);
    console.log(`   ✓ 当前Profile: ${loadedCurrent.name}\n`);

    // 8. 验证数据一致性
    console.log('8️⃣ 验证数据一致性...');
    if (loaded.length === profiles.length) {
      console.log('   ✓ Profile数量一致');
    } else {
      throw new Error(`Profile数量不一致: ${loaded.length} vs ${profiles.length}`);
    }
    if (loadedCurrent.name === current.name) {
      console.log('   ✓ 当前Profile一致');
    } else {
      throw new Error(`当前Profile不一致: ${loadedCurrent.name} vs ${current.name}`);
    }
    console.log('');

    // 9. 测试删除
    console.log('9️⃣ 测试删除Profile...');
    pm2.delete('test-profile-1');
    await new Promise(r => setTimeout(r, 200));
    console.log('   ✓ 删除成功\n');

    // 10. 验证删除持久化
    console.log('🔟 验证删除持久化...');
    const pm3 = new ProfileManager({ configDir: TEST_DIR });
    await pm3.initialize();
    const final = pm3.list();
    console.log(`   ✓ 剩余 ${final.length} 个Profile`);
    if (final.length === 1 && final[0].name === 'test-profile-2') {
      console.log('   ✓ 删除持久化验证成功\n');
    } else {
      throw new Error('删除持久化验证失败');
    }

    // 清理
    await fs.rm(TEST_DIR, { recursive: true, force: true });

    console.log('✅ 所有测试通过！\n');
    console.log('📊 测试结果:');
    console.log('   ✓ Profile创建');
    console.log('   ✓ Profile更新');
    console.log('   ✓ Profile列出');
    console.log('   ✓ 自动保存');
    console.log('   ✓ 文件持久化');
    console.log('   ✓ 重启后加载');
    console.log('   ✓ 数据一致性');
    console.log('   ✓ Profile删除');
    console.log('   ✓ 删除持久化');
    console.log('');

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
  }
}

quickTest();
