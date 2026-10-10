# Client UI Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify every user-facing client page and its dialogs around the restrained visual baseline of the New Bid page, and add a return action from local knowledge-base categories to their secondary directory list.

**Architecture:** Keep feature-owned layouts and behavior, but converge page surfaces, radius, controls, and dialog primitives through existing global tokens and shared CSS. Migrate feature stylesheets in focused batches, beginning with Knowledge Base; route the new return action through `AppRouter` without introducing new IPC or state.

**Tech Stack:** Electron Renderer, React, TypeScript, global CSS tokens, Radix UI, Node.js `node:test`, Vite.

---

## Reference and Constraints

- Design reference: `client/src/features/bid-project/pages/BidProjectCreatePage.tsx` and the `.bid-project-page`, `.bid-project-page-head`, and `.bid-project-list-panel` rules in `client/src/styles/feature-bid-project.css`.
- Approved requirements: `docs/superpowers/specs/2026-10-09-client-ui-unification-design.md`.
- Content panels must use radius <= 8px; inputs and regular controls <= 6px. Preserve the product's global page-height/internal-scroll model.
- Do not change feature workflows, navigation hierarchy, persistence, IPC, Analytics, or developer/test pages.
- Renderer CSS has no lint/test script. Follow existing static style-test patterns in `client/src/styles/uiDensity.test.ts`; run Node tests directly and use `npm run build` as the compile gate.

## File Map

| File | Responsibility |
|---|---|
| `client/src/styles/tokens.css` | Existing global radius, surface, border, and sizing tokens; audit consumers before changing shared values |
| `client/src/styles/shared-components.css` | Shared actions, secondary menu, page-level primitives |
| `client/src/styles/shared-dialog.css` | Shared dialog cards and controls |
| `client/src/styles/app-shell-dialogs.css` | App-shell dialog surfaces |
| `client/src/styles/shared-upload.css` | Reused upload panels and rows |
| `client/src/styles/shared-markdown.css` | Shared Markdown viewers and reading surfaces |
| `client/src/styles/uiDensity.test.ts` | Static assertions for the approved visual baseline |
| `client/src/app/AppRouter.tsx` | Supplies section navigation to the local knowledge-base page |
| `client/src/features/knowledge-base/pages/KnowledgeBasePage.tsx` | Local category view, document viewer, and return action |
| `client/src/styles/feature-knowledge-base.css` | Local and remote knowledge-base surfaces |
| `client/src/styles/feature-bid-project.css` | Reference page plus bid list and dialogs |
| `client/src/styles/feature-bid-project-expansion.css` | Expansion create page |
| `client/src/styles/feature-historical-bid-adaptation.css` | Historical adaptation workflow |
| `client/src/styles/feature-technical-plan.css` | Technical-plan workflow screens and dialogs |
| `client/src/styles/feature-feasibility-report.css` | Feasibility-report workflow screens and dialogs |
| `client/src/styles/feature-duplicate-check.css` | Duplicate-check page |
| `client/src/styles/feature-rejection-check.css` | Rejection-check page |
| `client/src/styles/feature-technical-plan-check.css` | Technical-plan-check page |
| `client/src/styles/feature-export-format.css` | Template list and format editor |
| `client/src/styles/feature-settings.css` | Settings page and its tabbed panels |
| `client/src/styles/feature-developer.css` | Excluded from redesign; only inspect for accidental shared-selector impact |
| `client/src/styles.css` | Existing ordered CSS imports; change only if a new shared stylesheet is genuinely needed |

## Tasks

### Task 1: Lock the shared visual baseline

**Files:**
- Modify: `client/src/styles/uiDensity.test.ts`
- Modify: `client/src/styles/tokens.css`
- Modify: `client/src/styles/shared-components.css`
- Modify: `client/src/styles/shared-dialog.css`
- Modify: `client/src/styles/app-shell-dialogs.css`
- Modify: `client/src/styles/shared-upload.css`
- Modify: `client/src/styles/shared-markdown.css`

- [ ] **Step 1: Add failing radius and shared-surface assertions**

Extend `uiDensity.test.ts` to assert the agreed radius scale and representative shared panel, action, input, dialog, upload, app-shell dialog, and Markdown reading-surface rules. Assertions must encode panel <= 8px and input/regular control <= 6px for in-scope pages; avoid asserting unrelated spacing or colors not required by the spec. Add a selector-level guard that shared-style changes do not alter developer/test surfaces.

- [ ] **Step 2: Run the focused test and confirm it fails on the current radius scale**

Run from `client/`: `node --test src/styles/uiDensity.test.ts`

Expected: the new approved-radius assertions fail against the current 12px/16px/24px token steps or affected shared selectors.

- [ ] **Step 3: Align shared tokens and primitives**

Audit consumers of each shared radius token before changing it. Prefer page/feature-scoped shared selectors and in-scope feature rules; if a shared token or primitive must change and developer/test surfaces consume it, add a developer-scope override that preserves their current appearance. Update shared surface/action/dialog/upload/Markdown declarations that currently bypass the tokens or exceed the limits for in-scope pages. Preserve focus rings, status colors, interaction states, and existing component dimensions unless a mismatch prevents visual consistency.

- [ ] **Step 4: Run the focused test and client build**

Run: `node --test src/styles/uiDensity.test.ts` and `npm run build` from `client/`.

Expected: the style test passes and TypeScript/Vite build exits with code 0.

### Task 2: Unify Knowledge Base and add category-list return

**Files:**
- Modify: `client/src/app/AppRouter.tsx`
- Modify: `client/src/features/knowledge-base/pages/KnowledgeBasePage.tsx`
- Modify: `client/src/styles/feature-knowledge-base.css`
- Modify: `client/src/styles/uiDensity.test.ts`
- Test: add `client/src/features/knowledge-base/knowledgeBasePage.test.cjs` only if a focused structural assertion is needed for the back target.

- [ ] **Step 1: Add a failing navigation assertion**

Add a focused assertion consistent with existing source-level UI tests: the local knowledge-base page receives a section-change callback, and the header return action targets `bid-knowledge-base` while preserving the selected category display.

- [ ] **Step 2: Run the focused assertion and confirm it fails**

Run: `node --test src/features/knowledge-base/knowledgeBasePage.test.cjs` from `client/`.

Expected: FAIL because the category page currently has no return action to the secondary directory list.

- [ ] **Step 3: Implement the return action and align Knowledge Base surfaces**

Pass `onSectionChange` from `AppRouter` to `KnowledgeBasePage`. Make the current “本地知识库” header label a visible secondary action that returns to `bid-knowledge-base`. Align the local category view, document viewer, remote page, empty/loading states, and knowledge-base dialogs with the shared baseline. Preserve folder/document operations, task status, drag/drop, and viewer behavior.

- [ ] **Step 4: Add focused visual assertions and verify**

Extend `uiDensity.test.ts` for knowledge-base panels and controls. Run the focused knowledge-base test, `node --test src/styles/uiDensity.test.ts`, and `npm run build`.

Expected: both tests pass and the build exits with code 0.

### Task 3: Unify bid project and historical adaptation pages

**Files:**
- Modify: `client/src/styles/feature-bid-project.css`
- Modify: `client/src/styles/feature-bid-project-expansion.css`
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`
- Modify: `client/src/styles/uiDensity.test.ts`
- Inspect only as needed: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`, `BidProjectCreatePage.tsx`, `ExpansionProjectCreatePage.tsx`, and `client/src/features/historical-bid-adaptation/pages/HistoricalBidAdaptationPage.tsx`.

- [ ] **Step 1: Add baseline assertions for project and adaptation panels**

Assert the page containers, content panels, and workflow controls use shared surface/radius rules without requiring a shared layout template.

- [ ] **Step 2: Run `node --test src/styles/uiDensity.test.ts` and confirm the new assertions expose remaining outliers**

- [ ] **Step 3: Migrate project, expansion, and adaptation styling**

Align page padding/background, title and operation hierarchy, panels, form controls, cards, and dialogs. Preserve existing project filtering, creation, adaptation steps, progress, and leave guards.

- [ ] **Step 4: Run the focused style test and `npm run build`**

Expected: style assertions pass and the build exits with code 0.

### Task 4: Unify technical-plan and feasibility-report workbenches

**Files:**
- Modify: `client/src/styles/feature-technical-plan.css`
- Modify: `client/src/styles/feature-feasibility-report.css`
- Modify: `client/src/styles/uiDensity.test.ts`
- Inspect only as needed: page components under `client/src/features/technical-plan/pages/` and `client/src/features/feasibility-report/pages/`.

- [ ] **Step 1: Add representative assertions for workbench shells, section panels, and dialogs**

Keep assertions focused on shared visual invariants; do not encode workflow-specific layout as a global rule.

- [ ] **Step 2: Run the style test and record the failing selectors**

- [ ] **Step 3: Migrate workbench surfaces and controls**

Align shared title/action bars, cards, tab controls, dialogs, and empty/loading states with the baseline while preserving multi-step navigation, project state, background tasks, and each workbench's internal scrolling.

- [ ] **Step 4: Run the focused style test and `npm run build`**

Expected: style assertions pass and the build exits with code 0.

### Task 5: Unify checks, templates, business-bid, and shared menu pages

**Files:**
- Modify: `client/src/styles/feature-duplicate-check.css`
- Modify: `client/src/styles/feature-rejection-check.css`
- Modify: `client/src/styles/feature-technical-plan-check.css`
- Modify: `client/src/styles/feature-export-format.css`
- Modify: `client/src/styles/shared-components.css`
- Modify: `client/src/styles/uiDensity.test.ts`
- Inspect only as needed: `client/src/features/business-bid/pages/BusinessBidPage.tsx`, `client/src/features/duplicate-check/pages/DuplicateCheckPage.tsx`, `client/src/features/rejection-check/pages/RejectionCheckPage.tsx`, `client/src/features/technical-plan-check/pages/TechnicalPlanCheckPage.tsx`, `client/src/features/export-format/pages/MyTemplatesPage.tsx`, `ExportFormatPage.tsx`, and `client/src/shared/ui/SecondaryMenuPage.tsx`.

- [ ] **Step 1: Add representative assertions for check pages, template pages, and secondary-menu surfaces**

- [ ] **Step 2: Run the style test and confirm any newly covered legacy selectors fail**

- [ ] **Step 3: Align check, template, business-bid, and secondary-menu styling**

Use existing shared actions and panels; preserve report content, filters, export flows, menu structure, and template editor controls. Do not add a new business-bid stylesheet unless the existing ownership makes a narrowly scoped stylesheet necessary.

- [ ] **Step 4: Run the focused style test and `npm run build`**

Expected: style assertions pass and the build exits with code 0.

### Task 6: Unify Settings and review shared dialog coverage

**Files:**
- Modify: `client/src/styles/feature-settings.css`
- Modify: `client/src/styles/shared-dialog.css` only for shared inconsistencies found during the audit
- Modify: `client/src/styles/uiDensity.test.ts`
- Inspect only as needed: `client/src/features/settings/pages/SettingsPage.tsx` and shared dialog callers.

- [ ] **Step 1: Add assertions for settings page surfaces, tab controls, and dialog forms**

- [ ] **Step 2: Run the focused style test and confirm it detects any remaining outliers**

- [ ] **Step 3: Align Settings panels, tabs, form controls, and settings-owned dialogs**

Preserve settings categories, save/reset behavior, and developer-mode entry points. Do not redesign developer test pages.

- [ ] **Step 4: Run the focused style test and `npm run build`**

Expected: style assertions pass and the build exits with code 0.

### Task 7: Complete route-by-route visual verification

**Files:**
- Modify only the owning feature CSS/component for defects found during verification.
- Test: `client/src/styles/uiDensity.test.ts` and applicable feature UI tests.

- [ ] **Step 1: Run all directly relevant Node tests**

Run from `client/`: `node --test src/styles/uiDensity.test.ts src/features/knowledge-base/knowledgeBasePage.test.cjs` (omit the second path only if no focused test was needed).

- [ ] **Step 2: Run the production build**

Run from `client/`: `npm run build`.

Expected: exit code 0; existing chunk-size warnings alone are not failures.

- [ ] **Step 3: Launch the client and inspect every in-scope route and dialog**

Run from `client/`: `npm run dev`. Check page backgrounds, header/actions, panel and control radii, empty/loading states, dialogs, long-content scrolling, and narrow window fit on these in-scope routes: `bid-projects`, `new-bid`, `existing-plan-expansion`, `historical-bid-adaptation`, all six local knowledge-base categories, `remote-knowledge-base`, `technical-plan`, `feasibility-report`, `business-bid`, `duplicate-check`, `rejection-check`, `technical-plan-check`, `my-templates`, `new-template`, and `settings`. Inspect associated dialogs and viewers on each route. Confirm the Knowledge Base return action lands on the `bid-knowledge-base` secondary directory list. Do not use developer test pages as acceptance routes.

- [ ] **Step 4: Fix only verified visual regressions and rerun build plus focused tests**

- [ ] **Step 5: Review the final diff for unintended shared-selector impact**

Confirm that developer/test pages retain their pre-migration visual appearance and unrelated dirty files are untouched, and that no workflows, data, IPC, or Analytics paths changed.
