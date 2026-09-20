# Knowledge Base Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本地单一文档知识库升级为六个固定分类，支持跨库文档移动和跨库选择，并把远程知识库、图片知识库提升为一级入口，同时兼容旧数据和旧导航状态。

**Architecture:** 在现有 `knowledge_folders` 上增加固定 `knowledge_base_id`，文档仍通过文件夹归属知识库，所有知识条目和处理表继续共用。知识库 IPC 增加按分类读取和带目标文件夹的移动能力；Renderer 将本地索引按分类分组，知识库管理页面通过当前分类复用同一页面，技术方案和可研选择器读取全量索引。远程一级页面复用现有 `RemoteKnowledgePicker`，不改变远程协议。

**Tech Stack:** Electron CommonJS services/IPC/preload, SQLite via better-sqlite3, React + TypeScript, Radix Dialog, global CSS, Node test runner, Vite.

---

## 文件范围

**核心数据库和 Main：**

- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `client/electron/services/knowledgeBaseStore.cjs`
- Modify: `client/electron/services/knowledgeBaseService.cjs`
- Modify: `client/electron/ipc/knowledgeBaseIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/features/knowledge-base/types.ts`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `sql/workspace_schema.sql`

**导航和页面：**

- Modify: `client/src/shared/types/navigation.ts`
- Modify: `client/src/app/menuConfig.ts`
- Modify: `client/src/app/AppRouter.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/features/knowledge-base/pages/KnowledgeBasePage.tsx`
- Create: `client/src/features/knowledge-base/knowledgeBaseCatalog.ts`
- Create: `client/src/features/knowledge-base/pages/RemoteKnowledgeBasePage.tsx`
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Modify: `client/src/features/feasibility-report/pages/OutlinePage.tsx`
- Modify: `client/src/styles/feature-knowledge-base.css`
- Modify: `client/src/styles/feature-technical-plan.css`
- Modify: `analytics/dashboard/public/src/pages/traffic.js`

**Tests and docs:**

- Create or modify: `client/electron/services/knowledgeBaseStore.categories.test.cjs`
- Modify: `client/electron/services/knowledgeBaseStore.test.cjs` if present/needed
- Modify: `client/electron/ipc/knowledgeBaseIpc.test.cjs` if present/needed
- Add/update focused Renderer tests where existing test setup supports them
- Modify: `使用说明/使用/03-使用文档知识库.md` only if the existing manual describes the old nested navigation

## Task 1: Define catalog constants and add the schema migration

**Files:**
- Create: `client/src/features/knowledge-base/knowledgeBaseCatalog.ts`
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Test: `client/electron/services/knowledgeBaseStore.categories.test.cjs`

- [ ] Add a failing native/store test that creates a legacy `knowledge_folders` table, runs workspace initialization, and verifies all existing folders receive `knowledge_base_id = 'document'`.
- [ ] Run the focused test and confirm it fails because the column/migration is absent.
- [ ] Add the `knowledge_base_id` column with a default of `document`, an index ordered by category and folder order, and a new schema migration version.
- [ ] Ensure schema repair also adds/backfills the field for existing workspaces and project-independent tables.
- [ ] Mirror the target structure in `sql/workspace_schema.sql`.
- [ ] Define the six catalog records and lookup helpers in `knowledgeBaseCatalog.ts`, including IDs, Chinese labels, and navigation IDs.
- [ ] Run the focused native test and confirm migration and catalog behavior pass.

## Task 2: Extend Store and IPC contracts for category-aware indexing and cross-category moves

**Files:**
- Modify: `client/electron/services/knowledgeBaseStore.cjs`
- Modify: `client/electron/services/knowledgeBaseService.cjs`
- Modify: `client/electron/ipc/knowledgeBaseIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/features/knowledge-base/types.ts`
- Modify: `client/src/shared/types/ipc.ts`
- Test: `client/electron/services/knowledgeBaseStore.categories.test.cjs`
- Test: `client/electron/ipc/knowledgeBaseIpc.test.cjs` if the existing IPC test pattern covers the new arguments

- [ ] Add failing tests for creating folders under a requested category, filtering an index by category, and moving a ready document to a target folder in another category while preserving document ID and item data.
- [ ] Add failing tests proving a document in an active processing state cannot be moved and a missing target folder is rejected.
- [ ] Run focused tests and verify expected red failures.
- [ ] Update folder normalization and row mapping to carry `knowledge_base_id`, defaulting legacy callers to `document`.
- [ ] Make folder creation and folder listing category-aware without duplicating the underlying table or processing code.
- [ ] Define explicit index request semantics: `{ knowledgeBaseId: string }` returns one category for management pages; `{ allKnowledgeBases: true }` returns all six local categories for selectors and move dialogs; omitted options remain the backward-compatible `document` category view.
- [ ] Return category metadata on folders and documents’ effective category where useful for Renderer display, and add tests proving both filtered and full-index calls.
- [ ] Extend move handling to accept target folder/category through the existing target-folder operation. Validate the target folder’s category, preserve IDs and processing records, and keep existing filesystem move rollback behavior.
- [ ] Keep old IPC method call shapes working by treating omitted category as `document`; add the new optional argument to preload and bridge types.
- [ ] Define the move event contract as a full document payload containing the new folder/category plus `previousFolderId` and `previousKnowledgeBaseId`; category-scoped pages remove a document when the event’s previous category matches but new category does not, and add/update it when the new category matches. Full-index selectors update by document ID in either case.
- [ ] Update Main-side internal callers that need cross-category visibility (`contentGenerationTask.cjs`, `knowledgeBaseService.cjs`, recovery/move/delete target lookups) to request the explicit all-category index or use direct ID lookups; keep the legacy no-argument service call only for old document-library compatibility.
- [ ] Add a regression proving a folder-linked outline resolves documents from a non-document category after a cross-category move, while direct document references remain valid.
- [ ] Run focused Store/IPC tests and existing knowledge-base tests.

## Task 3: Convert navigation and reuse one local knowledge-base page for six fixed categories

**Files:**
- Modify: `client/src/shared/types/navigation.ts`
- Modify: `client/src/app/menuConfig.ts`
- Modify: `client/src/app/AppRouter.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/features/knowledge-base/pages/KnowledgeBasePage.tsx`
- Modify: `client/src/styles/feature-knowledge-base.css`
- Modify: `client/src/shared/analytics/analytics.ts` only if a route helper needs a category-safe page name
- Modify: `analytics/dashboard/public/src/pages/traffic.js`

- [ ] Add a failing navigation test or a small pure catalog test proving the final menu contains six local entries, remote, and image as top-level entries, with no `knowledge-base` parent.
- [ ] Normalize legacy section values in the app entry/navigation path so `knowledge-base` and old document entry open the document knowledge-base page; keep image entry mapped to the image placeholder.
- [ ] Add the six local SectionIds, `remote-knowledge-base`, and retain `image-knowledge-base`.
- [ ] Add fixed menu entries and use the shared catalog to avoid duplicated labels.
- [ ] Route all local entries to `KnowledgeBasePage` with a `knowledgeBaseId` prop; route remote to `RemoteKnowledgeBasePage`; keep image’s under-development notice.
- [ ] Update Sidebar icon mapping and active-section behavior for all new top-level entries.
- [ ] Update `KnowledgeBasePage` to load only the selected category, create folders under that category, display the category title, and maintain category-scoped folder/document state.
- [ ] Keep existing parsing, matching, viewer, delete, retry, and event behavior intact.
- [ ] Update Analytics Dashboard route names for each new knowledge-base route and preserve existing viewer route tracking with a category suffix where needed.
- [ ] Update CSS for category header, category-scoped list, and move affordance without introducing a new styling system.
- [ ] Run `npm run build` after the Renderer/navigation slice.

## Task 4: Add explicit cross-category document movement in the local page

**Files:**
- Modify: `client/src/features/knowledge-base/pages/KnowledgeBasePage.tsx`
- Modify: `client/src/styles/feature-knowledge-base.css`
- Test: focused Store test from Task 2 plus manual UI verification

- [ ] Add a failing UI-facing helper test if existing test infrastructure supports it; otherwise use the Store regression test as the contract.
- [ ] Add a move dialog opened from a document action, with target category and target folder selectors.
- [ ] Load all folders for the move dialog with `{ allKnowledgeBases: true }`, exclude the document’s current folder as needed, and require a target folder.
- [ ] Call the cross-category move IPC with the target folder, refresh the selected page and viewer, and show success/error toasts.
- [ ] Keep drag-and-drop sorting behavior within the current category; do not make folder drag cross-category.
- [ ] Ensure moving a document does not mutate document ID, parsed item count, status, or viewer content.
- [ ] Manually verify same-category and cross-category moves, disabled processing-state moves, and return-to-source-page behavior.

## Task 5: Make all local knowledge selectors show and select across six categories

**Files:**
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Modify: `client/src/features/feasibility-report/pages/OutlinePage.tsx`
- Modify: related styles in `client/src/styles/feature-technical-plan.css`
- Modify: `client/electron/services/contentGenerationTask.cjs` only if the category-aware index shape requires a compatibility adjustment
- Modify: `client/electron/services/globalFactsTask.cjs` and `client/electron/services/feasibilityReportTasks.cjs` only if they incorrectly assume folders are globally grouped

- [ ] Add or extend tests for grouping a full local index by category and retaining selections by stable document ID.
- [ ] Update technical-plan reference selection to show category → folder → document and allow multi-category document selection.
- [ ] Update technical-plan outline-node folder/document selection to show category context and preserve the confirmed dynamic-folder/direct-document semantics.
- [ ] Update feasibility-report outline selection to use the same full-index grouping and cross-category selection.
- [ ] Ensure all selected values remain document IDs/folder IDs, so existing Main generation tasks continue to resolve references without data migration.
- [ ] Re-check content generation and global facts code paths after the index shape change; preserve direct document references after moves and dynamically resolve folder references at generation time.
- [ ] Run relevant existing technical-plan/content/feasibility tests and `npm run build`.

## Task 6: Add the remote first-level page and complete compatibility/documentation

**Files:**
- Create: `client/src/features/knowledge-base/pages/RemoteKnowledgeBasePage.tsx`
- Modify: `client/src/features/technical-plan/components/RemoteKnowledgePicker.tsx` only if the component needs a page-level selection callback/empty state prop
- Modify: `client/src/app/AppRouter.tsx`
- Modify: `client/src/shared/types/navigation.ts`
- Modify: `client/src/app/menuConfig.ts`
- Modify: `analytics/dashboard/public/src/pages/traffic.js`
- Modify: `使用说明/使用/03-使用文档知识库.md`

- [ ] Add a focused component/helper test if available for remote page route selection, otherwise verify through the existing remote service/selector tests.
- [ ] Wrap `RemoteKnowledgePicker` in a first-level page with its own session-local scope state.
- [ ] Preserve existing remote endpoint/error/retry behavior and do not add local persistence or remote management operations.
- [ ] Verify old `knowledge-base`, old document entry, and old image entry compatibility paths.
- [ ] Update the user manual’s navigation text from “知识库 → 文档知识库” to the new first-level “文档知识库” path, without inventing screenshots or unrelated manual changes.
- [ ] Run `node --check` for changed CommonJS files and the focused remote tests.

## Task 7: Full self-test and review

**Files:**
- No new production files unless fixes are required by verification.

- [ ] Run `node --check` for every changed `.cjs` file.
- [ ] Run a service-level regression covering filesystem rename/rollback, preserved direct document references, and dynamic folder references after a cross-category move.
- [ ] Run knowledge-base Store/IPC tests and all directly affected technical-plan, feasibility, and content-generation tests.
- [ ] Run `cd client; npm run build`.
- [ ] Run `cd client; npm run smoke:electron-native`.
- [ ] Start `cd client; npm run dev` and manually verify the first-level menu, legacy navigation, all six local libraries, upload/parse/viewer flow, cross-category move, selectors, remote page, and image placeholder.
- [ ] Review `git diff` and `git status` to ensure no unrelated user changes were reverted or included.
- [ ] Request final code review against the design and this plan, then fix any Critical/Important findings and rerun affected tests.
