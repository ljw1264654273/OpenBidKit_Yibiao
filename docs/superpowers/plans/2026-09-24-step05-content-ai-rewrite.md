# STEP 05 Content AI Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cursor-based continuation, selection rewrite, and AI/local/clipboard image insertion to the STEP 05 Markdown editor with preview-before-apply behavior.

**Architecture:** Extend the shared Markdown editor with optional selection reporting and toolbar extension points. Keep draft mutation in Renderer pure functions, place AI/image generation and project asset persistence in a focused Main service, and expose thin technical-plan IPC methods. Persist only through the existing chapter save flow.

**Tech Stack:** React 19, TypeScript, Radix UI, Electron CommonJS, better-sqlite3, Node test runner, Vite.

---

### Task 1: Draft range editing and protected blocks

**Files:**
- Create: `client/src/features/technical-plan/services/contentAiEdit.ts`
- Test: `client/src/features/technical-plan/services/contentAiEdit.test.ts`

- [ ] Write failing tests for rewrite, continuation, image insertion, stale snapshots, protected image blocks, and undo ranges.
- [ ] Run the test and confirm missing-module failure.
- [ ] Implement minimal pure range-edit helpers.
- [ ] Run the test and confirm pass.

### Task 2: Markdown editor selection API

**Files:**
- Modify: `client/src/shared/ui/MarkdownEditor.tsx`
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] Add failing structural tests for optional selection callbacks, selection restoration, toolbar extension, and fullscreen parity.
- [ ] Extend `MarkdownEditor` without changing existing callers.
- [ ] Run targeted tests and build type-check.

### Task 3: Main AI and inline image service

**Files:**
- Create: `client/electron/services/contentAiEditService.cjs`
- Create: `client/electron/services/contentAiEditService.test.cjs`
- Modify: `client/electron/utils/paths.cjs`

- [ ] Write failing service tests for text candidates, imported data/file images, inline image Markdown, Chinese paths, release, and adopted candidate protection.
- [ ] Implement the service using injected `aiService` and project technical-plan directories.
- [ ] Run Node syntax checks and service tests.

### Task 4: IPC and preload protocol

**Files:**
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`

- [ ] Add failing protocol assertions.
- [ ] Register and expose AI edit, AI image, imported image, and candidate release methods.
- [ ] Add workspace-database lifecycle entries and TypeScript types.
- [ ] Run syntax checks and targeted protocol tests.

### Task 5: STEP 05 menu, drawer, and integration

**Files:**
- Create: `client/src/features/technical-plan/components/ContentAiRewriteMenu.tsx`
- Create: `client/src/features/technical-plan/components/ContentAiRewriteDrawer.tsx`
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] Add failing layout tests for the button, smart menu, drawer, task locking, fullscreen entry, and image sources.
- [ ] Implement text candidate generation and exact draft application.
- [ ] Implement AI image, file selection, drag/drop, and clipboard image preview/application.
- [ ] Implement stale-draft protection, discard cleanup, and one-step undo.
- [ ] Run targeted tests and `npm run build`.

### Task 6: Inline image compatibility

**Files:**
- Modify: `client/electron/ipc/bidProjectIpc.cjs` or its shared illustration-block helper
- Modify: `client/electron/services/contentIllustrationGeneration.cjs` if needed
- Test: relevant existing tests plus new focused assertions

- [ ] Add failing tests proving inline image blocks survive duplicate paragraph replacement and automatic illustration stripping.
- [ ] Extend protected-block handling without changing existing generated illustration behavior.
- [ ] Run focused regression tests.

### Task 7: Final verification and launch

- [ ] Run all changed `.cjs` files through `node --check`.
- [ ] Run all new and affected targeted tests.
- [ ] Run `npm run smoke:electron-native`.
- [ ] Run `npm run build`.
- [ ] Start `npm run dev`, confirm Vite and Electron stay running, and leave the application open for user acceptance.

