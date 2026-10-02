# Historical Adaptation Local Rewrite Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve compatibility with legacy historical-adaptation data and model response aliases without allowing explicit `none` scopes or full-section model responses to bypass local-rewrite boundaries.

**Architecture:** Infer automatic scopes only while normalizing persisted legacy differences that genuinely lack `content_change_scope`; the content runner consumes only the resulting explicit scope. Normalize harmless response aliases, validate edits against the source before accepting them, and use the existing AI JSON repair hook when a model returns a full section or invalid edits.

**Tech Stack:** Electron CommonJS services, Node.js test runner, existing `aiService` JSON normalizer/validator/repair APIs.

**Legacy correction:** Production data inspection showed that the previous release normalized every missing model scope to an explicit `none` before its first persistence. Persisted reads therefore also recognize the narrow legacy signature where the entire valid difference batch is explicit `none`, then apply the same conservative classifier. Mixed-scope batches and ordinary runtime/write normalization still preserve explicit `none`.

---

### Task 1: Backfill only genuinely legacy difference scopes

**Files:**
- Modify: `client/electron/services/historicalAdaptationDifferenceTask.cjs`
- Modify: `client/electron/services/historicalAdaptationDifferenceTask.test.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.test.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Test: `client/electron/services/technicalPlanStore.historicalAdaptationDifferences.test.cjs`

- [x] Add failing tests proving only an own-property-absent legacy scope is inferred; explicit `none`, `null`, empty, and invalid values remain conservative `none`.
- [x] Cover project-name, general numeric, personnel, equipment, ignored, and unconfirmed differences so coarse categories never become an automatic scope.
- [x] Run the two focused test files and confirm the new assertions fail for the expected reason.
- [x] Add a focused legacy-scope classifier and opt-in normalization mode used only when loading persisted state.
- [x] Route all three persisted-difference reads in `technicalPlanStore.cjs` through one helper; write/runtime normalization remains non-inferential.
- [x] Remove runtime scope inference from the content runner. When inferred scope changes the plan fingerprint, invalidate prior automatic results; retain every explicit `manual_mode`, but retain a completed result only for manual `direct`. Manual `local-rewrite` and `rewrite` keep their selection while becoming stale/idle for rerun.
- [x] Add runner coverage proving explicit `none` selects `direct` and performs no AI request, plus separate fingerprint migration coverage for automatic, manual `direct`, manual `local-rewrite`, and manual `rewrite` prior results.
- [x] Re-run the difference, content, and store focused tests and confirm they pass.

### Task 2: Repair invalid local-rewrite responses without applying full sections

**Files:**
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.test.cjs`

- [x] Add failing tests proving full-section responses with out-of-scope changes are never saved and explicit edit aliases remain supported.
- [x] Add failing tests rejecting a whole-source edit and an edit that changes unrelated workload, personnel, or amount facts alongside an allowed location change; rejection must leave the source untouched and mark the item `review` if repair fails.
- [x] Add a failing test proving the repair prompt receives source text, allowed differences, and validation errors.
- [x] Run the content-task test and confirm the new assertions fail for the expected reason.
- [x] Remove line-based full-section diff conversion.
- [x] Normalize only structural aliases and configure `repairMessagesBuilder` with the required context.
- [x] Add deterministic locality validation: reject whole-source or disproportionate replacements, require every `old_text` to overlap an allowed historical marker, preserve fact tokens outside the allowed scope, and then dry-run `applyTextEdits()` for uniqueness and overlap.
- [x] Preserve the existing fallback to migrated source plus `review` when repair cannot produce safe edits.
- [x] Re-run the focused content-task test and confirm it passes.

### Task 3: Regression verification

**Files:**
- Verify all files modified by Tasks 1 and 2.

- [x] Run `node --check` for each modified CommonJS service.
- [x] Run the focused historical-adaptation difference, content, and store tests.
- [x] Run `npm run smoke:electron-native` because persisted store normalization changes.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and inspect the final diff for unrelated changes.
