# Outline Source Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace heuristic directory-source highlighting with conservative, document-bound source anchors for P0 and P1.

**Architecture:** Electron Main canonicalizes each generated coverage record and attaches a source anchor only for a unique match in the current tender Markdown. Renderer validates and consumes the anchor, while legacy maps use the same conservative locator and never select the first of multiple matches.

**Tech Stack:** Electron CommonJS services, React 19, TypeScript 5.9, Node test runner, SQLite JSON task state.

**Spec:** `docs/superpowers/specs/2026-09-11-outline-source-anchors-design.md`

## Global Constraints

- Keep existing directory/content workflows, Analytics, and SQLite tables unchanged.
- Do not generate anchors for professional or user supplements.
- Do not auto-locate zero-match or multiple-match sources.
- Preserve Windows Chinese-path and UTF-8 behavior.

---

### Task 1: Main source-anchor resolver

**Files:**
- Create: `client/electron/services/outlineSourceAnchorService.cjs`
- Create: `client/electron/services/outlineSourceAnchorService.test.cjs`

**Interfaces:**
- Produces: `locateUniqueSourceText(markdown, sourceText)` and `attachScoreCoverageAnchors({ markdown, scorePlan, scoreCoverageMap })`.

- [x] Write tests proving unique exact and whitespace matches return anchored ranges, while duplicate and missing text return no anchor.
- [x] Run `node --test electron/services/outlineSourceAnchorService.test.cjs` and confirm the missing module/API failure.
- [x] Implement deterministic normalization, SHA-256 document binding, canonical source lookup, and anchor attachment.
- [x] Run the focused test and confirm it passes.

### Task 2: Persist anchors after generation and adjustment

**Files:**
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Modify: `client/electron/services/outlineGenerationTaskV2.test.cjs`
- Modify: `client/electron/services/outlineAdjustmentTask.cjs`
- Modify: `client/electron/services/outlineAdjustmentTask.test.cjs`

**Interfaces:**
- Consumes: `attachScoreCoverageAnchors(...)` from Task 1.
- Produces: final `score_coverage_map.version=2` with canonical source fields and optional anchors.

- [x] Add failing generation tests for host-owned canonical source text and v2 anchors.
- [x] Run focused generation tests and confirm the new assertions fail.
- [x] Attach anchors after final outline validation and before success persistence.
- [x] Add failing adjustment tests proving Agent-provided anchors/text are replaced from previous authoritative records.
- [x] Recompute anchors after AI adjustment and run both focused suites green.

### Task 3: Conservative Renderer matching and exact presentation

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/technical-plan/services/outlineSourceMatcher.ts`
- Modify: `client/src/features/technical-plan/services/outlineSourceMatcher.test.ts`
- Modify: `client/src/features/technical-plan/components/TenderSourcePanel.tsx`
- Modify: `client/src/shared/ui/MarkdownRenderer.tsx`
- Modify: `client/src/shared/ui/MarkdownFullscreenViewer.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

**Interfaces:**
- Consumes: optional `ScoreSourceAnchor` and current Markdown.
- Produces: located items only for valid anchors or unique legacy matches; duplicate legacy matches are unlocated.

- [x] Add failing tests for duplicate rejection, valid/stale anchor behavior, and absence of broad keyword highlighting.
- [x] Run the TypeScript test command and confirm expected failures.
- [x] Implement anchor validation, conservative fallback, range-bound highlighting, and anchor-aware fullscreen scrolling behavior.
- [x] Run focused Renderer tests green.

### Task 4: Full verification

**Files:**
- Verify all files changed in Tasks 1-3.

- [x] Run `node --check` for every changed `.cjs` file.
- [x] Run focused Main and Renderer test suites.
- [x] Run `npm run smoke:electron-native`.
- [x] Run `npm run build` and treat only exit code 0 as success.
- [x] Re-run the current-data diagnostic and verify duplicate sources are not reported as located.
- [x] Review `git diff` and confirm `.claude/` and unrelated changes remain untouched.
