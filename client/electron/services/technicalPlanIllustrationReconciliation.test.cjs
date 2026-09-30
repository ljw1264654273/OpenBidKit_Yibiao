const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reconcileIllustrationItems,
  removeIllustrationBlock,
  getIllustrationTargetNodeId,
} = require('./technicalPlanIllustrationReconciliation.cjs');

const leaf = (id) => ({ id, title: id });
const outline = (groups) => ({ outline: groups.map((ids, index) => ({
  id: String(index + 1), children: ids.map(leaf),
})) });
const previousOutline = outline([['1.1', '1.2', '1.3'], ['2.1']]);
const item = (ids, placement = 'after', kind = 'html') => ({
  item_id: 'html-1', kind, section_ids: ids, placement,
  generation: { status: 'success', review_status: 'confirmed', redraw_asset_url: 'candidate.png' },
});
const reconcile = (entry, nextOutline, idMap, affectedIds = new Set()) => reconcileIllustrationItems({
  items: [entry], previousOutline, nextOutline,
  idMap: new Map(Object.entries({ '1': '1', '2': '2', ...idMap })), affectedIds,
});

test('single-section item follows identity and retains review fields', () => {
  const entry = item(['1.1']);
  const result = reconcile(entry, outline([['1.1'], ['2.1']]), { '1.1': '2.1' });
  assert.equal(result.droppedItems.length, 0);
  assert.deepEqual(result.keptItems[0], { ...entry, section_ids: ['2.1'] });
});

test('affected, deleted and reused numeric ids do not preserve an item', () => {
  assert.equal(reconcile(item(['1.1']), previousOutline, { '1.1': '1.1' }, new Set(['1.1'])).keptItems.length, 0);
  assert.equal(reconcile(item(['1.1']), previousOutline, {}).keptItems.length, 0);
  assert.equal(reconcile(item(['1.1']), previousOutline, { '1.1': '9.9' }).keptItems.length, 0);
});

test('multi-section item remains ordered and contiguous under a shared parent', () => {
  const entry = item(['1.1', '1.2']);
  const next = outline([['1.1', '1.2', '1.3'], ['2.1']]);
  assert.equal(reconcile(entry, next, { '1.1': '1.2', '1.2': '1.3' }).keptItems.length, 1);
  assert.equal(reconcile(entry, next, { '1.1': '1.1', '1.2': '1.3' }).droppedItems.length, 1);
  assert.equal(reconcile(entry, next, { '1.1': '1.2', '1.2': '1.1' }).droppedItems.length, 1);
  assert.equal(reconcile(entry, next, { '1.1': '1.3', '1.2': '2.1' }).droppedItems.length, 1);
  assert.equal(reconcile(entry, outline([['1.3'], ['2.1', '2.2']]),
    { '1.1': '2.1', '1.2': '2.2' }).droppedItems.length, 1);
});

test('multi-section before uses first storage target, after uses last', () => {
  const before = item(['1.1', '1.2'], 'before');
  const after = item(['1.1', '1.2']);
  assert.equal(getIllustrationTargetNodeId(before), '1.1');
  assert.equal(getIllustrationTargetNodeId(after), '1.2');
  assert.equal(reconcile(before, previousOutline, { '1.1': '1.1', '1.2': '1.2' }).keptItems.length, 1);
  assert.equal(reconcile(after, previousOutline, { '1.1': '1.1', '1.2': '1.2' }).keptItems.length, 1);
  assert.equal(reconcile(item(['1.1', '1.2'], 'before', 'mermaid'), previousOutline,
    { '1.1': '1.1', '1.2': '1.2' }).droppedItems.length, 1);
});

test('only matching illustration marker is removed and whitespace normalized', () => {
  const block = (id) => `<!-- yibiao-illustration:start id="${id}" -->\n![图](a.png)\n<!-- yibiao-illustration:end -->`;
  const content = `前文\n\n${block('html-1')}\n\n${block('html-2')}\n\n后文`;
  const cleaned = removeIllustrationBlock(content, 'html-1');
  assert.doesNotMatch(cleaned, /start id="html-1"/);
  assert.match(cleaned, /start id="html-2"/);
  assert.equal(removeIllustrationBlock(content, 'missing'), content);
  assert.equal(removeIllustrationBlock(`前文\n\n${block('html-1')}\n\n后文`, 'html-1'), '前文\n\n后文');
  assert.equal(removeIllustrationBlock(block('id[1]'), 'id[1]'), '');
});
