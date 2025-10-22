# Auth Profile Frontend

独立于主工程的 Tauri 前端，用于在 `auth` 模块中调试 Profile Manager 相关界面。代码与根目录 `frontend` 的实现保持同源，只是精简了外部依赖，方便在认证组件中单独构建。

## 快速开始

```bash
npm install
npm run tauri dev
```

- `npm run dev` 仅启动 Vite 前端，适合调试界面。
- `npm run tauri dev` 会同时启动 Tauri 后端，提供与主应用一致的命令调用能力（`src/services/profileService.ts` 通过 `@tauri-apps/api` 的 `invoke` 接口访问 Rust 后端）。

如需修改 Tauri 配置，可在 `src-tauri/tauri.conf.json`、`src-tauri/src/` 中进行调整，结构与主项目前端一致。

## 目录说明

- `src/components/profile/ProfileManager.tsx`：完整的 Profile 管理界面。
- `src/services/profileService.ts`：直接复用主前端的服务封装，通过 Tauri bridge 调用真实后端。
- `src/stores/profileStore.ts`：zustand 状态管理，保持与主前端一致的持久化键。
- `src-tauri`：Rust 端配置与命令，允许本项目独立运行 Tauri。

其他配置文件（`vite.config.ts`、`tailwind.config.js`、`tsconfig.json` 等）同样参考主前端，可按需扩展。
