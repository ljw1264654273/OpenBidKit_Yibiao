export type MandatoryBidContentRuleId =
  | 'heading-terminal-punctuation'
  | 'schedule-deadline'
  | 'bold-lead-in-colon'
  | 'parallel-section-numbering';

export interface MandatoryBidContentRule {
  id: MandatoryBidContentRuleId;
  title: string;
  description: string;
  example: string;
  mandatory: true;
}

export const MANDATORY_BID_CONTENT_RULES: readonly MandatoryBidContentRule[] = [
  {
    id: 'heading-terminal-punctuation',
    title: '正式章节标题不带结尾标点',
    description: '目录标题及各级正式章节标题末尾不使用句号、冒号、逗号、分号等标点。',
    example: '总体进度安排',
    mandatory: true,
  },
  {
    id: 'schedule-deadline',
    title: '进度计划不得超出招标期限',
    description: '计划可压缩、交叉或并行推进，但全部工作、验收和成果交付必须在招标要求期限内完成。',
    example: '未给定绝对日期时，使用“合同签订后第 X 天”',
    mandatory: true,
  },
  {
    id: 'bold-lead-in-colon',
    title: '加粗引导标题使用中文冒号',
    description: '正文段首的加粗引导标题与正文同一行时，标题末尾使用中文冒号，并将冒号一并加粗。',
    example: '**进度例会与日常调度：** 项目组建立……',
    mandatory: true,
  },
  {
    id: 'parallel-section-numbering',
    title: '并列分项标题使用连续数字序号',
    description: '同一章节存在两个及以上并列论述分项时，按出现顺序使用连续阿拉伯数字序号。',
    example: '1. 建议提出思路　2. 遴选基本原则',
    mandatory: true,
  },
] as const;
