# 我的标书同源正文查重与 AI 改写设计

## 背景

“我的标书”列表页当前会在检测到同源项目后自动弹出“同源正文对比查重”弹窗。这个行为会打断用户返回列表页的常规浏览；同时现有弹窗宽度和内容滚动不足，遇到长文件名和左右正文对比时会出现内容显示不全。

用户期望改为人工选择两份方案后明确点击“开始对比”，并在列表页按项目查看最近一次查重结果。查重结果弹窗使用宽屏布局，并为每组重复内容提供按需 AI 改写能力。

## 目标

1. 列表页不再自动弹出同源正文查重结果。
2. 用户在列表页人工选择两份标书项目，并通过明确的“开始对比”按钮触发查重。
3. 每个标书项目可查看其最近一次参与的同源正文查重结果。
4. 查重结果使用宽屏弹窗展示，长标题、长正文和结果列表都有可靠的换行与内部滚动。
5. 每组重复内容可单独点击“AI 改写”，用户可选择改写左侧或右侧文件。
6. AI 改写结果只进入可编辑草稿，必须经用户确认才替换目标文件正文。
7. 用户可将单组重复内容标记为“无需改写”，保留人工判断状态。

## 非目标

1. 不把项目级同源正文查重合并到“标书查重”多文件功能中。
2. 不新增独立路由页；结果仍通过列表页上的宽屏弹窗查看。
3. 不批量 AI 改写所有重复段落；每组重复内容独立触发。
4. 不让 AI 自动覆盖正文。
5. 不改变现有标书正文生成、导出和技术方案 Store 的权威数据结构。

## 用户流程

1. 用户进入“我的标书”列表页。
2. 用户点击项目行的“选择查重”，选择第一份标书。
3. 用户点击另一项目行的“选择查重”，选择第二份标书。
4. 页面显示一个对比选择栏，列出左侧方案、右侧方案和“开始对比”按钮。
5. 用户可交换左右顺序或取消选择。
6. 用户点击“开始对比”后执行正文查重，结果保存到本地 SQLite。
7. 查重完成后自动打开宽屏结果弹窗。
8. 后续返回列表页时不自动弹窗；项目行显示“查看查重结果”入口和最近结果摘要。
9. 用户点击“查看查重结果”后读取最近一次已保存结果，不重新查重。
10. 用户在某组重复内容中选择“改写左侧”或“改写右侧”，点击“AI 改写”。
11. AI 生成改写草稿，用户可继续编辑。
12. 用户点击“确认替换”后才写回对应项目正文。
13. 用户也可点击“无需改写”，保存该组人工判断状态。

## 行为细节

### 人工选择与开始对比

- 删除列表页加载后的自动查重 effect。
- `compareSelection` 最多保留两个项目 ID。
- 选中两份项目后不自动调用 `runCompare()`。
- 页面显示固定的对比选择栏：
  - 左侧项目名。
  - 右侧项目名。
  - “交换左右”按钮。
  - 灵敏度选择。
  - “开始对比”按钮。
  - “取消选择”按钮。
- “开始对比”只有在已选择两份不同项目时启用。
- 若两份项目没有可读取正文，沿用现有错误提示。

### 最近结果入口

- 每个项目行显示“查看查重结果”按钮。
- 当项目没有任何保存过的查重结果时，按钮置灰，提示“暂无查重结果”。
- 当项目有结果时，显示最近结果摘要：
  - 对比对象项目名。
  - 重复组数。
  - 最高相似度。
  - 结果更新时间。
- 点击“查看查重结果”后读取该项目最近一次参与的结果，并打开弹窗。
- “最近一次参与”包括项目作为左侧或右侧的结果，按 `updated_at DESC` 选择。

### 宽屏弹窗

- 复用 `AppDialog`，通过 `cardClassName` 增加项目级宽屏样式。
- 弹窗宽度使用 `min(1120px, calc(100vw - 48px))`。
- 弹窗最大高度使用 `calc(100vh - 48px)`。
- 标题区、控制区、底部操作区固定高度。
- 结果列表区域 `min-height: 0` 且内部滚动。
- 长项目名允许换行，正文 `overflow-wrap: anywhere`，不截断核心内容。
- 在窄屏下左右正文改为单列堆叠。

### AI 改写

- 每组重复内容独立提供目标选择：
  - “改写左侧文件”
  - “改写右侧文件”
- 被选择的一侧是目标文本；另一侧是参考文本。
- “参考文本”的含义：
  - 帮助 AI 理解重复点和语义边界。
  - 不能被照搬。
  - AI 需要保留目标文本必要事实与业务意图，并改用不同表达组织语言。
- 用户点击“AI 改写”后，Main 侧调用 `aiService.requestJson()` 生成结构化结果。
- 返回字段至少包括：
  - `rewrittenText`
  - `reason`
  - `riskNote`
- Renderer 将 `rewrittenText` 放入当前组的可编辑草稿框。
- 用户可继续手动编辑草稿。
- 点击“确认替换”时，按目标侧项目 ID、目标节点 ID、原段落文本和草稿文本调用正文替换。
- 替换成功后重新对比当前两份项目，并刷新结果。

### 无需改写

- 每组重复内容提供“无需改写”按钮。
- 点击后保存该组处理状态为 `ignored`，并记录：
  - `matchId`
  - `decision: ignored`
  - `targetSide: none`
  - `updatedAt`
- 弹窗再次打开时显示“已标记无需改写”。
- “无需改写”不修改任何正文，不影响导出。

## 数据模型

当前已有 `bid_project_duplicate_results` 表保存结果，设计上扩展其 JSON 内容即可，避免新增复杂表：

- `summary_json` 保留摘要。
- `matches_json` 中每个 match 增加可选字段：
  - `decision?: 'pending' | 'ignored' | 'rewritten'`
  - `decisionTargetSide?: 'left' | 'right' | 'none'`
  - `rewriteDraft?: string`
  - `rewrittenAt?: string`
  - `ignoredAt?: string`

`bid_projects` 列表需要补充最近结果摘要，避免 Renderer 逐行多次查询。可以在 Store 层新增 `listProjects()` 的附带字段，或新增专用 `listRecentDuplicateSummaries()`。推荐新增专用查询，降低对项目列表基础结构的影响。

新增类型：

- `BidProjectDuplicateSummary`
  - `projectId`
  - `resultId`
  - `otherProjectId`
  - `otherProjectName`
  - `sensitivity`
  - `duplicateParagraphCount`
  - `maxSimilarity`
  - `updatedAt`

- `BidContentDuplicateRewriteRequest`
  - `resultId`
  - `matchId`
  - `targetSide`
  - `leftProjectId`
  - `rightProjectId`

- `BidContentDuplicateRewriteResult`
  - `rewrittenText`
  - `reason`
  - `riskNote`

## IPC 与 Main 侧接口

新增 bidProject IPC：

- `bid-project:recent-duplicate-summaries`
  - 输入：可选项目 ID 数组。
  - 输出：`Record<string, BidProjectDuplicateSummary | null>`。

- `bid-project:load-duplicate-result`
  - 输入：`resultId`。
  - 输出：完整查重结果、左右项目信息和 match 状态。

- `bid-project:load-latest-duplicate-result`
  - 输入：`projectId`。
  - 输出：该项目最近一次参与的结果，若无则返回 `null`。

- `bid-project:rewrite-duplicate-match`
  - 输入：`BidContentDuplicateRewriteRequest`。
  - 输出：`BidContentDuplicateRewriteResult`。

- `bid-project:update-duplicate-match-decision`
  - 输入：`resultId`、`matchId`、`decision`、`targetSide` 和可选草稿。
  - 输出：更新后的结果。

`registerBidProjectIpc()` 需要接收 `aiService`，并由 Main 侧统一发起 AI 改写请求。

## Renderer 组件设计

继续以 `BidProjectWorkspacePage.tsx` 为入口，但应拆分轻量组件，避免页面继续膨胀：

- `BidProjectCompareBar`
  - 显示已选两份项目、左右顺序、灵敏度和“开始对比”。

- `BidProjectDuplicateResultDialog`
  - 宽屏结果弹窗。
  - 负责结果展示、目标侧选择、AI 改写、无需改写和确认替换。

- `BidProjectRow`
  - 增加最近查重摘要和“查看查重结果”按钮。
  - 继续保留“选择查重”按钮。

页面状态：

- `compareSelection: string[]`
- `compareSensitivity`
- `recentDuplicateSummaries: Record<string, BidProjectDuplicateSummary | null>`
- `activeDuplicateResult`
- `compareLoading`
- `rewriteLoadingByMatch`
- `rewriteDrafts`
- `rewriteTargetsByMatch`

## 错误处理

- 无法读取项目正文：toast 错误，保留选择状态，便于用户调整。
- 没有最近结果：按钮置灰，不弹窗。
- AI 改写失败：只显示该组错误提示，不关闭弹窗。
- 确认替换失败：提示“原正文已发生变化，请重新查重”，保留草稿。
- 重新查重成功后刷新列表摘要和当前弹窗结果。

## 验证

最低验证：

1. `cd client; node --check electron\ipc\bidProjectIpc.cjs`
2. `cd client; node --test electron\services\bidProjectStore.test.cjs`
3. 若新增 AI 改写服务测试，则定向运行对应 `node --test`。
4. `cd client; npm run build`
5. 手动验证：
   - 返回“我的标书”列表不会自动弹窗。
   - 人工选择两份项目后，“开始对比”可用。
   - 查重完成后结果弹窗显示完整。
   - 列表项目行显示最近查重摘要。
   - 点击“查看查重结果”读取已保存结果。
   - 每组重复内容可选择左侧或右侧 AI 改写。
   - “无需改写”状态关闭重开后仍可见。

## 自检

- 本设计未要求自动弹窗。
- 本设计保留人工确认后才替换正文。
- 本设计未引入独立页面或批量改写。
- 本设计把 AI 请求放在 Main 侧，符合现有 AI 服务边界。
- 本设计没有新增跨层重复参数校验。
- 本设计的 CSS 方案包含弹窗内部滚动和长文本换行，覆盖截图中的显示不全问题。
