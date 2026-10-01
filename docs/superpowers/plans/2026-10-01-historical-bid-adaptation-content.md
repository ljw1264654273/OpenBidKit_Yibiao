# 历史标书适配低扰动正文迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将历史标书适配第五步改为“默认直接迁移、仅三类差异自动局部改造、其他改写人工触发、阶段统一确认”，并补齐人工扩缩写和可防陈旧的一致性检查。

**Architecture:** 先把差异影响范围结构化，再建立可持久化的逐章迁移方案；迁移 Runner 只执行方案中的三种策略，未选择策略时不调用 AI。独立内容检查任务保存正文与输入哈希，Store 的阶段确认事务只验证最新检查快照和全部叶子状态。Renderer 负责策略选择、人工编辑候选和问题定位，权威正文仍只保存在 `technical_plan_outline_nodes.content`。

**Tech Stack:** Electron CommonJS Main/IPC/preload、React + TypeScript Renderer、SQLite/better-sqlite3、Radix UI、Node test、Vite。

## 追加交互收敛（2026-10-01）

本次已确认的交互收敛只保留三种用户可选处理方式：`direct`、`local-rewrite`、`rewrite`。`supplement` 与 `rewrite` 合并为“定向改写”，无历史正文时按非空人工要求生成补充正文；`review` 只作为章节状态，无可靠来源时推荐方式为 null。单章操作合并为“按此方式迁移本章”，Renderer 先保存选择，再启动单章任务；保存失败不启动，人工覆盖取消不保存。“保存人工修改”只保存人工正文。

- [x] Runner 与 Store 回归：三种方式、有/无来源定向改写、旧 supplement 兼容和人工要求门禁。
- [x] 类型与 UI 收敛：空推荐、禁用提示、未应用选择提示、合并执行入口及人工覆盖保护。
- [x] 页面回归：保存失败不启动、批量不忽略未应用选择、单章保存后启动、启动失败可重试、取消覆盖无写入、确认覆盖携带标记。
- [x] 定向测试、native smoke、生产构建与最终差异检查。

---

### Task 1: 为差异增加自动局改范围

**Status:** complete

**Files:**
- Modify: `client/electron/services/historicalAdaptationDifferenceTask.cjs`
- Modify: `client/electron/services/historicalAdaptationDifferenceTask.test.cjs`
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationDifferencePage.tsx`

- [ ] **Step 1: 写失败测试，约束差异 scope**

在 `historicalAdaptationDifferenceTask.test.cjs` 增加用例，要求 normalizer 只接受 `location-target | workload | schedule | none`，并验证旧数据默认 `none`，`ignored` 差异不会触发自动 scope。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationDifferenceTask.test.cjs`

Expected: FAIL，缺少 `content_change_scope`。

- [ ] **Step 3: 更新 Prompt、normalizer 和共享类型**

让模型对每项差异返回 `content_change_scope`，规则只允许地点/实施对象、工作量、工期/进度进入前三类，项目名称、金额、人员和一般数据更新为 `none`。在差异页面显示“自动局改范围”只读标签。

- [ ] **Step 4: 运行定向测试**

Run: `cd client; node --test electron/services/historicalAdaptationDifferenceTask.test.cjs`

Expected: PASS。

### Task 2: 重构逐章迁移方案与旧数据升级

**Files:**
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.test.cjs`
- Modify: `client/src/features/technical-plan/types.ts`

- [ ] **Step 1: 写失败测试覆盖推荐策略**

覆盖：可靠来源默认 `direct`；前三类 confirmed scope 为 `local-rewrite`；新增/无法定位的推荐方式为 null、状态为 review；普通目录变化不触发 `rewrite`；旧自动 `supplement`/`rewrite` 不升级为人工授权。

- [ ] **Step 2: 写失败测试覆盖状态和策略归一化**

要求 item 状态为 `idle | running | success | review | stale | error`，正文来源为 `migrated | local-rewrite | ai-rewrite | supplement | manual`，最终策略固定通过 `manual_mode || recommended_mode` 派生。

- [ ] **Step 3: 写失败测试覆盖 Runner 授权、原子性和恢复**

逐项覆盖：`direct` 与空执行方式零 AI 调用；`rewrite` 没有人工选择和非空要求时拒绝执行；局部替换任一项不唯一时全部不应用；默认重试只处理未成功/stale 节点；显式全量重跑处理全部目标。

- [ ] **Step 4: 写失败测试覆盖 Runner 成功矩阵**

分别验证三类 scope 原子局改；人工授权 `rewrite` 有来源时改写，无来源时补充生成，两者均写入 ai-rewrite；输入兼容时保留人工策略与要求。

- [ ] **Step 5: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationContentTask.test.cjs`

Expected: FAIL，当前 planner 会把一般差异和目录变化设为 `rewrite`。

- [ ] **Step 6: 实现迁移方案 normalizer 和输入指纹**

方案项持久化 `recommended_mode`、`manual_mode`、`manual_instruction`、来源定位器、来源哈希和输入指纹；不持久化独立 `mode`。重建方案只在节点、来源和输入兼容时保留人工选择。

- [ ] **Step 7: 实现局部替换原子应用**

`local-rewrite` 要求模型返回精确替换数组，并用 `electron/utils/textEdit.cjs` 的 `applyTextEdits()` 一次性应用；任一项未唯一命中则保留直接迁移正文并标记 `review`，不得退化整章改写。

- [ ] **Step 8: 实现 Runner 策略门禁**

`direct` 不调用 AI；空执行方式跳过且不调用 AI；`rewrite` 必须存在人工选择和非空 `manual_instruction`，按来源有无选择改写或生成 Prompt。默认重试只处理非成功或 stale 节点。

- [ ] **Step 9: 运行 Runner 测试**

Run: `cd client; node --test electron/services/historicalAdaptationContentTask.test.cjs`

Expected: PASS。

### Task 3: 扩展 Store、SQLite 状态和阶段确认契约

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `client/electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs`
- Modify: `sql/workspace_schema.sql`

- [ ] **Step 1: 写 migration 失败测试**

要求 `technical_plan_meta` 增加 `historical_adaptation_content_check_json`，升级旧数据库时默认 NULL，目标 schema 同步。

- [ ] **Step 2: 写 Store 失败测试**

覆盖建立/重建方案、保存单章策略、批量直迁返回成功/跳过数、人工保存后 `content_origin=manual` 并转 success/review、策略修改转 stale、保存正文清除检查快照和终审状态，以及迁移/检查任务处于 queued、running、pausing、paused 时禁止策略和正文修改。

- [ ] **Step 3: 写方案前置门禁失败测试**

在 TaskService 测试项目类型；在 Store/Runner 测试完整招标基线、差异全部处理、目录已确认、历史原文可读且目录非空。建立/重建方案统一通过 `taskService.prepareHistoricalAdaptationContentPlan()` 编排，IPC 不绕过项目类型门禁直调 Store。

- [ ] **Step 4: 写阶段确认失败测试**

确认必须全有或全无：全部叶子有记录、正文非空、item success、没有活动迁移/检查任务、检查状态 success、正文/输入哈希最新且无 blocker。readiness 返回 `{ ready, blockingCount, firstNodeId, findings }`。

- [ ] **Step 5: 运行测试确认失败**

Run: `cd client; node --test electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`

Expected: FAIL。

- [ ] **Step 6: 实现 schema、Store 命令和失效规则**

新增 `prepareHistoricalAdaptationContentPlan`、`saveHistoricalAdaptationContentStrategy`、`batchSetHistoricalAdaptationContentStrategy`、`getHistoricalAdaptationContentReadiness`；删除新流程对 `confirmHistoricalAdaptationContentItem` 的使用和逐章 `confirmed_at` 写入。

- [ ] **Step 7: 运行 Store/migration 测试**

Run: `cd client; node --test electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`

Expected: PASS。

### Task 4: 新增独立一致性检查后台任务

**Files:**
- Create: `client/electron/services/historicalAdaptationContentCheckTask.cjs`
- Create: `client/electron/services/historicalAdaptationContentCheckTask.test.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs`
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

- [ ] **Step 1: 写检查规则失败测试**

定义 finding schema：`id/code/category/severity/blocking/node_ids/message/evidence`。本地规则覆盖空正文、旧值残留、待核实占位符和 review/error/stale；语义检查结构化返回工作量、工期进度和跨章节冲突。

- [ ] **Step 2: 写哈希与失败恢复测试**

要求结果保存 `checked_content_hash`、`checked_inputs_hash`、`checked_at`；模型或 JSON 失败时 task/error 且检查快照无效；重启把活动检查任务转 error，不复用未完成 findings。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationContentCheckTask.test.cjs electron/services/taskService.historicalAdaptation.test.cjs`

Expected: FAIL，检查任务尚不存在。

- [ ] **Step 4: 实现检查 Runner**

通过 task scoped `aiService` 和 JSON Schema 执行语义检查，仅生成 findings，不改正文；本地 blocker 与模型 findings 合并后一次 checkpoint 检查快照。

- [ ] **Step 5: 接入 TaskService 生命周期**

注册 `historical-adaptation-content-check`，与迁移任务组内互斥；支持启动、取消、事件回放、重启恢复和上游清理前等待 settled。

- [ ] **Step 6: 接入页面任务事件与活动态**

在 `HistoricalBidAdaptationPage.tsx` 中接收检查任务事件、合并到 `historicalAdaptationContentCheckTask`，并让页面导航/编辑门禁同时识别迁移和检查任务的 queued、running、pausing、paused 状态。

- [ ] **Step 7: 运行检查任务测试**

Run: `cd client; node --test electron/services/historicalAdaptationContentCheckTask.test.cjs electron/services/taskService.historicalAdaptation.test.cjs`

Expected: PASS。

### Task 5: 完整接通 IPC、preload 和类型

**Files:**
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/taskIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/technical-plan/types.ts`

- [ ] **Step 1: 写 workspace channel 失败测试**

要求方案、策略、批量设置、readiness 和检查任务通道均在数据库 pending/unavailable 生命周期中注册。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/ipc/index.workspaceDatabaseChannels.test.cjs`

Expected: FAIL，缺少新通道。

- [ ] **Step 3: 实现薄 IPC 和 bridge**

IPC 保持薄转发：方案建立/重建转发给 TaskService 以执行项目类型门禁，其余 Store 命令解析项目 Store 后转发。同步 `YibiaoBridge`、检查状态、finding、策略请求和返回类型。旧逐章确认 API 可暂时兼容，但 Renderer 不再调用。

- [ ] **Step 4: 运行语法和 IPC 测试**

Run: `cd client; node --check electron/preload.cjs; node --check electron/ipc/technicalPlanIpc.cjs; node --check electron/ipc/taskIpc.cjs; node --test electron/ipc/index.workspaceDatabaseChannels.test.cjs`

Expected: 全部 PASS。

### Task 6: 改造第五步迁移策略和批量确认 UI

**Files:**
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`
- Modify: `client/scripts/historical_adaptation_ui_check.py`
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.test.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs`
- Modify: `client/src/shared/types/ipc.ts`

- [ ] **Step 1: 写人工正文覆盖的 Main 失败测试**

在 Runner/TaskService 测试中验证 `content_origin=manual` 的目标章没有 `forceOverwriteManual` 时拒绝启动或覆盖，有显式 true 时才允许执行；同时断言其他 origin 不要求该标记。

- [ ] **Step 2: 写 Renderer 失败测试**

断言存在“建立/更新迁移方案”“批量设为直接迁移”“运行一致性检查”和单章策略控件；不存在“确认当前章节”；阶段确认不再依赖 `allConfirmed`。对 `content_origin=manual` 的章节点击重新迁移必须先打开确认对话框，确认后才传 `forceOverwriteManual: true`。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationContentTask.test.cjs electron/services/taskService.historicalAdaptation.test.cjs src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

Expected: FAIL。

- [ ] **Step 4: 实现方案态和策略控件**

未建立方案时先建立方案；中栏使用菜单选择处理方式，定向改写显示必填要求；批量直迁反馈已设置数和跳过数。任务活动时禁用策略与正文编辑。

- [ ] **Step 5: 移除逐章确认并接入 readiness**

删除按钮、逐章确认计数和相关 handler。阶段确认前读取 readiness；有 blocker 时显示数量并选中 `firstNodeId`，全局问题则提示打开一致性检查列表。

- [ ] **Step 6: 实现检查状态展示**

提供检查按钮、running/error/stale/success 状态、问题列表与章节定位；不在保存正文后自动启动检查。

- [ ] **Step 7: 保护人工正文不被静默覆盖**

当前章 `content_origin=manual` 时，“按此方式迁移本章”先打开 `AppDialog`；取消不保存策略也不启动。确认后保存策略，成功后才启动任务并传 `forceOverwriteManual: true`；保存失败不启动。

- [ ] **Step 8: 运行 Renderer 与 Main 测试**

Run: `cd client; node --test electron/services/historicalAdaptationContentTask.test.cjs electron/services/taskService.historicalAdaptation.test.cjs src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

Expected: PASS。

### Task 7: 增加人工扩写/缩写候选编辑

**Files:**
- Modify: `client/src/features/technical-plan/components/ContentAiRewriteMenu.tsx`
- Modify: `client/src/features/technical-plan/components/ContentAiRewriteDrawer.tsx`
- Modify: `client/src/features/technical-plan/services/contentAiEdit.ts`
- Modify: `client/src/features/technical-plan/services/contentAiEdit.test.ts`
- Modify: `client/electron/services/contentAiEditService.cjs`
- Modify: `client/electron/services/contentAiEditService.test.cjs`
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Modify: `client/src/shared/types/ipc.ts`

- [ ] **Step 1: 写选区/整章行为失败测试**

扩写和缩写有选区时以选区为 replacement range，无选区时以整章为 range；候选应用后只更新草稿。选区与图片/Mermaid 保护范围相交时拒绝。

- [ ] **Step 2: 写 Renderer 入口失败测试**

在 `HistoricalBidAdaptationPage.test.cjs` 断言历史适配第五步启用“扩写”“缩写”，选区摘要与整章摘要均可进入候选 Drawer；普通技术方案 `ContentEditPage` 不传启用开关，因此不展示这两个入口。

- [ ] **Step 3: 写占位符完整性失败测试**

整章处理时保护内联图片与 Mermaid 块；模型返回缺失、重复或乱序占位符时拒绝候选。

- [ ] **Step 4: 运行测试确认失败**

Run: `cd client; node --test src/features/technical-plan/services/contentAiEdit.test.ts electron/services/contentAiEditService.test.cjs src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

Expected: FAIL，尚无 expand/shrink 模式。

- [ ] **Step 5: 扩展候选编辑服务**

`ContentAiEditMode` 增加 `expand | shrink`，两者返回 rewrite candidate；Prompt 明确不得虚构事实，扩写只增加可执行细节，缩写保留事实、数字和承诺。技术方案原页面默认不展示新增入口，历史适配页显式启用。

- [ ] **Step 6: 在历史适配页接入菜单和 Drawer**

复用现有候选预览与快照校验；“应用到草稿”后用户仍需点击保存，放弃草稿不改变持久状态。

- [ ] **Step 7: 运行候选编辑测试**

Run: `cd client; node --test src/features/technical-plan/services/contentAiEdit.test.ts electron/services/contentAiEditService.test.cjs src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

Expected: PASS。

### Task 8: 同步环节六终审门禁

**Files:**
- Modify: `client/electron/services/historicalAdaptationReviewRules.cjs`
- Modify: `client/electron/services/historicalAdaptationReviewRules.test.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationReviewExportPage.tsx`

- [ ] **Step 1: 写失败测试移除逐章 confirmed_at 依赖**

终审只检查当前全部叶子有迁移记录、status success、正文非空、内容检查快照有效且环节五阶段时间存在；旧 `confirmed_at` 不参与判定。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/historicalAdaptationReviewRules.test.cjs electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`

Expected: FAIL，当前规则仍要求逐章确认。

- [ ] **Step 3: 修改规则和终审页面文案**

终审展示一致性检查摘要，不再显示逐章确认缺失问题。`technicalPlanStore.cjs` 的运行终审、确认终审和导出门禁复用 readiness/hash 校验，拒绝陈旧或失败的内容检查快照；导出门禁保持 P0/阶段验收规则不变。

- [ ] **Step 4: 运行终审测试**

Run: `cd client; node --test electron/services/historicalAdaptationReviewRules.test.cjs electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`

Expected: PASS。

### Task 9: 全链路验证

**Files:**
- Verify: all files above

- [ ] **Step 1: 执行全部历史适配定向测试**

```powershell
cd client
node --test electron/services/historicalAdaptationDifferenceTask.test.cjs electron/services/historicalAdaptationContentTask.test.cjs electron/services/historicalAdaptationContentCheckTask.test.cjs electron/services/sqliteDatabase.historicalAdaptationContentMigration.test.cjs electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs electron/services/historicalAdaptationReviewRules.test.cjs electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs electron/services/taskService.historicalAdaptation.test.cjs electron/services/contentAiEditService.test.cjs electron/ipc/index.workspaceDatabaseChannels.test.cjs src/features/technical-plan/services/contentAiEdit.test.ts src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs
```

Expected: PASS。

- [ ] **Step 2: 检查所有改动的 CommonJS 文件**

Run: 对改动的 `client/electron/**/*.cjs` 逐一执行 `node --check`。

Expected: 全部退出 0。

- [ ] **Step 3: 验证 Electron native 和生产构建**

Run: `cd client; npm run smoke:electron-native; npm run build`

Expected: 两条命令退出 0；允许既有 chunk 体积警告。

- [ ] **Step 4: 启动桌面应用并执行 UI 回归**

Terminal A: `cd client; npm run dev`

Terminal B: `cd client; python scripts/historical_adaptation_ui_check.py`

Expected: 脚本退出 0，并输出“历史标书适配 UI 验证通过”；截图写入脚本的 `OUTPUT_DIR`。检查方案生成、批量直迁、三类局改、review 跳过、人工策略、选区/整章扩缩写、一致性检查、阶段确认、环节六和窄屏内部滚动。

- [ ] **Step 5: 审阅最终差异**

确认没有覆盖用户现有改动，没有删除或弱化埋点，未把项目名称硬编码到迁移规则，`package-lock.json` 的既有未合并状态未被擅自处理。
