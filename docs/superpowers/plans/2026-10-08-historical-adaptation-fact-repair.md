# 历史标书适配全文事实诊断与修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在历史标书适配的一致性检查页提供可追溯的全文事实查看、项目级人工修正、章节定位和重跑检查闭环。

**Architecture:** Main 侧为检查批次增加运行清单和正文/输入/协议指纹，聚合单次完整运行的事实结果；项目级人工事实修正保存在技术方案元数据中，并参与下一次检查输入哈希。通过薄 IPC 暴露事实查询与 compare-and-write 保存，Renderer 使用 AppDialog 展示事实、证据和修复动作，正文仍通过现有章节编辑器修改。

**Tech Stack:** Electron CommonJS、better-sqlite3、React/TypeScript、Radix Dialog、现有 AppDialog/Toast/MarkdownRenderer、Node test、Vite build。

---

### Task 1: 扩展检查运行清单与人工事实修正存储

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Test: `client/electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs`
- Test: `client/electron/services/technicalPlanStore.historicalAdaptationContentCheckBatches.test.cjs`

- [ ] **Step 1: 写迁移与 Store 失败测试**：覆盖 `content_hash`、运行清单的批次数量/节点覆盖、人工修正 JSON 列，以及正文指纹或 override 变化后不可复用旧批次。
- [ ] **Step 2: 运行定向测试确认失败**：`cd client; node --test electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs electron/services/technicalPlanStore.historicalAdaptationContentCheckBatches.test.cjs`。
- [ ] **Step 3: 增加 SQLite migration 和 schema 目标结构**：创建运行清单表、批次 `content_hash` 字段、技术方案元数据 override 字段和必要索引。
- [ ] **Step 4: 实现 Store 规范化与 compare-and-write**：统一 `contentHash/inputHash/protocolHash/factsHash` 计算，读取/写入运行清单，严格选择最新完整运行，保存 override 时在事务内比对 expected 指纹。
- [ ] **Step 5: 实现事实聚合**：按单次完整 run 的 batch_index 合并 `result_json.facts`，去重 `fact_id/fact_key`，合并章节 ID、证据和值集合，返回 stale/unavailable 原因。
- [ ] **Step 6: 运行定向测试并提交**：测试通过后提交 `feat: persist historical adaptation fact repair state`。

### Task 2: 将人工修正纳入一致性检查任务输入

**Files:**
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.test.cjs`
- Test: `client/electron/services/technicalPlanStore.historicalAdaptationContentCheckBatches.test.cjs`

- [ ] **Step 1: 写失败测试**：验证 override 进入 input snapshot/protocol hash，提取事实与 override 合并后再计算 facts hash，并参与语义冲突裁决/自动修复输入。
- [ ] **Step 2: 运行测试确认失败**：`cd client; node --test electron/services/historicalAdaptationContentCheckTask.test.cjs electron/services/technicalPlanStore.historicalAdaptationContentCheckBatches.test.cjs`。
- [ ] **Step 3: 修改检查上下文和 hash 链路**：读取项目 override，构造稳定 canonical JSON，统一 `protocolHash` 命名和计算顺序。
- [ ] **Step 4: 在创建/更新/复用批次时贯穿 contentHash 与 run manifest**：确保正文变化、部分失败和旧协议都不会复用事实。
- [ ] **Step 5: 运行测试并提交**：提交 `feat: include manual fact overrides in consistency checks`。

### Task 3: 暴露事实查询与保存 IPC

**Files:**
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Test: `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`
- Test: `client/electron/ipc/technicalPlanCheckLifecycle.test.cjs`

- [ ] **Step 1: 写失败测试**：验证两个通道注册、payload 指纹不匹配返回 `conflict/stale` 联合结果、成功返回事实条目和新指纹。
- [ ] **Step 2: 运行 IPC 定向测试确认失败**：`cd client; node --test electron/ipc/index.workspaceDatabaseChannels.test.cjs electron/ipc/technicalPlanCheckLifecycle.test.cjs`。
- [ ] **Step 3: 实现 Main IPC 薄转发**：调用 Store 查询/保存方法，不在 IPC 层复制业务逻辑。
- [ ] **Step 4: 同步 preload bridge 与 TypeScript discriminated union**：增加 `getHistoricalAdaptationContentFacts` 和 `saveHistoricalAdaptationContentFactOverrides`。
- [ ] **Step 5: 执行 `.cjs` 语法检查、定向测试并提交**：提交 `feat: expose historical adaptation fact repair ipc`。

### Task 4: 构建事实诊断与修复弹窗

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`（若实际样式文件不同，沿现有 feature 样式入口修改）
- Test: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

- [ ] **Step 1: 写页面交互失败测试/静态断言**：按钮文案、弹窗、定位章节、修正保存和重跑动作均存在。
- [ ] **Step 2: 实现事实类型与弹窗状态**：打开时读取事实，展示状态/来源运行/空态/错误态，并用 `MarkdownRenderer allowRawHtml={false}` 显示证据。
- [ ] **Step 3: 实现按事实分组和修正编辑**：支持新增/修改/删除 override，保存前保留 expected 指纹，冲突时提示重新读取。
- [ ] **Step 4: 接入章节定位和重跑**：点击来源章节关闭弹窗并调用现有 `requestNavigation`；保存成功后启动现有一致性检查任务。
- [ ] **Step 5: 补齐样式、可访问性和 toast**：按钮禁用态、滚动区域、键盘 Dialog 行为、成功/失败提示符合现有风格。
- [ ] **Step 6: 运行页面定向测试并提交**：提交 `feat: add actionable fact diagnostics to consistency checks`。

### Task 5: 集成验证与回归

**Files:**
- Modify: only if fixes are required by verification
- Test: affected `*.test.cjs` and `*.test.ts`

- [ ] **Step 1: 运行 Main/preload 语法检查**：对所有改动 `.cjs` 执行 `node --check`。
- [ ] **Step 2: 运行定向 Node 测试**：事实聚合、迁移、检查任务、IPC 测试全部通过。
- [ ] **Step 3: 运行客户端构建**：`cd client; npm run build`，仅允许既有 chunk 体积警告。
- [ ] **Step 4: 手动验证关键链路**：成功事实、提取失败、跨章节冲突、事实修正后重跑、正文修改后重跑、过期保存拒绝。
- [ ] **Step 5: 汇总变更与验证证据**：确认 git diff 只包含本需求范围，并说明尚未覆盖的 Electron 手动场景（如有）。

