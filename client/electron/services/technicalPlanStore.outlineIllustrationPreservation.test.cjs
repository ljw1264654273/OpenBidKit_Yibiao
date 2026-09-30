const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

const block = (id, url) => `<!-- yibiao-illustration:start id="${id}" -->\n![图](${url})\n<!-- yibiao-illustration:end -->`;
const leaf = (id, content = '') => ({ id, title: `章节${id}`, description: `说明${id}`, content_mode: 'ai-generate', content });
const roots = (first = [leaf('1.1'), leaf('1.2')], second = [leaf('2.1')]) => ({ outline: [
  { id: '1', title: '第一章', description: '说明一', attr: '技术', children: first },
  { id: '2', title: '第二章', description: '说明二', attr: '技术', children: second },
] });
const image = (id, ids, sourcePath, assetUrl, placement = 'after') => ({
  item_id: id, kind: 'html', image_type: 'diagram', title: id, section_ids: ids, placement,
  generation: {
    status: 'success', review_status: 'confirmed', source_path: sourcePath,
    original_source_path: sourcePath, redraw_source_path: sourcePath,
    asset_url: assetUrl, original_asset_url: assetUrl, redraw_asset_url: assetUrl,
  },
});

async function withStore(callback) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-outline-pictures-'));
  const app = { getPath: () => userData, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const events = [];
    const store = createTechnicalPlanStore({
      app, db: database.db, agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {} }, configStore: { load: () => ({}) },
      onContentChanged: (event) => events.push(event),
    });
    await callback({ store, userData, events });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    database?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

function seed(store, content1 = '正文一', content2 = '正文二', entries = [], third = false) {
  store.saveOutline({ outlineData: roots([leaf('1.1', content1), leaf('1.2', content2), ...(third ? [leaf('1.3', '正文四')] : [])], [leaf('2.1', '正文三')]), reason: 'replace' });
  store.updateTechnicalPlan({
    contentGenerationSections: {
      '1.1': { status: 'success', content: content1 },
      '1.2': { status: 'success', content: content2 },
      '2.1': { status: 'success', content: '正文三' },
      ...(third ? { '1.3': { status: 'success', content: '正文四' } } : {}),
    },
    contentGenerationPlans: {
      '1.1': { plan_version: 1, plan: { title: '一' } },
      '2.1': { plan_version: 1, plan: { title: '三' } },
    },
    contentIllustrationPlan: { plan_version: 1, revision: 'review', items: entries },
    contentGenerationTask: { task_id: 'content-1', status: 'success', progress: 100 },
    contentGenerationRuntime: { cursor: '2.1' },
  });
}

async function runAssertions() {
  await withStore(async ({ store, userData, events }) => {
    const keepUrl = 'yibiao-asset://generated-images/keep.png';
    const dropUrl = 'yibiao-asset://generated-images/drop.png';
    const staleUrl = 'yibiao-asset://generated-images/stale.png';
    const keepPath = 'illustrations/review/html/keep.html';
    const dropPath = 'illustrations/review/html/drop.html';
    const redrawPath = 'illustrations/review/html/redraw.html';
    const sharedPath = 'illustrations/review/html/shared.html';
    const outsidePath = 'outside.html';
    const dir = path.join(userData, 'workspace', 'technical-plan', 'illustrations', 'review', 'html');
    const generatedDir = path.join(userData, 'workspace', 'generated-images');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep.html'), 'keep', 'utf8');
    fs.writeFileSync(path.join(dir, 'drop.html'), 'drop', 'utf8');
    fs.writeFileSync(path.join(dir, 'redraw.html'), 'redraw', 'utf8');
    fs.writeFileSync(path.join(dir, 'shared.html'), 'shared', 'utf8');
    fs.writeFileSync(path.join(userData, 'workspace', 'technical-plan', outsidePath), 'outside', 'utf8');
    fs.writeFileSync(path.join(generatedDir, 'drop.png'), 'shared');
    fs.writeFileSync(path.join(generatedDir, 'stale.png'), 'stale');
    seed(store, `正文一\n\n${block('drop', dropUrl)}`, '正文二', [
      { ...image('drop', ['1.1'], dropPath, dropUrl), generation: {
        ...image('drop', ['1.1'], dropPath, dropUrl).generation,
        original_source_path: sharedPath, redraw_source_path: redrawPath, redraw_asset_url: staleUrl,
      } },
      { ...image('keep', ['2.1'], keepPath, keepUrl), generation: {
        ...image('keep', ['2.1'], keepPath, keepUrl).generation,
        original_source_path: sharedPath, original_asset_url: dropUrl,
      } },
      image('outside', ['1.1'], outsidePath, '', 'after'),
    ]);
    const edited = roots([leaf('1.1'), leaf('1.2')], [leaf('2.1')]);
    edited.outline[0].children[0].title = '修改后的章节';
    const saved = store.saveOutline({ outlineData: edited, reason: 'edit', affectedNodeIds: ['1.1'],
      idMap: { '1': '1', '1.1': '1.1', '1.2': '1.2', '2': '2', '2.1': '2.1' } });
    assert.equal(saved.contentGenerationSections['1.1'], undefined);
    assert.equal(saved.contentGenerationSections['2.1'].status, 'success');
    assert.ok(saved.contentGenerationPlans['2.1']);
    assert.deepEqual(saved.contentIllustrationPlan.items.map((entry) => entry.item_id), ['keep']);
    assert.equal(saved.contentIllustrationPlan.items[0].generation.redraw_asset_url, keepUrl);
    assert.equal(fs.existsSync(path.join(dir, 'drop.html')), false);
    assert.equal(fs.existsSync(path.join(dir, 'redraw.html')), false);
    assert.equal(fs.existsSync(path.join(dir, 'shared.html')), true);
    assert.equal(fs.existsSync(path.join(dir, 'keep.html')), true);
    assert.equal(fs.existsSync(path.join(userData, 'workspace', 'technical-plan', outsidePath)), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fs.existsSync(path.join(generatedDir, 'drop.png')), true);
    assert.equal(fs.existsSync(path.join(generatedDir, 'stale.png')), false);
    assert.deepEqual(store.loadTechnicalPlan().contentIllustrationPlan.items.map((entry) => entry.item_id), ['keep']);
    assert.ok(events.some((event) => event.origin === 'manual'));
  });

  await withStore(async ({ store, events }) => {
    const url = 'yibiao-asset://generated-images/cross.png';
    const crossBlock = block('cross', url);
    seed(store, '正文一', `前文\n\n${crossBlock}\n\n后文`, [image('cross', ['1.1', '1.2'], '', url)]);
    const saved = store.saveOutline({ outlineData: roots(), reason: 'edit', affectedNodeIds: ['1.1'],
      idMap: { '1': '1', '1.1': '1.1', '1.2': '1.2', '2': '2', '2.1': '2.1' } });
    assert.equal(Object.hasOwn(saved, 'contentIllustrationPlan'), true);
    assert.equal(saved.contentIllustrationPlan, undefined);
    assert.doesNotMatch(saved.contentGenerationSections['1.2'].content, /yibiao-illustration:start/);
    assert.ok(events.some((event) => event.nodeIds?.includes('1.2')));
  });

  await withStore(async ({ store, events }) => {
    const url = 'yibiao-asset://generated-images/before.png';
    seed(store, `前文\n\n${block('before', url)}\n\n后文`, '正文二',
      [image('before', ['1.1', '1.2'], '', url, 'before')]);
    const saved = store.saveOutline({ outlineData: roots(), reason: 'edit', affectedNodeIds: ['1.2'],
      idMap: { '1': '1', '1.1': '1.1', '1.2': '1.2', '2': '2', '2.1': '2.1' } });
    assert.equal(saved.contentIllustrationPlan, undefined);
    assert.doesNotMatch(saved.outlineData.outline[0].children[0].content, /yibiao-illustration:start/);
    assert.ok(events.some((event) => event.nodeIds?.includes('1.1')));
  });

  await withStore(async ({ store }) => {
    seed(store, '正文一', '正文二', [image('child', ['1.1'], '', 'yibiao-asset://generated-images/child.png'),
      image('keep', ['2.1'], '', 'yibiao-asset://generated-images/keep.png')]);
    const edited = roots();
    edited.outline[0].title = '改名的父目录';
    const saved = store.saveOutline({ outlineData: edited, reason: 'edit', affectedNodeIds: ['1'],
      idMap: { '1': '1', '1.1': '1.1', '1.2': '1.2', '2': '2', '2.1': '2.1' } });
    assert.equal(saved.contentGenerationSections['1.1'], undefined);
    assert.equal(saved.contentGenerationSections['1.2'], undefined);
    assert.deepEqual(saved.contentIllustrationPlan.items.map((entry) => entry.item_id), ['keep']);
  });

  await withStore(async ({ store, events }) => {
    const url = 'yibiao-asset://generated-images/sort.png';
    seed(store, '正文一', `正文二\n\n${block('multi', url)}`, [
      image('multi', ['1.1', '1.2'], '', url), image('single', ['2.1'], '', url),
    ], true);
    const sorted = roots([leaf('1.1'), leaf('1.2'), leaf('1.3')], [leaf('2.1')]);
    const saved = store.saveOutline({ outlineData: sorted, reason: 'sort',
      idMap: { '1': '1', '1.1': '1.1', '1.2': '1.3', '1.3': '1.2', '2': '2', '2.1': '2.1' } });
    assert.deepEqual(saved.contentIllustrationPlan.items.map((entry) => entry.item_id), ['single']);
    assert.match(saved.outlineData.outline[0].children[2].content, /正文二/);
    assert.doesNotMatch(saved.outlineData.outline[0].children[2].content, /yibiao-illustration:start/);
    assert.ok(saved.contentGenerationTask);
    assert.ok(saved.contentGenerationRuntime);
    assert.ok(events.some((event) => event.nodeIds?.includes('1.3')));
  });
}

if (process.argv.includes('--electron-native')) {
  runAssertions()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => process.exit(process.exitCode || 0));
} else {
  test('outline changes preserve unrelated image review state and remove orphan blocks', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native test timed out');
  });
}
