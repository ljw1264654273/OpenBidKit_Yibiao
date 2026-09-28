# Responsive Variant Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Electron Main responsive during derived-bid duplicate checking and show determinate per-project progress in the bid list.

**Architecture:** Keep the existing managed-task and SQLite protocols unchanged. Move the CPU-heavy paragraph comparison into a Node worker thread, report comparison progress back to the task runner, and publish it through the existing task event stream. The Renderer restores active task progress on mount and renders the shared `ProgressBar` inside the affected project row.

**Tech Stack:** Electron 41 Main process, Node `worker_threads`, CommonJS services, React 19 TypeScript, shared CSS and `ProgressBar`, Node test runner.

---

### Task 1: Add progress-aware duplicate comparison

**Files:**
- Modify: `client/electron/services/bidContentDuplicateService.cjs`
- Modify: `client/electron/services/bidContentDuplicateService.test.cjs`

- [ ] **Step 1: Write the failing progress test**

Add a test that calls `compareBidContents(input, { onProgress })` with multiple paragraphs and asserts that progress is reported monotonically and ends at `100`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd client; node --test electron/services/bidContentDuplicateService.test.cjs`

Expected: FAIL because the current comparator ignores the progress callback.

- [ ] **Step 3: Implement cached comparison preparation and progress reporting**

Extend the comparator signature to:

```js
function compareBidContents(input = {}, { onProgress } = {})
```

Precompute compact text and n-gram/token sets once per paragraph. Before calculating edit distance, use its maximum possible weighted score to skip pairs that cannot reach the threshold or beat the current best match. Report integer progress during pair comparison and finish with `100` after exact-sentence merging. Preserve the existing return shape and matching thresholds.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd client; node --test electron/services/bidContentDuplicateService.test.cjs`

Expected: all duplicate-service tests pass.

### Task 2: Execute comparison in a worker thread

**Files:**
- Create: `client/electron/services/bidContentDuplicateWorker.cjs`
- Create: `client/electron/services/bidContentDuplicateWorkerService.cjs`
- Create: `client/electron/services/bidContentDuplicateWorkerService.test.cjs`

- [ ] **Step 1: Write the failing worker service test**

Add a test that loads `compareBidContentsInWorker`, starts a realistic comparison, verifies a `setImmediate` callback runs before comparison completion, checks progress reaches `100`, and compares the worker result with the synchronous comparator.

- [ ] **Step 2: Run the worker test and verify RED**

Run: `cd client; node --test electron/services/bidContentDuplicateWorkerService.test.cjs`

Expected: FAIL because the worker service does not exist yet.

- [ ] **Step 3: Implement worker entry and lifecycle wrapper**

The worker entry receives a serializable comparison payload, calls `compareBidContents`, posts `{ type: 'progress', progress }`, then posts `{ type: 'result', result }`. The wrapper creates `new Worker(path.join(__dirname, 'bidContentDuplicateWorker.cjs'))`, forwards progress, terminates on `AbortSignal`, rejects with the signal reason, and cleans all listeners on success, error, exit, or cancellation.

- [ ] **Step 4: Run the worker test and verify GREEN**

Run: `cd client; node --test electron/services/bidContentDuplicateWorkerService.test.cjs`

Expected: worker result parity, progress, responsiveness, and cancellation tests pass.

### Task 3: Publish managed-task comparison progress

**Files:**
- Modify: `client/electron/services/bidProjectVariantDeduplicationTask.cjs`
- Modify: `client/electron/services/bidProjectVariantDeduplicationTask.test.cjs`

- [ ] **Step 1: Write failing task progress assertions**

Extend the task harness to inject an async comparator that emits progress. Assert the task snapshots include increasing comparison-stage progress before any AI rewrite request.

- [ ] **Step 2: Run the task test and verify RED**

Run: `cd client; node --test electron/services/bidProjectVariantDeduplicationTask.test.cjs`

Expected: FAIL because the task currently calls the synchronous comparator and does not forward comparison progress.

- [ ] **Step 3: Integrate the worker comparator**

Default the task to `compareBidContentsInWorker`, pass `taskControl.signal`, map worker progress into the current rewrite round without decreasing overall task progress, and call `updateTask` with a `stats.uniqueness.phase = 'comparing'` payload. Preserve existing result persistence and rewrite behavior.

- [ ] **Step 4: Run the task tests and verify GREEN**

Run: `cd client; node --test electron/services/bidProjectVariantDeduplicationTask.test.cjs electron/services/taskService.variantDeduplication.test.cjs`

Expected: all variant-deduplication tests pass.

### Task 4: Show progress in the bid project row

**Files:**
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/features/bid-project/components/BidProjectRow.tsx`
- Modify: `client/src/styles/feature-bid-project.css`
- Modify: `client/src/features/bid-project/services/duplicateRewriteUi.test.ts`

- [ ] **Step 1: Write the failing UI source test**

Assert the workspace page restores `variant-deduplication` tasks with `getActiveTasks`, stores progress by `project_id`, and passes it to `BidProjectRow`; assert the row renders the shared `ProgressBar` and a percentage label.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `cd client; node --test src/features/bid-project/services/duplicateRewriteUi.test.ts`

Expected: FAIL because the row has no progress UI or restored active-task state.

- [ ] **Step 3: Implement progress state and row presentation**

Subscribe to task events before calling `getActiveTasks`, update only the matching project entry, refresh project data on start/terminal events, and remove terminal progress entries after state refresh. Render `ProgressBar` with `active`, an accessible Chinese label, and compact percentage text without disabling unrelated project actions.

- [ ] **Step 4: Run the UI test and verify GREEN**

Run: `cd client; node --test src/features/bid-project/services/duplicateRewriteUi.test.ts`

Expected: all bid-project UI source tests pass.

### Task 5: Verify syntax, native runtime, and production build

**Files:**
- Verify all modified files.

- [ ] **Step 1: Check CommonJS syntax**

Run:

```powershell
cd client
node --check electron/services/bidContentDuplicateService.cjs
node --check electron/services/bidContentDuplicateWorker.cjs
node --check electron/services/bidContentDuplicateWorkerService.cjs
node --check electron/services/bidProjectVariantDeduplicationTask.cjs
```

Expected: every command exits `0` without output.

- [ ] **Step 2: Run focused regression tests**

Run:

```powershell
cd client
node --test electron/services/bidContentDuplicateService.test.cjs electron/services/bidContentDuplicateWorkerService.test.cjs electron/services/bidProjectVariantDeduplicationTask.test.cjs electron/services/taskService.variantDeduplication.test.cjs src/features/bid-project/services/duplicateRewriteUi.test.ts
```

Expected: zero failures.

- [ ] **Step 3: Verify Electron native modules**

Run: `cd client; npm run smoke:electron-native`

Expected: native smoke check exits `0`.

- [ ] **Step 4: Build the client**

Run: `cd client; npm run build`

Expected: TypeScript and Vite build exit `0`; existing chunk-size warnings are acceptable.
