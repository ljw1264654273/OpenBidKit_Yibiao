# 历史标书适配一致性检查事实管线 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将历史标书适配一致性检查改造成动态分批、事实归一、局部语义检查、可恢复自动修复的混合事实管线，同时保持现有用户入口和阶段确认门禁不变。

**Architecture:** Main 侧先从招标基线、global facts 和正文建立本地事实注册表，再按模型上下文预算分批请求 AI 候选事实；本地使用固定 slot/fact_key 归一和冲突检测，仅把冲突证据发给 AI。批次结果持久化到 SQLite，检查任务可从失败批次恢复；自动修复继续复用现有 CAS、唯一命中和原子回滚协议。

**Tech Stack:** Electron CommonJS、better-sqlite3、Node test runner、React/TypeScript Renderer、现有 IPC/preload/SQLite Store/AI Service。

---

## 文件结构与职责

- Create: `client/electron/services/historicalAdaptationFactRegistry.cjs` — 确定性事实提取、slot/fact_key 生成、数值/单位归一、冲突合并和 facts hash。
- Create: `client/electron/services/historicalAdaptationFactRegistry.test.cjs` — 事实注册表、稳定键和冲突测试。
- Modify: `client/electron/services/aiService.cjs` — 结构化输出降级、错误分类、上下文预算和批次重试元数据。
- Modify: `client/electron/services/aiService.test.cjs` — 供应商能力降级、413/超时/格式错误分类测试。
- Modify: `client/electron/services/sqliteDatabase.cjs` — 批次表 migration、索引和旧数据兼容。
- Modify: `sql/workspace_schema.sql` — 同步批次表正式 schema。
- Modify: `client/electron/services/technicalPlanStore.cjs` — global facts 输入、批次 CRUD、快照哈希、批次失效和原子事务。
- Create: `client/electron/services/technicalPlanStore.historicalAdaptationContentCheckBatches.test.cjs` — Store 批次和输入哈希测试。
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.cjs` — 动态分批、事实 Map-Reduce、冲突 resolutions、批次缓存、复查和错误码持久化。
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.test.cjs` — 长文本、小上下文、对象/数组输出、冲突解除、批次恢复测试。
- Modify: `client/electron/services/taskService.cjs` — 中断检查按批次恢复，失败批次重跑。
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs` — interrupted/pending/running batch recovery tests。
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`, `client/electron/preload.cjs`, `client/src/shared/types/ipc.ts` — 可选 `retry_batch_id` 和结构化错误字段透传。
- Modify: `client/src/features/technical-plan/types.ts` — batch/error_code/stage 类型。
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx` — 阶段、批次失败和错误码中文提示，重试失败批次。
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs` — 页面契约和重试交互测试。

### Task 1: 先建立 AI 结构化输出适配与错误分类

**Files:** `client/electron/services/aiService.cjs`, `client/electron/services/aiService.test.cjs`

- [ ] 写失败测试：`json_schema` 不支持时降级、413/上下文超限分类、超时分类、JSON 对象/数组提取、保留 `error_code`。
- [ ] 运行 `cd client; node --test electron/services/aiService.test.cjs`，确认新增测试失败。
- [ ] 实现 `normalizeStructuredPayload`、`classifyAiRequestError` 和上下文预算 helper；不要把真实 API Key 或完整正文写入错误日志。
- [ ] 让现有 `requestJson/collectJsonResponse` 暴露结构化错误元数据，并保持旧调用者的 Error 兼容。
- [ ] 重跑定向测试，确认全部通过。
- [ ] `git diff --check`，提交 `feat: add resilient structured ai response adapter`。

### Task 2: 实现本地事实注册表

**Files:** `historicalAdaptationFactRegistry.cjs`, `historicalAdaptationFactRegistry.test.cjs`

- [ ] 写失败测试：项目名称、金额、地点、中文数字、工期、工作量和人员配置提取；slot 白名单；稳定 fact_key；同值合并和异值冲突。
- [ ] 运行 `cd client; node --test electron/services/historicalAdaptationFactRegistry.test.cjs`，确认失败。
- [ ] 实现确定性提取、`normalizeQualifier`、`canonicalFactKey`、证据定位和 facts hash；未知 slot 只产生 manual finding。
- [ ] 运行定向测试并补充包含全角标点、中文数字和同义单位的边界用例。
- [ ] `node --check electron/services/historicalAdaptationFactRegistry.cjs`，提交 `feat: add deterministic historical fact registry`。

### Task 3: 加入 SQLite 批次表和 global facts 输入

**Files:** `sqliteDatabase.cjs`, `sql/workspace_schema.sql`, `technicalPlanStore.cjs`, 新增 Store 测试

- [ ] 写失败测试：批次 create/read/update/atomic result、正文/基线/global facts/协议哈希失效、旧 schema migration。
- [ ] 运行 `cd client; node --test electron/services/technicalPlanStore.historicalAdaptationContentCheckBatches.test.cjs`，确认失败。
- [ ] 新增 `historical_adaptation_content_check_batches` 表、索引和 migration；状态使用 `pending/running/success/failed-retryable/failed-manual/stale`。
- [ ] 让 `getHistoricalAdaptationContentCheckContext()` 加载已确认 global facts，并把它们纳入 `inputs_hash`。
- [ ] 实现批次读写、复用条件和失效事务；汇总快照只有在所有批次状态可接受时才写成功。
- [ ] 运行 Store/native 定向测试和 `npm run smoke:electron-native`。
- [ ] 提交 `feat: persist consistency check batches and global facts`。

### Task 4: 重构一致性任务为动态 Map-Reduce

**Files:** `historicalAdaptationContentCheckTask.cjs`, 对应测试

- [ ] 写失败测试：不重复发送完整基线、按上下文预算切批、对象/数组事实响应、稳定 key 合并、冲突 resolution 仅接受 baseline/global exact match。
- [ ] 运行 `cd client; node --test electron/services/historicalAdaptationContentCheckTask.test.cjs`，确认新增测试失败。
- [ ] 接入 fact registry；按 `context_length_limit * 0.40` 计算输入预算并按章节/段落拆批，保留 batch_id 和 node_ids。
- [ ] 实现候选事实协议和归一 reducer；对未知 slot、未知 node_id、非法 resolution 转人工。
- [ ] 将语义检查改为冲突证据包；resolution 成功后重算 facts hash，再进入现有 repair contract。
- [ ] 接入批次缓存、失败批次重试、复查最多两轮和 error_code 持久化。
- [ ] 运行一致性任务、修复模块和 Store 定向测试，提交 `feat: use resumable map-reduce consistency checks`。

### Task 5: 接入任务恢复、IPC 类型和 Renderer 状态

**Files:** `taskService.cjs`, IPC/preload/types、`AdaptationContentPage.tsx`、页面测试

- [ ] 写失败测试：中断任务只恢复 pending/running/failed-retryable 批次；Renderer 能显示错误码和失败批次；重试只带 `retry_batch_id`。
- [ ] 运行相关 IPC、taskService 和页面测试，确认失败。
- [ ] 修改 task recovery，不再整次检查直接 stale；恢复后只重跑失效或失败批次。
- [ ] 透传可选 retry_batch_id、batch progress、error_code；Renderer 展示“上下文过长/结构化输出不兼容/当前批次失败”等中文提示。
- [ ] 保持人工正文不覆盖、阶段确认和导出门禁逻辑不变。
- [ ] 运行 Renderer 页面契约测试，提交 `feat: expose resumable consistency check status`。

### Task 6: 集成验证与手动验收

- [ ] 运行 `cd client; npm run build`。
- [ ] 运行 `cd client; npm run smoke:electron-native`。
- [ ] 串行运行本次改动相关 Node 测试，确认没有共享数据库并发干扰。
- [ ] 手动验证：长正文、小上下文、模型返回数组、模型不支持 schema、global facts 变更、AI 失败重试、冲突转人工、自动修复后全文复查、人工正文保护和阶段确认。
- [ ] `git diff --check`、`git status --short --branch`，提交 `test: verify resilient consistency pipeline`。

