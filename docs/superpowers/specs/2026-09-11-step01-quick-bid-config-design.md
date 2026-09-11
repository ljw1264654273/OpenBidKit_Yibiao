# STEP 01 快速标书配置前置设计

## 背景

- 竞品将"多标段、投标公司、标书篇幅、写作风格、风格预设、表格/图片/模板设置、防重检测"集中在一个"标书设置"页。对照当前代码，其中约半数能力不存在，其余分散在各步骤：
  - 已有：投标范围（STEP 02 `bidSectionMode` + `startBidSectionExtraction`）、字数/页数控制（STEP 03 `OutlineWordControlOptions`）、表格密度与图片开关（STEP 05 `ContentGenerationOptions`，`tableRequirement` 默认 `heavy`，配图为 AI/Mermaid/HTML 三类开关加数量）。
  - 不存在：投标公司库（当前仅有甲方信息解析，我方投标公司无结构化字段）、写作风格、风格预设、防重检测（独立"标书查重"功能不在此列）、DeepSeek 智能切言。
- 真实痛点：
  1. 标段判定滞后。`selectBidSection()` 会从 `tender-original.md` 重建 `tender.md` 并调用 `clearDownstreamFromBidSectionChange()` 清空下游；判定越晚，返工越贵。规则检测 `detectBidSections()`（`electron/utils/bidSectionDetector.cjs`）是纯本地正则、零 Token，上传完成即可给出结论。
  2. 篇幅、表格、图片等生成约束要到 STEP 03 / STEP 05 才暴露，用户在 STEP 01-02 期间对成本与产出形态无感知。
- 已确认决策：截图为竞品参考，不照抄整页；接受"STEP 01 早选、后续步骤仍可改"的语义，即前置不改变生效时机。

## 目标

1. STEP 01 上传招标文件后立即执行本地规则标段检测，以提示条引导确认投标范围。
2. STEP 01 增加"快速配置"区，承载 4 项已有配置：投标范围、标书篇幅、表格密度、图片开关。
3. 早选不早生效：所有配置写入现有字段，STEP 03 的 `outlineWordControlSnapshot` 固化时机与 STEP 05 的生成配置语义不变。
4. STEP 02 已选定标段时，投标范围配置降级为只读展示 + 更换入口。
5. `technical-plan` 与 `existing-plan-expansion` 两个入口同步生效并验证。

## 非目标

- 不合并 STEP 01 / STEP 02，步骤数保持 6 步。
- 不实现竞品特有的写作风格、风格预设、投标公司库、防重检测、DeepSeek 智能切言（列入 backlog，另行立项）。
- 不改 `outlineWordControlOptions -> outlineWordControlSnapshot` 固化机制与 `saveOutline()` 持久化协议。
- 不动 `taskService` 的任务定义、组内互斥与中断恢复逻辑。
- 不新增 Analytics 事件结构，不修改 Dashboard 聚合逻辑。

## 方案

### 1. 标段检测前置（Main 侧）

- `technicalPlanStore.importTenderDocument()` 与 `removeTenderDocument()` 成功返回前，对合并后的 Markdown 执行 `detectBidSections()`，返回值新增 `bidSectionDetection: { hasMultiple: boolean; totalDeclared: number | null }`。
- 检测结果仅在返回值中携带，不落库、不创建任务；随 `tender-original.md` 变化自然失效。
- Renderer 在 `onFileImported` 后依据该结果渲染提示条。
- `checkBidSections()` IPC 与 STEP 02 `startAnalysis()` 内的规则校验保留，作为兜底。

### 2. STEP 01 快速配置区（Renderer）

- 位置：`UploadBoard` 之下、Markdown 预览之上，条式布局（复用 `analysis-section-hint` 风格），不破坏 STEP 01 单主区结构。
- 每个条目为"名称 + 当前值摘要 + 操作入口"：
  - **投标范围**：摘要显示 `单标段` / `多标段 · {selectedSectionTitle}`。检测 `hasMultiple=true` 且未选标段时高亮；点击引导打开多标段识别，复用 `startBidSectionExtraction` 与 `BidSectionSelectorDialog`；AI 识别仍需显式确认触发，不自动执行。
  - **标书篇幅**：映射 `OutlineWordControlOptions`，摘要显示当前字数范围与预估页数。提供页数阶梯快捷档（约 50-100 / 100-200 / 200-350 / 350-500 / 500-800 / 800-1200 / 1200-1500 页），选择后按共享换算常量回填 `minimumWords` / `maximumWords`；STEP 03 保留精确输入。
  - **表格密度**：映射 `ContentGenerationOptions.tableRequirement`，四档对应"无表格 / 少量 / 适中 / 丰富"。
  - **图片设置**：映射 `ContentGenerationOptions` 的 `useAiImages` / `useMermaidImages` / `useHtmlImages` 开关摘要。
- 写入路径复用现有 IPC：篇幅走 `technicalPlan.saveOutlineConfig`（wordControl 字段），表格与图片走 `technicalPlan.saveContentGenerationOptions`；不新建通道、不新建平行存储。
- STEP 03 / STEP 05 继续展示并允许修改同一份数据，两处编辑互相同步。

### 3. STEP 02 投标范围配置调整

- 已有 `selectedSectionTitle` 时，解析配置弹窗的"投标范围"区显示只读标段 chip + "更换"按钮，移除单/多标段切换的重复入口。
- 未选标段时维持现状：多标段识别 + 标段选择流程不变，`sectionModeWarning` 二次确认弹窗保留。

### 4. 状态与恢复

- 快速配置区读取 Store 快照 + 订阅 `tasks.onTaskEvent()`；页面卸载不取消任务，重新挂载从 Store 与活动任务回放。
- 多标段识别任务运行中，投标范围条目显示识别状态并禁止重复触发。
- 应用重启后依据 `bidSectionMode` / `selectedSectionTitle` / 字数与生成配置快照恢复展示；标段检测为毫秒级本地计算，重新挂载时直接重跑，不做缓存。

### 5. 埋点

- 页面埋点沿用 `${workflowKind}/document-analysis`，Dashboard 无需变更。
- 快速配置条目操作复用 `trackConfigUsage`，新增字段如 `step01_quick_config: 'bid-section' | 'word-control' | 'table-density' | 'illustration'`，同步登记 `shared/analytics/analytics.ts` 的字段映射表。

## 风险与边界

- 页数阶梯与字数换算必须与 STEP 03 预估页数共用同一常量，避免两处口径不一致。
- STEP 01 修改图片开关或表格密度时，必须沿用 STEP 05 现有保存与失效链路（配图配置变更会清空全文图片计划），不得绕过。
- 正文生成任务运行期间修改生成配置的互斥规则与 STEP 05 现状保持一致，不在 STEP 01 放宽。

## 验证

1. Main：对改动的 `.cjs` 执行 `node --check`；`detectBidSections` 现有行为回归。
2. Renderer：`cd client && npm run build`。
3. `npm run dev` 手动链路：
   - 单标段文件：无提示条，快速配置可修改，STEP 03 / STEP 05 显示一致。
   - 多标段文件：提示条出现 -> 显式触发识别 -> 选择标段 -> `tender.md` 重建与下游清空提示 -> STEP 02 显示只读 chip。
   - STEP 03 修改字数后返回 STEP 01，摘要同步。
   - `existing-plan-expansion` 入口全流程复验（含原方案上传行共存布局）。
   - 识别任务运行中重启应用，恢复展示正常。
4. Windows 中文路径目录导入招标文件。
5. 涉及 Store 改动时运行 `npm run smoke:electron-native`。
