const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');

const {
  OUTLINE_JSON_SCHEMA,
  createInitialPrompt,
  createScorePlanningPrompt,
  createChildrenPrompt,
  createLeafAdjustmentPrompt,
  createOutlineReviewPrompt,
  enforceMinimumLeafTarget,
  deriveAcceptableLeafRange,
  deriveSemanticMinimumLeafTarget,
  buildOutlineReviewContext,
  buildRemoteKnowledgeFile,
  mergeReviewedScoreDirectoryPlan,
  deriveTechnicalScoreHierarchy,
  normalizeOutlineScoreMetadataTitles,
  normalizeScoreDirectoryPlanTitles,
  assertStandaloneTechnicalRoots,
  assertStandaloneScoreDirectoryPlan,
  runOutlineGenerationTaskV2,
} = require('./outlineGenerationTaskV2.cjs');

test('海盐式合并单元格业务分组按原文层级生成一级目录', () => {
  const groupNames = [
    '项目总体方案',
    '组织实施方案',
    '人员配置情况',
    '设施设备配备情况',
    '应急预案及保障措施方案',
    '服务承诺',
    '安全管理措施',
    '保密措施',
  ];
  const itemCounts = [3, 7, 4, 1, 1, 1, 1, 1];
  const markdown = ['## 技术评分项'];
  let itemNumber = 0;
  groupNames.forEach((group, groupIndex) => {
    for (let index = 0; index < itemCounts[groupIndex]; index += 1) {
      itemNumber += 1;
      markdown.push(`\n【评分项编号】：${itemNumber}`);
      markdown.push(`【评分项名称】：${itemCounts[groupIndex] > 1 ? `评分项${itemNumber}` : group}`);
      markdown.push(`【直接上级编号】：${itemCounts[groupIndex] > 1 ? groupIndex + 3 : '无'}`);
      markdown.push(`【直接上级名称】：${itemCounts[groupIndex] > 1 ? group : '无'}`);
      markdown.push(`【直接上级类型】：${itemCounts[groupIndex] > 1 ? '业务分组' : '无'}`);
      markdown.push(`【层级依据类型】：${itemCounts[groupIndex] > 1 ? '合并单元格' : '无'}`);
      markdown.push(`【层级依据说明】：${itemCounts[groupIndex] > 1 ? `评分表 rowspan=${itemCounts[groupIndex]}` : '无'}`);
      markdown.push('【权重/分值】：1分');
    }
  });
  markdown.push('\n## 技术评分要求\n没有提及');

  const hierarchy = deriveTechnicalScoreHierarchy(markdown.join('\n'));

  assert.equal(hierarchy.items.length, 19);
  assert.deepEqual(hierarchy.rootTitles, groupNames);
  assert.deepEqual(hierarchy.items.slice(0, 3).map((item) => item.sourceNumber), ['1', '2', '3']);
  assert.equal(hierarchy.items[14].title, '设施设备配备情况');
  assert.equal(hierarchy.items[14].parentGroup, null);
});

test('评分项和业务分组标题去掉末尾主客观分标记但保留业务括注', () => {
  const markdown = `## 技术评分项

【评分项编号】：1
【评分项名称】：人员配置情况（客观分）
【直接上级编号】：无
【直接上级名称】：无
【直接上级类型】：无
【层级依据类型】：无
【层级依据说明】：无

【评分项编号】：2.1
【评分项名称】：项目人员（主观评分）
【直接上级编号】：2
【直接上级名称】：组织实施方案（客观分）
【直接上级类型】：业务分组
【层级依据类型】：合并单元格
【层级依据说明】：评分表 rowspan=2

【评分项编号】：3
【评分项名称】：监理大纲（暗标）
【直接上级编号】：无
【直接上级名称】：无
【直接上级类型】：无
【层级依据类型】：无
【层级依据说明】：无`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.items.map((item) => item.title), [
    '人员配置情况',
    '项目人员',
    '监理大纲（暗标）',
  ]);
  assert.equal(hierarchy.items[1].parentGroup, '组织实施方案');
  assert.deepEqual(hierarchy.rootTitles, ['人员配置情况', '组织实施方案', '监理大纲（暗标）']);

  assert.deepEqual(normalizeOutlineScoreMetadataTitles([
    { id: '1', title: '人员配置情况（客观分）', children: [{ id: '1.1', title: '项目人员（主观分）' }] },
    { id: '2', title: '监理大纲（暗标）' },
  ]), [
    { id: '1', title: '人员配置情况', children: [{ id: '1.1', title: '项目人员' }] },
    { id: '2', title: '监理大纲（暗标）' },
  ]);

  assert.deepEqual(normalizeScoreDirectoryPlanTitles({
    allow_root_changes: false,
    branches: [{
      branch_id: 'B1',
      root_id: '1',
      root_title: '人员配置情况（客观分）',
      score_item_level: 1,
      mappings: [{ requirement_id: 'R1', target_title: '人员配置情况（客观分）' }],
    }],
    extra_titles: [{ branch_id: 'B1', title: '监理大纲（暗标）', reason: '用户批准' }],
  }), {
    allow_root_changes: false,
    branches: [{
      branch_id: 'B1',
      root_id: '1',
      root_title: '人员配置情况',
      score_item_level: 1,
      mappings: [{ requirement_id: 'R1', target_title: '人员配置情况' }],
    }],
    extra_titles: [{ branch_id: 'B1', title: '监理大纲（暗标）', reason: '用户批准' }],
  });
});

test('钦南式评分维度下的技术评分项分别作为一级目录', () => {
  const itemTitles = [
    '项目理解方案',
    '项目实施方案',
    '项目进度计划和保证措施',
    '质量保障措施',
    '安全、保密保证措施',
    '售后服务方案',
  ];
  const markdown = `## 技术评分项\n\n${itemTitles.map((title, index) => `【评分项编号】：2.${index + 1}\n【评分项名称】：${title}\n【直接上级编号】：2\n【直接上级名称】：技术分\n【直接上级类型】：评分维度/汇总容器\n【层级依据类型】：汇总行\n【层级依据说明】：编号层级且父级为汇总分值行\n【权重/分值】：5分`).join('\n\n')}\n\n## 技术评分要求\n没有提及`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.rootTitles, itemTitles);
  assert.ok(hierarchy.items.every((item) => item.parentGroup === null));
  assert.deepEqual(hierarchy.items.map((item) => item.sourceNumber), ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6']);
  assert.deepEqual(hierarchy.items.map((item) => item.parentNumber), ['2', '2', '2', '2', '2', '2']);
  assert.throws(
    () => assertStandaloneTechnicalRoots([
      { title: '项目总体方案' },
      { title: '权属调查与审核公示方案' },
      { title: '数据标准化与建库方案' },
      { title: '履约保障方案' },
    ], hierarchy),
    /必须严格对应原有评分层级.*期望 6 个.*实际 4 个/,
  );
});

test('评分维度标题任意变化时仍按结构类型识别为容器', () => {
  const markdown = `## 技术评分项

【评分项编号】：7.1
【评分项名称】：需求理解
【直接上级编号】：7
【直接上级名称】：主观评分汇总区
【直接上级类型】：评分维度/汇总容器
【层级依据类型】：汇总行
【层级依据说明】：编号层级且父级为汇总分值行

【评分项编号】：7.2
【评分项名称】：实施路径
【直接上级编号】：7
【直接上级名称】：主观评分汇总区
【直接上级类型】：评分维度/汇总容器
【层级依据类型】：汇总行
【层级依据说明】：编号层级且父级为汇总分值行`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.rootTitles, ['需求理解', '实施路径']);
  assert.ok(hierarchy.items.every((item) => item.parentType === 'score-container'));
});

test('旧数据仅有上级评分分组名称时安全回退为独立评分项', () => {
  const markdown = `## 技术评分项

【评分项名称】：项目理解方案
【上级评分分组】：技术分

【评分项名称】：项目实施方案
【上级评分分组】：技术分`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.rootTitles, ['项目理解方案', '项目实施方案']);
  assert.ok(hierarchy.items.every((item) => item.parentGroup === null));
});

test('部分评分项缺少编号字段时仍逐项解析且不串用相邻编号', () => {
  const markdown = `## 技术评分项

【评分项编号】：2.1
【评分项名称】：需求理解
【直接上级编号】：2
【直接上级名称】：技术分
【直接上级类型】：评分维度/汇总容器
【层级依据类型】：编号层级
【层级依据说明】：2 与 2.1 的编号关系

【评分项名称】：实施方案
【直接上级名称】：无
【直接上级类型】：无
【层级依据类型】：无
【层级依据说明】：无

【评分项编号】：2.3
【评分项名称】：质量保障
【直接上级编号】：2
【直接上级名称】：技术分
【直接上级类型】：评分维度/汇总容器
【层级依据类型】：编号层级
【层级依据说明】：2 与 2.3 的编号关系`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.items.map((item) => item.title), ['需求理解', '实施方案', '质量保障']);
  assert.deepEqual(hierarchy.items.map((item) => item.sourceNumber), ['2.1', null, '2.3']);
  assert.deepEqual(hierarchy.rootTitles, ['需求理解', '实施方案', '质量保障']);
});

test('业务分组的编号层级缺少父子编号事实时安全回退为独立评分项', () => {
  const markdown = `## 技术评分项

【评分项名称】：项目理解方案
【直接上级名称】：项目总体方案
【直接上级类型】：业务分组
【层级依据类型】：编号层级
【层级依据说明】：根据内容判断

【评分项名称】：项目实施方案
【直接上级名称】：项目总体方案
【直接上级类型】：业务分组
【层级依据类型】：编号层级
【层级依据说明】：相邻内容属于同一主题`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.rootTitles, ['项目理解方案', '项目实施方案']);
  assert.ok(hierarchy.items.every((item) => item.parentGroup === null));
});

test('同名业务分组具有不同父编号时保持为两个独立一级目录', () => {
  const markdown = `## 技术评分项

【评分项编号】：3.1
【评分项名称】：第一标段实施方案
【直接上级编号】：3
【直接上级名称】：实施方案
【直接上级类型】：业务分组
【层级依据类型】：编号层级
【层级依据说明】：3 与 3.1 的编号关系

【评分项编号】：4.1
【评分项名称】：第二标段实施方案
【直接上级编号】：4
【直接上级名称】：实施方案
【直接上级类型】：业务分组
【层级依据类型】：编号层级
【层级依据说明】：4 与 4.1 的编号关系`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.rootTitles, ['实施方案', '实施方案']);
  assert.deepEqual(hierarchy.items.map((item) => item.rootIndex), [0, 1]);
});

test('旧版破折号组合标题没有结构依据时不推断父级分组', () => {
  const markdown = `## 技术评分项

【评分项名称】：项目总体方案——对本项目的理解
【权重/分值】：3分

【评分项名称】：项目总体方案——总体方案设计
【权重/分值】：4分`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.rootTitles, ['项目总体方案——对本项目的理解', '项目总体方案——总体方案设计']);
  assert.ok(hierarchy.items.every((item) => item.parentGroup === null));
});

test('默认评分规划按显式分组使用二级且无分组项使用一级', () => {
  const hierarchy = deriveTechnicalScoreHierarchy(`## 技术评分项

【评分项名称】：项目理解
【直接上级名称】：项目总体方案
【直接上级类型】：业务分组
【层级依据类型】：合并单元格
【层级依据说明】：rowspan=2

【评分项名称】：总体方案设计
【直接上级名称】：项目总体方案
【直接上级类型】：业务分组
【层级依据类型】：合并单元格
【层级依据说明】：rowspan=2

【评分项名称】：质量保证方案
【直接上级名称】：无
【直接上级类型】：无
【层级依据类型】：无
【层级依据说明】：无`);
  const roots = [{ id: '1', title: '项目总体方案' }, { id: '2', title: '质量保证方案' }];
  const plan = {
    allow_root_changes: false,
    extra_titles: [],
    branches: [
      {
        branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2,
        mappings: [{ requirement_id: 'R1', target_title: '项目理解' }, { requirement_id: 'R2', target_title: '总体方案设计' }],
      },
      {
        branch_id: 'B2', root_id: '2', root_title: '质量保证方案', score_item_level: 1,
        mappings: [{ requirement_id: 'R3', target_title: '质量保证方案' }],
      },
    ],
  };

  assert.doesNotThrow(() => assertStandaloneScoreDirectoryPlan(plan, hierarchy, roots));
  const wrongLevel = structuredClone(plan);
  wrongLevel.branches[1].score_item_level = 2;
  assert.throws(
    () => assertStandaloneScoreDirectoryPlan(wrongLevel, hierarchy, roots),
    /评分规划必须保持招标文件原有评分层级/,
  );

  const renamedTitle = structuredClone(plan);
  renamedTitle.branches[0].mappings[0].target_title = '项目认知';
  assert.throws(
    () => assertStandaloneScoreDirectoryPlan(renamedTitle, hierarchy, roots),
    /评分项标题必须逐字对应原文/,
  );

  const selfApprovedSplit = structuredClone(plan);
  selfApprovedSplit.branches[0].score_item_level = 6;
  selfApprovedSplit.branches[0].mappings[0].target_title = '项目认知';
  selfApprovedSplit.branches[0].mappings[0].additional_titles = ['项目背景认知'];
  selfApprovedSplit.branches[0].mappings[0].adjustment_note = '用户已批准';
  assert.throws(
    () => assertStandaloneScoreDirectoryPlan(selfApprovedSplit, hierarchy, roots),
    /缺少实际用户调整批准记录/,
  );
  assert.doesNotThrow(
    () => assertStandaloneScoreDirectoryPlan(selfApprovedSplit, hierarchy, roots, { hasUserAdjustmentApproval: true }),
  );
});

test('原文明确的单项业务分组不触发单子节点结构错误', () => {
  const outline = {
    outline: [{
      id: '1', title: '项目总体方案', description: '原文业务分组', attr: '技术', branch_id: 'B1',
      children: [{
        id: '1.1', title: '项目理解', description: '评分项',
        children: [
          {
            id: '1.1.1', title: '政策背景', description: '评分要点',
            children: [
              { id: '1.1.1.1', title: '国家政策', description: '国家政策', content_mode: 'ai-generate' },
              { id: '1.1.1.2', title: '地方政策', description: '地方政策', content_mode: 'ai-generate' },
            ],
          },
          {
            id: '1.1.2', title: '技术要求理解', description: '评分要点',
            children: [
              { id: '1.1.2.1', title: '工作范围', description: '工作范围', content_mode: 'ai-generate' },
              { id: '1.1.2.2', title: '成果要求', description: '成果要求', content_mode: 'ai-generate' },
            ],
          },
        ],
      }],
    }],
  };
  const scoreDirectoryPlan = {
    allow_root_changes: false,
    branches: [{
      branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2,
      mappings: [{ requirement_id: 'R1', target_title: '项目理解' }],
    }],
    extra_titles: [],
  };

  const context = buildOutlineReviewContext({
    outline,
    scoreDirectoryPlan,
    targetLeafCount: 4,
    standaloneTechnical: true,
  });

  assert.deepEqual(context.structure.single_child_nodes, []);
  assert.equal(context.structure.valid, true);
});

test('原文明确的单项业务分组可以通过目录 JSON Schema 校验', () => {
  const validate = new Ajv({ allErrors: true, strict: true }).compile(OUTLINE_JSON_SCHEMA);
  const outline = {
    outline: [{
      id: '1', title: '项目总体方案', description: '原文业务分组', attr: '技术', branch_id: 'B1',
      children: [{
        id: '1.1', title: '项目理解', description: '评分项',
        children: [
          { id: '1.1.1', title: '政策背景', description: '政策背景', content_mode: 'ai-generate' },
          { id: '1.1.2', title: '需求理解', description: '需求理解', content_mode: 'ai-generate' },
        ],
      }],
    }],
  };

  assert.equal(validate(outline), true, JSON.stringify(validate.errors));
});

test('评分项原文标题不参与通用标题风格清洗', () => {
  const outline = {
    outline: [{
      id: '1', title: '项目总体方案', description: '原文业务分组', attr: '技术', branch_id: 'B1',
      children: [{
        id: '1.1', title: '对本项目的理解', description: '评分项原文标题',
        children: [
          {
            id: '1.1.1', title: '项目背景', description: '评分要点',
            children: [
              { id: '1.1.1.1', title: '政策背景', description: '政策背景', content_mode: 'ai-generate' },
              { id: '1.1.1.2', title: '建设背景', description: '建设背景', content_mode: 'ai-generate' },
            ],
          },
          {
            id: '1.1.2', title: '项目需求', description: '评分要点',
            children: [
              { id: '1.1.2.1', title: '采购内容', description: '采购内容', content_mode: 'ai-generate' },
              { id: '1.1.2.2', title: '实施范围', description: '实施范围', content_mode: 'ai-generate' },
            ],
          },
        ],
      }],
    }],
  };
  const scoreDirectoryPlan = {
    branches: [{
      branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2,
      mappings: [{ requirement_id: 'R1', target_title: '对本项目的理解' }],
    }],
    extra_titles: [],
  };

  const context = buildOutlineReviewContext({
    outline,
    scoreDirectoryPlan,
    targetLeafCount: 4,
    standaloneTechnical: true,
  });

  assert.deepEqual(context.professional_structure.title_style_issues, []);
  assert.equal(context.professional_structure.valid, true);
});

test('独立父级行支持用表格行号作为可核验结构依据', () => {
  const markdown = `## 技术评分项

【评分项编号】：3.1
【评分项名称】：需求分析
【直接上级编号】：3
【直接上级名称】：项目总体方案
【直接上级类型】：业务分组
【层级依据类型】：独立父级行
【层级依据说明】：评分表第5行

【评分项编号】：3.2
【评分项名称】：总体设计
【直接上级编号】：3
【直接上级名称】：项目总体方案
【直接上级类型】：业务分组
【层级依据类型】：独立父级行
【层级依据说明】：评分表第5行`;

  const hierarchy = deriveTechnicalScoreHierarchy(markdown);

  assert.deepEqual(hierarchy.rootTitles, ['项目总体方案']);
  assert.ok(hierarchy.items.every((item) => item.parentGroup === '项目总体方案'));
});

test('目录字数目标使用可接受范围而不是精确叶子数', () => {
  assert.deepEqual(deriveAcceptableLeafRange(22, { soft: true }), { minimum: 19, maximum: 25 });
  assert.deepEqual(deriveAcceptableLeafRange(10, { soft: true }), { minimum: 8, maximum: 12 });
  assert.deepEqual(deriveAcceptableLeafRange(200), { minimum: 198, maximum: 202 });
  assert.deepEqual(deriveAcceptableLeafRange(4, { soft: true, maximum: 5 }), { minimum: 2, maximum: 5 });
  assert.deepEqual(deriveAcceptableLeafRange(null), { minimum: null, maximum: null });
});

test('语义叶子下限为每个评分条目预留评分要点和正文小节', () => {
  const plan = {
    branches: [{
      branch_id: 'B1',
      mappings: [
        { requirement_id: 'R1', target_title: '项目理解' },
        { requirement_id: 'R2', target_title: '总体方案设计' },
      ],
    }],
  };

  assert.equal(deriveSemanticMinimumLeafTarget(plan, 1), 7);

  const mergedPlan = {
    branches: [{
      branch_id: 'B1',
      mappings: [
        { requirement_id: 'R1', target_title: '项目理解' },
        { requirement_id: 'R2', target_title: '项目理解' },
      ],
    }],
  };
  assert.equal(deriveSemanticMinimumLeafTarget(mergedPlan, 0), 3);
});

test('最终审核拒绝评分要点直接作为正文叶子以及冗余标题语气词', () => {
  const outline = {
    outline: [{
      id: '1',
      title: '项目总体方案',
      description: '项目总体方案',
      attr: '技术',
      branch_id: 'B1',
      children: [{
        id: '1.1',
        title: '对本项目的理解',
        description: '项目理解',
        children: [
          { id: '1.1.1', title: '政策背景', description: '政策背景', content_mode: 'ai-generate' },
          { id: '1.1.2', title: '根据技术要求进行说明', description: '技术要求', content_mode: 'ai-generate' },
        ],
      }],
    }],
  };
  const scoreDirectoryPlan = {
    branches: [{
      branch_id: 'B1',
      root_id: '1',
      root_title: '项目总体方案',
      score_item_level: 2,
      mappings: [{ requirement_id: 'R1', target_title: '对本项目的理解' }],
    }],
    extra_titles: [],
  };

  const context = buildOutlineReviewContext({ outline, scoreDirectoryPlan, targetLeafCount: 4, standaloneTechnical: true });

  assert.equal(context.professional_structure.valid, false);
  assert.deepEqual(
    context.professional_structure.shallow_score_nodes.map((item) => item.id),
    ['1.1'],
  );
  assert.deepEqual(
    context.professional_structure.title_style_issues.map((item) => item.id),
    ['1.1.2'],
  );
});

test('最终审核接受人工标书式可写层级和简洁名词标题', () => {
  const outline = {
    outline: [{
      id: '1',
      title: '项目总体方案',
      description: '项目总体方案',
      attr: '技术',
      branch_id: 'B1',
      children: [{
        id: '1.1',
        title: '项目理解',
        description: '项目理解',
        children: [
          {
            id: '1.1.1',
            title: '政策背景',
            description: '政策背景',
            children: [
              { id: '1.1.1.1', title: '土地承包经营历史沿革', description: '历史沿革', content_mode: 'ai-generate' },
              { id: '1.1.1.2', title: '国家政策', description: '国家政策', content_mode: 'ai-generate' },
            ],
          },
          {
            id: '1.1.2',
            title: '项目技术要求理解',
            description: '技术要求理解',
            children: [
              { id: '1.1.2.1', title: '项目基本情况', description: '基本情况', content_mode: 'ai-generate' },
              { id: '1.1.2.2', title: '采购内容', description: '采购内容', content_mode: 'ai-generate' },
            ],
          },
        ],
      }],
    }],
  };
  const scoreDirectoryPlan = {
    branches: [{
      branch_id: 'B1',
      root_id: '1',
      root_title: '项目总体方案',
      score_item_level: 2,
      mappings: [{ requirement_id: 'R1', target_title: '项目理解' }],
    }],
    extra_titles: [],
  };

  const context = buildOutlineReviewContext({ outline, scoreDirectoryPlan, targetLeafCount: 4, standaloneTechnical: true });

  assert.equal(context.professional_structure.valid, true);
  assert.deepEqual(context.professional_structure.shallow_score_nodes, []);
  assert.deepEqual(context.professional_structure.title_style_issues, []);
});

test('普通响应文件模式不套用独立成册的四层结构门槛', () => {
  const outline = {
    outline: [{
      id: '1',
      title: '技术方案',
      description: '技术方案',
      attr: '技术',
      branch_id: 'B1',
      children: [
        { id: '1.1', title: '项目理解', description: '项目理解', content_mode: 'ai-generate' },
        { id: '1.2', title: '实施方案', description: '实施方案', content_mode: 'ai-generate' },
      ],
    }],
  };
  const scoreDirectoryPlan = {
    branches: [{
      branch_id: 'B1',
      root_id: '1',
      root_title: '技术方案',
      score_item_level: 2,
      mappings: [{ requirement_id: 'R1', target_title: '项目理解' }],
    }],
    extra_titles: [{ branch_id: 'B1', title: '实施方案', reason: '完整技术方案章节' }],
  };

  const context = buildOutlineReviewContext({
    outline,
    scoreDirectoryPlan,
    targetLeafCount: 2,
    standaloneTechnical: false,
  });

  assert.equal(context.professional_structure.valid, true);
});

test('独立成册评分条目不得放在第五级或第六级', () => {
  const leaf = (id, title) => ({ id, title, description: title, content_mode: 'ai-generate' });
  const outline = {
    outline: [{
      id: '1',
      title: '项目总体方案',
      description: '项目总体方案',
      attr: '技术',
      branch_id: 'B1',
      children: [{
        id: '1.1',
        title: '第一层',
        description: '第一层',
        children: [{
          id: '1.1.1',
          title: '第二层',
          description: '第二层',
          children: [{
            id: '1.1.1.1',
            title: '第三层',
            description: '第三层',
            children: [{
              id: '1.1.1.1.1',
              title: '项目理解',
              description: '项目理解',
              children: [
                leaf('1.1.1.1.1.1', '政策背景'),
                leaf('1.1.1.1.1.2', '技术要求'),
              ],
            }],
          }],
        }],
      }],
    }],
  };
  const scoreDirectoryPlan = {
    branches: [{
      branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 5,
      mappings: [{ requirement_id: 'R1', target_title: '项目理解' }],
    }],
    extra_titles: [],
  };

  const context = buildOutlineReviewContext({ outline, scoreDirectoryPlan, targetLeafCount: null, standaloneTechnical: true });

  assert.equal(context.professional_structure.valid, false);
  assert.deepEqual(context.professional_structure.invalid_score_item_levels, [{ branch_id: 'B1', score_item_level: 5 }]);
});

test('用户已接受叶子数量偏差时最终审核不再重复阻断', () => {
  const context = buildOutlineReviewContext({
    outline: { outline: [{ id: '1', title: '简要方案', description: '简要方案', attr: '技术', content_mode: 'ai-generate' }] },
    scoreDirectoryPlan: { branches: [], extra_titles: [] },
    targetLeafCount: 10,
    standaloneTechnical: false,
    acceptedLeafCount: 1,
  });

  assert.equal(context.leaf_count.within_acceptable_range, false);
  assert.equal(context.leaf_count.accepted_by_user, true);
  assert.equal(context.leaf_count.valid, true);
});

test('叶子数量接受只绑定当时数量且不能越过严格字数上限', () => {
  const outlineWith = (count) => ({ outline: Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    title: `章节${index + 1}`,
    description: `章节${index + 1}`,
    attr: '技术',
    content_mode: 'ai-generate',
  })) });
  const base = {
    scoreDirectoryPlan: { branches: [], extra_titles: [] },
    targetLeafCount: 10,
    standaloneTechnical: false,
  };

  assert.equal(buildOutlineReviewContext({ ...base, outline: outlineWith(3), acceptedLeafCount: 4 }).leaf_count.valid, false);
  assert.equal(buildOutlineReviewContext({ ...base, outline: outlineWith(4), acceptedLeafCount: 4 }).leaf_count.valid, true);
  assert.equal(buildOutlineReviewContext({
    ...base,
    outline: outlineWith(6),
    targetLeafCount: 4,
    acceptedLeafCount: 6,
    maximumLeafCount: 5,
  }).leaf_count.valid, false);
});

test('独立成册审核拒绝未绑定评分规划的额外一级目录', () => {
  const validBranch = {
    id: '1', title: '项目总体方案', description: '总体方案', attr: '技术', branch_id: 'B1', children: [{
      id: '1.1', title: '项目理解', description: '项目理解', children: [
        { id: '1.1.1', title: '政策背景', description: '政策背景', children: [
          { id: '1.1.1.1', title: '国家政策', description: '国家政策', content_mode: 'ai-generate' },
          { id: '1.1.1.2', title: '省级政策', description: '省级政策', content_mode: 'ai-generate' },
        ] },
        { id: '1.1.2', title: '项目目标', description: '项目目标', content_mode: 'ai-generate' },
      ],
    }],
  };
  const context = buildOutlineReviewContext({
    outline: { outline: [validBranch, { id: '2', title: '额外方案', description: '额外方案', attr: '技术', content_mode: 'ai-generate' }] },
    scoreDirectoryPlan: {
      branches: [{ branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2, mappings: [{ requirement_id: 'R1', target_title: '项目理解' }] }],
      extra_titles: [],
    },
    targetLeafCount: null,
    standaloneTechnical: true,
  });

  assert.equal(context.professional_structure.valid, false);
  assert.deepEqual(context.professional_structure.unplanned_root_nodes.map((item) => item.id), ['2']);
});

test('独立成册审核拒绝多个一级目录复用同一分支标识', () => {
  const scoreNode = (id) => ({
    id: `${id}.1`, title: '项目理解', description: '项目理解', children: [
      { id: `${id}.1.1`, title: '政策背景', description: '政策背景', children: [
        { id: `${id}.1.1.1`, title: '国家政策', description: '国家政策', content_mode: 'ai-generate' },
        { id: `${id}.1.1.2`, title: '省级政策', description: '省级政策', content_mode: 'ai-generate' },
      ] },
      { id: `${id}.1.2`, title: '项目目标', description: '项目目标', content_mode: 'ai-generate' },
    ],
  });
  const context = buildOutlineReviewContext({
    outline: { outline: [
      { id: '1', title: '项目总体方案', description: '总体方案', attr: '技术', branch_id: 'B1', children: [scoreNode('1')] },
      { id: '2', title: '重复业务主题', description: '重复主题', attr: '技术', branch_id: 'B1', children: [scoreNode('2')] },
    ] },
    scoreDirectoryPlan: {
      branches: [{ branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2, mappings: [{ requirement_id: 'R1', target_title: '项目理解' }] }],
      extra_titles: [],
    },
    targetLeafCount: null,
    standaloneTechnical: true,
  });

  assert.equal(context.score_mapping.valid, false);
  assert.equal(context.professional_structure.valid, false);
  assert.deepEqual(context.professional_structure.duplicate_branch_roots, [{ branch_id: 'B1', root_ids: ['1', '2'] }]);
});

test('评分映射拒绝同层级重复标题', () => {
  const context = buildOutlineReviewContext({
    outline: { outline: [{
      id: '1', title: '项目总体方案', description: '总体方案', attr: '技术', branch_id: 'B1', children: [
        { id: '1.1', title: '项目理解', description: '项目理解', content_mode: 'ai-generate' },
        { id: '1.2', title: '项目理解', description: '重复项目理解', content_mode: 'ai-generate' },
      ],
    }] },
    scoreDirectoryPlan: {
      branches: [{ branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2, mappings: [{ requirement_id: 'R1', target_title: '项目理解' }] }],
      extra_titles: [],
    },
    targetLeafCount: null,
    standaloneTechnical: false,
  });

  assert.equal(context.score_mapping.valid, false);
  assert.deepEqual(context.score_mapping.branches[0].duplicate_titles, ['项目理解']);
});

test('独立成册审核拒绝同组下机械重复的“甲与乙”标题', () => {
  const context = buildOutlineReviewContext({
    outline: { outline: [{
      id: '1', title: '项目总体方案', description: '总体方案', attr: '技术', branch_id: 'B1', children: [{
        id: '1.1', title: '项目理解', description: '项目理解', children: [
          { id: '1.1.1', title: '项目技术要求理解', description: '技术要求', children: [
            { id: '1.1.1.1', title: '采购内容与实施范围理解', description: '采购与实施', content_mode: 'ai-generate' },
            { id: '1.1.1.2', title: '技术标准与作业规范理解', description: '标准与规范', content_mode: 'ai-generate' },
            { id: '1.1.1.3', title: '测绘精度与数据质量理解', description: '精度与质量', content_mode: 'ai-generate' },
            { id: '1.1.1.4', title: '数据库规范与系统对接理解', description: '规范与对接', content_mode: 'ai-generate' },
          ] },
          { id: '1.1.2', title: '项目目标', description: '项目目标', content_mode: 'ai-generate' },
        ],
      }],
    }] },
    scoreDirectoryPlan: {
      branches: [{ branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2, mappings: [{ requirement_id: 'R1', target_title: '项目理解' }] }],
      extra_titles: [],
    },
    targetLeafCount: null,
    standaloneTechnical: true,
  });

  assert.equal(context.professional_structure.valid, false);
  assert.deepEqual(context.professional_structure.mechanical_connector_groups, [{
    id: '1.1.1',
    title: '项目技术要求理解',
    child_count: 4,
    connector_title_count: 4,
  }]);
});

test('独立成册审核允许人工目录中少量有实际语义的连接词', () => {
  const context = buildOutlineReviewContext({
    outline: { outline: [{
      id: '1', title: '项目总体方案', description: '总体方案', attr: '技术', branch_id: 'B1', children: [{
        id: '1.1', title: '项目实施过程中的重点、难点问题分析及解决措施', description: '重难点分析', children: [
          { id: '1.1.1', title: '重点问题分析及解决措施', description: '重点问题', children: [
            { id: '1.1.1.1', title: '稳定实施，避免引起新矛盾', description: '稳定实施', content_mode: 'ai-generate' },
            { id: '1.1.1.2', title: '试点工作成效总结', description: '成效总结', content_mode: 'ai-generate' },
            { id: '1.1.1.3', title: '宣传与群众参与机制', description: '群众参与', content_mode: 'ai-generate' },
            { id: '1.1.1.4', title: '权属调查', description: '权属调查', content_mode: 'ai-generate' },
          ] },
          { id: '1.1.2', title: '难点问题分析及解决措施', description: '难点问题', content_mode: 'ai-generate' },
        ],
      }],
    }] },
    scoreDirectoryPlan: {
      branches: [{ branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2, mappings: [{ requirement_id: 'R1', target_title: '项目实施过程中的重点、难点问题分析及解决措施' }] }],
      extra_titles: [],
    },
    targetLeafCount: null,
    standaloneTechnical: true,
  });

  assert.equal(context.professional_structure.mechanical_connector_groups.length, 0);
  assert.equal(context.professional_structure.valid, true);
});

test('机械连接词审核不改写用户已确认的评分项标题', () => {
  const scoreNode = (id, title) => ({
    id,
    title,
    description: title,
    children: [
      { id: `${id}.1`, title: '工作思路', description: '工作思路', children: [
        { id: `${id}.1.1`, title: '总体安排', description: '总体安排', content_mode: 'ai-generate' },
        { id: `${id}.1.2`, title: '实施步骤', description: '实施步骤', content_mode: 'ai-generate' },
      ] },
      { id: `${id}.2`, title: '保障要求', description: '保障要求', content_mode: 'ai-generate' },
    ],
  });
  const titles = ['设计与实施', '质量与进度', '安全与保密'];
  const context = buildOutlineReviewContext({
    outline: { outline: [{
      id: '1', title: '项目总体方案', description: '总体方案', attr: '技术', branch_id: 'B1',
      children: titles.map((title, index) => scoreNode(`1.${index + 1}`, title)),
    }] },
    scoreDirectoryPlan: {
      branches: [{
        branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 2,
        mappings: titles.map((title, index) => ({ requirement_id: `R${index + 1}`, target_title: title })),
      }],
      extra_titles: [],
    },
    targetLeafCount: null,
    standaloneTechnical: true,
  });

  assert.deepEqual(context.professional_structure.mechanical_connector_groups, []);
  assert.equal(context.professional_structure.valid, true);
});

test('评分项在三级时连接词审核仍覆盖上方中间分组', () => {
  const scoreNode = (id, title) => ({
    id,
    title,
    description: title,
    children: [
      { id: `${id}.1`, title: '工作思路', description: '工作思路', children: [
        { id: `${id}.1.1`, title: '总体安排', description: '总体安排', content_mode: 'ai-generate' },
        { id: `${id}.1.2`, title: '实施步骤', description: '实施步骤', content_mode: 'ai-generate' },
      ] },
      { id: `${id}.2`, title: '保障要求', description: '保障要求', content_mode: 'ai-generate' },
    ],
  });
  const groupTitles = ['数据采集与处理', '质量检查与验收', '培训服务与运维'];
  const context = buildOutlineReviewContext({
    outline: { outline: [{
      id: '1', title: '项目总体方案', description: '总体方案', attr: '技术', branch_id: 'B1',
      children: groupTitles.map((title, index) => ({
        id: `1.${index + 1}`, title, description: title,
        children: [scoreNode(`1.${index + 1}.1`, `评分项${index + 1}`)],
      })),
    }] },
    scoreDirectoryPlan: {
      branches: [{
        branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 3,
        mappings: groupTitles.map((_, index) => ({ requirement_id: `R${index + 1}`, target_title: `评分项${index + 1}` })),
      }],
      extra_titles: [],
    },
    targetLeafCount: null,
    standaloneTechnical: true,
  });

  assert.deepEqual(context.professional_structure.mechanical_connector_groups, [{
    id: '1', title: '项目总体方案', child_count: 3, connector_title_count: 3,
  }]);
});

test('标题检查覆盖通用语气词且不误伤专业词', () => {
  const context = buildOutlineReviewContext({
    outline: { outline: [
      { id: '1', title: '对施工组织的说明', description: '施工组织', attr: '技术', content_mode: 'ai-generate' },
      { id: '2', title: '结合部施工工艺', description: '结合部施工', attr: '技术', content_mode: 'ai-generate' },
      { id: '3', title: '针对性保障措施', description: '保障措施', attr: '技术', content_mode: 'ai-generate' },
      { id: '4', title: '对流换热计算', description: '换热计算', attr: '技术', content_mode: 'ai-generate' },
      { id: '5', title: '对流换热分析', description: '换热分析', attr: '技术', content_mode: 'ai-generate' },
      { id: '6', title: '对讲系统说明', description: '对讲系统', attr: '技术', content_mode: 'ai-generate' },
    ] },
    scoreDirectoryPlan: { branches: [], extra_titles: [] },
    targetLeafCount: null,
    standaloneTechnical: true,
  });

  assert.deepEqual(context.professional_structure.title_style_issues.map((item) => item.id), ['1']);
});

test('普通响应文件模式仍要求精确参考叶子目标', () => {
  const prompt = createChildrenPrompt({
    hasOriginalPlan: false,
    originalOnly: false,
    targetLeafCount: 200,
    allowRootChanges: false,
    standaloneTechnical: false,
  });

  assert.match(prompt, /严格参考 leaf-allocation\.json 中的分配/);
  assert.match(prompt, /必须正好生成 200 个/);
  assert.doesNotMatch(prompt, /约有 200 个/);
  assert.doesNotMatch(prompt, /正文颗粒度软目标/);
});

test('普通模式叶子调整不把容差误述为可接受范围', () => {
  const prompt = createLeafAdjustmentPrompt(200, 199, { standaloneTechnical: false });

  assert.match(prompt, /精确目标是 200 个/);
  assert.match(prompt, /达到目标数量/);
  assert.doesNotMatch(prompt, /可接受范围是 198 至 202 个/);
});

test('最终审核不对用户已接受的当前叶子数量重复询问', () => {
  const prompt = createOutlineReviewPrompt({
    targetLeafCount: 10,
    actualLeafCount: 8,
    allowRootChanges: false,
    standaloneTechnical: true,
    acceptedLeafCount: 8,
    maximumLeafCount: 12,
  });

  assert.match(prompt, /不得再列为问题或触发 ask-user/);
  assert.match(prompt, /静默修复不得改变 AI 生成叶子数量/);
  assert.doesNotMatch(prompt, /叶子数量超出合理范围必须设为 true/);
  assert.doesNotMatch(prompt, /不得使 AI 生成叶子数量超出程序给出的合理范围/);
});

test('最终审核禁止改写评分项标题且不允许保留硬性失败目录', () => {
  const prompt = createOutlineReviewPrompt({
    targetLeafCount: 20,
    actualLeafCount: 20,
    allowRootChanges: false,
    standaloneTechnical: true,
  });

  assert.match(prompt, /评分项标题必须逐字保持技术评分信息\.md 中的名称/);
  assert.match(prompt, /不得修改.*target_title.*additional_titles/);
  assert.match(prompt, /确定性检查不通过.*不得提供“保留当前目录”/);
  assert.match(prompt, /user_refuse.*只能用于确定性检查已通过/);
});

test('评分规划复审不得改写已确认的评分项标题', () => {
  const confirmedPlan = {
    allow_root_changes: false,
    branches: [{
      branch_id: 'B1',
      root_id: '1',
      root_title: '项目总体方案',
      score_item_level: 2,
      mappings: [{
        requirement_id: 'R1',
        target_title: '对本项目的理解',
        additional_titles: ['对项目背景的理解'],
        adjustment_note: '用户确认拆分',
      }],
    }],
    extra_titles: [],
  };
  const titleOnlyReview = structuredClone(confirmedPlan);
  titleOnlyReview.branches[0].mappings[0].target_title = '项目理解';
  titleOnlyReview.branches[0].mappings[0].additional_titles = ['项目背景'];

  assert.throws(
    () => mergeReviewedScoreDirectoryPlan(confirmedPlan, titleOnlyReview, { standaloneTechnical: true }),
    /不得修改已确认的评分规划/,
  );

  const tamperedReview = structuredClone(titleOnlyReview);
  tamperedReview.branches[0].mappings[0].requirement_id = 'R2';
  assert.throws(
    () => mergeReviewedScoreDirectoryPlan(confirmedPlan, tamperedReview, { standaloneTechnical: true }),
    /不得修改已确认的评分规划/,
  );

  assert.deepEqual(
    mergeReviewedScoreDirectoryPlan(confirmedPlan, tamperedReview, { standaloneTechnical: false }),
    confirmedPlan,
  );
});

test('普通响应文件最终审核不得改写评分规划', () => {
  const prompt = createOutlineReviewPrompt({
    targetLeafCount: 20,
    actualLeafCount: 20,
    allowRootChanges: false,
    standaloneTechnical: false,
  });

  assert.match(prompt, /不得修改 score-directory-plan\.json/);
  assert.doesNotMatch(prompt, /同步修改.*target_title/);
});

test('独立成册模式只按招标文件原有评分层级生成一级目录', () => {
  const prompt = createInitialPrompt('按响应文件要求生成。', {
    standaloneTechnical: true,
    expectedRootTitles: ['项目理解', '质量保证方案'],
  });

  assert.match(prompt, /评分维度\/汇总容器.*每个技术评分项分别作为一级目录/);
  assert.match(prompt, /层级依据类型.*每个技术评分项分别作为一级目录/);
  assert.match(prompt, /不得根据父级标题字样/);
  assert.match(prompt, /父级标题字样、语义、相邻关系或所谓共同主题推断、合并/);
  assert.match(prompt, /本次一级目录必须依次且完整使用：项目理解、质量保证方案/);
  assert.match(prompt, /一级目录 title 必须逐字使用上述评分分组或评分项名称/);
  assert.match(prompt, /“项目实施方案”不得缩写为“实施方案”/);
  assert.doesNotMatch(prompt, /title 使用简洁的名词性短语/);
  assert.match(prompt, /不得加入商务、资信、投标函、授权委托书/);
});

test('独立成册评分规划严格区分原文分组项和无分组项', () => {
  const prompt = createScorePlanningPrompt({ standaloneTechnical: true });

  assert.match(prompt, /原文中具有同一个明确业务分组.*score_item_level=2/);
  assert.match(prompt, /原文没有明确业务分组.*score_item_level=1/);
  assert.match(prompt, /不得根据语义或相邻关系推断分组/);
  assert.match(prompt, /存在偏离时.*按上述调整生成.*保持原评分层级.*调整目录安排/s);
  assert.match(prompt, /没有偏离时.*按原评分层级生成.*调整目录安排/s);
  assert.match(prompt, /"source_number":"2\.1"/);
  assert.match(prompt, /"parent_number":"2"/);
  assert.match(prompt, /"parent_name":"项目总体方案"/);
  assert.match(prompt, /"parent_type":"business-group"/);
  assert.match(prompt, /"hierarchy_evidence_type":"merged-cell"/);
  assert.match(prompt, /"hierarchy_evidence":"rowspan=3"/);
  assert.match(prompt, /parent_type 只使用 score-container、business-group、none/);
  assert.match(prompt, /不得根据标题字样、语义或相邻关系反向推断父级类型/);
  assert.match(prompt, /title、source_number、parent_number、parent_name、parent_type、hierarchy_evidence_type 和 hierarchy_evidence 必须逐项复制或转换技术评分信息\.md/);
  assert.match(prompt, /“项目实施方案”不得改写为“实施方案”/);
  assert.match(prompt, /target_title 必须逐字使用对应 group\.title/);
  assert.match(prompt, /不承载正文内容的评价等级|不得写入 detail_points/);
  assert.match(prompt, /项目实施过程中的重点、难点问题分析及解决措施/);
  assert.match(prompt, /重点问题分析及解决措施/);
  assert.match(prompt, /难点问题分析及解决措施/);
  assert.match(prompt, /不要机械拆成“问题分析”和“解决措施与对策”/);
});

test('独立成册按评分条目和评分要点递进生成可写正文小节', () => {
  const prompt = createChildrenPrompt({
    hasOriginalPlan: false,
    originalOnly: false,
    targetLeafCount: 10,
    allowRootChanges: false,
    standaloneTechnical: true,
  });

  assert.match(prompt, /原文业务分组（如有）→ 评分条目 → 评分要点 → 可独立编写的正文小节/);
  assert.match(prompt, /无原文业务分组时从一级评分条目直接向下展开/);
  assert.match(prompt, /每个评分条目至少有一个评分要点继续展开/);
  assert.match(prompt, /target_title 和 additional_titles.*必须逐字使用/);
  assert.match(prompt, /标题专业化规则只适用于评分项以下/);
  assert.match(prompt, /标题使用简洁的名词性短语/);
  assert.match(prompt, /一个标题原则上只表达一个核心主题/);
  assert.match(prompt, /子目录继承父目录语境/);
  assert.match(prompt, /采购内容”和“实施范围/);
  assert.match(prompt, /项目理解/);
});

test('独立成册末级小节目标至少覆盖每个技术分支', () => {
  assert.equal(enforceMinimumLeafTarget(10, 0, 6), 10);
  assert.equal(enforceMinimumLeafTarget(14, 0, 6), 14);
  assert.equal(enforceMinimumLeafTarget(4, 0, 6), 6);
  assert.equal(enforceMinimumLeafTarget(10, 2, 5), 10);
  assert.equal(enforceMinimumLeafTarget(null, 0, 6), null);
  assert.equal(enforceMinimumLeafTarget(2, 0, 1, {
    maximumWords: 4000,
    sectionWords: 3000,
    strictSectionWords: true,
  }), 1);
  assert.throws(
    () => enforceMinimumLeafTarget(4, 0, 6, {
      maximumWords: 4000,
      sectionWords: 1000,
      strictSectionWords: true,
    }),
    /最多容纳 5 个 AI 生成小节，但独立成册目录至少需要 6 个/,
  );
});

test('远程目录参考文件明确标记为不可信材料且不泄露内部来源标识到标题', () => {
  const file = buildRemoteKnowledgeFile([
    { title: '规范片段', content: '远程正文', knowledgeBaseId: 'kb-secret', knowledgeId: 'doc-secret', chunkId: 'chunk-secret' },
  ]);
  assert.equal(file.path, '远程知识参考.md');
  assert.match(file.content, /仅是参考材料/);
  assert.match(file.content, /规范片段/);
  assert.match(file.content, /远程正文/);
  assert.doesNotMatch(file.content, /kb-secret|doc-secret|chunk-secret/);
});

test('original-only 真实目录任务不调用远程检索，也不注入远程文件', async () => {
  const searches = [];
  const runs = [];
  const storedPlan = {
    workflowKind: 'existing-plan-expansion',
    originalPlanFile: { fileName: '原方案.docx' },
    outlineExpansionMode: 'original-only',
    tenderFile: { fileName: '招标.md' },
    projectOverview: '智慧水务平台建设',
    bidAnalysisTasks: { responseFileRequirements: { content: '技术方案目录要求' } },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => storedPlan,
    readOriginalPlanMarkdown: () => '# 原方案目录',
    hasBidTemplate: () => false,
  };
  const root = { id: '1', title: '原方案一级', attr: '技术' };
  const runsOutput = [
    { outline: [root] },
    { outline: [{ ...root, content_mode: 'ai-generate' }] },
  ];
  const agentService = {
    runTask: async (input) => {
      runs.push(input);
      return { output_content: JSON.stringify(runsOutput.shift()) };
    },
    updatePersistentTask() {},
  };
  const checkpointTask = (patch, data) => ({ task: {
    task_id: 'task-outline-test',
    stats: data || {},
    logs: [],
    ...patch,
  } });
  await runOutlineGenerationTaskV2({
    aiService: {},
    agentService,
    ordinaryAgentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    knowledgeSession: { searchRemote: async (input) => { searches.push(input); return []; } },
    openXmlHelperService: {},
    updateTask: (patch) => ({ task_id: 'task-outline-test', stats: {}, logs: [], ...patch }),
    checkpointTask,
    taskControl: {
      signal: new AbortController().signal,
      waitForOutlineSelection: async () => ({ items: [root], selectedIds: ['1'] }),
    },
    payload: {},
  });
  assert.equal(searches.length, 0);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].initial_stage, 'initial-outline');
  assert.deepEqual(runs[0].files, [{ path: '原方案.md', content: '# 原方案目录' }]);
  assert.equal(runs[0].files.some((file) => file.path === '远程知识参考.md'), false);
  assert.equal(runs[1].files.some((file) => file.path === '远程知识参考.md'), false);
});

test('非 original-only 真实目录任务按 outline 阶段检索并注入远程参考文件', async () => {
  const searches = [];
  const runs = [];
  const queryPlanningInputs = [];
  const storedPlan = {
    outlineMode: 'standalone-technical',
    techRequirements: '平台总体设计评分项-技术要求末尾',
    projectOverview: '智慧水务平台建设-项目概述末尾',
    bidAnalysisTasks: { responseFileRequirements: { content: '技术方案目录要求-响应要求末尾' } },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => storedPlan,
    hasBidTemplate: () => false,
  };
  const root = { id: '1', title: '平台总体设计', attr: '技术' };
  const outputs = [
    { outline: [root] },
    { outline: [{ ...root, content_mode: 'ai-generate' }] },
  ];
  const agentService = {
    runTask: async (input) => {
      runs.push(input);
      return { output_content: JSON.stringify(outputs.shift()) };
    },
    updatePersistentTask() {},
  };
  const checkpointTask = (patch, data) => ({ task: {
    task_id: 'task-outline-remote-test',
    stats: data || {},
    logs: [],
    ...patch,
  } });
  await runOutlineGenerationTaskV2({
    aiService: {
      collectJsonResponse: async (input) => {
        queryPlanningInputs.push(input);
        if (input.logTitle === '远程知识查询规划-outline') {
          return {
            queries: ['土地延包实施流程有哪些？', '成果汇交如何验收？', '质量和进度如何控制？'],
          };
        }
        throw new Error(`Unexpected AI request: ${input.logTitle}`);
      },
    },
    agentService,
    ordinaryAgentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    knowledgeSession: {
      searchRemote: async (input) => {
        searches.push(input);
        return [{ title: '远程规范片段', content: '平台总体设计参考' }];
      },
    },
    openXmlHelperService: {},
    updateTask: (patch) => ({ task_id: 'task-outline-remote-test', stats: {}, logs: [], ...patch }),
    checkpointTask,
    taskControl: {
      signal: new AbortController().signal,
      waitForOutlineSelection: async () => ({ items: [root], selectedIds: ['1'] }),
    },
    payload: {},
  });
  assert.equal(searches.length, 1);
  assert.deepEqual(searches[0], {
    stage: 'outline',
    queries: ['土地延包实施流程有哪些？', '成果汇交如何验收？', '质量和进度如何控制？'],
    matchCount: 8,
  });
  assert.equal(queryPlanningInputs.length, 1);
  const planningPrompt = queryPlanningInputs[0].messages[1].content;
  assert.match(planningPrompt, /项目概述末尾/);
  assert.match(planningPrompt, /响应要求末尾/);
  assert.match(planningPrompt, /技术要求末尾/);
  assert.equal(runs.length, 2);
  assert.ok(runs[1].files.some((file) => file.path === '远程知识参考.md'));
});

test('最终审核首次修复不彻底时自动进入复检修复而不是在88%终止', async () => {
  const root = { id: '1', title: '项目总体方案', description: '总体方案', attr: '技术' };
  const plan = {
    allow_root_changes: false,
    branches: [{
      branch_id: 'B1', root_id: '1', root_title: '项目总体方案', score_item_level: 1,
      mappings: [{ requirement_id: 'R1', target_title: '项目总体方案' }],
    }],
    extra_titles: [],
  };
  const makeOutline = (titles) => ({ outline: [{
    ...root,
    branch_id: 'B1',
    children: [
      {
        id: '1.1', title: '政策背景', description: '政策背景',
        children: titles.map((title, index) => ({
          id: `1.1.${index + 1}`, title, description: title, content_mode: 'ai-generate',
        })),
      },
      { id: '1.2', title: '技术要求', description: '技术要求', content_mode: 'ai-generate' },
    ],
  }] });
  const stillInvalidOutline = makeOutline(['国家政策与省级政策', '行业要求与地方要求', '规划部署与实施要求', '制度沿革与政策背景']);
  const correctedOutline = makeOutline(['国家政策', '省级政策', '行业要求', '地方要求']);
  const review = {
    status: 'user_feedback',
    issues: [{
      category: 'professional-structure', problem: '连接词标题密集', repair: '拆分可独立主题', confirmation_required: true,
    }],
    user_feedback: '按推荐方案修复',
    summary: '已按用户意见修复',
  };
  const correctionStages = [];
  let runCount = 0;
  const agentService = {
    updatePersistentTask() {},
    runTask: async (input) => {
      runCount += 1;
      if (runCount === 1) return { output_content: JSON.stringify({ outline: [root] }) };

      const writtenFiles = new Map();
      const createMeta = (workflowStage) => ({
        workflow_stage: workflowStage,
        user_question_answers: [],
        readFile: async (filePath) => {
          if (filePath === 'score-directory-plan.json') return JSON.stringify(plan);
          if (filePath === 'outline-review.json') return JSON.stringify(review);
          return writtenFiles.get(filePath) || '';
        },
        writeFiles: async (files) => files.forEach((file) => writtenFiles.set(file.path, file.content)),
      });

      let continuation = await input.continueTask(
        { output_content: JSON.stringify({ outline: [root] }) },
        createMeta('score-planning'),
      );
      continuation = await input.continueTask(
        { output_content: JSON.stringify(stillInvalidOutline) },
        createMeta(continuation.stage),
      );
      continuation = await input.continueTask(
        { output_content: JSON.stringify(stillInvalidOutline) },
        createMeta(continuation.stage),
      );
      correctionStages.push(continuation.stage);
      assert.ok(continuation.files.some((file) => file.path === 'outline-review-context.json'));

      const completed = await input.continueTask(
        { output_content: JSON.stringify(correctedOutline) },
        createMeta(continuation.stage),
      );
      assert.deepEqual(completed, { complete: true });
      return { output_content: JSON.stringify(correctedOutline) };
    },
  };
  const storedPlan = {
    outlineMode: 'standalone-technical',
    techRequirements: '项目理解评分项',
    bidAnalysisTasks: { responseFileRequirements: { content: '技术方案要求' } },
  };
  let latestCheckpoint = null;
  const checkpointTask = (patch, data) => {
    latestCheckpoint = { patch, data };
    return { task: {
      task_id: 'task-review-correction-test', stats: data || {}, logs: [], ...patch,
    } };
  };

  await runOutlineGenerationTaskV2({
    aiService: {},
    agentService,
    ordinaryAgentService: {},
    workspaceStore: { loadTechnicalPlan: () => storedPlan, hasBidTemplate: () => false },
    knowledgeBaseService: {},
    openXmlHelperService: {},
    updateTask: (patch) => ({ task_id: 'task-review-correction-test', stats: {}, logs: [], ...patch }),
    checkpointTask,
    taskControl: {
      signal: new AbortController().signal,
      waitForOutlineSelection: async () => ({ items: [root], selectedIds: ['1'] }),
    },
    payload: {},
  });

  assert.deepEqual(correctionStages, ['outline_review_correction']);
  assert.equal(latestCheckpoint.patch.status, 'success');
  assert.equal(latestCheckpoint.data.outlineData.outline[0].children[0].children[0].title, '国家政策');
});
