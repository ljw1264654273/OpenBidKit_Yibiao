# 第五步正文预览字体一致性设计

## 背景

第五步“正文生成”页面的正文预览中，普通正文与编号列表中的部分文字粗细不一致，部分加粗引导语在中文字体下显得过重。用户截图显示，正文阅读区域需要保持统一的正文字体体系，同时继续保留 Markdown 的加粗语义。

本次范围限定为第五步页面内的正文预览：

- 包括普通查看、编辑后预览和全屏预览。
- 不修改 SQLite 中保存的 Markdown 正文。
- 不修改正文生成 Prompt。
- 不修改 Word 导出链路及 Word 文件的实际样式。
- 不修改标题、表格、图片和其他功能页面的共享视觉规则，除非共享选择器会直接影响本预览且能以限定作用域修复。

## 当前链路与问题判断

第五步页面在 `ContentEditPage.tsx` 中使用：

1. `MarkdownContent` 调用共享 `MarkdownRenderer` 将 Markdown 转换为 React 节点。
2. 查看、编辑预览和全屏预览均使用 `markdown-viewer content-generation-output export-format-preview`。
3. `buildExportFormatCssVars(exportFormat)` 将导出格式配置写入预览容器的 CSS 自定义属性。
4. `shared-markdown.css` 根据正文层级为段落、列表和有序列表编号设置字体、字号和行高。

当前有序列表的各层级字体设置在列表容器和编号伪元素上，但正文中的 `<strong>/<b>` 没有在正文预览作用域内明确声明字体、字号和字重。浏览器默认的 `font-weight: bolder` 可能在中文字体上触发较重的合成粗体；当加粗文本位于有序列表层级中时，列表层级字体和默认粗体行为叠加，造成截图中“部分字体突然变粗”的观感。

该判断需要通过回归样式断言和本地浏览器截图验证，不以截图单独作为根因证明。

## 设计

### 1. 预览 typography 统一规则

在 `.markdown-viewer.export-format-preview` 作用域内：

- 普通段落显式使用 `--ef-body-font`、`--ef-body-size`、`--ef-body-line-height`。
- 无序列表和列表项显式继承正文的字体、字号和行高。
- 有序列表及其嵌套层级继续使用现有 `--ef-body-outline-N-*` 字体和字号。
- 有序列表项显式继承对应列表层级的字体和字号，避免子节点回退到浏览器默认值。
- 不改变现有对齐、缩进、间距、编号样式和 Markdown 语义。

### 2. 加粗文本规则

在同一预览作用域内为 `strong` 和 `b` 添加显式规则：

- 使用所在正文容器的 `font-family` 和 `font-size`，不单独切换字体或字号。
- 使用固定的中等强调字重，不使用浏览器相对值 `bolder`。
- 允许标题和图片说明继续使用其自身规则；正文预览中的图片说明已经有独立的 `font-weight: inherit` 规则，不覆盖该行为。
- 不把所有正文改为粗体，也不删除 Markdown 中的 `**` 标记。

推荐使用 `font-weight: 600` 作为强调字重，若当前平台或字体没有对应字重，浏览器会选择最近可用字重，视觉上会比默认 `700/bolder` 更稳定。

### 3. 作用域

优先修改 `client/src/styles/shared-markdown.css` 中已有的 `export-format-preview` 规则，因为第五步预览与导出格式预览共享这套纸面样式。所有新增选择器必须挂在 `.markdown-viewer.export-format-preview` 下，避免影响非导出格式的 Markdown 阅读器。

若浏览器验证发现共享预览页面需要不同的交互样式，只允许在 `client/src/styles/feature-technical-plan.css` 的 `.content-generation-output` 作用域内补充，不复制一整套 Markdown 排版规则。

## 验证

### 自动化验证

在现有 `client/src/features/technical-plan/services/workflowLayout.test.ts` 中增加源码级回归断言，确保：

- 第五步预览仍使用 `export-format-preview`。
- 预览样式显式声明正文和列表 typography。
- `strong/b` 在正文预览作用域内使用固定字重并继承正文字体/字号。
- 图片说明的独立字重规则仍然存在。

按仓库约定执行：

```powershell
cd client
npm run build
```

### 视觉验证

启动客户端开发环境，在第五步正文预览中检查以下内容：

1. 普通段落与列表正文的字体、字号和笔画粗细一致。
2. `**引导语：**` 仍然可辨识，但不会比截图中的现状明显厚重。
3. 一级到至少四级有序列表的正文和编号均使用对应层级样式。
4. 查看模式、编辑后预览和全屏预览保持一致。
5. 普通段落、表格、图片说明和非第五步 Markdown 页面没有明显回归。

## 不在本次范围

- 不调整默认导出格式配置。
- 不改 `exportService.cjs`。
- 不改变生成内容格式协议或 Prompt。
- 不清理历史正文中的 Markdown 标记。
- 不将正文中的所有强调文本强制还原为普通字重。
