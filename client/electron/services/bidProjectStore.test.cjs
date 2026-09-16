const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createBidProjectStore } = require('./bidProjectStore.cjs');

function createTestStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-bid-project-'));
  const app = { getPath: () => root };
  const db = new Database(':memory:');
  const store = createBidProjectStore({ app, db });
  return { root, db, store };
}

function createSourceFile() {
  return {
    fileName: '招标文件.docx',
    fileHash: 'file-hash',
    contentHash: 'content-hash',
    size: 120,
    modifiedAt: '2026-09-14T00:00:00.000Z',
  };
}

function makeMatch(id, leftText, rightText, {
  leftNodeId = 'node-1',
  rightNodeId = 'node-1',
  similarity = 0.82,
} = {}) {
  return {
    id,
    similarity,
    level: 'medium',
    leftParagraph: { index: 0, text: leftText },
    rightParagraph: { index: 0, text: rightText },
    leftNodeId,
    rightNodeId,
    suggestion: {
      title: '建议改写',
      reason: '测试重复内容',
      instruction: '请按项目实际情况重新组织表达。',
    },
  };
}

test('keeps same-source projects independent and numbers new copies', () => {
  const { root, db, store } = createTestStore();
  try {
    const sourceFile = {
      fileName: '招标文件.docx',
      fileHash: 'file-hash',
      contentHash: 'content-hash',
      size: 120,
      modifiedAt: '2026-09-14T00:00:00.000Z',
    };
    const first = store.createProject({ projectName: '项目方案', sourceFile });
    const second = store.createProject({ projectName: '项目方案', sourceFile });

    assert.equal(first.sourceSequence, 1);
    assert.equal(second.sourceSequence, 2);
    assert.equal(second.projectName, '项目方案 - 第 2 份');
    assert.equal(store.getSourceMatches({ fileHash: 'file-hash' }).length, 2);

    store.updateProject(first.projectId, { projectName: '项目方案 A' });
    assert.equal(store.getProject(first.projectId).projectName, '项目方案 A');
    assert.equal(store.getProject(second.projectId).projectName, '项目方案 - 第 2 份');

    const resultId = store.saveDuplicateResult({
      leftProjectId: first.projectId,
      rightProjectId: second.projectId,
      summary: { duplicateParagraphCount: 1 },
      matches: [{ id: 'match-1' }],
    });
    assert.equal(store.loadDuplicateResult(resultId).matches.length, 1);

    fs.mkdirSync(path.join(root, 'workspace', 'bid-projects', first.projectId), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'workspace', 'bid-projects', first.projectId, 'technical-plan.txt'),
      'fixture',
      'utf8',
    );
    assert.equal(store.deleteProject(first.projectId).success, true);
    assert.equal(store.getProject(first.projectId), null);
    assert.equal(fs.existsSync(path.join(root, 'workspace', 'bid-projects', first.projectId)), false);
    assert.ok(store.getProject(second.projectId));
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lists the latest duplicate summary once for every requested project', () => {
  const { root, db, store } = createTestStore();
  try {
    const sourceFile = createSourceFile();
    const first = store.createProject({ projectName: '项目一', sourceFile });
    const second = store.createProject({ projectName: '项目二', sourceFile });
    const third = store.createProject({ projectName: '项目三', sourceFile });

    store.saveDuplicateResult({
      resultId: 'result-old',
      leftProjectId: first.projectId,
      rightProjectId: second.projectId,
      sensitivity: 'medium',
      threshold: 0.64,
      summary: { duplicateParagraphCount: 2, maxSimilarity: 0.81 },
      matches: [makeMatch('old-match', '旧段落', '旧段落')],
    });
    store.saveDuplicateResult({
      resultId: 'result-new',
      leftProjectId: second.projectId,
      rightProjectId: third.projectId,
      sensitivity: 'high',
      threshold: 0.76,
      summary: { duplicateParagraphCount: 4, maxSimilarity: 0.93 },
      matches: [makeMatch('new-match', '新段落', '新段落')],
    });

    const summaries = store.listRecentDuplicateSummaries([
      first.projectId,
      second.projectId,
      third.projectId,
      'missing-project',
    ]);

    assert.equal(summaries[first.projectId].resultId, 'result-old');
    assert.equal(summaries[first.projectId].otherProjectId, second.projectId);
    assert.equal(summaries[first.projectId].otherProjectName, second.projectName);
    assert.equal(summaries[first.projectId].duplicateParagraphCount, 2);
    assert.equal(summaries[first.projectId].maxSimilarity, 0.81);
    assert.equal(summaries[second.projectId].resultId, 'result-new');
    assert.equal(summaries[second.projectId].otherProjectId, third.projectId);
    assert.equal(summaries[second.projectId].sensitivity, 'high');
    assert.equal(summaries[third.projectId].resultId, 'result-new');
    assert.equal(summaries['missing-project'], null);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignores cross-source duplicate results when listing or opening the latest same-source result', () => {
  const { root, db, store } = createTestStore();
  try {
    const sourceFile = createSourceFile();
    const left = store.createProject({ projectName: '同源左侧', sourceFile });
    const right = store.createProject({ projectName: '同源右侧', sourceFile });
    const other = store.createProject({
      projectName: '另一来源',
      sourceFile: {
        ...sourceFile,
        fileName: '另一份招标文件.docx',
        fileHash: 'other-file-hash',
        contentHash: 'other-content-hash',
      },
    });
    const sameSourceResultId = store.saveDuplicateResult({
      resultId: 'same-source-result',
      leftProjectId: left.projectId,
      rightProjectId: right.projectId,
      summary: { duplicateParagraphCount: 1, maxSimilarity: 0.8 },
      matches: [makeMatch('same-source-match', '同源段落', '同源段落')],
    });
    db.prepare(`
      INSERT INTO bid_project_duplicate_results (
        result_id, left_project_id, right_project_id, sensitivity, status,
        summary_json, matches_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'cross-source-result',
      left.projectId,
      other.projectId,
      'high',
      'success',
      JSON.stringify({ duplicateParagraphCount: 9, maxSimilarity: 0.99, threshold: 0.76 }),
      JSON.stringify([makeMatch('cross-source-match', '跨来源段落', '跨来源段落')]),
      '2026-09-15T00:00:00.000Z',
      '2026-09-16T00:00:00.000Z',
    );

    const summaries = store.listRecentDuplicateSummaries([left.projectId, right.projectId, other.projectId]);
    assert.equal(summaries[left.projectId].resultId, sameSourceResultId);
    assert.equal(summaries[left.projectId].otherProjectId, right.projectId);
    assert.equal(summaries[other.projectId], null);
    assert.equal(store.loadLatestDuplicateResult(left.projectId).resultId, sameSourceResultId);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loads complete duplicate results and persists one match decision without changing comparison time', () => {
  const { root, db, store } = createTestStore();
  try {
    const sourceFile = createSourceFile();
    const left = store.createProject({ projectName: '左侧方案', sourceFile });
    const right = store.createProject({ projectName: '右侧方案', sourceFile });
    const resultId = store.saveDuplicateResult({
      resultId: 'result-decision',
      leftProjectId: left.projectId,
      rightProjectId: right.projectId,
      sensitivity: 'medium',
      threshold: 0.7,
      summary: { duplicateParagraphCount: 2, maxSimilarity: 0.9 },
      matches: [
        makeMatch('match-1', '第一段原文', '第一段参考'),
        makeMatch('match-2', '第二段原文', '第二段参考', { leftNodeId: 'node-2', rightNodeId: 'node-3' }),
      ],
    });
    const before = store.loadDuplicateResult(resultId);

    assert.equal(before.leftProject.projectId, left.projectId);
    assert.equal(before.rightProject.projectName, right.projectName);
    assert.equal(before.threshold, 0.7);
    assert.equal(before.matches.length, 2);

    const updated = store.updateDuplicateMatchDecision({
      resultId,
      matchId: 'match-1',
      decision: 'ignored',
      targetSide: 'none',
    });

    assert.equal(updated.matches[0].decision, 'ignored');
    assert.equal(updated.matches[0].decisionTargetSide, 'none');
    assert.ok(updated.matches[0].ignoredAt);
    assert.equal(updated.matches[1].decision, undefined);
    assert.equal(updated.updatedAt, before.updatedAt);
    assert.throws(
      () => store.updateDuplicateMatchDecision({
        resultId,
        matchId: 'missing-match',
        decision: 'ignored',
        targetSide: 'none',
      }),
      /未找到查重重复组/,
    );
    assert.throws(
      () => store.updateDuplicateMatchDecision({
        resultId: 'missing-result',
        matchId: 'match-1',
        decision: 'ignored',
        targetSide: 'none',
      }),
      /未找到查重结果/,
    );
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inherits decisions across reversed projects and reordered paragraphs without cross-matching same-node paragraphs', () => {
  const { root, db, store } = createTestStore();
  try {
    const sourceFile = createSourceFile();
    const first = store.createProject({ projectName: '方案甲', sourceFile });
    const second = store.createProject({ projectName: '方案乙', sourceFile });
    const previousId = store.saveDuplicateResult({
      resultId: 'result-previous',
      leftProjectId: first.projectId,
      rightProjectId: second.projectId,
      sensitivity: 'medium',
      threshold: 0.64,
      summary: { duplicateParagraphCount: 2, maxSimilarity: 0.9 },
      matches: [
        makeMatch('previous-a', '甲方段落 A', '乙方段落 A', { leftNodeId: 'node-shared', rightNodeId: 'node-shared' }),
        makeMatch('previous-b', '甲方段落 B', '乙方段落 B', { leftNodeId: 'node-shared', rightNodeId: 'node-shared' }),
      ],
    });
    store.updateDuplicateMatchDecision({
      resultId: previousId,
      matchId: 'previous-a',
      decision: 'ignored',
      targetSide: 'none',
    });
    store.updateDuplicateMatchDecision({
      resultId: previousId,
      matchId: 'previous-b',
      decision: 'rewritten',
      targetSide: 'left',
      rewriteDraft: '甲方段落 B 的改写稿',
    });
    const previous = store.loadDuplicateResult(previousId);

    const nextId = store.saveDuplicateResult({
      resultId: 'result-reversed',
      leftProjectId: second.projectId,
      rightProjectId: first.projectId,
      sensitivity: 'medium',
      threshold: 0.71,
      summary: { duplicateParagraphCount: 2, maxSimilarity: 0.91 },
      matches: [
        makeMatch('next-b', '乙方段落 B', '甲方段落 B', { leftNodeId: 'node-shared', rightNodeId: 'node-shared' }),
        makeMatch('next-a', '乙方段落 A', '甲方段落 A', { leftNodeId: 'node-shared', rightNodeId: 'node-shared' }),
      ],
    });
    const next = store.loadDuplicateResult(nextId);

    assert.equal(next.matches.find((match) => match.id === 'next-a').decision, 'ignored');
    assert.equal(next.matches.find((match) => match.id === 'next-a').decisionTargetSide, 'none');
    assert.equal(next.matches.find((match) => match.id === 'next-b').decision, 'rewritten');
    assert.equal(next.matches.find((match) => match.id === 'next-b').decisionTargetSide, 'right');
    assert.equal(next.matches.find((match) => match.id === 'next-b').rewriteDraft, '甲方段落 B 的改写稿');
    assert.equal(next.threshold, 0.71);
    assert.equal(previous.matches.length, 2);

    const noCrossMatchId = store.saveDuplicateResult({
      resultId: 'result-no-cross-match',
      leftProjectId: first.projectId,
      rightProjectId: second.projectId,
      sensitivity: 'medium',
      threshold: 0.64,
      summary: { duplicateParagraphCount: 1, maxSimilarity: 0.89 },
      matches: [
        makeMatch('only-b', '甲方段落 B', '乙方段落 B', { leftNodeId: 'node-shared', rightNodeId: 'node-shared' }),
      ],
    });
    const noCrossMatch = store.loadDuplicateResult(noCrossMatchId);
    assert.equal(noCrossMatch.matches[0].decision, 'rewritten');
    assert.equal(noCrossMatch.matches[0].rewriteDraft, '甲方段落 B 的改写稿');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to sensitivity threshold for old rows and keeps disappeared matches out of new results', () => {
  const { root, db, store } = createTestStore();
  try {
    const sourceFile = createSourceFile();
    const left = store.createProject({ projectName: '历史左侧', sourceFile });
    const right = store.createProject({ projectName: '历史右侧', sourceFile });
    db.prepare(`
      INSERT INTO bid_project_duplicate_results (
        result_id, left_project_id, right_project_id, sensitivity, status,
        summary_json, matches_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'old-result',
      left.projectId,
      right.projectId,
      'high',
      'success',
      JSON.stringify({ duplicateParagraphCount: 1, maxSimilarity: 0.86 }),
      JSON.stringify([makeMatch('old-match', '历史段落', '历史段落')]),
      '2026-09-14T00:00:00.000Z',
      '2026-09-14T00:00:00.000Z',
    );
    assert.equal(store.loadDuplicateResult('old-result').threshold, 0.76);

    const currentId = store.saveDuplicateResult({
      resultId: 'current-result',
      leftProjectId: left.projectId,
      rightProjectId: right.projectId,
      sensitivity: 'high',
      threshold: 0.83,
      summary: { duplicateParagraphCount: 0, maxSimilarity: 0 },
      matches: [],
    });
    const current = store.loadDuplicateResult(currentId);
    assert.equal(current.threshold, 0.83);
    assert.deepEqual(current.matches, []);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assigns unique project source records when technical-plan source ids repeat', () => {
  const { root, db, store } = createTestStore();
  try {
    const sourceFile = {
      fileName: '招标文件.docx',
      fileHash: 'file-hash',
      contentHash: 'content-hash',
      size: 120,
      modifiedAt: '2026-09-14T00:00:00.000Z',
    };
    const first = store.createProject({ projectName: '方案一', sourceFile });
    const second = store.createProject({ projectName: '方案二', sourceFile });
    const repeatedSource = {
      sourceId: 'tender-01-fixed-source-id',
      fileName: sourceFile.fileName,
      fileHash: sourceFile.fileHash,
      contentHash: sourceFile.contentHash,
    };

    assert.doesNotThrow(() => {
      store.replaceProjectSourceFiles(first.projectId, [repeatedSource]);
      store.replaceProjectSourceFiles(second.projectId, [repeatedSource]);
    });

    const rows = db.prepare(`
      SELECT source_id, project_id
      FROM bid_project_source_files
      WHERE project_id IN (?, ?)
      ORDER BY project_id
    `).all(first.projectId, second.projectId);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].source_id, rows[1].source_id);
    assert.deepEqual(new Set(rows.map((row) => row.project_id)), new Set([first.projectId, second.projectId]));
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.after(() => {
  if (process.versions.electron) {
    require('electron').app.quit();
  }
});
