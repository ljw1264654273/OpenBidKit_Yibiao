# 第四步目录操作条布局调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将历史标书适配第四步的目录操作按钮移动到目录树下方，并在窄容器中自动换行，保持现有行为不变。

**Architecture:** 仅调整 `AdaptationOutlinePage` 的 DOM 分组和 `feature-historical-bid-adaptation.css` 的布局规则。适配目录栏采用“标题 / 滚动目录树 / 独立操作条”三行结构，操作条位于滚动容器外。

**Tech Stack:** React + TypeScript、全局 CSS、Vite。

---

### Task 1: 调整第四步适配目录 DOM 结构

**Files:**
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationOutlinePage.tsx`（适配目录栏 JSX）

- [ ] **Step 1: 保留现有按钮行为并拆出操作条**

将 `适配后目录` 标题行中的七个按钮移到 `.adaptation-outline-scroll` 之后的独立 `.adaptation-outline-toolbar` 容器；保留按钮文案、事件处理和禁用条件不变。

- [ ] **Step 2: 检查结构边界**

确认操作条不在目录树滚动容器内部，目录树仍由现有 `.adaptation-outline-scroll` 承担滚动。

### Task 2: 调整目录栏布局与响应式样式

**Files:**
- Modify: `client/src/styles/feature-historical-bid-adaptation.css`（适配目录栏、操作条样式）

- [ ] **Step 1: 将适配目录栏改为三行网格**

把 `.adaptation-outline-column.is-adapted` 设置为标题、滚动区、操作条三行结构，并保持 `min-height: 0`，使目录树继续占用可伸缩空间。

- [ ] **Step 2: 让操作条在自身区域换行**

移除操作条的横向滚动策略，明确 `overflow-x: visible`（或等效不滚动规则）与 `width: 100%`，使用 `display: flex`、`flex-wrap: wrap`、合理 `gap` 和与标题区域一致的内边距/边框层级；保留危险按钮样式。

### Task 3: 构建验证

**Files:**
- Test: `client/` 构建产物（不新增测试文件）

- [ ] **Step 1: 运行客户端构建**

Run: `cd client; npm run build`

Expected: `tsc --noEmit` 与 `vite build` 均退出码 0；既有 chunk 体积警告可忽略。

- [ ] **Step 2: 检查工作区差异**

Run: `git diff --check`

Expected: 无空白错误；确认差异仅包含本次组件、样式和计划文档。

- [ ] **Step 3: 目视检查第四步布局**

在桌面宽度和窄容器下打开历史标书适配第四步，确认标题行无操作按钮，目录树滚动不会带走操作条，操作条只在自身区域换行且按钮仍可聚焦和点击。
