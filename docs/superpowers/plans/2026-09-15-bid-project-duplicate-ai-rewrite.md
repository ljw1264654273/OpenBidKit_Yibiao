# 我的标书同源正文查重与 AI 改写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“我的标书”中的同源正文查重改为人工选择后明确开始，并支持按项目查看最近结果、宽屏完整展示、逐组 AI 改写和人工忽略。

**Architecture:** 保留现有 `BidProjectWorkspacePage` 作为列表页入口、`bid_project_duplicate_results` 作为查重结果权威存储。Main 侧在现有 Store/IPC 边界上增加最近结果查询、结果决策更新和 AI 改写接口；Renderer 将选择栏和结果弹窗拆成专用组件，列表页只负责项目列表和状态编排。AI 改写通过现有 `aiService.requestJson()` 调用，生成内容只进入当前组草稿，用户确认后才复用现有正文替换接口。

**Tech Stack:** Electron Main CommonJS、React + TypeScript、Radix `AppDialog`、SQLite/better-sqlite3、现有 `aiService` 文本队列、Node `node:test`、Vite/TypeScript build。

**Reference Spec:** `docs/superpowers/specs/2026-09-15-bid-project-duplicate-ai-rewrite-design.md`

---

## 文件结构

- Modify: `client/electron/services/bidProjectStore.cjs` - 最近查重结果查询、完整结果关联项目名、单组人工决策持久化。
- Modify: `client/electron/services/bidProjectStore.test.cjs` - 最近结果、左右项目查询、决策持久化和决策迁移测试。
- Create: `client/electron/services/bidProjectDuplicateRewriteService.cjs` - AI 改写 Prompt、JSON 结果规范化和 `aiService.requestJson()` 调用。
- Create: `client/electron/services/bidProjectDuplicateRewriteService.test.cjs` - AI 改写请求结构和结果校验测试。
- Modify: `client/electron/ipc/bidProjectIpc.cjs` - 新增最近结果、结果加载、决策更新、AI 改写 IPC。
- Modify: `client/electron/ipc/index.cjs` - 装配 rewrite service，并将新增 `bid-project:*` 通道加入数据库就绪通道列表。
- Modify: `client/electron/preload.cjs` - 暴露新增 `bidProject` bridge 方法。
- Modify: `client/src/features/bid-project/types.ts` - 补充最近结果、决策和 AI 改写类型。
- Modify: `client/src/shared/types/ipc.ts` - 同步 `window.yibiao.bidProject` 方法签名。
- Modify: `client/src/features/bid-project/services/bidProjectStorage.ts` - 封装新增 bridge 调用。
- Create: `client/src/features/bid-project/components/BidProjectCompareBar.tsx` - 两项目选择、交换顺序和“开始对比”。
- Create: `client/src/features/bid-project/components/BidProjectDuplicateResultDialog.tsx` - 宽屏结果弹窗、逐组 AI 改写、忽略和确认替换。
- Modify: `client/src/features/bid-project/components/BidProjectRow.tsx` - 显示最近结果摘要和查看入口。
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx` - 删除自动查重，接入人工选择、最近结果加载和新组件。
- Modify: `client/src/styles/feature-bid-project.css` - 选择栏、结果摘要和宽屏弹窗内部滚动/响应式样式。
- Create: `client/src/features/bid-project/services/duplicateRewriteUi.ts` - Renderer 侧目标方向、草稿校验和摘要格式化的纯逻辑 helper。
- Create: `client/src/features/bid-project/services/duplicateRewriteUi.test.ts` - 测试 Renderer 侧目标方向、草稿和显示摘要 helper。

本次不修改 `sql/workspace_schema.sql` 或 `sqliteDatabase.cjs`：查重决策继续保存在已有 `matches_json` 中，不新增表或列。若实现过程中发现已有 JSON 结构无法兼容，先回到 Store 测试确认，再单独补 migration，不在本计划中隐式扩大范围。

## Task 1: Store 查询与决策持久化

**Files:**
- Modify: `client/electron/services/bidProjectStore.cjs`
- Test: `client/electron/services/bidProjectStore.test.cjs`

- [ ] **Step 1: Write failing Store tests for latest results**

在现有内存 SQLite 测试中创建三份同源项目和两条查重结果，覆盖：

- `listRecentDuplicateSummaries([projectId])` 返回该项目最近一次参与结果；
- 项目作为 `left_project_id` 或 `right_project_id` 时都能找到；
- 返回的另一侧项目名、重复组数、最高相似度、结果 ID 和更新时间正确；
- 项目没有结果时返回空结果，不抛错；
- 传入项目 ID 集合时不为每个项目单独建立查询。

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
cd client
node --test electron/services/bidProjectStore.test.cjs
```

Expected: FAIL because the recent-result Store API does not exist.

- [ ] **Step 3: Write failing Store tests for result loading and decisions**

增加测试覆盖：

- `loadDuplicateResult(resultId)` 返回左右项目基础信息，并解析 `matches_json`；
- `updateDuplicateMatchDecision()` 能按 `matchId` 更新单组；
- `ignored` 决策保存 `decisionTargetSide: 'none'` 和时间；
- 更新不存在的结果或 match 返回明确错误；
- 原有其它 match 不被覆盖。
- `loadLatestDuplicateResult(projectId)` 在项目作为左侧或右侧时都返回该项目最近一次完整结果。
- 保存新查重结果时，能够从上一条同一项目对比结果按 canonical match key 继承 `ignored` 和 `rewritten` 决策；
- 决策更新不会把旧结果的 `updated_at` 推到最新；
- 相同项目反向比较时能正确交换 `decisionTargetSide`，段落重排时能按节点 ID + 段落文本继续匹配；
- 同一节点下存在两个不同段落时不会发生决策串组；
- 读取历史结果时能够返回 `threshold`，不需要重新执行比较。
- 新保存的结果保留本次比较器返回的真实 `threshold`，旧结果缺失阈值时才按 sensitivity fallback。
- 改写导致旧匹配消失时，新结果不生成虚假的 match，旧结果仅保留在历史记录中。

- [ ] **Step 4: Implement Store helpers and SQL**

在 `bidProjectStore.cjs` 中：

- 抽出安全 JSON 解析和项目结果组装 helper；
- 新增 `listRecentDuplicateSummaries(projectIds = [])`，使用一次 SQL 查询获得指定项目参与的最新结果，按 `updated_at DESC` 去重保留每个项目一条；
- 新增 `loadLatestDuplicateResult(projectId)`，复用同一套左右两侧查询逻辑，按比较时间 `updated_at DESC` 返回该项目最近一条完整结果或 `null`；
- 扩展 `loadDuplicateResult()` 返回 `leftProject`、`rightProject`、`threshold` 和决策字段；
- 新增 `updateDuplicateMatchDecision({ resultId, matchId, decision, targetSide, rewriteDraft })`，读取整条 JSON、只更新目标 match 后写回 `matches_json`；决策更新只写入 match 内的 `ignoredAt` / `rewrittenAt`，不修改结果行 `updated_at`，确保“最近一次查重”仍按实际比较时间排序；
- 新增 `getDuplicateMatchIdentity({ leftProjectId, rightProjectId, match })`：每侧身份都由项目 ID、节点 ID（缺失时为空）和规范化段落文本组成，再按项目 ID 排序形成 canonical key；不把现有按段落索引生成的 `match.id` 作为唯一依据，确保同一节点下的不同段落仍可区分；
- 新增 `mergeDuplicateMatchDecisions(previousResult, nextResult)`：保存新查重结果时读取同一项目对上一条结果，按 canonical key 继承 `decision`、`rewriteDraft`、时间字段；若左右项目顺序相反，先把旧 `targetSide` 转成目标项目 ID，再映射到新结果的 `left/right`；正文重排但节点 ID不变时仍能继承，匹配消失时不向新结果虚构 match；
- 决策取值限定为 `pending`、`ignored`、`rewritten`，目标方向限定为 `left`、`right`、`none`；
- `saveDuplicateResult()` 接收调用方传入的比较器真实 `threshold`，并与 `sensitivity` 一并写入 `summary_json`，保持当前表结构不变；读取旧结果时若缺少 `threshold`，按 sensitivity 的现有阈值表补齐，仍能打开历史结果。

- [ ] **Step 5: Run Store tests and inspect SQL behavior**

```powershell
cd client
node --test electron/services/bidProjectStore.test.cjs
```

Expected: PASS. 重点确认同一项目作为左右两侧时都只返回最新一条，决策更新不会改变结果的比较时间，旧结果不被删除。

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- client/electron/services/bidProjectStore.cjs client/electron/services/bidProjectStore.test.cjs
git commit -m "feat: persist recent duplicate result decisions"
```

## Task 2: Main 侧 AI 改写服务与 IPC

**Files:**
- Create: `client/electron/services/bidProjectDuplicateRewriteService.cjs`
- Create: `client/electron/services/bidProjectDuplicateRewriteService.test.cjs`
- Modify: `client/electron/ipc/bidProjectIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/features/bid-project/types.ts`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/bid-project/services/bidProjectStorage.ts`
- Create: `client/electron/ipc/bidProjectIpc.test.cjs` - 新增 bid-project IPC handler 转发测试。

- [ ] **Step 1: Define typed rewrite request and write failing service tests**

在 `bidProjectDuplicateRewriteService.test.cjs` 中用 stub `aiService.requestJson()`，验证服务发送：

- system 消息明确目标文本、参考文本、保留事实、不能照搬参考文本；
- user 消息包含左右正文、目标方向和项目名；
- 请求使用 `progressLabel`、`failureMessage`；
- 请求包含 JSON schema 或等价的结构化约束，要求 `rewrittenText`、`reason`、`riskNote`；
- 返回缺字段或空改写正文时抛出可操作错误；
- 正常响应原样规范化为 `BidContentDuplicateRewriteResult`。

- [ ] **Step 2: Run rewrite service test and verify RED**

```powershell
cd client
node --test electron/services/bidProjectDuplicateRewriteService.test.cjs
```

Expected: FAIL because the service and exported request builder do not exist.

- [ ] **Step 3: Implement rewrite service**

在 `bidProjectDuplicateRewriteService.cjs` 中实现：

- `createBidProjectDuplicateRewriteService({ aiService })`；
- `rewriteMatch({ leftProjectName, rightProjectName, leftText, rightText, targetSide, signal })`；
- `targetSide` 为 `left` 时改写左侧，否则改写右侧；
- 另一侧仅作为参考，Prompt 明确“不得复用参考侧句式、连续表达和段落结构”；
- 使用现有 `aiService.requestJson()`，不直接请求 HTTP；
- 只返回结构化草稿，不写正文、不修改查重结果；
- 导出纯 Prompt/响应规范化 helper，方便测试。

- [ ] **Step 4: Add IPC tests for new forwarding handlers**

在 `client/electron/ipc/bidProjectIpc.test.cjs` 中补测试，验证注册后存在：

- `bid-project:recent-duplicate-summaries`
- `bid-project:load-duplicate-result`
- `bid-project:load-latest-duplicate-result`
- `bid-project:rewrite-duplicate-match`
- `bid-project:update-duplicate-match-decision`

并验证 handler 将请求交给 Store/AI service，未在 IPC 层复制业务逻辑。

另外补一个 `bid-project:compare-content` 回归测试：

- 第一次比较保存结果；
- 给其中一个 match 标记 `ignored`；
- 第二次比较同一对项目；
- handler 返回值必须来自 Store 中保存后的结果，包含迁移后的 `decision`，而不是原始 comparator 的裸结果；
- handler 调用 `saveDuplicateResult()` 时必须传入 comparator 返回的真实 `threshold`。

为使该测试可在普通 `node --test` 下运行，先把 `bidProjectIpc.cjs` 的注册函数改为接收可选的 `ipcMain` 依赖：

```js
function registerBidProjectIpc({ ipcMain: ipc = require('electron').ipcMain, ...services }) {
  ipc.handle(...);
}
```

生产入口在 `index.cjs` 继续传入 Electron 的 `ipcMain`；测试传入内存 `handlers` Map 的 `handle()` stub，不 mock 整个 Electron 模块。

- [ ] **Step 5: Register and expose IPC**

在 `bidProjectIpc.cjs`：

- `recent-duplicate-summaries` 调用 Store；
- `load-duplicate-result` 调用 Store；
- `load-latest-duplicate-result` 调用 Store；
- `update-duplicate-match-decision` 调用 Store；
- `compare-content` 在 `saveDuplicateResult()` 时传入 `result.threshold`，保存后立即 `loadDuplicateResult(savedResultId)` 并返回该持久化结果，确保弹窗拿到合并后的决策状态和真实阈值；
- `rewrite-duplicate-match` 先从 Store 加载结果和左右项目，定位 match，再调用 rewrite service；
- AI 改写错误原样抛给 Renderer，由 Toast 展示。

在 `index.cjs`：

- `registerBidProjectIpc()` 接收 `aiService` 和 rewrite service；
- 同时显式传入当前文件顶部导入的 `ipcMain`，保持生产行为不变并满足普通 Node 测试的依赖注入；
- 添加新 IPC 通道到 `workspaceDatabaseChannels`；
- 从 `createBidProjectDuplicateRewriteService({ aiService })` 装配服务。

在 `preload.cjs` 和 `shared/types/ipc.ts` 同步 bridge；在 `bidProjectStorage.ts` 增加对应轻量封装。所有新增接口使用显式 UTF-8 以外不涉及文件读写。

- [ ] **Step 6: Run Main/preload checks**

```powershell
cd client
node --test electron/services/bidProjectDuplicateRewriteService.test.cjs electron/ipc/bidProjectIpc.test.cjs
node --check electron/services/bidProjectDuplicateRewriteService.cjs
node --check electron/ipc/bidProjectIpc.cjs
node --check electron/ipc/index.cjs
node --check electron/preload.cjs
```

Expected: tests PASS and all syntax checks exit 0.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- client/electron/services/bidProjectDuplicateRewriteService.cjs client/electron/services/bidProjectDuplicateRewriteService.test.cjs client/electron/ipc/bidProjectIpc.cjs client/electron/ipc/bidProjectIpc.test.cjs client/electron/ipc/index.cjs client/electron/preload.cjs client/src/features/bid-project/types.ts client/src/shared/types/ipc.ts client/src/features/bid-project/services/bidProjectStorage.ts
git commit -m "feat: add duplicate rewrite IPC"
```

## Task 3: Renderer 选择栏与最近结果摘要

**Files:**
- Create: `client/src/features/bid-project/components/BidProjectCompareBar.tsx`
- Modify: `client/src/features/bid-project/components/BidProjectRow.tsx`
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/styles/feature-bid-project.css`
- Create: `client/src/features/bid-project/services/duplicateRewriteUi.ts`
- Create: `client/src/features/bid-project/services/duplicateRewriteUi.test.ts`

- [ ] **Step 1: Add failing source-level tests for manual comparison flow**

在 `duplicateRewriteUi.test.ts` 中先写纯 helper 的失败测试，并在同一文件中用源码读取断言列表页接线：

- `BidProjectWorkspacePage.tsx` 不再包含根据同源分组自动调用 `runCompare()` 的 effect；
- 存在“开始对比”文案；
- 选择两份项目后只更新选择状态，不直接调用比较 API；
- `BidProjectRow` 有“查看查重结果”入口；
- 最近结果加载调用 `bidProjectStorage.listRecentDuplicateSummaries()`。
- helper 在 `left/right` 两个目标方向下返回正确的目标项目 ID、节点 ID、旧文本；
- 空草稿不可提交，最近结果最高相似度按百分比格式化。

- [ ] **Step 2: Implement typed selection helpers and compare bar**

先创建 `duplicateRewriteUi.ts`，提供 `getRewriteTarget(match, targetSide, leftProjectId, rightProjectId)`、`canConfirmRewrite(draft)`、`formatDuplicateSummary(summary)` 和 `buildIgnoredDecisionPatch()` 四个纯函数；组件和后续结果弹窗都复用这些函数。

在 `BidProjectCompareBar.tsx`：

- 接收两份 `BidProject`、灵敏度、加载状态和回调；
- 显示左右项目名，长名称可换行；
- 提供“交换左右”“取消选择”“开始对比”；
- 未选择两份时不渲染；选择一份时渲染等待第二份的提示；
- “开始对比”只在两份项目存在且未加载时可点击。

在页面中：

- 保留 `compareSelection`，选择第二份时不触发 `runCompare()`；
- 由显式按钮回调调用 `runCompare()`；
- 删除 `autoComparedGroups` 和自动查重 effect；
- 查重成功后刷新 `recentDuplicateSummaries`。

- [ ] **Step 3: Add recent summary to each project row**

扩展 `BidProjectRow` props：

- `duplicateSummary?: BidProjectDuplicateSummary | null`
- `onViewDuplicateResult?: (project: BidProject) => void`

显示最近对比对象、重复组数、最高相似度和更新时间；没有结果时按钮禁用并提供 `title="暂无查重结果"`。查看按钮不能触发打开项目、重命名或删除。

- [ ] **Step 4: Load summaries once per visible project list**

在 `BidProjectWorkspacePage.tsx` 的项目加载成功后，用当前项目 ID 集合调用一次 `listRecentDuplicateSummaries()`，保存为 `Record<string, ...>`。筛选、搜索或删除后重新加载并清理不存在项目的摘要。

- [ ] **Step 5: Run Renderer build and focused tests**

```powershell
cd client
node --test src/features/bid-project/services/duplicateRewriteUi.test.ts
npm run build
```

Expected: focused tests PASS and build exits 0。

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- client/src/features/bid-project/components/BidProjectCompareBar.tsx client/src/features/bid-project/components/BidProjectRow.tsx client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx client/src/styles/feature-bid-project.css client/src/features/bid-project/services/duplicateRewriteUi.ts client/src/features/bid-project/services/duplicateRewriteUi.test.ts
git commit -m "feat: add manual duplicate comparison flow"
```

## Task 4: 宽屏结果弹窗与逐组处理

**Files:**
- Create: `client/src/features/bid-project/components/BidProjectDuplicateResultDialog.tsx`
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/styles/feature-bid-project.css`
- Modify: `client/src/features/bid-project/types.ts`
- Test: `client/src/features/bid-project/services/duplicateRewriteUi.test.ts`

- [ ] **Step 1: Write failing UI helper tests**

覆盖：

- 目标方向为 `left` 时目标文本、目标项目和节点 ID 取左侧；
- 目标方向为 `right` 时取右侧；
- 草稿为空时不能确认替换；
- “无需改写”决策映射为 `decision: ignored`、`targetSide: none`；
- 最近结果摘要中最高相似度按百分比显示。
- 目标项目、旧文本和节点 ID 由同一纯 helper 统一返回，避免左右方向在组件内分叉。

- [ ] **Step 2: Implement result dialog props and layout**

`BidProjectDuplicateResultDialog` 接收：

- `open`、`result`、`leftProject`、`rightProject`；
- `onOpenChange`、`onRefresh`；
- `onReplaceContent`、`onToast` 等回调或直接接收 `window.yibiao` bridge。

使用 `AppDialog` 的 `cardClassName="bid-project-duplicate-dialog-card"`：

- 宽度 `min(1120px, calc(100vw - 48px))`；
- 最大高度 `calc(100vh - 48px)`；
- 标题和描述区域允许换行；
- 结果区域独立滚动；
- 左右文本在窄屏下改为单列；
- 底部关闭操作固定显示。

- [ ] **Step 3: Implement per-match target selection and AI rewrite**

每组 match 提供：

- 目标选择下拉：改写左侧文件/改写右侧文件；
- “AI 改写”按钮；
- AI 草稿编辑框；
- “确认替换”按钮；
- “无需改写”按钮。

Renderer 状态按 `match.id` 保存：

- `rewriteTargetSide`
- `rewriteDraft`
- `rewriteLoading`
- `rewriteError`

点击 AI 改写调用 `bidProjectStorage.rewriteDuplicateMatch()`；返回后只更新当前草稿。AI 失败不关闭弹窗。

- [ ] **Step 4: Implement confirm replacement and ignored decision**

确认替换时：

- 检查草稿非空；
- 根据目标方向选择项目 ID、节点 ID 和旧文本；
- 调用现有 `window.yibiao.bidProject.replaceContent()`；
- 成功后调用 `updateDuplicateMatchDecision({ decision: 'rewritten', targetSide, rewriteDraft })`；
- 重新调用当前两项目的 `compareContent()`，刷新弹窗与列表最近摘要；
- `compareContent()` 保存新结果时由 Store 合并上一条结果的 match 决策；Renderer 不复制决策迁移规则；
- 失败时保留草稿，并提示原正文可能已变化。

点击“无需改写”时：

- 调用 `updateDuplicateMatchDecision({ decision: 'ignored', targetSide: 'none' })`；
- 通过 `duplicateRewriteUi.ts` 的 `buildIgnoredDecisionPatch()` 生成统一的决策 patch；
- 当前组立即显示“已标记无需改写”；
- 不修改任何正文；
- 弹窗重新打开时从持久化 match 状态恢复。

- [ ] **Step 5: Fix CSS overflow and responsive behavior**

在 `feature-bid-project.css`：

- 将弹窗内容 `min-width` 改为受 viewport 限制的宽度，不再用 `min-width: min(820px, 80vw)` 造成小窗口溢出；
- 设置结果列表 `min-height: 0; overflow: auto`；
- 设置 match 文本 `overflow-wrap: anywhere; white-space: pre-wrap`；
- 操作区在窄屏下改为网格或单列；
- 结果标题和文件名允许换行，不使用 `white-space: nowrap`；
- 保持页面根容器和 AppDialog 既有滚动边界。

- [ ] **Step 6: Run focused test and build**

```powershell
cd client
node --test src/features/bid-project/services/duplicateRewriteUi.test.ts
npm run build
```

Expected: tests PASS and build exits 0。

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- client/src/features/bid-project/components/BidProjectDuplicateResultDialog.tsx client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx client/src/styles/feature-bid-project.css client/src/features/bid-project/types.ts client/src/features/bid-project/services/duplicateRewriteUi.ts client/src/features/bid-project/services/duplicateRewriteUi.test.ts
git commit -m "feat: add duplicate result dialog and ai rewrite"
```

## Task 5: End-to-end verification and manual smoke

**Files:**
- No planned code changes unless verification exposes a defect.

- [ ] **Step 1: Run focused Main tests**

```powershell
cd client
node --test electron/services/bidProjectStore.test.cjs electron/services/bidProjectDuplicateRewriteService.test.cjs electron/ipc/bidProjectIpc.test.cjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run syntax checks**

```powershell
cd client
node --check electron/services/bidProjectStore.cjs
node --check electron/services/bidProjectDuplicateRewriteService.cjs
node --check electron/ipc/bidProjectIpc.cjs
node --check electron/ipc/index.cjs
node --check electron/preload.cjs
```

Expected: all commands exit 0.

- [ ] **Step 3: Run client build**

```powershell
cd client
npm run build
```

Expected: exit 0. Existing chunk-size warnings are acceptable.

- [ ] **Step 4: Run native smoke**

```powershell
cd client
npm run smoke:electron-native
```

Expected: exit 0. If Electron/native startup is blocked by the environment, record the exact error.

- [ ] **Step 5: Manual smoke in the Electron client**

```powershell
cd client
npm run dev
```

Verify:

- 返回或进入“我的标书”列表页不自动弹出查重结果；
- 选择一份项目时只显示等待第二份；
- 选择第二份后显示左右项目和“开始对比”，没有自动开始；
- 点击“开始对比”后完成查重并打开宽屏结果弹窗；
- 长项目名和长正文完整换行，弹窗结果区内部滚动，关闭按钮始终可见；
- 列表每个项目显示最近结果摘要；
- 点击“查看查重结果”读取已保存结果，不重复执行比较；
- 同一对项目不改正文时连续比较两次，确认第二次结果仍保留上一条的“无需改写/已改写”状态；
- 确认改写后该匹配完全消失时，刷新后的弹窗显示新的重复组数量，不生成空白或虚假结果；
- 每组可选择左侧或右侧并单独执行 AI 改写；
- AI 草稿可手动修改，未点击确认不会改变正文；
- “无需改写”关闭并重新打开结果后仍显示；
- 确认替换后右侧或左侧目标正文被正确替换，重新查重后结果刷新。

- [ ] **Step 6: Review final working tree**

```powershell
git status --short
```

确认只包含本次功能文件和已有的用户改动，不暂存 `.superpowers/brainstorm/` 或其他无关文件。

