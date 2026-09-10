# Outline Resizable Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为目录生成页面增加多处原文连续展示、桌面三分屏拖拽调宽、隐藏和恢复能力。

**Architecture:** 保留现有 `OutlineEditPage` 数据流和窄屏标签语义，在 Renderer 内增加纯 UI 状态。原文面板仅改变展示方式；宽度拖拽使用相邻面板像素宽度并受最小宽度约束，隐藏时重新均分剩余空间。

**Tech Stack:** React 19、TypeScript、全局 CSS、Node 内置测试运行器。

---

### Task 1: 锁定新行为

**Files:**
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Modify: `client/src/features/technical-plan/services/outlineSourceMatcher.test.ts`

- [ ] 增加原文连续分块渲染的源码回归断言。
- [ ] 增加分屏隐藏、恢复和拖拽控件的源码与 CSS 回归断言。
- [ ] 运行定向测试并确认因功能尚未实现而失败。

### Task 2: 连续展示关联原文

**Files:**
- Modify: `client/src/features/technical-plan/components/TenderSourcePanel.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] 删除索引状态、前后切换按钮和相关 effect。
- [ ] 按来源顺序渲染所有已定位或未定位原文块。
- [ ] 为每块增加中文序号标题和来源类型标签。
- [ ] 运行定向测试并确认通过。

### Task 3: 可调节与可隐藏三分屏

**Files:**
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] 增加面板可见状态、宽度状态和容器引用。
- [ ] 增加桌面分隔线 pointer 拖拽逻辑及最小宽度限制。
- [ ] 在各面板头部增加隐藏按钮，在顶部增加条件恢复入口。
- [ ] 隐藏或恢复时均分当前可见面板宽度。
- [ ] 保留 899px 以下现有标签切换行为。
- [ ] 运行定向测试并确认通过。

### Task 4: 完整验证

**Files:**
- Verify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Verify: `client/src/features/technical-plan/components/TenderSourcePanel.tsx`
- Verify: `client/src/styles/feature-technical-plan.css`

- [ ] 运行全部相关 Node 定向测试。
- [ ] 运行 `npm run build`。
- [ ] 启动 `npm run dev` 并检查桌面与窄窗口行为。
- [ ] 检查最终 diff，确认未改变业务持久化和 IPC 协议。
