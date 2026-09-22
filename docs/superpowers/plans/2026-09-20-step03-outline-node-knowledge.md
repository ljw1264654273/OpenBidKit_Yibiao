# STEP 03 目录项知识库关联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 STEP 03 目录项详情中支持新建并关联知识库文件夹，并让正文生成使用当前节点及父级节点继承的知识库内容。

**Architecture:** 在 `technical_plan_outline_nodes` 增加节点直接关联的知识库文件夹 ID 数组。Renderer 通过现有知识库创建/上传 IPC 完成资料导入，再通过一个薄的技术方案 IPC 保存当前节点关联；正文 Main 任务从节点树和知识库索引动态展开继承关系，按叶子节点隔离加载知识条目。

**Tech Stack:** Electron CommonJS、SQLite/better-sqlite3、React + TypeScript、Radix `AppDialog`、Node test、Vite/TypeScript build。

---

### Task 1: 为目录节点增加知识库文件夹持久化

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Modify: `client/src/shared/types/outline.ts`
- Modify: `client/src/features/technical-plan/types.ts`（如需补充请求类型）
- Test: `client/electron/services/technicalPlanStore.nodeKnowledge.test.cjs`

- [ ] **Step 1: 写失败测试**
  - 覆盖节点直接关联文件夹 ID 的保存和加载。
  - 覆盖更新父级关联后，父级和所有后代叶子正文状态/正文计划被清理。
  - 覆盖排序保存不会丢失文件夹关联。
- [ ] **Step 2: 运行定向测试确认失败**
  - Run: `cd client; node --test electron\services\technicalPlanStore.nodeKnowledge.test.cjs`
  - Expected: 因为字段和 Store API 尚不存在而失败。
- [ ] **Step 3: 实现最小 SQLite 与 Store 支持**
  - 在 SQLite v30 migration 和健康检查字段组中增加 `knowledge_folder_ids_json`。
  - 同步根 `sql/workspace_schema.sql`。
  - 在 `OutlineItem`、Store 的 flatten/load/upsert 和保存/排序路径中保留该字段。
  - 增加 `saveOutlineNodeKnowledge({ nodeId, knowledgeFolderIds })`，校验节点存在，按目录树计算受影响节点，清理受影响叶子的 content、content section、content plan 和图片计划，并返回最新技术方案局部状态。
- [ ] **Step 4: 运行测试确认通过**
  - Run: `cd client; node --test electron\services\technicalPlanStore.nodeKnowledge.test.cjs`
  - Expected: PASS。
- [ ] **Step 5: 提交**
  - Run: `git add client/electron/services/sqliteDatabase.cjs client/electron/services/technicalPlanStore.cjs sql/workspace_schema.sql client/src/shared/types/outline.ts client/electron/services/technicalPlanStore.nodeKnowledge.test.cjs; git commit -m "feat: persist outline knowledge folder links"`

### Task 2: 打通技术方案 IPC 和 Renderer 类型

**Files:**
- Modify: `client/electron/ipc/technicalPlanIpc.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Test: `client/electron/ipc/technicalPlanIpc.nodeKnowledge.test.cjs`

- [ ] **Step 1: 写失败测试**
  - 覆盖技术方案 IPC 将 `save-node-knowledge` 转发到当前项目 Store。
- [ ] **Step 2: 运行定向测试确认失败**
  - Run: `cd client; node --test electron\ipc\technicalPlanIpc.nodeKnowledge.test.cjs`
  - Expected: 新 IPC handler/API 尚不存在而失败。
- [ ] **Step 3: 实现最小 IPC/bridge**
  - 注册 `technical-plan:save-node-knowledge`。
  - preload 暴露 `technicalPlan.saveNodeKnowledge`。
  - 同步 `YibiaoBridge` 类型。
  - 在 `TechnicalPlanHome` 增加包装回调，合并 Store 返回的局部状态。
- [ ] **Step 4: 运行测试和静态检查**
  - Run: `cd client; node --test electron\ipc\technicalPlanIpc.nodeKnowledge.test.cjs`
  - Run: `cd client; node --check electron\ipc\technicalPlanIpc.cjs; node --check electron\preload.cjs`
  - Expected: PASS。
- [ ] **Step 5: 提交**
  - Run: `git add client/electron/ipc/technicalPlanIpc.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/electron/ipc/technicalPlanIpc.nodeKnowledge.test.cjs; git commit -m "feat: expose outline knowledge association IPC"`

### Task 3: 实现 STEP 03 详情面板新增知识库交互

**Files:**
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Test: `client/src/features/technical-plan/services/outlineNodeKnowledge.test.ts`
- Test: `client/src/features/technical-plan/services/outlineSourceMatcher.test.ts`（仅在现有页面结构测试最适合扩展时修改）

- [ ] **Step 1: 写失败测试**
  - 覆盖从目录树计算当前节点和父级文件夹集合。
  - 覆盖当前节点文件夹与继承文件夹分组。
  - 覆盖组件源码存在「新增知识库」、`AppDialog`、现有 `knowledgeBase.createFolder` 和 `knowledgeBase.uploadDocuments` 调用。
- [ ] **Step 2: 运行定向测试确认失败**
  - Run: `cd client; npm exec tsx --test src/features/technical-plan/services/outlineNodeKnowledge.test.ts`
  - Expected: 新辅助函数和交互标记不存在而失败。
- [ ] **Step 3: 实现交互**
  - 在详情操作区增加「新增知识库」按钮，复用当前锁定条件。
  - 使用 `AppDialog` 输入文件夹名；默认当前目录标题。
  - 创建文件夹后调用现有上传 API，再保存节点文件夹关联；创建成功后关闭弹窗并刷新知识库索引。
  - 订阅 `knowledgeBase.onEvent()`，让上传处理状态和文档数量在详情面板实时刷新。
  - 详情面板展示当前目录直接关联和父级继承的文件夹、文档状态、解除当前关联按钮。
  - 失败统一走 `useToast`/`useDocumentParseNotice`，不使用 alert/prompt。
- [ ] **Step 4: 运行测试确认通过**
  - Run: `cd client; npm exec tsx --test src/features/technical-plan/services/outlineNodeKnowledge.test.ts`
  - Run: `cd client; npm run build`
  - Expected: PASS，构建退出码为 0。
- [ ] **Step 5: 提交**
  - Run: `git add client/src/features/technical-plan/pages/OutlineEditPage.tsx client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/outlineNodeKnowledge.test.ts; git commit -m "feat: add outline detail knowledge library action"`

### Task 4: 让正文生成使用节点知识库和父级继承

**Files:**
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Test: `client/electron/services/contentGenerationTask.nodeKnowledge.test.cjs`

- [ ] **Step 1: 写失败测试**
  - 构造父节点、子节点、两个叶子节点和知识库索引。
  - 断言叶子节点得到父级 + 自身文件夹的文档 ID，兄弟节点不读取另一分支的文件夹。
  - 断言只使用状态为 `success` 的文档，并去重。
- [ ] **Step 2: 运行定向测试确认失败**
  - Run: `cd client; node --test electron\services\contentGenerationTask.nodeKnowledge.test.cjs`
  - Expected: 节点文件夹展开 helper 不存在而失败。
- [ ] **Step 3: 实现最小读取链路**
  - 添加纯函数展开节点祖先文件夹和知识库索引文档的方法，并导出供测试使用。
  - 正文任务启动时读取一次知识库索引，建立 folder 到成功 document ID 的映射。
  - 按叶子上下文缓存并读取该叶子实际可用的参考条目，编排阶段只注入当前叶子可用条目。
  - 保存/复用历史编排计划时按当前叶子的允许知识条目过滤，正文生成按当前叶子对应的 content map 解析条目正文。
  - 保留项目级本地知识库、远程知识库和现有日志行为。
- [ ] **Step 4: 运行测试确认通过**
  - Run: `cd client; node --test electron\services\contentGenerationTask.nodeKnowledge.test.cjs`
  - Run: `cd client; node --test electron\services\contentGenerationTask.mandatoryRules.test.cjs`
  - Expected: PASS。
- [ ] **Step 5: 提交**
  - Run: `git add client/electron/services/contentGenerationTask.cjs client/electron/services/contentGenerationTask.nodeKnowledge.test.cjs; git commit -m "feat: inherit outline knowledge during content generation"`

### Task 5: 完成集成验证

**Files:**
- Verify: all files from Tasks 1-4

- [ ] **Step 1: 检查所有 CommonJS 文件**
  - Run: `cd client; node --check electron\services\sqliteDatabase.cjs; node --check electron\services\technicalPlanStore.cjs; node --check electron\services\contentGenerationTask.cjs; node --check electron\ipc\technicalPlanIpc.cjs; node --check electron\preload.cjs`
- [ ] **Step 2: 运行相关测试**
  - Run: `cd client; node --test electron\services\technicalPlanStore.nodeKnowledge.test.cjs electron\services\contentGenerationTask.nodeKnowledge.test.cjs electron\ipc\technicalPlanIpc.nodeKnowledge.test.cjs`
- [ ] **Step 3: 验证 native SQLite**
  - Run: `cd client; npm run smoke:electron-native`
- [ ] **Step 4: 构建客户端**
  - Run: `cd client; npm run build`
- [ ] **Step 5: 手动启动检查**
  - Run: `cd client; npm run dev`
  - 在 STEP 03 选择目录，创建知识库文件夹并上传文档，确认详情显示直接关联/继承关系，确认文档处理事件更新；再验证 STEP 05 生成日志中只读取当前目录可用资料。
