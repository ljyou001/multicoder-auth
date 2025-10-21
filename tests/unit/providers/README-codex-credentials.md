# Codex Credentials Management Tests

这个测试套件验证OpenAI Codex的完整credentials管理系统，包括API密钥注入、环境变量管理和profile集成。

## 测试覆盖范围

### 🔧 环境变量管理
- ✅ 清理现有的codex环境变量
- ✅ 正确设置OpenAI环境变量 (`OPENAI_API_KEY`, `OPENAI_BASE_URL`)
- ✅ 正确设置Azure OpenAI环境变量 (`AZURE_OPENAI_API_KEY`, `OPENAI_BASE_URL`)
- ✅ Azure基础URL生成验证
- ✅ OpenAI和Azure模式之间的切换

### 📁 Native Credential检测
- ✅ 从 `~/.codex/auth.json` 检测有效的native credentials
- ✅ 检测过期的native credentials
- ✅ 处理缺失的native credentials
- ✅ 处理格式错误的credential文件
- ✅ 支持多种credential文件格式 (`auth.json`, `credentials.json`, `credentials`)

### 👤 Profile集成
- ✅ 使用OpenAI API密钥创建profile
- ✅ 使用Azure OpenAI API密钥创建profile
- ✅ 在OpenAI和Azure配置之间切换
- ✅ Profile状态持久化

### 📂 Credential文件验证
- ✅ 验证 `~/.codex` 目录结构
- ✅ 验证credential文件内容和格式
- ✅ 支持多种credential文件格式

### 🔄 环境变量持久化
- ✅ 跨进程重启的环境变量持久化
- ✅ 删除credentials时的环境变量清理

## 运行测试

### 单独运行Codex credentials测试
```bash
npm run test:codex-credentials
```

### 运行所有测试
```bash
npm test
```

### 构建并运行
```bash
npm run build
node --test tests/unit/providers/codexCredentials.test.js
```

## 测试环境

测试使用临时目录模拟：
- `~/.codex/` 目录和credential文件
- 环境变量的设置和清理
- Profile存储和管理

每个测试都会：
1. 创建独立的临时测试环境
2. 备份和恢复原始环境变量
3. 清理测试产生的文件和状态

## 验证的功能

### API密钥注入逻辑
- OpenAI模式：`OPENAI_API_KEY` + 可选 `OPENAI_BASE_URL`
- Azure模式：`OPENAI_API_KEY` (使用Azure密钥) + `AZURE_OPENAI_API_KEY` + `OPENAI_BASE_URL` (Azure端点)

### 环境变量清理
- 每次新的Codex登录都会先清理 `CODEX_ENV_VARS`
- 支持从OpenAI切换到Azure（或反之）

### Native Credential支持
- 检测 `~/.codex/auth.json`, `~/.codex/credentials.json`, `~/.codex/credentials`
- 验证token格式和过期时间
- 与managed credentials的集成

## 故障排除

如果测试失败，检查：
1. 是否有权限创建临时文件和目录
2. Node.js版本是否支持 `node:test` 模块
3. 是否正确构建了TypeScript代码 (`npm run build`)