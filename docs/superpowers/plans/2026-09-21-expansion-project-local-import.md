# 已有方案扩写独立项目与本地导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“已有方案扩写”改造成只支持本地文件导入的独立项目创建流程，取消同一项目内的工作流切换，并保持普通技术方案项目与扩写项目完全隔离。

**Architecture:** 继续使用现有的 `bid_projects.project_id` 项目隔离和每项目技术方案表。普通技术方案与扩写项目共用 `TechnicalPlanHome`、Step 页面、任务服务和 Store 实现，但项目创建入口不同；扩写入口新增一个原子导入暂存流程，在正式项目创建前同时解析招标文件和原方案，确认成功后一次性建立 `existing-plan-expansion` 项目。打开项目时由项目类型决定工作流，Renderer 不再调用模式切换 API。

**Tech Stack:** Electron CommonJS Main/preload/IPC、React + TypeScript Renderer、SQLite/better-sqlite3、现有 `fileService` 文档解析、Radix/AppDialog、Node `node:test` 与现有 Vitest/Vite TypeScript 构建链路。

---

## 文件地图

### 新增文件

- `client/src/features/bid-project/pages/ExpansionProjectCreatePage.tsx`
  - 扩写项目创建页，负责选择本地招标文件、选择本地原方案、展示解析预览、填写项目名称并确认创建。
- `client/src/styles/feature-bid-project-expansion.css`
  - 扩写创建页的上传、预览、状态和操作区样式；由 `client/src/styles.css` 引入。
- `client/src/features/bid-project/services/expansionProjectCreate.ts`
  - Renderer 侧扩写导入 API 的轻量调用封装和创建页纯 UI 状态辅助函数。
- `client/electron/services/bidProjectImportService.expansion.test.cjs`
  - 扩写导入成功、失败清理、两类文件要求和项目类型隔离的 Main 定向测试。
- `client/src/features/bid-project/services/expansionProjectCreate.test.ts`
  - 创建页所需的文件选择状态和按钮可用条件测试。
- `client/src/app/projectNavigation.ts`
  - 项目菜单入口和活动项目路由的纯函数，隔离 App/AppRouter 的导航判断。
- `client/src/app/projectNavigation.test.ts`
  - 验证扩写菜单进入创建页、项目列表打开工作区以及同页菜单点击清理活动项目。

### 修改文件

- `client/src/App.tsx`
  - 区分“侧边栏进入扩写创建页”和“项目列表打开具体项目”的导航意图；增加原子打开项目回调，避免活动项目残留导致侧边栏点击直接打开旧项目。
- `client/src/app/AppRouter.tsx`
  - `existing-plan-expansion` 无活动项目时渲染 `ExpansionProjectCreatePage`，有活动扩写项目时渲染 `TechnicalPlanHome`。
- `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
  - 使用原子项目打开回调；保留技术方案项目的现有新建流程。
- `client/src/features/bid-project/services/bidProjectStorage.ts`
  - 暴露扩写导入的 prepare/confirm/discard 方法。
- `client/src/features/bid-project/types.ts`
  - 增加扩写导入预览、确认参数和导入结果类型。
- `client/src/shared/types/ipc.ts`
  - 同步 `window.yibiao.bidProject` 的扩写导入 bridge 类型。
- `client/electron/preload.cjs`
  - 暴露 `prepareExpansionImport`、`confirmExpansionImport`、`discardExpansionImport`。
- `client/electron/ipc/bidProjectIpc.cjs`
  - 注册扩写导入 IPC 通道，并将业务转发给 `bidProjectImportService`。
- `client/electron/ipc/index.cjs`
  - 将三个扩写导入通道加入 `workspaceDatabaseChannels`，保证数据库未就绪时使用 pending/unavailable handler。
- `client/electron/services/bidProjectImportService.cjs`
  - 增加两份本地文件的暂存、解析、hash、确认导入和失败清理流程；复用现有普通项目导入的暂存能力。
- `client/electron/services/bidProjectManager.cjs`
  - 增加按项目类型读取/校正 `workflow_kind` 的项目打开辅助；项目类型作为工作流权威来源。
- `client/electron/services/bidProjectStore.cjs`
  - 增加项目类型与已有扩写数据的归一化/兼容辅助；保留现有项目列表和删除能力。
- `client/electron/services/technicalPlanStore.cjs`
  - 将 `switchWorkflowKind` 改为兼容性保护入口，不再执行跨模式清理；增加按项目类型校正 workflow kind 的内部方法；普通 reset 只处理当前项目。
- `client/electron/services/taskService.cjs`
  - 保证扩写导入、重置和删除前的任务取消均按 `projectId` 作用域执行；必要时抽出导入流程使用的取消辅助。
- `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
  - 删除用户可见的模式切换确认流程和跨菜单切换逻辑；根据固定项目类型渲染当前项目。
- `client/src/shared/types/navigation.ts`
  - 优先复用现有 `existing-plan-expansion`，不新增项目创建一级菜单。
- `client/src/styles.css`
  - 引入扩写项目创建页样式。
- `client/src/features/technical-plan/services/workflowLayout.test.ts`
  - 删除或改写依赖工作流切换弹窗的结构断言，增加固定项目类型和共用页面断言。
- `client/electron/ipc/bidProjectIpc.test.cjs`
  - 增加扩写导入 IPC 注册和参数转发测试。
- `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`
  - 验证扩写导入 IPC 在数据库未就绪时仍注册 pending/unavailable handler。
- `sql/workspace_schema.sql`
  - 仅当运行时迁移或目标结构有变化时同步；本方案预期不新增表字段，若实现确认无需变更则保持文件不动。

### 不修改的核心实现

- `client/electron/services/outlineGenerationTaskV2.cjs`
- `client/electron/services/globalFactsTask.cjs`
- `client/electron/services/globalFactsTaskV2.cjs`
- `client/electron/services/contentGenerationTask.cjs`

这些任务继续通过项目 Store 读取固定项目内的 `workflowKind` 和原方案，不重做扩写算法。

## Task 1: 建立扩写导入数据契约与失败行为测试

**Files:**
- Modify: `client/src/features/bid-project/types.ts`
- Modify: `client/src/shared/types/ipc.ts:604-675`
- Create: `client/src/features/bid-project/services/expansionProjectCreate.ts`
- Create: `client/src/features/bid-project/services/expansionProjectCreate.test.ts`

- [ ] **Step 1: 写出扩写导入类型和最小失败测试**

增加以下类型，预览必须能明确表达每个输入组是否完整成功，不能用缺失字段或 truthy 值猜测：

```ts
export interface ExpansionImportDocumentPreview {
  success: boolean;
  message?: string;
  fileName?: string;
  parserLabel?: string | null;
  fileHash?: string;
  contentHash?: string;
  contentPreview?: string;
  markdownChars?: number;
  size?: number;
  modifiedAt?: string;
}

export interface ExpansionImportTenderPreview {
  success: boolean;
  requestedCount: number;
  documents: ExpansionImportDocumentPreview[];
  errors: string[];
}

export interface ExpansionProjectImportPreview {
  success: boolean;
  canceled: boolean;
  message?: string;
  token?: string | null;
  tender: ExpansionImportTenderPreview;
  originalPlan: ExpansionImportDocumentPreview;
}

export interface ExpansionProjectImportOptions {
  projectName?: string;
}
```

在测试中覆盖：

- 只有招标文件时 `canCreateExpansionProject` 为 false；
- 只有原方案时为 false；
- 两者都解析成功时为 true；
- 任一文件解析失败时保留错误信息且不可创建；
- 招标文件部分成功、存在 `errors` 或成功文档数少于选择文件数时不可创建；
- 解析结果必须返回两类文件的完整预览对象和可展示的 Markdown 摘要，不能依赖字段缺失推断失败；
- 用户取消选择时返回 `canceled: true`、无可确认 token，且不触发 confirm；

- [ ] **Step 2: 运行 Renderer 定向测试，确认测试先失败**

Run:

```powershell
cd client
npx vitest run src/features/bid-project/services/expansionProjectCreate.test.ts
```

Expected: FAIL，因为辅助类型/函数尚未实现。

- [ ] **Step 3: 实现最小 Renderer API 封装和纯状态辅助**

在 `expansionProjectCreate.ts` 中只放：

- `prepareExpansionImport(tenderFilePaths, originalPlanFilePaths)`；
- `confirmExpansionImport(token, options)`；
- `discardExpansionImport(token)`；
- `canCreateExpansionProject(preview)`，必须同时检查 `preview.success`、`preview.canceled === false`、`preview.token`、`preview.tender.success`、`preview.tender.requestedCount > 0`、`preview.tender.errors.length === 0`、招标成功文档数等于 `requestedCount`、每个文档 `success === true`，以及 `preview.originalPlan.success`；
- 文件路径从 `FileList` 到 `window.yibiao.file.getPathForFile()` 的轻量辅助。

不要在该文件读取 `fs` 或直接使用 Electron API。

- [ ] **Step 4: 运行定向测试确认通过**

Run:

```powershell
cd client
npx vitest run src/features/bid-project/services/expansionProjectCreate.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交契约变化**

```powershell
git add client/src/features/bid-project/types.ts client/src/shared/types/ipc.ts client/src/features/bid-project/services/expansionProjectCreate.ts client/src/features/bid-project/services/expansionProjectCreate.test.ts
git commit -m "feat: define local expansion project import contract"
```

## Task 2: Main 侧实现两文件扩写导入事务

**Files:**
- Modify: `client/electron/services/bidProjectImportService.cjs`
- Modify: `client/electron/services/bidProjectManager.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Create: `client/electron/services/bidProjectImportService.expansion.test.cjs`

- [ ] **Step 1: 为扩写导入写失败测试**

在 `bidProjectImportService.expansion.test.cjs` 中复用现有 `bidProjectImportService.test.cjs` 的临时 app、better-sqlite3、fileService 和 manager fixture，先写测试：

- `prepareExpansionImport` 要求一个或多个招标文件和恰好一个原方案；
- 两类文件解析成功后返回 token、文件名、hash、解析器信息和预览内容摘要；
- `confirmExpansionImport` 创建 `project_type = 'existing-plan-expansion'` 的项目；
- 新项目技术方案 Store 同时保存招标文件和原方案；
- 普通项目数据不被写入或覆盖；
- 原方案解析失败时不创建项目；
- confirm 导入任一步失败时删除项目目录、项目记录和暂存目录；
- `workflowAnalytics` 的项目创建操作使用 `existing-plan-expansion`。

- [ ] **Step 2: 运行测试确认它按预期失败**

Run:

```powershell
cd client
node --test electron\services\bidProjectImportService.expansion.test.cjs
```

Expected: FAIL，原因是扩写导入 API 尚不存在。

- [ ] **Step 3: 抽取可复用的本地导入暂存逻辑**

在 `bidProjectImportService.cjs` 内部抽取不改变现有普通导入行为的私有 helper：

- `stageImportedDocuments(result.documents, tokenDir)`；
- `buildDocumentMetadata(document)`；
- `readImportMetadata(token, expectedKind)`：校验 token 格式、metadata 的 `kind`、过期时间和 `status`，不能把普通导入 token 当作扩写 token 使用；
- `cleanupCreatedProject(projectId)`。

普通 `prepareImport/confirmImport` 继续使用原项目类型和现有返回结构。

- [ ] **Step 4: 实现 `prepareExpansionImport`**

规则：

- tender 或 original plan 的路径数组为空时直接返回对应失败预览，不打开 Main 侧文件选择对话框；
- 招标文件调用现有 `fileService.importDocument({ multiple: true, filePaths })`；
- 原方案调用同一 `fileService.importDocument({ multiple: false, filePaths })`，不得在正式项目创建前调用需要项目 Store 的 `technicalPlan.importOriginalPlanDocument`；
- 原方案必须恰好一份，多个文件直接返回可操作错误；
- 两类结果一起写入暂存目录的 `metadata.json`，其中包含 `kind: 'existing-plan-expansion'`、`status: 'ready'`、`createdAt` 和 `expiresAt`；
- 暂存元数据中区分 `tenderDocuments` 与 `originalPlanDocument`；
- `fileService` 返回“整体成功但部分文件失败”时，保留成功文档和 `errors`，但将 tender 预览标记为失败；部分成功不得进入 confirm；
- 任一解析异常都返回完整失败预览；只有真正取消选择才返回 `canceled: true`；
- 绝不创建正式项目；
- 用户取消选择作为非错误结果返回，且不创建可确认 token。

- [ ] **Step 5: 实现 `confirmExpansionImport` 的事务式清理**

按以下顺序执行：

1. 读取并校验扩写暂存 metadata；
2. 创建 `existing-plan-expansion` 项目；
3. 初始化项目 Store；
4. 导入招标文件；
5. 导入原方案；
6. 同步项目源文件记录；
7. 校正 `workflow_kind`；
8. 删除暂存目录；
9. 打开项目并返回。

confirm 开始前将 metadata 状态从 `ready` 原子地标记为 `consuming`，同一个 token 的并发 confirm 必须直接失败；成功、失败和 discard 都使 token 失效。暂存目录增加过期时间，服务启动时清理过期或损坏目录，`discardExpansionImport` 必须幂等。

捕获异常时按逆序清理项目和暂存目录。不能让临时目录、孤立 `bid_projects` 记录或空技术方案表残留。项目删除必须使用本次创建的 `projectId`，不能依赖当前活动项目。

- [ ] **Step 6: 实现项目类型固定和任务作用域保护**

在 `bidProjectManager.cjs` 增加 `openProject` 后的类型同步：

- `technical-plan` 项目加载 `technical-plan`；
- `existing-plan-expansion` 项目加载 `existing-plan-expansion`；
- 只在 metadata 类型不一致时更新 workflow kind，不清理目录、正文或任务。

在 `taskService.cjs` 确认导入前后的取消逻辑始终带 `projectId`，不使用当前默认工作区作为 fallback。

- [ ] **Step 7: 运行 Main 定向测试和语法检查**

Run:

```powershell
cd client
node --test electron\services\bidProjectImportService.test.cjs electron\services\bidProjectImportService.expansion.test.cjs
node --check electron\services\bidProjectImportService.cjs
node --check electron\services\bidProjectManager.cjs
node --check electron\services\taskService.cjs
```

Expected: all tests pass and all syntax checks exit with code 0。

- [ ] **Step 8: 提交 Main 导入事务**

```powershell
git add client/electron/services/bidProjectImportService.cjs client/electron/services/bidProjectManager.cjs client/electron/services/taskService.cjs client/electron/services/bidProjectImportService.expansion.test.cjs
git commit -m "feat: create isolated expansion projects from local files"
```

## Task 3: 补齐 IPC、preload 和 Renderer storage bridge

**Files:**
- Modify: `client/electron/ipc/bidProjectIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/bid-project/services/bidProjectStorage.ts`
- Modify: `client/electron/ipc/bidProjectIpc.test.cjs`
- Create: `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`

- [ ] **Step 1: 写 IPC bridge 失败测试**

在 `bidProjectIpc.test.cjs` 增加断言：

- 注册 `bid-project:prepare-expansion-import`；
- 注册 `bid-project:confirm-expansion-import`；
- 注册 `bid-project:discard-expansion-import`；
- 参数原样转发到 `bidProjectImportService`；
- confirm 返回新项目。

在 `index.workspaceDatabaseChannels.test.cjs` 增加源代码级断言：三个扩写导入通道都在 `workspaceDatabaseChannels` 中，因此数据库检查、迁移或初始化失败期间不会出现“通道未注册”；不为测试额外暴露运行时数据库对象。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd client
node --test electron\ipc\bidProjectIpc.test.cjs electron\ipc\index.workspaceDatabaseChannels.test.cjs
```

Expected: FAIL，因为通道尚未注册。

- [ ] **Step 3: 增加 IPC 注册和 preload bridge**

在 `bidProjectIpc.cjs` 注册三个通道；在 `preload.cjs` 的 `bidProject` 对象暴露同名方法；在 `ipc.ts` 同步类型。三个通道必须和普通导入通道一样加入 `index.cjs` 的 `workspaceDatabaseChannels`。

参数契约：

```ts
prepareExpansionImport(payload: {
  tenderFilePaths?: string[];
  originalPlanFilePaths?: string[];
}): Promise<ExpansionProjectImportPreview>;

confirmExpansionImport(token: string, options?: ExpansionProjectImportOptions): Promise<BidProject>;

discardExpansionImport(token: string): Promise<{ success: boolean; message?: string }>;
```

- [ ] **Step 4: 更新 Renderer storage facade**

让 `bidProjectStorage` 只做 bridge 转发，不加入页面状态和业务清理逻辑。

- [ ] **Step 5: 运行 IPC 测试和 Main syntax checks**

Run:

```powershell
cd client
node --test electron\ipc\bidProjectIpc.test.cjs electron\ipc\index.workspaceDatabaseChannels.test.cjs
node --check electron\ipc\bidProjectIpc.cjs
node --check electron\ipc\index.cjs
node --check electron\preload.cjs
```

Expected: PASS and exit code 0。

- [ ] **Step 6: 提交 bridge**

```powershell
git add client/electron/ipc/bidProjectIpc.cjs client/electron/ipc/index.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts client/src/features/bid-project/services/bidProjectStorage.ts client/electron/ipc/bidProjectIpc.test.cjs client/electron/ipc/index.workspaceDatabaseChannels.test.cjs
git commit -m "feat: expose expansion project import IPC"
```

## Task 4: 实现扩写项目创建页面

**Files:**
- Create: `client/src/features/bid-project/pages/ExpansionProjectCreatePage.tsx`
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/features/bid-project/services/expansionProjectCreate.ts`
- Create: `client/src/features/bid-project/services/expansionProjectCreate.test.ts`
- Create: `client/src/styles/feature-bid-project-expansion.css`
- Modify: `client/src/styles.css`

- [ ] **Step 1: 为创建页状态写失败测试**

覆盖：

- 初始状态两个文件均为空；
- 选择招标文件后显示招标文件预览；
- 选择原方案后显示原方案预览；
- 创建按钮只有两份文件准备完成时可用；
- 创建中禁用上传、移除和返回；
- 取消创建不会创建项目；
- 创建成功回调 `onProjectCreated(project)`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd client
npx vitest run src/features/bid-project/services/expansionProjectCreate.test.ts
```

Expected: FAIL，因为创建页状态辅助尚未完整实现。

- [ ] **Step 3: 实现页面交互**

页面使用现有 `UploadBoard`、`UploadRow`、`UploadFilePill`、`MarkdownRenderer`、`AppDialog` 和 Toast：

- 招标文件允许多选；
- 原方案只允许单选；
- 拖拽文件通过 `window.yibiao.file.getPathForFile` 转为路径；
- 选择后调用 `prepareExpansionImport`，只显示解析后的摘要和文件信息；
- 页面状态显式保存当前 token；重新选择或移除文件前先幂等调用 `discardExpansionImport` 清理旧 token；
- 自动生成可编辑项目名，允许用户修改；
- 两份文件均成功解析后启用“创建扩写项目”；
- 创建成功调用 `onProjectCreated`；
- 页面卸载不取消已经发出的 Main 解析/确认请求；若解析响应在卸载后返回，页面必须立即 discard 返回 token，避免留下暂存目录；Main 侧仍通过过期清理兜底；
- confirm 只允许使用当前预览 token，按钮进入 loading 后禁止重复提交。

不要在页面中复用旧的 `TechnicalPlanHome` 模式切换状态，也不要直接调用 `technicalPlan.importOriginalPlanDocument`。

- [ ] **Step 4: 添加样式并确认页面根容器布局**

样式遵循现有全局 CSS + Radix 风格：

- 页面根节点 `height: 100%`、`min-height: 0`；
- 内容在内部滚动；
- 上传区、预览区、底部操作区不要互相嵌套成卡片；
- 用户文案使用中文；
- 文件解析中显示明确状态和可操作错误。

- [ ] **Step 5: 运行 Renderer 定向测试**

Run:

```powershell
cd client
npx vitest run src/features/bid-project/services/expansionProjectCreate.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交创建页**

```powershell
git add client/src/features/bid-project/pages/ExpansionProjectCreatePage.tsx client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx client/src/features/bid-project/services/expansionProjectCreate.ts client/src/features/bid-project/services/expansionProjectCreate.test.ts client/src/styles/feature-bid-project-expansion.css client/src/styles.css
git commit -m "feat: add local expansion project creation page"
```

## Task 5: 改造导航，区分“新建扩写”和“打开扩写项目”

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/app/AppRouter.tsx`
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/shared/types/navigation.ts` only if needed
- Create: `client/src/app/projectNavigation.ts`
- Create: `client/src/app/projectNavigation.test.ts`

- [ ] **Step 1: 写出导航行为失败测试**

测试目标：

- 侧边栏进入 `existing-plan-expansion` 且没有活动项目时显示 `ExpansionProjectCreatePage`；
- 项目列表打开扩写项目时进入 `TechnicalPlanHome`，并保留项目 ID；
- 项目列表打开普通项目时进入普通 `TechnicalPlanHome`；
- 从已有项目所在工作区点击侧边栏“已有方案扩写”时，不沿用当前项目 ID；
- 当前已经位于 `existing-plan-expansion` 时再次点击侧边栏菜单，仍会关闭当前项目并进入新建扩写页；
- 打开项目操作和普通菜单导航不会互相覆盖活动项目。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd client
npx vitest run src/app/projectNavigation.test.ts
```

Expected: FAIL 或现有结构断言无法覆盖新行为。

- [ ] **Step 3: 增加原子项目打开回调**

在 `App` 中增加一个内部 `openProject(projectId, section)` 回调，负责：

1. 调用 `window.yibiao.bidProject.open(projectId)`；
2. 设置 `activeProjectId`；
3. 设置对应 `activeSection`。

将该回调通过 `AppRouter` 传给 `BidProjectWorkspacePage`。项目列表不再分别调用 `onProjectChange` 和 `onSectionChange` 造成竞态。`projectNavigation.ts` 只放可单测的导航纯函数，测试必须直接验证函数结果，不用仅靠 JSX 字符串断言。

- [ ] **Step 4: 修改路由分支**

`AppRouter` 的 `existing-plan-expansion` 分支：

- `activeProjectId` 存在时渲染 `TechnicalPlanHome`；
- `activeProjectId` 为空时渲染 `ExpansionProjectCreatePage`；
- 创建成功后调用原子打开回调。

普通 `technical-plan` 无活动项目时保留现有入口兼容行为；新建普通项目仍从“我的标书”执行。

- [ ] **Step 5: 清理侧边栏进入扩写时的残留项目**

在 `App.requestSectionChange` 中区分菜单导航与项目打开：

- 菜单导航到 `existing-plan-expansion` 时关闭当前项目并清空 `activeProjectId`；即使 `section === activeSection` 也要执行这条逻辑，确保在已有扩写项目中再次点击菜单会回到新建页；
- 原子项目打开回调不再触发该清理分支；
- 从扩写创建页返回项目列表时保持现有关闭项目逻辑。

实现优先使用显式回调/导航意图，不用依赖 React state 更新时序。

- [ ] **Step 6: 运行导航测试和构建**

Run:

```powershell
cd client
npx vitest run src/app/projectNavigation.test.ts
npm run build
```

Expected: targeted tests pass and build exits 0。

- [ ] **Step 7: 提交导航改造**

```powershell
git add client/src/App.tsx client/src/app/AppRouter.tsx client/src/app/projectNavigation.ts client/src/app/projectNavigation.test.ts client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx client/src/shared/types/navigation.ts
git commit -m "feat: route expansion menu to isolated project creation"
```

## Task 6: 删除同一项目内的模式切换行为并校正旧项目兼容

**Files:**
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/electron/services/bidProjectManager.cjs`
- Modify: `client/electron/services/bidProjectStore.cjs`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Add or modify: `client/electron/services/technicalPlanStore.workflow.test.cjs` if no focused file exists

- [ ] **Step 1: 写回归测试，先证明旧切换会清理数据**

测试场景：

- 创建一个普通项目，写入目录、正文、参考知识库选择和任务；
- 调用旧 `switchWorkflowKind('existing-plan-expansion')`；
- 断言新实现不会删除目录、正文或知识库选择；
- 断言项目类型固定，不允许通过该 API改变项目类型；
- 打开普通项目时 workflow kind 仍为 `technical-plan`；
- 打开扩写项目时 workflow kind 为 `existing-plan-expansion`。

- [ ] **Step 2: 运行回归测试确认失败**

Run:

```powershell
cd client
node --test electron\services\technicalPlanStore.workflow.test.cjs
```

Expected: FAIL，因为当前旧 API 会调用 `clearWorkflowSpecificState`。

- [ ] **Step 3: 移除 Renderer 的切换状态和弹窗**

在 `TechnicalPlanHome.tsx` 删除：

- `WorkflowSwitchRequest`；
- `workflowSwitchRequest`、resolver、switching state；
- `executeWorkflowSwitch`、`openWorkflowSwitchDialog`、`confirmWorkflowSwitch` 等函数；
- `confirmPendingSortLeave` 中的跨工作流分支；
- 侧边菜单切换引起的模式确认 effect；
- “保留/清空”切换弹窗。

保留目录排序离开保护和项目返回逻辑。

同时删除 Renderer bridge 中的 `setWorkflowKind` 和 `switchWorkflowKind`，以及对应 IPC handler 和数据库通道；项目打开时只允许 Main 内部的 `syncWorkflowKind` 校正。这样旧 UI 或同页导航不会再有任何改变项目类型的入口。

- [ ] **Step 4: 让 Store 的类型校正不清理业务数据**

在 `technicalPlanStore.cjs`：

- 增加 `syncWorkflowKind(workflowKind)`，仅更新 metadata；
- `setWorkflowKind` 不再作为可调用的公共/IPC API；
- `switchWorkflowKind` 仅保留 Main 侧旧调用兼容入口，默认抛出“项目类型固定，请返回项目列表创建新项目”，不得调用 `clearWorkflowSpecificState` 或改变 metadata；
- `clearTechnicalPlan` 只清理当前项目；
- 打开项目由 manager 使用项目类型调用 `syncWorkflowKind`；
- 不删除旧扩写项目原方案、目录或正文。

- [ ] **Step 5: 处理旧项目类型兼容**

在 `bidProjectStore.cjs` / `bidProjectManager.cjs` 中：

- 以 `bid_projects.project_type` 为主；
- 旧项目若类型为扩写，保持扩写；
- 旧项目若 metadata 已有原方案但类型仍为普通，打开时修正项目类型为扩写；
- 任何修正都不得清除数据；
- 普通项目不因访问扩写菜单而改变类型。

- [ ] **Step 6: 更新结构测试**

修改 `workflowLayout.test.ts`：

- 保留“两种 workflow 共用页面和 Store”的断言；
- 删除或替换模式切换弹窗相关断言；
- 增加“项目类型固定”和“扩写入口是创建页”的源代码/路由断言。

- [ ] **Step 7: 运行定向测试与语法检查**

Run:

```powershell
cd client
node --test electron\services\technicalPlanStore.workflow.test.cjs
npx vitest run src/features/technical-plan/services/workflowLayout.test.ts
node --check electron\services\technicalPlanStore.cjs
node --check electron\services\bidProjectManager.cjs
node --check electron\ipc\technicalPlanIpc.cjs
npm run build
```

Expected: all tests pass and build exits 0。

- [ ] **Step 8: 提交固定项目类型改造**

```powershell
git add client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/electron/ipc/technicalPlanIpc.cjs client/electron/ipc/index.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts client/electron/services/technicalPlanStore.cjs client/electron/services/bidProjectManager.cjs client/electron/services/bidProjectStore.cjs client/src/features/technical-plan/services/workflowLayout.test.ts client/electron/services/technicalPlanStore.workflow.test.cjs
git commit -m "feat: make project workflow types immutable"
```

## Task 7: 完善项目状态、测试和真实窗口验证

**Files:**
- Modify: `client/electron/services/bidProjectStore.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx`
- Modify: `client/src/features/bid-project/components/BidProjectRow.tsx` only if labels/actions need adjustment
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: relevant tests from Tasks 2, 5, and 6

- [ ] **Step 1: 补项目状态同步测试**

验证：

- 扩写项目开始导入时、失败时和成功时项目状态正确；
- 导入失败没有留下 `generating` 或空项目；
- 删除项目前取消该项目任务，不取消其他项目任务；
- 重置扩写项目不会影响普通项目；
- 项目列表类型筛选和标签仍正确。

- [ ] **Step 2: 运行 Main 定向测试**

Run:

```powershell
cd client
node --test electron\services\bidProjectStore.test.cjs electron\services\bidProjectImportService.test.cjs electron\services\bidProjectImportService.expansion.test.cjs
```

Expected: all tests pass。

- [ ] **Step 3: 运行 native smoke**

Run:

```powershell
cd client
npm run smoke:electron-native
```

Expected: native module smoke exits 0。

- [ ] **Step 4: 运行完整 Renderer build**

Run:

```powershell
cd client
npm run build
```

Expected: exit code 0；既有 chunk 体积警告不视为失败。

- [ ] **Step 5: 启动 Electron 做手动验证**

Run:

```powershell
cd client
npm run dev
```

按顺序验证：

1. 点击“已有方案扩写”，进入新建扩写页；
2. 只上传招标文件，确认创建按钮不可用；
3. 上传原方案，确认两份文件都显示解析状态；
4. 创建扩写项目，确认项目列表出现 `已有方案扩写`；
5. 返回项目列表并重新打开扩写项目；
6. 新建或打开普通技术方案项目；
7. 在两项目之间来回打开，确认目录、正文、任务和文件不串；
8. 重置扩写项目，确认普通项目仍完整；
9. 模拟导入失败，确认没有残留空项目和暂存目录；
10. 点击侧边栏“已有方案扩写”时确认不会沿用当前普通项目。

- [ ] **Step 6: 检查工作区状态并提交最终验证**

Run:

```powershell
git status --short
git diff --check
```

确认只包含本功能相关改动，不撤销用户已有的无关变更。

## 完成标准

- 点击“已有方案扩写”直接进入新建扩写项目页面。
- 扩写创建必须同时有本地招标文件和本地原方案。
- 扩写项目创建后类型固定为 `existing-plan-expansion`。
- 普通项目和扩写项目的项目数据、任务、文件、配置、正文和导出上下文完全隔离。
- 同一项目内不再存在用户可见的工作流切换。
- 旧项目打开时不丢数据，类型和 `workflow_kind` 能安全校正。
- 导入失败、取消、删除和重置均完成项目级清理。
- 暂存 token 具备过期清理、重复 confirm 防护和页面替换/卸载后的清理兜底。
- 定向测试、native smoke、Renderer build 和手动 Electron 流程均通过。
