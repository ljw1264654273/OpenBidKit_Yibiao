# 技术方案图片模式与统一审核弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为技术方案 STEP 01 增加四种图片预设，并将 STEP 05 的 Mermaid 审核升级为支持 AI 配图、流程图和 PPT 图的 B 方案统一审核与 AI 重绘流程。

**Architecture:** 保留现有 `kind: ai/mermaid/html`、旧图片数量字段和 Mermaid IPC 作为兼容层；新增图片预设的持久化语义、通用审核状态和重绘候选字段。图片重绘任务继续由 Main 的 `taskService`/`contentGenerationTask.cjs` 管理，Renderer 只负责展示、交互和 bridge 调用；候选资源与正文当前资源分离，用户采用候选时由 Main Store 在同一事务中更新图片计划和正文。

**Tech Stack:** Electron CommonJS Main/preload、React + TypeScript Renderer、SQLite/better-sqlite3、现有 `aiService.cjs` 文本/生图队列、Radix Dialog、全局 CSS、Node `node:test`。

---

## 文件地图

### 新增

- `client/src/features/technical-plan/services/imageConfig.ts`
  - 四种图片模式、规范值、持久化归一化、预设推导和运行时值转换。
- `client/src/features/technical-plan/services/imageConfig.test.ts`
  - 图片模式映射、自定义判定、历史配置和运行值截断测试。
- `client/electron/services/contentIllustrationReview.cjs`
  - 通用图片审核状态、候选资源校验、正文图片块采用候选的纯 Main 业务逻辑。
- `client/electron/services/contentIllustrationReview.test.cjs`
  - AI/流程图/PPT 图审核与候选采用的 Store/正文更新测试。

### 修改

- `client/src/features/technical-plan/types.ts`
- `client/src/features/technical-plan/services/quickConfig.ts`
- `client/src/features/technical-plan/services/quickConfig.test.ts`
- `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
- `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- `client/src/features/technical-plan/services/workflowLayout.test.ts`
- `client/src/styles/feature-technical-plan.css`
- `client/src/shared/types/ipc.ts`
- `client/electron/preload.cjs`
- `client/electron/ipc/technicalPlanIpc.cjs`
- `client/electron/ipc/technicalPlanIpc.ai-mermaid.test.cjs`
- `client/electron/services/technicalPlanStore.cjs`
- `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`
- `client/electron/services/storageCleanupService.cjs`
- `client/electron/services/sqliteDatabase.cjs`
- `client/electron/services/contentIllustrationGeneration.cjs`
- `client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`
- `client/electron/services/contentGenerationTask.cjs`
- `client/electron/services/contentGenerationTask.mermaidRedraw.test.cjs`
- `client/electron/services/taskService.cjs`
- `client/electron/ipc/index.cjs`
- `sql/workspace_schema.sql`
- `client/src/features/developer/pages/DeveloperDemoPage.tsx`

不修改 Analytics Worker/Dashboard 协议；仅在确实有用户可见旧文案的地方同步改名，内部统计字段保持兼容。

## Task 1: 建立图片模式领域模型和持久化归一化

**Files:**
- Create: `client/src/features/technical-plan/services/imageConfig.ts`
- Test: `client/src/features/technical-plan/services/imageConfig.test.ts`
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/technical-plan/services/quickConfig.ts`
- Modify: `client/src/features/technical-plan/services/quickConfig.test.ts`

- [ ] **Step 1: 写失败测试**
  - 覆盖 `enhanced/rich/basic/text-only` 到旧字段的规范值映射：
    - enhanced: AI 10、流程图 8、PPT 8；
    - rich: 三类各 3；
    - basic: 只开流程图，上限 5；
    - text-only: 三类关闭且上限 0。
  - 覆盖规范值不因叶子数量不足或图片模型不可用而变成 `custom`。
  - 覆盖历史配置没有 `imagePreset` 时只能精确匹配，无法确认时为 `custom`。
  - 覆盖运行时归一化单独截断数量，并在图片模型不可用时只禁用本次 AI 运行值。
  - 覆盖修改开关、数量、`htmlImageTypes` 后推导 `custom`。
- [ ] **Step 2: 运行测试确认失败**
  - Run: `cd client; node --test src/features/technical-plan/services/imageConfig.test.ts`
  - Expected: FAIL，因为图片模式模块尚不存在。
- [ ] **Step 3: 实现图片配置模块**
  - 在 `imageConfig.ts` 定义 `ContentImagePreset`、预设标签、规范默认值和纯函数：
    - `getImagePresetDefinition()`
    - `applyImagePreset()`
    - `inferImagePreset()`
    - `normalizePersistedContentGenerationOptions()`
    - `normalizeRuntimeContentGenerationOptions()`
    - `isImageOptionChanged()`
  - `htmlImageTypes` 使用现有默认类型列表；不要复制第二套图片类型解析规则到 Main。
  - 在 `ContentGenerationOptions` 增加可选 `imagePreset`，保留 `useAiRedesignForMermaid`，明确该字段不参与新预设判定。
- [ ] **Step 4: 接入快速配置服务**
  - 让 `quickConfig.ts` 复用新模块，不再由 `resolveContentGenerationOptionsForQuickConfig()` 直接把图片模型可用性写回持久化选项。
  - 保留旧字段作为实际任务输入，预设只作为持久化和 UI 回显语义。
- [ ] **Step 5: 运行测试确认通过**
  - Run: `cd client; node --test src/features/technical-plan/services/imageConfig.test.ts src/features/technical-plan/services/quickConfig.test.ts`
  - Expected: PASS。
- [ ] **Step 6: 提交**
  - Run:
    ```powershell
    git add client/src/features/technical-plan/services/imageConfig.ts client/src/features/technical-plan/services/imageConfig.test.ts client/src/features/technical-plan/types.ts client/src/features/technical-plan/services/quickConfig.ts client/src/features/technical-plan/services/quickConfig.test.ts
    git commit -m "feat: add technical plan image presets"
    ```

## Task 2: STEP 01 预设 UI 和 STEP 05 配置回写

**Files:**
- Modify: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: 写失败的页面源测试**
  - STEP 01 图片设置只出现四个预设按钮，不再出现三个独立开关。
  - 摘要显示“增强图文/丰富图文/基础配图/纯文字/自定义”。
  - STEP 05 配置弹窗改用“AI 配图/流程图/PPT 图”文案。
  - STEP 05 修改任一图片开关、数量或 PPT 类型后会保存为 `custom`。
- [ ] **Step 2: 替换 STEP 01 快速配置**
  - 在 `DocumentAnalysisPage.tsx` 使用图片模式选择器。
  - 选择预设时通过 `applyImagePreset()` 写入规范值并保存 `imagePreset`。
  - AI 图片模型不可用时不把预设变为 `custom`；可以保留现有不可用提示。
  - 快速配置摘要和完成度检查使用预设字段/推导结果。
- [ ] **Step 3: 调整 STEP 05 正文配置**
  - 在 `ContentEditPage.tsx` 读取持久化配置时使用持久化归一化；启动任务前使用运行时归一化。
  - 三类旧字段仍保留在发送给 Main 的 `generationOptions` 中。
  - 保存前根据原始值推导 `imagePreset`，不要用按叶子数量截断后的运行值推导。
  - 将 `使用 Mermaid 生图`、`Mermaid 流程图先审核`、`生成 HTML 图片`、`HTML 生图上限` 等用户文案改为流程图/PPT 图。
- [ ] **Step 4: 更新样式和页面测试**
  - 预设选择使用现有快速配置 pill/segment 样式。
  - 保持页面根容器和内部滚动约束，不为浮动工具条增加额外空白。
- [ ] **Step 5: 运行测试**
  - Run: `cd client; node --test src/features/technical-plan/services/quickConfig.test.ts src/features/technical-plan/services/workflowLayout.test.ts`
  - Expected: PASS。
- [ ] **Step 6: 提交**
  - Run: `git add client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx client/src/features/technical-plan/pages/ContentEditPage.tsx client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/workflowLayout.test.ts; git commit -m "feat: add image mode quick configuration"`

## Task 3: 扩展 SQLite 图片项和 Store 状态

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`
- Modify: `client/electron/services/storageCleanupService.cjs`

- [ ] **Step 1: 写失败的 native 持久化测试**
  - 验证 `redraw_status`、`redraw_asset_url`、`redraw_source_path`、`redraw_error`、`redraw_attempts`、`redraw_updated_at` 可写入、重启后可读。
  - 验证全局兼容表、新建项目专属图片项表、以及已存在的旧 `technical_plan_project_*_illustration_items` 表都存在候选字段。
  - 构造旧项目表升级夹具：先创建不含候选字段的 `technical_plan_project_<id>_illustration_items`，再运行数据库初始化/migration，断言旧表补列且原数据保留。
  - 验证已有 Mermaid 记录仍按旧字段加载。
- [ ] **Step 2: 运行定向测试确认失败**
  - Run: `cd client; node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`
  - Expected: FAIL，因为候选字段和 migration 尚未实现。
- [ ] **Step 3: 更新 schema 和 migration**
  - 在全局 `technical_plan_illustration_items` 和 `createTechnicalPlanProjectSchema()` 的项目专属图片项表增加同一组字段。
  - `addTechnicalPlanMermaidReviewState()` 扩展为候选字段 migration，使用 `addColumnIfMissing()`，并作为一次明确的 schema/migration version 增量记录。
  - 迁移时枚举 `sqlite_master` 中所有匹配 `technical_plan_project_%_illustration_items` 的既有项目专属表，对每张表补齐候选字段；不要只依赖 `CREATE TABLE IF NOT EXISTS`。
  - 同步 `sql/workspace_schema.sql`。
- [ ] **Step 4: 更新 Store 读写和清理**
  - `illustrationItemValues()`、upsert、load 映射读写候选字段。
  - 资源保留/清理同时考虑当前资源和候选资源。
  - 同步更新 `storageCleanupService.cjs` 的全局资源清理查询，保留并清理 `asset_url`、`redraw_asset_url`、`source_path`、`redraw_source_path` 涉及的文件引用。
  - 保留旧 `saveMermaidReviewCode`、`confirmMermaidReviewItem`、`skipMermaidReviewItem` 行为。
  - 新增通用图片审核 Store 方法：保存草稿、确认、跳过、候选状态更新、采用候选。
  - 采用候选使用一个 `db.transaction()`，同时校验正文图片块、更新正文权威内容和图片项状态；校验失败整体回滚。
  - 将候选采用的正文图片块替换规则拆到 `contentIllustrationReview.cjs` 可单测纯函数中，Store 事务只负责读取、调用纯函数和落库。
- [ ] **Step 5: 运行 native 测试**
  - Run: `cd client; node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`
  - Expected: PASS。
- [ ] **Step 6: 提交**
  - Run: `git add client/electron/services/sqliteDatabase.cjs sql/workspace_schema.sql client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs; git commit -m "feat: persist illustration redraw candidates"`

## Task 4: 通用图片审核 IPC 和兼容包装

**Files:**
- Create: `client/electron/services/contentIllustrationReview.cjs`
- Test: `client/electron/services/contentIllustrationReview.test.cjs`
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/technicalPlanIpc.ai-mermaid.test.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`

- [ ] **Step 1: 写 IPC/业务失败测试**
  - 三类图片都可以读取统一审核上下文。
  - 流程图仍支持代码预览/保存/AI 调整。
  - AI/PPT 图支持保存调整要求和参考图片元数据。
  - 旧 Mermaid IPC 继续只接受 Mermaid 项并返回兼容 patch。
  - 采用候选的返回 patch 同时包含图片计划和正文变化。
- [ ] **Step 2: 实现通用审核服务**
  - 将图片类型标签、状态读取、候选有效性和正文图片块替换集中在 `contentIllustrationReview.cjs`。
  - 实现按 `itemId` 查找、当前资源/候选资源校验和 `review_status` 状态流转。
  - 流程图代码被再次修改时清空候选并重置待确认。
- [ ] **Step 3: 增加 IPC bridge**
  - 新增通用 preview/save/adjust/confirm/skip/adopt 通道。
  - 旧 Mermaid 通道保留并调用原有 Store 方法或通用服务包装。
  - 在 `client/electron/ipc/index.cjs` 的 `workspaceDatabaseChannels` 中登记新增通用审核通道，确保数据库 pending/unavailable 阶段行为与旧通道一致。
  - preload 只注册/转发，Renderer 类型在 `src/shared/types/ipc.ts` 同步。
- [ ] **Step 4: 运行测试**
  - Run: `cd client; node --test electron/services/contentIllustrationReview.test.cjs electron/ipc/technicalPlanIpc.ai-mermaid.test.cjs`
  - Expected: PASS。
- [ ] **Step 5: 静态检查**
  - Run: `cd client; node --check electron/preload.cjs; node --check electron/ipc/technicalPlanIpc.cjs; node --check electron/services/contentIllustrationReview.cjs`
  - Expected: all commands exit 0。
- [ ] **Step 6: 提交**
  - Run: `git add client/electron/services/contentIllustrationReview.cjs client/electron/services/contentIllustrationReview.test.cjs client/electron/ipc/technicalPlanIpc.cjs client/electron/ipc/technicalPlanIpc.ai-mermaid.test.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts; git commit -m "feat: add unified illustration review bridge"`

## Task 5: 三类图片重绘生成和候选资源

**Files:**
- Modify: `client/electron/services/contentIllustrationGeneration.cjs`
- Modify: `client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Modify: `client/electron/services/contentGenerationTask.mermaidRedraw.test.cjs`
- Modify: `client/src/features/technical-plan/types.ts`

- [ ] **Step 1: 写失败的生成测试**
  - AI 配图重绘返回独立候选 URL，不覆盖 `asset_url`。
  - 流程图使用确认后的 Mermaid code 调用生图模型，候选 URL 独立保存。
  - PPT 图必须读取原 `source_path`，文本模型生成 HTML 后本地转 PNG；源文件缺失直接进入 `redraw_status=error`。
  - 候选生成成功/失败都能 checkpoint，即使流程图的 `generation.status` 仍为 `pending`。
  - 覆盖单图目标只处理指定 `illustrationItemId`，批量目标只处理启动时锁定的目标集合且不会因后续新增确认项扩大。
  - 覆盖暂停时当前运行项不写入 processed，恢复后该项可重试；已失败并记录到 processed 的项目不会在 resume 时自动重试。
  - 覆盖重绘任务终态仅由候选目标计算：全部成功为 `success`，任一目标 terminal error 后为 `error`，暂停为 `paused`，不受正文小节 `generation.status` 影响。
- [ ] **Step 2: 实现三类重绘函数**
  - 抽取按 `kind` 分派的 redraw execution。
  - AI 配图复用 `buildAiImagePrompt()` 的事实约束，并增加原图/调整要求上下文。
  - 流程图复用现有 Mermaid AI 重绘逻辑，但输出写到候选字段。
  - PPT 图复用 HTML 布局质检和本地截图流程，新增候选路径，不覆盖首轮 HTML/PNG。
- [ ] **Step 3: 扩展任务目标和运行时**
  - 支持批量目标 ID、单图目标 ID、全部确认/跳过前置条件。
  - 明确新旧入口边界：旧 `redrawConfirmedMermaidIllustrations` 仍只走历史 Mermaid 显式重绘路径；新增 `redrawConfirmedIllustrations` / `illustrationItemIds` 才进入三类图片候选重绘流程。
  - 在 `contentGenerationRuntime` 持久化 redraw mode、target IDs、processed IDs、phase。
  - 同步扩展 Renderer 类型：`ContentIllustrationPlanItem.generation` 增加 `redraw_status`、`redraw_asset_url`、`redraw_source_path`、`redraw_error`、`redraw_attempts`、`redraw_updated_at`；`ContentGenerationRuntimeState` 增加 `illustration_redraw_mode`、`illustration_redraw_item_ids`、`illustration_redraw_processed_item_ids`、`illustration_redraw_phase`。
  - 继续使用现有任务组互斥、队列 scope、pause/resume；不新增独立 cancel UI。
  - 重绘专用运行以候选成功/失败计算最终任务状态，不使用正文未解决小节状态。
- [ ] **Step 4: 修正插入和计划重放**
  - 所有应用图片计划的路径排除 `review_status=skipped`。
  - 候选成功不得被 `applyGeneratedIllustrationsToDocument()` 当作当前正文资源插入。
- [ ] **Step 5: 运行测试**
  - Run:
    ```powershell
    cd client
    node --test electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs electron/services/contentGenerationTask.mermaidRedraw.test.cjs
    ```
  - Expected: PASS。
- [ ] **Step 6: 提交**
  - Run: `git add client/electron/services/contentIllustrationGeneration.cjs client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs client/electron/services/contentGenerationTask.cjs client/electron/services/contentGenerationTask.mermaidRedraw.test.cjs client/src/features/technical-plan/types.ts; git commit -m "feat: generate illustration redraw candidates"`

## Task 6: 统一审核弹窗和 B 方案 Renderer

**Files:**
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/styles/feature-technical-plan.css`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Modify: `client/src/features/developer/pages/DeveloperDemoPage.tsx`

- [ ] **Step 1: 写失败的 UI 源测试**
  - 审核列表不再只筛选 `kind === 'mermaid'`。
  - 三类图片显示“AI 配图/流程图/PPT 图”。
  - B 方案结构包含左侧列表、同高原图和右侧 AI 重绘结果、底部调整区。
  - 批量重绘按钮在存在 pending 项时禁用。
  - 三类图片都有确认、跳过、重绘、采用候选入口；流程图保留代码编辑。
  - 纯文字模式不显示审核入口；没有原始资源的历史项进入弹窗时显示可操作错误，不触发空白预览。
- [ ] **Step 2: 建立统一审核状态**
  - 将 `mermaidReview*` Renderer state/handler 重命名或抽象为 `illustrationReview*`。
  - 历史 Mermaid 项缺少 `review_status` 时仍显示待确认。
  - 章节入口改为审核图片并按 section 过滤。
  - 使用 Task 5 扩展后的 `ContentIllustrationPlanItem.generation` 与 `ContentGenerationRuntimeState` 类型渲染候选状态，不在组件内用 `as any` 绕过类型。
- [ ] **Step 3: 实现 B 方案布局**
  - 左侧列表固定可滚动；
  - 中间上方原图、右侧候选图同高并排；
  - 中间下方按类型显示 Mermaid 代码或通用调整要求；
  - 保留流程图缩放、拖拽和适应窗口；
  - AI/PPT 图片使用现有 `MarkdownRenderer`/图片预览资源协议，不向 Renderer 暴露本地路径。
- [ ] **Step 4: 接入操作**
  - 调用通用 bridge 完成预览、保存、确认、跳过、启动单图/批量重绘、采用候选。
  - 重绘任务在弹窗关闭后继续，页面重新挂载时从 Store 和任务事件恢复。
  - 采用候选成功后刷新正文和列表状态；失败使用 Toast/Dialog 给出可操作提示。
- [ ] **Step 5: 改可见文案和样式测试**
  - 同步开发者演示页和第五步配图统计文案。
  - 删除/更新仅适用于 Mermaid 的测试断言，保留旧 IPC 兼容断言。
- [ ] **Step 6: 运行 Renderer 测试**
  - Run: `cd client; node --test src/features/technical-plan/services/workflowLayout.test.ts`
  - Expected: PASS。
- [ ] **Step 7: 提交**
  - Run: `git add client/src/features/technical-plan/pages/ContentEditPage.tsx client/src/features/technical-plan/types.ts client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/workflowLayout.test.ts client/src/features/developer/pages/DeveloperDemoPage.tsx; git commit -m "feat: add unified illustration review dialog"`

## Task 7: 端到端验证和收尾修复

**Files:**
- Modify: files identified by failing tests only.

- [ ] **Step 1: 运行全部定向测试**
  - Run:
    ```powershell
    cd client
    node --test src/features/technical-plan/services/imageConfig.test.ts src/features/technical-plan/services/quickConfig.test.ts src/features/technical-plan/services/workflowLayout.test.ts
    node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
    node --test electron/services/contentIllustrationReview.test.cjs electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs electron/services/contentGenerationTask.mermaidRedraw.test.cjs
    node --test electron/ipc/technicalPlanIpc.ai-mermaid.test.cjs
    ```
  - Expected: all PASS。
- [ ] **Step 2: 执行静态检查和构建**
  - Run:
    ```powershell
    cd client
    node --check electron/preload.cjs
    node --check electron/ipc/technicalPlanIpc.cjs
    node --check electron/services/sqliteDatabase.cjs
    node --check electron/services/technicalPlanStore.cjs
    node --check electron/services/contentIllustrationReview.cjs
    node --check electron/services/contentIllustrationGeneration.cjs
    node --check electron/services/contentGenerationTask.cjs
    npm run build
    npm run smoke:electron-native
    ```
  - Expected: all exit 0；已有 chunk 体积警告不视为失败。
- [ ] **Step 3: 启动客户端手动验收**
  - Run: `cd client; npm run dev`
  - 验证 STEP 01 四种预设、叶子数量不足、图片模型不可用和自定义回退。
  - 生成包含三类图片的正文，验证统一审核弹窗和 B 方案布局。
  - 验证批量重绘前必须确认/跳过全部图片，单图重绘只处理已确认项。
  - 验证原图与候选并存、采用候选更新正文、正文块缺失时事务回滚。
  - 验证暂停/继续、应用重启恢复、历史 Mermaid 项和纯文字模式。
- [ ] **Step 4: 检查工作区**
  - Run: `git status --short`
  - Expected: 只有本次功能改动；不覆盖用户已有的未提交改动。
- [ ] **Step 5: 提交验证修复**
  - 仅在测试/手动验收暴露问题时修改相关文件。
  - Run: `git add <changed-files>; git commit -m "test: verify technical plan illustration review"`

## Implementation Notes

- 开始每个任务前先读取目标文件当前内容；当前工作区已有与 Mermaid 审核相关的未提交修改，必须在其基础上继续，不能回滚或覆盖。
- Renderer 不直接访问 Node、文件系统或 IPC；新增能力必须走 preload 和 `src/shared/types/ipc.ts`。
- 业务文件和 IPC 文件使用 UTF-8；路径和资源 URL 必须按 Windows 中文路径处理。
- 资源候选采用、Store 更新和正文权威内容更新必须在 Main 事务边界内完成；不要在 Renderer 复制清理规则。
- `MarkdownRenderer` 对 AI/Agent/PPT 生成内容继续显式传 `allowRawHtml={false}`。
- 内部统计字段可保持旧 `mermaid/html` 名称，用户可见文案才统一改为流程图/PPT 图。
- 每个任务完成后先运行对应定向测试，再进入下一任务；遇到失败先按 `systematic-debugging` 技能排查，不要猜测原因。
