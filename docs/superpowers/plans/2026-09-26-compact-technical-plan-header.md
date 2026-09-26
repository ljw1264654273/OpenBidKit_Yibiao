# Compact Technical Plan Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge the technical-plan project context and Step 01 title into a compact header that exposes five workflow states and leaves more vertical space for tender content.

**Architecture:** Keep workflow state and navigation in `TechnicalPlanHome.tsx`, render a five-step visual status strip from the existing `TechnicalPlanStep` state, and keep Step 01's upload behavior in `DocumentAnalysisPage.tsx`. Use the existing feature CSS and shared upload primitives; change only layout and presentation, not IPC or persistence.

**Tech Stack:** React, TypeScript, global CSS, existing technical-plan layout tests, Vite build.

---

### Task 1: Lock the compact header contract

**Files:**
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] Add source/layout assertions that the technical-plan header renders a five-step status strip and that Step 01 no longer renders a separate page title block.
- [ ] Run the focused test and confirm it fails against the current implementation.

### Task 2: Render the merged header and five-step status

**Files:**
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`

- [ ] Add a five-item visual status model for the main workflow steps: 选择标书、文件解析、目录生成、事实设定、生成正文.
- [ ] Render completed/current/pending classes based on the active workflow index.
- [ ] Move `STEP 01 / 选择标书` into the existing project context header and remove the duplicated Step 01 title presentation from the upload board.
- [ ] Keep the existing navigation actions and upload behavior unchanged.

### Task 3: Compress vertical spacing and file row presentation

**Files:**
- Modify: `client/src/styles/layout-app-shell.css`
- Modify: `client/src/styles/feature-bid-project.css`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] Reduce the content-shell top padding from 36px to the compact-header target.
- [ ] Remove the large page-stack separation around the technical-plan header and set the header-to-upload spacing to 8-12px.
- [ ] Make the header a dense multi-column layout with a responsive five-step strip.
- [ ] Remove the Step 01 upload-board title spacing while keeping the upload row readable and preserving mobile wrapping.

### Task 4: Verify

**Files:**
- No additional files.

- [ ] Run `node --test src/features/technical-plan/services/workflowLayout.test.ts` from `client/`.
- [ ] Run `npm run build` from `client/`.
- [ ] Inspect the changed source and report any remaining limitation, especially the separate `expand` workflow step versus the five main status steps.
