# 历史标书适配一致性事实诊断与修复设计

## 背景与目标

正文迁移的一致性检查目前只在页面展示阻断摘要。检查任务实际会提取全文事实、合并跨章节证据并据此执行语义检查和自动修复，但这些事实明细没有进入 Renderer，也没有人工修正入口。用户遇到 P0 阻断时只能看到“自动一致性检查未完成，请人工处理”，无法判断缺失/冲突来自哪一章，也无法修正后重新验证。

本次改造目标是把阻断处理变成闭环：

> 阻断问题 → 查看事实与证据 → 修改正文或事实修正 → 重新运行检查 → 确认阻断消失

## 范围与不变项

- 只改历史标书适配“正文迁移”环节的一致性检查体验。
- 不复用或直接修改标书生成第四步的 `globalFacts`；两者数据语义不同。
- 人工事实修正按项目保存，并作为后续一致性检查的可信输入；正文内容仍以章节正文为权威。
- 保留现有自动修复、哈希校验、批次缓存和阻断判定，不弱化检查或统计能力。
- 失败任务已经完成事实提取时仍可查看事实；事实未完成时显示明确的不可用原因。

## 用户体验

一致性检查操作条在“运行一致性检查”旁增加“查看全文事实”按钮。按钮在存在当前输入匹配的事实快照或可读取的最近一次提取结果时可用，否则显示禁用态。

弹窗为只读证据浏览 + 项目级事实修正入口，参考第四步事实设定的分组阅读体验，但不提供正文生成配置。每个事实展示：

- 事实类型/名称；
- 当前统一值、冲突值或缺失状态；
- 来源章节列表；
- 原文证据；
- 当前状态（可信、冲突、待补充、人工修正）。

针对事实提供操作：

- “定位章节”：关闭弹窗并选中对应章节，用户可修改正文；
- “修正事实”：在弹窗内编辑或补充项目级事实值，保存后标记为人工修正；
- “重新运行一致性检查”：保存修正后启动检查，刷新事实和阻断结果。

P0/P1 阻断卡片同时保留现有点击定位行为，并在可识别事实冲突时关联到事实弹窗中的对应条目。事实缺失、解析失败等没有章节可定位的错误，要在弹窗顶部展示可操作说明（例如补充事实后重跑）。

## 数据与 IPC

### Main 侧

在 `technicalPlanStore` 增加读取当前项目一致性事实快照的查询能力：

- 为 `historical_adaptation_content_check_batches` 增加 `content_hash` 字段，并新增 `historical_adaptation_content_check_runs` 运行清单（`project_id`、`check_run_id`、`content_hash`、`input_hash`、`facts_hash`、`protocol_hash`、`expected_batch_count`、`expected_node_ids_json`、`created_at`、`status`）；运行时 migration 与 `sql/workspace_schema.sql` 同步。创建批次时同一事务写入清单和每个批次的正文/输入/事实/协议指纹；更新、复用、失效查询均必须带上 `content_hash`。
- 只选择单一的最新完整 `check_run_id`：运行清单状态与当前指纹匹配、批次数量等于 `expected_batch_count`、`batch_index` 从 0 连续、所有批次为 `success`，且批次节点并集与 `expected_node_ids_json` 完全一致；部分失败、缺批次或旧运行不参与汇总；
- 按 `batch_index` 合并该运行的 `result_json.facts`，以 `fact_id/fact_key` 去重并合并章节 ID、证据和值集合，不跨运行混合事实；
- 将批次中的事实规范化为稳定的事实条目，并附带来源章节、证据、冲突字段；
- 若当前检查失败但批次已成功，返回该次提取结果及 `checkStatus/error`；
- 若没有可匹配结果，返回空事实和原因，不伪造事实。

增加项目级人工事实修正的读写能力，采用 `technical_plan_meta.historical_adaptation_content_fact_overrides_json`（运行时 migration 与 `sql/workspace_schema.sql` 同步），数组按 `fact_key` 唯一。每条记录包含 `fact_key`、`canonical_value`、`kind`、`basis`、`note`、`updated_at`，保存同 key 覆盖旧值，空值删除该修正。

修正记录以稳定排序和明确字段做 canonical JSON，加入 `inputSnapshot.manual_fact_overrides`；`inputsHash = stableHash(JSON.stringify(inputSnapshot))`，`protocolHash = stableHash(JSON.stringify({ inputsHash, rule_engine_version, fact_schema_version, repair_protocol_version }))`。任务完成事实提取后先将 overrides 与提取事实合并，再计算 `factsHash = factRegistry.factsHash(effectiveFacts)`，因此 override 会同时改变三类指纹，旧快照无法命中。保存修正时使用 compare-and-write：payload 必须携带当前 `contentHash`、`inputsHash`、`protocolHash`，Main 在一个 `db.transaction()` 内读取正文/输入、规范化修正、计算三类指纹、比对 expected 值并写入；任一不一致则回滚并返回“内容已变化，请重新读取”。

通过现有 `technicalPlanIpc.cjs`、`preload.cjs`、`shared/types/ipc.ts` 暴露以下薄通道；业务逻辑留在 Main service/store，Renderer 不直接访问 SQLite。`shared/types/ipc.ts` 明确定义 `HistoricalAdaptationContentFactsResult` 与 `SaveHistoricalAdaptationFactOverridesResult` 两个 discriminated union：成功分支包含 `ok: true`、指纹、事实条目、来源运行；失败分支包含 `ok: false`、稳定 `code`（`unavailable`/`stale`/`conflict`/`invalid`）、用户可见 `message` 和当前指纹（若可得）：

- `technical-plan:get-historical-adaptation-content-facts`：payload `{ projectId }`，成功返回当前 `contentHash`/`inputsHash`/`protocolHash`、事实条目、来源运行和 `checkStatus`；
- `technical-plan:save-historical-adaptation-content-fact-overrides`：payload `{ projectId, expectedContentHash, expectedInputsHash, expectedProtocolHash, overrides }`，成功返回保存后的 `TechnicalPlanState` 局部 patch 与新指纹；

保存成功后 Renderer 显式调用现有 `tasks:start-historical-adaptation-content-check`，不在保存 IPC 内隐式启动任务；任务使用同一项目上下文读取修正记录。

### Renderer 侧

在 `AdaptationContentPage` 增加事实弹窗状态、读取和保存编排。新增的事实类型放在 `technical-plan/types.ts` 或适配功能专用类型中，不让 `shared/` 运行时代码依赖 feature 组件。

弹窗采用 `AppDialog` 与现有 Markdown/按钮样式；正文证据使用 `MarkdownRenderer allowRawHtml={false}`。保存成功、失败和重跑提示使用 `useToast`，不使用 `alert`。

## 一致性与失效规则

- 正文、迁移策略、历史基线、全局事实或人工事实修正变化时，现有检查快照继续按当前规则失效。
- 人工事实修正必须参与 `inputsHash`/`protocolHash`/`factsHash`，避免旧检查结果被误认为仍然有效；修正删除、覆盖与正文修改都触发 stale。
- 修正只对当前历史标书适配项目生效，不回写技术方案第四步 `globalFacts`。
- 自动修复仍只能使用高置信、哈希匹配的事实；人工修正没有匹配当前输入时不得静默复用。
- 查询结果附带 `stale`/`unavailable` 原因，界面不得把过期事实标为当前可信事实。

## 错误处理

- 查询失败：弹窗显示错误和“重试读取”，不影响正文编辑或已有阻断列表。
- 事实提取未完成：展示阶段、任务错误和下一步建议，禁用保存事实但允许查看已有证据。
- 保存时输入已变化：Main 拒绝旧指纹写入，Renderer 提示先重新读取/运行检查。
- 重新检查失败：保留人工修正和批次证据，展示最新错误，不能清空用户已保存修正。

## 验证

- 新增/修改 Main、preload、IPC 后执行对应 `.cjs` 的 `node --check`，并运行 `cd client; npm run build`。
- 为运行清单/事实聚合增加跨 run、部分失败批次、批次数量/章节覆盖、contentHash 变化和重复事实合并测试；为人工修正增加 canonical hash、覆盖/删除、过期 compare-and-write 和并发保存测试。
- 为 IPC 增加通道注册、payload 指纹拒绝和返回类型的定向测试。
- 为 Renderer 增加事实弹窗、定位章节、保存修正和重跑按钮的组件/页面测试（沿用现有测试风格）。
- 手动验证：事实成功、事实提取失败、跨章节冲突、人工修正后重跑、正文修改后重跑五条链路。

