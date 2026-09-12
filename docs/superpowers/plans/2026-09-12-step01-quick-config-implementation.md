# STEP 01 招标文件解析与可折叠快速配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 将技术方案 STEP 01 明确为“解析招标文件并识别多标段”的入口，同时提供默认折叠、可展开的快速配置，并让配置继续同步到 STEP 03 和 STEP 05。

**Architecture:** 保留现有 Electron IPC、SQLite Store、后台标段识别任务和正文生成失效规则。Renderer 在 STEP 01 增加版本保护的本地多标段提示、可折叠配置 UI 和完整配置合并；TechnicalPlanHome 只负责传递已有正文任务状态；STEP 02 在已选标段时收敛为只读摘要和更换入口。

**Tech Stack:** React 18、TypeScript、全局 CSS、Electron preload IPC、Node `node:test` 源码约束测试、Vite。

---

## Task 1: 为新行为建立失败测试

**Files:**
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\services\workflowLayout.test.ts`
- Create: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\services\quickConfig.ts`
- Create: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\services\quickConfig.test.ts`
- Reference: `D:\2026AI\project\OpenBidKit_Yibiao\docs\superpowers\specs\2026-09-11-step01-quick-bid-config-design.md`

- [ ] **Step 1: 写入 STEP 01 结构约束测试**

在现有“选择标书”测试附近增加断言，要求 `DocumentAnalysisPage.tsx`：

- 不再使用 `quick-config-grid`；
- 存在 `quick-config-collapsible`、`aria-expanded` 和 `localStorage`；
- 包含七个新篇幅范围；
- 不包含 `none`/“默认不控制”作为第八个篇幅档位；档位选中必须按 `minimumWords`、`maximumWords`、`sectionWords`、`strictSectionWords` 四个字段完全匹配；
- 包含 `contentTaskStatus` 锁定判断；
- 图片开关使用 `aria-pressed` 或等价状态胶囊，而不是旧的 `AppSwitch`；
- 本地检测存在 `checkBidSections()` 和请求序号/文件版本保护。

- [ ] **Step 2: 写入 STEP 02 与 Home 接线测试**

增加源码断言，要求：

- `TechnicalPlanHome.tsx` 向 STEP 01 和 STEP 02 传递正文任务状态；
- `BidAnalysisPage.tsx` 在 `selectedSectionTitle` 存在时渲染只读投标范围摘要；
- STEP 02 仍保留未选标段时的单/多标段配置流程；
- 正文任务锁定时标段入口不可用。

- [ ] **Step 3: 增加可执行的纯行为测试**

将七档预设、篇幅档位匹配、完整正文配置合并和表格/图片默认归一化放入 `quickConfig.ts` 纯函数模块；在 `quickConfig.test.ts` 增加运行时测试覆盖：

- 七档精确字段映射和旧版不匹配值返回自定义状态；
- 缺失/非法 `tableRequirement` 返回 `heavy`，显式 `none` 保留；
- 显式图片 `false` 保留，AI 默认值受图片模型可用状态限制；
- 快速配置更新不丢失 `max*Images`、`htmlImageTypes` 和审计字段。

- [ ] **Step 4: 运行定向测试，确认按预期失败**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
node --test src\features\technical-plan\services\workflowLayout.test.ts
```

Expected: FAIL，失败原因应是新增的 STEP 01/STEP 02 行为尚未实现，而不是测试语法或路径错误。

## Task 2: 接通正文任务状态和 STEP 01 基础状态

**Files:**
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\DocumentAnalysisPage.tsx`
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\TechnicalPlanHome.tsx`
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\BidAnalysisPage.tsx`

- [ ] **Step 1: 扩展页面 props**

使用已有 `BackgroundTaskStatus` 类型，为 `DocumentAnalysisPage` 和 `BidAnalysisPage` 增加可选 `contentTaskStatus` prop。Home 传入 `state.contentGenerationTask?.status`，不新增业务状态和 IPC。

- [ ] **Step 2: 实现统一锁定判断**

在两个页面使用同一语义：`running`、`pausing`、`paused` 为锁定状态。STEP 01 的篇幅、表格、图片、标段识别、确认、更换和选择入口均禁用；STEP 02 已选标段的更换入口同样禁用。任务完成、失败或不存在时恢复可用。

同时保护正式识别成功后的自动打开 effect，以及 `handleSectionSelect()` / `openSectionSelectorFromConfig()` 的入口判断，确保任务锁定期间既不会自动弹出选择框，也不会通过已打开的弹窗完成选段。

- [ ] **Step 3: 运行类型检查**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
npm run build
```

Expected: 当前新增 props 的 TypeScript 编译无错误；若后续 UI 尚未完成，允许测试断言继续失败，但 build 不应因类型错误失败。

## Task 3: 完成 STEP 01 招标文件解析和多标段检测流程

**Files:**
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\DocumentAnalysisPage.tsx`
- Reference: `D:\2026AI\project\OpenBidKit_Yibiao\client\electron\services\technicalPlanStore.cjs`
- Reference: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\shared\types\ipc.ts`

- [ ] **Step 1: 保留导入返回的即时检测**

导入成功后继续将 `result.bidSectionDetection` 存入 STEP 01 局部 state；删除非最后一份文件使用返回结果；删除最后一份或没有招标文件时清空该 state。不得把临时检测结果加入 `TechnicalPlanState` 或 SQLite。

- [ ] **Step 2: 增加挂载/返回时的本地检测补齐**

当已有招标正文且局部检测没有可靠缓存时调用 `technicalPlan.checkBidSections()`。使用递增请求序号，并绑定 `tenderFile.contentHash` 或 `updatedAt` 等当前文件版本；导入、删除、工作流切换和卸载时使旧请求失效，旧结果不得覆盖当前文件提示。

- [ ] **Step 3: 区分“疑似检测”和“正式列表”**

只有 `bidSections.length >= 2` 时才打开 `BidSectionSelectorDialog`。仅有本地疑似检测时，提示条和快速配置行显示 `识别标段`，点击后启动已有后台识别任务；正式识别成功后沿用已有流程显示 `确认投标范围` 并打开选择弹窗。已选标段时显示绿色确认条和 `更换标段`。

- [ ] **Step 4: 运行检测相关测试**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
node --test src\features\technical-plan\services\workflowLayout.test.ts
```

Expected: 与检测流程相关的新增断言通过；若配置布局断言仍失败，继续下一任务。

## Task 4: 实现默认折叠的快速配置

**Files:**
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\DocumentAnalysisPage.tsx`
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\TechnicalPlanHome.tsx`

- [ ] **Step 1: 替换篇幅预设数据**

移除 30/50/80/100 页预设和“默认不控制”按钮，按 spec 写入七档固定映射；不要用 650 字/页动态计算展示文案，直接使用每档固定的 `description`：

```text
50-100: 25000 / 50000 / 500 / false
100-200: 50000 / 100000 / 800 / false
200-350: 100000 / 175000 / 1400 / false
350-500: 175000 / 250000 / 1800 / false
500-800: 250000 / 400000 / 1800 / false
800-1200: 400000 / 600000 / 1800 / false
1200-1500: 600000 / 750000 / 1800 / false
```

未设置 `0/0/0/false` 和旧版不匹配配置显示为未设置/自定义，不自动迁移；仅四字段完全相等才高亮七档。

- [ ] **Step 2: 实现配置摘要和折叠偏好**

默认折叠，只显示一条紧凑摘要栏和 `展开设置` 按钮；展开后显示上传后的连续四行配置；收起后不留大块空白。使用 `localStorage` 记录展开状态，键名固定且只用于 UI 偏好，业务配置仍由现有 IPC 保存。

- [ ] **Step 3: 实现表格和图片状态胶囊**

表格显示 `无表格 / 少量 / 适中 / 丰富`，值映射为 `none / light / moderate / heavy`；缺失或非法值统一回退 `heavy`，显式 `none` 保留。图片使用三个按钮状态胶囊，映射 `useAiImages`、`useMermaidImages`、`useHtmlImages`，保留显式 `false`，并让 AI 状态遵循 `image_model.status === 'available'` 的限制。

- [ ] **Step 4: 保留完整正文配置**

基于完整的 `resolvedContentOptions` 提交表格和图片变更，不能覆盖 `max*Images`、`useAiRedesignForMermaid`、`htmlImageTypes`、一致性审计和原方案覆盖审计字段。缺失配置的 AI 默认值读取 `config.image_model.status === 'available'`，Mermaid/HTML 默认开启。

- [ ] **Step 5: 运行定向测试**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
node --test src\features\technical-plan\services\workflowLayout.test.ts
```

Expected: 新增 STEP 01 结构、七档、折叠、状态胶囊和锁定相关断言通过；纯行为测试也必须 PASS。

## Task 5: 收敛 STEP 02 的已选标段入口

**Files:**
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\BidAnalysisPage.tsx`
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\features\technical-plan\pages\TechnicalPlanHome.tsx`

- [ ] **Step 1: 调整投标范围配置区**

当 `selectedSectionTitle` 存在时隐藏“单标段/多标段”预设，显示当前标段只读摘要和 `更换标段`。未选标段时保留当前模式配置和正式识别流程。

- [ ] **Step 2: 处理任务锁定**

正文任务状态为 `running`、`pausing`、`paused` 时禁用 STEP 02 标段识别、选择、更换入口；不新增取消/等待协议，不改其他解析项。

- [ ] **Step 3: 运行定向测试**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
node --test src\features\technical-plan\services\workflowLayout.test.ts
```

Expected: STEP 02 相关新增断言通过；自动打开弹窗和选择回调的锁定保护断言通过。

## Task 6: 按确认稿重做 STEP 01 样式

**Files:**
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\styles\feature-technical-plan.css`
- Modify: `D:\2026AI\project\OpenBidKit_Yibiao\client\src\styles\shared-upload.css` only if the shared upload row cannot express the layout without affecting other pages

- [ ] **Step 1: 重写 STEP 01 专用选择器**

将上传区调整为单行横向文件胶囊和固定右侧“继续上传”；将标段状态条调整为警示态/绿色确认态；将快速配置改为无子卡片的连续行布局。

- [ ] **Step 2: 增加折叠摘要样式**

为摘要栏、展开/收起按钮、配置行标签列、页数胶囊、表格分段控件、图片状态胶囊增加直角工作台风格和稳定尺寸。删除或覆盖旧 `.quick-config-grid`、`.quick-config-card*` 专用布局，避免卡片网格回归。

- [ ] **Step 3: 完成响应式规则**

窄窗口下文件名省略、配置内容换行、标签列收缩，正文阅读器仍在页面内部滚动，底部 `FloatingToolbar` 不被遮挡。

- [ ] **Step 4: 运行布局测试**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
node --test src\features\technical-plan\services\workflowLayout.test.ts
```

Expected: 所有相关布局断言通过。

## Task 7: 构建、Electron 检查和自测

**Files:**
- Verify: all files modified above, including `client/src/features/technical-plan/services/quickConfig.ts` and `quickConfig.test.ts`.

- [ ] **Step 1: 运行完整 Renderer 构建**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
npm run build
```

Expected: `tsc --noEmit` 和 `vite build` 退出码为 0；既有 chunk 体积警告不视为失败。

如本次修改了 `client/electron/**/*.cjs` 或 preload/IPC 文件，额外运行：

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
node --check electron\preload.cjs
node --check electron\services\technicalPlanStore.cjs
```

- [ ] **Step 2: 运行定向布局测试**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
node --test src\features\technical-plan\services\workflowLayout.test.ts
node --test src\features\technical-plan\services\quickConfig.test.ts
```

Expected: PASS。

- [ ] **Step 3: 启动开发服务器**

Run:

```powershell
cd D:\2026AI\project\OpenBidKit_Yibiao\client
npm run dev
```

Expected: Vite 在 `127.0.0.1:5173` 启动。仓库脚本固定 `--strictPort` 且 Electron 开发入口固定使用该端口；若端口被占用，先停止占用进程或使用仓库已有的 Electron/Vite 启动参数同步修改端口，不直接启动一个 Electron 无法连接的替代端口。

- [ ] **Step 4: 通过浏览器/桌面窗口做界面自测**

验证：

- STEP 01 首屏先看到上传和正文区域，配置默认折叠；
- 导入文件后出现本地多标段提示，只有点击 `识别标段` 才启动正式识别；
- 正式识别完成后可选择标段，选择后显示绿色状态条；
- 展开配置可选择七档篇幅、四档表格密度和三个图片胶囊，收起后页面恢复紧凑；
- 返回 STEP 03/05 后配置保持一致；
- STEP 02 已选标段只读，正文任务运行/暂停时所有危险入口禁用；
- 多文件横向文件胶囊、扩写入口和 Markdown 全屏预览不回归。

- [ ] **Step 5: 记录残余风险**

若无法在真实 Electron 工作区导入文件或启动后台任务，明确说明未完成的手动场景；不得用“构建通过”替代功能自测结论。
