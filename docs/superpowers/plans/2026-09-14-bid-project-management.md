# 标书项目管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单例技术方案升级为本机可管理、可并行生成、可查重的多标书项目工作区。

**Architecture:** 新增 `bid_projects` 项目目录和项目级文件根目录，把现有技术方案状态按 `project_id` 隔离；任务事件和任务存储携带项目作用域，同一项目互斥、跨项目由并发上限 2 的队列调度。新增工作区首页、项目详情上下文、新建源文件提醒和项目级正文查重对照视图，保留现有技术方案步骤和导出链路。

**Tech Stack:** Electron CommonJS Main/services/IPC, better-sqlite3, React + TypeScript, Radix UI, existing Toast/AppDialog/FloatingToolbar, Node test runner, Vite/tsc.

---

## 文件结构

- Create: `client/electron/services/bidProjectStore.cjs` - 项目目录、指纹、CRUD、状态聚合。
- Create: `client/electron/services/bidProjectManager.cjs` - 当前项目上下文和项目级 Store/文件根装配。
- Create: `client/electron/services/bidProjectStore.test.cjs` - 项目 CRUD、指纹和状态测试。
- Create: `client/electron/services/bidContentDuplicateService.cjs` - 段落拆分、近似匹配、豁免和建议。
- Create: `client/electron/services/bidContentDuplicateService.test.cjs` - 查重算法测试。
- Create: `client/src/features/bid-project/pages/BidProjectWorkspacePage.tsx` - 项目列表、新建、筛选、重命名/删除入口。
- Create: `client/src/features/bid-project/pages/BidProjectComparePage.tsx` - 左右对照查重页面。
- Create: `client/src/features/bid-project/types.ts` - Renderer 项目、查重和新建类型。
- Create: `client/src/features/bid-project/services/bidProjectStorage.ts` - 项目 IPC 轻量封装。
- Create: `client/src/features/bid-project/components/BidProjectRow.tsx` - 列表行。
- Create: `client/src/features/bid-project/components/BidProjectDialogs.tsx` - 新建重复提醒和删除/重命名对话框。
- Create: `client/src/styles/feature-bid-project.css` - 项目列表与对照页样式。
- Modify: `client/electron/services/sqliteDatabase.cjs` - v27 项目目录、正文查重表和项目化技术方案表结构迁移。
- Modify: `sql/workspace_schema.sql` - 同步 v27 目标结构。
- Modify: `client/electron/utils/paths.cjs` - 项目文件根目录和项目资源路径。
- Modify: `client/electron/services/technicalPlanStore.cjs` - 接受项目上下文，所有状态/文件操作绑定项目。
- Modify: `client/electron/services/taskService.cjs` - 项目作用域、跨项目并发上限、任务事件 projectId。
- Modify: `client/electron/ipc/index.cjs`, `client/electron/ipc/technicalPlanIpc.cjs`, `client/electron/ipc/taskIpc.cjs` - 装配和 IPC。
- Modify: `client/electron/preload.cjs`, `client/src/shared/types/ipc.ts` - bridge API/type。
- Modify: `client/src/app/App.tsx`, `client/src/app/AppRouter.tsx`, `client/src/app/menuConfig.ts`, `client/src/shared/types/navigation.ts`, `client/src/components/Sidebar.tsx` - 项目入口和当前项目导航。
- Modify: `client/src/features/technical-plan/hooks/useTechnicalPlanWorkflow.ts`, `client/src/features/technical-plan/services/technicalPlanStorage.ts`, `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx` - 当前 projectId 传递、项目上下文和回列表。
- Modify: `client/src/features/duplicate-check/pages/DuplicateCheckPage.tsx` - 保留独立查重，同时接入项目手动选择入口。
- Modify: `analytics/dashboard/public/src/pages/traffic.js` - 新增项目列表/查重路由中文名。

## Task 1: 项目数据层与迁移

- [ ] 写 `bidProjectStore.test.cjs` 的失败测试：创建项目、同源序号、搜索筛选、重命名删除、状态聚合。
- [ ] 运行 `node --test client/electron/services/bidProjectStore.test.cjs`，确认新 Store 尚不存在而失败。
- [ ] 在 `sqliteDatabase.cjs` 增加 v27 migration：`bid_projects`、`bid_project_source_files`、`bid_project_duplicate_results`，以及带 `project_id` 的技术方案项目表族；保留旧单例表只用于兼容读取，不让新项目继续写入旧单例。
- [ ] 在 `paths.cjs` 增加项目目录解析和项目级技术方案根路径。
- [ ] 实现 `bidProjectStore.cjs`：项目 CRUD、原始/归一化指纹匹配、同源组序号和列表快照。
- [ ] 更新 `sql/workspace_schema.sql` 到 v27。
- [ ] 运行项目 Store 定向测试和 `npm run smoke:electron-native`。

## Task 2: 技术方案项目隔离

- [ ] 写 Store/任务隔离测试：两个 projectId 的招标文件、目录节点、正文和任务互不覆盖。
- [ ] 改造 `technicalPlanStore.cjs` 工厂接收 `projectId` 和项目文件根目录，所有项目化技术方案表查询使用 `project_id`，项目文件读写使用项目根目录。
- [ ] 让 `bidProjectManager.cjs` 管理当前项目，按 projectId 缓存 Store，并提供创建/打开/关闭上下文；后台任务启动时捕获不可变的项目 Store，不能依赖切换后的当前项目。
- [ ] 更新 `technicalPlanIpc.cjs` 和 `index.cjs`，所有技术方案 IPC 明确接收/返回 `projectId`，当前项目只作为 Renderer 兼容默认值。
- [ ] 更新 Renderer 技术方案 Hook、Storage 和 Home，把 `projectId` 传进每个 bridge 调用和任务 payload，并按项目过滤任务事件。
- [ ] 运行现有技术方案相关 `.test.cjs`、TypeScript build 和 Electron smoke。

## Task 3: 任务作用域与并发

- [ ] 写任务服务测试：同项目保持互斥、不同项目最多两个运行、第三个排队、任务事件含 projectId。
- [ ] 在 `taskService.cjs` 为技术方案任务增加 project scope，活动任务 key 改为 `type:projectId`，恢复时按项目读取；runner 启动时固定对应 Store、文件根和 Agent workspace。
- [ ] 增加项目级有限并发调度器，默认上限 2；队列任务在项目状态中显示生成中/排队。
- [ ] 将目录/全局事实的持久 Agent key 和 workspace 目录命名空间化为 `projectId`，并让暂停正文、一级目录确认、自动确认抑制、取消和删除 API 按 taskId/projectId 定位。
- [ ] 更新取消、重置、删除和任务 checkpoint，确保只操作对应 projectId。
- [ ] 运行 taskService 相关测试、Electron smoke 和 TypeScript build。

## Task 4: 工作区首页与项目详情

- [ ] 写项目首页的纯函数测试：状态筛选、名称搜索、类型筛选和状态标签。
- [ ] 实现 `BidProjectWorkspacePage`、`BidProjectRow`、`BidProjectDialogs` 和样式，支持列表、统计、新建入口、打开、重命名、删除、导出和同源查重。
- [ ] 将 `bid-generation` 默认入口改为项目工作区，保留现有技术方案二级入口作为兼容入口。
- [ ] 在 `AppRouter` 和导航类型中增加项目列表/比较页面；在技术方案详情顶部显示当前项目名称和返回列表。
- [ ] 运行 `npm run build`，通过 `npm run dev` 手动检查空态、列表、Dialog、内部滚动和当前项目切换。

## Task 5: 源文件重复提醒与新建流程

- [ ] 写源文件指纹测试：字节相同、内容归一化相同、完全不同三种情况。
- [ ] 新建 IPC 在解析招标文件后调用 `bidProjectStore.findSourceMatches`，返回只读摘要，不阻止继续；解析后的 Markdown 和原件先写入带 token 的临时导入缓存，不直接写入当前项目。
- [ ] 实现重复提醒 Dialog：默认打开已有项目，继续新建时填写标段/包件标识，创建同源序号项目。
- [ ] 增加“确认继续新建/打开已有项目”的导入暂存确认协议：打开已有项目不改变任何项目，继续新建才消费暂存 token 创建项目并导入；将现有 `importTenderDocument` 改为当前项目首次导入。
- [ ] 运行定向测试、build 和 Electron 手动导入验证。

## Task 6: 正文段落级查重

- [ ] 写 `bidContentDuplicateService.test.cjs`：逐字重复、改几个字、换语序、短段落、招标原话/规范条文/固定资质豁免。
- [ ] 实现段落归一化、n-gram/编辑距离混合评分、默认灵敏度、豁免规则和改写建议生成。
- [ ] 增加查重 IPC、preload bridge 和类型；结果保存到 `bid_project_duplicate_results`。
- [ ] 实现手动选择任意两个项目和同源默认比较；提供左右段落、联动定位、建议确认替换。
- [ ] 运行算法测试、build 和本地两项目手动查重验证。

## Task 7: 回归与交付前验证

- [ ] 运行所有改动过的 `.cjs` 的 `node --check`。
- [ ] 运行 `cd client; npm run build`。
- [ ] 运行 `cd client; npm run smoke:electron-native`。
- [ ] 运行项目 Store、查重服务、任务相关定向测试。
- [ ] `npm run dev` 手动验证：新建两项目、退出重进、并行生成/排队、搜索筛选、重命名、删除、导出、源文件提醒、同源查重和确认替换。
- [ ] 检查 `git diff`，确保不修改用户已有无关变更，并总结未覆盖的测试风险。
