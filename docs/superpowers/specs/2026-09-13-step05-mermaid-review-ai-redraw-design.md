# 第五步 Mermaid 审核后 AI 重绘设计

## 背景

第五步“正文生成”已经支持三类全文配图：AI 图片、Mermaid 图片和 HTML 图片。其中 Mermaid 配图当前链路是：图片编排 Agent 选择适合的流程、层级或职责关系图，文本模型生成 Mermaid 代码，Main 本地校验和渲染；如果用户开启“Mermaid 改用 AI 图片重绘”，系统会直接把已校验的 Mermaid 代码交给图片模型重绘，并将最终图片插入正文。

用户希望在 AI 重绘之前增加人工确认环节：页面应识别正文中适合调整流程图的位置，给出 Mermaid 流程图代码和 Markdown 预览效果，让使用者检查是否存在问题；使用者可以修改 Mermaid 代码并生成新的预览效果图；确认之后再改用 AI 图片重绘。

## 目标与非目标

目标：

- 只在开启“使用 Mermaid 生图”且开启“Mermaid 改用 AI 图片重绘”时启用 Mermaid 审核流程。
- 正文生成任务完成后展示 Mermaid 待确认区，不让后台正文任务长期卡在人工确认节点。
- Mermaid 草稿保留现有图片编排结果、图题、图类型、小节引用和数量上限。
- 用户可以逐项查看 Mermaid 代码、Markdown 预览效果和关联章节，修改代码后重新生成预览。
- 用户确认后，系统使用确认后的 Mermaid 代码调用 AI 图片模型重绘，并把生成图片插入正文。
- 未确认或跳过的 Mermaid 项不进入 AI 重绘，避免错误图被自动定稿。
- 现有普通 Mermaid 代码渲染模式保持自动完成，不新增审核步骤。

非目标：

- 不改变 AI 图片、HTML 图片的编排优先级、上限和生成链路。
- 不新增在线 Mermaid 渲染依赖；预览和校验继续使用本地 Mermaid 渲染能力。
- 不把 Mermaid 计划项改成 `kind: ai`。
- 不改变 Word 导出对 Mermaid 代码块和生成图片的既有处理规则。
- 不在正文手工编辑器内混合承担 Mermaid 审核状态管理；审核区独立于普通正文编辑。

## 推荐流程

用户在“正文生成配置”中开启“使用 Mermaid 生图”和“Mermaid 改用 AI 图片重绘”后启动正文生成。正文、审计、字数调整和全文图片编排按现有流程执行。进入图片生成阶段时，Mermaid 项不立即调用图片模型，而是先生成并校验 Mermaid 代码，保存为待确认草稿；AI 图片和 HTML 图片继续按现有流程生成。任务结束后，正文页面显示“Mermaid 待确认”入口和数量。

用户进入审核区后逐项处理：

1. 查看章节、图题、图类型、引用正文摘要、Mermaid 代码和 Markdown 预览。
2. 修改 Mermaid 代码后点击“更新预览”，Main 执行语法检查和本地渲染校验，Renderer 展示新的 Mermaid 预览。
3. 预览无误后点击“确认此图”，该项状态变为已确认。
4. 对不需要重绘的项可选择“跳过”，该项不会插入 AI 重绘图片。
5. 存在已确认项时，用户点击“开始 AI 重绘”，系统启动独立的图片重绘任务，只处理已确认 Mermaid 项。

重绘完成后，系统把确认项生成的 `asset_url` 按现有图片 Markdown 块插入对应正文，并保留 `contentIllustrationPlan` 中的生成状态。跳过项不插入图片；失败项显示错误并允许修正代码后再次确认和重绘。

## 页面设计

第五步正文页面沿用当前左右工作区结构，不新增菜单页面。

在任务完成且存在待确认 Mermaid 项时，内容区顶部或进度摘要附近展示轻量提示条：`Mermaid 待确认 X 项`，提供“打开审核”按钮。开发者模式下的图片统计继续保留；面向普通用户的待确认入口不依赖开发者模式。

审核界面使用 Dialog 或页面内侧栏，避免打断当前正文浏览。每个审核项包含：

- 章节路径、图题和图类型。
- 状态标签：待确认、已确认、已跳过、重绘中、重绘成功、重绘失败。
- Mermaid 代码编辑区。
- Markdown 效果预览，复用 `MarkdownRenderer` 的 `renderMermaid`，并显式关闭原始 HTML。
- 操作按钮：更新预览、确认此图、跳过、恢复 AI 初稿。

底部操作区展示已确认数量和重绘入口。只有至少一项已确认且没有正在运行的正文任务时，才允许“开始 AI 重绘”。重绘启动后沿用现有任务进度组件文案，但区分“Mermaid 审核后 AI 重绘”与普通图片生成。

## 数据模型

复用 `contentIllustrationPlan.items` 作为权威列表，给 Mermaid 项的 `generation` 增加审核相关字段，避免新增平行缓存：

- `status`: 继续使用 `pending`、`running`、`success`、`error`。
- `code`: 当前生效 Mermaid 代码；用户确认后保存确认版。
- `draft_code`: AI 初次生成的 Mermaid 草稿，用于“恢复 AI 初稿”。
- `review_status`: `pending`、`confirmed`、`skipped`。
- `review_error`: 最近一次代码校验或预览生成错误。
- `reviewed_at`: 最近确认或跳过时间。
- `asset_url`: AI 重绘成功后的最终图片地址。

旧工作区没有这些字段时按现有生成状态兼容处理。普通 Mermaid 模式不写入 `review_status`，仍直接以 `code` 插入 Mermaid 代码块。开启 AI 重绘审核模式时，Mermaid 项先保存 `code` 和 `draft_code`，`review_status` 默认为 `pending`，不写入 `asset_url`。

`saveContentGenerationOptions()` 继续保持现有语义：保存选项会清空旧 `contentIllustrationPlan` 元数据，但不修改已生成正文内容。正文手工保存、目录变更和全文图片重新编排仍按现有失效规则清理图片计划。

## Main 与 IPC

新增薄 IPC 能力，业务逻辑放在 Main service：

- `previewMermaidReviewItem(itemId, code)`: 校验 Mermaid 语法并本地渲染，成功后返回可预览状态或 PNG 预览信息，失败时返回中文错误。
- `saveMermaidReviewCode(itemId, code)`: 保存当前代码草稿，但不确认。
- `confirmMermaidReviewItem(itemId, code)`: 校验并保存确认代码，状态设为 `confirmed`。
- `skipMermaidReviewItem(itemId)`: 状态设为 `skipped`。
- `startMermaidReviewRedraw()`: 启动仅处理已确认 Mermaid 项的后台任务。

Renderer 仍只通过 `window.yibiao` 调用，不直接访问 Node、`fs` 或 `ipcRenderer`。新增 preload API 时同步 `client/src/shared/types/ipc.ts`。

## 任务流程

`contentGenerationTask` 在图片生成阶段按模式分支：

- 普通 Mermaid 模式：保持当前 `generateMermaidIllustration()` 行为，生成 Mermaid 代码并插入 Mermaid 代码块。
- Mermaid AI 重绘审核模式：生成并校验 Mermaid 代码后，将计划项保存为 `review_status: pending`，不调用图片模型，不把 Mermaid 图插入正文。任务继续完成，并在日志中提示“已生成 Mermaid 待确认草稿”。

新增“审核后重绘”任务可以复用 `tasks.startContentGeneration()` 的 `rerunIllustrations` 思路，也可以增加明确 payload，例如 `redrawConfirmedMermaidIllustrations`。该任务只读取当前 `contentIllustrationPlan` 中 `kind === 'mermaid' && review_status === 'confirmed'` 的项，调用现有 `buildMermaidAiImagePrompt()` 和 `aiService.generateImage()`。成功后写入 `asset_url`、`status: success`，失败写入 `status: error` 和错误信息。

重绘任务完成后调用现有 `applyGeneratedIllustrationsToDocument()` 插入最终图片。该函数需要继续按 `asset_url` 分支生成图片 Markdown；跳过和未确认项没有 `asset_url`，不会插入正文。

暂停和恢复沿用现有任务体系。由于审核发生在正文任务完成后，应用关闭不会丢失待确认状态；下次打开仍从 SQLite 加载 `contentIllustrationPlan` 展示审核区。

## 错误处理

Mermaid 代码校验失败时，审核项保留当前编辑内容并显示错误，不允许确认。错误文案应说明具体问题，例如中文节点标签必须使用双引号、不能使用分号、不能使用多节点 `&` 连接简写、本地渲染失败等。

AI 重绘失败时只影响该图项，不回退为普通 Mermaid 代码块，也不阻止其他确认项继续处理。用户可以修改 Mermaid 代码后重新确认并再次重绘。

图片模型不可用时，“开始 AI 重绘”不可用，并提示先到设置页测试生图模型。若启动后配置失效，Main 记录明确错误，不静默切换到普通 Mermaid 模式。

## 验证

最低验证：

- Renderer / TypeScript：`cd client; npm run build`。
- Main / preload / IPC：对新增或修改的 `.cjs` 执行 `node --check`，再运行 `npm run build`。
- Store / 后台任务：运行相关 `node --test` 定向测试；涉及 SQLite 或 native 模块时增加 `npm run smoke:electron-native`。

重点测试：

- 旧配置和普通 Mermaid 模式不出现审核区，生成行为保持不变。
- 开启 AI 重绘审核模式后，Mermaid 项生成 `review_status: pending`，正文不提前插入 AI 重绘图片。
- 用户修改 Mermaid 代码后，预览校验成功才能确认。
- 跳过项不会进入 AI 重绘，也不会插入正文图片。
- 已确认项使用确认后的代码生成 AI 图片，并通过现有插图块插入对应章节。
- 应用重启后待确认、已确认、跳过和失败状态可恢复。
- 保存正文、修改目录、保存正文生成配置时，仍按现有规则清空或保留图片计划。

## 风险与取舍

审核区会增加用户操作步骤，因此只在用户主动开启“Mermaid 改用 AI 图片重绘”时出现；普通 Mermaid 生图仍保持自动完成。AI 图片模型仍可能误绘文字或关系，本设计通过“先确认 Mermaid 结构再重绘”降低事实错误风险，但不能保证最终图片文字百分百准确。对严格要求文字准确的流程图，用户仍可关闭 AI 重绘，使用普通 Mermaid 代码渲染。
