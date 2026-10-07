# 历史空正文章节定向改写提纲实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让历史标题存在但正文为空的章节在选择“定向改写”后自动生成可校核的推荐提纲。

**Architecture:** 复用 Main 侧 `runHistoricalAdaptationContentTask` 的推荐提纲生成和状态持久化，新增“指定章节推荐”能力；Renderer 在用户切换到定向改写且没有要求文本时触发该任务，并把 `recommended_instruction` 作为可编辑初始内容。已有新增目录和正文迁移路径不改变。

**Tech Stack:** Electron Main CommonJS、React + TypeScript Renderer、SQLite Store、Node test、Vite。

---

### Task 1: Main 侧指定空正文章节生成推荐提纲

**Files:**
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs`
- Test: `client/electron/services/historicalAdaptationContentTask.test.cjs`

- [ ] **Step 1: Write the failing test**：构造历史标题定位成功但 `source_content` 为空的章节，调用 `runHistoricalAdaptationContentTask` 的 `recommendationsOnly + includeNodeId`，断言 AI 收到推荐提纲 Prompt、状态写入 `recommended_instruction` 且不写入正文。
- [ ] **Step 2: Run test to verify it fails**：`cd client; node --test electron/services/historicalAdaptationContentTask.test.cjs`，应因指定章节没有 `recommended_mode` 而未生成提纲。
- [ ] **Step 3: Implement minimal code**：让 `recommendationsOnly` 且指定 `includeNodeId` 的目标章节进入推荐提纲分支；保留批量推荐仅处理 `recommended_mode === 'rewrite'` 的现有规则。
- [ ] **Step 4: Run test to verify it passes**：重新执行同一测试文件，新增用例和既有用例全部通过。

### Task 2: Renderer 在切换定向改写时触发请求并回填

**Files:**
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Test: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`（如现有测试可覆盖）

- [ ] **Step 1: Write the failing test**：覆盖空历史正文章节切换“定向改写”后发起一次指定章节推荐请求的行为。
- [ ] **Step 2: Run test to verify it fails**：执行对应 Renderer 测试，确认当前没有请求。
- [ ] **Step 3: Implement minimal code**：在模式切换处理链路中调用 `onPreparePlan({ projectId, includeNodeId, recommendationsOnly: true })`；增加生成中状态，避免重复请求；完成后同步 `recommended_instruction` 到输入框，失败时允许手工填写。
- [ ] **Step 4: Run test to verify it passes**：执行对应 Renderer 测试及 `npm run build`。

### Task 3: 验收与提交

**Files:**
- No additional files.

- [ ] **Step 1:** 运行 `node --check` 检查 Main 文件。
- [ ] **Step 2:** 运行相关 Node 测试、`npm run build`、`npm run smoke:electron-native`。
- [ ] **Step 3:** 重启 `npm run dev`，在第五步选择空历史正文章节的“定向改写”，确认提纲生成、可编辑、可继续迁移。
- [ ] **Step 4:** 提交代码与设计/计划文档。
