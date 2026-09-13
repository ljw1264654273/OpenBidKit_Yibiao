# 第五步 Mermaid 审核后 AI 重绘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在第五步正文生成中为“Mermaid 改用 AI 图片重绘”增加人工审核、代码编辑、预览校验、确认后重绘和最终插图流程。

**Architecture:** 继续以 `contentIllustrationPlan.items` 为权威状态，给 Mermaid 计划项的 `generation` 增加审核字段，并在 SQLite 拆表中用 `generation_*` 列持久化。正文任务在 AI 重绘模式下先生成 `reviewing` 草稿，Renderer 提供审核 UI；确认后的项由独立任务调用现有 Mermaid AI 重绘 prompt，最终通过 `asset_url` 优先插入图片 Markdown。

**Tech Stack:** Electron Main CommonJS、React + TypeScript Renderer、SQLite migration、现有 `MarkdownRenderer` Mermaid 预览、Node `node:test`、Vite/TypeScript build。

---

## File Structure

- Modify `client/src/features/technical-plan/types.ts`: 扩展插图生成状态 union 和 `ContentIllustrationPlanItem.generation` 字段。
- Modify `client/electron/services/sqliteDatabase.cjs`: 新增技术方案插图审核字段 migration，并更新目标建表。
- Modify `sql/workspace_schema.sql`: 同步新增 `technical_plan_illustration_items` 目标列。
- Modify `client/electron/services/technicalPlanStore.cjs`: 映射新增列，提供 Mermaid 审核保存/确认/跳过接口。
- Modify `client/electron/services/contentIllustrationGeneration.cjs`: 增加 Mermaid review 草稿生成 helper，调整 `asset_url` 优先插图。
- Modify `client/electron/services/contentGenerationTask.cjs`: 生成 `reviewing` 草稿，新增审核后重绘任务分支。
- Modify `client/electron/ipc/technicalPlanIpc.cjs`, `client/electron/preload.cjs`, `client/src/shared/types/ipc.ts`: 暴露薄 IPC。
- Modify `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`: 给 `ContentEditPage` 传入合并 `Partial<TechnicalPlanState>` 的回调。
- Modify `client/src/features/technical-plan/pages/ContentEditPage.tsx`: 增加 Mermaid 审核入口、Dialog、代码编辑、预览、确认/跳过/重绘操作。
- Modify `client/src/styles/feature-technical-plan.css`: 增加审核区样式。
- Test `client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`: 覆盖 `asset_url` 优先和 review 草稿生成。
- Test `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs` or new focused test: 覆盖新增审核字段持久化。
- Test `client/src/features/technical-plan/services/workflowLayout.test.ts`: 添加源码断言，确保 UI 有审核入口和 IPC 调用。

## Task 1: Types, Markdown Insertion, And Review Generation Helpers

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/electron/services/contentIllustrationGeneration.cjs`
- Test: `client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`

- [ ] **Step 1: Write failing tests for image Markdown priority and review draft generation**

  In `contentIllustrationGeneration.ai-mermaid.test.cjs`, add:
  - A test where a `kind: 'mermaid'` item has both `generation.code` and `generation.asset_url`; expect `applyGeneratedIllustrationsToDocument()` to insert `![title](asset_url)` instead of a Mermaid code block.
  - A test for a new exported helper such as `generateMermaidReviewDraft()` returning `{ code, draft_code, review_status: 'pending', status: 'reviewing' }` after local render validation.

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```powershell
  cd client
  node --test electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs
  ```

  Expected: FAIL because `asset_url` is not prioritized when `generation.code` exists and the review helper is not exported.

- [ ] **Step 3: Implement minimal generation type and insertion changes**

  - Extend `ContentIllustrationPlanItem.generation.status` to include `reviewing` and `skipped`.
  - Add optional `draft_code`, `review_status`, `review_error`, `reviewed_at`.
  - Change `buildGeneratedIllustrationMarkdown()` so `generation.asset_url` is checked before the Mermaid `generation.code` branch.
  - Add `generateMermaidReviewDraft()` by reusing existing Mermaid generation and render validation path, returning review metadata without calling `generateImage()`.

- [ ] **Step 4: Run focused test and syntax check**

  Run:

  ```powershell
  cd client
  node --test electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs
  node --check electron/services/contentIllustrationGeneration.cjs
  ```

  Expected: PASS and syntax check exits 0.

- [ ] **Step 5: Commit task 1**

  ```powershell
  git add client/src/features/technical-plan/types.ts client/electron/services/contentIllustrationGeneration.cjs client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs
  git commit -m "feat: prepare mermaid review generation"
  ```

## Task 2: SQLite And Store Persistence For Review State

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Test: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs` or new `technicalPlanStore.mermaidReview.test.cjs`

- [ ] **Step 1: Write failing persistence test**

  Add a test that creates a technical plan with one Mermaid item whose generation includes:

  ```js
  {
    status: 'reviewing',
    code: 'flowchart TD\n  A["开始"] --> B["结束"]',
    draft_code: 'flowchart TD\n  A["开始"] --> B["结束"]',
    review_status: 'pending',
    review_error: 'old error',
    reviewed_at: '2026-09-13T00:00:00.000Z'
  }
  ```

  Restart the SQLite store and assert all fields load back under `item.generation`.

- [ ] **Step 2: Run persistence test and verify RED**

  Run:

  ```powershell
  cd client
  node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
  ```

  Expected: FAIL because new generation review fields are not persisted.

- [ ] **Step 3: Add migration and schema columns**

  - Add migration in `sqliteDatabase.cjs` for:
    - `generation_draft_code TEXT`
    - `generation_review_status TEXT`
    - `generation_review_error TEXT`
    - `generation_reviewed_at TEXT`
  - Update the base `CREATE TABLE IF NOT EXISTS technical_plan_illustration_items`.
  - Update `sql/workspace_schema.sql`.

- [ ] **Step 4: Map fields in Store**

  - Update `illustrationItemValues()`.
  - Update `upsertIllustrationItem`.
  - Update `loadContentIllustrationPlan()`.
  - Keep existing asset cleanup behavior unchanged.

- [ ] **Step 5: Run persistence test and syntax checks**

  Run:

  ```powershell
  cd client
  node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
  node --check electron/services/sqliteDatabase.cjs
  node --check electron/services/technicalPlanStore.cjs
  ```

  Expected: PASS and syntax checks exit 0.

- [ ] **Step 6: Commit task 2**

  ```powershell
  git add client/electron/services/sqliteDatabase.cjs sql/workspace_schema.sql client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
  git commit -m "feat: persist mermaid review state"
  ```

## Task 3: Main Review APIs And Redraw Task Flow

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Test: `client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs`
- Test: `client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs`

- [ ] **Step 1: Write failing tests for Store review actions**

  Add store tests for:
  - `confirmMermaidReviewItem(itemId, code)` validates and sets `generation.status: 'pending'`, `generation.review_status: 'confirmed'`, clears stale `asset_url`.
  - `skipMermaidReviewItem(itemId)` sets `generation.status: 'skipped'`, `generation.review_status: 'skipped'`, clears stale `asset_url`.
  - `saveMermaidReviewCode(itemId, code)` keeps `reviewing/pending`.

- [ ] **Step 2: Run Store test and verify RED**

  Run:

  ```powershell
  cd client
  node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
  ```

  Expected: FAIL because APIs do not exist.

- [ ] **Step 3: Implement Store review APIs**

  Add focused methods to `technicalPlanStore.cjs`:
  - `previewMermaidReviewItem({ itemId, code })`
  - `saveMermaidReviewCode({ itemId, code })`
  - `confirmMermaidReviewItem({ itemId, code })`
  - `skipMermaidReviewItem({ itemId })`

  Reuse existing Mermaid validation helpers from `contentIllustrationGeneration.cjs`; if needed export a validation wrapper rather than duplicating regexes.

- [ ] **Step 4: Add task flow tests or focused assertions for redraw filtering**

  Add testable helpers or assertions showing:
  - redraw only selects:

  ```js
  item.kind === 'mermaid'
    && item.generation?.review_status === 'confirmed'
    && item.generation?.status !== 'success'
    && !item.generation?.asset_url
  ```

  - AI redraw uses the user-confirmed `item.generation.code` and does not call Mermaid text generation again.
  - `reviewing` Mermaid drafts count as processed for illustration generation progress stats during the initial generation phase.

- [ ] **Step 5: Implement task flow changes**

  - In Mermaid AI redraw mode, call `generateMermaidReviewDraft()` and persist `reviewing` item instead of `generateMermaidAiIllustration()`.
  - Add `redrawConfirmedMermaidIllustrations` payload handling to `runContentGenerationTask()`.
  - Run only confirmed, not-yet-successful Mermaid items through an AI redraw path that receives the confirmed `generation.code` directly; do not call the Mermaid text-generation path again.
  - Ensure `reviewing` Mermaid draft items increment illustration-generation completed stats for the initial generation task, while remaining non-insertable because they are not `success`.
  - After success, call `applyGeneratedIllustrationsToDocument()`.

- [ ] **Step 6: Register IPC/preload/types**

  - Add handlers in `technicalPlanIpc.cjs`.
  - Add methods under `window.yibiao.technicalPlan` in `preload.cjs`.
  - Add corresponding TypeScript signatures in `ipc.ts`.

- [ ] **Step 7: Run focused checks**

  Run:

  ```powershell
  cd client
  node --test electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
  node --check electron/services/contentGenerationTask.cjs
  node --check electron/services/technicalPlanStore.cjs
  node --check electron/ipc/technicalPlanIpc.cjs
  node --check electron/preload.cjs
  ```

  Expected: PASS and syntax checks exit 0.

- [ ] **Step 8: Commit task 3**

  ```powershell
  git add client/electron/services/contentGenerationTask.cjs client/electron/services/technicalPlanStore.cjs client/electron/ipc/technicalPlanIpc.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts client/electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs client/electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
  git commit -m "feat: add mermaid review redraw task"
  ```

## Task 4: Step 5 Renderer Review UI

**Files:**
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: Write failing source-level UI assertions**

  In `workflowLayout.test.ts`, assert `ContentEditPage.tsx` contains:
  - A Mermaid review entry point label such as `Mermaid 待确认`.
  - Calls to `previewMermaidReviewItem`, `confirmMermaidReviewItem`, `skipMermaidReviewItem`.
  - A call to `saveMermaidReviewCode` after preview validation succeeds.
  - A “恢复 AI 初稿” control wired to the current item `generation.draft_code`.
  - A start action using `redrawConfirmedMermaidIllustrations`.
  - `MarkdownRenderer` preview with `renderMermaid` and `allowRawHtml={false}` in the review UI.
  - `TechnicalPlanHome.tsx` passes an `onPlanPatched` callback into `ContentEditPage`.

- [ ] **Step 2: Run UI assertion test and verify RED**

  Run:

  ```powershell
  cd client
  node --test src/features/technical-plan/services/workflowLayout.test.ts
  ```

  Expected: FAIL because the UI does not exist.

- [ ] **Step 3: Implement review item selectors and local state**

  In `ContentEditPage.tsx`:
  - Derive Mermaid review items from `contentIllustrationPlan.items`.
  - Show entry when any item has `kind === 'mermaid'` and review/generation states are `reviewing`, `pending`, `error`, `skipped`, or `success` with `review_status`.
  - Track selected review item, draft code, validation error, preview busy state, and redraw busy state.
  - Add prop `onPlanPatched?: (patch: Partial<TechnicalPlanState>) => void` for immediate parent state updates.

  In `TechnicalPlanHome.tsx`, pass `onPlanPatched={(patch) => setState((prev) => ({ ...prev, ...patch }))}`.

- [ ] **Step 4: Implement Dialog UI and actions**

  - Add Dialog with item list, metadata, textarea code editor, preview panel, and actions.
  - Use `MarkdownRenderer renderMermaid allowRawHtml={false}` for preview.
  - `更新预览` calls preview IPC; success updates local normalized code, clears error, then calls `saveMermaidReviewCode` to persist the edited-but-unconfirmed draft and passes the returned `Partial<TechnicalPlanState>` to `onPlanPatched`.
  - `确认此图` calls confirm IPC and immediately passes the returned `Partial<TechnicalPlanState>` to `onPlanPatched`; do not wait for task events because these IPC calls are not background tasks.
  - `跳过` calls skip IPC and immediately applies the returned `Partial<TechnicalPlanState>`.
  - `恢复 AI 初稿` resets the editor to `generation.draft_code` and clears the local preview error; if the user confirms, the restored code is persisted through the same confirm path.
  - `开始 AI 重绘` calls `window.yibiao.tasks.startContentGeneration({ redrawConfirmedMermaidIllustrations: true })`.

- [ ] **Step 5: Add CSS**

  Add scoped classes in `feature-technical-plan.css` for the review banner, dialog layout, code editor, preview pane, state tags, and error copy. Keep page root height and internal scrolling conventions.

- [ ] **Step 6: Run UI assertion and build**

  Run:

  ```powershell
  cd client
  node --test src/features/technical-plan/services/workflowLayout.test.ts
  npm run build
  ```

  Expected: test PASS and build exits 0.

- [ ] **Step 7: Commit task 4**

  ```powershell
  git add client/src/features/technical-plan/pages/ContentEditPage.tsx client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/workflowLayout.test.ts
  git commit -m "feat: add mermaid review UI"
  ```

## Task 5: Full Verification And Manual Smoke

**Files:**
- No planned code changes unless verification finds defects.

- [ ] **Step 1: Run targeted Electron tests**

  ```powershell
  cd client
  node --test electron/services/contentIllustrationGeneration.ai-mermaid.test.cjs electron/services/technicalPlanStore.contentGenerationOptions.test.cjs
  ```

  Expected: PASS.

- [ ] **Step 2: Run syntax checks**

  ```powershell
  cd client
  node --check electron/services/contentIllustrationGeneration.cjs
  node --check electron/services/contentGenerationTask.cjs
  node --check electron/services/technicalPlanStore.cjs
  node --check electron/services/sqliteDatabase.cjs
  node --check electron/ipc/technicalPlanIpc.cjs
  node --check electron/preload.cjs
  ```

  Expected: all exit 0.

- [ ] **Step 3: Run native smoke if available**

  ```powershell
  cd client
  npm run smoke:electron-native
  ```

  Expected: exit 0. If environment blocks Electron/native startup, record the exact error.

- [ ] **Step 4: Run full build**

  ```powershell
  cd client
  npm run build
  ```

  Expected: exit 0; existing chunk-size warnings are acceptable.

- [ ] **Step 5: Manual smoke in dev app**

  ```powershell
  cd client
  npm run dev
  ```

  Validate:
  - With ordinary Mermaid mode, no review banner appears and automatic Mermaid insertion remains.
  - With Mermaid AI redraw enabled, generation produces Mermaid pending review items instead of immediate AI redraw.
  - User can edit code, preview Mermaid, confirm, skip, and start AI redraw.
  - AI redraw success inserts image Markdown, not Mermaid code.

- [ ] **Step 6: Final status**

  Check:

  ```powershell
  git status --short
  ```

  Ensure only intentional files changed and note any pre-existing unrelated dirty files.
