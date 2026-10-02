const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { getTechnicalPlanProjectTablePrefix } = require('../electron/services/sqliteDatabase.cjs');
const { normalizeHistoricalAdaptationDifferences, hasStructuredDifferenceContract } = require('../electron/services/historicalAdaptationDifferenceTask.cjs');
const { buildHistoricalContentItems } = require('../electron/services/historicalAdaptationContentTask.cjs');
const { buildHistoricalSourceIndex, locateHistoricalSection } = require('../electron/services/historicalSourceIndex.cjs');

const parse = (value, fallback) => value ? JSON.parse(value) : fallback;
const hash = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const quote = (value) => `"${value.replace(/"/g, '""')}"`;

function verifyProject({ database, projectId, baseline }) {
  if (baseline && baseline.projectId !== projectId) throw new Error('基线与当前项目不一致');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const project = db.prepare('SELECT project_id, project_name FROM bid_projects WHERE project_id = ?').get(projectId);
    if (!project) throw new Error('项目不存在，请先只读确认项目 ID');
    const prefix = getTechnicalPlanProjectTablePrefix(projectId);
    const meta = db.prepare(`SELECT * FROM ${quote(`${prefix}meta`)}`).get();
    const rows = db.prepare(`SELECT * FROM ${quote(`${prefix}outline_nodes`)} ORDER BY sort_order`).all();
    const children = new Map();
    for (const row of rows) {
      const parent = row.parent_node_id || '';
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(row);
    }
    const outline = (parent) => (children.get(parent) || []).map((row) => ({ id: row.node_id, title: row.title,
      description: row.description, content: row.content, children: outline(row.node_id) }));
    const items = meta.content_items_storage_version === 1
      ? db.prepare('SELECT item_json FROM technical_plan_historical_content_items WHERE project_id = ? ORDER BY sort_order').all(projectId).map((row) => JSON.parse(row.item_json))
      : parse(meta.historical_adaptation_content_items_json, []);
    const bidAnalysisTasks = Object.fromEntries(db.prepare(`SELECT * FROM ${quote(`${prefix}bid_items`)}`).all().map((row) => [row.item_id,
      { label: row.label, status: row.status, content: row.content }]));
    const differences = normalizeHistoricalAdaptationDifferences(parse(meta.historical_adaptation_differences_json, []));
    const sourcePath = path.resolve(path.dirname(database), 'bid-projects', projectId, meta.original_plan_markdown_path || '');
    if (!meta.original_plan_markdown_path) throw new Error('项目没有历史来源文件');
    const originalPlan = fs.readFileSync(sourcePath, 'utf8');
    const sourceIndex = buildHistoricalSourceIndex(originalPlan);
    const expected = buildHistoricalContentItems({ originalPlan, sourceIndex, state: { outlineData: { outline: outline('') },
      historicalAdaptationContentItems: items, historicalAdaptationDifferences: differences, bidAnalysisTasks,
      historicalAdaptationOutlineChanges: parse(meta.historical_adaptation_outline_changes_json, []) } });
    const actualById = new Map(items.map((item) => [item.node_id, item]));
    const rowById = new Map(rows.map((row) => [row.node_id, row]));
    const genericTerms = ['开展农村', '展农村', '村辖区'];
    const nodes = expected.map((item) => {
      const actual = actualById.get(item.node_id);
      const source = locateHistoricalSection(sourceIndex, item.source_path);
      const content = rowById.get(item.node_id)?.content || '';
      return { nodeId: item.node_id, title: rowById.get(item.node_id)?.title, expectedMode: item.recommended_mode,
        actualMode: actual?.recommended_mode ?? null, manualMode: actual?.manual_mode, status: actual?.status,
        contentOrigin: actual?.content_origin, sourceReliable: source.reliable, sourceHash: source.contentHash,
        fivePeakSource: source.reliable && source.content.includes('五峰村'), fivePeakResidual: content.includes('五峰村'),
        genericTerms: genericTerms.filter((term) => source.content?.includes(term)), differenceIds: item.difference_ids,
        authorizedRanges: item.authorized_ranges, contentEmpty: !content.trim(), contentHash: hash(content) };
    });
    const report = { projectId, projectName: project.project_name, database, sourceVersionHash: sourceIndex.sourceVersionHash,
      schemaVersion: db.prepare('PRAGMA user_version').get().user_version,
      unconfirmedDifferenceIds: differences.filter((item) => item.decision === 'pending'
        || item.decision === 'confirmed' && !hasStructuredDifferenceContract(item)).map((item) => item.id),
      nodes, fivePeakSourceNodes: nodes.filter((node) => node.fivePeakSource).map((node) => node.nodeId),
      genericFalseMatchNodes: nodes.filter((node) => node.genericTerms.length && node.expectedMode === 'direct'
        && node.actualMode === 'local-rewrite').map((node) => node.nodeId),
      manualHashes: Object.fromEntries(nodes.filter((node) => node.contentOrigin === 'manual').map((node) => [node.nodeId, node.contentHash])),
      errors: [] };
    if (baseline) {
      const currentById = new Map(nodes.map((node) => [node.nodeId, node]));
      for (const nodeId of baseline.fivePeakSourceNodes) {
        if (!currentById.has(nodeId) || currentById.get(nodeId).fivePeakResidual) report.errors.push(`旧地点残留或章节丢失：${nodeId}`);
      }
      for (const row of rows) {
        if (row.content?.includes('五峰村')) report.errors.push(`正文旧地点残留：${row.node_id}`);
      }
      for (const [nodeId, contentHash] of Object.entries(baseline.manualHashes)) {
        if (report.manualHashes[nodeId] !== contentHash) report.errors.push(`人工正文发生变化：${nodeId}`);
      }
      if (report.genericFalseMatchNodes.length) report.errors.push('通用短语仍有误命中');
      if (report.unconfirmedDifferenceIds.length) report.errors.push('差异结构化契约仍待用户确认');
      for (const node of nodes) {
        if (node.contentEmpty) report.errors.push(`章节正文为空：${node.nodeId}`);
        if (node.status !== 'success') report.errors.push(`章节迁移未成功：${node.nodeId}`);
        if (node.actualMode !== node.expectedMode) report.errors.push(`推荐方式不一致：${node.nodeId}`);
      }
    }
    return report;
  } finally { db.close(); }
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--database', '--project-id', '--output', '--baseline'].includes(args[index]) || !args[index + 1]) throw new Error('参数需要 --database --project-id --output，可选 --baseline');
    options[args[index].slice(2)] = args[index + 1];
  }
  if (!options.database || !options['project-id'] || !options.output || !path.isAbsolute(options.database) || !path.isAbsolute(options.output)) {
    throw new Error('必须显式传入数据库绝对路径、项目 ID 和输出绝对路径');
  }
  const database = path.resolve(options.database);
  const output = path.resolve(options.output);
  if ([database, `${database}-wal`, `${database}-shm`, options.baseline && path.resolve(options.baseline)].filter(Boolean).some((file) => file.toLowerCase() === output.toLowerCase())) {
    throw new Error('输出不能覆盖数据库或基线');
  }
  const report = verifyProject({ database, projectId: options['project-id'], baseline: options.baseline ? parse(fs.readFileSync(options.baseline, 'utf8')) : null });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ project: report.projectName, nodes: report.nodes.length, fivePeakSourceNodes: report.fivePeakSourceNodes.length,
    fivePeakResidualNodes: report.nodes.filter((node) => node.fivePeakResidual).length,
    genericFalseMatches: report.genericFalseMatchNodes.length, manualBodies: Object.keys(report.manualHashes).length,
    pendingDifferences: report.unconfirmedDifferenceIds.length, errors: report.errors, output }, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyProject };
