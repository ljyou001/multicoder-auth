# multicoder

<div align="center">

<img src="./asset/icon.png" alt="multicoder icon" width="160" />

**多提供商 AI 开发的统一身份验证与配置管理方案**

[![npm version](https://img.shields.io/npm/v/multicoder.svg)](https://www.npmjs.com/package/multicoder)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

[English](./README.md) | [简体中文](./readme_zh.md)

</div>

---

## 项目简介

**multicoder** 是一个为多 AI 提供商开发场景设计的综合性身份验证与配置管理解决方案。它提供统一的接口来管理凭据、切换配置文件，并在 Anthropic Claude、Google Gemini、OpenAI/Codex、Amazon Q 等多个平台间保持一致的认证状态。

无论您是在构建自动化工具、桌面应用程序还是命令行工具，multicoder 都能帮您消除管理多个 API 密钥和 OAuth 流程的复杂性。

## 为什么选择 multicoder?

- **🔐 统一认证**: 为所有 AI 提供商提供一致的 API 接口
- **👤 配置管理**: 轻松在不同的开发环境之间切换
- **🔄 自动迁移**: 无缝迁移旧版本配置文件
- **🌍 跨平台**: 支持 Windows、macOS 和 Linux
- **🛠️ 开发友好**: CLI 工具、编程 API 和丰富的示例
- **🔌 可扩展**: 基于插件的架构，轻松添加新提供商

## 核心功能

### 基于配置文件的凭据管理
按配置文件隔离凭据，自动从旧版 `multicoder` 和 `unycode` 配置迁移。每个配置文件维护自己的提供商凭据集，轻松管理多个账户或环境。

### 通用凭据管理器
`CredentialManager` 智能处理：
- 原生 OAuth 令牌缓存
- 安全的 API 密钥存储
- 环境变量集成
- 自动凭据刷新

### 多提供商支持
内置主流 AI 平台的认证器：
- **Anthropic Claude** - API 密钥和 OAuth 支持
- **Google Gemini** - API 密钥认证
- **OpenAI/Codex** - OAuth 自动令牌刷新
- **Amazon Q** - 原生凭据集成

### 跨平台环境管理
`SystemEnvironmentManager` 提供跨平台的统一环境变量持久化：
- **Windows**: 用户和系统级注册表管理
- **macOS/Linux**: Shell 集成（bash、zsh、fish）
- 自动检测和更新 shell 配置文件

### 命令行界面
功能完善的 CLI（`coders`）用于交互式认证管理：
```bash
coders profile create my-dev-profile
coders login gemini
coders switch my-dev-profile
coders status
```

## 安装

```bash
npm install multicoder
```

或全局安装以在任何位置使用 CLI：

```bash
npm install -g multicoder
```

## 快速开始

### 编程方式使用

```typescript
import { ProfileManager, authRegistry } from 'multicoder';

// 初始化配置管理器
const profileManager = new ProfileManager();
await profileManager.initialize();

// 使用 API 密钥创建配置文件
await profileManager.createProfileWithApiKey(
  'gemini-dev',
  'gemini',
  process.env.GOOGLE_API_KEY
);

// 切换到该配置文件
const result = await profileManager.switchProfile('gemini-dev');
console.log(`已应用的凭据:`, result.appliedCredentials);

// 使用特定提供商的认证器
const geminiAuth = authRegistry.get('gemini');
const authResult = await geminiAuth?.authenticate({
  profile: 'gemini-dev'
});
```

### CLI 使用

安装后，使用 `coders` 命令：

```bash
# 列出所有配置文件
coders profile list

# 创建新配置文件
coders profile create my-profile

# 从环境变量创建配置文件
coders profile create-from-env dev-env

# 登录到提供商
coders login gemini
coders login claude

# 切换活动配置文件
coders switch my-profile

# 检查认证状态
coders status
coders whoami

# 从提供商登出
coders logout gemini

# 删除配置文件
coders profile delete my-profile
```

## 配置与存储

### 配置目录

默认: `~/.multicoder`
覆盖: 设置 `MULTICODER_CONFIG_DIR` 环境变量

### 目录结构

```
~/.multicoder/
├── credentials/          # 托管的提供商凭据
│   ├── gemini/
│   ├── claude/
│   └── codex/
├── profiles.json         # 配置文件设置
├── env.sh               # POSIX 环境变量
└── config.json          # 全局设置
```

### 旧版迁移

模块会自动从以下位置迁移配置：
- `~/.config/multicoder`
- `~/.config/unycoding`
- `%APPDATA%\multicoder` (Windows)
- `%APPDATA%\unycoding` (Windows)
- `~/Library/Application Support/multicoder` (macOS)
- `~/Library/Application Support/unycoding` (macOS)

## 高级用法

### 创建自定义认证器

```typescript
import { BaseAuthenticator, authRegistry } from 'multicoder';

class MyCustomAuth extends BaseAuthenticator {
  async authenticate(options) {
    // 您的认证逻辑
  }

  async getCredentials(options) {
    // 获取凭据
  }
}

// 注册您的认证器
authRegistry.register('my-provider', new MyCustomAuth());
```

### 环境变量管理

```typescript
import { SystemEnvironmentManager } from 'multicoder';

const envManager = new SystemEnvironmentManager();

// 设置持久化环境变量
await envManager.setEnvironmentVariable(
  'MY_API_KEY',
  'secret-value',
  { persistent: true }
);

// 获取当前环境
const env = await envManager.getCurrentEnvironment();
```

## 开发

### 从源码构建

```bash
# 安装依赖
npm install

# 构建 TypeScript
npm run build

# 运行测试
npm test
```

### 测试

```bash
# 运行所有测试
npm test

# 特定提供商测试
npm run test:gemini
npm run test:claude
npm run test:codex

# 快速冒烟测试
npm run test:quite
```

### 示例

浏览 `examples/` 目录查看实际用例：

- `create-profile-from-env.js` - 从现有环境引导配置文件
- `quick-auth-check.js` - 验证认证状态
- `simple-env-profile.js` - 基本配置文件创建流程
- `test-cli-v2-auth-status.js` - CLI 集成模式

## 故障排除

### Codex/OpenAI OAuth 问题

如果遇到 Codex 相关的 OAuth 问题，请参考 `docs/CODEX_OAUTH_FIX.md` 获取详细的故障排除步骤。

### 环境变量未持久化

设置环境变量后请确保重新加载您的 shell：

```bash
# 对于 bash/zsh
source ~/.bashrc  # 或 ~/.zshrc

# 或打开新的终端窗口
```

### 权限问题

在 Unix 系统上，确保配置目录具有正确的权限：

```bash
chmod 700 ~/.multicoder
```

## API 文档

### ProfileManager

```typescript
class ProfileManager {
  initialize(): Promise<void>
  createProfile(name: string, providers: string[]): Promise<void>
  createProfileWithApiKey(name: string, provider: string, apiKey: string): Promise<void>
  switchProfile(name: string): Promise<SwitchResult>
  deleteProfile(name: string): Promise<void>
  listProfiles(): Promise<Profile[]>
  getCurrentProfile(): Promise<Profile | null>
}
```

### CredentialManager

```typescript
class CredentialManager {
  storeCredential(provider: string, credential: any): Promise<void>
  getCredential(provider: string): Promise<any>
  deleteCredential(provider: string): Promise<void>
  listCredentials(): Promise<string[]>
}
```

### AuthRegistry

```typescript
class AuthRegistry {
  register(provider: string, authenticator: BaseAuthenticator): void
  get(provider: string): BaseAuthenticator | undefined
  list(): string[]
}
```

## 贡献

欢迎贡献！请随时提交 issue 或 pull request。

## 许可证

ISC 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 支持

- Issues: [GitHub Issues](https://github.com/ljyou001/multicoder-auth/issues)
- 文档: [npm 包](https://www.npmjs.com/package/multicoder)

---

<div align="center">

**用 ❤️ 为 AI 开发社区打造**

</div>
