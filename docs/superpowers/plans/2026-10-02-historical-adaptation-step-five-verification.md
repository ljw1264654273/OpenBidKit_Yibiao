# 环节五修复验证与验收交接

## 产品实现

完成结构化差异 v2、精确旧值关联、路径感知来源索引、不可变来源档案、确定性局部编辑、SQLite v44 逐章持久化、增量 checkpoint/事件、一键建立并执行、受限重试、确定性检查优先及统一 readiness。

第五步对比基于实际迁移来源，原文删除/替换浅红、结果新增/替换浅绿；无变化不高亮。保持 Markdown 表格、图片、代码与 Mermaid 的渲染。恢复默认不覆盖人工正文，覆盖人工正文须明确确认。

复审修复两项来源边界：人工覆盖失败/取消时仍保留旧正文实际来源，成功时正文与新来源原子切换；损坏来源索引在冷/暖缓存下返回 source-stale 阻断，只读检查不修复业务档案。布局按内容容器宽度折叠，避免中等窗口裁切。

## 工程验证

2026-10-02 在主目录 client 执行：

- 完整关联测试：212/212，通过。包括所有 historicalAdaptation/historicalSource 测试、SQLite 历史适配迁移测试、全部 technicalPlanStore 和 taskService 定向测试、IPC 生命周期、Renderer 对比/patch/UI 契约、差异批量确认和真实项目验证脚本反例。
- 39 个修改或新增 CJS 的 node --check：通过。
- npm run smoke:electron-native：通过，Electron 41.10.2、Node 24.18.0、ABI 145，better-sqlite3 可加载并查询。
- npm run build：通过，tsc --noEmit 与 Vite 构建退出 0；仅有既有 chunk 体积警告。
- historical_adaptation_ui_check.py：通过，桌面、760px 窄屏及 780/900/1000/1100px 中等窗口；已检查截图。
- git diff --check：通过。

UI 脚本使用隔离的 window.yibiao 测试夹具验证流程，不代表真实项目已经调用 AI 完成恢复。性能夹具验证全文只解析一次、单章 payload 小于 64 KiB、实际 Renderer patch 合并函数 P95 不超过 16ms；不声称已进行生产环境整机基准测试。

独立复审：运行时规格与质量通过，关联 126/126 测试；验证脚本复审通过，1/1 测试；第五步 UI 规格与质量通过。复审发现的 Important 问题已修复。

收尾运行发现任务重复订阅会累积窗口销毁监听器；新增回归先复现 12 次订阅注册 12 个监听器，再修复为仅注册一次，同时保留每次回放与销毁后取消推送。最终完整回归覆盖此修复。客户端正常退出后重启加载最终代码，日志保留在备份目录的 dev-final-stdout.log / dev-final-stderr.log。

## 真实项目升级

项目：横泾街道房地一体农村不动产登记服务-发布稿。

项目 ID：dace08dc-a85f-46a2-95bd-a9c97b7d82a8。

数据库：C:/Users/admin/AppData/Roaming/yibiao-client/workspace/yibiao.sqlite。

客户端正常退出后重新 npm run dev；启动日志无错误，主窗口标题为园测 投标工具箱，http://127.0.0.1:5173/ 返回 200。

已验证 v43→v44，SQLite quick_check=ok。升级前后全部 132 个目录节点及正文记录完全一致，100 个正文叶子的旧迁移项标记 stale；14 条旧差异恢复 pending，不兼容阶段确认失效。升级没有执行新正文迁移。

独立一致性备份、基线及报告保留在：

`C:/Users/admin/AppData/Local/Temp/yibiao-historical-acceptance-56c6ad6b-b7b1-46fa-930b-303ab33cb820/`

其中 workspace-before-v44.sqlite 为 VACUUM INTO 生成的一致性备份，不依赖启动成功后会被清除的自动备份。before.json、after-schema-upgrade.json、recovery-not-yet-accepted.json 分别记录升级前、升级后和未恢复项目的严格验收失败结果。

当前仍有 8 个正文叶子包含五峰村，新来源定位识别 6 个含五峰村来源叶子；1 个旧 stale 推荐与当前规则预期不一致。原始正文保持不变，不能把这些数值当成已恢复结果。

## 用户验收

1. 第三步核对 14 条待确认差异的完整旧值、新值、正文动作及影响范围，不从自然语言备注猜映射。
2. 确认目录适配，再进入第五步点击建立/更新迁移方案。检查方式分布、红绿对比、人工正文保护、失败重试。
3. 完成正文并通过一致性检查后统一确认第五步。
4. 再运行只读项目验证脚本，使用 before.json 基线及一个尚不存在的输出文件。必须旧地点残留为零、无通用短语误匹配、正文非空且全部成功、人工正文哈希不变，才可把 Task 11 Step 3 标记完成。

本轮仅本地提交，未推送、未打标签、未发布。
