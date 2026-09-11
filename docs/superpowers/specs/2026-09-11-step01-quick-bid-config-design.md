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
- 右侧动作按正式识别结果分为三种：已有选定标段时为 `更换标段`；已有至少两个正式识别结果但尚未选择时为 `确认投标范围`；只有本地疑似检测、尚无正式列表时为 `识别标段`。
- `确认投标范围` / `更换标段` 复用现有 `BidSectionSelectorDialog`；`识别标段` 仅在用户明确点击时启动现有后台标段识别任务，不在页面挂载或本地检测完成时自动触发需要 Token 的任务。
- 当正文生成任务状态为 `running`、`pausing` 或 `paused` 时，以上三个标段动作和选择弹窗入口均禁用。原因是 `selectBidSection()` 会清空下游解析/正文状态，不能与活动中的正文任务并行；本次不新增 Main 侧取消/等待协议。任务进入完成、失败或不存在状态后，标段操作恢复可用。
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
- 多标段待选择且正式列表已生成时显示“选择标段”，并与提示条使用同一选择流程；只有疑似多标段而正式列表尚未生成时显示“识别标段”，启动识别任务后再选择。正文任务为 `running`、`pausing` 或 `paused` 时，行内入口与提示条入口都禁用。
- 已选标段后，STEP 02 中保持只读标段摘要 + 更换入口，避免重复出现单/多标段切换。
- 在 STEP 02 的解析配置弹窗中，只要存在 `selectedSectionTitle`，投标范围区域隐藏“单标段/多标段”可编辑预设，改为展示 `多标段 · {selectedSectionTitle}` 的只读摘要和 `更换标段` 入口；更换仍复用现有正式识别列表和选择弹窗。未选标段时，STEP 02 保留现有单/多标段配置与识别流程。

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
- 七档是面向用户的业务预设，必须固定使用确认原型中的全文字数范围；实现时不得根据窗口宽度、文件字数或当前目录动态改变这些边界：

  | 档位 | `minimumWords` | `maximumWords` | `sectionWords` | 展示换算 |
  | --- | ---: | ---: | ---: | --- |
  | 约 50-100 页 | 25,000 | 50,000 | 500 | 2.5 - 5 万字 |
  | 约 100-200 页 | 50,000 | 100,000 | 800 | 5 - 10 万字 |
  | 约 200-350 页 | 100,000 | 175,000 | 1,400 | 10 - 17.5 万字 |
  | 约 350-500 页 | 175,000 | 250,000 | 1,800 | 17.5 - 25 万字 |
  | 约 500-800 页 | 250,000 | 400,000 | 1,800 | 25 - 40 万字 |
  | 约 800-1200 页 | 400,000 | 600,000 | 1,800 | 40 - 60 万字 |
  | 约 1200-1500 页 | 600,000 | 750,000 | 1,800 | 60 - 75 万字 |

- 每档写入的 `strictSectionWords` 固定为 `false`。`sectionWords` 只作为目录颗粒度和正文指导值，不在 STEP 01 暗中开启“小节强控”。
- 上表的展示换算是确认原型的业务预设文案，不代表印刷页数的精确计算。STEP 03 当前“预估页数”继续使用已有的 650 字/页提示性算法，并继续展示“页数和排版有关，无法精确预估”；本次不修改该算法，也不要求七档标签与该提示值数值相等。
- 新建工作区继续使用现有默认值 `minimumWords = 0`、`maximumWords = 0`、`sectionWords = 0`、`strictSectionWords = false`，因此首次进入时七档均不选中，页面显示未设置/不控制状态。确认稿中选中的 `约 200-350 页` 仅是设计稿演示状态，不是生产默认值。
- 已有配置按字段原值优先保留。只有四个字段与上表某一档完全一致时才高亮对应档位；现有旧版 `30/50/80/100 页` 配置若不匹配新表，显示为自定义状态，不自动迁移、不覆盖。用户主动点击七档后，才一次性写入该档四个字段。

#### 表格密度

- 标签：`表格密度`，辅助文案：`正文表格要求`。
- 使用一个连续分段控件：`无表格 / 少量 / 适中 / 丰富`。
- 选中段为蓝色背景和白色文字。
- 右侧显示 `对应 STEP 05 生成配置`。
- 展示值与持久化值严格对应：`无表格 -> none`、`少量 -> light`、`适中 -> moderate`、`丰富 -> heavy`。STEP 05 现有的 `heavy -> 大量` 文案可以继续保留，不回写成 `丰富`。
- 当 `contentGenerationOptions` 缺失、为空对象或缺少 `tableRequirement` 时，使用当前生产默认值 `heavy` 并显示 `丰富`；已有显式值（包括显式 `none`）必须优先保留。非法旧值按当前生产默认值 `heavy` 处理。
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
- 生产默认值沿用 `ContentEditPage` 的实际归一化规则：`useMermaidImages = true`、`useHtmlImages = true`；`useAiImages` 在配置缺失时等于当前图片模型是否可用（只有 `image_model.status === 'available'` 才为 `true`）。当 `contentGenerationOptions` 缺失、为空对象或某个字段缺失时，按字段分别使用这些默认值；已有显式 `false` 必须保留，不能使用 `||` 覆盖。
- STEP 01 需要读取现有配置中的图片模型可用状态来展示缺失配置的 AI 默认值；读取失败或状态不是 `available` 时按 AI 关闭处理，并沿用现有提示方式。已有持久化值优先于默认值。
- 确认稿中“AI 开启、Mermaid 开启、HTML 关闭”只是原型演示状态，不是固定生产默认值，也不因 STEP 01 重排而修改现有默认策略。若图片模型不可用，AI 配图继续遵循 STEP 05 的可用性和禁用规则。

### 4.5 招标文件正文

- 保留现有 `MarkdownFullscreenViewer` 和 `MarkdownRenderer`。
- 正文面板标题为 `招标文件内容`，右侧显示当前文件名和字数。
- 多份招标文件、扩写模式原方案的切换能力保持现状。
- AI 或远程内容若进入该区域，不改变现有 `MarkdownRenderer` 的可信内容策略；本地招标原文继续按当前行为展示。

## 5. 数据流与行为

### 5.1 文件导入与多标段检测

- `technicalPlanStore.importTenderDocument()` 和 `removeTenderDocument()` 对合并后的 Markdown 继续调用现有 `detectBidSections()`。
- `bidSectionDetection` 仅作为导入结果的临时返回值，由 `DocumentAnalysisPage` 本地状态展示，不进入 `TechnicalPlanState`，不落库。
- 导入成功后直接使用返回的 `bidSectionDetection`；删除非最后一份文件后同样使用返回值；删除最后一份文件后清空本地检测状态。若当前 Store 分支尚未为“删除最后一份”返回检测结果，不为此新增持久化字段，Renderer 直接按无文件状态清空。
- `DocumentAnalysisPage` 首次挂载、从其他步骤返回或工作流重新挂载时，如果已有招标正文且没有可靠的本地检测缓存，调用 `checkBidSections()` 重新补齐提示。该调用仅使用本地 `detectBidSections()`，不消耗 Token；调用失败只记录现有错误提示策略，不改变招标文件和下游状态。
- 本地检测只是“疑似多标段”提示，不能直接填充 `BidSectionSelectorDialog`。只有 `bidSections.length >= 2` 的正式识别结果存在时，才允许打开选择弹窗或执行“确认投标范围”。只有本地检测结果而没有正式列表时，提示条动作显示为 `识别标段` 并启动现有后台标段识别任务；任务成功后沿用现有自动打开选择弹窗的流程。快速配置行在相同状态下也显示 `识别标段`，不得打开空弹窗。
- 检测请求必须绑定当前招标文件版本。实现可使用递增请求序号，并结合当前招标文件/来源文件的内容哈希或更新时间作为版本标识；导入、删除、切换工作流和组件卸载时使旧请求失效。异步 `checkBidSections()` 返回后，若请求序号或文件版本已变化，丢弃结果，不得覆盖当前文件的提示状态。
- 已选标段时，绿色“已选择”提示以 `tenderFile.selectedSectionTitle` 为准，不要求本地检测缓存仍然存在；未选且检测到多标段时才显示警示条。正式识别列表未生成时，警示条按钮文案为 `识别标段`；列表已生成但尚未选择时为 `确认投标范围`，点击后打开现有选择弹窗。
- `bidSectionDetection` 随页面组件生命周期重新计算，不尝试跨重启恢复，也不写入 `TechnicalPlanState`。正式的标段识别结果仍由 STEP 02 的后台任务存储并负责流程校验。
- 选择标段继续调用 `selectBidSection()`，由 Main 从 `tender-original.md` 重建 `tender.md` 并按既有规则清空下游，不在 Renderer 复制清理逻辑。

### 5.2 配置保存

- 篇幅档位复用 `technicalPlan.saveOutlineConfig()`，只更新现有 word control 字段，其余目录配置从当前状态带入。
- 表格密度和图片开关复用 `technicalPlan.saveContentGenerationOptions()`；提交时必须基于当前完整的 `ContentGenerationOptions` 组装 payload，只替换用户正在修改的字段，保留 `maxAiImages`、`maxMermaidImages`、`maxHtmlImages`、`useAiRedesignForMermaid`、`htmlImageTypes`、一致性审计和原方案覆盖审计等 STEP 01 未展示字段及其现有值。
- 保存成功后由现有状态回写机制更新页面摘要，保存失败走 `useToast()` 错误提示。
- 页面卸载不取消任何后台任务。
- 正文生成期间的配置互斥和禁用规则沿用 STEP 05 现状：`contentGenerationTask.status` 为 `running`、`pausing` 或 `paused` 时，STEP 01 的篇幅、表格密度和图片设置均不可修改；同一状态下投标范围的识别、确认、更换和选择弹窗入口也均不可用，避免 `selectBidSection()` 清空下游状态时与活动正文任务竞态。没有任务、任务已完成或任务失败时可修改。为此由 `TechnicalPlanHome` 将现有 `contentGenerationTask.status` 同时传给 STEP 01 和 STEP 02，Renderer 只负责禁用交互和提示，不复制任务控制逻辑。

### 5.3 后续步骤同步

- STEP 03 读取同一份 `outlineWordControlOptions`，并在生成目录时固化 `outlineWordControlSnapshot`。
- STEP 01 点击篇幅档位只修改“当前有效配置”，不会同步修改已有 `outlineWordControlSnapshot`，也不会自动重建目录。若目录已经生成，返回 STEP 01 修改篇幅后，STEP 03 继续按现有规则显示“需要重新生成目录才能生效”；只有重新生成目录时，新配置才固化进新的 snapshot。
- 若尚未生成目录，STEP 01 保存的新配置在下一次 STEP 03 生成目录时直接生效。
- STEP 05 读取同一份 `contentGenerationOptions`。
- 任何配置变更触发的配图计划清理继续由 Main Store 负责，Renderer 不另写失效逻辑。

## 6. 组件与文件边界

优先修改以下文件，避免扩大共享组件影响面：

- `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
  - 重排 STEP 01 DOM。
  - 将快速配置从卡片网格改成连续四行。
  - 保留现有上传、标段选择、保存回调和正文阅读逻辑。
  - 增加本地检测请求的文件版本/请求序号保护、图片模型可用性读取和正文任务状态下的配置/标段操作禁用。
- `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
  - 向 STEP 01 传递现有 `contentGenerationTask.status`；保存回调继续集中在 Home，不重复实现业务逻辑。
- `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - 已选标段时将 STEP 02 投标范围控件改为只读摘要 + `更换标段` 入口，隐藏“单标段/多标段”可编辑预设。
  - 接收现有 `contentGenerationTask.status`，在正文任务运行/暂停相关状态下禁用标段识别、选择和更换入口；不改变 STEP 02 其他解析项配置。
- `client/src/styles/feature-technical-plan.css`
  - 删除或覆盖当前 `.quick-config-grid`、`.quick-config-card*` 的 STEP 01 专用布局。
  - 增加上传单行、状态条、连续配置行和响应式样式。
- `client/src/styles/shared-upload.css`
  - 仅在现有共享上传组件无法表达原型单行布局时做兼容性最小调整，避免影响查重和废标页面。
- `client/src/features/technical-plan/services/workflowLayout.test.ts`
  - 增加页面结构约束测试，防止快速配置回退为卡片网格，并覆盖七档映射、默认/显式 `false` 处理、完整正文配置保留和任务状态禁用约束。
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
2. 切换到多标段待选择状态，确认仅有本地疑似检测时按钮先显示 `识别标段`，正式识别完成后才显示 `确认投标范围` 并打开现有标段选择弹窗。
3. 选择七档篇幅、四档表格密度和三个图片胶囊，确认保存后立即回显。
4. 进入 STEP 03 和 STEP 05，再返回 STEP 01，确认配置值保持一致。
5. 选定标段后确认 STEP 02 只显示当前标段和更换入口。
6. 导入多份招标文件，确认文件胶囊横向排列，继续上传和移除操作正常。
7. 进入 `existing-plan-expansion`，确认原方案上传和正文切换不被破坏。
8. 检查窄窗口：配置行可以换行，文件名不撑破布局，底部操作条不遮挡正文。
9. 使用 Windows 中文路径导入文件，确认现有解析链路不受影响。
10. 在图片模型可用和不可用两种状态下分别打开 STEP 01，确认缺失配置的 AI 默认值与 STEP 05 一致；同时确认已有显式关闭值不会被默认值覆盖。
11. 在正文任务 `running`、`pausing`、`paused` 状态返回 STEP 01，确认三类快速配置以及标段识别/确认/更换入口均禁用；任务完成或失败后恢复可编辑。
12. 在本地检测或 `checkBidSections()` 返回期间替换/删除招标文件，确认旧请求结果不会覆盖新文件的标段提示。
