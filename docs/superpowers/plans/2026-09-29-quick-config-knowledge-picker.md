# 快速配置知识库选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在技术方案 STEP 01 快速配置末尾增加一行知识库多选入口，并通过分类、归属地、文件夹和文档筛选弹窗保存本地及远程参考知识库。

**Architecture:** 复用现有 `referenceKnowledgeDocumentIds` 与 `remoteKnowledgeScopes` 持久化协议，不增加数据库字段。新增纯函数模块负责本地知识库筛选、批量选择和摘要计算，新增独立 React 组件负责加载索引、维护弹窗草稿及调用保存回调；`DocumentAnalysisPage` 只负责放置组件，`TechnicalPlanHome` 继续通过现有 `saveOutlineConfig()` 写入同一权威状态，因此 STEP 03 自动保持一致。

**Tech Stack:** React 19、TypeScript、Radix Dialog、全局 CSS、Node `node:test`。

---

### Task 1: 本地知识库筛选与选择逻辑

**Files:**
- Create: `client/src/features/technical-plan/services/knowledgeReferenceSelection.ts`
- Create: `client/src/features/technical-plan/services/knowledgeReferenceSelection.test.ts`

- [ ] **Step 1:** 编写失败测试，覆盖类型/省市/关键词筛选、仅保留 success 文档、文件夹批量切换、筛选结果批量切换和摘要分组。
- [ ] **Step 2:** 运行 `node --test --experimental-strip-types src/features/technical-plan/services/knowledgeReferenceSelection.test.ts`，确认因模块不存在而失败。
- [ ] **Step 3:** 实现最小纯函数接口。
- [ ] **Step 4:** 重跑定向测试并确认通过。

### Task 2: STEP 01 知识库选择弹窗组件

**Files:**
- Create: `client/src/features/technical-plan/components/KnowledgeReferenceQuickConfig.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1:** 先在布局测试中声明快速配置知识库行、双栏 Dialog、本地分类/归属地筛选、已选区和远程页签的结构要求。
- [ ] **Step 2:** 运行布局测试，确认新增断言失败。
- [ ] **Step 3:** 实现组件：加载全部本地知识库、单行摘要、分类与省市筛选、文件夹/文档多选、选择当前结果、右侧已选列表、本地/远程页签、取消与确认。
- [ ] **Step 4:** 增加与现有工作台一致的紧凑样式和窄窗口降级。
- [ ] **Step 5:** 重跑布局测试并确认通过。

### Task 3: 页面接线与统一持久化

**Files:**
- Modify: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1:** 添加失败断言，要求 `DocumentAnalysisPage` 接收现有知识库状态并通过回调保存，`TechnicalPlanHome` 使用 `saveOutlineConfig()` 保留其他目录配置。
- [ ] **Step 2:** 运行布局测试，确认新增断言失败。
- [ ] **Step 3:** 在快速配置最末行挂载组件，并在首页接入现有状态和保存函数。
- [ ] **Step 4:** 重跑布局测试并确认通过。

### Task 4: 回归与界面自测

**Files:**
- Verify only.

- [ ] **Step 1:** 运行新增纯函数测试。
- [ ] **Step 2:** 运行 `node --test --experimental-strip-types src/features/technical-plan/services/workflowLayout.test.ts`。
- [ ] **Step 3:** 运行 `npm run build`。
- [ ] **Step 4:** 启动 `npm run dev`，手动检查快速配置展开、弹窗筛选、多选、取消、确认、窄窗口和 STEP 03 状态同步；若环境无法完成 Electron UI 检查，明确记录限制和已完成的替代验证。
