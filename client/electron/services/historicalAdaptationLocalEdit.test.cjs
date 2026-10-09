const assert = require('node:assert/strict');
const test = require('node:test');
const { applyAuthorizedLocalEdits } = require('./historicalAdaptationLocalEdit.cjs');

test('地区段落不得沿用招标依据未支持的旧行政归属及人口', () => {
  const source = '五峰村情况。行政归属为木渎镇。人口1000人，工作量965宗。';
  const rule = { id: 'place', targetAction: 'rewrite-fragment', paragraphRewrite: true,
    oldValues: ['五峰村', '965宗'], targetRequirement: '横泾街道3082宗',
    authorizedRanges: [{ startOffset: 0, endOffset: source.length, oldValue: source, paragraphRewrite: true }],
  };
  const result = applyAuthorizedLocalEdits(source, [rule], [{ old_text: source,
    new_text: '横泾街道情况。行政归属为木渎镇。人口1000人，工作量3082宗。' }]);
  assert.equal(result.changed, false);
  assert.match(result.errors.join('；'), /protected-fact-changed/);
});

test('精确旧值全部 occurrence 原子替换，无关短语逐字保留', () => {
  const source = '五峰村与五峰村。开展农村服务，村辖区不变。';
  const rules = [{ id: 'place', targetAction: 'replace', replacements: [{ oldValue: '五峰村', newValue: '横泾街道' }],
    authorizedRanges: [{ startOffset: 0, endOffset: 3, oldValue: '五峰村' }, { startOffset: 4, endOffset: 7, oldValue: '五峰村' }] }];
  const result = applyAuthorizedLocalEdits(source, rules);
  assert.equal(result.content, '横泾街道与横泾街道。开展农村服务，村辖区不变。');
  assert.equal(result.errors.length, 0);
});

test('锁定删除范围仅删除证据，过期范围或任一重叠时完全回滚', () => {
  const source = '保留段。删除这段。保留尾。';
  const rule = { id: 'remove', targetAction: 'remove', authorizedRanges: [{ startOffset: 4, endOffset: 9, oldValue: '删除这段。' }] };
  assert.equal(applyAuthorizedLocalEdits(source, [rule]).content, '保留段。保留尾。');
  const stale = applyAuthorizedLocalEdits(source, [rule, { ...rule, id: 'stale', authorizedRanges: [{ startOffset: 9, endOffset: 11, oldValue: '不存在' }] }]);
  assert.equal(stale.content, source);
  assert.equal(stale.changed, false);
  assert.equal(stale.errors.length > 0, true);
});

function lockedRule(source, evidence, fields = {}) {
  const start = source.indexOf(evidence);
  return { id: 'fragment', targetAction: 'rewrite-fragment', scope: 'service-content', targetRequirement: '更新服务流程',
    oldContentEvidence: [evidence],
    authorizedRanges: [{ startOffset: start, endOffset: start + evidence.length, oldValue: evidence }], ...fields };
}

function paragraphRule(source, fields = {}) {
  return { ...lockedRule(source, source), paragraphRewrite: true,
    authorizedRanges: [{ startOffset: 0, endOffset: source.length, oldValue: source, paragraphRewrite: true,
      oldValues: ['五峰村', '965宗'], targetRequirements: ['横泾街道约3082宗，其中已调查2862宗、未调查220宗'] }], ...fields };
}

test('完整短章段落按招标事实重写，允许改变多个地区描述和数量', () => {
  const source = '五峰村由旧合作社组织，人口1000人，工作量965宗。';
  const next = '横泾街道约3082宗，其中已调查2862宗、未调查220宗。';
  const result = applyAuthorizedLocalEdits(source, [paragraphRule(source)], [{ old_text: source, new_text: next }]);
  assert.equal(result.content, next);
  assert.deepEqual(result.errors, []);
});

test('段落已要求按招标工作量重写时拒绝沿用未被招标支持的旧宗数', () => {
  const source = '五峰村情况。工作量965宗，保留调查方法。';
  const next = '横泾街道情况。工作量965宗，保留调查方法。';
  const rule = paragraphRule(source, { authorizedRanges: [{ startOffset: 0, endOffset: source.length,
    oldValue: source, paragraphRewrite: true, oldValues: [],
    targetRequirements: ['横泾街道工作量约3082宗'] }] });
  const result = applyAuthorizedLocalEdits(source, [rule], [{ old_text: source, new_text: next }]);
  assert.equal(result.content, source);
  assert.match(result.errors.join('；'), /protected-fact-changed.*965宗/);
});

test('段落重写拒绝残留旧事实、模型补造数量、跨段落和部分编辑', () => {
  const source = '五峰村工作量965宗。';
  for (const next of ['五峰村工作量3082宗。', '横泾街道工作量9999宗。', '横泾街道。\n\n另一个段落。']) {
    const result = applyAuthorizedLocalEdits(source, [paragraphRule(source)], [{ old_text: source, new_text: next }]);
    assert.equal(result.content, source);
    assert.ok(result.errors.length);
  }
  const partial = applyAuthorizedLocalEdits(source, [paragraphRule(source)], [{ old_text: '五峰村', new_text: '横泾街道' }]);
  assert.equal(partial.content, source);
  assert.ok(partial.errors.length);
});

test('完整段落的重复原文按已知偏移应用，重叠模型编辑原子拒绝', () => {
  const paragraph = '五峰村工作量965宗。';
  const source = `${paragraph}\n\n${paragraph}`;
  const ranges = [0, paragraph.length + 2].map((startOffset) => ({ ...paragraphRule(paragraph).authorizedRanges[0],
    startOffset, endOffset: startOffset + paragraph.length }));
  const rule = paragraphRule(source, { authorizedRanges: ranges });
  const edits = ranges.map((range) => ({ old_text: paragraph, new_text: '横泾街道工作量3082宗。', start_offset: range.startOffset }));
  assert.equal(applyAuthorizedLocalEdits(source, [rule], edits).content, '横泾街道工作量3082宗。\n\n横泾街道工作量3082宗。');
  const overlap = applyAuthorizedLocalEdits(source, [rule], [...edits, edits[0]]);
  assert.equal(overlap.content, source);
  assert.match(overlap.errors.join(';'), /overlap/);
});

test('模型只可改锁定片段，片段外小范围润色也原子拒绝', () => {
  const source = '原服务流程。保留既有工作方法。' + '保留保障措施。'.repeat(12);
  const rule = lockedRule(source, '原服务流程。');
  const valid = applyAuthorizedLocalEdits(source, [rule], [{ old_text: '原服务流程。', new_text: '新服务流程。' }]);
  assert.equal(valid.content, source.replace('原服务流程。', '新服务流程。'));
  const invalid = applyAuthorizedLocalEdits(source, [rule], [
    { old_text: '原服务流程。', new_text: '新服务流程。' },
    { old_text: '保留既有工作方法', new_text: '优化既有工作方法' },
  ]);
  assert.equal(invalid.content, source);
  assert.match(invalid.errors.join('；'), /non-local-edit/);
});

test('目标要求提及其他同类事实不能授权改动无关事实', () => {
  const evidence = '原流程配置10人和2台设备。';
  const source = evidence + '保留保障。'.repeat(100);
  const result = applyAuthorizedLocalEdits(source, [lockedRule(source, evidence, { targetRequirement: '流程更新后安排12人和3台设备' })],
    [{ old_text: evidence, new_text: '新流程配置12人和3台设备。' }]);
  assert.equal(result.content, source);
  assert.match(result.errors.join('；'), /protected-fact-changed/);
});

test('同一授权段落内未关联句子不允许润色', () => {
  const evidence = '原服务流程。既有保障保持稳定。';
  const source = evidence + '保留保障。'.repeat(100);
  const result = applyAuthorizedLocalEdits(source, [lockedRule(source, evidence, { oldContentEvidence: ['原服务流程'] })],
    [{ old_text: evidence, new_text: '新服务流程。既有保障更加稳定。' }]);
  assert.equal(result.content, source);
  assert.match(result.errors.join('；'), /non-local-edit/);
});

test('完整旧服务事项存在未删除位置时删除原子失败', () => {
  const source = '旧服务事项。保留。旧服务事项。';
  const result = applyAuthorizedLocalEdits(source, [{ id: 'remove', targetAction: 'remove', oldContentEvidence: ['旧服务事项'],
    authorizedRanges: [{ startOffset: 0, endOffset: 6, oldValue: '旧服务事项。' }] }]);
  assert.equal(result.content, source);
  assert.match(result.errors.join('；'), /residual-old-value/);
});

test('混合精确替换与片段改写一起提交，任一失败不提交确定性替换', () => {
  const source = '五峰村。原服务流程。' + '保留工作方法。'.repeat(20);
  const rules = [
    { id: 'place', targetAction: 'replace', replacements: [{ oldValue: '五峰村', newValue: '横泾街道' }],
      authorizedRanges: [{ startOffset: 0, endOffset: 3, oldValue: '五峰村' }] },
    lockedRule(source, '原服务流程。'),
  ];
  const result = applyAuthorizedLocalEdits(source, rules, [{ old_text: '原服务流程。', new_text: '新服务流程。' }]);
  assert.equal(result.content, source.replace('五峰村', '横泾街道').replace('原服务流程。', '新服务流程。'));
  const invalid = applyAuthorizedLocalEdits(source, rules, [{ old_text: '不存在', new_text: '新服务流程。' }]);
  assert.equal(invalid.content, source);
  assert.equal(invalid.changed, false);
});

test('模型不得改未授权人员金额百分比日期或地点事实', () => {
  const evidence = '原流程配置10人、2台设备、20万元、30%、2026年6月、五峰村。';
  const source = evidence + '保留工作方法。'.repeat(100);
  for (const [oldValue, newValue] of [['10人', '12人'], ['2台', '3台'], ['20万元', '30万元'], ['30%', '40%'], ['2026年6月', '2026年7月'], ['五峰村', '横泾街道']]) {
    const result = applyAuthorizedLocalEdits(source, [lockedRule(source, evidence)], [{ old_text: evidence, new_text: evidence.replace(oldValue, newValue) }]);
    assert.equal(result.content, source);
    assert.match(result.errors.join('；'), /protected-fact-changed/);
  }
});

test('模型 edit 不得跨 Markdown 保护边界，不得超单项20%和总计35%', () => {
  const evidence = '旧流程。';
  const source = evidence.repeat(20);
  const rule = lockedRule(source, source);
  const whole = applyAuthorizedLocalEdits(source, [rule], [{ old_text: source, new_text: '新正文。' }]);
  assert.match(whole.errors.join('；'), /non-local-edit/);
  const protectedSource = '旧流程。\n```mermaid\ngraph TD\nA-->B\n```\n' + '保留正文。'.repeat(100);
  const protectedEdit = protectedSource.slice(0, protectedSource.indexOf('保留正文。'));
  const protectedResult = applyAuthorizedLocalEdits(protectedSource, [lockedRule(protectedSource, protectedEdit)], [{ old_text: protectedEdit, new_text: '新流程。' }]);
  assert.match(protectedResult.errors.join('；'), /non-local-edit/);
  const inside = applyAuthorizedLocalEdits(protectedSource, [lockedRule(protectedSource, 'A-->B')], [{ old_text: 'A-->B', new_text: 'A-->C' }]);
  assert.equal(inside.content, protectedSource);
  assert.match(inside.errors.join('；'), /non-local-edit/);
  const parts = Array.from({ length: 10 }, (_, index) => `${index}${'保留'.repeat(4)}。`);
  const combinedSource = parts.join('');
  const combinedRules = parts.slice(0, 4).map((part, index) => lockedRule(combinedSource, part, { id: `part-${index}` }));
  const combined = applyAuthorizedLocalEdits(combinedSource, combinedRules, parts.slice(0, 4).map((part) => ({ old_text: part, new_text: part.replace('保留', '更新') })));
  assert.equal(combined.content, combinedSource);
  assert.match(combined.errors.join('；'), /35%/);
});
