# Historical Bid Adaptation Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent historical-bid-adaptation menu and implement only its material upload, parsing preview, project creation, and persisted acceptance view.

**Architecture:** Reuse the existing expansion import staging pipeline for document parsing and file persistence, while persisting a distinct project type and routing it to a new feature page. Keep the technical-plan workspace kind internal to storage compatibility; no later adaptation workflow is enabled.

**Tech Stack:** React, TypeScript, global CSS, Electron CommonJS services/IPC, SQLite, Node test runner, Vitest for TypeScript utility tests.

---

### Task 1: Define navigation and project identity

**Files:**
- Modify: `client/src/shared/types/navigation.ts`
- Modify: `client/src/app/menuConfig.ts`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/app/projectNavigation.ts`
- Test: `client/src/app/projectNavigation.test.ts`
- Modify: `analytics/dashboard/public/src/pages/traffic.js`
- Modify: `analytics/collector/src/workflow.ts`
- Test: `analytics/collector/src/workflow.test.ts`

- [ ] Add failing navigation tests for mapping and reopening `historical-bid-adaptation`.
- [ ] Run the focused Vitest file and confirm the new expectations fail.
- [ ] Add the section id, menu item, icon mapping, workbench mapping, dashboard label, and workflow-event allowlist entry.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Persist the independent project type

**Files:**
- Modify: `client/src/features/bid-project/types.ts`
- Modify: `client/electron/services/bidProjectStore.cjs`
- Modify: `client/electron/services/bidProjectManager.cjs`
- Modify: `client/electron/services/bidProjectImportService.cjs`
- Test: `client/electron/services/bidProjectImportService.expansion.test.cjs`
- Test: `client/electron/services/bidProjectStore.test.cjs` if present; otherwise cover the real Store/Manager round trip in `bidProjectImportService.expansion.test.cjs`

- [ ] Add a failing import-service test that confirms SQLite returns the distinct project type, type filtering finds it, opening maps it to the expansion-compatible internal workspace, and the original-plan file remains available.
- [ ] Run the focused Node test and confirm failure for the missing project type behavior.
- [ ] Extend import confirmation options and project type normalization; map the new project type to the existing expansion-compatible internal workspace kind.
- [ ] Re-run focused Main tests and confirm existing expansion import remains green.

### Task 3: Build the stage-one page and acceptance state

**Files:**
- Modify: `client/src/features/bid-project/services/expansionProjectCreate.ts`
- Test: `client/src/features/bid-project/services/expansionProjectCreate.test.ts`
- Modify: `client/src/features/bid-project/pages/ExpansionProjectCreatePage.tsx`
- Create: `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx`
- Create: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`
- Create: `client/src/styles/feature-historical-bid-adaptation.css`
- Modify: `client/src/styles.css`

- [ ] Add failing tests for adaptation naming/options, the six-stage first-step-only contract, and full-width layout.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Add a configuration variant to the reusable upload page, then build the adaptation wrapper and persisted material summary.
- [ ] Add scoped responsive styles using existing upload and action components.
- [ ] Re-run the focused tests and confirm they pass.

### Task 4: Route and list the new project type

**Files:**
- Modify: `client/src/app/AppRouter.tsx`
- Modify: `client/src/features/bid-project/components/BidProjectRow.tsx`
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Test: `client/src/features/bid-project/services/bidProjectList.test.ts`
- Test: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

- [ ] Add or extend failing tests that exercise type filtering, `AppRouter` registration, and reopening the project into the persisted material acceptance view.
- [ ] Run focused tests and confirm failure.
- [ ] Register the page route, creation callback, project label, and list filter option.
- [ ] Re-run focused tests and confirm they pass.

### Task 5: Verify stage one

**Files:**
- Verify all files above without implementing later stages.

- [ ] Run `node --check` for every changed `.cjs` production file.
- [ ] Run focused Node and Vitest tests for navigation, import, services, and page contract.
- [ ] Run `cd client; npm run build`.
- [ ] Run `cd client; npm run smoke:electron-native` because project persistence uses SQLite.
- [ ] Start `npm run dev`, open the new menu, upload the two supplied DOCX files, create the project, reopen it from “我的标书”, and inspect the desktop layout.
- [ ] Stop after the stage-one acceptance surface; do not enable the next stage.
