# 图片审核最终选择与重置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Mermaid、AI 配图和 PPT 图的图片审核确认语义，并增加可恢复首次生成版本的重置能力，确保正文、SQLite 状态和 Word 导出读取到同一份最终图片。

**Architecture:** 在图片审核项的 `generation` 中持久化不可被候选覆盖的原始基线；Store 在单一事务内完成候选采用、无候选确认和重置，同时同步正文节点、正文小节状态及图片计划。Renderer 只保留“重新生成 AI 图片”“AI 重绘当前图片”“确认此图”“重置”四类清晰入口，所有业务动作经现有 Electron IPC bridge 调用。

**Tech Stack:** Electron CommonJS services/IPC/preload、better-sqlite3、React + TypeScript Renderer、Node `node:test`、Vite/TypeScript build。

**Reference:** `docs/superpowers/specs/2026-09-19-illustration-review-selection-design.md`

---

### Task 1: 建立 Store 行为的失败测试

**Files:**
- Modify: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`
- Modify: `client/electron/services/contentIllustrationReview.test.cjs`

- [ ] **Step 1: 写出统一确认的失败测试**

覆盖以下独立行为：

- Mermaid 有成功候选时，“确认此图”把正文 Mermaid 块替换为候选图片，保留 `original_code`。
- Mermaid 没有候选时，“确认此图”保留当前 Mermaid 正文，不清空正文图片块。
- AI/PPT 有成功候选时，统一确认采用候选并清理候选字段。
- AI/PPT 无候选时，统一确认保留当前图片资源。

- [ ] **Step 2: 写出 Mermaid、AI/PPT 重置的失败测试**

覆盖：

- Mermaid 恢复 `original_code`，清除当前图片和候选。
- AI/PPT 恢复 `original_asset_url` 与 `original_source_path`，清除候选。
- 所有类型的 `review_status` 回到 `pending`，正文小节仍为 `success`。
- 确认和重置找不到正文图片块时失败，不静默追加正文。
- 原始图片地址或源文件缺失时重置失败，数据库和正文保持原状态，并给出可操作错误。

- [ ] **Step 3: 写出原始资源清理保护和项目表 migration 的失败测试**

验证：

- 候选采用后原始资源仍被 `technical_plan_illustration_items` 引用保护，不会被异步清理。
- 全局表、已有项目级图片表都获得三个 `original` 列。
- 重启数据库后三个字段保持原值。

- [ ] **Step 4: 运行红灯测试**

Run from `client/`:

```powershell
node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
node --test electron/services/contentIllustrationReview.test.cjs
```

Expected: 新增断言失败，失败原因应指向旧的确认语义、缺少 reset 方法或缺少 original 列，而不是测试装配错误。

### Task 2: 扩展图片审核持久化模型与原始基线

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/storageCleanupService.cjs`
- Modify: `client/electron/services/contentIllustrationGeneration.cjs`
- Test: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`

- [ ] **Step 1: 增加 generation 类型和 SQLite 列**

新增 `original_code`、`original_asset_url`、`original_source_path` 的 Renderer 类型、初始建表字段、全局 schema health 字段、项目级表字段和新 migration。

- [ ] **Step 2: 更新 Store、启动清理服务的 load/upsert/清理映射**

让 `illustrationItemValues()`、`upsertIllustrationItem`、`loadContentIllustrationPlan()` 完整读写三个字段；让 `loadGeneratedIllustrationAssetUrls()`、引用检查和 `storageCleanupService.cjs` 把 `original_asset_url` 纳入保留集合；项目表动态 schema 也纳入新列。

- [ ] **Step 3: 在首次生成结果写入时初始化基线**

Mermaid 在首次持久化 `reviewing` 草稿时就从 `code` 初始化；其他图片在首次成功写入时从当前 `asset_url`、`source_path` 初始化。只在原始字段为空时写入；候选生成、候选采用、重置不得覆盖原始基线。对旧数据使用当前可确认的正文/资源建立兼容基线，无法恢复的资源保持缺失并由操作错误明确提示。

- [ ] **Step 4: 运行持久化红灯转绿验证**

Run:

```powershell
node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
```

Expected: 原始字段、重启恢复、项目表 migration 和资源清理保护相关测试通过。

### Task 3: 实现 Store 的统一确认与重置事务

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/contentIllustrationReview.cjs`
- Test: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`
- Test: `client/electron/services/contentIllustrationReview.test.cjs`

- [ ] **Step 1: 抽取候选采用的统一内部逻辑**

让 `confirmIllustrationReviewItem()` 判断 `redraw_status === 'success'` 时复用原子候选采用逻辑；无候选时仅确认当前内容，不触发生图。Mermaid 无候选必须保持 Mermaid 代码块；AI/PPT 无候选必须保持现有图片块和当前资源。

- [ ] **Step 2: 保留兼容入口但消除重复语义**

让 `adoptIllustrationReviewItem()` 内部复用统一确认采用逻辑，旧 IPC 调用仍可工作；不再让 `confirmMermaidIllustrationItem()` 擅自清除当前图片资源。

- [ ] **Step 3: 添加 `resetIllustrationReviewItem()`**

在一个 SQLite transaction 内：

- Mermaid 用 `original_code` 生成并替换正文 Mermaid 块，清除 `asset_url/source_path`；
- AI/PPT 用 `original_asset_url/original_source_path` 生成并替换正文图片块；
- 清除所有 `redraw_*` 字段；
- 设置 `review_status: 'pending'`、正文小节 `success`；
- 缺少原始基线或正文块时抛出可操作错误，不写入半成品。
- 对 AI/PPT 的原始图片地址及源文件引用先检查可用性；检查失败时事务不提交。

- [ ] **Step 4: 运行 Store/服务测试**

Run:

```powershell
node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
node --test electron/services/contentIllustrationReview.test.cjs
```

Expected: Task 1 的统一确认、无候选保留和 reset 测试全部通过，旧的“不自动生图”测试仍通过。

### Task 4: 接通 IPC、preload 和 Renderer 类型

**Files:**
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Test: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs` or a focused static IPC test

- [ ] **Step 1: 增加 reset service wrapper 和 IPC handler**

新增 `resetIllustrationReviewItem`，payload 使用 `{ projectId?: string; itemId: string }`，通过 `resolveStore(payload)` 调用 Store。

- [ ] **Step 2: 加入数据库就绪通道和 preload bridge**

把 `technical-plan:reset-illustration-review-item` 纳入 `workspaceDatabaseChannels`，并在 `window.yibiao.technicalPlan` 暴露方法。

- [ ] **Step 3: 同步 TypeScript bridge 类型**

为 reset 方法声明 `Promise<Partial<TechnicalPlanState>>`，确认现有 confirm/adopt 类型保持兼容。

- [ ] **Step 4: 运行 CommonJS 语法检查和类型检查**

Run:

```powershell
node --check electron/services/technicalPlanStore.cjs
node --check electron/services/contentIllustrationReview.cjs
node --check electron/ipc/technicalPlanIpc.cjs
node --check electron/preload.cjs
npm run build
```

Expected: 所有检查通过；只允许出现已有的 chunk 体积警告。

### Task 5: 调整图片审核界面为统一操作

**Files:**
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Modify: `client/src/styles/feature-technical-plan.css` only if the new action row needs existing styles adjusted

- [ ] **Step 1: 更新确认调用和反馈**

确认按钮统一显示“确认此图”；Mermaid 调用不再把确认文案写成“恢复 Mermaid”，有候选时提示已替换正文，无候选时提示保留当前图片。

- [ ] **Step 2: 删除候选区重复采用按钮**

移除“采用 AI 图片”和“采用重绘结果”，候选成功只展示候选状态；底部统一确认按钮承担最终选择。

- [ ] **Step 3: 增加重置按钮**

调用 `resetIllustrationReviewItem`，候选生成中禁用确认与重置；成功后刷新计划并提示已恢复原始版本。重置不调用 AI。

- [ ] **Step 4: 保留独立生图入口**

“重新生成 AI 图片”和“AI 重绘当前图片”继续只负责生成候选；Mermaid 仍要求先确认结构后才允许“重新生成 AI 图片”。

- [ ] **Step 5: 更新 Renderer 静态行为测试**

断言页面只有统一的“确认此图”最终按钮、不再出现重复采用按钮，并且包含 reset bridge 调用和对应禁用状态。

- [ ] **Step 6: 运行前端测试和构建**

Run:

```powershell
node --test --experimental-strip-types src/features/technical-plan/services/workflowLayout.test.ts
npm run build
```

Expected: 页面行为断言和生产构建通过。

### Task 6: 完整验证并重新启动最新客户端

**Files:**
- No additional production files expected.

- [ ] **Step 1: 运行定向测试**

```powershell
node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
node --test electron/services/contentIllustrationReview.test.cjs
node --test electron/services/contentGenerationTask.mermaidRedraw.test.cjs
node --test --experimental-strip-types src/features/technical-plan/services/workflowLayout.test.ts
```

- [ ] **Step 2: 运行 native smoke 和语法检查**

```powershell
node --check electron/services/technicalPlanStore.cjs
node --check electron/ipc/technicalPlanIpc.cjs
node --check electron/preload.cjs
node --check electron/services/storageCleanupService.cjs
npm run smoke:electron-native
```

- [ ] **Step 3: 重新编译并启动最新 Electron**

```powershell
npm run build
npm run dev
```

确认 Vite 仍使用 `127.0.0.1:5173`，并打开最新 Electron 窗口进行图片审核流程手动验证：候选生成、确认此图、无候选确认、重置，以及 Word 导出读取最终正文。
