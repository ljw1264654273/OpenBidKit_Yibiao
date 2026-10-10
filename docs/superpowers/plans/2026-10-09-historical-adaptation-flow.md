# 历史标书适配流程实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 解耦正文迁移与一致性检查，使第五步只迁移，第六步检查可选且未检查也能导出 Word。

**Architecture:** Main 任务服务不再根据正文 runner 返回值自动创建检查任务；Store 将一致性快照从阶段确认和导出硬门槛中移除，但保留迁移任务和正文状态等流程性校验。Renderer 在第五步移除检查操作区，在第六步集中展示可选检查，并在导出前统一风险确认。

**Tech Stack:** Electron CommonJS services/stores, React TypeScript renderer, node:test, Vite/TypeScript build.

---

### Task 1: 固化“不自动检查”的回归测试

**Files:**
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs`
- Modify: `client/electron/services/historicalAdaptationContentTask.test.cjs`

- [ ] 增加测试：正文 runner 返回 `needsConsistencyCheck: true` 后，任务完成且 `contentCheck` runner 调用次数仍为 0。
- [ ] 运行定向测试确认新测试失败（当前自动调度会触发检查）。

### Task 2: 移除正文完成后的自动检查调度

**Files:**
- Modify: `client/electron/services/taskService.cjs:1278-1333`
- Modify: `client/electron/services/taskService.historicalAdaptation.test.cjs`

- [ ] 删除 `scheduleHistoricalContentCheck` 的计算、microtask 调度和相关日志。
- [ ] 清理只服务于自动检查的 runner 返回值依赖，保留检查任务显式启动接口。
- [ ] 更新旧的自动复核测试为“迁移完成不启动检查”。
- [ ] 运行 task service 定向测试。

### Task 3: 放宽第五步确认但保留流程性阻断

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs:4326-4370`
- Modify: `client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`

- [ ] 将阶段确认 readiness 改为只判断迁移章节状态、活动任务和其他确定性正文问题；一致性检查未运行、过期或 finding 阻断不再让 readiness 失败。
- [ ] 保留 readiness 返回检查状态和 findings，供 Renderer 提示用户。
- [ ] 增加测试：无检查结果、检查过期、检查存在阻断时均可确认第五步。
- [ ] 运行 Store 定向测试。

### Task 4: 集中第六步一致性检查并允许无检查导出

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`（导出/终审前置校验）
- Modify: `client/electron/services/technicalPlanStore.historicalAdaptationContent.test.cjs`
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx`
- Modify: `client/src/features/historical-bid-adaptation/components/AdaptationReviewExportPage.tsx`

- [ ] 从第五步移除一致性检查操作区与检查状态造成的迁移进度/确认阻断表达，保留必要的迁移信息。
- [ ] 第六步展示同一份检查结果并保留手动运行按钮，但不要求结果存在、最新或无阻断。
- [ ] 导出前根据“未检查/过期/存在阻断”打开提示弹窗；用户确认后调用现有导出流程。
- [ ] 无检查结果时直接导出仍可成功；真实迁移未确认、任务运行等硬阻断保持不变。
- [ ] 增加/更新 Renderer 静态测试覆盖按钮、弹窗和无检查导出文案。

### Task 5: 验证与收尾

**Files:**
- Test: changed files above

- [ ] 运行 `node --test` 相关 task service、Store、历史适配页面测试。
- [ ] 对修改的 `.cjs` 执行 `node --check`。
- [ ] 运行 `cd client; npm run build`。
- [ ] 检查 `git diff`，确认没有修改用户已有的无关文件；不关闭客户端，向用户报告验证结果。
