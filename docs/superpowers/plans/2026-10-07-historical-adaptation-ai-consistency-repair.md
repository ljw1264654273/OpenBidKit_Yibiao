# 历史标书适配一致性检查自动修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展现有历史标书适配一致性检查，使 AI 能基于全文统一事实自动修复可验证的生成正文冲突，并将无法安全处理的问题可靠地交给人工。

**Architecture:** 保留现有 `historical-adaptation-content-check` 受管任务和 `startHistoricalAdaptationContentCheck` IPC。新增一个 Main 侧纯修复模块负责结构化候选校验，检查任务编排全文事实、语义检查、最多两轮修复和复查；Store 以单事务原子写入多章节正文并更新来源/指纹，Renderer 只展示阶段和结果，不复制业务门禁。

**Tech Stack:** Electron Main CommonJS、better-sqlite3 Store、现有 `aiService.requestJson`、React/TypeScript Renderer、Node built-in test runner、Vite/TypeScript build。

---

## 文件结构与职责

- Create: `client/electron/services/historicalAdaptationConsistencyRepair.cjs` — 修复响应 schema、唯一命中、编辑冲突、事实和历史残留校验；不执行数据库写入。
- Create: `client/electron/services/historicalAdaptationConsistencyRepair.test.cjs` — 修复模块的失败优先单元测试。
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.cjs` — 事实提取/归一、修复提示、修复轮次、复查编排和阶段日志；保持既有确定性预检。
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.test.cjs` — 任务级自动修复、回退、两轮上限、缓存和全文冲突测试。
- Modify: `client/electron/services/technicalPlanStore.cjs` — 增加多章节原子应用修复接口，更新节点正文、内容来源、迁移输出指纹并清除确认/旧检查状态；同步提升一致性检查规则版本并更新 readiness/cache 判定。
- Create: `client/electron/services/technicalPlanStore.historicalAdaptationConsistencyRepair.test.cjs` — Store 原子提交、哈希并发保护、失败回滚和状态清理测试。
- Modify: `client/electron/services/historicalAdaptationContentTask.cjs` — 将 `ai-repair` 纳入内容来源规范化，复用现有输出哈希字段。
- Modify: `client/src/features/technical-plan/types.ts` — 增加 `ai-repair` 来源和检查自动修复统计/阶段字段。
- Modify: `client/src/features/technical-plan/hooks/useTechnicalPlanWorkflow.ts` 或 Main 状态默认值 — 增加自动修复状态字段默认值（若当前类型初始化需要）。
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx` — 展示后台任务阶段、自动修复数量和人工待处理摘要，继续使用现有按钮和 Toast。
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs` — 页面契约测试，确保自动修复状态显示、人工正文保护和现有阶段确认入口保留。
- Modify: `client/electron/services/technicalPlanStore.cjs` normalizer — 保留并校验自动修复阶段/统计字段，确保任务事件回放不会丢失字段。
- No schema/IPC changes: `item_json` 已承载历史正文项目扩展字段；继续使用现有任务 IPC 和 taskService 生命周期。

## 任务 1：建立修复模块契约（TDD）

**Files:**
- Create: `client/electron/services/historicalAdaptationConsistencyRepair.test.cjs`
- Create: `client/electron/services/historicalAdaptationConsistencyRepair.cjs`

- [ ] **Step 1: 写失败测试：唯一替换可应用，重复命中拒绝。**

  测试调用计划导出的纯函数，验证 `old_text` 唯一命中时返回新正文，重复命中时返回 `old-text-ambiguous` 且原正文不变。

- [ ] **Step 2: 运行测试确认按预期失败。**

  Run: `node --test client/electron/services/historicalAdaptationConsistencyRepair.test.cjs`

  Expected: FAIL，模块或目标导出尚不存在。

- [ ] **Step 3: 写失败测试：重叠编辑、空编辑、人工来源和保护事实拒绝。**

  测试覆盖：同一章节编辑区间重叠；`old_text === new_text`；章节 `content_origin: 'manual'`；`new_text` 引入不在统一事实表中的地点、实施对象、金额、日期、工作量、阶段节点、服务范围或关键名称；任一失败都返回原正文和人工回退原因。

- [ ] **Step 4: 写失败测试：同一 fact 的跨章节覆盖和置信度门禁。**

  断言事实表列出的全部 `chapter_node_ids` 都必须出现在同一修复组；缺一章、`confidence !== 'high'`、事实存在冲突或事实 schema 缺少金额/关键名称等必要字段时均转人工，不产生部分应用。

- [ ] **Step 5: 运行测试确认新增断言失败。**

  Run: `node --test client/electron/services/historicalAdaptationConsistencyRepair.test.cjs`

  Expected: FAIL，失败原因对应缺失的校验行为而非测试语法错误。

- [ ] **Step 6: 实现最小纯函数。**

  在新模块中实现 `normalizeRepairResponse`、`validateRepairGroup`、`applyRepairGroup` 和必要的哈希/事实 token 辅助函数。固定 DTO：`{ group_id, fact_id, confidence: 'high', rationale, expected_content_hash, expected_inputs_hash, expected_facts_hash, chapters: [{ node_id, expected_node_content_hash, expected_item_fingerprint, old_text, new_text, evidence }] }`。事实表固定包含 `fact_id`、`kind`（location/object/workload/amount/schedule/service/name）、`canonical_value`、`evidence[]`、`chapter_node_ids[]`、`conflict`；只有 `conflict: false`、`confidence: high` 且候选覆盖 `chapter_node_ids` 全集时才能自动应用。输出包含完整修复组、每节点新正文和人工回退原因。禁止整章替换、Markdown 保护范围替换和非唯一命中。

- [ ] **Step 7: 运行修复模块测试确认通过。**

  Run: `node --test client/electron/services/historicalAdaptationConsistencyRepair.test.cjs`

  Expected: PASS。

- [ ] **Step 8: 提交模块和测试。**

  Run: `git add client/electron/services/historicalAdaptationConsistencyRepair.cjs client/electron/services/historicalAdaptationConsistencyRepair.test.cjs; git commit -m "feat: validate historical adaptation consistency repairs"`

## 任务 2：扩展一致性任务的全文事实和修复提示（TDD）

**Files:**
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.test.cjs`
- Modify: `client/electron/services/historicalAdaptationContentCheckTask.cjs`

- [ ] **Step 1: 写失败测试：语义问题返回可验证修复候选并进入复查。**

  用现有任务 fixture 提供两章正文、招标基线和 `requestJson` 序列响应：第一次响应返回严格事实表（包含金额/关键名称字段、关联章节全集和无冲突状态）及阻断问题，第二次返回覆盖两章的高置信局部编辑，第三次返回空问题。断言任务依次记录“事实/修复/复查”阶段，并最终保存最新内容哈希。

- [ ] **Step 2: 运行定向测试确认失败。**

  Run: `node --test client/electron/services/historicalAdaptationContentCheckTask.test.cjs`

  Expected: FAIL，因为当前任务只检查，不消费修复响应。

- [ ] **Step 3: 写失败测试：结构性问题跳过 AI，人工正文不写入，复查失败保留原文。**

  分别断言来源失效/空正文时 AI 调用次数为 0；人工章节仍参与语义检查但不会出现在修复请求或写入组；AI 异常/非法 repair 响应时原正文不变；复查仍返回跨章节阻断时任务状态不是通过且 checkpoint 中包含人工原因。

- [ ] **Step 4: 写失败测试：自动修复最多两轮且使用最新事实/哈希。**

  模拟第一轮修复后仍有冲突，第三次潜在修复响应不得被调用；修改内容哈希或输入/事实版本后，过期候选必须被拒绝，不得写入。

- [ ] **Step 5: 运行测试确认失败原因正确。**

  Run: `node --test client/electron/services/historicalAdaptationContentCheckTask.test.cjs`

  Expected: FAIL，断言应指向缺少新阶段/修复调用。

- [ ] **Step 5: 实现统一事实和修复编排。**

  在 `historicalAdaptationContentCheckTask.cjs` 中：

  - 保留现有 `collectDeterministicFindings` 作为第一道门；存在阻断时继续跳过 AI。
  - 增加严格 JSON schema 的全文事实提取/归一请求，事实必须携带 `fact_id`、事实类型（地点/对象/工作量/金额/工期/节点/服务范围/关键名称）、统一规范值、原文证据、关联章节全集和冲突状态；冲突事实不得进入自动修复。
  - 将事实提取、语义检查和修复候选拆成独立 `response_format`/validator，不复用只接受 `findings` 的现有 validator；修复响应只允许任务 1 的固定 DTO，要求高置信度、完整覆盖事实关联章节，并绑定当前 `contentHash`、`inputsHash` 和事实版本哈希。
  - 每轮调用修复校验模块；只将通过校验的组交给 Store；Store 应用后重新获取 context、重新计算确定性和语义 findings。
  - 最多两轮；AI 异常、响应非法、无法闭合的事实冲突转换为非成功快照中的人工处理 finding，绝不伪造通过；不允许第三次 AI 修复请求。
  - 将 `repair_protocol_version`、`fact_schema_version` 纳入 inputsHash，并提升 `rule_engine_version`；旧 schema/事实/修复协议缓存不得复用。
  - 进度使用现有 `checkpointTask`，增加可读日志但不改变任务类型。

- [ ] **Step 7: 运行任务测试确认通过。**

  Run: `node --test client/electron/services/historicalAdaptationContentCheckTask.test.cjs`

  Expected: PASS，且原有确定性、缓存、畸形响应测试保持通过。

- [ ] **Step 8: 提交任务编排。**

  Run: `git add client/electron/services/historicalAdaptationContentCheckTask.cjs client/electron/services/historicalAdaptationContentCheckTask.test.cjs; git commit -m "feat: auto repair historical adaptation consistency"`

## 任务 3：增加 Store 多章节原子应用和并发保护（TDD）

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Create: `client/electron/services/technicalPlanStore.historicalAdaptationConsistencyRepair.test.cjs`

- [ ] **Step 1: 写失败测试：合法修复组一次事务更新全部章节。**

  构造两个非人工章节及其当前 canonical `contentHash = stableHash(JSON.stringify(leaves.map(({node_id, content}) => ({node_id, content}))))`、`inputsHash`、事实版本哈希、每节点正文哈希和 item fingerprint，调用 Store 新接口，断言两个 outline node 正文均更新、内容来源为 `ai-repair`、`migration_output_hash = hash([source_hash,input_fingerprint,effectiveMode,manual_instruction,newContent])` 更新，阶段确认、终审 findings/confirmed 和旧检查快照均失效。

- [ ] **Step 2: 写失败测试：一章失败或哈希变化时整组回滚。**

  提交包含无效 node/过期 expected content/input/fact hash、过期 item fingerprint 或人工来源章节的修复组，断言抛错后两章正文和 item_json 都保持原值。

- [ ] **Step 3: 运行 Store 定向测试确认失败。**

  Run: `node --test client/electron/services/technicalPlanStore.historicalAdaptationConsistencyRepair.test.cjs`

  Expected: FAIL，因为新接口尚不存在。

- [ ] **Step 4: 实现事务接口。**

  在 Store 增加 `applyHistoricalAdaptationConsistencyRepairs({ expectedContentHash, expectedInputsHash, expectedFactsHash, repairs })`：事务内按现有 canonical 顺序重新计算全文内容哈希、输入哈希和事实版本哈希，检查每个 node/item、人工来源、每节点正文哈希/item fingerprint 及 `old_text`；用同一事务更新 `technical_plan_outline_nodes`、现有 content section 的 status/error 字段和历史 item JSON，设置 `content_origin: 'ai-repair'`、`status: 'success'`、新的 `migration_output_hash`，清除章节 `confirmed_at`、`historical_adaptation_content_confirmed_at`、`historical_adaptation_review_findings_json`、`historical_adaptation_review_confirmed_at` 和旧 check 快照，并调用一次现有 `onContentChanged`/图片计划清理逻辑。content sections 不写正文，只更新其现有状态字段。任一检查失败立即抛错回滚。将方法通过 Store 返回对象暴露给任务 runner，不新增 IPC。

  自动修复上线后将一致性 `rule_engine_version` 从 3 提升到 4；同步更新检查任务写入、Store readiness/cache 判定和旧版本缓存测试，确保旧成功检查快照不会绕过自动修复流程。

- [ ] **Step 5: 运行 Store 测试确认通过。**

  Run: `node --test client/electron/services/technicalPlanStore.historicalAdaptationReview.test.cjs`

  Expected: PASS。

- [ ] **Step 6: 更新内容来源规范化并执行相关测试。**

  在 `historicalAdaptationContentTask.cjs` 的 `CONTENT_ORIGINS` 和 `client/src/features/technical-plan/types.ts` 加入 `ai-repair`，确保旧数据仍按原规则归一。

  Run: `node --test client/electron/services/historicalAdaptationContentTask.test.cjs client/electron/services/technicalPlanStore.historicalAdaptationConsistencyRepair.test.cjs`

  Expected: PASS。

- [ ] **Step 7: 提交 Store 和类型契约。**

  Run: `git add client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.historicalAdaptationConsistencyRepair.test.cjs client/electron/services/historicalAdaptationContentTask.cjs client/src/features/technical-plan/types.ts; git commit -m "feat: atomically apply consistency repairs"`

## 任务 4：接入 Renderer 阶段和结果反馈（TDD）

**Files:**
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`
- Modify: `client/src/features/technical-plan/types.ts`（如任务 3 未完成统计字段）
- Modify: `client/electron/services/technicalPlanStore.cjs` normalizer（如任务 3 未完成检查状态字段归一）

- [ ] **Step 1: 写失败页面契约测试。**

  断言页面包含“提取全文事实”“自动修复”“复查全文”阶段文案/状态读取，显示自动修复与人工待处理摘要，仍调用现有 `startHistoricalAdaptationContentCheck`、`getHistoricalAdaptationContentReadiness` 和“确认本阶段”，且没有新增逐条自动保存 Renderer IPC。

- [ ] **Step 2: 运行页面契约测试确认失败。**

  Run: `node --test client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

  Expected: FAIL，当前页面没有自动修复阶段反馈。

- [ ] **Step 3: 实现最小状态展示。**

  根据持久化的稳定阶段枚举/统计字段（不解析日志）派生当前阶段；在一致性检查区域显示自动修复成功数、仍有阻断数、人工处理数和最多两轮说明。保持用户可点击问题定位章节；不在 Renderer 实现事实合并、修复校验或阶段门禁。

- [ ] **Step 4: 运行页面测试确认通过。**

  Run: `node --test client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

  Expected: PASS。

- [ ] **Step 5: 提交 Renderer 反馈。**

  Run: `git add client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs client/src/features/technical-plan/types.ts; git commit -m "feat: show consistency repair progress"`

## 任务 5：完整验证与回归

**Files:**
- Modify only if test failures reveal a defect; otherwise no new production files.

- [ ] **Step 1: 运行所有相关 Node 测试。**

  Run: `node --test client/electron/services/historicalAdaptationConsistencyRepair.test.cjs client/electron/services/historicalAdaptationContentCheckTask.test.cjs client/electron/services/historicalAdaptationContentTask.test.cjs client/electron/services/technicalPlanStore.historicalAdaptationConsistencyRepair.test.cjs client/src/features/historical-bid-adaptation/HistoricalBidAdaptationPage.test.cjs`

  Expected: PASS。

- [ ] **Step 2: 检查 Main CommonJS 语法。**

  Run: `node --check client/electron/services/historicalAdaptationConsistencyRepair.cjs; node --check client/electron/services/historicalAdaptationContentCheckTask.cjs; node --check client/electron/services/technicalPlanStore.cjs`

  Expected: 无输出且退出码 0。

- [ ] **Step 3: 运行客户端构建。**

  Run: `cd client; npm run build`

  Expected: `tsc --noEmit` 与 `vite build` 均退出 0；既有 chunk 体积警告不视为失败。

- [ ] **Step 4: 运行 Electron native smoke 验证。**

  Run: `cd client; npm run smoke:electron-native`

  Expected: better-sqlite3/native ABI smoke 通过。

- [ ] **Step 5: 做手动 Electron 验证。**

  Run: `cd client; npm run dev`

  验证：生成正文中的确定性口径冲突会自动修复；同一事实在多个章节统一；人工正文不被覆盖；来源失效/无法判断的问题保留人工处理；自动修复失败后原正文未变；阻断清零后仍需“确认本阶段”；占位符继续使用现有确认流程。

- [ ] **Step 6: 检查差异并提交最终回归。**

  Run: `git diff --check; git status --short`

  Expected: 无空白错误；只包含本计划范围内的变更。
