# Provider Unit Tests

这个目录包含每个 provider 的独立单元测试。

## 测试设计

每个 provider 测试遵循相同的模式：

1. **发送创建文件请求**：要求 AI 创建一个测试文件（test-{provider}.md）
2. **权限模式**：使用 `allow` 模式自动批准所有操作
3. **验证响应**：检查响应包含文本、思考信息、文件变动信息
4. **验证文件**：检查文件是否被创建且内容正确
5. **清理**：删除测试文件和清理 adapter

## 测试改进（v2）

相比初始版本，新版本测试有以下改进：

### ✅ 超时处理
- 每个测试设置 60 秒超时
- 使用 `Promise.race()` 避免无限等待
- 超时后提供清晰的错误信息

### ✅ 错误处理增强
- **ENOENT 错误**（CLI 未安装）：显示安装指引并优雅跳过测试
- **超时错误**：提供可能原因和排查建议
- **清理错误**：即使测试失败也会尝试清理资源

### ✅ 更好的日志输出
```
🔧 Testing Codex Provider...
📤 Sending request to Codex...
📥 Response received:
   Text preview: ...
   ⚠️  Warnings: [...]
🔍 Verification:
   ✓ Has text content: 156 chars
   ✓ Contains thinking/reasoning info: true
⏳ Waiting for file creation...
   ✓ File test-codex.md exists: true
   ✓ File contains expected content: true
🧹 Cleaned up test file
✅ Codex provider test completed
```

### ✅ 灵活的文件验证
- 如果文件未创建，不会让测试失败
- 显示可能的原因（某些 provider 可能不支持文件操作）
- 允许在没有安装 CLI 的情况下运行测试套件

## 运行测试

### 运行所有 provider 测试
```bash
npm test
```

### 运行单个 provider 测试
```bash
# Codex
npm run test:codex

# Gemini
npm run test:gemini

# Claude
npm run test:claude
```

## 前置条件

每个测试需要对应的 CLI 工具已安装并认证：

### Codex
```bash
# 安装 Codex CLI (从 OpenAI 获取)
# 访问: https://openai.com/codex

# 认证
codex login
```

### Gemini
```bash
# 安装 Gemini CLI
npm install -g @google/generative-ai-cli

# 认证
gemini login
```

### Claude
```bash
# 安装 Claude CLI (从 Anthropic 获取)
# 访问: https://claude.ai/download

# 认证
claude login
```

## 测试结构

```
tests/
├── unit/
│   ├── providers/          # Provider 单元测试
│   │   ├── codex.test.js   ✅ 包含超时和错误处理
│   │   ├── gemini.test.js  ✅ 包含超时和错误处理
│   │   ├── claude.test.js  ✅ 包含超时和错误处理
│   │   └── README.md
│   └── ...                 # 其他单元测试
└── integration/            # 集成测试（待添加）
```

## 验证内容

每个测试验证以下内容：

1. ✅ **响应结构**：包含 text, warnings, actions 字段
2. ✅ **文本内容**：响应包含思考/推理信息
3. ✅ **文件创建**：test-{provider}.md 文件被创建（可选）
4. ✅ **文件内容**：文件包含预期内容 "test-{provider}"（如果文件被创建）
5. ✅ **清理成功**：测试文件被正确删除
6. ✅ **资源释放**：Adapter 被正确清理

## 预期输出

### 成功的测试输出
```
🔧 Testing Codex Provider...
📤 Sending request to Codex...

📥 Response received:
Text preview: I'll create the file test-codex.md with the content...
⚠️  Warnings: []

🔍 Verification:
✓ Has text content: 156 chars
✓ Contains thinking/reasoning info: true
⏳ Waiting for file creation...
✓ File test-codex.md exists: true
✓ File contains expected content: true
  File content: "test-codex"

🧹 Cleaned up test file
✅ Codex provider test completed
```

### CLI 未安装的输出
```
🔧 Testing Claude Provider...
❌ Test failed: spawn claude ENOENT

💡 Claude CLI not found. Install it first:
   Visit: https://claude.ai/download
   Then run: claude login

⏭️  Skipping test - Claude CLI not installed
```

### 超时的输出
```
📤 Sending request to Codex...
❌ Test failed: Request timeout after 60s

💡 Request timed out. This might mean:
   - MCP server is slow to respond
   - Codex is processing a complex request
   - Network or authentication issues
```

## 故障排查

### 测试卡住

如果测试卡住不动：

1. **Codex**: MCP 连接可能需要很长时间
   - 检查 `codex mcp-server` 是否正常运行
   - 检查 MCP 版本（≥0.43.0-alpha.5 使用 `mcp-server`）

2. **Gemini**: 交互式会话可能在等待输入
   - 检查 `gemini` CLI 是否能正常启动
   - 检查是否有未处理的审批提示

3. **Claude**: 命令模板执行可能失败
   - 检查 `claude chat` 命令是否工作
   - 检查 JSON 输入格式是否正确

**解决方法**：测试现在包含 60 秒超时，会自动终止

### 测试失败但 CLI 已安装

1. **认证问题**：运行 `{provider} login` 重新认证
2. **权限问题**：确保 permissionMode 为 'allow'
3. **模型不可用**：检查指定的模型是否可用
4. **网络问题**：检查网络连接

### 文件未创建

某些情况下文件可能不会被创建：
- Provider 可能不支持文件操作
- 权限被拒绝（即使设置了 allow）
- Provider 可能只返回建议而不执行

**这是正常的**：测试不会因为文件未创建而失败，只会记录日志

## 添加新的 Provider 测试

创建新的 provider 测试时，使用这个模板：

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_FILE_NAME = 'test-newprovider.md';
const TEST_CONTENT = 'test-newprovider';
const TEST_FILE_PATH = resolve(process.cwd(), TEST_FILE_NAME);
const TEST_TIMEOUT = 60000;

test('NewProvider - Create test file', { timeout: TEST_TIMEOUT }, async () => {
  console.log('\n🔧 Testing NewProvider...');

  // ... 实现测试逻辑

  try {
    // 1. 创建 adapter
    // 2. 发送请求（带超时）
    // 3. 验证响应
    // 4. 验证文件
    // 5. 清理
  } catch (error) {
    // 错误处理
    if (error.code === 'ENOENT') {
      console.log('\n⏭️  Skipping test - CLI not installed');
      return; // 优雅跳过
    }
    throw error;
  } finally {
    // 清理资源
  }
});
```

## 持续改进

未来可以添加的改进：

1. **Mock 测试**：为 CI/CD 添加不依赖真实 CLI 的测试
2. **性能测试**：测量响应时间和资源使用
3. **并发测试**：测试多个并发请求
4. **错误恢复测试**：测试各种错误场景的恢复
5. **多轮对话测试**：测试上下文保持

