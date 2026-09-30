# Historical Bid Adaptation Differences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现历史标书适配环节三的后台差异分析、SQLite 持久化、逐项确认和等待验收状态。

**Architecture:** 新的受管任务读取项目 Store 中的历史标书 Markdown 与完整招标基线，调用现有 AI 服务生成结构化差异。项目级技术方案 Store 保存差异 JSON 和确认时间；Renderer 订阅任务事件并通过薄 IPC 保存人工决策。

**Tech Stack:** Electron CommonJS、better-sqlite3、React TypeScript、全局 CSS、Node test。

---

### Task 1: 差异领域模型与后台任务

**Files:**
- Create: `client/electron/services/historicalAdaptationDifferenceTask.cjs`
- Create: `client/electron/services/historicalAdaptationDifferenceTask.test.cjs`

- [x] 先写任务输入、结果归一化、排除字数差异的失败测试。
- [x] 运行测试并确认因模块/API 缺失失败。
- [x] 实现最小任务并确认测试通过。

### Task 2: SQLite 与 Store 持久化

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Create: `client/electron/services/technicalPlanStore.historicalAdaptationDifferences.test.cjs`
- Create: `client/electron/services/sqliteDatabase.historicalAdaptationMigration.test.cjs`

- [x] 先写根表、项目动态表和保存/加载决策的失败测试。
- [x] 增加 v39 migration、健康修复和 Store 字段映射。
- [x] 运行 Electron native 定向测试并确认通过。

### Task 3: 任务与 IPC 链路

**Files:**
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/electron/ipc/taskIpc.cjs`
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/technical-plan/types.ts`

- [x] 注册项目隔离的差异任务、事件快照和中断恢复。
- [x] 暴露启动分析及保存人工确认的薄 IPC。
- [x] 对所有修改的 CommonJS 文件执行 `node --check`。

### Task 4: 环节三页面

**Files:**
- Create: `client/src/features/historical-bid-adaptation/components/AdaptationDifferencePage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`
- Modify: `client/scripts/historical_adaptation_ui_check.py`

- [x] 先写阶段解锁、差异台账和确认完成条件的失败测试。
- [x] 实现筛选、编辑、确认、无需处理和任务进度状态。
- [x] 验证环节四继续锁定，全部处理后环节三进入等待验收。

### Task 5: 聚焦验证

- [x] 运行新增和受影响的 Node 测试。
- [x] 运行 `npm run smoke:electron-native`。
- [x] 运行 `npm run build`。
- [x] 启动应用并执行桌面与 760px 窄屏 UI 回归。
- [x] 检查 Git diff，排除 `client/package-lock.json`、`client/package.json` 等无关改动。
