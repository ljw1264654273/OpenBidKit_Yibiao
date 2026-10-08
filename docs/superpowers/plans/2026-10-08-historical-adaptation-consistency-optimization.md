# Historical Adaptation Consistency Optimization Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan in this session. Steps use checkbox syntax for tracking. Existing overlapping fact-repair edits stay in this checkout; do not reset or move them.

**Goal:** Reuse unchanged chapter fact extraction and identical semantic requests, reduce attribution retries, and expose monotonic stage/batch progress.

**Architecture:** Main owns a project-scoped SQLite response cache separate from current-run audit batches. Facts cache stores chapter candidates before cross-chapter merging, while every run still materializes a complete fingerprinted manifest. Semantic cache hashes the actual request and reruns resolution validation; shared conflicts conservatively invalidate requests.

**Tech Stack:** Electron CommonJS, better-sqlite3 migrations, node:test, React TypeScript and existing global UI components.

**Approved spec:** `docs/superpowers/specs/2026-10-08-historical-adaptation-consistency-optimization-design.md`.

## Task 1: Regression tests and cache storage

Files: `client/electron/services/historicalAdaptationContentCheckTask.optimization.test.cjs` (new), `historicalAdaptationContentCheckTask.integration.test.cjs`, `sqliteDatabase.cjs`, `technicalPlanStore.cjs`, `sql/workspace_schema.sql`.

- [x] Add failing behavior tests: two chapters initially checked; editing one extracts only it; conflict with unchanged direct chapter still blocks; baseline/globals/differences/path changes invalidate; empty confirmed chapter remains covered; failed long chapter is not cached; unchanged raw candidates survive manual overrides and regenerate IDs.
- [x] Run `node --test electron/services/historicalAdaptationContentCheckTask.optimization.test.cjs` in client and confirm failure for missing reuse/progress behavior.
- [x] Add migration 47 and health repair for `historical_adaptation_content_check_cache`, primary key `(project_id, phase, cache_key)`, JSON result and node IDs, timestamps; synchronize target SQL.
- [x] Add Main-only Store `getHistoricalAdaptationContentCheckCache({phase, cacheKey})` and `saveHistoricalAdaptationContentCheckCache({phase, cacheKey, nodeIds, result})`. Use bound project ID and UTF-8-compatible SQLite JSON. Stale aggregate checks leave this cache intact; project clear/delete removes it.
- [x] Extend real Electron/SQLite integration to cover candidate-cache persistence, mixed/new current manifests, all-cache manifests, invalidation and project isolation/cleanup.

## Task 2: Task orchestration and cache keys

Files: `client/electron/services/historicalAdaptationContentCheckOptimization.cjs` (new pure helper), `historicalAdaptationContentCheckTask.cjs`, task tests.

- [x] Define extraction/check optimization version in the helper and include it in Task/Store protocol fingerprints so previous whole-success results cannot bypass new protocols.
- [x] Include `node_id` in candidate prompt example/rules/schema; preserve compatibility retries. Preserve per-node raw candidates in normalization before cross-chapter merge; only unambiguous valid candidate results are cacheable. Legacy merged facts remain compatible but are not reverse-engineered into raw chapter candidates.
- [x] Hash chapter ID/path/body, extraction version, effective local summary and baseline/globals/differences/deterministic inputs without using global content/input hashes. Read cached chapter candidates before batching; request only missing fragments. Write a chapter cache only when all its fragments completed without invalid candidates.
- [x] Keep full current-run descriptors, including confirmed empty chapters. Combine reused candidates and new facts under current inputsHash; write all successful audit batches under current hashes. A failed request marks the run errored and cannot finish the manifest.
- [x] Cache semantic responses by actual messages/response format and semantic version. Omit log titles/run IDs from key. Feed cached responses through findings normalization and fact-resolution validation on every invocation. Persist legal blocking responses without granting success.
- [x] Run new optimization tests and existing `historicalAdaptationContentCheckTask.test.cjs`; adjust only assertions intentionally affected by protocol upgrades, preserve fact-repair regressions.

## Task 3: Real progress and running details

Files: optimization helper, task, `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`, existing page runtime tests.

- [x] Add failing tests showing progress never decreases across repair rounds and attribution retries; stage/batch log exists before model request waits.
- [x] Map existing round-local progress into 5–60, 60–80, 80–99 bands, reserve repair ranges and clamp monotonically in a checkpoint wrapper. Completion uses 100. Update logs before each request and split retry, after each response, and for chapter/batch reuse.
- [x] Route UI context through ui-skills-root and load one relevant interaction skill. Show running stage and latest task log with existing classes and accessible status semantics; preserve existing percentage and ProgressBar implementation.
- [x] Run page runtime/static regression tests and optimization progress tests.

## Task 4: Verification and handoff

- [x] Run focused task, Store content-check batches/content/review/repair, fact registry, SQLite migration and native integration tests with `node --test` in client.
- [x] Run `node --check` for every changed/new production CommonJS file, `npm run smoke:electron-native`, `npm run build`, and `git diff --check`.
- [x] Start `npm run dev` and verify app startup plus running status through available browser/runtime harness. If real model/document interactive verification is unavailable, state that limit explicitly; do not invoke paid model calls solely for a performance estimate.
- [x] Record observed mock request counts for first check, unchanged check, single edit and repair recheck. Report implementation, validation and global-conflict conservative invalidation limitation. Preserve pre-existing edits and leave changes reviewable locally.

## 实施与验证记录（2026-10-08）

- 已完成章节原始候选缓存、相同语义请求缓存、migration 47、项目隔离和清理，以及每轮完整审计快照。直接迁移章节首次仍检查；复用时保留原值与证据，并按当前输入重建事实 ID。语义缓存命中仍执行裁决校验，阻断结果不会变成通过。
- 事实提取提示与 schema 显式要求 `node_id`；不明确归属候选和未完成的长章分片不进入章节缓存。删除章节不会将旧缓存候选带回当前事实表。
- 检查进度按检查／修复轮次映射并保持单调，模型等待前显示阶段、批次和归属补提日志。详情已放在顶部进度条旁，使用现有样式与可访问状态提示。
- 聚焦回归组合 112/112 通过；随后新增的删除章节用例随优化套件 18/18 通过。真实 Electron/SQLite 集成覆盖跨重启复用、混合／全部命中快照、项目隔离及清空／删除；项目管理原生测试 15/15 通过。
- 独立代码复核未发现 Critical／Important 问题；额外模拟确认长章三个成功分片可零请求复用，中断后复用成功分片且仅请求剩余两个分片，最终保留完整当前批次、事实证据和阻断结果。
- CommonJS 语法检查、`npm run smoke:electron-native`、`npm run build` 与 `git diff --check` 均通过。构建仅有既有 chunk 体积警告；没有新增依赖。
- 页面运行时测试通过，1000px 和 420px 截图确认阶段与批次详情在进度条附近可见。`npm run dev` 新启动被既有 5173 实例占用；已确认该实例属于本 checkout，页面模块 HTTP 200，并用隔离 Electron/Vite 运行时验证界面，未结束用户现有进程。
- 模拟两章场景：首次检查 2 次模型请求（提取 1 + 语义 1）；实际请求内容相同的再次检查 0 次；单章编辑 2 次，但只提取变更章正文；单章自动修复含两轮检查及修复共 5 次，复检仅提取修复章。该计数不代表真实耗时比例。
- 基准、全局事实或共享冲突变化仍可能扩大重检范围。未调用付费模型测量真实文档耗时；启用新 Main 逻辑与数据库迁移需完整重启客户端。保留既有事实修复编辑，未提交或发布。
