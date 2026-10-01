# Historical Bid Adaptation Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现历史标书适配环节四的目录提取、差异驱动适配、人工编辑、SQLite 持久化和等待验收状态。

**Architecture:** 新的 Main 受管任务从历史标书提取原目录，再结合完整招标基线和已确认差异生成适配目录及变更记录。适配目录复用 `outlineData` 权威存储，原目录快照、变更台账和确认时间保存在项目级 meta；Renderer 只负责展示、编辑编排和任务事件合并。

**Tech Stack:** Electron CommonJS、better-sqlite3、React TypeScript、全局 CSS、Node test、Playwright。

---

### Task 1: 目录适配领域任务

**Files:**
- Create: `client/electron/services/historicalAdaptationOutlineTask.cjs`
- Create: `client/electron/services/historicalAdaptationOutlineTask.test.cjs`

- [ ] 写失败测试：完整输入、长文档分片、原目录归一化、差异过滤和结构化输出。
- [ ] 运行测试，确认因模块缺失失败。
- [ ] 实现历史目录提取、适配 Prompt、结果归一化和任务 checkpoint。
- [ ] 运行测试，确认通过。

### Task 2: SQLite 与 Store 协议

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Create: `client/electron/services/sqliteDatabase.historicalAdaptationOutlineMigration.test.cjs`
- Create: `client/electron/services/technicalPlanStore.historicalAdaptationOutline.test.cjs`

- [ ] 写失败测试：v40 根表/动态项目表迁移、生成结果保存、编辑失效、确认时间、运行态编辑/确认拒绝。
- [ ] 增加 v40 migration、schema health、meta 映射和 Store 方法。
- [ ] 让专用目录保存复用 `saveOutline()` 的 reason/idMap 语义，并同步变更记录目标 ID。
- [ ] 让生成开始仅清除确认时间，成功时原子替换目录结果，失败时保留最近成功目录。
- [ ] 分别覆盖招标基线重跑、差异重跑和差异人工修改三条上游入口，原子清空目录及后续正文状态。
- [ ] 运行 Electron native 定向测试，确认通过。

### Task 3: 受管任务与 IPC

**Files:**
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs`
- Modify: `client/electron/ipc/taskIpc.cjs`
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/technical-plan/types.ts`

- [ ] 写失败测试：项目类型限制、项目作用域、事件 patch、中断恢复、完整基线/已确认差异/历史原文启动门禁。
- [ ] 注册 `historical-adaptation-outline` 任务及恢复逻辑。
- [ ] 暴露启动、保存目录编辑和确认目录的薄 IPC。
- [ ] 将环节三、环节四新增通道加入 `workspaceDatabaseChannels` 并补生命周期测试。
- [ ] 对修改的 CommonJS 文件执行 `node --check`。

### Task 4: 环节四目录工作台

**Files:**
- Create: `client/src/features/historical-bid-adaptation/components/AdaptationOutlinePage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`
- Modify: `client/src/features/technical-plan/hooks/useTechnicalPlanWorkflow.ts`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`

- [ ] 写失败测试：环节四解锁、环节五锁定、三栏工作台、编辑/增删/排序和确认状态。
- [ ] 实现原目录只读树、适配目录操作和变更详情编辑器。
- [ ] 运行页面静态测试和 TypeScript 构建，确认通过。

### Task 5: UI 回归与完整验证

**Files:**
- Modify: `client/scripts/historical_adaptation_ui_check.py`

- [ ] 扩展 mock 状态和 IPC，覆盖目录生成、选择、编辑、增加、删除、排序和确认。
- [ ] 验证桌面与 760px 窄屏布局，确认环节五始终锁定。
- [ ] 运行所有新增与受影响测试。
- [ ] 运行 `npm run smoke:electron-native`。
- [ ] 运行 `npm run build`。
- [ ] 执行限定文件的 `git diff --check`，排除用户已有 `client/package.json` 与 `client/package-lock.json` 状态。
