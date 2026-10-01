# 正文推荐迁移与修改对比

用户已确认：建立/更新方案后直接按推荐方式迁移，历史正文中替换或删除内容浅红色，迁移正文中修改或新增内容浅绿色，未修改内容和排版保持原样。保留人工正文、人工扩缩写和阶段统一确认，一致性检查继续作为确认门禁。

实现使用现有 Main 后台任务及 SQLite 存储，Renderer 顺序建立方案并启动任务，不新增业务状态副本。已应用的人工策略保留；未保存正文和未应用策略阻止批量操作。合并按钮保留“建立/更新迁移方案”名称，移除独立批量按钮。启动失败允许从同一入口重试。

对比按 Markdown 渲染后的文字计算精确位置范围，在 MarkdownRenderer 文本节点中插入临时 mark，不把标记写回正文或 Word。使用分行再逐字的有界 Myers 对比，保持 HTML/GFM 表格和合并单元格。完整历史来源沿用 source_excerpt 字段，取消 5,000 字截断。默认对比视图，人工编辑仍可切换。

- [x] 新增文字差异测试：中文替换、多处修改、重复文字、增删、emoji、长章节。
- [x] 为历史来源超过 5,000 字新增回归测试，并验证失败。
- [x] 实现 feature 对比工具及 shared Markdown 文本范围高亮，保持 allowRawHtml=false。
- [x] 合并建立方案与后台启动，移除批量按钮，增加忙碌及草稿保护，默认对比和颜色图例。
- [x] 更新浏览器回归，验证单次操作、失败重试、两侧精确高亮、表格不变、人工保存和重置。
- [x] 运行定向 Node 测试、Main 语法检查、native smoke、生产构建和浏览器回归，检查桌面/窄屏截图。

验证结果（2026-10-01）：

- 浏览器回归 `historical_adaptation_ui_check.py` 通过；桌面及窄屏截图已生成并检查。
- 定向 Node 测试 46/46 通过，`node --check electron/services/historicalAdaptationContentTask.cjs` 通过。
- `npm run smoke:electron-native` 与 `npm run build` 通过；构建仅保留既有 chunk 体积警告。
- `git diff --check -- . ':(exclude)client/package-lock.json'` 通过；未改动已有 package-lock 冲突。

不改已有 package-lock 冲突，不提交、打包或发布。
