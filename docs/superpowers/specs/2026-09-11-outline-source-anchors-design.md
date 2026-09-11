# 目录关联原文精确定位设计

## 目标

目录生成完成后，用户点击目录项时，只标注能够由当前招标 Markdown 确定性验证的原文位置。重复文本、分析改写文本或文档版本变化不得静默定位到错误位置。

## 范围

- P0：移除目录标题、描述和短关键词的泛化高亮；重复来源不再默认选择第一次出现；未验证来源显示明确状态。
- P1：为目录评分覆盖映射增加宿主计算的原文锚点，锚点绑定招标 Markdown 哈希并记录精确字符区间；Renderer 优先消费锚点。
- 保持目录生成、目录编辑、正文生成、Analytics 和既有 SQLite 表结构不变。
- 关联对象仍是当前评分覆盖记录中的招标要求、评分标准和响应要点；专业补充与用户补充不伪造招标原文锚点。

## 数据契约

`ScoreCoverageMap` 升级到版本 2。每条非补充来源可包含一个 `source_anchor`：

```ts
interface ScoreSourceAnchor {
  document_hash: string;
  block_id: string;
  match_start: number;
  match_end: number;
  context_start: number;
  context_end: number;
  match_method: 'exact' | 'normalized-whitespace';
}
```

锚点只由 Electron Main 根据 `tender.md` 计算。只有来源文本在规范化前或空白规范化后唯一命中时才生成锚点；零命中和多命中都保留为未定位。`document_hash` 与当前 Markdown 不一致时，Renderer 必须忽略锚点并重新走保守定位。

历史 v1 覆盖映射无需迁移数据库；Renderer 仅对唯一匹配进行临时定位，重复或未命中保持未定位。目录排序、编辑和删除沿用现有 Store 映射规则并保留锚点字段。

## 数据流

1. 目录 Agent 继续生成现有覆盖映射，避免扩大 Agent 输出协议和 Prompt 成本。
2. 目录最终审核通过后，Main 以权威评分清单校正 `source_kind/source_text`，读取当前 `tender.md`，为每条记录计算唯一锚点并写入最终任务 `stats.score_coverage_map`。
3. AI 调整目录后，Main 使用调整前权威来源文本重新校正记录并重新计算锚点，防止 Agent 改写来源或锚点。
4. Renderer 校验文档哈希和区间内容后使用持久锚点；历史数据调用相同的唯一匹配算法但不接受多命中。

## 界面行为

- 已定位：在已验证的 `match_start/match_end` 两端注入内部 DOM 标记，只标注该区间内渲染出的文本，不再从目录标题或描述提取关键词。
- 未定位：展示保存的来源文本及“未能在当前招标原文中唯一定位”提示，不自动滚动。
- 全屏：只有当前目录存在已验证锚点时才滚动到对应的唯一 DOM 标记；不再滚动到全文第一个通用关键词。
- 父级目录仍按现有直属优先、无直属时聚合后代的规则展示，本次不改变覆盖语义。

## 验收

- 唯一精确匹配和唯一空白规范化匹配产生锚点。
- 重复、缺失、空文本以及文档哈希变化均不得产生错误定位。
- 当前真实样本不再把 17 条重复来源定位到第一次出现；10 条无原文唯一匹配的来源明确显示未定位。
- 定向 Main/Renderer 测试、`node --check`、Electron native smoke 和客户端构建通过。
