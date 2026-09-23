# 完全一致句子查重规则实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将两份标书正文对比中的“完全一致句子”收紧为完整句子级匹配，并排除短语、词语和短口号。

**Architecture:** 保持现有 `compareBidContents()`、段落相似度和结果协议不变，只调整 `bidContentDuplicateService.cjs` 内的句子边界、候选过滤和完全一致句子收集。用服务层回归测试锁定短表达、句内标点、句末标点和英文边界行为。

**Tech Stack:** Electron Main CommonJS、Node.js `node:test`。

---

### Task 1: 补充失败回归测试

**Files:**
- Modify: `client/electron/services/bidContentDuplicateService.test.cjs`

- [x] **Step 1: 增加短表达不计入测试**

覆盖“质量第一”“项目概况”“后续安排”等两边完全相同但有效长度不足 8 的表达，断言 `exactSentenceCount` 不增加，并确认没有 `exactSentences` 结果。

- [x] **Step 2: 增加句内标点不切句测试**

覆盖只共享逗号、冒号或分号前后片段的情况，断言不会把片段识别为完全一致句子；同时覆盖带句末标点的完整句子仍能匹配。

- [x] **Step 3: 调整现有短句与缩写测试**

将旧测试中依赖短表达命中的断言改为新的规则，并保留小数、英文缩写、长标题、7/8 字符边界、跨段落和换行完整句子匹配覆盖。

- [x] **Step 4: 运行定向测试确认先失败**

Run: `cd client; node --test electron/services/bidContentDuplicateService.test.cjs`

Expected: 新增的短表达和句内标点测试在当前实现下失败，证明测试捕获了现有问题。

### Task 2: 实现完整句子级匹配

**Files:**
- Modify: `client/electron/services/bidContentDuplicateService.cjs`

- [x] **Step 1: 收紧句子边界**

让 `splitSentences()` 只在句末标点或有效英文句号处切句；逗号、顿号、分号、冒号和换行不再切句。

- [x] **Step 2: 增加完整句子候选过滤**

增加集中定义的最小有效字符数 8，并过滤无句末标点、纯列表编号和长度不足的候选。

- [x] **Step 3: 删除整段兜底命中**

移除 `rightParagraphsByKey` 及其整段相同补算逻辑，让完全一致结果只能来自完整句子索引。

- [x] **Step 4: 运行定向测试确认通过**

Run: `cd client; node --test electron/services/bidContentDuplicateService.test.cjs`

Expected: 测试全部通过。

### Task 3: 真实数据形态回归与客户端验证

**Files:**
- No additional production files.

- [x] **Step 1: 使用模拟标书正文运行对比**

验证短语不计入、完整句子计入、句内标点不拆分、跨段落完整句子可匹配。

- [x] **Step 2: 运行相关 IPC/存储测试**

Run: `cd client; node --test electron/ipc/bidProjectIpc.test.cjs electron/services/bidContentDuplicateService.test.cjs`

- [x] **Step 3: 执行客户端构建**

Run: `cd client; npm run build`

- [x] **Step 4: 检查工作区差异**

Run: `git diff --check; git status --short`

确认只包含本次规则设计、测试和实现变更。
