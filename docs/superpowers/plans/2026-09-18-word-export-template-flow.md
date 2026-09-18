# Word 导出模板流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“我的标书”列表复用第五步已有的“选择模板 -> 导出 -> 打开文件”流程，并禁止第五步在没有正文时导出只有目录的 Word。

**Architecture:** 将导出模板选择、导出进度、警告和打开文件抽成 `export-format` 功能内的复用组件。调用方只提供当前项目名称、正文目录、导出函数和新建模板导航回调；模板配置仍由现有模板 IPC 提供，Word 导出仍走现有 Main IPC 和进度事件。

**Tech Stack:** React 19、TypeScript、Radix Dialog、现有 `window.yibiao` IPC bridge、Node 22 `--experimental-strip-types` 定向测试、Vite build。

---

### Task 1: 固化正文导出资格规则

**Files:**
- Create: `client/src/features/export-format/services/wordExportUi.ts`
- Test: `client/src/features/export-format/services/wordExportUi.test.ts`

- [ ] **Step 1: Write the failing test** for nested outline content detection and empty-content rejection.
- [ ] **Step 2: Run the test to verify it fails** with the helper module missing.
- [ ] **Step 3: Implement the minimal content helper** that treats any non-empty leaf content as exportable.
- [ ] **Step 4: Run the test to verify it passes** with `node --experimental-strip-types --test`.

### Task 2: 抽取复用的 Word 导出交互

**Files:**
- Create: `client/src/features/export-format/components/WordExportDialog.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Add the component contract** for controlled template-dialog opening, an export callback, outline preview statistics, and new-template navigation.
- [ ] **Step 2: Move the existing template selection flow** into the component, preserving template list loading, search, selection, preview, cancellation, and empty-template guidance.
- [ ] **Step 3: Move the existing progress flow** into the component, preserving progress events, warnings, cancellation handling, error state, and the optional “打开文件” action.
- [ ] **Step 4: Keep the existing class names and responsive CSS** so the current fifth-step appearance remains stable in both callers.

### Task 3: 接入第五步正文生成

**Files:**
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: Replace the page-local export dialog state and handlers** with the shared component.
- [ ] **Step 2: Pass the existing outline export payload and generic Word export IPC callback** into the shared component.
- [ ] **Step 3: Make the export toolbar action unavailable when no leaf has non-empty正文 content**, and update its tooltip to explain the requirement.
- [ ] **Step 4: Add source-level regression assertions** that the fifth-step page uses the shared dialog and no longer advertises empty-directory export.

### Task 4: 接入“我的标书”列表

**Files:**
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/features/bid-project/services/duplicateRewriteUi.test.ts`

- [ ] **Step 1: Change the list-page export state** from immediate export to a selected project target.
- [ ] **Step 2: Render the shared dialog** and pass `bidProject.exportWord(projectId, { requestId, exportFormat })` as the export callback.
- [ ] **Step 3: Preserve the existing generating-state restriction** and route “新建模板” to `new-template`.
- [ ] **Step 4: Add source-level regression assertions** for template selection before list export and the open-file completion flow.

### Task 5: Verification

**Files:**
- No additional files.

- [ ] **Step 1: Run the focused helper test.**
- [ ] **Step 2: Run the focused source-level regression tests.**
- [ ] **Step 3: Run `node --check` for changed CommonJS files if any IPC file changes.**
- [ ] **Step 4: Run `cd client; npm run build`.**
- [ ] **Step 5: Review the diff for unrelated changes and confirm both technical-plan workflow kinds still use the same shared flow.**
