# 第五步正文预览字体一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复第五步正文预览中列表引导语和部分正文被浏览器默认粗体放大的问题，使正文预览的字体、字号、行高和强调字重稳定一致，同时不影响 Word 导出和其他 Markdown 页面。

**Architecture:** 在 `ContentEditPage.tsx` 的三个第五步预览入口上复用一个专用 CSS class；在 `feature-technical-plan.css` 中仅对该 class 下的正文段落、无序列表和有序列表层级设置 typography。普通正文与无序列表使用 `--ef-body-*`，有序列表使用对应 `--ef-body-outline-N-*` 字体/字号，所有层级沿用全局 `--ef-body-line-height`；正文内 `strong/b` 固定为 `600`，不使用 `bolder`。

**Tech Stack:** React + TypeScript, CSS custom properties, Node `node:test`, Vite build.

---

### Task 1: Add the regression assertions

**Files:**
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: Write the failing assertions**

Add a focused test for the fifth-step preview typography contract. Read `ContentEditPage.tsx` and `feature-technical-plan.css`, then assert:

- Both content preview usages carry `technical-plan-content-preview`.
- The class appears in the editing preview and saved-content preview paths, and `MarkdownFullscreenViewer` receives the same class so its normal and fullscreen bodies share the scope.
- The feature stylesheet contains explicit body typography and list-level selectors under `.technical-plan-content-preview`.
- Body emphasis uses `font-weight: 600`, `--ef-body-font`, and `--ef-body-size`.
- Ordered-list levels use `--ef-body-outline-1-*` through `--ef-body-outline-5-*`, while line-height uses `--ef-body-line-height`.
- The emphasis selectors exclude `.markdown-figure-caption` and do not introduce a global `.markdown-viewer.export-format-preview strong` rule.

- [ ] **Step 2: Run the regression test and verify it fails for the intended reason**

Run from `client/`:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: the new typography test fails because the preview class and scoped CSS rules are not yet present. Existing unrelated assertions should continue to pass.

### Task 2: Scope the fifth-step preview

**Files:**
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx:1199-1208`

- [ ] **Step 1: Add the dedicated preview class to both render branches**

Append `technical-plan-content-preview` to the existing className used by:

- the editing preview branch (`draftContent`)
- the saved selected-content branch (`selectedContent`)

Do not change the shared `MarkdownRenderer`, `MarkdownFullscreenViewer`, export format variables, Markdown source, or Word export code. Because `MarkdownFullscreenViewer` reuses its `className` for both the inline viewer and fullscreen dialog content, this single class keeps both views aligned.

- [ ] **Step 2: Run the focused regression test**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: the class-related assertions pass; the stylesheet assertions remain red until Task 3.

### Task 3: Add scoped typography rules

**Files:**
- Modify: `client/src/styles/feature-technical-plan.css` after the existing `.content-generation-output` block around line 2005

- [ ] **Step 1: Add the minimal scoped CSS**

Add rules under `.technical-plan-content-preview` only:

- Top-level, non-list body paragraphs use `--ef-body-font`, `--ef-body-size`, and `--ef-body-line-height`.
- Top-level unordered lists and their list content use the body font/size and global body line-height.
- Ordered list levels 1 through 5 use explicit, level-specific selectors with their existing outline font/size variables and the global body line-height.
- `strong` and `b` inside non-caption body paragraphs, unordered-list content, and each ordered-list level use explicit matching font/size selectors and fixed `font-weight: 600`.
- Keep selectors constrained to paragraph/list content so headings, table cells, and `.markdown-figure-caption` are not targeted.
- Do not set `font-weight: 700` or `bolder`; do not change spacing, alignment, numbering, or Markdown content.

Use the existing CSS custom properties rather than duplicating configured font names or sizes. Do not add line-height configuration fields.

- [ ] **Step 2: Run the focused regression test**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: all tests in this file pass.

### Task 4: Build and visually verify

**Files:**
- No additional source files expected.

- [ ] **Step 1: Run the client build**

Run:

```powershell
cd client
npm run build
```

Expected: `tsc --noEmit` and `vite build` exit with code 0. Existing chunk-size warnings are acceptable if the command succeeds.

- [ ] **Step 2: Start the development client**

Run:

```powershell
npm run dev
```

Use the existing Vite/Electron development flow and inspect STEP 05 with a fixed Markdown fixture containing:

- normal paragraphs
- `**加粗引导语：**` followed by normal text
- at least two nested ordered-list levels
- a table and image caption

- [ ] **Step 3: Capture visual evidence**

Check the inline viewer and fullscreen viewer at desktop size. Confirm:

- saved正文查看、编辑后预览和全屏预览都使用相同的专用 class 和 typography
- body paragraphs and unordered-list content use the same configured body typography
- ordered-list text and numbering use their configured outline level font/size
- all levels use the same configured body line-height
- bold lead-ins remain distinguishable but are no longer disproportionately heavy
- headings, table cells, image captions, and feasibility-report previews are unchanged

- [ ] **Step 4: Review the diff**

Run:

```powershell
git diff --check
git status --short
```

Confirm only the intended implementation files and the already-created design/plan documentation are present; do not revert unrelated user changes in `OutlineEditPage.tsx` or its test/style files.
