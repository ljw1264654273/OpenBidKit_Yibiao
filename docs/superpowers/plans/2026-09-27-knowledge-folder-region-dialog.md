# 知识库文件夹省市弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 六个本地知识库分类通过弹窗创建文件夹，可选省市并在列表中持久展示。

**Architecture:** `KnowledgeBasePage` 使用现有 `AppDialog`；Renderer 用离线 `@vant/area-data` 生成省市级联选项。省市名称通过现有 bridge 的可选尾参数传到 Store，SQLite 迁移保留旧行空地域，列表与创建返回同一实体形状。技术方案原有两参数调用继续有效。

**Tech Stack:** React/TypeScript、Radix Dialog、Electron IPC、better-sqlite3、`@vant/area-data`。

**Spec:** `docs/superpowers/specs/2026-09-27-knowledge-folder-region-dialog-design.md`

---

### Task 1: SQLite 文件夹地域字段

**Files:** `client/electron/services/knowledgeBaseStore.categories.test.cjs`, `client/electron/services/knowledgeBaseStore.cjs`, `client/electron/services/sqliteDatabase.cjs`, `sql/workspace_schema.sql`。

- [x] 在现有 Electron native 分类测试中增加旧版（v33）升级后 `province`、`city` 默认为 `NULL` 的断言，以及创建空地域、省份独选、省市同选后创建返回值和 `list()` 返回相同值的断言。
- [x] 执行 `cd client; node --test electron/services/knowledgeBaseStore.categories.test.cjs`，确认断言因缺少字段而失败。
- [x] 将 schemaVersion 增至 34；增加迁移 `addKnowledgeFolderRegion()`，用 `addColumnIfMissing` 建立两个可空 `TEXT` 字段；在 schema health 的字段修复映射中登记 v34；更新目标 schema。Store 的 `folderFromRow`、insert/upsert、`createFolder(name, knowledgeBaseId, province = null, city = null)` 同步字段，空值写 `NULL`。保留旧调用签名兼容性。
- [x] 重新运行定向测试并执行 `node --check electron/services/sqliteDatabase.cjs; node --check electron/services/knowledgeBaseStore.cjs`，确认通过。

### Task 2: 创建调用链与省市选项

**Files:** `client/electron/services/knowledgeBaseService.cjs`, `client/electron/ipc/knowledgeBaseIpc.cjs`, `client/electron/preload.cjs`, `client/src/shared/types/ipc.ts`, `client/src/features/knowledge-base/types.ts`, `client/src/features/knowledge-base/regionOptions.ts`, `client/src/features/knowledge-base/regionOptions.test.cjs`, `client/package.json`, `client/package-lock.json`。

- [ ] 增加省市选项的纯函数测试：34 个省级选项可用、北京市有城市选项、广东省城市包含广州市、未选省份没有城市选项；先运行测试确认缺失实现导致失败。
- [ ] `npm install @vant/area-data@2.2.0`；用包的 `areaList.province_list` / `areaList.city_list` 生成选项，城市按省份代码前两位筛选。省、市均存中文名称；直辖市保留其城市级选项。无需区县。
- [ ] bridge 的 `createFolder` 增加两个可选尾参数，service 和 IPC 只转发；`KnowledgeFolder` 增加 `province: string | null`、`city: string | null`。原有技术方案两参数调用不变。
- [ ] 运行省市选项定向测试和修改过的 `.cjs` 的 `node --check`。

### Task 3: 新建弹窗及列表展示

**Files:** `client/src/features/knowledge-base/pages/KnowledgeBasePage.tsx`, `client/src/styles/feature-knowledge-base.css`。

- [ ] 为可测试的地域展示/切换行为增加聚焦测试（纯函数如 `formatFolderRegion` 和省份变化时的城市重置），运行确认失败。
- [ ] 以 `AppDialog` 替换 `knowledge-create-folder-bar`。名称必填；省份可空；未选省份时城市禁用；省份更改清空城市。创建中禁用关闭及重复提交，失败保留内容，成功清空内容并选中新文件夹。顶部及空态共用入口。
- [ ] 文件夹列表展示可用地域（若省、市同名仅展示一次）；无地域不显示占位。移除旧内联表单 CSS，加入与现有移动弹窗一致的表单样式及小窗口约束。
- [ ] 运行聚焦测试和 `npm run build`，处理编译错误。

### Task 4: 全链路验证

- [ ] `cd client; npm run smoke:electron-native`，并运行知识库 Store 定向测试、`npm run build`、`npm audit`。
- [ ] `npm run dev` 打开 Electron；分别检查任意两个分类中的新建入口、可空地域、级联清空、列表显示、页面切换后持久展示，以及窄窗口弹窗布局和键盘关闭。其余四个分类由同一组件/接口覆盖。
- [ ] 检查 `git diff --check` 和范围，确保 `client/src/features/bid-project/components/BidProjectRow.tsx` 的既有修改未受影响；记录未完成的手动验证或审计问题。
