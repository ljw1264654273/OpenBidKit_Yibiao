const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('read-only project verification records truth nodes and rejects residuals or manual changes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-project-verify-'));
  const databasePath = path.join(directory, 'yibiao.sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`CREATE TABLE bid_projects (project_id TEXT, project_name TEXT);
      INSERT INTO bid_projects VALUES ('fixture', '真实回归夹具');
      CREATE TABLE technical_plan_project_fixture_meta (original_plan_markdown_path TEXT, historical_adaptation_differences_json TEXT,
        historical_adaptation_outline_changes_json TEXT, content_items_storage_version INTEGER, historical_adaptation_content_items_json TEXT);
      CREATE TABLE technical_plan_project_fixture_outline_nodes (node_id TEXT, parent_node_id TEXT, sort_order INTEGER, title TEXT, description TEXT, content TEXT);
      CREATE TABLE technical_plan_project_fixture_bid_items (item_id TEXT, label TEXT, status TEXT, content TEXT);
      CREATE TABLE technical_plan_historical_content_items (project_id TEXT, node_id TEXT, sort_order INTEGER, item_json TEXT);
      INSERT INTO technical_plan_project_fixture_outline_nodes VALUES ('1', NULL, 0, '项目概况', '', '五峰村开展农村工作。');
      INSERT INTO technical_plan_project_fixture_outline_nodes VALUES ('2', NULL, 1, '服务保障', '', '开展农村服务。');
      INSERT INTO technical_plan_project_fixture_outline_nodes VALUES ('3', NULL, 2, '人工章节', '', '用户保存的正文。');`);
    const projectDirectory = path.join(directory, 'bid-projects', 'fixture');
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, 'original-plan.md'), '# 项目概况\n五峰村开展农村工作。\n# 服务保障\n开展农村服务。\n# 人工章节\n历史人工章节。', 'utf8');
    const difference = { id: 'location', decision: 'confirmed', category: '名称地点替换', priority: 'high', title: '地点',
      content_change_scope: 'location-target', difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value',
      confidence: 'high', replacements: [{ old_value: '五峰村', new_value: '横泾街道' }], old_content_evidence: [], tender_requirement: '横泾街道', action: '替换地点' };
    db.prepare('INSERT INTO technical_plan_project_fixture_meta VALUES (?, ?, ?, 1, NULL)').run('original-plan.md', JSON.stringify([difference]), '[]');
    const insert = db.prepare('INSERT INTO technical_plan_historical_content_items VALUES (?, ?, ?, ?)');
    for (const [index, mode] of ['local-rewrite', 'direct', 'direct'].entries()) {
      insert.run('fixture', String(index + 1), index, JSON.stringify({ node_id: String(index + 1), recommended_mode: mode,
        status: 'success', content_origin: index === 2 ? 'manual' : 'migrated' }));
    }
    let runIndex = 0;
    let output;
    const run = (...args) => spawnSync(process.execPath, ['--no-warnings', '--experimental-sqlite',
      path.join(__dirname, 'verify_historical_adaptation_project.cjs'), '--database', databasePath, '--project-id', 'fixture',
      '--output', output = path.join(directory, `report-${runIndex++}.json`), ...args], { encoding: 'utf8' });
    const before = run();
    assert.equal(before.status, 0, before.stderr);
    const baseline = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.deepEqual(baseline.fivePeakSourceNodes, ['1']);
    assert.equal(baseline.nodes[0].expectedMode, 'local-rewrite');
    assert.deepEqual(baseline.genericFalseMatchNodes, []);
    const baselinePath = path.join(directory, 'baseline.json');
    fs.copyFileSync(output, baselinePath);
    assert.notEqual(run('--baseline', baselinePath).status, 0, 'old value residual must fail after verification');
    db.prepare("UPDATE technical_plan_project_fixture_outline_nodes SET content = '横泾街道开展农村工作。' WHERE node_id = '1'").run();
    assert.equal(run('--baseline', baselinePath).status, 0);
    db.prepare("UPDATE technical_plan_project_fixture_outline_nodes SET content = '五峰村残留在非来源章节' WHERE node_id = '2'").run();
    assert.notEqual(run('--baseline', baselinePath).status, 0, 'all body nodes must be free of the old location');
    db.prepare("UPDATE technical_plan_project_fixture_outline_nodes SET content = '开展农村服务。' WHERE node_id = '2'").run();
    db.prepare("UPDATE technical_plan_project_fixture_outline_nodes SET content = '' WHERE node_id = '1'").run();
    assert.notEqual(run('--baseline', baselinePath).status, 0, 'empty body must not pass as a successful migration');
    db.prepare("UPDATE technical_plan_project_fixture_outline_nodes SET content = '横泾街道开展农村工作。' WHERE node_id = '1'").run();
    const successItem = JSON.parse(db.prepare("SELECT item_json FROM technical_plan_historical_content_items WHERE node_id = '1'").get().item_json);
    const updateItem = db.prepare("UPDATE technical_plan_historical_content_items SET item_json = ? WHERE node_id = '1'");
    updateItem.run(JSON.stringify({ ...successItem, status: 'error' }));
    assert.notEqual(run('--baseline', baselinePath).status, 0, 'failed task must not pass verification');
    updateItem.run(JSON.stringify(successItem));
    const sourcePath = path.join(projectDirectory, 'original-plan.md');
    const sourceBefore = fs.readFileSync(sourcePath, 'utf8');
    assert.notEqual(run('--output', sourcePath).status, 0, 'report must not overwrite an existing source');
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), sourceBefore);
    const wrongBaselinePath = path.join(directory, 'wrong-baseline.json');
    fs.writeFileSync(wrongBaselinePath, JSON.stringify({ ...baseline, projectId: 'another-project' }), 'utf8');
    assert.notEqual(run('--baseline', wrongBaselinePath).status, 0, 'baseline must belong to the same project');
    db.prepare("UPDATE technical_plan_project_fixture_outline_nodes SET content = '静默改动人工正文' WHERE node_id = '3'").run();
    assert.notEqual(run('--baseline', baselinePath).status, 0, 'manual body hash must remain unchanged');
    assert.equal(db.prepare('SELECT count(*) AS count FROM technical_plan_historical_content_items').get().count, 3);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
