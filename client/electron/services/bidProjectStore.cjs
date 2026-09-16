const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createTechnicalPlanProjectSchema,
  getTechnicalPlanProjectTablePrefix,
} = require('./sqliteDatabase.cjs');
const {
  getBidProjectDir,
  getBidProjectsDir,
  getWorkspaceTrashDir,
} = require('../utils/paths.cjs');
const { forceRemoveSync } = require('../utils/forceRemove.cjs');

const duplicateSensitivityThresholds = Object.freeze({
  low: 0.56,
  medium: 0.64,
  high: 0.76,
});

function now() {
  return new Date().toISOString();
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function fallbackDuplicateThreshold(sensitivity) {
  return duplicateSensitivityThresholds[sensitivity] || duplicateSensitivityThresholds.medium;
}

function normalizeDuplicateDecision(value) {
  return ['pending', 'ignored', 'rewritten'].includes(value) ? value : 'pending';
}

function normalizeDuplicateTargetSide(value) {
  return ['left', 'right', 'none'].includes(value) ? value : 'none';
}

function getDuplicateMatchIdentity({ leftProjectId, rightProjectId, match }) {
  const sides = [
    {
      projectId: String(leftProjectId || ''),
      nodeId: String(match?.leftNodeId || ''),
      text: normalizeText(match?.leftParagraph?.text || '').toLocaleLowerCase(),
    },
    {
      projectId: String(rightProjectId || ''),
      nodeId: String(match?.rightNodeId || ''),
      text: normalizeText(match?.rightParagraph?.text || '').toLocaleLowerCase(),
    },
  ].sort((left, right) => left.projectId.localeCompare(right.projectId));
  return JSON.stringify(sides);
}

function mapDecisionTargetSide(targetSide, previousLeftProjectId, previousRightProjectId, nextLeftProjectId, nextRightProjectId) {
  if (targetSide === 'none') return 'none';
  const targetProjectId = targetSide === 'left' ? previousLeftProjectId : previousRightProjectId;
  if (targetProjectId === nextLeftProjectId) return 'left';
  if (targetProjectId === nextRightProjectId) return 'right';
  return 'none';
}

function mergeDuplicateMatchDecisions(previousResult, nextResult) {
  if (!previousResult || !nextResult) return nextResult?.matches || [];
  const previousByIdentity = new Map();
  for (const previousMatch of previousResult.matches || []) {
    const identity = getDuplicateMatchIdentity({
      leftProjectId: previousResult.leftProjectId,
      rightProjectId: previousResult.rightProjectId,
      match: previousMatch,
    });
    if (!previousByIdentity.has(identity)) previousByIdentity.set(identity, previousMatch);
  }
  return (nextResult.matches || []).map((nextMatch) => {
    const previousMatch = previousByIdentity.get(getDuplicateMatchIdentity({
      leftProjectId: nextResult.leftProjectId,
      rightProjectId: nextResult.rightProjectId,
      match: nextMatch,
    }));
    if (!previousMatch || normalizeDuplicateDecision(previousMatch.decision) === 'pending') return nextMatch;
    return {
      ...nextMatch,
      decision: normalizeDuplicateDecision(previousMatch.decision),
      decisionTargetSide: mapDecisionTargetSide(
        normalizeDuplicateTargetSide(previousMatch.decisionTargetSide),
        previousResult.leftProjectId,
        previousResult.rightProjectId,
        nextResult.leftProjectId,
        nextResult.rightProjectId,
      ),
      ...(Object.prototype.hasOwnProperty.call(previousMatch, 'rewriteDraft')
        ? { rewriteDraft: previousMatch.rewriteDraft }
        : {}),
      ...(previousMatch.ignoredAt ? { ignoredAt: previousMatch.ignoredAt } : {}),
      ...(previousMatch.rewrittenAt ? { rewrittenAt: previousMatch.rewrittenAt } : {}),
    };
  });
}

function normalizeProjectType(value) {
  return value === 'existing-plan-expansion' ? value : 'technical-plan';
}

function normalizeStatus(value) {
  return ['generating', 'incomplete', 'completed', 'failed'].includes(value) ? value : 'incomplete';
}

function toProject(row) {
  if (!row) return null;
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    projectType: normalizeProjectType(row.project_type),
    status: normalizeStatus(row.status),
    sourceGroupId: row.source_group_id || undefined,
    sourceSequence: Number(row.source_sequence || 1),
    sourceFileName: row.source_file_name || undefined,
    sourceFileHash: row.source_file_hash || undefined,
    sourceContentHash: row.source_content_hash || undefined,
    sourceFileSize: Number(row.source_file_size || 0),
    sourceFileModifiedAt: row.source_file_modified_at || undefined,
    sectionLabel: row.section_label || undefined,
    currentStep: row.current_step || 'document-analysis',
    lastTaskType: row.last_task_type || undefined,
    lastTaskStatus: row.last_task_status || undefined,
    lastError: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createBidProjectStore({ app, db }) {
  fs.mkdirSync(getBidProjectsDir(app), { recursive: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_projects (
      project_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      project_type TEXT NOT NULL DEFAULT 'technical-plan',
      status TEXT NOT NULL DEFAULT 'incomplete',
      source_group_id TEXT,
      source_sequence INTEGER NOT NULL DEFAULT 1,
      source_file_name TEXT,
      source_file_hash TEXT,
      source_content_hash TEXT,
      source_file_size INTEGER NOT NULL DEFAULT 0,
      source_file_modified_at TEXT,
      section_label TEXT,
      current_step TEXT NOT NULL DEFAULT 'document-analysis',
      last_task_type TEXT,
      last_task_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bid_projects_updated ON bid_projects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bid_projects_status ON bid_projects(status);
    CREATE INDEX IF NOT EXISTS idx_bid_projects_source_group ON bid_projects(source_group_id, source_sequence);
    CREATE TABLE IF NOT EXISTS bid_project_source_files (
      source_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      source_docx_path TEXT,
      markdown_path TEXT,
      file_hash TEXT,
      content_hash TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      modified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES bid_projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bid_project_sources_project ON bid_project_source_files(project_id);
    CREATE INDEX IF NOT EXISTS idx_bid_project_sources_hash ON bid_project_source_files(file_hash, content_hash);
    CREATE TABLE IF NOT EXISTS bid_project_duplicate_results (
      result_id TEXT PRIMARY KEY,
      left_project_id TEXT NOT NULL,
      right_project_id TEXT NOT NULL,
      sensitivity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'success',
      summary_json TEXT,
      matches_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (left_project_id) REFERENCES bid_projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY (right_project_id) REFERENCES bid_projects(project_id) ON DELETE CASCADE
    );
  `);

  function listProjects({ query = '', status = 'all', type = 'all' } = {}) {
    const conditions = [];
    const params = {};
    if (query.trim()) {
      conditions.push('(project_name LIKE @query OR source_file_name LIKE @query OR section_label LIKE @query)');
      params.query = `%${query.trim()}%`;
    }
    if (status !== 'all') {
      conditions.push('status = @status');
      params.status = normalizeStatus(status);
    }
    if (type !== 'all') {
      conditions.push('project_type = @type');
      params.type = normalizeProjectType(type);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM bid_projects ${where} ORDER BY updated_at DESC, created_at DESC`).all(params).map(toProject);
  }

  function getProject(projectId) {
    return toProject(db.prepare('SELECT * FROM bid_projects WHERE project_id = ?').get(String(projectId || '')));
  }

  function getSourceMatches({ fileHash, contentHash } = {}) {
    const normalizedFileHash = String(fileHash || '').trim();
    const normalizedContentHash = String(contentHash || '').trim();
    if (!normalizedFileHash && !normalizedContentHash) return [];
    return db.prepare(`
      SELECT DISTINCT p.*
      FROM bid_projects p
      LEFT JOIN bid_project_source_files s ON s.project_id = p.project_id
      WHERE (@file_hash <> '' AND (p.source_file_hash = @file_hash OR s.file_hash = @file_hash))
         OR (@content_hash <> '' AND (p.source_content_hash = @content_hash OR s.content_hash = @content_hash))
      ORDER BY p.updated_at DESC
    `).all({ file_hash: normalizedFileHash, content_hash: normalizedContentHash }).map(toProject);
  }

  function nextSourceGroupId(fileHash, contentHash) {
    const existing = getSourceMatches({ fileHash, contentHash });
    return existing[0]?.sourceGroupId || `source-${hashText(`${fileHash}|${contentHash}`).slice(0, 20)}`;
  }

  function createProject({
    projectId = crypto.randomUUID(),
    projectName,
    projectType = 'technical-plan',
    sourceFile,
    sourceFiles = [],
    sourceGroupId,
    sectionLabel = '',
  } = {}) {
    const timestamp = now();
    const normalizedType = normalizeProjectType(projectType);
    const fileHash = sourceFile?.fileHash || '';
    const contentHash = sourceFile?.contentHash || '';
    const groupId = sourceGroupId || nextSourceGroupId(fileHash, contentHash);
    const existingCount = Number(db.prepare('SELECT COUNT(*) AS count FROM bid_projects WHERE source_group_id = ?').get(groupId)?.count || 0);
    const projectNameBase = String(projectName || sourceFile?.fileName || '未命名标书').trim() || '未命名标书';
    const finalName = existingCount > 0 && !/\s-\s第\s*\d+\s*份$/.test(projectNameBase)
      ? `${projectNameBase} - 第 ${existingCount + 1} 份`
      : projectNameBase;
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO bid_projects (
          project_id, project_name, project_type, status, source_group_id, source_sequence,
          source_file_name, source_file_hash, source_content_hash, source_file_size,
          source_file_modified_at, section_label, created_at, updated_at
        ) VALUES (
          @project_id, @project_name, @project_type, 'incomplete', @source_group_id, @source_sequence,
          @source_file_name, @source_file_hash, @source_content_hash, @source_file_size,
          @source_file_modified_at, @section_label, @created_at, @updated_at
        )
      `).run({
        project_id: projectId,
        project_name: finalName,
        project_type: normalizedType,
        source_group_id: groupId,
        source_sequence: existingCount + 1,
        source_file_name: sourceFile?.fileName || null,
        source_file_hash: fileHash || null,
        source_content_hash: contentHash || null,
        source_file_size: Number(sourceFile?.size || 0),
        source_file_modified_at: sourceFile?.modifiedAt || null,
        section_label: String(sectionLabel || '').trim() || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
      const sourceRecords = Array.isArray(sourceFiles) && sourceFiles.length
        ? sourceFiles
        : sourceFile ? [sourceFile] : [];
      for (const sourceRecord of sourceRecords) {
        db.prepare(`
          INSERT INTO bid_project_source_files (
            source_id, project_id, file_name, source_docx_path, markdown_path,
            file_hash, content_hash, file_size, modified_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          projectId,
          sourceRecord.fileName || '招标文件',
          sourceRecord.sourceDocxPath || null,
          sourceRecord.markdownPath || null,
          sourceRecord.fileHash || fileHash || null,
          sourceRecord.contentHash || contentHash || null,
          Number(sourceRecord.size || 0),
          sourceRecord.modifiedAt || null,
          timestamp,
        );
      }
      createTechnicalPlanProjectSchema(db, projectId);
    });
    transaction();
    fs.mkdirSync(getBidProjectDir(app, projectId), { recursive: true });
    return getProject(projectId);
  }

  function replaceProjectSourceFiles(projectId, sourceFiles = []) {
    const id = String(projectId || '');
    if (!getProject(id)) throw new Error('未找到标书项目');
    const timestamp = now();
    const records = Array.isArray(sourceFiles) ? sourceFiles : [];
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM bid_project_source_files WHERE project_id = ?').run(id);
      const insert = db.prepare(`
        INSERT INTO bid_project_source_files (
          source_id, project_id, file_name, source_docx_path, markdown_path,
          file_hash, content_hash, file_size, modified_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      records.forEach((sourceFile) => {
        insert.run(
          // 技术方案源文件 ID 只在单个项目内稳定，项目索引使用独立的全局记录 ID。
          crypto.randomUUID(),
          id,
          sourceFile.fileName || '招标文件',
          sourceFile.sourceDocxPath || null,
          sourceFile.markdownPath || null,
          sourceFile.fileHash || null,
          sourceFile.contentHash || null,
          Number(sourceFile.size || sourceFile.fileSize || 0),
          sourceFile.modifiedAt || null,
          timestamp,
        );
      });
    });
    transaction();
    return records;
  }

  function updateProject(projectId, patch = {}) {
    const entries = [];
    const params = { project_id: String(projectId || ''), updated_at: now() };
    const mapping = {
      projectName: 'project_name',
      status: 'status',
      currentStep: 'current_step',
      lastTaskType: 'last_task_type',
      lastTaskStatus: 'last_task_status',
      lastError: 'last_error',
      sectionLabel: 'section_label',
    };
    for (const [field, column] of Object.entries(mapping)) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      entries.push(`${column} = @${column}`);
      params[column] = field === 'status' ? normalizeStatus(patch[field]) : (patch[field] ?? null);
    }
    if (!entries.length) return getProject(projectId);
    db.prepare(`UPDATE bid_projects SET ${entries.join(', ')}, updated_at = @updated_at WHERE project_id = @project_id`).run(params);
    return getProject(projectId);
  }

  function deleteProject(projectId) {
    const id = String(projectId || '');
    const project = getProject(id);
    if (!project) return { success: false, message: '未找到标书项目' };
    db.prepare('DELETE FROM bid_projects WHERE project_id = ?').run(id);
    forceRemoveSync(getBidProjectDir(app, id), {
      trashDir: getWorkspaceTrashDir(app),
      deferOnFailure: true,
    });
    return { success: true, message: '标书项目已删除' };
  }

  function listSourceGroupProjects(projectId) {
    const project = getProject(projectId);
    if (!project?.sourceGroupId) return [];
    return db.prepare('SELECT * FROM bid_projects WHERE source_group_id = ? ORDER BY source_sequence ASC').all(project.sourceGroupId).map(toProject);
  }

  function saveDuplicateResult(result) {
    const timestamp = now();
    const resultId = result.resultId || crypto.randomUUID();
    const sensitivity = result.sensitivity || 'medium';
    const previousRow = db.prepare(`
      SELECT *
      FROM bid_project_duplicate_results
      WHERE result_id <> @result_id
        AND (
          (left_project_id = @left_project_id AND right_project_id = @right_project_id)
          OR (left_project_id = @right_project_id AND right_project_id = @left_project_id)
        )
      ORDER BY updated_at DESC, created_at DESC, rowid DESC
      LIMIT 1
    `).get({
      result_id: resultId,
      left_project_id: result.leftProjectId,
      right_project_id: result.rightProjectId,
    });
    const previousResult = previousRow ? {
      leftProjectId: previousRow.left_project_id,
      rightProjectId: previousRow.right_project_id,
      matches: parseJson(previousRow.matches_json, []),
    } : null;
    const threshold = Number.isFinite(Number(result.threshold))
      ? Number(result.threshold)
      : fallbackDuplicateThreshold(sensitivity);
    const matches = mergeDuplicateMatchDecisions(previousResult, {
      leftProjectId: result.leftProjectId,
      rightProjectId: result.rightProjectId,
      matches: Array.isArray(result.matches) ? result.matches : [],
    });
    const summary = {
      ...(result.summary && typeof result.summary === 'object' ? result.summary : {}),
      threshold,
    };
    db.prepare(`
      INSERT INTO bid_project_duplicate_results (
        result_id, left_project_id, right_project_id, sensitivity, status,
        summary_json, matches_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(result_id) DO UPDATE SET
        sensitivity = excluded.sensitivity,
        status = excluded.status,
        summary_json = excluded.summary_json,
        matches_json = excluded.matches_json,
        updated_at = excluded.updated_at
    `).run(
      resultId,
      result.leftProjectId,
      result.rightProjectId,
      sensitivity,
      result.status || 'success',
      JSON.stringify(summary),
      JSON.stringify(matches),
      result.createdAt || timestamp,
      timestamp,
    );
    return resultId;
  }

  function loadDuplicateResult(resultId) {
    const row = db.prepare('SELECT * FROM bid_project_duplicate_results WHERE result_id = ?').get(String(resultId || ''));
    if (!row) return null;
    const summary = parseJson(row.summary_json, {});
    const threshold = Number.isFinite(Number(summary.threshold))
      ? Number(summary.threshold)
      : fallbackDuplicateThreshold(row.sensitivity);
    return {
      resultId: row.result_id,
      leftProjectId: row.left_project_id,
      rightProjectId: row.right_project_id,
      sensitivity: row.sensitivity,
      status: row.status,
      threshold,
      summary: { ...summary, threshold },
      matches: parseJson(row.matches_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      leftProject: getProject(row.left_project_id),
      rightProject: getProject(row.right_project_id),
    };
  }

  function listRecentDuplicateSummaries(projectIds = []) {
    const ids = [...new Set((Array.isArray(projectIds) ? projectIds : []).map((value) => String(value || '')).filter(Boolean))];
    if (!ids.length) return {};
    const placeholders = ids.map((_, index) => `@project_${index}`).join(', ');
    const params = Object.fromEntries(ids.map((id, index) => [`project_${index}`, id]));
    const rows = db.prepare(`
      SELECT
        r.*,
        lp.project_name AS left_project_name,
        rp.project_name AS right_project_name
      FROM bid_project_duplicate_results r
      LEFT JOIN bid_projects lp ON lp.project_id = r.left_project_id
      LEFT JOIN bid_projects rp ON rp.project_id = r.right_project_id
      WHERE (
          r.left_project_id IN (${placeholders})
          OR r.right_project_id IN (${placeholders})
        )
        AND lp.source_group_id IS NOT NULL
        AND lp.source_group_id = rp.source_group_id
      ORDER BY r.updated_at DESC, r.created_at DESC, r.rowid DESC
    `).all(params);
    const summaries = Object.fromEntries(ids.map((id) => [id, null]));
    for (const row of rows) {
      const summary = parseJson(row.summary_json, {});
      const threshold = Number.isFinite(Number(summary.threshold))
        ? Number(summary.threshold)
        : fallbackDuplicateThreshold(row.sensitivity);
      const duplicateSummary = {
        resultId: row.result_id,
        sensitivity: row.sensitivity,
        threshold,
        duplicateParagraphCount: Number(summary.duplicateParagraphCount || 0),
        maxSimilarity: Number(summary.maxSimilarity || 0),
        updatedAt: row.updated_at,
      };
      if (summaries[row.left_project_id] === null) {
        summaries[row.left_project_id] = {
          projectId: row.left_project_id,
          ...duplicateSummary,
          otherProjectId: row.right_project_id,
          otherProjectName: row.right_project_name || '未命名标书',
        };
      }
      if (summaries[row.right_project_id] === null) {
        summaries[row.right_project_id] = {
          projectId: row.right_project_id,
          ...duplicateSummary,
          otherProjectId: row.left_project_id,
          otherProjectName: row.left_project_name || '未命名标书',
        };
      }
    }
    return summaries;
  }

  function loadLatestDuplicateResult(projectId) {
    const row = db.prepare(`
      SELECT r.result_id
      FROM bid_project_duplicate_results
      AS r
      INNER JOIN bid_projects lp ON lp.project_id = r.left_project_id
      INNER JOIN bid_projects rp ON rp.project_id = r.right_project_id
      WHERE (
          r.left_project_id = ? OR r.right_project_id = ?
        )
        AND lp.source_group_id IS NOT NULL
        AND lp.source_group_id = rp.source_group_id
      ORDER BY r.updated_at DESC, r.created_at DESC, r.rowid DESC
      LIMIT 1
    `).get(String(projectId || ''), String(projectId || ''));
    return row ? loadDuplicateResult(row.result_id) : null;
  }

  function updateDuplicateMatchDecision({ resultId, matchId, decision, targetSide = 'none', rewriteDraft } = {}) {
    const result = loadDuplicateResult(resultId);
    if (!result) throw new Error('未找到查重结果');
    const normalizedDecision = normalizeDuplicateDecision(decision);
    const normalizedTargetSide = normalizeDuplicateTargetSide(targetSide);
    const matchIndex = result.matches.findIndex((match) => match.id === matchId);
    if (matchIndex < 0) throw new Error('未找到查重重复组');
    const timestamp = now();
    const matches = result.matches.map((match, index) => {
      if (index !== matchIndex) return match;
      const next = {
        ...match,
        decision: normalizedDecision,
        decisionTargetSide: normalizedTargetSide,
      };
      if (normalizedDecision === 'ignored') {
        next.ignoredAt = timestamp;
        delete next.rewrittenAt;
      } else if (normalizedDecision === 'rewritten') {
        next.rewrittenAt = timestamp;
        delete next.ignoredAt;
      } else {
        delete next.ignoredAt;
        delete next.rewrittenAt;
      }
      if (Object.prototype.hasOwnProperty.call(arguments[0] || {}, 'rewriteDraft')) {
        if (rewriteDraft === null || rewriteDraft === undefined) delete next.rewriteDraft;
        else next.rewriteDraft = String(rewriteDraft);
      }
      return next;
    });
    db.prepare(`
      UPDATE bid_project_duplicate_results
      SET matches_json = ?
      WHERE result_id = ?
    `).run(JSON.stringify(matches), String(resultId || ''));
    return loadDuplicateResult(resultId);
  }

  return {
    createProject,
    deleteProject,
    getProject,
    getSourceMatches,
    listProjects,
    listRecentDuplicateSummaries,
    listSourceGroupProjects,
    loadLatestDuplicateResult,
    loadDuplicateResult,
    replaceProjectSourceFiles,
    saveDuplicateResult,
    updateDuplicateMatchDecision,
    updateProject,
  };
}

module.exports = {
  createBidProjectStore,
  getDuplicateMatchIdentity,
  mergeDuplicateMatchDecisions,
  hashText,
  normalizeText,
};
