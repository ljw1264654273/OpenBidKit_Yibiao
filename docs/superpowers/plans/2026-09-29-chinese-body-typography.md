# 中文正文层级与 Word 排版规范化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理中文正文异常空格和软换行，并移除正文层级编号后的制表符。

**Architecture:** 新增一个只处理 Markdown 普通正文的纯函数工具，由正文保存和非可行性报告 Word 导出共同复用。编号间距在 `exportService.cjs` 的原生 Word 编号配置中处理；标点避头通过清除标点前的空白和同一中文段落内的软换行实现。

**Tech Stack:** Node.js CommonJS、docx 9.6、Node built-in test runner、React TypeScript。

---

### Task 1: 中文正文空格规范化

**Files:**
- Create: `client/electron/utils/chineseTypography.cjs`
- Create: `client/electron/utils/chineseTypography.test.cjs`
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Modify: `client/electron/services/contentGenerationTask.punctuation.test.cjs`

- [ ] 写入失败测试，覆盖中文间空格、标点前空格、全角空格、加粗小标题后空格、标点前软换行，以及英文、数字、行内代码、链接目标、HTML 标签和属性、代码块、表格、图片和 Markdown 双空格硬换行保持不变。
- [ ] 运行 `cd client; node --test electron/utils/chineseTypography.test.cjs`，确认因工具不存在而失败。
- [ ] 实现 fenced-code-aware 的幂等规范化函数。
- [ ] 在 `normalizeLeafContentForSave()` 的既有 Markdown/层级规范化之后调用该工具。
- [ ] 更新正文生成提示词，明确 Markdown 列表仍使用合法的 `1. 标题` 语法，而加粗中文小标题后不写真实空格。
- [ ] 运行工具测试与 `contentGenerationTask.punctuation.test.cjs`，确认通过。

### Task 2: Word 正文编号无间距与历史正文兜底

**Files:**
- Modify: `client/electron/services/exportService.cjs`
- Modify: `client/electron/services/exportService.bodyOutline.test.cjs`
- Modify: `client/src/shared/types/exportFormat.ts`

- [ ] 写入失败测试，断言四级有序编号的 `<w:suff w:val="nothing"/>`、三级编号为全角 `．`、无序列表仍使用 tab，并断言导出的中文小标题与正文之间不存在空格文本节点。
- [ ] 运行 `cd client; node --test electron/services/exportService.bodyOutline.test.cjs`，确认现有 `tab` suffix 导致失败。
- [ ] 将正文有序列表编号 suffix 改为 `LevelSuffix.NOTHING`，无序列表继续使用 `LevelSuffix.TAB`。
- [ ] 将共享 `decimal-dot` 样式的 Word 编号字符和用户可见标签改为全角句点 `．`；这是面向中文文档的全局样式语义调整，可行性报告显式选用该样式时也同步生效。
- [ ] 在 `markdownToDocxBlocks()` 进入 Markdown 解析前按导出上下文调用中文正文规范化，为技术方案和标书项目历史正文兜底；可行性报告保持现状。
- [ ] 保持段落缩进和四级编号字体/样式不变。
- [ ] 运行定向测试确认通过。

### Task 3: 用户可见规则同步

**Files:**
- Modify: `client/src/features/export-format/mandatoryBidContentRules.ts`
- Modify: `client/src/features/export-format/mandatoryBidContentRules.test.cjs`

- [ ] 写入失败测试，断言规则说明包含四级默认编号、Word 编号后无间距、中文标点前无空白，并保留“同级并列分项连续编号”规则。
- [ ] 保留现有 `parallel-section-numbering`，新增正文层级和中文空格两条规则；总规则数从四条调整为六条。
- [ ] 运行规则测试确认通过。

### Task 4: 完整验证

**Files:** None.

- [ ] 运行 `cd client; node --check electron/utils/chineseTypography.cjs`。
- [ ] 运行 `cd client; node --check electron/services/contentGenerationTask.cjs`。
- [ ] 运行 `cd client; node --check electron/services/exportService.cjs`。
- [ ] 运行全部相关定向测试。
- [ ] 运行 `cd client; npm run build`。
- [ ] 运行 `cd client; npm run dev`，导出一份包含窄行宽、两端对齐、右引号、右括号和四级正文编号的技术方案 Word，打开后检查视觉结果。
- [ ] 运行 `git diff --check`，确认无空白错误。
- [ ] 检查 `git diff`，确认未修改用户已有的 `client/package.json` 和 `client/package-lock.json` 变更。
