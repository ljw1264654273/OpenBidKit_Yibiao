# 同源第二份标书差异化生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从已完成技术方案一键创建同源第二份标书，重新生成目录，并在正文后自动运行现有查重算法和 AI 改写闭环，只有零命中时完成。

**Architecture:** 在 `bid_projects` 保存派生关系和查重状态；TechnicalPlan Store 提供受控的招标/分析种子复制与正文变更失效回调。独立的派生服务创建项目，独立的受管查重任务负责首次自动检查和人工重试；目录 Agent 只接收来源目录作为差异化约束，最终验收继续由现有本地查重算法决定。

**Tech Stack:** Electron CommonJS Main/preload、React + TypeScript Renderer、better-sqlite3、Node test runner、现有 Agent/AI/Task Service。

---

### Task 1: 派生关系、查重状态和正文指纹

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/bidProjectStore.cjs`
- Modify: `client/electron/services/bidProjectStore.test.cjs`
- Modify: `client/electron/services/bidProjectManager.cjs`
- Modify: `client/src/features/bid-project/types.ts`

- [ ] **Step 1: 写失败测试**

在 `bidProjectStore.test.cjs` 增加测试，期望 `createProject()` 能保存 `derivedFromProjectId`，`updateProject()` 能原子保存 uniqueness 字段和状态，删除来源项目后派生项目保留但变为 `incomplete/failed`，并提供正文指纹一致性判定。

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd client; node --test electron/services/bidProjectStore.test.cjs`
Expected: 新字段/方法不存在导致断言失败。

- [ ] **Step 3: 实现 migration 和 Store API**

新增 v34 migration，为 `bid_projects` 增加：

```sql
derived_from_project_id TEXT,
uniqueness_status TEXT NOT NULL DEFAULT 'none',
uniqueness_result_id TEXT,
uniqueness_attempts INTEGER NOT NULL DEFAULT 0,
uniqueness_auto_run_requested INTEGER NOT NULL DEFAULT 0
```

Store 新增规范化、字段映射、`listPendingAutomaticUniquenessProjects()` 和 `validateProjectUniqueness(projectId, contentFingerprints)`。删除来源项目前先失效直接派生项目，不建立外键。Manager 的 `listProjects()` / `getProject()` / `openProject()` 在返回派生项目之前读取两侧 TechnicalPlan Store 指纹并调用该校验；陈旧 passed 结果在读侧原子降级为 `pending/incomplete`，保证列表筛选和“重新查重”入口与导出门禁一致。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd client; node --test electron/services/bidProjectStore.test.cjs`
Expected: PASS。

### Task 2: 招标与分析种子复制及派生项目创建

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Create: `client/electron/services/bidProjectVariantService.cjs`
- Create: `client/electron/services/bidProjectVariantService.test.cjs`
- Modify: `client/electron/services/bidProjectManager.cjs`

- [ ] **Step 1: 写失败测试**

覆盖：仅允许已完成普通技术方案；新项目同源且引用来源；复制招标 Markdown、标段和成功分析结果；不复制目录、事实、正文和任务；复制失败删除半成品项目；正文修改回调把派生项目改为 `pending/incomplete`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd client; node --test electron/services/bidProjectVariantService.test.cjs`
Expected: 模块不存在或 API 不存在。

- [ ] **Step 3: 实现 Store 种子接口与创建服务**

TechnicalPlan Store 增加内部 `exportVariantSeed()` / `importVariantSeed()`：复制完整/工作招标 Markdown、逐文件 Markdown、可用 Word 原件、标段选择、招标分析配置和成功结果，导入后固定从 `outline-generation` 开始。Manager 创建项目 Store 时注入 `onContentChanged`，只对派生项目失效 uniqueness。

Variant Service 实现：

```js
async function createVariantProject(sourceProjectId) { /* create, seed, rollback */ }
function getVariantBaselineOutline(projectId) { /* source outline without content */ }
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd client; node --test electron/services/bidProjectVariantService.test.cjs`
Expected: PASS。

### Task 3: 目录差异化约束

**Files:**
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Modify: `client/electron/services/outlineGenerationTaskV2.test.cjs`
- Modify: `client/electron/services/taskService.cjs`

- [ ] **Step 1: 写失败测试**

派生项目启动目录任务时应向 Agent 文件加入 `第一份标书目录.json`，提示必须重新规划非固定结构；普通项目不含该文件和规则；评分原文、固定映射标题优先级不变。

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs`
Expected: 找不到差异化文件或规则。

- [ ] **Step 3: 实现最小注入**

Task Service 在启动目录任务时从 Variant Service 读取来源目录并写入 payload；目录任务把无正文目录 JSON 加入初始/子目录/审核 Agent 文件，并在相应 prompt 中加入差异化约束。不得改变普通项目 payload。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs`
Expected: PASS。

### Task 4: 自动查重改写受管任务

**Files:**
- Create: `client/electron/services/bidProjectVariantDeduplicationTask.cjs`
- Create: `client/electron/services/bidProjectVariantDeduplicationTask.test.cjs`
- Create: `client/electron/services/taskService.variantDeduplication.test.cjs`
- Modify: `client/electron/services/bidProjectDuplicateRewriteService.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/src/features/technical-plan/types.ts`

- [ ] **Step 1: 写失败测试**

覆盖：首轮零命中通过；命中后只改派生侧并复检通过；同一节点多段合并保存；保护数字/百分比/日期/书名号名称；五轮后失败；取消回落 pending；保存两侧正文指纹；来源正文变化使旧结果失效。

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd client; node --test electron/services/bidProjectVariantDeduplicationTask.test.cjs`
Expected: 模块不存在或行为缺失。

- [ ] **Step 3: 实现任务 runner**

复用 `compareBidContents()` 和 `createBidProjectDuplicateRewriteService()`，实现 `readProjectParagraphs()`、稳定正文指纹、按节点批量 patch、最多五轮循环和每轮完整复检。结果保存到现有 duplicate result 表，summary 携带两侧指纹。TechnicalPlan Store 增加 `variantDeduplicationTask` 映射。

- [ ] **Step 4: 接入 Task Service 自动调度和恢复**

新增 `variant-deduplication` 技术方案受管任务。派生项目全量正文开始时设置 auto-run 标记；正文成功释放锁后自动启动；启动成功清标记；启动恢复只补调度带标记且正文成功的项目；失败、取消和成功分别更新项目状态机。

- [ ] **Step 5: 写并运行 Task Service 状态机测试**

`taskService.variantDeduplication.test.cjs` 覆盖：全量正文开始设置标记、成功且锁释放后只启动一次、启动成功清标记、启动时崩溃窗口由恢复补调度、普通 pending 不补调度、查重中断变为可重试失败、主动取消与手工编辑清标记并回落 pending/incomplete。

Run: `cd client; node --test electron/services/taskService.variantDeduplication.test.cjs`
Expected: PASS。

- [ ] **Step 6: 运行测试确认 GREEN**

Run: `cd client; node --test electron/services/bidProjectVariantDeduplicationTask.test.cjs electron/services/taskService*.test.cjs`
Expected: PASS。

### Task 5: IPC、导出门禁和项目列表交互

**Files:**
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/ipc/bidProjectIpc.cjs`
- Modify: `client/electron/ipc/taskIpc.cjs`
- Create: `client/electron/ipc/bidProjectIpc.test.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/bid-project/services/bidProjectStorage.ts`
- Modify: `client/src/features/bid-project/components/BidProjectRow.tsx`
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/features/bid-project/services/duplicateRewriteUi.test.ts`

- [ ] **Step 1: 写失败测试**

静态/行为测试覆盖：“再生成一份”仅对已完成普通技术方案开放；创建后打开新项目；pending/failed 派生项目有“重新查重”；查重中禁用相关命令；Main 导出对缺少 passed、关系不符、指纹不符和非零命中全部阻断。

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd client; node --test src/features/bid-project/services/duplicateRewriteUi.test.ts`
Expected: 新入口和状态展示断言失败。

- [ ] **Step 3: 实现 IPC 和 Renderer**

新增 `bid-project:create-variant` bridge，并在现有 `taskIpc.cjs` 注册 `tasks:start-variant-deduplication`。项目行增加文本命令与状态说明；页面复用 Toast 和 AppDialog 确认创建。导出 IPC 调用 Manager 的读侧刷新和项目 Store 的最新结果/指纹门禁，普通项目不受影响。`bidProjectIpc.test.cjs` 直接调用注册的 export handler，验证缺少 passed、关系不符、指纹不符、非零命中被阻断，合法派生项目和普通项目可继续进入导出服务。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd client; node --test src/features/bid-project/services/duplicateRewriteUi.test.ts electron/ipc/bidProjectIpc.test.cjs electron/services/bidProjectVariantService.test.cjs electron/services/bidProjectVariantDeduplicationTask.test.cjs electron/services/taskService.variantDeduplication.test.cjs`
Expected: PASS。

### Task 6: 完整验证与审查

**Files:**
- Verify all modified files.

- [ ] **Step 1: 语法检查**

Run: `cd client; node --check electron/services/sqliteDatabase.cjs; node --check electron/services/bidProjectStore.cjs; node --check electron/services/bidProjectManager.cjs; node --check electron/services/technicalPlanStore.cjs; node --check electron/services/bidProjectVariantService.cjs; node --check electron/services/bidProjectVariantDeduplicationTask.cjs; node --check electron/services/bidProjectDuplicateRewriteService.cjs; node --check electron/services/outlineGenerationTaskV2.cjs; node --check electron/services/taskService.cjs; node --check electron/ipc/index.cjs; node --check electron/ipc/bidProjectIpc.cjs; node --check electron/ipc/taskIpc.cjs; node --check electron/preload.cjs`
Expected: 全部退出码 0。

- [ ] **Step 2: 定向测试**

Run: `cd client; node --test electron/services/bidProjectStore.test.cjs electron/services/bidProjectVariantService.test.cjs electron/services/bidProjectVariantDeduplicationTask.test.cjs electron/services/taskService.variantDeduplication.test.cjs electron/ipc/bidProjectIpc.test.cjs electron/services/bidContentDuplicateService.test.cjs electron/services/bidProjectDuplicateRewriteService.test.cjs electron/services/outlineGenerationTaskV2.test.cjs src/features/bid-project/services/duplicateRewriteUi.test.ts`
Expected: 0 failures。

- [ ] **Step 3: Native smoke 与客户端构建**

Run: `cd client; npm run smoke:electron-native; npm run build`
Expected: 两个命令退出码 0；允许既有 chunk 体积警告。

- [ ] **Step 4: 独立代码审查**

审查重点：来源项目是否始终只读、普通项目行为是否保持不变、指纹与状态机是否能阻止陈旧结果导出、自动调度标记是否只覆盖崩溃窗口。

- [ ] **Step 5: Electron 手动链路验证**

Run: `cd client; npm run dev`

在开发客户端中验证：已完成普通技术方案显示“再生成一份”；创建后新项目直接进入目录阶段且来源目录/正文未复制；正文成功后自动进入查重状态；查重失败/取消后可重新查重；重启后只补调度带 auto-run 标记的项目；通过后可导出，编辑正文后立即失效并阻止导出。若本机模型配置不足以完成真实 AI 生成，至少通过测试夹具覆盖查重任务，并手动验证窗口、IPC、状态展示、按钮禁用和导出阻断。
