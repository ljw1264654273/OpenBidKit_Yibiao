# 新增章节推荐提纲 Implementation Plan

> **For agentic workers:** 使用 executing-plans 在当前会话依次实施，保留工作区已有改动。

**Goal:** 新增章节默认定向改写，自动生成可校核提纲并保留人工要求。

**Architecture:** 在既有历史适配正文任务增加 recommendationsOnly 模式。迁移项保存 recommended_instruction，manual_instruction 保持人工应用语义。Renderer 进入第五步自动请求缺失提纲，正文执行仍需应用人工要求。

**Tech Stack:** Electron CommonJS、React TypeScript、SQLite JSON、node:test。

### Task 1: 后台默认方式与提纲

- [x] 修改 `client/electron/services/historicalAdaptationContentTask.test.cjs`，覆盖新增叶子/父目录、仅生成提纲、重建保留、人工要求优先、失败重试与批量跳过。
- [x] 运行 `cd client; node --test electron/services/historicalAdaptationContentTask.test.cjs`，确认新行为测试失败。
- [x] 修改 `client/electron/services/historicalAdaptationContentTask.cjs`：新增项推荐 rewrite，持久字段 recommended_instruction；提纲 Prompt 与任务同文件，requestJson 返回 instruction；逐章 checkpoint；未人工应用时只生成提纲，recommendationsOnly 不生成正文。
- [x] 运行定向任务测试，确认通过。

### Task 2: 类型、持久化与页面

- [x] 在 `client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs` 覆盖推荐提纲的重建/恢复默认/重开保存。
- [x] 在 `client/electron/services/technicalPlanStore.cjs` 的恢复默认逻辑将新增节点保持 review，保留推荐提纲，清除人工要求。
- [x] 在 `client/src/features/technical-plan/types.ts` 增加可选 recommended_instruction；在 `client/src/shared/types/ipc.ts` 的 prepare payload 增加 recommendationsOnly。
- [x] 更新 `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx` 和 `components/AdaptationContentPage.tsx`：透传模式，进入页面自动准备缺失提纲，显示 manual_instruction 优先、推荐提纲回填，比较当前策略时使用同一默认值，新增章节未确认不被批量自动应用。
- [x] 校核提示放在现有输入框附近；切换章节/环节提示未保存人工要求，避免推荐到达覆盖输入。

### Task 3: 验证

- [x] 对改动 CJS 执行 node --check；运行对应任务、Store、taskService 与页面现有测试。
- [x] 执行 `cd client; npm run build` 和 `npm run smoke:electron-native`。
- [x] 使用现有 Vite 开发服务和隔离数据目录启动 Electron，检查窗口加载与真实数据库 IPC；使用现有 UI 检查脚本验证推荐提纲展示、切换保存、应用后生成正文。
- [x] 检查 git diff，只报告本次实现与验证，不提交用户已有改动。

### 验证记录

- 正文任务 58 项测试通过；Store、taskService、页面与正文检查的定向回归全部通过。
- TypeScript 与 Vite 构建通过，仅有既有 chunk 体积提示；Electron 原生 SQLite smoke 通过。
- UI 脚本通过：第四步新增子目录后，第五步自动填入推荐提纲；批量跳过未校核章节；人工应用后生成正文；切换章节保留要求；重新进入第五步不重复准备；恢复默认回填推荐。
- Electron 隔离开发窗口加载成功，真实数据库 IPC 返回 ready，prepare/save/reset 桥接接口存在。AI 请求使用模拟响应验证，未调用付费模型。
- `git diff --check` 通过，保留工作区已有改动，未提交。
