# 标书模板强制内容规范 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在模板设置中展示四条不可关闭的标书内容规范，并让目录、正文及配图生成链路强制执行。

**Architecture:** 四条规则是全局不变量，不写入每个模板的可变 JSON，也不增加 SQLite migration 或 IPC 字段。Renderer 只读展示规范；Main 在目录保存、正文提示与保存前规范化、配图提示三个入口执行规则，旧模板自然继承。

**Tech Stack:** React 19、TypeScript、全局 CSS、Electron Main CommonJS、SQLite Store、Node built-in test runner、现有 AI/Agent 任务链路。

---

### Task 1: Add the locked content-rules tab to template settings

**Files:**
- Create: `client/src/features/export-format/mandatoryBidContentRules.ts`
- Modify: `client/src/features/export-format/pages/ExportFormatPage.tsx`
- Modify: `client/src/styles/feature-export-format.css`
- Create: `client/src/features/export-format/mandatoryBidContentRules.test.cjs`

- [ ] **Step 1: Write the failing source-level CommonJS test** that reads the catalogue and template-page source as UTF-8, asserts exactly four stable IDs in this order: `heading-terminal-punctuation`, `schedule-deadline`, `bold-lead-in-colon`, `parallel-section-numbering`, and verifies the UI has no switch/input tied to those rules.
- [ ] **Step 2: Run** `node --test src/features/export-format/mandatoryBidContentRules.test.cjs` from `client/`. Expected result: FAIL because the catalogue and tab do not exist. Do not introduce `tsx` or another test dependency.
- [ ] **Step 3: Create** a typed immutable catalogue containing the four approved Chinese rule names, concise descriptions and examples. Keep it inside the export-format feature because it is UI copy, not a runtime rule dependency.
- [ ] **Step 4: Extend** `TemplateTab` and `templateTabs` in `ExportFormatPage.tsx` with `{ id: 'content-rules', label: '内容规范' }` immediately after “快捷设置”.
- [ ] **Step 5: Add** `renderContentRules()` and route it from `renderActiveSettings()`. Render an unframed rule list with stable `01`-`04` markers and a visible “强制执行” state; do not add switches, inputs or save-time values.
- [ ] **Step 6: Add scoped CSS** for the read-only list using existing `--yb-*` tokens, a maximum two-column layout on wide screens and one column on narrow screens. Do not introduce cards inside cards or change the preview dimensions.
- [ ] **Step 7: Run the focused test** and `npm run build`; expect exit code 0, allowing only the existing chunk-size warning.
- [ ] **Step 8: Stage only this task's files** with `git add -- client/src/features/export-format/mandatoryBidContentRules.ts client/src/features/export-format/mandatoryBidContentRules.test.cjs client/src/features/export-format/pages/ExportFormatPage.tsx client/src/styles/feature-export-format.css`; run `git diff --cached --name-only` and stop if any unrelated path appears, then commit with `git commit -m "feat: show mandatory bid content rules in templates"`.

### Task 2: Normalize terminal punctuation on authoritative outline titles

**Files:**
- Create: `client/electron/services/mandatoryBidContentRules.cjs`
- Create: `client/electron/services/mandatoryBidContentRules.test.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs`
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Modify: `client/electron/services/outlineGenerationTaskV2.test.cjs`

- [ ] **Step 1: Write failing pure-function tests** for `normalizeFormalHeadingTitle()` covering `总体进度安排。`, `既有数据入库：`, every approved terminal delimiter, mixed/duplicate trailing delimiters, already-clean titles, whitespace, bracketed names and idempotence.
- [ ] **Step 2: Run** `node --test electron/services/mandatoryBidContentRules.test.cjs` from `client/`; expect FAIL because the module/helper does not exist.
- [ ] **Step 3: Implement** `normalizeFormalHeadingTitle(value)` with explicit terminal delimiter removal for `。．.，,；;：:、！？!?`, preserving internal punctuation, paired closing punctuation and surrounding title text.
- [ ] **Step 4: Implement** `normalizeOutlineHeadingTitles(outlineData)` as an immutable recursive mapper that changes only each node's `title` and preserves `id`, `description`, `content`, `children` and metadata.
- [ ] **Step 5: Normalize** `outlineData` at the start of `technicalPlanStore.saveOutline()` before the existing `replace/edit/delete/add-*/sort` branches, and also inside the lower-level `saveOutlineData()` persistence helper so task checkpoints that call `updateTechnicalPlan({ outlineData })` cannot bypass the rule. Pass the normalized object through invalidation and score-coverage behavior without duplicating cleanup rules.
- [ ] **Step 6: Normalize** `persistedFinalOutline` in `outlineGenerationTaskV2.cjs` before the final checkpoint. This keeps the task event payload identical to the already-normalized SQLite state instead of showing punctuation until the next reload.
- [ ] **Step 7: Extend Store and outline-generation regressions** to prove title cleanup works for first generation, `replace`, `edit` and `sort`, while node IDs、持久化正文、正文状态和 score coverage remain unchanged according to the existing `reason` protocol.
- [ ] **Step 8: Run** `node --test electron/services/mandatoryBidContentRules.test.cjs electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/outlineGenerationTaskV2.test.cjs`, then run `node --check` for the three modified/created `.cjs` runtime files.
- [ ] **Step 9: Run** `npm run smoke:electron-native` and `npm run build` from `client/`; expect all commands to exit 0.
- [ ] **Step 10: Stage only this task's files** with `git add -- client/electron/services/mandatoryBidContentRules.cjs client/electron/services/mandatoryBidContentRules.test.cjs client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineGenerationTaskV2.test.cjs`; verify `git diff --cached --name-only` contains no unrelated path, then commit with `git commit -m "fix: normalize formal bid heading punctuation"`.

### Task 3: Enforce bold lead-in colons and numbered parallel subsections

**Files:**
- Modify: `client/electron/services/contentGenerationTask.punctuation.test.cjs`
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Modify: `docs/superpowers/specs/2026-09-04-bold-lead-in-punctuation-design.md`

- [ ] **Step 1: Update failing punctuation tests** so an inline bold lead-in ending in `。` or `.` always becomes a Chinese colon before following prose. Replace the old internal-colon expectation that produced a Chinese comma with the newly approved trailing-colon rule.
- [ ] **Step 2: Add failing tests** for two or more standalone parallel bold titles. Fix the canonical forms as `1. **标题**` for a standalone title and `1. **标题：** 正文` when prose follows on the same line. Cover unnumbered, mixed numbered/unnumbered, skipped, duplicate and out-of-order inputs; normalize all eligible peer titles in one leaf by appearance order. Add numbered punctuation cases such as `1. **实施安排。** 正文` and `2. **质量保证。**` so optional numeric prefixes cannot bypass colon/terminal-punctuation cleanup. Correct consecutive numbering remains unchanged, a single standalone title stays unnumbered, and fenced code/table/image blocks remain untouched.
- [ ] **Step 3: Add prompt assertions** proving first generation, ordinary restored optimization, restored-optimization Agent fallback and word adjustment all require Chinese-colon inline lead-ins and continuous Arabic numbering for two or more parallel discussion items.
- [ ] **Step 4: Run** `node --test electron/services/contentGenerationTask.punctuation.test.cjs`; expect failures against the current comma/no-number behavior.
- [ ] **Step 5: Update** `normalizeGeneratedLeadInPunctuation()` to recognize an optional leading Arabic list number before `**...**` or `__...__`. An inline lead-in must have exactly one trailing Chinese colon inside the bold marker, duplicate external delimiters are removed, and the result remains idempotent. Standalone bold titles must remove terminal `。．.，,；;：:、！？!?`, not only `。/.`, while preserving an existing correct number.
- [ ] **Step 6: Add** a fenced-code/table/image-aware `normalizeParallelLeadInNumbering()` and compose it with punctuation normalization in `normalizeLeafContentForSave()`. First normalize/add the numeric prefixes for eligible peer titles, then run punctuation normalization that understands those prefixes; verify a second full pass is byte-identical. Ordinary ordered lists and inline emphasized terms remain unchanged.
- [ ] **Step 7: Replace conflicting prompt rules** in `buildChapterContentMessages()`, the `preSectionInstruction` added by `buildRestoredChapterContentMessages()`, `buildAgentRestoredChapterContentPrompt()` and `buildWordAdjustmentMessages()`: remove “加粗引导语禁止编号” and “仅连续步骤才可编号”的 blanket ban; require numbering only when two or more peer discussion items are presented. Test ordinary restored optimization and Agent fallback separately.
- [ ] **Step 8: Update the earlier punctuation design doc** to record that the September 11 template rule supersedes the internal-colon comma fallback and adds peer-item numbering.
- [ ] **Step 9: Run** the focused punctuation test, `node --check electron/services/contentGenerationTask.cjs`, and `npm run build`.
- [ ] **Step 10: Stage only this task's files** with `git add -- client/electron/services/contentGenerationTask.punctuation.test.cjs client/electron/services/contentGenerationTask.cjs docs/superpowers/specs/2026-09-04-bold-lead-in-punctuation-design.md`; verify `git diff --cached --name-only` contains no unrelated path, then commit with `git commit -m "fix: enforce lead-in punctuation and peer numbering"`.

### Task 4: Keep every generated schedule inside the tender deadline

**Files:**
- Create: `client/electron/services/contentGenerationTask.mandatoryRules.test.cjs`
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Create: `client/electron/services/contentIllustrationGeneration.mandatoryRules.test.cjs`
- Modify: `client/electron/services/contentIllustrationGeneration.cjs`

- [ ] **Step 1: Write failing prompt tests** asserting the chapter-planning prompt explicitly receives Step02 implementation-period facts and states all five requirements: tender deadline is a hard boundary, compact/parallel scheduling is allowed, feasibility is not assessed, all acceptance/delivery finishes in time, and unknown absolute dates use contract-relative time.
- [ ] **Step 2: Add failing prompt tests** for 首次正文生成、原方案优化扩写、字数调整、普通/Agent 原方案覆盖修复及普通/Agent 一致性修复，验证每条实际组合后的提示都收到 Step02 工期事实，且不得引入开标前的实施日期、延长招标期限，或以“更现实”为由拉长紧凑计划。
- [ ] **Step 3: Add failing illustration prompt tests** for HTML、Mermaid、AI 图片及 Mermaid 语法修复、HTML 布局修复路径，验证甘特图、进度图和时间轴只能复制最终正文中的时间边界与节点，不得推断新的绝对日期。
- [ ] **Step 4: Run** both new test files and confirm the current prompts fail the required assertions.
- [ ] **Step 5: Expose a bounded test-only object** from `contentGenerationTask.cjs` and `contentIllustrationGeneration.cjs` for the relevant internal builders. Tests must call builders and inspect composed messages; do not rely on source-string assertions for schedule propagation.
- [ ] **Step 6: Add** one reusable Main-side `MANDATORY_SCHEDULE_RULE_PROMPT` exported by `mandatoryBidContentRules.cjs`. Phrase it exactly around the approved business rule and append it to every relevant content prompt rather than maintaining near-duplicate variants.
- [ ] **Step 7: Pass** `bidAnalysisFactsText` into `buildChapterContentMessages()`、恢复正文构造、`buildWordAdjustmentMessages()`、普通/Agent 原方案覆盖修复和普通/Agent 一致性修复。当前正文与调整提示只收到选中事实，必须补齐完整 Step02 工期事实，并保持招标事实高于知识库素材。
- [ ] **Step 8: Append** the mandatory schedule rule to chapter planning、首次生成、原方案优化扩写、字数调整、原方案覆盖修复和一致性修复提示。保留现有“不编造品牌、型号、人员或承诺”规则。
- [ ] **Step 9: Append** a diagram-specific form of the same rule to `buildAiImagePrompt()`、`buildMermaidAiImagePrompt()`、`buildHtmlImagePrompt()`、`buildHtmlAgentPrompt()`、`buildMermaidGenerationMessages()`、`buildMermaidRepairMessages()` 和 `buildHtmlLayoutRepairPrompt()`。图表布局可以压缩，但日期和里程碑只能复制给定的正文参考，不得自行推算。
- [ ] **Step 10: Do not add** any new logging of 招标文件正文、生成正文、完整 Prompt 或修复 payload. Preserve existing diagnostics outside this task.
- [ ] **Step 11: Run** `node --test electron/services/contentGenerationTask.mandatoryRules.test.cjs electron/services/contentIllustrationGeneration.mandatoryRules.test.cjs electron/services/contentGenerationTask.remoteKnowledge.test.cjs`, followed by `node --check` for both modified `.cjs` files.
- [ ] **Step 12: Stage only this task's files** with `git add -- client/electron/services/mandatoryBidContentRules.cjs client/electron/services/contentGenerationTask.mandatoryRules.test.cjs client/electron/services/contentGenerationTask.cjs client/electron/services/contentIllustrationGeneration.mandatoryRules.test.cjs client/electron/services/contentIllustrationGeneration.cjs`; verify `git diff --cached --name-only` contains no unrelated path, then commit with `git commit -m "fix: constrain bid schedules to tender deadlines"`.

### Task 5: End-to-end verification

**Files:** None.

- [ ] **Step 1: Run focused regressions** from `client/`: `node --test src/features/export-format/mandatoryBidContentRules.test.cjs electron/services/mandatoryBidContentRules.test.cjs electron/services/contentGenerationTask.punctuation.test.cjs electron/services/contentGenerationTask.mandatoryRules.test.cjs electron/services/contentIllustrationGeneration.mandatoryRules.test.cjs electron/services/contentGenerationTask.remoteKnowledge.test.cjs electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/outlineGenerationTaskV2.test.cjs`.
- [ ] **Step 2: Run syntax checks**: `node --check electron/services/mandatoryBidContentRules.cjs`, `node --check electron/services/contentGenerationTask.cjs`, `node --check electron/services/contentIllustrationGeneration.cjs`, `node --check electron/services/technicalPlanStore.cjs`, and `node --check electron/services/outlineGenerationTaskV2.cjs`.
- [ ] **Step 3: Run** `npm run smoke:electron-native` and `npm run build`; expect exit code 0, allowing the documented existing chunk-size warning.
- [ ] **Step 4: Start** `npm run dev` and manually open “模版设置 → 新建模板/编辑模板”; verify “内容规范” shows exactly four locked rules at desktop and narrow window widths with internal scrolling and no overlap.
- [ ] **Step 5: Manually generate** a small technical plan whose tender facts specify a September opening and a fixed delivery deadline. Verify正文和生成的 Gantt/timeline 均不早于合法项目起点，所有交付节点均在期限内，并允许使用紧凑的并行阶段。
- [ ] **Step 6: Manually verify formatting** with 一个末尾为 `。` 的目录标题、inline `**进度例会与日常调度。** 正文` 和三个并列的独立加粗标题。确认保存及导出结果中的正式标题不带结尾标点，行内引导语为 `**进度例会与日常调度：** 正文`，并列分项按 `1.` 至 `3.` 连续编号。
- [ ] **Step 7: Review** `git diff --check` and `git status --short`. Preserve the user's existing changes in `AdaptiveTwoPaneWorkspace.tsx`, `ContentEditPage.tsx`, `workflowLayout.test.ts` and `feature-technical-plan.css`; do not stage unrelated files.
