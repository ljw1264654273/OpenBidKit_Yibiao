# 技术方案图片模式与统一审核弹窗设计

## 1. 背景与目标

当前技术方案流程在 STEP 01 将图片配置拆成 AI 配图、Mermaid 图和 HTML 图，在 STEP 05 只对 Mermaid 图片提供审核和 AI 重绘入口。本次优化将面向用户统一图片概念和审核体验：

1. STEP 01 用四种图片模式替代三类独立开关：
   - 增强图文
   - 丰富图文
   - 基础配图
   - 纯文字
2. Mermaid 的用户可见名称统一改为“流程图”，HTML 图的用户可见名称统一改为“PPT 图”。
3. STEP 05 将 Mermaid 审核弹窗升级为全部图片的统一审核弹窗，AI 配图、流程图和 PPT 图均可查看、确认和进入 AI 重绘流程。
4. AI 重绘结果作为候选资源展示，用户明确点击“采用重绘结果”后才替换正文中的原始资源。
5. 保留现有内部 `kind: ai/mermaid/html`、SQLite 旧字段和 Mermaid IPC 入口，兼容历史工作区和旧任务状态。

本次改动只覆盖技术方案和已有方案扩展共用的正文配图流程，不改动 Analytics 埋点协议，不删除现有统计能力。

## 2. 已确认的用户行为

### 2.1 STEP 01 图片模式

| 用户模式 | AI 配图 | 流程图 | PPT 图 | 默认行为 |
|---|---:|---:|---:|---|
| 增强图文 | 10 | 8 | 8 | 三类图片均启用，数量较丰富 |
| 丰富图文 | 3 | 3 | 3 | 三类图片均启用，正文生成阶段仍可调整 |
| 基础配图 | 0 | 5 | 0 | 只启用流程图 |
| 纯文字 | 0 | 0 | 0 | 不编排、不生成任何图片 |
| 自定义 | 按当前配置 | 按当前配置 | 按当前配置 | STEP 05 图片配置发生过手动变化后进入 |

数量仍受当前可配图叶子小节数量限制；图片模型不可用时，AI 配图实际不会生成，但用户选择的图片模式仍应保留为已选择的预设，不应因为模型暂时不可用而错误显示为自定义。

STEP 01 只展示并选择模式，不再展示三个独立图片开关。快速配置摘要显示当前模式名称。

预设值分为两层：

- **规范值**：预设本身保存的意图值，例如增强图文固定为 AI 10、流程图 8、PPT 图 8；
- **运行值**：正文生成时按可配图叶子数量和图片模型可用性得到的有效值，例如叶子只有 4 个时三个上限分别按 4、4、4 执行，图片模型不可用时本次只跳过 AI 生图。

规范值用于判断和回显 `imagePreset`，运行值只在任务启动或已有的 `normalizeGenerationOptions()` 阶段计算，不回写为自定义配置。

实现上需要拆分两个归一化入口：

- `normalizePersistedContentGenerationOptions()`：读取/保存工作区配置时保留预设规范上限，不按叶子数量截断，也不因图片模型不可用改写 `useAiImages`；
- `normalizeRuntimeContentGenerationOptions()`：启动正文任务时复制持久化配置，再按当前叶子数量和模型可用性生成运行值。

STEP 05 保存配置必须先使用持久化归一化入口判断并写回 `imagePreset`，然后任务启动时才使用运行时归一化入口。

### 2.2 自定义模式

以下任一图片相关字段发生手动变化后，图片模式显示为“自定义”：

- `useAiImages`
- `maxAiImages`
- `useMermaidImages`
- `maxMermaidImages`
- `useHtmlImages`
- `maxHtmlImages`
- `htmlImageTypes`

仅修改表格、一致性审计、原方案覆盖审计等非图片配置，不触发“自定义”。

保存 STEP 05 正文生成配置时：

1. 先将用户编辑后的原始图片字段与四个预设的规范值比较；
2. 完全匹配某个预设时保存对应预设；
3. 不匹配时保存 `custom`；
4. 运行时的叶子数量截断和 AI 模型可用性不参与该比较；
5. 历史工作区没有预设字段时，只根据数据库中实际保存的旧字段原始值做精确匹配；如果旧值已被历史逻辑截断、归一化或无法确认原始意图，则显示并保存为 `custom`，不根据当前叶子数量或模型状态反向猜测预设。

## 3. 兼容性策略

### 3.1 配置字段

在 `ContentGenerationOptions` 增加可选的图片模式字段，建议命名为：

```ts
imagePreset?: 'enhanced' | 'rich' | 'basic' | 'text-only' | 'custom';
```

现有字段继续作为实际生成配置：

- `useAiImages` / `maxAiImages`
- `useMermaidImages` / `maxMermaidImages`
- `useHtmlImages` / `maxHtmlImages`
- `htmlImageTypes`

预设选择只负责一次性写入上述旧字段和 `imagePreset`。正文任务、图片编排 Agent 和图片生成服务继续读取旧字段，避免改变现有任务输入协议。

`useAiRedesignForMermaid` 是历史兼容字段：

- 新的统一审核/重绘流程不再根据它决定是否自动重绘；
- 新配置保存时保持其现有值，默认新配置为 `false`；
- 它不参与四种预设和“自定义”的判断；
- 当前代码中它没有独立的 Main 侧运行时消费者，因此历史值为 `true` 或 `false` 都只原样保留，不会在新任务中隐式触发重绘；
- 旧的 `redrawConfirmedMermaidIllustrations` 参数继续按旧语义执行已确认 Mermaid 项的显式重绘；它优先于该配置字段，但不处理 AI/PPT 图；
- 统一重绘按钮使用新的通用任务参数，不再写入该字段。

### 3.2 用户可见命名与内部命名

用户可见文案统一使用：

- `AI 配图`
- `流程图`
- `PPT 图`

以下内部值暂时保留：

- `kind: 'mermaid'`
- `kind: 'html'`
- `image_type` 中已有的 Mermaid 类型标识
- 数据库列名 `generation_*`
- 现有 Mermaid IPC 通道名称
- 现有任务参数 `redrawConfirmedMermaidIllustrations`

新增统一入口使用图片审核语义命名；旧 Mermaid 入口作为兼容包装，不再作为新 UI 的唯一数据来源。

## 4. STEP 05 统一图片审核弹窗

### 4.1 入口与列表

现有“Mermaid 待确认”区域升级为“图片待审核”区域：

- 汇总显示全部待审核图片数量；
- 左侧列表包含 `ai`、`mermaid`、`html` 三类图片；
- 每项显示图题、所属章节、用户可见图片类型和审核状态；
- 按当前图片计划顺序展示；
- 纯文字模式或图片计划为空时不显示审核入口；
- 章节旁的审核入口改为“审核图片”，按章节筛选三类图片。

审核状态统一为：

- 待确认
- 已确认
- 已跳过

历史图片项缺少 `review_status` 时按“待确认”处理，以兼容已有 Mermaid 计划。

### 4.2 B 方案布局

弹窗采用已确认的 B 方案：

- 左侧：图片列表；
- 中间上方：当前图片原始效果；
- 右侧：AI 重绘效果；
- 中间下方：代码或调整要求输入；
- 底部：审核、重绘和资源采用操作。

原图和 AI 重绘图保持同高并排，保证用户可以直接比较。弹窗需要保留现有流程图预览的缩放、拖拽和适应窗口能力；AI 配图和 PPT 图使用图片预览，并支持统一的预览放大/查看能力。

### 4.3 三类图片的原图展示

| 内部类型 | 用户可见类型 | 原图展示 |
|---|---|---|
| `mermaid` | 流程图 | 使用 `generation.code` 本地渲染 Mermaid；保留代码编辑和更新预览 |
| `ai` | AI 配图 | 使用 `generation.asset_url` 展示当前生成图片 |
| `html` | PPT 图 | 使用 `generation.asset_url` 展示 HTML 本地转 PNG 结果 |

所有非本地可信内容的 Markdown 预览继续显式使用 `allowRawHtml={false}`。流程图代码仍按 Markdown `mermaid` 代码块保存和本地渲染。

### 4.4 底部编辑区

流程图：

- 编辑 Mermaid 代码；
- 更新预览；
- 恢复 AI 初稿；
- 在 AI 调整要求中粘贴参考图片；
- 调用文本模型调整代码。

AI 配图和 PPT 图：

- 展示图片调整要求输入；
- 可粘贴参考图片；
- AI 配图调用生图模型生成重绘候选；
- PPT 图调用文本模型生成 HTML，再由 Main 本地转 PNG 生成重绘候选。

三类图片共用：

- 跳过此图；
- 确认此图；
- 开始 AI 重绘；
- 采用重绘结果；
- 关闭弹窗。

“开始 AI 重绘”是批量操作，处理当前计划中所有 `review_status=confirmed` 且没有有效候选的图片。只要列表中仍有任意 `review_status=pending` 项，批量按钮保持禁用，并提示先确认或跳过全部图片；已跳过项不参与批量重绘。列表项另提供“重绘此图”作为单图重试入口，单图入口只传当前 `itemId`，且当前项必须已经确认。两种入口共享同一个后台任务实现。

## 5. 审核与重绘数据模型

### 5.1 状态拆分

现有 `generation.review_status` 继续表示原图审核状态，新增重绘状态字段：

```ts
generation?: {
  status: 'pending' | 'running' | 'reviewing' | 'skipped' | 'success' | 'error';
  review_status?: 'pending' | 'confirmed' | 'skipped';
  redraw_status?: 'idle' | 'running' | 'success' | 'error';
  redraw_asset_url?: string;
  redraw_source_path?: string;
  redraw_error?: string;
  redraw_attempts?: number;
  redraw_updated_at?: string;
  asset_url?: string;
  source_path?: string;
  code?: string;
  draft_code?: string;
}
```

字段语义：

- `asset_url`：当前正文使用的资源；
- `redraw_asset_url`：AI 重绘后尚未采用的候选资源；
- `review_status`：用户是否确认原图；
- `redraw_status`：候选资源的生成状态；
- `source_path` / `redraw_source_path`：PPT 图源文件或其他可恢复资源路径；
- `code` / `draft_code`：流程图当前代码和 AI 初稿。

状态组合规则：

| 阶段 | `generation.status` | `review_status` | `redraw_status` | 正文是否使用 |
|---|---|---|---|---|
| 原图待审核 | AI/PPT 为 `success`；流程图为 `reviewing` | `pending` | `idle` | 使用原图；流程图使用已插入的 Mermaid 草稿 |
| 原图已确认 | AI/PPT 为 `success`；流程图沿用现有确认语义为 `pending` | `confirmed` | `idle` | 继续使用当前正文中的原图/流程图草稿 |
| 原图已跳过 | `success`、`reviewing` 或 `skipped` | `skipped` | `idle` | 保留原图，不再重绘 |
| 重绘进行中 | AI/PPT 为 `success`；流程图为 `pending` | `confirmed` | `running` | 继续使用原图 |
| 候选生成成功 | AI/PPT 为 `success`；流程图为 `pending` | `confirmed` | `success` | 继续使用原图，直到用户采用 |
| 候选生成失败 | AI/PPT 为 `success`；流程图为 `pending` | `confirmed` | `error` | 继续使用原图 |
| 采用候选后 | 三类均为 `success` | `confirmed` | `idle` | 使用新的 `asset_url` 图片 |

`generation.status` 继续表示当前正文资源或原有 Mermaid 审核草稿的状态；候选生成不得改变它，也不得仅凭 `redraw_status=success` 将候选插入正文。流程图确认后的 `pending` 是历史协议兼容值，不表示正文应删除已有审核草稿；只有用户采用候选时，流程图才转换为 `success` 并以图片资源作为当前正文资源。

“有效候选”必须同时满足候选 URL 存在且资源文件可读；PPT 图还必须满足候选 HTML 源文件存在且可读。候选状态变更、候选 URL 写入和任务进度必须通过 `checkpointTask()` 或等价的 Store 持久化路径提交，不以 `generation.status` 是否变化作为是否落库的条件。

不允许在重绘任务完成时直接覆盖 `asset_url`。用户点击“采用重绘结果”后，才执行：

```text
asset_url <- redraw_asset_url
source_path <- redraw_source_path（如有）
redraw_asset_url <- 清空
redraw_source_path <- 清空
redraw_status <- idle
```

采用候选时同时更新正文中对应的 `yibiao-illustration` 资源地址，并保留图题和插入位置。
该操作由 Main Store 在一个数据库事务中同时更新图片计划项和正文权威内容；任一步校验失败则整体回滚，不留下“计划已采用但正文未更新”的半状态。

### 5.2 重绘输入

- AI 配图：使用原图上下文、正文参考、图题、图片类型和用户调整要求调用生图模型；
- PPT 图：必须读取首轮生成留下的 `source_path` HTML，由文本模型结合正文参考和调整要求重新生成完整 HTML，再由 Main 本地转 PNG；如果 `source_path` 缺失、文件不存在或无法读取，直接将该项标记为 `redraw_status=error` 并提示重新生成首轮图片，不调用图片模型回退；
- 流程图：先由文本模型调整 Mermaid 代码并本地校验，再使用已确认代码调用生图模型进行 AI 重绘；
- 参考图片继续支持本地路径和剪贴板 Data URL 两种形式；AI 配图和流程图重绘传给支持图片输入的生图/文本模型，PPT 图调整传给文本模型时只作为可选视觉参考，不影响 HTML 本地渲染的事实约束；
- 模型请求统一经过现有 `aiService.cjs`，不在业务服务中直接请求外部模型。

### 5.3 审核状态流转

```text
生成图片
  -> review_status=pending
  -> 确认原图
  -> review_status=confirmed
  -> 开始 AI 重绘
  -> redraw_status=running
  -> redraw_status=success + redraw_asset_url
  -> 采用重绘结果
  -> asset_url 替换为候选，清空 redraw 字段
```

跳过流程：

```text
review_status=pending/confirmed
  -> 跳过此图
  -> review_status=skipped
  -> 不进入重绘
```

重绘失败时：

- 保留 `asset_url`；
- 写入 `redraw_status=error` 和 `redraw_error`；
- 允许用户重新发起重绘；
- 不影响其他图片和正文。

### 5.4 重绘任务边界

统一任务参数建议为：

```ts
{
  redrawConfirmedIllustrations: true;
  illustrationItemIds?: string[];
}
```

- `illustrationItemIds` 缺省表示批量处理全部符合条件的已确认项；
- 传入一个或多个 ID 时只处理指定项，指定项必须属于当前项目图片计划；
- 未确认、已跳过、已有候选成功且未要求重新生成的项跳过；
- 批量参数只有在全部可审核项已经确认或跳过时允许提交；单图参数只要求目标项已确认；
- 同一项目已有图片重绘任务处于 `running` 或 `pausing` 时，禁止重复启动并提示用户；
- 批量任务中单张失败只记录该项错误，其他项继续；
- 任务模式、目标 ID 列表、已处理 ID 列表和当前阶段持久化到现有 `contentGenerationRuntime` 的图片重绘专用字段，建议命名为 `illustration_redraw_mode`、`illustration_redraw_item_ids`、`illustration_redraw_processed_item_ids`、`illustration_redraw_phase`；`processed_item_ids` 表示本批次已经到达候选成功或候选失败终态的项，失败项不会在暂停恢复时自动重试，必须通过明确的“重试失败项”入口移除对应 ID 后重试；应用重启后只恢复原目标列表，不扩大为全计划；
- 本次不新增独立取消按钮，沿用当前正文任务的暂停/继续语义；暂停时将当前运行项恢复为可重试状态，已生成候选保留，继续后只处理原目标列表中尚未完成的项；
- 失败项可通过单图入口再次启动，重新生成前清理该项旧候选并保留正文原图。

## 6. IPC 与 Main 服务边界

新增通用审核协议，建议包含：

- `previewIllustrationReviewItem`
- `saveIllustrationReviewDraft`
- `adjustIllustrationReviewItem`
- `confirmIllustrationReviewItem`
- `skipIllustrationReviewItem`
- `redrawConfirmedIllustrations`
- `adoptIllustrationRedraw`

IPC 层只负责解析项目、转发参数和返回 Store patch；业务逻辑放入现有 `electron/services/`：

- 图片审核状态和 SQLite 持久化：`technicalPlanStore.cjs`
- 图片重绘编排：`contentIllustrationGeneration.cjs` 或同一职责的专用服务
- 后台任务调度：`contentGenerationTask.cjs`
- preload bridge：`electron/preload.cjs`
- 类型协议：`src/shared/types/ipc.ts`

旧 Mermaid IPC 保留：

- 旧 `previewMermaidReviewItem`、`saveMermaidReviewCode`、`adjustMermaidReviewCode`、`confirmMermaidReviewItem`、`skipMermaidReviewItem` 继续可调用；
- 内部转发到通用协议或保持原有行为；
- 新 UI 只调用通用协议。

重绘任务继续复用 `taskService` 的任务生命周期、暂停/继续、队列 scope 和进度事件，不在 Renderer 页面卸载时取消后台任务。重绘专用运行的最终任务状态独立于正文小节状态：所有目标候选成功时为 `success`，至少一项候选失败且其他项已结束时为 `error`，暂停时为 `paused`；不根据正文未解决小节重新计算重绘任务结果。

## 7. SQLite 与资源清理

运行时 SQLite 表 `technical_plan_illustration_items` 增加重绘候选字段，并同步：

- `client/electron/services/sqliteDatabase.cjs` 的建表和 migration；
- 根目录 `sql/workspace_schema.sql` 的目标结构；
- `technicalPlanStore.cjs` 的读写、资源保留和资源清理逻辑。

资源清理规则：

1. 原图 `asset_url` 在仍被正文或当前计划引用时保留；
2. 重绘候选 `redraw_asset_url` 在任务失败、关闭弹窗或重启后仍保留，直到被采用、重新生成或明确清理；
3. 采用候选后，旧原图如果不再被其他正文或计划引用，可进入现有延迟清理流程；
4. PPT 图的 `source_path` 和 `redraw_source_path` 遵循现有项目源文件清理约定；
5. 不扩大 `generated-images` 清理范围，不删除历史资源引用。

计划失效、重新编排、工作区重置和删除项目时，同时收集并清理 `asset_url`、`redraw_asset_url`、`source_path` 和 `redraw_source_path` 中不再引用的资源；仅关闭审核弹窗不清理候选。运行中的任务先按现有 `taskService` 取消/暂停并等待 runner settled，再提交清理，避免后台任务继续写入已失效资源。

SQLite 迁移必须同时覆盖两类表：

- 全局兼容表 `technical_plan_illustration_items`；
- `createTechnicalPlanProjectSchema()` 根据项目表命名规则创建的项目专属图片项表。

建表结构、`addColumnIfMissing()` migration、Store 的动态表名访问、资源清理查询和 `sql/workspace_schema.sql` 均需同步增加同一组候选字段，不能只修改全局表。

候选资源路径规则：

- AI 配图候选由现有生图服务写入随机文件名，候选 URL 直接记录在 `redraw_asset_url`；
- 流程图重绘候选由生图服务写入独立随机文件名，不能覆盖原 `asset_url`；
- PPT 图候选使用独立的 `illustrations/<revision>/html/redraw-<itemId>-<uuid>.html` 源文件和 `generated-illustrations/<revision>/redraw-<itemId>-<uuid>.png` 资源路径；首轮 HTML/PNG 路径缺失时按前述规则失败，不覆盖或补写首轮资源；
- 现有首轮 HTML 路径 `illustrations/<revision>/html/<itemId>.html` 和 PNG 路径保持不变；
- 采用候选时只切换数据库中的当前资源引用，旧资源通过现有延迟清理规则判断是否可删除。

## 8. 配图计划与正文插入规则

第一轮图片编排仍由现有 Agent 使用三类内部 `kind` 和旧的数量字段完成。只要对应开关启用，三类图片均可进入审核计划。

正文插入规则保持：

- AI 配图和流程图通常插入对应叶子小节末尾；
- PPT 图按既有 `placement` 和多节组规则插入；
- 审核草稿和成功资源使用同一 `yibiao-illustration` 标记；
- 重绘候选未采用前，不替换正文中的原始资源；
- 所有重新应用图片计划的路径都必须排除 `review_status=skipped` 的图片项；跳过不会删除已经存在的正文图片块，但也不会在正文被重新编排或计划重放时再次插入；
- 采用重绘结果时只替换对应图片资源，不重复插入图片块。

正文更新的精确规则：

- AI 配图和 PPT 图：按图片块的 `<!-- yibiao-illustration:start id="..." -->` 标记定位，只替换块内图片 URL；找不到唯一标记或命中多处时拒绝采用并提示人工处理；
- 流程图：如果正文当前使用 Mermaid 代码块，则采用 AI 重绘后将该计划项对应块替换为图片；如果正文已是图片，则按同一图片块规则替换 URL；
- 用户已经手工删除对应图片块时，采用操作整体失败并回滚图片计划，提示“正文中未找到原图片，请手动插入”；用户确认后可重新打开弹窗，但不会留下孤立候选采用状态；
- 用户手工修改图题或图片块其他文字时，替换只触及资源 URL，不覆盖用户文字；
- 流程图代码在确认后如果被用户再次编辑、保存或被 AI 调整，则立即将该项 `review_status` 重置为 `pending` 并清空现有重绘候选；只有重新确认后的代码才允许重绘或采用候选。采用候选时不尝试合并用户修改过的 Mermaid 代码；
- 跳过此图始终保留正文当前内容，不移除原图；它只阻止重绘调度。

## 9. 可见文案与统计

需要同步检查并改名的用户可见位置：

- STEP 01 快速配置和摘要；
- STEP 05 正文生成配置；
- 图片审核横幅、列表、弹窗标题和按钮；
- 配图统计；
- 进度提示、日志展示和错误提示；
- 开发者演示页中的图片类型说明；
- 与正文图片相关的测试断言和页面文案。

内部统计字段可继续使用旧字段名，以避免改变 Analytics 协议；如增加新埋点，必须保持现有失败静默和脱敏规则。

## 10. 错误处理与边界

- 图片模型不可用时，AI 配图预设仍可保存，但实际生成沿用现有模型不可用逻辑；
- 纯文字模式不创建图片编排计划，不显示图片审核入口；
- 没有原始资源的历史图片项显示可操作错误，不允许误认为已重绘成功；
- 流程图代码校验失败只更新当前审核项错误，不影响其他图片；
- 单张图片重绘失败不阻断其他已确认图片；
- 任务暂停后，已完成的候选资源和状态保留，可继续或重试；本次不新增独立取消入口；
- 弹窗关闭不会取消后台重绘任务；
- 页面重新进入时先读取 Store 快照，再订阅任务事件并回放活动任务。

## 11. 测试与验收

### 11.1 单元和协议测试

- 四种图片模式的字段映射、数量上限和 AI 模型不可用行为；
- 历史无 `imagePreset` 配置的推导；
- 第五步修改图片开关、数量、PPT 图类型后进入 `custom`；
- 三类图片审核列表筛选和状态标签；
- 原图资源与重绘候选资源分离；
- 重绘成功、失败、重试和采用候选的 Store 持久化；
- SQLite 重启恢复重绘字段；
- 持久化图片模式不因叶子数量截断或图片模型不可用而变成 `custom`，运行时值单独归一化；
- 跳过图片不会在图片计划重新应用时再次插入正文；
- 候选状态在流程图 `generation.status=pending` 的情况下仍能 checkpoint 并在重启后恢复；
- 项目专属图片项表和全局兼容表都完成候选字段 migration；
- 历史 Mermaid IPC 和 Mermaid 审核测试继续通过；
- 旧的 Mermaid 重绘任务参数继续可用。

### 11.2 构建与 Electron 验证

```powershell
cd client
node --check electron\preload.cjs
node --check electron\ipc\technicalPlanIpc.cjs
node --check electron\services\technicalPlanStore.cjs
node --check electron\services\contentIllustrationGeneration.cjs
npm run build
npm run smoke:electron-native
```

有对应测试文件时定向执行：

```powershell
node --test electron\services\technicalPlanStore.contentGenerationOptions.test.cjs
node --test electron\services\contentGenerationTask.mermaidRedraw.test.cjs
node --test electron\services\contentIllustrationGeneration.ai-mermaid.test.cjs
node --test src\features\technical-plan\services\quickConfig.test.ts
node --test src\features\technical-plan\services\workflowLayout.test.ts
```

### 11.3 手动验收

1. STEP 01 分别选择四种模式，确认摘要、正文配置和实际旧字段映射一致。
2. 在 STEP 05 修改任一图片类型、数量或 PPT 图类型，返回 STEP 01 确认显示“自定义”；叶子数量不足和图片模型不可用不应导致预设误变为自定义。
3. 生成包含 AI 配图、流程图和 PPT 图的正文。
4. 打开统一图片审核弹窗，确认左侧能看到三类图片。
5. 确认 B 方案布局：中间原图、右侧 AI 重绘效果、底部编辑与操作。
6. 分别确认三类图片并启动 AI 重绘，确认候选图不会立即覆盖原图。
7. 点击“采用重绘结果”，确认正文资源替换且不重复插入图片块。
8. 关闭并重新打开客户端，确认审核和候选状态恢复。
9. 验证暂停、失败、重试和历史 Mermaid 项兼容。
10. 验证候选资源与原图同时存在，采用候选后正文只替换资源地址；验证用户删除原图片块后采用候选不会重复插入。
11. 验证仍有待审核项时批量按钮禁用，单图重绘只允许已确认项；验证应用重启后批量目标 ID 不扩大。
12. 验证流程图确认后再次修改代码会清空候选并要求重新确认；验证重绘任务终态不受正文其他小节失败影响。

## 12. 非目标

- 不重新设计图片编排 Agent 的三类内部 `kind`；
- 不在本次改动中重命名 SQLite 列名或历史 IPC 通道；
- 不改变正文、Word 导出和 HTML/Mermaid 本地渲染的既有资源协议；
- 不删除旧的 Mermaid 审核数据和旧任务恢复逻辑；
- 不调整 Analytics Worker、Dashboard 或统计聚合协议，除非实现过程中确认已有事件名称必须同步改名。
