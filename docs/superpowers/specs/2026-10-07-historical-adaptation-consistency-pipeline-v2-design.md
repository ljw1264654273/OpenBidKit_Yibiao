# 历史标书适配一致性检查事实管线 v2 设计

## 背景

当前一致性检查把较大的正文批次和完整招标基线一起交给模型，再要求模型直接返回完整事实表。实际运行中出现两个相互叠加的问题：

1. 正文虽然按固定字符数分批，但完整招标基线会在每个批次重复发送，实际输入可能达到三万 tokens 以上；现有固定批次也没有真正使用文本模型设置中的上下文长度限制。
2. 不同 OpenAI 兼容服务商对 `json_schema` 和流式结构化输出的支持不一致。模型可能返回合法 JSON 数组，但当前校验器只接受 `{"facts": [...]}`，最终把可用结果误报为“模型未返回有效的全文事实表”。

本设计保持用户现有操作不变：用户仍点击一次“运行一致性检查”，系统在 Main 侧完成检查、修复和复查；无法安全判断的问题继续交给人工。

## 目标与非目标

### 目标

- 在不同上下文长度和结构化输出能力的模型上稳定完成一致性检查。
- 保证地点、对象、工作量、金额、工期、阶段、服务范围和关键名称等全文事实口径一致。
- 减少单次请求输入规模，避免完整招标基线重复发送。
- 将“上下文超限”“结构化协议不支持”“模型返回格式错误”和“事实存在冲突”区分展示。
- 保留现有自动修复安全门禁：只允许确定性局部替换，人工正文不被覆盖，失败整批回滚。
- 支持批次级缓存和断点续跑，单个批次失败不必重新提交所有批次。

### 非目标

- 不在 Renderer 保存第二份事实权威状态。
- 不让 AI 自由重写整章或自动裁决招标文件自身的矛盾。
- 不新增在线服务协议，不修改 Analytics 采集和 Dashboard 聚合。
- 不改变“确认本阶段”和 Word 导出门禁。

## 方案比较

### 方案 A：最小兼容补丁

兼容数组和对象两种事实返回格式，遇到上下文错误时缩小当前批次，并在请求失败后重试。

优点是改动小、上线快；缺点是完整基线仍可能重复发送，模型仍承担过多事实归一工作，长文档和跨章节冲突的稳定性有限。

### 方案 B：混合事实管线（推荐）

采用“本地确定性事实注册表 → 章节级 AI 候选提取 → 本地归一合并 → 局部语义检查 → 确定性修复”的 Map-Reduce 流程。AI 只处理本地规则无法确定的候选事实和冲突证据。

优点是输入规模可控，全文一致性由本地归一器保证，对模型能力和供应商协议更不敏感；缺点是需要新增事实注册表、批次缓存和供应商能力适配。

### 方案 C：全部交给大上下文模型

提高上下文长度和输出上限，保留一次性全文提取。

优点是实现成本最低；缺点是成本高、不同模型差异大、结构化输出仍不可靠，无法从根本上避免模型漏事实或跨章节漂移。不采用。

## 总体架构

```text
招标基线 + 迁移正文
        |
        v
本地确定性事实提取与占位符预检
        |
        v
章节级小批次 AI 候选事实提取
        |
        v
本地事实归一、去重、章节绑定、冲突标记
        |
        +--> 无冲突事实：确定性检查
        |
        +--> 冲突事实：只发送相关片段给 AI 做语义判断
        |
        v
高置信度局部修复候选
        |
        v
CAS + 唯一命中 + 保护边界校验
        |
        v
全文重新归一并复查（最多两轮）
```

## 详细设计

### 1. 本地事实注册表

在任务开始时从招标基线、已有全局事实和章节正文中提取可确定事实。事实注册表至少包含：

```ts
type FactRecord = {
  fact_id: string;
  kind: 'location' | 'object' | 'workload' | 'amount' | 'schedule' | 'service' | 'name';
  canonical_value: string;
  normalized_value: string;
  source: 'baseline' | 'global-facts' | 'chapter-candidate';
  evidence: Array<{ node_id?: string; text: string; offset?: number }>;
  chapter_node_ids: string[];
  conflict: boolean;
};
```

章节级候选不允许由模型自由生成 `fact_id`。候选必须包含受控的 `slot`，由本地生成稳定键：

```text
fact_key = kind + ':' + slot + ':' + normalizeQualifier(qualifier)
```

`slot` 使用固定枚举：`project_name`、`project_number`、`client_name`、`provider_name`、`project_location`、`service_location`、`client_address`、`service_object`、`deliverable`、`coordinate_system`、`service_quantity`、`staffing`、`threshold`、`budget`、`fee`、`bid_amount`、`unit_price`、`contract_duration`、`completion_deadline`、`milestone`、`payment_schedule`、`service_scope`、`deliverable_scope`、`method`。无法映射到枚举的候选不进入自动归一，直接生成人工提示。

`normalizeQualifier()` 只做大小写、空白、全角标点、中文数字和单位归一；不从自然语言推测新的槽位。`fact_id` 由 `fact_key` 和任务输入哈希生成，跨批次稳定，禁止使用模型生成的随机编号作为主键。

金额、日期、年限、数量、人员配置、项目编号、项目名称、地点和服务期限优先使用本地规则与已有结构化字段。数字、单位、中文数字、全角标点和常见同义表达在本地归一；归一失败的候选保留原文，不猜测。

招标基线只在此阶段读取一次。后续 AI 请求只传递与当前章节相关的压缩事实摘要，不再传递完整基线。

### 2. 动态分批与预算

将当前模型的 `context_length_limit` 作为硬约束，而不是使用固定字符数。每批预算按下式计算：

```text
request_budget = floor(context_length_limit * 0.40)
input_budget   = request_budget - system_reserve - output_reserve
```

其中 `output_reserve` 至少预留事实候选和错误修复所需空间。字符预算只作为估算，最终以中英文混合 token 估算器为准。默认目标是每批 6,000～10,000 中文字符，但必须受模型上下文配置约束。

批次切分规则：

- 优先以章节叶节点为边界；
- 超长章节按段落边界切分，并保留 `node_id`、路径和片段序号；
- 不把同一段落拆成两个批次，除非单段超过单批上限；
- 每个批次只携带相关章节正文、章节标题、相关事实摘要和必要的招标基线字段。

### 3. AI 候选事实协议

章节级请求只要求返回候选事实，不要求模型生成全局章节 ID：

```json
{
  "candidates": [
    {
      "kind": "schedule",
      "slot": "contract_duration",
      "qualifier": "项目服务期限",
      "value": "合同签订生效之日起3年",
      "evidence": "服务期限为合同签订生效之日起3年",
      "confidence": "high"
    }
  ]
}
```

客户端协议适配器按能力降级：

1. 支持严格 JSON Schema 的模型使用 `json_schema`；
2. 仅支持 JSON Object 的模型使用 `json_object` 加严格提示词；
3. 不支持 `response_format` 的模型使用纯文本 JSON，并进入本地 JSON 解析/修复流程；
4. 统一接受对象包装和数组返回，数组按 `candidates` 或 `facts` 语义归一；
5. 仍无法归一时，记录原始响应摘要和明确错误类型，不能伪装成“事实冲突”。

### 4. 本地归一与冲突检测

本地归一器负责将候选事实绑定到章节并形成最终事实注册表：

- 同一种类且归一值相同的候选合并；
- 同一语义键出现多个归一值时标记 `conflict: true`；
- 候选只能绑定当前任务已知的 `node_id`；
- 招标基线与正文冲突分别记录来源，不自动覆盖基线；
- 证据保留原文片段和章节定位，供 UI 和后续局部检查使用；
- 事实哈希由归一后的事实注册表计算，参与缓存和 CAS。

没有冲突的事实不再交给 AI 复核。只有存在冲突或需要语义判断的事实，才进入下一阶段。

### 4.1 冲突事实的解除规则

语义检查响应除 `findings` 外允许返回 `resolutions`，但不能直接把任意模型建议变成事实：

```json
{
  "resolutions": [
    {
      "fact_key": "schedule:contract_duration:",
      "canonical_value": "合同签订生效之日起3年",
      "confidence": "high",
      "basis": "baseline-exact-match",
      "evidence": ["招标基线：服务期限为合同签订生效之日起3年"]
    }
  ]
}
```

本地只接受以下三类 `basis`：`baseline-exact-match`、`global-fact-exact-match`、`deterministic-normalization`。`canonical_value` 必须与对应来源事实的归一值完全一致；模型自行推测、择多数或改写招标基线均不能解除冲突。通过校验后，本地将事实标记为 `conflict: false`，重新计算 `facts_hash`，再允许进入现有修复契约。无法满足条件的事实继续保留冲突并转人工，因此不会绕过 `validateRepairGroup()` 对冲突事实的安全拒绝。

### 5. 局部语义检查

对每个冲突事实构造最小证据包：

- 招标基线中该事实的相关字段；
- 冲突章节的标题、节点 ID 和前后文窗口；
- 本地归一器提取的候选值；
- 人工来源标记。

AI 输出只允许 `findings`，不能直接修改正文。找不到唯一正确口径时必须输出阻断问题并转人工。

### 6. 自动修复与复查

自动修复沿用现有 `historicalAdaptationConsistencyRepair.cjs` 和 Store 原子写入协议：

- 只处理迁移生成、局部改写或 AI 改写来源；
- 人工正文只参与检查；
- 只接受唯一 `old_text` 到 `new_text` 的局部替换；
- 事实组内所有关联章节必须统一成功；
- 任一章节 CAS、指纹或结构保护失败，整组回滚；
- 修复后重新构建事实注册表并复查全文；
- 最多两轮，仍有问题则标记人工处理。

### 7. 错误分类与恢复

AI 请求层新增标准错误分类：

| 错误类型 | 处理方式 | UI 文案方向 |
|---|---|---|
| `context_length_exceeded` / HTTP 413 | 缩小当前批次后重试一次 | 当前批次过长，系统已自动拆分 |
| `response_format_unsupported` | 降级为 `json_object` 或纯 JSON | 当前模型不支持严格结构化输出 |
| `invalid_json` | 使用原始响应做一次 JSON 修复 | 模型返回格式错误，正在重试 |
| `timeout` / 网络错误 | 保留批次快照，可重试当前批次 | 当前批次请求失败，可继续重试 |
| `fact_conflict` | 不自动修改，生成 P0 人工问题 | 招标基线与正文口径无法自动裁决 |
| `cas_mismatch` | 放弃该修复组，重新读取正文 | 正文已变化，请重新检查 |

任务快照按批次保存 `batch_id`、输入哈希、事实哈希、协议版本和状态。重试时只重跑失败批次；正文或基线变化后使相关批次失效。

#### 批次持久化与重启恢复

新增 SQLite 表 `historical_adaptation_content_check_batches`，并同步 `sql/workspace_schema.sql`。每条记录至少包含：`project_id`、`check_run_id`、`batch_id`、`batch_index`、`node_ids_json`、`input_hash`、`facts_hash`、`protocol_hash`、`status`、`error_code`、`error_message`、`attempt_count`、`request_summary_json`、`result_json`、`updated_at`。Store 提供创建检查批次、读取可复用批次、原子写入批次结果和失效项目批次的方法。

批次状态为 `pending`、`running`、`success`、`failed-retryable`、`failed-manual`、`stale`。任务重启时只复用同时满足正文哈希、招标基线哈希、全局事实哈希、规则版本和协议版本的 `success` 批次；`failed-retryable` 批次自动重试一次，仍失败则保留为可人工重试的 `failed-retryable`，不把整次检查伪装成成功。正文、基线或全局事实任一变化时，相关批次全部标记 `stale`。

现有 `recoverInterruptedHistoricalAdaptationContentCheckTask` 不再直接把整个检查结果标记为 stale；它应读取批次表，恢复未完成的 `pending/running` 批次为 `failed-retryable`，然后由同一检查任务继续处理。检查完成后再以事务写入汇总快照，汇总快照的 `inputs_hash` 必须同时覆盖正文、招标基线和全局事实。

## UI 变化

保留“运行一致性检查”按钮和现有阶段确认流程。阶段文案增加：

- 正在建立本地事实表；
- 正在分批提取章节事实；
- 正在归一跨章节口径；
- 正在检查冲突证据；
- 当前批次过长，已自动拆分；
- 当前模型不支持严格 JSON，已切换兼容模式。

错误详情允许用户看到“重试当前批次”或“转人工处理”的明确结果，但不展示 API Key、完整请求内容或敏感日志。

## 模块边界与改动范围

### Main

- 新增 `historicalAdaptationFactRegistry.cjs`：本地事实提取、归一、哈希和冲突分组。
- 扩展 `historicalAdaptationContentCheckTask.cjs`：动态分批、Map-Reduce、批次缓存、局部语义检查和复查编排。
- 扩展 `aiService.cjs`：结构化输出能力降级、错误分类、token/上下文预算和当前批次重试；保留 `error_code`、HTTP 状态和供应商能力信息。
- 扩展 `technicalPlanStore.cjs` 和 `sqliteDatabase.cjs`：批次表、批次快照事务、全局事实加载及哈希输入。
- 扩展 `taskService.cjs`：中断任务按批次恢复，不再整次检查直接 stale。
- 复用 `historicalAdaptationConsistencyRepair.cjs`、`technicalPlanStore.cjs` 的现有原子修复协议。

### Renderer

- 扩展历史适配任务类型，展示批次进度、错误类型和人工处理原因。
- 现有检查按钮继续启动全量检查；当某批次为 `failed-retryable` 时，按钮请求中携带可选 `retry_batch_id`，只重试该批次。新增字段通过现有一致性检查 IPC/类型透传，不新增独立任务类型。
- Renderer 只展示 `error_code` 的中文映射，不复制事实归一或修复安全规则。

### Analytics

不修改 Analytics Worker、Dashboard 或埋点协议。若现有任务阶段埋点需要增加标签，只增加等价的本地任务阶段字段，不上传正文、事实内容或请求体。

## 测试与验收

### 单元测试

- 事实注册表能从中文数字、阿拉伯数字、金额、日期、年限和地点中提取并归一。
- 固定 `slot` 和 `fact_key` 在不同批次、不同模型随机编号下仍稳定；未知槽位必须转人工。
- 同一事实同值合并、异值冲突；未知章节 ID 拒绝。
- 超过上下文预算时按段落边界拆分；单批失败只影响当前批次。
- 对象/数组/代码围栏 JSON 均能归一；不支持结构化输出时能正确降级。
- `resolutions` 只有精确匹配招标基线、全局事实或确定性归一时才能解除冲突；任意猜测不得进入修复。
- 413、超时、格式错误、冲突和 CAS 失败分别归类。
- 批次成功结果在重启后可复用；正文、基线、全局事实或协议版本变化后必须失效。

### 集成测试

- 完整招标基线不在每个批次重复发送。
- `getHistoricalAdaptationContentCheckContext()` 纳入已确认 global facts，并将其哈希纳入 `inputs_hash`。
- 长正文在小上下文配置下仍能完成事实提取和局部检查。
- 结构化输出不兼容的模拟模型仍能通过兼容模式完成检查。
- 中断任务只恢复失败或未完成批次，不重新提交已成功批次。
- 人工正文不被修复；修复失败整组回滚；复查发现新冲突不报告成功。
- 批次缓存可在失败后断点续跑，正文或事实哈希变化会失效。

### 工程验证

- `node --check` 检查新增和修改的 `.cjs`。
- 定向 Node 测试覆盖事实注册表、AI 适配器、历史一致性任务和 Store 原子修复。
- `cd client; npm run build`。
- Electron 手动验证：长正文、低上下文模型、数组 JSON 返回、人工章节、冲突转人工和阻断清零后的阶段确认。

## 迁移与兼容

旧版 v3/v4 检查快照不包含新事实注册表和批次协议版本，不能直接复用；首次运行 v2 管线时重新建立批次快照。正文、迁移记录、人工确认和导出门禁保持向后兼容。

