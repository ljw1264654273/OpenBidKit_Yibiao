# STEP 01 选择标书与快速配置设计

## 1. 背景与问题

当前版本在 `DocumentAnalysisPage` 中新增了快速配置，但采用了四张自适应卡片、纵向图片开关和独立的卡片说明，导致页面与确认原型的主要差异：

- 原型要求“上传区 → 标段状态 → 连续配置面板 → 招标文件内容”的纵向工作流。
- 当前实现把快速配置拆成卡片网格，破坏了四项配置的横向对齐和信息扫描顺序。
- 上传行沿用了通用的“序号 + 内容 + 右侧动作”结构，原型需要单行文件胶囊和右侧固定的“继续上传”。
- 当前页数档位是 30/50/80/100 页，与原型的七档范围不一致。
- 当前图片配置使用纵向 `AppSwitch`，原型使用横向状态胶囊，且原型默认展示为 AI 配图、Mermaid 图开启，HTML 图关闭。

本次设计稿以仓库中的正式原型为视觉基准：

- 原型文件：`docs/design-preview/step01-quick-config-mockup.html`
- 确认稿：`.superpowers/brainstorm/20260912-step01-design/step01-redesign-v1.html`

## 2. 目标

1. 将新建技术方案入口的 STEP 01 重构为与确认稿一致的连续面板布局。
2. 保留现有上传、文件解析、标段识别、配置保存和 Markdown 正文预览能力。
3. 使投标范围、篇幅、表格密度和图片设置在 STEP 01 早选，并与后续步骤使用同一份正式状态。
4. 同时适配 `technical-plan` 和 `existing-plan-expansion` 两个工作流入口。
5. 保持页面内部滚动、底部 `FloatingToolbar` 和现有 Electron IPC 边界不变。

## 3. 非目标

- 不合并 STEP 01 与 STEP 02，仍保持六步工作流。
- 不新增投标公司库、写作风格、风格预设、防重检测或 DeepSeek 智能切言。
- 不修改 `outlineWordControlOptions` 到 `outlineWordControlSnapshot` 的固化时机。
- 不修改 `saveOutline()` 的 `reason` 协议、正文失效规则或任务恢复策略。
- 不新增普通埋点协议，不删除或绕过现有 Analytics。
- 不把本地检测结果作为新的持久化字段。

## 4. 页面结构

### 4.1 页面整体

STEP 01 页面保持当前工作台的步骤条和底部悬浮操作条。主体从上到下排列：

1. 招标文件上传面板。
2. 标段状态提示条，仅在检测到多标段或已有选定标段时出现。
3. 快速配置连续面板。
4. 招标文件 Markdown 正文预览。

页面根容器必须保持 `height: 100%`、`min-height: 0`，正文阅读器在页面内部滚动，不依赖 `body` 滚动。配置面板不采用卡片嵌套卡片，也不使用四列自适应网格。

### 4.2 上传面板

上传面板使用单个完整面板：

- 标题行左侧：`STEP 01` + `选择标书`。
- 标题行右侧：`支持多份招标文件合并解析`。
- 文件区为一条横向虚线边框行。
- 行内左侧固定显示 `招标文件`。
- 已导入文件使用横向文件胶囊显示：格式徽标、文件名、解析方式、字数和移除按钮。
- 右侧固定显示 `继续上传`；没有文件时仍保留相同位置的上传动作。
- 不在该面板标题下增加“先选好这些常用参数”等引导性段落。

`existing-plan-expansion` 继续显示“原方案”上传能力。其具体文件交互不变，但布局应与统一面板风格一致；招标文件与原方案正文继续通过现有正文切换逻辑查看。

### 4.3 标段状态提示

标段提示条为全宽状态条：

- 已选状态使用绿色背景、绿色边框和确认语义：
  `已选择 一标段。后续步骤将仅使用该投标范围，如需更换请在此调整。`
- 检测到多个标段但尚未选择时使用警示背景：
  `检测到疑似 N 个标段。切换投标范围会重建工作副本并清空下游解析结果，建议先确认本次投标范围。`
- 右侧动作分别为 `更换标段` / `确认投标范围`。
- 按钮复用现有标段识别和 `BidSectionSelectorDialog`，不自动触发需要 Token 的识别任务。
- 单标段且未触发多标段识别时不显示提示条。

### 4.4 快速配置面板

快速配置使用一个连续面板，不拆分为子卡片。面板标题行：

- 左侧：紫色 `快速配置` + `本次标书的生成约束`。
- 右侧：`早选不早生效：STEP 03 目录生成、STEP 05 正文生成时仍可调整`。

下面四项均为整行设置，左侧标签列宽度固定，右侧内容区自适应：

#### 投标范围

- 标签：`投标范围`，辅助文案：`决定下游全部输入`。
- 当前值显示 `单标段` 或 `多标段 · {selectedSectionTitle}`。
- 已选标段显示“更换标段”。
- 多标段待选择显示“选择标段”，并与提示条使用同一选择流程。
- 已选标段后，STEP 02 中保持只读标段摘要 + 更换入口，避免重复出现单/多标段切换。

#### 标书篇幅

- 标签：`标书篇幅`，辅助文案：`字数控制预设`。
- 提供以下七个胶囊档位：
  - `约50-100页`
  - `约100-200页`
  - `约200-350页`
  - `约350-500页`
  - `约500-800页`
  - `约800-1200页`
  - `约1200-1500页`
- 选中态使用浅蓝底、蓝色边框和蓝色文字，不使用四张卡片中的实心大按钮。
- 下方显示全文字数换算和说明：`STEP 03 可精确调整上下限与单节字数`。
- 持久化仍写入 `outlineWordControlOptions`，STEP 03 继续提供精确输入。
- 页数标签、字数换算和 STEP 03 预估页数必须共用一个换算口径。实施时优先抽取 STEP 03 已有常量，避免两处算法独立演进。

#### 表格密度

- 标签：`表格密度`，辅助文案：`正文表格要求`。
- 使用一个连续分段控件：`无表格 / 少量 / 适中 / 丰富`。
- 选中段为蓝色背景和白色文字。
- 右侧显示 `对应 STEP 05 生成配置`。
- 持久化仍写入 `contentGenerationOptions.tableRequirement`。

#### 图片设置

- 标签：`图片设置`，辅助文案：`配图类型开关`。
- 使用三个横向状态胶囊：
  - `AI 配图`
  - `Mermaid 图`
  - `HTML 图`
- 开启态为浅绿色背景、绿色边框、绿色圆点；关闭态为白色背景、灰色圆点。
- 右侧显示 `修改后沿用现有失效规则（清空全文图片计划）`。
- 显示和保存分别映射到 `useAiImages`、`useMermaidImages`、`useHtmlImages`。
- 当已有配置为空时，首次展示默认采用原型状态：AI 配图开启、Mermaid 图开启、HTML 图关闭；已有持久化值必须优先保留。

### 4.5 招标文件正文

- 保留现有 `MarkdownFullscreenViewer` 和 `MarkdownRenderer`。
- 正文面板标题为 `招标文件内容`，右侧显示当前文件名和字数。
- 多份招标文件、扩写模式原方案的切换能力保持现状。
- AI 或远程内容若进入该区域，不改变现有 `MarkdownRenderer` 的可信内容策略；本地招标原文继续按当前行为展示。

## 5. 数据流与行为

### 5.1 文件导入与多标段检测

- `technicalPlanStore.importTenderDocument()` 和 `removeTenderDocument()` 对合并后的 Markdown 继续调用现有 `detectBidSections()`。
- `bidSectionDetection` 仅作为导入结果的临时返回值，由 `DocumentAnalysisPage` 本地状态展示，不进入 `TechnicalPlanState`，不落库。
- `checkBidSections()` 和 STEP 02 的任务校验继续保留，作为正式流程兜底。
- 选择标段继续调用 `selectBidSection()`，由 Main 从 `tender-original.md` 重建 `tender.md` 并按既有规则清空下游，不在 Renderer 复制清理逻辑。

### 5.2 配置保存

- 篇幅档位复用 `technicalPlan.saveOutlineConfig()`，只更新现有 word control 字段，其余目录配置从当前状态带入。
- 表格密度和图片开关复用 `technicalPlan.saveContentGenerationOptions()`。
- 保存成功后由现有状态回写机制更新页面摘要，保存失败走 `useToast()` 错误提示。
- 页面卸载不取消任何后台任务。
- 正文生成期间的配置互斥和禁用规则沿用 STEP 05 现状。

### 5.3 后续步骤同步

- STEP 03 读取同一份 `outlineWordControlOptions`，并在生成目录时固化 `outlineWordControlSnapshot`。
- STEP 05 读取同一份 `contentGenerationOptions`。
- 任何配置变更触发的配图计划清理继续由 Main Store 负责，Renderer 不另写失效逻辑。

## 6. 组件与文件边界

优先修改以下文件，避免扩大共享组件影响面：

- `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
  - 重排 STEP 01 DOM。
  - 将快速配置从卡片网格改成连续四行。
  - 保留现有上传、标段选择、保存回调和正文阅读逻辑。
- `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
  - 仅在确有需要时调整传参或保存回调，不重复实现业务逻辑。
- `client/src/styles/feature-technical-plan.css`
  - 删除或覆盖当前 `.quick-config-grid`、`.quick-config-card*` 的 STEP 01 专用布局。
  - 增加上传单行、状态条、连续配置行和响应式样式。
- `client/src/styles/shared-upload.css`
  - 仅在现有共享上传组件无法表达原型单行布局时做兼容性最小调整，避免影响查重和废标页面。
- `client/src/features/technical-plan/services/workflowLayout.test.ts`
  - 增加页面结构约束测试，防止快速配置回退为卡片网格。
- `client/src/shared/types/ipc.ts`、`client/electron/services/technicalPlanStore.cjs`
  - 只有现有导入结果类型或标段检测返回尚未完整接线时才修改；不新增持久化字段。

## 7. 验证

### 自动验证

- 改动 Renderer/TypeScript 后执行：
  `cd client; npm run build`
- 如改动 Electron Main：
  `cd client; node --check electron\services\technicalPlanStore.cjs`
  然后执行 `npm run build`。
- 如改动 Store 或 native 相关逻辑，追加：
  `cd client; npm run smoke:electron-native`
- 定向执行相关布局测试：
  `cd client; node --test src\features\technical-plan\services\workflowLayout.test.ts`

### 手动验证

1. 打开新建技术方案 STEP 01，确认上传区、绿色选中提示、四行连续配置和正文预览的顺序与确认稿一致。
2. 切换到多标段待选择状态，确认提示条变为警示态，按钮可以打开现有标段选择弹窗。
3. 选择七档篇幅、四档表格密度和三个图片胶囊，确认保存后立即回显。
4. 进入 STEP 03 和 STEP 05，再返回 STEP 01，确认配置值保持一致。
5. 选定标段后确认 STEP 02 只显示当前标段和更换入口。
6. 导入多份招标文件，确认文件胶囊横向排列，继续上传和移除操作正常。
7. 进入 `existing-plan-expansion`，确认原方案上传和正文切换不被破坏。
8. 检查窄窗口：配置行可以换行，文件名不撑破布局，底部操作条不遮挡正文。
9. 使用 Windows 中文路径导入文件，确认现有解析链路不受影响。
