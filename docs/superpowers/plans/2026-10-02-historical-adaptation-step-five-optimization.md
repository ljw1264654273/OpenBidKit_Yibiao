# Historical Adaptation Step Five Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复历史标书适配环节五的迁移误判与旧值残留，保持一键推荐迁移，并完成真实红绿对比、人工正文保护、版本化缓存、增量持久化和统一门禁。

**Architecture:** 把现有 `historicalAdaptationContentTask.cjs` 中的规则生成、历史来源定位、逐章方案和迁移执行拆成独立纯模块；SQLite v44 将逐章迁移项和不可变源版本规范化存储，正文仍以 `technical_plan_outline_nodes.content` 为唯一权威。Main 统一负责任务编排、失效和 readiness，Renderer 只消费权威快照与增量 patch。

**Tech Stack:** Electron Main CommonJS、better-sqlite3、React + TypeScript、Node test runner、Vite、现有 `textEdit.cjs` 与 Markdown 组件。

**Design Spec:** `docs/superpowers/specs/2026-10-02-historical-adaptation-step-five-optimization-design.md`

---

## File Map

- Create `client/electron/services/historicalAdaptationRuleEngine.cjs`: 差异到结构化规则、证据与异常分布统计。
- Create `client/electron/services/historicalAdaptationRuleEngine.test.cjs`: 五峰村真值、通用短语拒绝、服务内容分支。
- Create `client/electron/services/historicalSourceIndex.cjs`: 不可变源版本、路径感知 Markdown 索引、occurrence/range 定位。
- Create `client/electron/services/historicalSourceIndex.test.cjs`: 同名标题、重复旧值、哈希与范围测试。
- Create `client/electron/services/historicalAdaptationLocalEdit.cjs`: 确定性 replace/remove、授权片段 AI 编辑校验、原子范围应用。
- Create `client/electron/services/historicalAdaptationLocalEdit.test.cjs`: 多 occurrence、整章编辑、小范围无关润色和保护事实测试。
- Modify `client/electron/services/historicalAdaptationContentTask.cjs`: 只保留计划编排、Prompt 和 Runner；调用新模块。
- Modify `client/electron/services/historicalAdaptationContentTask.test.cjs`: 一键目标、人工策略、重试与 patch 回归。
- Modify `client/electron/services/sqliteDatabase.cjs`: schema v44、新表、事务迁移和健康检查。
- Modify `sql/workspace_schema.sql`: 同步 v44 目标结构。
- Modify `client/electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs`: 旧 JSON 导入、权威切换、回滚/幂等。
- Modify `client/electron/services/technicalPlanStore.cjs`: 新表 CRUD、局部失效、checkpoint、readiness 和来源读取。
- Modify `client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`: Store 协议回归。
- Modify `client/electron/services/taskService.cjs`: 一键建方案后启动、旧任务取消、重试未完成章节。
- Modify `client/electron/services/taskService.historicalAdaptation.test.cjs`: 任务目标与恢复测试。
- Modify `client/electron/services/historicalAdaptationContentCheckTask.cjs`: 确定性预检优先、规则版本/哈希检查。
- Modify `client/electron/services/historicalAdaptationContentCheckTask.test.cjs`: 阻断时不调用 AI、五峰村残留测试。
- Modify `client/electron/services/historicalAdaptationReviewRules.cjs`: 终审复用 readiness，must-replace 不可豁免。
- Modify `client/electron/services/historicalAdaptationReviewRules.test.cjs`: 快照和处置规则测试。
- Modify `client/electron/ipc/taskIpc.cjs`, `client/electron/ipc/technicalPlanIpc.cjs`, `client/electron/ipc/index.cjs`, `client/electron/preload.cjs`, `client/src/shared/types/ipc.ts`: 新命令和增量事件协议。
- Modify `client/src/features/technical-plan/types.ts`: 版本化方案、规则证据、错误码和 patch 类型。
- Modify `client/src/features/historical-bid-adaptation/contentComparison.ts`: Markdown 保护块感知的对比范围。
- Modify `client/src/features/historical-bid-adaptation/contentComparison.test.ts`: Markdown、表格、图片、代码块与 Mermaid 测试。
- Modify `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`: 一键状态、重试、来源按需读取、红绿对比、去除重复入口。
- Modify `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`: 页面行为回归。
- Modify `client/src/styles/feature-historical-bid-adaptation.css`: 紧凑状态与对比样式。
- Modify `client/scripts/historical_adaptation_ui_check.py`: 真实第五步交互和视觉回归。

---

### Task 1: 结构化规则引擎

**Files:**
- Create: `client/electron/services/historicalAdaptationRuleEngine.cjs`
- Create: `client/electron/services/historicalAdaptationRuleEngine.test.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`

- [ ] **Step 1: 写失败测试**

固定夹具包含：11 个正文含“五峰村”的节点、只含“开展农村/展农村/村辖区”的无关节点、工作量和工期节点。断言规则只产生完整 `replacements`/`authorizedRanges`，无关节点为 `direct`，同一精确 `must-replace` 可命中多个节点。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationRuleEngine.test.cjs`
Expected: FAIL，模块不存在或当前宽泛后缀仍误命中。

- [ ] **Step 3: 实现最小规则引擎**

导出 `buildHistoricalAdaptationRules()`、`matchRulesToSection()`、`summarizeRuleDistribution()`；删除 `residualTermsFromDifference()` 的后缀枚举。只从完整历史值、结构化目标值和锁定服务内容证据生成规则。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd client; node --test electron/services/historicalAdaptationRuleEngine.test.cjs electron/services/historicalAdaptationContentTask.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/historicalAdaptationRuleEngine.cjs client/electron/services/historicalAdaptationRuleEngine.test.cjs client/electron/services/historicalAdaptationContentTask.cjs
git commit -m "fix: replace fuzzy historical migration matching"
```

### Task 2: 路径感知历史来源索引

**Files:**
- Create: `client/electron/services/historicalSourceIndex.cjs`
- Create: `client/electron/services/historicalSourceIndex.test.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`

- [ ] **Step 1: 写失败测试**

覆盖完整目录路径、标题层级、同名标题 occurrence、章节 offset/hash、同章多次“五峰村”range，以及歧义来源返回 review。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalSourceIndex.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现索引与内容寻址源版本**

导出 `buildHistoricalSourceIndex()`、`locateHistoricalSection()`、`findAllValueRanges()`；把 `findHistoricalSection()` 的逐章全文扫描替换为一次索引查询。源版本文件由 Store 在 Task 4 接入，当前模块只处理文本和哈希。

- [ ] **Step 4: 运行定向测试**

Run: `cd client; node --test electron/services/historicalSourceIndex.test.cjs electron/services/historicalAdaptationContentTask.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/historicalSourceIndex.cjs client/electron/services/historicalSourceIndex.test.cjs client/electron/services/historicalAdaptationContentTask.cjs
git commit -m "perf: index historical source sections once"
```

### Task 3: 原子局部编辑执行器

**Files:**
- Create: `client/electron/services/historicalAdaptationLocalEdit.cjs`
- Create: `client/electron/services/historicalAdaptationLocalEdit.test.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`

- [ ] **Step 1: 写失败测试**

覆盖确定性 `replace`、同章多个 occurrence 全部替换、锁定范围 `remove`、范围外逐字不变、整章 edit 拒绝、20%/35% 上限、小范围无关润色拒绝、未授权金额/人员/日期变化拒绝和任一失败原子回滚。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationLocalEdit.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现执行器**

使用 `applyRangeEdits()`；`replace`/`remove` 不调用 AI；`rewrite-fragment` 只允许模型处理授权片段，返回后验证保护事实和范围外字节一致。返回结构化错误码。

- [ ] **Step 4: 运行迁移相关测试**

Run: `cd client; node --test electron/services/historicalAdaptationLocalEdit.test.cjs electron/services/historicalAdaptationContentTask.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/historicalAdaptationLocalEdit.cjs client/electron/services/historicalAdaptationLocalEdit.test.cjs client/electron/services/historicalAdaptationContentTask.cjs
git commit -m "fix: apply historical local edits atomically"
```

### Task 4: SQLite v44 逐章方案与源版本

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs`

- [ ] **Step 1: 写 v44 失败测试**

断言创建 `technical_plan_historical_source_versions`、`technical_plan_historical_content_items` 和必要索引；旧 JSON 在同一 migration 事务导入，`content_items_storage_version=1` 后新表权威；重复启动不重复导入。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs`
Expected: FAIL，schema 仍为 43。

- [ ] **Step 3: 实现 v44 migration 和 schema health**

提升 `schemaVersion` 到 44，创建表、导入旧 JSON、写完成标记，确保 migration 事务失败整体回滚；同步 `sql/workspace_schema.sql`。

- [ ] **Step 4: 验证 migration**

Run: `cd client; node --test electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs; npm run smoke:electron-native`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/sqliteDatabase.cjs client/electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs sql/workspace_schema.sql
git commit -m "feat: normalize historical migration plans"
```

### Task 5: Store 增量协议与失效矩阵

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`

- [ ] **Step 1: 写 Store 失败测试**

覆盖逐章 CRUD、不可变源版本去重、人工 direct/local/rewrite 失效矩阵、人工正文永不自动覆盖、单章 checkpoint 不改其他行、检查/终审局部失效和来源按需读取。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现新表 Store API**

把内容项读写切换到 v44 表；保留 `loadTechnicalPlan()` 返回兼容数组，但内部写入只更新目标行。增加 `getHistoricalAdaptationSourceSection()`、`checkpointHistoricalAdaptationContentItem()` 和版本化 hash。

- [ ] **Step 4: 运行 Store 与 migration 测试**

Run: `cd client; node --test electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs
git commit -m "refactor: persist historical plans by chapter"
```

### Task 6: 一键计划、执行与重试编排

**Files:**
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.test.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs`

- [ ] **Step 1: 写任务失败测试**

断言“建立/更新”先生成计划再自动启动；排除人工正文和 stale 人工 rewrite；计划中断后 direct 与可重试 local-rewrite 可按 `plan_id + node_id + plan_inputs_hash` 幂等重试；成功章不重复执行。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationContentTask.test.cjs electron/services/taskService.historicalAdaptation.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现任务协议**

让 `prepareHistoricalAdaptationContentPlan()` 返回计划摘要并由 TaskService 原子衔接迁移任务；增加 `retryHistoricalAdaptationContent()`；checkpoint 仅发送目标 item/content patch 和计数。

- [ ] **Step 4: 运行任务测试与语法检查**

Run: `cd client; node --check electron/services/historicalAdaptationContentTask.cjs; node --check electron/services/taskService.cjs; node --test electron/services/historicalAdaptationContentTask.test.cjs electron/services/taskService.historicalAdaptation.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/historicalAdaptationContentTask.cjs client/electron/services/historicalAdaptationContentTask.test.cjs client/electron/services/taskService.cjs client/electron/services/taskService.historicalAdaptation.test.cjs
git commit -m "feat: run recommended migration in one action"
```

### Task 7: IPC、类型与增量事件

**Files:**
- Modify: `client/electron/ipc/taskIpc.cjs`
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/technical-plan/types.ts`

- [ ] **Step 1: 写 IPC 生命周期失败测试**

增加一键准备并执行、重试未完成、按需来源读取和 patch 事件通道断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/ipc/index.workspaceDatabaseChannels.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 接入 bridge 和类型**

IPC 只注册/转发，业务留在 TaskService/Store；事件 patch 使用字段存在语义，preload 事件返回取消订阅函数。

- [ ] **Step 4: 运行 IPC 测试和 CJS 检查**

Run: `cd client; node --check electron/preload.cjs; node --check electron/ipc/taskIpc.cjs; node --check electron/ipc/technicalPlanIpc.cjs; node --test electron/ipc/index.workspaceDatabaseChannels.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/ipc client/electron/preload.cjs client/src/shared/types/ipc.ts client/src/features/technical-plan/types.ts
git commit -m "feat: expose incremental historical migration APIs"
```

### Task 8: 确定性预检与统一 readiness

**Files:**
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.cjs`
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.test.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`
- Modify: `client/electron/services/historicalAdaptationReviewRules.cjs`
- Modify: `client/electron/services/historicalAdaptationReviewRules.test.cjs`

- [ ] **Step 1: 写检查失败测试**

断言五峰村等 must-replace 残留、空正文、占位符、stale/error/review 在 AI 前阻断；存在确定性 blocker 时 AI 调用次数为 0；环节五、终审和导出共用相同 readiness/hash；must-replace 不可备注豁免。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationContentCheckTask.test.cjs electron/services/historicalAdaptationReviewRules.test.cjs electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现预检、缓存与门禁**

确定性 findings 先生成；无 blocker 才按 `checked_content_hash + checked_inputs_hash + rule_engine_version` 复用/运行语义检查。终审处置只允许建议性/contextual finding 豁免。

- [ ] **Step 4: 运行检查与 Store 测试**

Run: `cd client; node --test electron/services/historicalAdaptationContentCheckTask.test.cjs electron/services/historicalAdaptationReviewRules.test.cjs electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/historicalAdaptationContentCheckTask.cjs client/electron/services/historicalAdaptationContentCheckTask.test.cjs client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs client/electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs client/electron/services/historicalAdaptationReviewRules.cjs client/electron/services/historicalAdaptationReviewRules.test.cjs
git commit -m "fix: centralize historical adaptation readiness"
```

### Task 9: Markdown 安全的真实红绿对比

**Files:**
- Modify: `client/src/features/historical-bid-adaptation/contentComparison.ts`
- Modify: `client/src/features/historical-bid-adaptation/contentComparison.test.ts`
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`

- [ ] **Step 1: 写对比失败测试**

覆盖真实来源快照、重复词只标实际位置、直接迁移无高亮、Markdown 表格/图片/代码块/Mermaid 保护块不被拆坏和来源快照缺失状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test src/features/historical-bid-adaptation/contentComparison.test.ts`
Expected: FAIL 新增保护块用例。

- [ ] **Step 3: 实现按需来源和差异展示**

选中章节时按需读取不可变来源；左侧浅红、右侧浅绿；编辑模式和对比模式保持独立；来源缺失时禁用失真高亮并显示原因。

- [ ] **Step 4: 运行对比测试和构建**

Run: `cd client; node --test src/features/historical-bid-adaptation/contentComparison.test.ts; npm run build`
Expected: PASS；仅允许既有 chunk 体积提示。

- [ ] **Step 5: 提交**

```powershell
git add client/src/features/historical-bid-adaptation/contentComparison.ts client/src/features/historical-bid-adaptation/contentComparison.test.ts client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx client/src/styles/feature-historical-bid-adaptation.css
git commit -m "feat: show trustworthy migration diffs"
```

### Task 10: 第五步交互收口

**Files:**
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`
- Modify: `client/scripts/historical_adaptation_ui_check.py`

- [ ] **Step 1: 写页面失败测试**

断言一个“建立/更新迁移方案”入口内部启动任务、没有重复“执行待处理迁移”、存在“重试未完成章节”、单章一次执行、恢复默认不覆盖人工正文、不存在逐章确认。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`
Expected: FAIL 新交互断言。

- [ ] **Step 3: 实现 UI 和 patch 合并**

区分“建立方案/迁移正文/检查”状态；任务事件按节点合并；人工正文覆盖使用 `AppDialog`；所有提示使用 Toast；保持页面内部滚动。

- [ ] **Step 4: 运行页面测试和 UI 脚本**

Run: `cd client; node --test src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs; python -X utf8 scripts/historical_adaptation_ui_check.py`
Expected: PASS，生成桌面和窄屏截图。

- [ ] **Step 5: 提交**

```powershell
git add client/src/features/historical-bid-adaptation client/src/styles/feature-historical-bid-adaptation.css client/scripts/historical_adaptation_ui_check.py
git commit -m "feat: streamline historical content migration UI"
```

### Task 11: 当前项目受控恢复与完整验证

**Files:**
- Create: `client/scripts/verify_historical_adaptation_project.cjs`
- Modify: relevant tests only if the real fixture reveals a missing documented case

- [ ] **Step 1: 编写只读真实项目验证脚本**

脚本读取指定项目，输出逐章期望/实际 mode、规则证据、五峰村来源节点、误匹配通用短语节点、人工正文哈希和事件负载；默认不写数据库。

- [ ] **Step 2: 运行只读验证并保存基线**

Run: `cd client; node --no-warnings --experimental-sqlite scripts/verify_historical_adaptation_project.cjs`
Expected: 方案分布可解释；无通用短语误匹配；列出所有必须迁移的五峰村节点。

- [ ] **Step 3: 备份并执行应用内受控恢复**

启动最新客户端，通过新“一键建立/更新”运行；确认数据库自动备份、人工正文哈希不变、旧自动结果按新计划重迁。不得用脚本绕过 Store 直接改业务数据。

- [ ] **Step 4: 运行完整验证**

```powershell
cd client
node --test electron/services/historicalAdaptationRuleEngine.test.cjs electron/services/historicalSourceIndex.test.cjs electron/services/historicalAdaptationLocalEdit.test.cjs electron/services/historicalAdaptationContentTask.test.cjs electron/services/historicalAdaptationContentCheckTask.test.cjs electron/services/historicalAdaptationReviewRules.test.cjs electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs electron/services/taskService.historicalAdaptation.test.cjs electron/ipc/index.workspaceDatabaseChannels.test.cjs src/features/historical-bid-adaptation/contentComparison.test.ts src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs
node --check electron/preload.cjs
node --check electron/services/historicalAdaptationRuleEngine.cjs
node --check electron/services/historicalSourceIndex.cjs
node --check electron/services/historicalAdaptationLocalEdit.cjs
node --check electron/services/historicalAdaptationContentTask.cjs
node --check electron/services/technicalPlanStore.cjs
npm run smoke:electron-native
npm run build
```

Expected: 全部退出 0；构建仅允许既有 chunk 警告。

- [ ] **Step 5: 运行 UI 验收并提交**

Run: `cd client; python -X utf8 scripts/historical_adaptation_ui_check.py`
Expected: 一键迁移、三种方式、人工保护、真实红绿对比、重试、检查和统一确认全部通过。

```powershell
git add client/scripts/verify_historical_adaptation_project.cjs
git commit -m "test: add historical migration project verification"
```

### Task 12: 最终复审与启动验收版本

**Files:**
- Review all files changed since `9ea56c8`

- [ ] **Step 1: 运行 `git diff --check` 和工作区审阅**

Run: `git diff --check 9ea56c8..HEAD; git status --short --branch`
Expected: 无格式错误、无未提交产品改动。

- [ ] **Step 2: 按 requesting-code-review 执行独立复审**

重点检查规则误匹配、人工正文覆盖、数据库升级、任务恢复、patch 丢失和检查绕过；修复 Critical/Important 后重跑受影响验证。

- [ ] **Step 3: 启动客户端**

Run: `cd client; npm run dev`
Expected: Vite 在 `http://127.0.0.1:5173/`，Electron 主窗口加载成功且无启动错误。

- [ ] **Step 4: 交付验收信息**

记录提交范围、测试通过数、构建结果、真实项目迁移分布、五峰村残留数、人工正文保护结果和客户端地址，交由用户操作验收。
