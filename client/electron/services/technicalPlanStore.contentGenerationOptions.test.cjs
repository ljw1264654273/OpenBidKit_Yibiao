const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function createStore(app, db) {
  return createTechnicalPlanStore({
    app,
    db,
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
}

async function runPersistenceAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-content-options-'));
  let database;
  let restartedDatabase;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const generatedImagePath = path.join(userDataPath, 'workspace', 'generated-images', 'old.png');
    fs.mkdirSync(path.dirname(generatedImagePath), { recursive: true });
    fs.writeFileSync(generatedImagePath, 'fixture');
    const store = createStore(app, database.db);
    const imageMarkdown = '![AI Mermaid redraw](yibiao-asset://generated-images/old.png)';
    const outlineContent = `Outline text.\n\n${imageMarkdown}`;
    const sectionContent = `Section text.\n\n${imageMarkdown}`;
    const outlineData = {
      project_overview: 'Persistence fixture',
      outline: [{ id: '1.1', title: 'Implementation flow', content: outlineContent }],
    };

    store.saveOutline({ outlineData, reason: 'replace' });
    store.updateTechnicalPlan({
      contentGenerationSections: {
        '1.1': { id: '1.1', title: 'Implementation flow', status: 'success', content: sectionContent },
      },
      contentIllustrationPlan: {
        plan_version: 1,
        revision: 'before-redraw',
        items: [{
          item_id: 'mermaid-1',
          kind: 'mermaid',
          image_type: 'process',
          title: 'Implementation flow',
          section_ids: ['1.1'],
          placement: 'after',
          generation: { status: 'success', asset_url: 'yibiao-asset://generated-images/old.png' },
        }],
      },
    });
    assert.equal(store.loadTechnicalPlan().contentGenerationSections['1.1'].content, sectionContent);
    store.updateTechnicalPlan({ outlineData });

    const beforeSave = store.loadTechnicalPlan();
    assert.equal(beforeSave.contentIllustrationPlan.items[0].generation.asset_url, 'yibiao-asset://generated-images/old.png');
    assert.equal(beforeSave.contentGenerationSections['1.1'].content, outlineContent);
    assert.equal(beforeSave.outlineData.outline[0].content, outlineContent);
    assert.equal(database.db.prepare('SELECT status FROM technical_plan_content_sections WHERE node_id = ?').get('1.1').status, 'success');

    const result = store.saveContentGenerationOptions({ useAiRedesignForMermaid: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(result.contentGenerationOptions, { useAiRedesignForMermaid: true });
    assert.equal(result.contentIllustrationPlan, undefined);
    assert.equal(fs.existsSync(generatedImagePath), true);

    const afterSave = store.loadTechnicalPlan();
    assert.deepEqual(afterSave.contentGenerationOptions, { useAiRedesignForMermaid: true });
    assert.equal(afterSave.contentIllustrationPlan, undefined);
    assert.equal(afterSave.contentGenerationSections['1.1'].content, outlineContent);
    assert.equal(afterSave.outlineData.outline[0].content, outlineContent);
    assert.equal(database.db.prepare('SELECT status FROM technical_plan_content_sections WHERE node_id = ?').get('1.1').status, 'success');

    database.close();
    database = null;
    restartedDatabase = createSqliteDatabase(app);
    const restarted = createStore(app, restartedDatabase.db).loadTechnicalPlan();
    assert.deepEqual(restarted.contentGenerationOptions, { useAiRedesignForMermaid: true });
    assert.equal(restarted.contentIllustrationPlan, undefined);
    assert.equal(restarted.contentGenerationSections['1.1'].content, outlineContent);
    assert.equal(restarted.outlineData.outline[0].content, outlineContent);
  } finally {
    database?.close();
    restartedDatabase?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

async function runMermaidReviewPersistenceAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-mermaid-review-'));
  let database;
  let restartedDatabase;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const store = createStore(app, database.db);
    const reviewGeneration = {
      status: 'reviewing',
      code: 'flowchart TD\n  A["开始"] --> B["结束"]',
      draft_code: 'flowchart TD\n  A["开始"] --> B["结束"]',
      review_status: 'pending',
      review_error: '旧错误',
      reviewed_at: '2026-09-13T00:00:00.000Z',
      attempts: 1,
    };

    store.updateTechnicalPlan({
      contentIllustrationPlan: {
        plan_version: 1,
        revision: 'review-state',
        items: [{
          item_id: 'mermaid-review-1',
          kind: 'mermaid',
          image_type: 'process',
          title: '审核流程',
          section_ids: ['1.1'],
          placement: 'after',
          generation: reviewGeneration,
        }],
      },
    });

    database.close();
    database = null;
    restartedDatabase = createSqliteDatabase(app);
    const restarted = createStore(app, restartedDatabase.db).loadTechnicalPlan();
    assert.deepEqual(restarted.contentIllustrationPlan.items[0].generation, reviewGeneration);
  } finally {
    database?.close();
    restartedDatabase?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

async function runMermaidReviewActionAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-mermaid-review-actions-'));
  let database;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const store = createStore(app, database.db);
    store.updateTechnicalPlan({
      contentIllustrationPlan: {
        plan_version: 1,
        revision: 'review-actions',
        items: [{
          item_id: 'mermaid-review-1',
          kind: 'mermaid',
          image_type: 'process',
          title: '审核流程',
          section_ids: ['1.1'],
          placement: 'after',
          generation: {
            status: 'success',
            code: 'flowchart TD\n  A["旧代码"] --> B["旧结果"]',
            draft_code: 'flowchart TD\n  A["初稿"] --> B["结果"]',
            review_status: 'pending',
            asset_url: 'yibiao-asset://generated-images/old.png',
            source_path: 'technical-plan/old.html',
            error: '旧错误',
            attempts: 2,
          },
        }],
      },
    });

    const saveResult = store.saveMermaidReviewCode({
      itemId: 'mermaid-review-1',
      code: 'flowchart TD\n  A["保存草稿"] --> B["等待确认"]',
    });
    assert.equal(saveResult.contentIllustrationPlan.items[0].generation.status, 'reviewing');
    assert.equal(saveResult.contentIllustrationPlan.items[0].generation.review_status, 'pending');
    assert.equal(saveResult.contentIllustrationPlan.items[0].generation.code, 'flowchart TD\n  A["保存草稿"] --> B["等待确认"]');

    const confirmResult = store.confirmMermaidReviewItem({
      itemId: 'mermaid-review-1',
      code: 'flowchart TD\n  A["确认代码"] --> B["进入重绘"]',
    });
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.status, 'pending');
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.code, 'flowchart TD\n  A["确认代码"] --> B["进入重绘"]');
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.draft_code, 'flowchart TD\n  A["初稿"] --> B["结果"]');
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.review_status, 'confirmed');
    assert.match(confirmResult.contentIllustrationPlan.items[0].generation.reviewed_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.asset_url, undefined);
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.source_path, undefined);
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.error, undefined);
    assert.equal(confirmResult.contentIllustrationPlan.items[0].generation.attempts, undefined);

    const skipResult = store.skipMermaidReviewItem({ itemId: 'mermaid-review-1' });
    assert.equal(skipResult.contentIllustrationPlan.items[0].generation.status, 'skipped');
    assert.equal(skipResult.contentIllustrationPlan.items[0].generation.review_status, 'skipped');
    assert.equal(skipResult.contentIllustrationPlan.items[0].generation.asset_url, undefined);
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  const run = process.argv.includes('--mermaid-review')
    ? runMermaidReviewPersistenceAssertions
    : process.argv.includes('--mermaid-review-actions')
      ? runMermaidReviewActionAssertions
    : runPersistenceAssertions;
  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode || 0));
} else {
  test('saving Mermaid AI redraw options invalidates only illustration metadata', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native persistence test timed out'}`);
  });

  test('Mermaid review generation fields persist across restart', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native', '--mermaid-review'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native persistence test timed out'}`);
  });

  test('Mermaid review actions update generation state and clear stale redraw output', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native', '--mermaid-review-actions'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native persistence test timed out'}`);
  });
}
