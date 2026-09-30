const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOutlineAdjustmentSaveRequest } = require('./outlineAdjustmentDiff.cjs');

const before = { outline: [
  { id: '1', origin_id: 'existing-1', title: 'A', description: 'A desc', attr: '技术', children: [
    { id: '1.1', origin_id: 'existing-2', title: 'A1', description: 'A1 desc', content_mode: 'ai-generate' },
    { id: '1.2', origin_id: 'existing-3', title: 'A2', description: 'A2 desc', content_mode: 'ai-generate' },
  ] },
  { id: '2', origin_id: 'existing-4', title: 'B', description: 'B desc', attr: '其他', children: [
    { id: '2.1', origin_id: 'existing-5', title: 'B1', description: 'B1 desc', content_mode: 'ai-generate' },
  ] },
] };

test('pure reorder retains every identity and maps old ids to new ids', () => {
  const after = structuredClone(before);
  after.outline.reverse();
  after.outline[0].id = '1';
  after.outline[0].children[0].id = '1.1';
  after.outline[1].id = '2';
  after.outline[1].children[0].id = '2.1';
  after.outline[1].children[1].id = '2.2';
  const result = buildOutlineAdjustmentSaveRequest({ before, after });
  assert.equal(result.reason, 'sort');
  assert.deepEqual(result.idMap, { '1': '2', '1.1': '2.1', '1.2': '2.2', '2': '1', '2.1': '1.1' });
  assert.deepEqual(result.affectedNodeIds, []);
});

test('editing a parent invalidates its old descendant closure', () => {
  const after = structuredClone(before);
  after.outline[0].title = 'Changed';
  const result = buildOutlineAdjustmentSaveRequest({ before, after });
  assert.equal(result.reason, 'edit');
  assert.deepEqual(result.affectedNodeIds.sort(), ['1', '1.1', '1.2']);
});

test('moving a child invalidates its old subtree', () => {
  const after = structuredClone(before);
  const moved = after.outline[0].children.pop();
  moved.id = '2.2';
  after.outline[1].children.push(moved);
  assert.deepEqual(buildOutlineAdjustmentSaveRequest({ before, after }).affectedNodeIds, ['1.2']);
});

test('missing, duplicate, forged and invalid new origin ids are rejected', () => {
  const candidates = Array.from({ length: 4 }, () => structuredClone(before));
  delete candidates[0].outline[0].origin_id;
  candidates[1].outline[0].children[0].origin_id = 'existing-1';
  candidates[2].outline[0].children[0].origin_id = 'existing-99';
  candidates[3].outline[0].children[0].origin_id = 'new-0';
  for (const after of candidates) {
    assert.throws(() => buildOutlineAdjustmentSaveRequest({ before, after }), /origin_id|节点身份/);
  }
});
