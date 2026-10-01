# 历史标书适配审核导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成历史标书适配的第六环节：规则终审、问题处置、人工验收和受门禁保护的 Word 导出。

**Architecture:** Main 侧以纯规则对权威 SQLite 项目状态执行同步终审并持久化可定位问题；Store 在正文/差异/目录变化时失效终审，在验收和导出授权处实施 P0 门禁。Renderer 提供问题审阅台，导出复用现有 `WordExportDialog` 与 export IPC。

**Tech Stack:** Electron Main CommonJS、better-sqlite3、IPC/preload bridge、React/TypeScript、现有 CSS design tokens、node:test、Playwright。

---

### Task 1: 终审纯规则与测试

**Files:**
- Create: `client/electron/services/historicalAdaptationReviewRules.cjs`
- Create: `client/electron/services/historicalAdaptationReviewRules.test.cjs`

- [ ] 先覆盖规则 ID、严重级别、定位证据、P0/P1/P2 命中和问题指纹稳定性。
- [ ] 运行 `node --test electron/services/historicalAdaptationReviewRules.test.cjs` 确认因模块缺失失败。
- [ ] 实现纯规则及重新审核时处置状态继承逻辑。
- [ ] 重跑测试并保持规则无文件/IPC 依赖。

### Task 2: SQLite、Store 与门禁

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Create: `client/electron/services/sqliteDatabase.historicalAdaptationReviewMigration.test.cjs`
- Create: `client/electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`

- [ ] 测试 v42 migration 为根 schema 和项目 schema 增加审核列。
- [ ] 测试运行审核、更新问题处置、终审确认和读取状态。
- [ ] 测试 P0 阻止确认与导出授权，清零后允许确认。
- [ ] 测试正文、差异、目录变动清理结果与确认时间。
- [ ] 实现最小 Store/schema 行为并运行两个 Electron native 测试。

### Task 3: IPC 与类型

**Files:**
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`

- [ ] 增加运行终审、保存问题处置、确认终审和导出门禁通道。
- [ ] 为新通道添加 workspace database pending 注册测试。
- [ ] 将终审 findings、时间和方法纳入 `TechnicalPlanState` 与 bridge 类型。
- [ ] 运行 IPC 与类型构建测试。

### Task 4: 审核导出页面和阶段解锁

**Files:**
- Create: `client/src/features/historical-bid-adaptation/components/AdaptationReviewExportPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

- [ ] 先补页面契约测试：仅正文环节确认后开放、P0 阻断、人工确认后可导出、复用 `WordExportDialog`。
- [ ] 页面支持运行/重跑终审、分级筛选、定位章节、处置问题及验收。
- [ ] 将当前只开放到环节五的导航和阶段内容切换扩展至环节六。
- [ ] 导出前再请求 Main 门禁，导出当前技术方案目录。
- [ ] 适配现有风格并处理窄屏排版，不新造独立导出逻辑。

### Task 5: 全量验证

**Files:**
- None

- [ ] 执行历史适配与审核规则/Store/migration/IPC 定向测试。
- [ ] 执行 `npm run build`、`npm run smoke:electron-native` 和改动 `.cjs` 的 `node --check`。
- [ ] 执行 Playwright 桌面、窄屏、P0 阻断、问题处置、验收及导出链路回归。
- [ ] 执行 `git diff --check -- . ':(exclude)client/package.json' ':(exclude)client/package-lock.json'`。
