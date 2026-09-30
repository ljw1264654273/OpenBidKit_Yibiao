# 技术方案检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在客户端新增跨平台“技术方案检查”一级菜单，原生迁移 `bid-Check` 恢复规则、后台任务、DOCX 报告和截图对应的四文件检查页面。

**Architecture:** Electron Main 新增 SQLite Store、文件解析适配器、纯规则模块、OOXML 检查 worker、报告生成器和 `taskService` runner；Renderer 只读取快照、订阅统一任务事件并呈现文件选择、进度与结果。内容解析复用现有 `fileService`，PDF 先本地提取文字层，只有扫描件且已配置 MinerU 时回退 OCR。

**Tech Stack:** Electron 41、CommonJS Main/preload、React 19 + TypeScript Renderer、better-sqlite3、worker_threads、adm-zip、cheerio、docx、Radix、全局 CSS。

## 实施进度

- [x] Task 0：隔离环境与基线验证。
- [x] Task 1：SQLite 状态与 Store，规格与质量审查通过。
- [x] Task 2：文档适配器与内容规则，规格与质量审查通过。
- [x] Task 3：OOXML 与 worker，英文/章节修复后双审通过；独立联合测试 49/49、语法与 build 通过。
- [x] Task 4：DOCX 报告与安全落盘，双审通过；独立 23/23 测试与语法检查通过。
- [x] Task 5：文件服务与十三阶段后台任务，取消与错误传播修复后双审通过；独立 45/45、build 与 native smoke 通过。
- [x] Task 6：IPC、preload 与类型闭环，双审通过；独立 IPC 测试 15/15、语法与 build 通过。
- [x] Task 7：主菜单与检查页面，禁用提示修复后双审通过；16/16 页面测试与真实 Electron 离页恢复、重复运行、窄窗口验证通过。
- [x] Task 8：Golden fixture 与端到端验证，规格与质量审查通过；最终 166/166 定向测试、build、native smoke 和真实 Electron 流程通过。

## 独立工作区验收记录（2026-09-30）

### 工作区与交付范围

- 实现仅保留在 `C:\Users\admin\.codex\worktrees\technical-plan-check\OpenBidKit_Yibiao`，未合并、推送或打包；原工作区已有改动未修改。
- “技术方案检查”一级菜单、四文件选择、另存为、十三阶段后台任务、进度日志、SQLite 状态恢复和 DOCX 检查记录已完成。
- 依赖清单与基线 `2184ce6` 无差异；未提交外部原文、样例 DOCX、临时报告或 QA 脚本，未新增 EXE/Python/OCR 依赖。
- Analytics 仅增加 `technical-plan-check` 中文路由名，原采集、展示和聚合能力未删除或弱化。

### 自动验证

- 20 个定向测试文件共 166/166 通过，失败、取消、跳过均为 0；包含本功能、Renderer、真实 worker、文件服务和受影响的 SQLite migration。
- `npm run build` 退出 0，仅有既有 chunk 体积警告；Main/preload/IPC、格式检查及 Analytics 路由文件语法检查通过。
- `npm run smoke:electron-native` 通过：Electron 41.10.2 / Node 24.18.0 / ABI 145，真实 SQLite 查询成功。
- `git diff --check 2184ce6` 通过。
- Golden 使用 `BID_CHECK_FIXTURE_DIR=D:\2026AI\project\bid-Check\测试文件`，走真实 parser、adapter、worker、十三阶段 runner、SQLite checkpoint/reopen 与 DOCX writer。四份外部文件读取成功，726 条发现及上下文完整比对，结果为 issue 165 / review 561 / info 0，需求 17 条、评分项 7 条。
- Golden findings SHA256：`c0c0ce68baa1ca39198c3ace7889bde7e6e29b183e49c9bfbf55e8148acdf307`；格式检查 raw 6547 / 返回 207 / 截断 6340，每条规则上限 30。缺环境变量时明确 FAIL，不 skip。
- 原检查记录 SHA256 保持 `143d8c7308578ba63a573384c6e2f61db1f031f166af0bf658468be1e575e9b7`，未覆盖原报告。

### Electron 实测与审查

- 隔离 userData 的真实 Electron 已验证四文件输入、另存为、运行中禁用、离页继续与返回恢复、报告打开、重复检查，以及桌面/窄窗口/420px 窗口内部滚动且无横向溢出。系统选择器和打开文件调用由 QA stub 接管，解析、IPC、后台任务、数据库和报告生成走真实业务链路。
- 运行到第五阶段退出并重启后任务转 error，保留前五阶段日志且旧报告未替换。
- 真实文字层 PDF 本地解析成功；无文字层和缺 MinerU Token 均有明确提示；配置 MinerU 后文字 PDF 仍 local-first，PDF 格式跳过记录为 info，报告成功。
- 真实 Word COM 生成的 `.doc` 经本地转换、worker 与报告链路成功；临时 DOCX 在格式检查回调内存在，结束后清理。
- 最终整体审查发现的初始化完成事件遗漏已按 TDD 修复：保留 `load → subscribe → active`，订阅后补读快照，防止旧 active 回滚新事件，重放刷新期间事件，并保护文件选择与卸载。新增五项回归先确认旧实现失败；修复后页面测试 21/21、控制器定向复审 11/11，无新增审查问题。
- 修复后再次运行完整 166 项测试、build/native/语法检查和真实 Electron UI 流程，均通过。规格与质量审查均已完成。
- 未实测原生 WPS 格式、真实 MinerU 外网 OCR、macOS 转换和平台打包；DOC/WPS 编排已有定向 mock 测试覆盖，不宣称全平台实测。

## 主目录合入验收记录（2026-09-30）

- 按用户“提交到主目录”的要求，将独立工作区 `d955992` 合入 `D:\2026AI\project\OpenBidKit_Yibiao` 的 `ycbs` 分支，合入前 HEAD 为 `52d622c`；不推送、不打包。
- 主目录已有目录最低层级迁移 v37，完整保留该迁移；技术方案检查迁移顺延为 v38，并同步运行时健康检查、SQL 文档和迁移测试。从 v36/v37 升级到 v38 均验证目录设置及生效快照保留。
- 关闭任务测试的技术方案模拟状态补齐主目录现有要求的 `outlineMinimumDepthSnapshot`，不修改正文启动规则。
- 主目录 22 个定向测试文件共 169/169 通过，失败、取消、跳过均为 0，包含外部四文件 Golden、受影响的数据库迁移及目录最低层级任务测试。
- 主目录 `npm run build`、`npm run smoke:electron-native` 和本轮 CJS/Analytics 语法检查通过；构建仅有既有 chunk 体积警告。
- 使用主目录 Main/preload 和 `127.0.0.1:5173` Renderer，在隔离 userData 的真实 Electron 中复测四文件选择、另存为、运行中禁用、离页返回恢复、报告打开、重复运行、桌面/窄窗口/420px 布局。结果 726 条（issue 165 / review 561），原报告哈希不变；系统选择器和打开文件由 QA stub 接管，其余业务链路真实执行。
- 六个导航/样式重叠文件保留用户原有“历史标书适配”入口，用户既有未提交与未跟踪文件不纳入本功能提交；依赖清单不提交。合入期间的导航备份 stash 已恢复并保留。
- 主目录原有 `src/app/projectNavigation.test.ts` 使用 Vitest，不能纳入 `node --test`；本地缺少 `vitest` 包，未运行该用户测试，也未修改其代码或依赖清单。上述 169 项为本次定向 Node 测试，不代表全仓测试。

---

## 文件结构

### 新建

- `client/src/features/technical-plan-check/types.ts`：Renderer 状态、文件角色、规则结果类型。
- `client/src/features/technical-plan-check/pages/TechnicalPlanCheckPage.tsx`：页面编排与统一任务事件恢复。
- `client/src/styles/feature-technical-plan-check.css`：页面布局、文件行、日志面板和响应式规则。
- `client/electron/services/technicalPlanCheckStore.cjs`：SQLite 快照、任务、日志和失效规则。
- `client/electron/services/technicalPlanCheckStore.test.cjs`：Store、任务恢复与日志清理测试。
- `client/electron/services/technicalPlanCheckDocumentAdapter.cjs`：解析产物到段落行/表格行的统一适配。
- `client/electron/services/technicalPlanCheckDocumentAdapter.test.cjs`：DOCX HTML、PDF Markdown、MinerU 表格 fixture。
- `client/electron/services/technicalPlanCheckRules.cjs`：纯内容检查规则和 rule ID/severity 映射。
- `client/electron/services/technicalPlanCheckRules.test.cjs`：恢复规则 golden/unit 测试。
- `client/electron/services/technicalPlanFormatChecks.cjs`：DOCX OOXML 显式属性检查。
- `client/electron/services/technicalPlanFormatChecks.test.cjs`：格式、编号、章节、英文词项测试。
- `client/electron/services/technicalPlanCheckWorker.cjs`：worker_threads 入口，执行 CPU 密集规则。
- `client/electron/services/technicalPlanCheckWorker.test.cjs`：worker progress/result/error/terminate 协议测试。
- `client/electron/services/technicalPlanCheckReport.cjs`：DOCX 报告及临时文件安全替换。
- `client/electron/services/technicalPlanCheckReport.test.cjs`：报告结构、碰撞和失败清理测试。
- `client/electron/services/technicalPlanCheckService.cjs`：文件选择、解析回退、打开报告。
- `client/electron/services/technicalPlanCheckService.test.cjs`：PDF 本地→MinerU、DOC/WPS 生命周期测试。
- `client/electron/services/technicalPlanCheckTask.cjs`：十三阶段 runner、worker 取消和 checkpoint。
- `client/electron/services/technicalPlanCheckTask.test.cjs`：阶段、取消、错误和输出替换测试。
- `client/electron/ipc/technicalPlanCheckIpc.cjs`：feature 命令 IPC。
- `client/electron/ipc/technicalPlanCheckIpc.test.cjs`：IPC 注册与转发测试。
- `client/electron/services/taskService.technicalPlanCheck.test.cjs`：taskService 分发、事件、互斥和恢复测试。
- `client/src/features/technical-plan-check/state.ts`：页面快照/patch 合并与按钮可用性纯函数。
- `client/src/features/technical-plan-check/state.test.ts`：页面状态恢复和显式清理测试。
- `client/src/features/technical-plan-check/controller.ts`：可注入 bridge 的初始化顺序与订阅清理。
- `client/src/features/technical-plan-check/controller.test.ts`：`load → subscribe → active replay` 调用顺序测试。
- `client/electron/ipc/index.technicalPlanCheckLifecycle.test.cjs`：workspace service 关闭句柄接入测试。

### 修改

- `client/electron/services/sqliteDatabase.cjs`、`sql/workspace_schema.sql`：独立工作区原为 schema 36→37，主目录合入后协调为 v38，新增 meta/task 表、两个日志触发器和 migration。
- `client/electron/services/taskService.cjs`：新增任务定义、runner、恢复和启动方法。
- `client/electron/ipc/taskIpc.cjs`：注册 `tasks:start-technical-plan-check`。
- `client/electron/ipc/index.cjs`：Store/service/task 装配和数据库通道。
- `client/electron/preload.cjs`、`client/src/shared/types/ipc.ts`：完整 bridge 与类型。
- `client/src/shared/types/navigation.ts`、`client/src/app/menuConfig.ts`、`client/src/app/AppRouter.tsx`、`client/src/components/Sidebar.tsx`：一级菜单、路由和图标。
- `client/src/styles.css`：导入 feature CSS。
- `analytics/dashboard/public/src/pages/traffic.js`：埋点路由中文名。
- `client/src/app/menuConfig.test.ts`、`client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`：导航与通道覆盖。

## Task 0：隔离环境 preflight

**Files:**
- Verify only: `client/package.json`
- Verify only: `client/package-lock.json`

- [ ] **Step 1: 确认不带入用户依赖清单改动**

Run: `git status --short -- client/package.json client/package-lock.json`
Expected: 无输出。

- [ ] **Step 2: 准备不写依赖清单的 node_modules**

本 worktree 的提交没有 lockfile，不能运行 `npm ci`。复用同一仓库主工作区已通过 build/native smoke 的依赖树，仅复制 `node_modules`，不得复制 `package.json` 或 `package-lock.json`：

```powershell
$source='D:\2026AI\project\OpenBidKit_Yibiao\client\node_modules'
$target='C:\Users\admin\.codex\worktrees\technical-plan-check\OpenBidKit_Yibiao\client\node_modules'
robocopy $source $target /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { exit $LASTEXITCODE }
```

- [ ] **Step 3: 跑可复现基线**

Run:

```powershell
cd client
npm run build
npm run smoke:electron-native
node --test electron/services/sqliteDatabase.globalFactsModeMigration.test.cjs
```

Expected: 全部 PASS；build 仅允许既有 chunk warning。

- [ ] **Step 4: 再次确认依赖清单未变化**

Run: `git status --short -- client/package.json client/package-lock.json`
Expected: 无输出。

## Task 1：SQLite 状态与 Store

**Skills:** `@superpowers:test-driven-development`

**Files:**
- Create: `client/electron/services/technicalPlanCheckStore.test.cjs`
- Create: `client/electron/services/technicalPlanCheckStore.cjs`
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`

- [ ] **Step 1: 写 Store 失败测试**

覆盖：空快照、保存四个文件、自动输出路径、输入变化清空旧 summary/report、任务日志同步、running 重启转 error、删除任务清理 `task_logs`。

`technicalPlanCheckStore.test.cjs` 必须沿用现有 SQLite migration 测试的自启动 harness：普通 Node 进程只负责 `node:test` 外壳，实际加载 `better-sqlite3`、创建 Store 和执行断言的子进程使用 Electron `--runAsNode`，避免 Node ABI 与 Electron ABI 不一致。真实事务、`task_logs` 同步和 trigger 行为不得用 fake DB 代替。

```js
test('changing an input invalidates the previous report', () => {
  store.saveSelection('proposal', { path: '方案.docx', name: '方案.docx' });
  store.updateWithoutReload({ reportPath: '旧报告.docx', summary: { total: 3 } });
  const state = store.saveSelection('proposal', { path: '新方案.docx', name: '新方案.docx' });
  assert.equal(state.reportPath, '');
  assert.equal(state.summary, null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/technicalPlanCheckStore.test.cjs`
Expected: Electron `--runAsNode` 子进程成功启动，随后因模块或表不存在而 FAIL；不得出现 `ERR_DLOPEN_FAILED`。

- [ ] **Step 3: 增加 migration 与目标 schema**

将 schema 版本从 36 升到 37，新增 singleton `technical_plan_check_meta` 与 `technical_plan_check_tasks`；任务表字段结构对齐 rejection/duplicate task 表，增加两个 trigger（DELETE 清理日志、UPDATE OF task_id 清理旧日志），并同时同步到 `sqliteDatabase.cjs` 与 `workspace_schema.sql`，加入 migration entry 和数据库健康检查表清单。

- [ ] **Step 4: 写并运行 migration 失败测试**

Create: `client/electron/services/sqliteDatabase.technicalPlanCheckMigration.test.cjs`

沿用现有 Electron `--runAsNode` 自启动方式，覆盖 v36→v37、重复启动幂等、旧数据保留、健康修复和两个日志 trigger。

Run: `cd client; node --test electron/services/sqliteDatabase.technicalPlanCheckMigration.test.cjs`
Expected: FAIL，版本仍为 36 或表不存在。

- [ ] **Step 5: 实现 migration 与最小 Store**

公开 `loadState()`、`saveSelection(role, file)`、`saveOutputPath(path)`、`checkpointTask(task, patch)`、`updateWithoutReload(patch)`、`clear()`、`recoverInterruptedTask()`，内部用事务同时写 meta/task/log。

- [ ] **Step 6: 运行 Store、migration 与 native 验证**

Run: `cd client; node --test electron/services/technicalPlanCheckStore.test.cjs electron/services/sqliteDatabase.technicalPlanCheckMigration.test.cjs; npm run smoke:electron-native`
Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add client/electron/services/technicalPlanCheckStore.cjs client/electron/services/technicalPlanCheckStore.test.cjs client/electron/services/sqliteDatabase.cjs client/electron/services/sqliteDatabase.technicalPlanCheckMigration.test.cjs sql/workspace_schema.sql
git commit -m "feat: add technical plan check storage"
```

## Task 2：文档适配器与内容规则

**Skills:** `@superpowers:test-driven-development`

**Files:**
- Create: `client/electron/services/technicalPlanCheckDocumentAdapter.cjs`
- Create: `client/electron/services/technicalPlanCheckDocumentAdapter.test.cjs`
- Create: `client/electron/services/technicalPlanCheckRules.cjs`
- Create: `client/electron/services/technicalPlanCheckRules.test.cjs`

- [ ] **Step 1: 写适配器失败测试**

同一张评分表分别以 HTML table、Markdown pipe table 和 MinerU HTML/Markdown 输入，均应得到 `评分因素 | 实施方案 | 10`；普通段落剥离标记但保持逐行语义。

- [ ] **Step 2: 运行适配器测试确认失败**

Run: `cd client; node --test electron/services/technicalPlanCheckDocumentAdapter.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现适配器**

使用 `cheerio` 先提取 HTML table，再解析 Markdown table，过滤 `---` 分隔行；其余内容去除标题/列表/强调/链接等 Markdown 标记并解码 HTML 实体。

- [ ] **Step 4: 写规则失败测试**

覆盖需求提取、评分表提取、覆盖率阈值、强制数值缺失修正文案、期限差异、限定运算符、四类逻辑组、占位符、重复字、符号不配对、地名规则，以及每个 rule ID 的固定 severity。

```js
test('division is not treated as a supported explicit calculation', () => {
  assert.deepEqual(checkCalculations(['10 / 2 = 4']), []);
});

test('supported multiplication mismatch is an issue', () => {
  const [result] = checkCalculations(['10 × 2 = 30']);
  assert.equal(result.ruleId, 'calculation.mismatch');
  assert.equal(result.severity, 'issue');
});
```

- [ ] **Step 5: 运行规则测试确认失败**

Run: `cd client; node --test electron/services/technicalPlanCheckRules.test.cjs`
Expected: FAIL。

- [ ] **Step 6: 逐函数移植恢复规则**

保持纯函数接口，预计算 proposal/ref 中文二元组集合，避免每条需求重复扫描全文；导出稳定 `RULE_SEVERITY` 和汇总函数。

- [ ] **Step 7: 运行适配器与规则测试**

Run: `cd client; node --test electron/services/technicalPlanCheckDocumentAdapter.test.cjs electron/services/technicalPlanCheckRules.test.cjs`
Expected: PASS。

- [ ] **Step 8: 提交**

```powershell
git add client/electron/services/technicalPlanCheckDocumentAdapter* client/electron/services/technicalPlanCheckRules*
git commit -m "feat: port technical plan content checks"
```

## Task 3：OOXML 格式检查与 worker

**Skills:** `@superpowers:test-driven-development`

**Files:**
- Create: `client/electron/services/technicalPlanFormatChecks.cjs`
- Create: `client/electron/services/technicalPlanFormatChecks.test.cjs`
- Create: `client/electron/services/technicalPlanCheckWorker.cjs`
- Create: `client/electron/services/technicalPlanCheckWorker.test.cjs`

- [ ] **Step 1: 用 `docx` 生成最小 fixture 并写失败测试**

覆盖两端对齐、首行缩进、段前后、1.5 倍行距、grid/right indent、宋体小四、表格/图片居中、标题评分对应、编号混用和 30 条截断。先用 `docx` 生成合法 ZIP，再用 `adm-zip` 定向修改 `document.xml` / `numbering.xml`，保证 fixture 确实含 `snapToGrid`、`adjustRightInd` 和显式编号属性。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/technicalPlanFormatChecks.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现 OOXML 显式属性解析**

使用 `adm-zip` 读取 `word/document.xml`、`word/styles.xml` 和 `word/numbering.xml`，只复刻规格中的显式属性语义；不实现完整样式级联。

- [ ] **Step 4: 写 worker 协议失败测试**

覆盖 progress/result/error、错误对象序列化和 terminate 后不再发送 result。

Run: `cd client; node --test electron/services/technicalPlanCheckWorker.test.cjs`
Expected: FAIL，worker 入口不存在。

- [ ] **Step 5: 实现 worker 消息协议**

```js
// request: { type: 'run', payload: { documents, proposalDocxPath } }
// response: { type: 'progress' | 'result' | 'error', ... }
```

worker 中执行内容规则和 OOXML 扫描，Main 可通过 `worker.terminate()` 取消。

- [ ] **Step 6: 运行格式与 worker 测试**

Run: `cd client; node --test electron/services/technicalPlanFormatChecks.test.cjs electron/services/technicalPlanCheckWorker.test.cjs`
Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add client/electron/services/technicalPlanFormatChecks* client/electron/services/technicalPlanCheckWorker*
git commit -m "feat: add technical plan format checks"
```

## Task 4：DOCX 报告与安全落盘

**Skills:** `@superpowers:test-driven-development`

**Files:**
- Create: `client/electron/services/technicalPlanCheckReport.cjs`
- Create: `client/electron/services/technicalPlanCheckReport.test.cjs`

- [ ] **Step 1: 写报告失败测试**

断言标题、四个来源文件、汇总表、需求/评分/格式/内部问题章节、severity 文案；输出等于输入时拒绝；生成失败删除临时文件；替换失败不破坏旧报告。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/technicalPlanCheckReport.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现报告 document builder**

使用 `docx` 的 `Document`、`Table`、`Paragraph`、`Packer`，颜色仅区分 `info/review/issue`，不加入恢复源码以外的新结论。

- [ ] **Step 4: 实现安全写入**

目标目录创建唯一 `.tmp-<uuid>.docx`；完成后校验 ZIP 头。路径比较使用平台感知规范化函数：`path.resolve()` 后 Windows 统一小写，禁止与四个输入重合并覆盖中文/空格/大小写变体测试。

Windows 替换算法：若旧报告存在，先移动为唯一 `.bak-<uuid>.docx`，再把临时文件移动到目标；失败时恢复备份，成功后删除备份。任何异常或取消都清理临时/备份文件，旧报告必须保持完整。

- [ ] **Step 5: 运行报告测试并提交**

Run: `cd client; node --test electron/services/technicalPlanCheckReport.test.cjs`
Expected: PASS。

```powershell
git add client/electron/services/technicalPlanCheckReport*
git commit -m "feat: generate technical plan check reports"
```

## Task 5：文件服务与十三阶段后台任务

**Skills:** `@superpowers:test-driven-development`

**Files:**
- Create: `client/electron/services/technicalPlanCheckService.cjs`
- Create: `client/electron/services/technicalPlanCheckService.test.cjs`
- Create: `client/electron/services/technicalPlanCheckTask.cjs`
- Create: `client/electron/services/technicalPlanCheckTask.test.cjs`
- Modify: `client/electron/services/taskService.cjs`
- Create: `client/electron/services/taskService.technicalPlanCheck.test.cjs`

- [ ] **Step 1: 写文件编排失败测试**

覆盖系统选择器、自动输出名、文本 PDF 只本地解析、`pdf_text_layer_missing` 时按 provider 回退、精准 API 缺 Token、Agent API 失败、DOC/WPS 在临时 DOCX 回调中完成格式检查。

Run: `cd client; node --test electron/services/technicalPlanCheckService.test.cjs`
Expected: FAIL，service 不存在。

- [ ] **Step 2: 实现 service 最小接口**

`selectInput(role)`、`selectOutput()`、`loadState()`、`openReport()`、`prepareDocuments()`；复用 `parseDocumentWithConfig`，新增仅本功能使用的 local-first PDF 编排。

- [ ] **Step 3: 写任务失败测试**

断言十三阶段消息顺序；取消后 worker 终止且不 checkpoint/替换报告；失败保留日志；成功一次性 checkpoint summary/reportPath；重启遗留任务转 error。

Run: `cd client; node --test electron/services/technicalPlanCheckTask.test.cjs`
Expected: FAIL，runner 不存在。

- [ ] **Step 4: 写 taskService 分发失败测试**

Create: `client/electron/services/taskService.technicalPlanCheck.test.cjs`

覆盖初始持久化、checkpoint、组内互斥、`technicalPlanCheckPatch` 实时事件、`technicalPlanCheck` 活动任务回放、`getActiveTasks()`、重启恢复和 `close()` 等待 runner settled。

Run: `cd client; node --test electron/services/taskService.technicalPlanCheck.test.cjs`
Expected: FAIL，未知 `stateKey` 被分发到错误 Store。

- [ ] **Step 5: 实现 task runner 与 taskService 完整分发**

新增 `technical-plan-check` definition：`group: 'technical-plan-check'`、`stateKey: 'technicalPlanCheck'`、`field: 'checkTask'`。修改 `createTaskService` 参数、`buildSnapshot()`、`getSnapshotForTask()`、`updateWorkspaceStateWithoutReload()`、`loadWorkspaceState()`、runner Store 选择、启动恢复状态和 `startTechnicalPlanCheck()`。

实时事件固定携带 `technicalPlanCheckPatch`，活动任务回放固定携带 `technicalPlanCheck`。新增 `taskService.close()`：取消全部 active controls、触发 abort、终止 worker 并等待所有 runner settled；取消完成后不得 checkpoint 或替换报告。

- [ ] **Step 6: 运行 service/taskService 测试**

Run: `cd client; node --test electron/services/technicalPlanCheckService.test.cjs electron/services/technicalPlanCheckTask.test.cjs electron/services/taskService.technicalPlanCheck.test.cjs`
Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add client/electron/services/technicalPlanCheckService* client/electron/services/technicalPlanCheckTask* client/electron/services/taskService.cjs client/electron/services/taskService.technicalPlanCheck.test.cjs
git commit -m "feat: run technical plan checks in background"
```

## Task 6：IPC、preload 与类型闭环

**Skills:** `@superpowers:test-driven-development`

**Files:**
- Create: `client/electron/ipc/technicalPlanCheckIpc.cjs`
- Create: `client/electron/ipc/technicalPlanCheckIpc.test.cjs`
- Modify: `client/electron/ipc/index.cjs`
- Modify: `client/electron/ipc/taskIpc.cjs`
- Modify: `client/electron/ipc/index.workspaceDatabaseChannels.test.cjs`
- Create: `client/electron/ipc/index.technicalPlanCheckLifecycle.test.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/src/shared/types/ipc.ts`
- Create: `client/src/features/technical-plan-check/types.ts`

- [ ] **Step 1: 写 IPC 注册失败测试**

需要通道：`technical-plan-check:load-state`、`:select-input`、`:select-output`、`:open-report` 和 `tasks:start-technical-plan-check`；最后一项注册在现有 `taskIpc.cjs`，全部数据库相关通道进入 pending/unavailable 生命周期。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/ipc/technicalPlanCheckIpc.test.cjs electron/ipc/index.workspaceDatabaseChannels.test.cjs`
Expected: FAIL。

- [ ] **Step 3: 实现 IPC 与装配**

`technicalPlanCheckIpc` 只转发 feature 命令，不创建第二套事件；`taskIpc.cjs` 注册 start 命令。`registerWorkspaceDatabaseServices()` 返回 `taskService`/关闭句柄，外层保存句柄，并在更新重启、GPU 重启和应用退出共用的 `closeServices()` 链路中先 `await taskService.close()`，再关闭 SQLite。

新增 `index.technicalPlanCheckLifecycle.test.cjs`，通过注入假的 taskService/sqlite 句柄验证注册函数确实返回关闭句柄，且 `closeServices()` 调用顺序为 taskService.close → sqlite.close。

- [ ] **Step 4: 更新 preload 和 TypeScript 类型**

```ts
technicalPlanCheck: {
  loadState(): Promise<TechnicalPlanCheckState>;
  selectInput(role: TechnicalPlanCheckFileRole): Promise<TechnicalPlanCheckState>;
  selectOutput(): Promise<TechnicalPlanCheckState>;
  openReport(): Promise<{ success: boolean; message?: string }>;
};
```

`tasks` 增加 `startTechnicalPlanCheck()`；`TaskEvent` 增加 `technicalPlanCheck` 和 `technicalPlanCheckPatch` 字段。Renderer 通过 `hasOwnProperty` 合并 patch，允许 `null`/空字符串显式清理。

- [ ] **Step 5: 运行 IPC 测试与语法检查**

Run: `cd client; node --test electron/ipc/technicalPlanCheckIpc.test.cjs electron/ipc/index.workspaceDatabaseChannels.test.cjs electron/ipc/index.technicalPlanCheckLifecycle.test.cjs; node --check electron/preload.cjs; node --check electron/ipc/index.cjs; node --check electron/ipc/taskIpc.cjs`
Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add client/electron/ipc/technicalPlanCheckIpc* client/electron/ipc/index.cjs client/electron/ipc/taskIpc.cjs client/electron/ipc/index.workspaceDatabaseChannels.test.cjs client/electron/ipc/index.technicalPlanCheckLifecycle.test.cjs client/electron/preload.cjs client/src/shared/types/ipc.ts client/src/features/technical-plan-check/types.ts
git commit -m "feat: expose technical plan check bridge"
```

## Task 7：主菜单与检查页面

**Skills:** `@superpowers:test-driven-development`。开始本任务前使用 `ui-skills-root` 选择并加载 `ibelick/baseline-ui`；项目无 Tailwind，忽略 Tailwind 专属规则，保留现有 primitives、清晰层级、无额外动画、就地错误和可访问控件要求。

**Files:**
- Create: `client/src/features/technical-plan-check/pages/TechnicalPlanCheckPage.tsx`
- Create: `client/src/features/technical-plan-check/state.ts`
- Create: `client/src/features/technical-plan-check/state.test.ts`
- Create: `client/src/features/technical-plan-check/controller.ts`
- Create: `client/src/features/technical-plan-check/controller.test.ts`
- Create: `client/src/styles/feature-technical-plan-check.css`
- Modify: `client/src/shared/types/navigation.ts`
- Modify: `client/src/app/menuConfig.ts`
- Modify: `client/src/app/menuConfig.test.ts`
- Modify: `client/src/app/AppRouter.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/styles.css`
- Modify: `analytics/dashboard/public/src/pages/traffic.js`

- [ ] **Step 1: 扩展菜单测试并确认失败**

断言 `technical-plan-check` 是一级菜单、位于 `existing-plan-expansion` 后、路由中文名存在。

Run: `cd client; node --test src/app/menuConfig.test.ts`
Expected: FAIL（若仓库现有 TS 测试使用不同命令，沿用其现有运行方式）。

- [ ] **Step 2: 注册导航、图标、路由和 Analytics 名称**

Sidebar 使用现有 `BidCheckIcon` 或新增语义明确的文档检查图标，不引入图标库。

- [ ] **Step 3: 实现页面状态恢复**

先写 `state.test.ts`，覆盖 `technicalPlanCheck` 全量回放、`technicalPlanCheckPatch` 局部更新、`hasOwnProperty` 显式清理、运行中禁用输入/重复启动和成功后允许打开报告。

再写 `controller.test.ts`，向 `initializeTechnicalPlanCheckPage()` 注入 fake bridge，明确断言调用顺序为 `loadState → onTaskEvent subscribe → getActiveTasks`，回放事件能够合并，cleanup 会调用 unsubscribe。

Run: `cd client; node --test src/features/technical-plan-check/state.test.ts src/features/technical-plan-check/controller.test.ts`
Expected: FAIL，state/controller helper 不存在。

实现纯 `mergeTechnicalPlanCheckState()`、`getTechnicalPlanCheckActions()` 和可注入的 `initializeTechnicalPlanCheckPage()` 后再接页面。卸载只调用 controller 返回的 cleanup。

- [ ] **Step 4: 按原型实现 UI**

使用 `UploadBoard`/`UploadRow`/`UploadFilePill`、`ProgressBar`、`FloatingToolbar`、`useToast` 和 `useDocumentParseNotice`。四行输入、输出路径、“开始检查”“打开检查记录”和内部滚动日志必须齐全。所有按钮有明确 disabled 原因或 tooltip，图标按钮提供 `aria-label`，不新增动画或渐变。

- [ ] **Step 5: 实现 feature CSS**

根容器 `height: 100%; min-height: 0;`；内容列和日志区域用 grid/flex 的 `min-height: 0`；文件名省略但可通过 title 查看；窄宽度下操作按钮换行。

- [ ] **Step 6: 运行菜单测试和 build**

Run: `cd client; node --test src/app/menuConfig.test.ts src/features/technical-plan-check/state.test.ts src/features/technical-plan-check/controller.test.ts; npm run build; node --check ..\analytics\dashboard\public\src\pages\traffic.js`
Expected: PASS，仅允许既有 chunk warning。

- [ ] **Step 7: 提交**

```powershell
git add client/src/features/technical-plan-check client/src/styles/feature-technical-plan-check.css client/src/shared/types/navigation.ts client/src/app/menuConfig.ts client/src/app/menuConfig.test.ts client/src/app/AppRouter.tsx client/src/components/Sidebar.tsx client/src/styles.css analytics/dashboard/public/src/pages/traffic.js
git commit -m "feat: add technical plan check page"
```

## Task 8：Golden fixture 与端到端验证

**Skills:** `@superpowers:verification-before-completion`、`@requesting-code-review`

**Files:**
- Modify/Add: `client/electron/services/technicalPlanCheck*.test.cjs`
- Add only if small and redistributable: `client/electron/services/fixtures/technical-plan-check/*`

- [ ] **Step 1: 用 `bid-Check/测试文件` 生成基线 JSON**

不把外部样例 DOCX 复制进仓库；提交不含原文的 expected JSON。专用 golden 测试必须读取 `BID_CHECK_FIXTURE_DIR` 下四份固定文件，变量或文件缺失时 FAIL，不允许 skip。

- [ ] **Step 2: 运行全部定向测试**

Run:

```powershell
cd client
node --test `
  electron/services/technicalPlanCheckStore.test.cjs `
  electron/services/technicalPlanCheckDocumentAdapter.test.cjs `
  electron/services/technicalPlanCheckRules.test.cjs `
  electron/services/technicalPlanFormatChecks.test.cjs `
  electron/services/technicalPlanCheckWorker.test.cjs `
  electron/services/technicalPlanCheckReport.test.cjs `
  electron/services/technicalPlanCheckService.test.cjs `
  electron/services/technicalPlanCheckTask.test.cjs `
  electron/services/taskService.technicalPlanCheck.test.cjs `
  electron/services/sqliteDatabase.technicalPlanCheckMigration.test.cjs `
  electron/ipc/technicalPlanCheckIpc.test.cjs `
  electron/ipc/index.workspaceDatabaseChannels.test.cjs `
  electron/ipc/index.technicalPlanCheckLifecycle.test.cjs `
  src/app/menuConfig.test.ts `
  src/features/technical-plan-check/state.test.ts `
  src/features/technical-plan-check/controller.test.ts
```

Expected: PASS。

- [ ] **Step 3: 运行外部样例 golden 测试**

Run:

```powershell
cd client
$env:BID_CHECK_FIXTURE_DIR='D:\2026AI\project\bid-Check\测试文件'
node --test electron/services/technicalPlanCheckGolden.test.cjs
```

Expected: 四份文件全部读取，十三阶段、rule IDs、上下文摘要与汇总完全匹配；缺文件必须 FAIL。

- [ ] **Step 4: 运行 CJS 语法检查**

Run:

```powershell
cd client
$files = @(
  (Get-ChildItem electron/services/technicalPlanCheck*.cjs).FullName
  'electron/services/sqliteDatabase.cjs'
  'electron/services/taskService.cjs'
  'electron/ipc/technicalPlanCheckIpc.cjs'
  'electron/ipc/index.cjs'
  'electron/ipc/taskIpc.cjs'
  'electron/preload.cjs'
)
$files | ForEach-Object { node --check $_; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
node --check ..\analytics\dashboard\public\src\pages\traffic.js
```
Expected: 全部退出 0。

- [ ] **Step 5: 运行 native smoke 与完整构建**

Run: `cd client; npm run smoke:electron-native; npm run build`
Expected: PASS；chunk 体积 warning 可接受。

- [ ] **Step 6: 手动 Electron 验证**

Run: `cd client; npm run dev`

检查：中文路径四文件选择、文本 PDF、本地缺文字层提示/MinerU 回退、DOC/WPS 转换提示、另存为、任务离页继续、返回恢复日志、报告打开、重复运行、窗口窄宽布局；检查运行中退出应用时进程正常结束，重新启动后任务为 error、日志保留且目标报告未被替换。

- [ ] **Step 7: 最终 diff 与代码审查**

确认不包含原工作区 `client/package.json`/`client/package-lock.json` 改动；确认无 EXE/Python/OCR 依赖、无删除 Analytics 能力、无非本功能重构。

- [ ] **Step 8: 提交验证修正**

```powershell
git add <仅本轮验证修正文件>
git commit -m "test: verify technical plan check workflow"
```
