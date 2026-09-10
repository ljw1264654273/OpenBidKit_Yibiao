# Score-Driven Technical Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make technical-plan outlines derive their natural structure from scoring requirements, preserve source wording and coverage, treat word-derived leaf counts as advisory, and support up to seven directory levels end to end.

**Architecture:** Keep the existing persistent Agent workflow, SQLite outline model, and IPC contract. Replace leaf allocation with a versioned scoring-plan and coverage-map protocol, add deterministic host validation before and after Agent review, persist coverage metadata in the existing outline-generation task stats, and use baseline comparisons for AI adjustment. Extend every depth-sensitive consumer to preserve a true seventh-level node while deriving its visual formatting from level six.

**Tech Stack:** Electron CommonJS services, Node test runner, React/TypeScript renderer, SQLite store, docx Word export, Vite.

---

### Task 1: Scoring Plan, Coverage Map, and Advisory Capacity

**Files:**
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Test: `client/electron/services/outlineGenerationTaskV2.test.cjs`

- [ ] **Step 1: Write failing tests for the new protocols**

Add tests that expect:

```js
assert.equal(TECHNICAL_SCORE_GROUPS_SCHEMA.properties.version.const, 2);
assert.equal(SCORE_DIRECTORY_PLAN_SCHEMA.properties.branches.items.properties.score_item_level.maximum, 7);
assert.equal(OUTLINE_JSON_SCHEMA.properties.outline.items.oneOf[1].properties.children.items /* recursive max */, 'supports level 7');
assert.deepEqual(buildCapacityReference({ minimumWords: 10000, maximumWords: 14000, sectionWords: 3000 }), {
  suggested_ai_leaf_count: 4,
  advisory_only: true,
});
assert.equal(buildOutlineReviewContext(input).leaf_count.advisory_only, true);
assert.equal(buildOutlineReviewContext(input).structure.max_depth, 7);
```

Cover stable `R/C/P/S` IDs, response-point objects, supplement enums, exact source text, concrete descriptions, score coverage by title/description/both, failure for missing/duplicate mappings, and scoring targets at level seven.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs`

Expected: FAIL because the schemas and advisory-only coverage helpers do not exist yet and depth is capped at six.

- [ ] **Step 3: Implement the protocol and deterministic validators**

In `outlineGenerationTaskV2.cjs`:

```js
const MAX_OUTLINE_DEPTH = 7;
const SCORE_PLAN_VERSION = 2;
const SCORE_COVERAGE_VERSION = 1;

function buildCapacityReference(wordControlOptions) {
  return {
    suggested_ai_leaf_count: deriveTargetLeafCount(normalizeWordControlOptions(wordControlOptions)),
    advisory_only: true,
  };
}

function validateFinalOutline({ outline, scorePlan, scoreCoverageMap, baseline }) {
  // Validate schema, max depth, content modes, new Agent-created single-child
  // branches, concrete descriptions, source order/path, and full-mode coverage.
  return { valid, mandatoryIssues, context };
}
```

Replace `technical-score-groups.json` with the approved v2 structure and add a strict `score-coverage-map.json` schema. Raise both recursive outline schema depth and `SCORE_DIRECTORY_PLAN_SCHEMA.score_item_level` to seven, including prompt wording. Keep `deriveTargetLeafCount()` only for capacity statistics. Remove allocation schemas/helpers and leaf-count pass/fail ranges from review validation.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineGenerationTaskV2.test.cjs
git commit -m "feat: add score-driven outline validation"
```

### Task 2: Directory Agent Workflow and Source-Wording Rules

**Files:**
- Modify: `client/electron/services/bidAnalysisTask.cjs`
- Modify: `client/src/features/technical-plan/services/bidAnalysisWorkflow.ts`
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Modify: `client/electron/resources/agent-workspace.md`
- Test: `client/electron/services/outlineGenerationTaskV2.test.cjs`
- Create: `client/electron/services/bidAnalysisTask.test.cjs`

- [ ] **Step 1: Write failing prompt and workflow tests**

Assert that extraction preserves merged-cell groups, every scoring row, source order, qualifiers, score action shells, and explicit response points. Assert that generation prompts require source wording, keep evaluation dimensions in descriptions, allow controlled additions, prohibit empty headings, and say the capacity number is advisory.

Add workflow-level tests with a fake persistent Agent workspace that prove:

```text
pre-review host validation context is written;
Agent review edits are re-read and revalidated before persistence;
mandatory final-validation failure and cancellation never produce a `checkpointTask` workspace patch containing `outlineData` and never mark the task successful;
user_refuse on optional semantic advice may persist a structurally valid outline;
user cancellation during a mandatory repair exits without replacing the outline.
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd client; node --test electron/services/bidAnalysisTask.test.cjs electron/services/outlineGenerationTaskV2.test.cjs`

Expected: FAIL on absent extraction wording, v2 score-plan output, and obsolete leaf allocation behavior.

- [ ] **Step 3: Replace allocation stages with score-driven generation**

Update the task sequence to:

```text
initial outline -> user selection -> v2 score planning -> natural children generation
-> host pre-review validation -> Agent semantic review -> host final validation -> persistence
```

Delete `leaf-allocation.json`, allocation prompts, leaf adjustment prompts, leaf-count questions, and repeat loops. Generate and validate `score-coverage-map.json`. A mandatory final validation failure must cancel without saving; `user_refuse` applies only to optional semantic improvements. Save the advisory capacity and coverage map under `outlineGenerationTask.stats`.

- [ ] **Step 4: Update shared Agent instructions and extraction prompts**

Document the seven-level limit, source wording normalization boundary, evaluation-dimension handling, controlled additions, specific descriptions, and user-rule precedence in `agent-workspace.md`, `bidAnalysisTask.cjs`, and the renderer-side workflow definition.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cd client; node --test electron/services/bidAnalysisTask.test.cjs electron/services/outlineGenerationTaskV2.test.cjs`

Expected: PASS, including tests proving count mismatch does not ask the user or block persistence.

- [ ] **Step 6: Commit**

```text
git add client/electron/services/bidAnalysisTask.cjs client/src/features/technical-plan/services/bidAnalysisWorkflow.ts client/electron/services/outlineGenerationTaskV2.cjs client/electron/resources/agent-workspace.md client/electron/services/bidAnalysisTask.test.cjs client/electron/services/outlineGenerationTaskV2.test.cjs
git commit -m "feat: generate outlines from scoring requirements"
```

### Task 3: Coverage Persistence Across Manual Edits

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Create: `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs`

- [ ] **Step 1: Write failing store tests**

Create a real temporary SQLite workspace using the repository's Electron `--runAsNode` subprocess pattern and verify:

```js
sort       -> node_ids follow idMap;
edit       -> source link remains and title edits become user_override=renamed;
delete one -> only that node ID is removed and state becomes partially-removed;
delete all -> node_ids=[], coverage_location=none, user_override=removed;
add-*      -> creates stable U<n> user-supplement record;
replace    -> accepts a supplied complete map and never reuses a stale map;
```

- [ ] **Step 2: Run the store test and verify RED**

Run: `cd client; node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs`

Expected: FAIL because `saveOutline()` does not maintain outline-generation task stats.

- [ ] **Step 3: Implement score coverage remapping in the transaction**

Add focused helpers such as:

```js
function updateScoreCoverageForOutlineSave({ coverageMap, reason, idMap, affectedIds, nextOutline }) {
  // Preserve user overrides and remap exactly the nodes affected by the save reason.
  return nextCoverageMap;
}
```

Read and update the existing `outline-generation` task `stats_json` within the same SQLite transaction as the outline mutation. Do not add columns or change IPC validation.

- [ ] **Step 4: Run the store test and verify GREEN**

Run: `cd client; node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs
git commit -m "feat: preserve score coverage across outline edits"
```

### Task 4: AI Adjustment Baseline and Legacy Mode

**Files:**
- Modify: `client/electron/services/outlineAdjustmentTask.cjs`
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Create: `client/electron/services/outlineAdjustmentTask.test.cjs`
- Create: `client/electron/services/outlineAdjustmentTask.baselineValidation.test.cjs`

- [ ] **Step 1: Write failing adjustment tests**

Test full mode inheritance of renamed/partially-removed/removed/added overrides, including continued validation of remaining nodes for partially removed sources; also test temporary `origin_id` stripping, untouched manual single-child and weak-description baseline exemptions, rejection of newly created violations, failure preserving the old directory, and old workspaces using `legacy-structure-only` without fabricated records.

- [ ] **Step 2: Run adjustment tests and verify RED**

Run: `cd client; node --test electron/services/outlineAdjustmentTask.test.cjs electron/services/outlineAdjustmentTask.baselineValidation.test.cjs`

Expected: FAIL because adjustment currently saves the Agent result directly.

- [ ] **Step 3: Implement baseline-aware adjustment**

Export shared validation helpers from `outlineGenerationTaskV2.cjs`. Before invoking the Agent, decorate a working copy with `origin_id` and record node fingerprints. After the Agent response, inherit authorized user overrides, validate only new/changed structural and description violations, strip working fields, then call `saveOutline({ reason: 'replace', scoreCoverageMap })`. On failure, leave the existing outline untouched.

- [ ] **Step 4: Run adjustment tests and verify GREEN**

Run: `cd client; node --test electron/services/outlineAdjustmentTask.test.cjs electron/services/outlineAdjustmentTask.baselineValidation.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add client/electron/services/outlineAdjustmentTask.cjs client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineAdjustmentTask.test.cjs client/electron/services/outlineAdjustmentTask.baselineValidation.test.cjs
git commit -m "feat: protect manual outline changes during AI adjustment"
```

### Task 5: Renderer Semantics and Seven-Level Manual Limit

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Create: `client/src/features/technical-plan/services/outlineDepth.ts`
- Create: `client/src/features/technical-plan/services/outlineDepth.test.ts`

- [ ] **Step 1: Add failing renderer helper coverage**

Create a Node-runnable TypeScript test for a pure `canAddOutlineChild(itemId)` helper that returns `false` for seven ID segments and rejects an eighth level. Add compile-time types for advisory capacity and score coverage stats. Confirm by source assertion that the home-page navigation no longer classifies a leaf-count mismatch as an outline error.

- [ ] **Step 2: Run build/tests and verify RED**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineDepth.test.ts`

Expected: FAIL because `outlineDepth.ts` does not exist yet.

- [ ] **Step 3: Implement UI behavior**

Implement `outlineDepth.ts`, disable “添加子目录” on level seven, guard `addChildItem()` before mutation, update task phase/stats types, change explanatory copy to “字数设置仅用于正文容量和小节篇幅参考”, and remove leaf-count mismatch blocking/dialog logic while retaining the word-control snapshot.

- [ ] **Step 4: Run the build and verify GREEN**

Run these as separate commands so either failure is visible:

```text
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineDepth.test.ts
npm run build
```

Expected: PASS, with only any pre-existing chunk-size warning.

- [ ] **Step 5: Commit**

```text
git add client/src/features/technical-plan/types.ts client/src/features/technical-plan/pages/OutlineEditPage.tsx client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/features/technical-plan/services/outlineDepth.ts client/src/features/technical-plan/services/outlineDepth.test.ts
git commit -m "feat: expose advisory outline capacity and seven levels"
```

### Task 6: Seven-Level Consumers and Word Export

**Files:**
- Modify: `client/electron/services/exportService.cjs`
- Modify: `client/src/shared/types/exportFormat.ts`
- Modify: `client/src/features/export-format/pages/ExportFormatPage.tsx`
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Modify: `client/electron/services/contentIllustrationPlanning.cjs`
- Modify: `client/electron/services/duplicateCheckService.cjs`
- Modify: `client/electron/services/exportService.headingNumbering.test.cjs`
- Create: `client/electron/services/contentGenerationTask.outlineDepth.test.cjs`
- Create: `client/electron/services/contentIllustrationPlanning.outlineDepth.test.cjs`
- Create: `client/electron/services/duplicateCheckService.outlineDepth.test.cjs`

- [ ] **Step 1: Write failing depth and export tests**

Assert that seventh-level IDs survive content prompts, illustration planning, and duplicate path checks. Assert that Word output builds an internal `Heading7` style derived from heading six and prefixes level seven with the complete `item.id` regardless of heading-six `{full}`, `{tail}`, `{num}`, or outline-decimal configuration.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd client; node --test electron/services/exportService.headingNumbering.test.cjs electron/services/contentGenerationTask.outlineDepth.test.cjs electron/services/contentIllustrationPlanning.outlineDepth.test.cjs electron/services/duplicateCheckService.outlineDepth.test.cjs`

Expected: FAIL because current logic caps heading levels and paths at six.

- [ ] **Step 3: Implement true depth with six-level Markdown compatibility**

Preserve directory IDs/tree depth at seven. Where Markdown only supports six hashes, emit level seven as `###### <full-id> <title>` and parse the full ID to recover real depth. Ensure duplicate grouping compares full paths rather than the clamped Markdown heading count.

- [ ] **Step 4: Implement Word Heading7**

Add a `Heading7` paragraph style whose font, size, spacing, color, border, and alignment derive from configured heading six. Level seven must not join the six-level native list and must render explicit text `${item.id} ${item.title}`; level one through six remain unchanged. Add renderer help text that seven-level directories inherit the six-level style.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add client/electron/services/exportService.cjs client/src/shared/types/exportFormat.ts client/src/features/export-format/pages/ExportFormatPage.tsx client/electron/services/contentGenerationTask.cjs client/electron/services/contentIllustrationPlanning.cjs client/electron/services/duplicateCheckService.cjs client/electron/services/*.outlineDepth.test.cjs client/electron/services/exportService.headingNumbering.test.cjs
git commit -m "feat: support seven-level technical outlines"
```

### Task 7: Full Verification

**Files:**
- Verify all modified files

- [ ] **Step 1: Check CommonJS syntax**

Run:

```text
cd client
node --check electron/services/bidAnalysisTask.cjs
node --check electron/services/outlineGenerationTaskV2.cjs
node --check electron/services/outlineAdjustmentTask.cjs
node --check electron/services/technicalPlanStore.cjs
node --check electron/services/exportService.cjs
node --check electron/services/contentGenerationTask.cjs
node --check electron/services/contentIllustrationPlanning.cjs
node --check electron/services/duplicateCheckService.cjs
```

Expected: all exit 0.

- [ ] **Step 2: Run all targeted Node tests**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs electron/services/bidAnalysisTask.test.cjs electron/services/outlineAdjustmentTask.test.cjs electron/services/outlineAdjustmentTask.baselineValidation.test.cjs electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/exportService.headingNumbering.test.cjs electron/services/contentGenerationTask.outlineDepth.test.cjs electron/services/contentIllustrationPlanning.outlineDepth.test.cjs electron/services/duplicateCheckService.outlineDepth.test.cjs`

Expected: zero failures.

- [ ] **Step 3: Run the renderer depth helper test**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineDepth.test.ts`

Expected: zero failures.

- [ ] **Step 4: Run the client build**

Run: `cd client; npm run build`

Expected: exit 0; an existing chunk-size warning is acceptable.

- [ ] **Step 5: Run the Electron native smoke test**

Run: `cd client; npm run smoke:electron-native`

Expected: exit 0.

- [ ] **Step 6: Manually verify Electron and Word export**

Run: `cd client; npm run dev`

Create or load a seven-level outline, confirm level seven cannot add a child, run content and illustration flows far enough to observe preserved full IDs, export Word, and open the DOCX. Verify `Heading7` uses level-six visual settings, displays the complete explicit seven-part ID under each supported level-six numbering mode, leaves levels one through six unchanged, and continues reporting Word export progress. Stop the dev server after verification.

- [ ] **Step 7: Inspect the final diff**

Run: `git diff --check; git status --short; git diff --stat`

Expected: no whitespace errors and only planned files changed.
