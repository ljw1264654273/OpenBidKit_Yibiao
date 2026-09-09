# Technical Plan Workflow Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize STEP 01, 02, 04, 05 and the current STEP 06 placeholder with task-appropriate layouts while preserving all existing technical-plan behavior.

**Architecture:** Add two feature-local UI components: one compact progress/popover component and one adaptive two-pane workspace. Existing pages retain business state and pass their current progress values, labels, actions and pane content into these components. CSS uses existing `--yb-*` tokens, internal scrolling and a `760px` container breakpoint.

**Tech Stack:** React 19, TypeScript, Radix Popover, global CSS, Node test runner, Vite/Electron.

---

## File Map

- Create `client/src/features/technical-plan/components/CompactTaskProgress.tsx`: always-visible progress bar with Radix process-details popover.
- Create `client/src/features/technical-plan/components/AdaptiveTwoPaneWorkspace.tsx`: wide two-pane layout and narrow tabbed single-pane behavior.
- Create `client/src/features/technical-plan/services/workflowLayout.test.ts`: source/CSS contract tests for the approved structure and regressions.
- Modify `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`: add feature-specific compact upload-board hook.
- Modify `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`: move progress to command bar and use adaptive panes.
- Modify `client/src/features/technical-plan/pages/GlobalFactsPage.tsx`: move progress, use adaptive panes, and switch one main area between edit and preview.
- Modify `client/src/features/technical-plan/pages/ContentEditPage.tsx`: move phase progress to command bar and use adaptive panes.
- Modify `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`: restyle the real STEP 06 placeholder without adding new behavior.
- Modify `client/src/styles/feature-technical-plan.css`: compact command bars, feature-specific STEP 01 sizing, shared adaptive workspace/progress styles, and page pane integration.

### Task 1: Shared Progress And Adaptive Workspace

**Files:**
- Create: `client/src/features/technical-plan/components/CompactTaskProgress.tsx`
- Create: `client/src/features/technical-plan/components/AdaptiveTwoPaneWorkspace.tsx`
- Create: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Write failing component contract tests**

Assert that `CompactTaskProgress` always renders `ProgressBar`, exposes a Radix trigger with `aria-label="查看过程"`, and renders details in popover content. Assert that `AdaptiveTwoPaneWorkspace` renders two ARIA tabs and two tabpanels, and the CSS contains `container-type: inline-size` plus `@container (max-width: 759px)`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL because both components and the CSS contracts do not exist.

- [ ] **Step 3: Implement the shared components**

Use these public shapes:

```ts
type WorkspacePane = 'navigation' | 'content';

interface CompactTaskProgressProps {
  value: number;
  label: string;
  summary: string;
  status: string;
  tone?: ProgressBarTone;
  active?: boolean;
  error?: boolean;
  children: ReactNode;
}

interface AdaptiveTwoPaneWorkspaceProps {
  id: string;
  className?: string;
  navigationLabel: string;
  contentLabel: string;
  activePane: WorkspacePane;
  onPaneChange: (pane: WorkspacePane) => void;
  navigation: ReactNode;
  content: ReactNode;
}
```

`CompactTaskProgress` must keep `ProgressBar` outside the popover. `AdaptiveTwoPaneWorkspace` must keep navigation before content in DOM order and hide tabs above the container breakpoint.

- [ ] **Step 4: Add shared feature CSS**

Use compact 36px controls, a bounded process popover, internal pane overflow, and a `760px` content-derived breakpoint. At narrow width show the tab strip and only `.is-active-pane`; at wide width show both panels.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: PASS.

Commit: `feat: add adaptive technical plan workspace primitives`

### Task 2: STEP 02 And STEP 04 Integration

**Files:**
- Modify: `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
- Modify: `client/src/features/technical-plan/pages/GlobalFactsPage.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Add failing page structure tests**

Assert that both pages use `CompactTaskProgress` in their command bars and `AdaptiveTwoPaneWorkspace`. Assert that the old left-pane `progressCollapsed` blocks are absent. For STEP 04 assert an `editorMode` state defaults to `edit`, the preview/edit action toggles it, and editor/preview are conditionally rendered rather than simultaneous columns.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL on page integration assertions.

- [ ] **Step 3: Integrate STEP 02**

Preserve `progress`, `doneCount`, `progressMessage`, error states, copy, retry, JSON rendering and settings behavior. Add local active-pane state; clicking a task selects it and activates the result pane. Move process details to the common command-bar progress component.

- [ ] **Step 4: Integrate STEP 04**

Preserve add/delete/save/copy/config/AI adjustment behavior and current draft synchronization. Add active-pane state and `editorMode: 'edit' | 'preview'` defaulting to edit. Switching a fact group activates the content pane without changing `editorMode`; toggling preview does not save or reset drafts.

- [ ] **Step 5: Update page CSS, run tests and commit**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: PASS.

Commit: `feat: adapt analysis and global facts workspaces`

### Task 3: STEP 05 Phase Progress And Adaptive Workspace

**Files:**
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Add failing STEP 05 tests**

Assert that `displayProgress`, `displayProgressLabel`, `displayProgressCount`, `progressTone`, `progressActive` and `progressDescription` are passed unchanged to `CompactTaskProgress`; the old outline-local progress block is absent; and the page uses the adaptive workspace.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL on STEP 05 contracts.

- [ ] **Step 3: Integrate the shared components**

Keep every existing phase calculation and action state. Place current-phase progress in the command bar, keep failure counts in the popover, and leave retry/continue/pause controls unchanged. Clicking a directory item activates the content pane at narrow widths.

- [ ] **Step 4: Preserve editor and status behavior**

Verify reading, edit, draft preview, save, cancel, regenerate, image preview and fullscreen branches remain byte-for-byte equivalent except for wrapper structure.

- [ ] **Step 5: Run tests and commit**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: PASS.

Commit: `feat: prioritize content workspace during generation`

### Task 4: STEP 01 And STEP 06 Visual Scope

**Files:**
- Modify: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Add failing scope tests**

Assert STEP 01 passes a feature-specific compact class to `UploadBoard` and keeps the existing Markdown reader. Assert STEP 06 retains the under-development message and contains no generated comparison/editor controls.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL on compact hook and placeholder class.

- [ ] **Step 3: Compact STEP 01 without changing uploads**

Add a feature-specific class and CSS overrides only. Preserve multi-file import, drag/drop, remove, original-plan import, document tabs, selected-section hint and Markdown fullscreen behavior.

- [ ] **Step 4: Refine the STEP 06 placeholder**

Add a workflow-specific placeholder class and concise status hierarchy. Do not add settings, comparison data, task buttons or persistence.

- [ ] **Step 5: Run tests and commit**

Run: `node --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: PASS.

Commit: `feat: refine technical plan entry and placeholder layouts`

### Task 5: Regression Verification And Visual QA

**Files:**
- Modify only if a verified issue is found.

- [ ] **Step 1: Run all focused TypeScript tests**

Run: `node --test src/features/technical-plan/services/*.test.ts`

Expected: all tests PASS, including the existing STEP 03 source/fullscreen regression.

- [ ] **Step 2: Run the client build**

Run: `npm run build`

Expected: TypeScript and Vite succeed; existing chunk-size warning is allowed.

- [ ] **Step 3: Start Electron and inspect both workflow kinds**

Run: `npm run dev`

Check STEP 01-06 at `1440x920` and `1040x720`, with sidebar expanded and collapsed. Verify internal scrolling, popover focus/Escape, adaptive tabs, STEP 04 draft-preserving mode switch, STEP 05 pause/failure controls and the bottom `FloatingToolbar`.

- [ ] **Step 4: Capture screenshots and fix verified defects**

Capture representative screenshots for STEP 01, 02, 04, 05 and narrow adaptive mode. Re-run focused tests and build after any fix.

- [ ] **Step 5: Review final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended files and the pre-existing fullscreen regression fix are present.

- [ ] **Step 6: Commit verified fixes**

Commit: `fix: polish technical plan workflow layouts`
