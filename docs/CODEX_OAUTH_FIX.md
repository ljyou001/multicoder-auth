# Codex OAuth Credentials Fix

## 问题描述

当使用OAuth方式登录Codex（通过`codex login`命令）后，切换profile时会出现以下错误：

```
⚠️  Failed to apply credentials: codex: Codex credential is missing an API key. Please re-authenticate.
```

## 根本原因

Codex支持两种认证方式：

1. **OAuth认证** - 通过`codex login`浏览器登录，credentials存储在`~/.codex/auth.json`（native方式）
2. **API Key认证** - 通过`--openai-api-key`或`--azure-openai-api-key`提供，credentials存储在managed storage

问题在于`CredentialManager.applyCredentials()`方法在处理Codex时，只考虑了managed credentials（API key方式），没有正确处理native OAuth credentials。

## 修复内容

### 1. 识别OAuth Tokens vs API Key

修改了`loadCodexCredentialData`方法，能够识别managed storage中的OAuth tokens：

```typescript
if (data.tokens && (data.tokens.access_token || data.tokens.id_token)) {
  // This is OAuth credential stored in managed storage
  return data;
}
```

### 2. 更新 `applyCredentials` 逻辑

修改了`applyCredentials`方法，区分三种情况并清理环境变量：

```typescript
if (providerId === 'codex') {
  if (credInfo.source === 'managed') {
    const codexData = await this.loadCodexCredentialData(credInfo);
    
    if (codexData.tokens) {
      // OAuth tokens - 清理环境变量并复制到 ~/.codex/auth.json
      await clearCodexEnvironment(this.systemEnvManager);
      await this.copyManagedToNative(providerId, profileName);
    } else if (codexData.apiKey) {
      // API key - 清理旧环境变量并注入新的
      await clearCodexEnvironment(this.systemEnvManager);
      await applyCodexEnvironment(...);
    }
  } else if (credInfo.source === 'native') {
    // Native OAuth - 清理环境变量
    await clearCodexEnvironment(this.systemEnvManager);
  }
}
```

### 3. 添加 `clearCodexEnvironment` 函数

在`codexEnv.ts`中统一了清理环境变量的函数。

## 认证方式对比

| 特性 | OAuth认证 | API Key认证 |
|------|----------|------------|
| 登录方式 | `codex login` (浏览器) | `--openai-api-key` / `--azure-openai-api-key` |
| Credentials存储 | Managed → Native (`~/.codex/auth.json`) | Managed storage |
| 环境变量 | 不需要 | 需要注入 `OPENAI_API_KEY` 等 |
| Profile切换 | 复制OAuth tokens到native文件 | 注入环境变量 |
| 文件内容 | `tokens: { access_token, id_token, refresh_token }` | `apiKey: "sk-..."` |

## 测试验证

运行测试脚本验证修复：

```bash
node scripts/test-codex-oauth.js
```

## 使用示例

### OAuth方式登录

```bash
node dist/auth/cli-v2.js profile create my-codex-profile
node dist/auth/cli-v2.js login codex
node dist/auth/cli-v2.js profile switch my-codex-profile
```

### API Key方式登录

```bash
node dist/auth/cli-v2.js login codex --openai-api-key sk-xxx
node dist/auth/cli-v2.js login codex --azure-openai-api-key xxx --azure-resource-name my-resource
```
