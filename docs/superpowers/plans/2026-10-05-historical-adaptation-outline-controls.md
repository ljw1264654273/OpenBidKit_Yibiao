# Historical Adaptation Outline Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collapsible, status-marked historical adaptation outline controls and persist each chapter's decision to reuse or reprocess historical content, with that decision honored by the content migration task.

**Architecture:** Extend the existing historical outline change record with an optional `reuse_original` flag and preserve it through normalization, ID remapping, and outline saves. Keep the UI state local to `AdaptationOutlinePage`, but persist user decisions through the existing `saveHistoricalAdaptationOutline` IPC. During content-plan construction, derive a deterministic effective mode from the explicit reuse choice before falling back to current recommendations, so existing chapters use historical正文 as the default底稿 while confirmed content adjustments still run; added chapters and opt-outs cannot silently direct-copy.

**Tech Stack:** React + TypeScript renderer, Electron CommonJS services, SQLite JSON metadata, existing Toast and CSS systems, Node built-in test runner.

---

## Files and Responsibilities

- Modify `client/src/features/technical-plan/types.ts`: add the optional `reuse_original` field to `HistoricalAdaptationOutlineChange`.
- Modify `client/electron/services/historicalAdaptationOutlineTask.cjs`: normalize and emit `reuse_original`, defaulting legacy/AI unchanged nodes to reuse and added nodes to opt out.
- Modify `client/electron/services/technicalPlanStore.cjs`: preserve the flag through remapping and expose it in returned state; ensure strategy reset/rebuild respects the outline decision.
- Modify `client/electron/services/historicalAdaptationContentTask.cjs`: materialize the explicit outline decision into each content item, make it override stale/manual recommendations, and export a helper suitable for unit tests.
- Modify `client/electron/services/historicalAdaptationContentCheckTask.cjs` if its check context independently derives effective modes: consume the materialized item decision and include it in the check fingerprint.
- Modify `client/src/features/historical-bid-adaptation/components/AdaptationOutlinePage.tsx`: add collapsible tree state, bulk expand/collapse controls, row actions/status markers, and persisted reuse selector.
- Modify `client/src/styles/feature-historical-bid-adaptation.css`: style tree rows, status badges, icon actions, reuse control, and responsive toolbar wrapping.
- Add/update `client/electron/services/historicalAdaptationOutlineTask.test.cjs`: normalization/default behavior tests.
- Add/update `client/electron/services/historicalAdaptationContentTask.test.cjs`: effective mode precedence tests.
- Add/update `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs` or a focused component source assertion if the existing test harness does not mount React components.

### Task 1: Lock down persisted reuse semantics with tests

**Files:**
- Test: `client/electron/services/historicalAdaptationOutlineTask.test.cjs`
- Test: `client/electron/services/historicalAdaptationContentTask.test.cjs`

- [ ] **Step 1: Add normalization tests**

Add cases asserting that `normalizeAdaptedOutlineResult` emits `reuse_original: true` for `unchanged`, `renamed`, `updated`, and `moved` nodes, `false` for `added`, and preserves an explicit supplied boolean. Add a legacy normalization case with no flag and verify the inferred default.

- [ ] **Step 2: Add effective-mode precedence tests**

Test a node with `reuse_original: true`, a reliable source, and `recommended_mode: local-rewrite` resolves to `local-rewrite`; a node with `reuse_original: true` but no reliable source resolves to `null`/review rather than direct; a node with `reuse_original: false` and `recommended_mode: direct` resolves to a non-direct mode; an added node without source resolves to `null`/review rather than direct. Keep existing `manual_mode` precedence tests passing.

- [ ] **Step 3: Run the focused tests and confirm the new assertions fail**

Run:

```powershell
cd client
node --test electron/services/historicalAdaptationOutlineTask.test.cjs electron/services/historicalAdaptationContentTask.test.cjs
```

Expected: existing tests pass where unchanged, and the new assertions fail because the flag and precedence are not implemented yet.

### Task 2: Persist and derive outline reuse decisions in Main

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/electron/services/historicalAdaptationOutlineTask.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`
- Test: files from Task 1

- [ ] **Step 1: Extend the shared type and normalizer**

Add `reuse_original?: boolean` to `HistoricalAdaptationOutlineChange`. In the outline-task normalizer, include the boolean when present; when absent, infer `change_type !== 'added'` for compatibility. Include the flag in AI-generated change objects and preserve it when deduplicating.

- [ ] **Step 2: Preserve the flag during Store ID remapping**

Keep the existing `normalizeHistoricalAdaptationOutlineChanges(request.changes).map(...)` flow in `technicalPlanStore.cjs`; copy the normalized object unchanged while remapping only `target_node_id` and `target_title`. Verify deleted records remain untouched and sort retains the flag.

- [ ] **Step 3: Define deterministic effective mode and clear stale direct overrides**

Update `getEffectiveMode(item, outlineChange)` (or an equivalent helper) so explicit reuse wins only when the item has a reliable historical source (`source_path` plus `source_content_hash`/`source_excerpt`): `reuse_original === true` returns `direct` with a reliable source, otherwise returns `null`/review and never fabricates a direct migration. `reuse_original === false` must never return `direct`. When a user turns reuse off, clear an existing `manual_mode: direct` before saving the outline decision, then select an existing non-direct mode or the current reliable-source fallback (`local-rewrite`), otherwise `rewrite`/review as already required by current data. A reuse=true choice may override any stale non-direct recommendation, but an explicit non-direct manual mode remains respected when reuse is false.

- [ ] **Step 4: Materialize the outline decision into content items and checks**

In `buildHistoricalContentItems`, map outline changes by node and write a normalized `reuse_original` value into every generated content item (or an equivalent explicit item field consumed by all downstream code). Set the effective mode from that field, retain added-node source blocking, and do not fabricate source content for added nodes. Update `getHistoricalAdaptationContentCheckContext` and `historicalAdaptationContentCheckTask.cjs` to carry the same materialized decision and include it in fingerprints/check inputs, so switching reuse invalidates stale plans and consistency checks cannot silently use an old direct mode.

- [ ] **Step 5: Run focused tests and syntax checks**

Run:

```powershell
cd client
node --check electron/services/historicalAdaptationOutlineTask.cjs
node --check electron/services/technicalPlanStore.cjs
node --check electron/services/historicalAdaptationContentTask.cjs
node --test electron/services/historicalAdaptationOutlineTask.test.cjs electron/services/historicalAdaptationContentTask.test.cjs
```

Expected: PASS with the new reuse/default and mode-precedence assertions.

### Task 3: Implement collapsible and status-aware adaptation outline UI

**Files:**
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationOutlinePage.tsx`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`

- [ ] **Step 1: Add tree helpers and local state**

Add `expandedIds` state, collect all branch IDs from the adapted outline, and reset/repair the set when `outlineData` changes. Add handlers for toggle-one, expand-all, and collapse-all. Keep this state local; do not persist UI expansion.

- [ ] **Step 2: Render status-aware rows**

Pass the relevant change record into `OutlineTree`. Render a row class and text badge using precedence `added > adjusted > reused`, where adjusted covers renamed/updated/moved. Include `aria-label`/`title` text so the meaning is available without color. Render a disclosure button for branches and a selected row button for the content.

- [ ] **Step 3: Add row-level edit/delete actions**

Add compact icon-style buttons with Chinese `aria-label` and `title` for edit/select and delete. Keep the existing right-side editor as the actual edit form and route delete through `deleteSelected`/existing persistence so children and change records remain consistent. Disable actions under the existing running/saving locks.

- [ ] **Step 4: Add reuse selector to details and invalidate stale direct strategy**

Derive the selected node's change record and effective reuse state. Render a labeled select or switch with “沿用历史原文” and “按适配规则处理”. Disable reuse when no reliable source path is available; for added nodes show the explanatory hint. On change, update the selected change record, create a record for a previously unchanged node if needed, and when switching off reuse clear any existing `manual_mode: direct` for that node (or persist an equivalent explicit opt-out) before calling `saveHistoricalAdaptationOutline`; retain the selected node after ID remapping.

- [ ] **Step 5: Add expand/collapse toolbar controls**

Add “全部展开” and “全部折叠” to the adapted-column toolbar. Ensure mobile wrapping stays within the existing scrollable header and the original read-only tree is unaffected.

- [ ] **Step 6: Style the new states**

Add CSS for `.is-reused`, `.is-added`, `.is-adjusted`, row badges, disclosure buttons, action buttons, reuse field, disabled source hint, hover/focus states, and small-screen toolbar wrapping. Preserve existing palette and 4px radius conventions.

- [ ] **Step 7: Run the renderer build**

Run:

```powershell
cd client
npm run build
```

Expected: TypeScript and Vite build exit 0; existing chunk-size warnings are acceptable.

### Task 4: Verify reset, remap, and migration regression behavior

**Files:**
- Test: `client/electron/services/technicalPlanStore.historicalAdaptationOutline.test.cjs`
- Test: `client/electron/services/historicalAdaptationContentTask.test.cjs`
- Test: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

- [ ] **Step 1: Add Store persistence/remap coverage**

Save an adapted outline with explicit reuse flags, sort and edit it, reload the Store, and assert flags remain attached to the remapped node IDs. Delete a node and assert its change record is removed while deleted-history metadata remains.

- [ ] **Step 2: Add migration behavior coverage**

Build a state containing one reused historical node, one adjusted historical node, one added node, and one node with a stale `manual_mode: direct` that is explicitly opted out. Assert the reused node receives direct mode, the adjusted node follows the selected non-direct strategy, the opted-out node clears/overrides direct and never receives direct mode, and the added node never receives a direct source copy. Assert the consistency-check input fingerprint changes when the reuse decision changes.

- [ ] **Step 3: Add source-level UI assertions**

Extend the existing historical adaptation page test to assert the outline component contains expand/collapse controls, reuse labels, and status class names/labels. Keep the test focused on contract text rather than brittle DOM layout details.

- [ ] **Step 4: Run the complete scoped verification**

Run:

```powershell
cd client
node --test electron/services/technicalPlanStore.historicalAdaptationOutline.test.cjs electron/services/historicalAdaptationOutlineTask.test.cjs electron/services/historicalAdaptationContentTask.test.cjs src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs
npm run smoke:electron-native
npm run build
```

Expected: all selected tests pass, native smoke exits 0, and the renderer build exits 0.

