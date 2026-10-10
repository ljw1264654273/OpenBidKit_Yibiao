# 技术方案步骤条宽度与页面背景调整实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“新建标书”和“方案扩写”的五个步骤等分铺满，并共用“以标写标”的步骤卡视觉样式和浅色主体背景，同时保留窄屏横向滚动。

**Architecture:** 两个入口本就共用 `TechnicalPlanHome` 的 `technical-workbench-global-scroll` 根容器，因此直接在共用样式上设置页面背景、桌面五等分网格和参考页步骤卡视觉参数；`900px` 以下由现有媒体查询保留五列最小宽度和横向滚动。

**Tech Stack:** React 19、TypeScript、全局 CSS、Node `node:test`、Vite。

---

## 文件结构

- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`：锁定共用背景、桌面五等分样式和窄屏五列滚动。
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`：移除不再需要的新建标书专属根类。
- Modify: `client/src/styles/layout-app-shell.css`：让技术方案全局滚动页保留与参考页一致的 `28px 36px` 壳层内边距。
- Modify: `client/src/styles/feature-technical-plan.css`：在共用作用域内设置浅色背景、五等分步骤网格和参考页卡片样式，移除失效的 `1560px` 规则。

### Task 1: 锁定两个入口的共用视觉契约

**Files:**
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: 写入失败测试**

更新现有“五步流程条”断言，锁定五等分铺满和参考页卡片样式：

```ts
assert.match(css, /\.technical-workbench-global-scroll\s*\{[^}]*background:\s*var\(--yb-page-bg,\s*#f7f9fc\);/s);
assert.match(css, /\.technical-workbench-global-scroll \.technical-plan-stages\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/s);
assert.doesNotMatch(home, /technical-workbench-new-bid/);
assert.doesNotMatch(css, /\.technical-workbench-new-bid \.technical-plan-stages/);
```

同时锁定步骤面板桌面左右 `36px`、窄屏左右 `18px` 的内边距；保留原有媒体查询断言，确保 `900px` 以下仍为五列 `minmax(138px, 1fr)` 并启用横向滚动。

壳层契约断言 `.content-shell:has(.technical-workbench-global-scroll)` 使用 `padding: 28px 36px`，避免整个步骤面板和工作区贴住侧栏；外层留白继续使用应用默认背景。

- [ ] **Step 2: 运行测试并确认按预期失败**

从 `client/` 运行：

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: FAIL，提示桌面五等分或参考页步骤卡样式尚未匹配。

### Task 2: 实现共用背景与步骤密度

**Files:**
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: 移除新建标书专属根修饰类**

恢复两个入口完全共用的根容器类名，不再按 `workflowKind` 追加视觉修饰类。

- [ ] **Step 2: 增加共用背景并改为五等分参考样式**

在 `.technical-workbench-global-scroll` 中增加：

`background: var(--yb-page-bg, #f7f9fc);`

把桌面步骤网格改为 `repeat(5, minmax(0, 1fr))`，并把步骤卡高度、字号、内边距、圆角、背景和当前步骤顶部强调线与“以标写标”保持一致；删除 `.technical-workbench-new-bid` 的 `1560px` 规则。保留现有 `@media (max-width: 900px)` 五列最小宽度和横向滚动规则。

- [ ] **Step 3: 运行定向测试并确认通过**

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: PASS，零失败。

### Task 3: 构建与视觉验证

**Files:**
- Verify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Verify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: 运行客户端构建**

```powershell
npm run build
```

Expected: `tsc --noEmit && vite build` 退出码为 0；既有 chunk 体积警告可接受。

- [ ] **Step 2: 启动并检查三档宽度**

```powershell
npm run dev
```

分别打开“新建标书”和“方案扩写”：桌面宽度下五个步骤等分铺满、视觉与“以标写标”一致且主体背景统一；不超过 `900px` 时仍可横向滚动。

- [ ] **Step 3: 检查差异**

```powershell
git diff --check
git diff -- client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/features/technical-plan/services/workflowLayout.test.ts client/src/styles/feature-technical-plan.css
```

只保留本计划涉及的修改，不覆盖或提交工作区中的既有用户改动。
