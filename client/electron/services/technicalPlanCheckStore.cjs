const path = require('node:path');

const taskType = 'technical-plan-check';
const taskDomain = 'technical-plan-check';

const fileFields = {
  tender: ['tenderFile', 'tender_file_json'],
  requirements: ['requirementsFile', 'requirements_file_json'],
  scoring: ['scoringFile', 'scoring_file_json'],
  proposal: ['proposalFile', 'proposal_file_json'],
};

function now() {
  return new Date().toISOString();
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonOrNull(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function createSuggestedOutputPath(file) {
  const filePath = String(file?.path || '').trim();
  if (!filePath) return '';
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}检查记录.docx`);
}

function taskFromRow(row, taskLogStore) {
  if (!row) return undefined;
  return {
    task_id: row.task_id,
    type: row.type,
    status: row.status,
    progress: Number(row.progress || 0),
    logs: taskLogStore.list(taskDomain, row.type, row.task_id),
    started_at: row.started_at,
    updated_at: row.updated_at,
    error: row.error || undefined,
    stats: safeJsonParse(row.stats_json, undefined),
  };
}

function createTechnicalPlanCheckStore({ db, taskLogStore }) {
  function ensureMetaRow() {
    const existing = db.prepare('SELECT * FROM technical_plan_check_meta WHERE id = 1').get();
    if (existing) return existing;
    const timestamp = now();
    db.prepare(`
      INSERT INTO technical_plan_check_meta (id, created_at, updated_at)
      VALUES (1, @timestamp, @timestamp)
    `).run({ timestamp });
    return db.prepare('SELECT * FROM technical_plan_check_meta WHERE id = 1').get();
  }

  function updateMeta(fields) {
    ensureMetaRow();
    const entries = Object.entries(fields || {}).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    const assignments = entries.map(([field]) => `${field} = @${field}`).join(', ');
    db.prepare(`
      UPDATE technical_plan_check_meta
      SET ${assignments}, updated_at = @updated_at
      WHERE id = 1
    `).run({
      ...Object.fromEntries(entries),
      updated_at: now(),
    });
  }

  function saveTask(task) {
    if (!task) {
      db.prepare('DELETE FROM technical_plan_check_tasks WHERE type = ?').run(taskType);
      return;
    }
    const timestamp = now();
    const type = String(task.type || taskType);
    const taskId = String(task.task_id || '');
    db.prepare(`
      INSERT INTO technical_plan_check_tasks (
        type, task_id, status, progress, stats_json, error, started_at, updated_at
      ) VALUES (
        @type, @task_id, @status, @progress, @stats_json, @error, @started_at, @updated_at
      ) ON CONFLICT(type) DO UPDATE SET
        task_id = excluded.task_id,
        status = excluded.status,
        progress = excluded.progress,
        stats_json = excluded.stats_json,
        error = excluded.error,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at
    `).run({
      type,
      task_id: taskId,
      status: String(task.status || 'running'),
      progress: Math.max(0, Math.min(100, Math.round(Number(task.progress || 0)))),
      stats_json: jsonOrNull(task.stats),
      error: task.error ? String(task.error) : null,
      started_at: task.started_at || timestamp,
      updated_at: task.updated_at || timestamp,
    });
    taskLogStore.sync(taskDomain, type, taskId, task.logs, task.updated_at || timestamp);
  }

  function loadState() {
    const meta = ensureMetaRow();
    const task = db.prepare('SELECT * FROM technical_plan_check_tasks WHERE type = ?').get(taskType);
    return {
      tenderFile: safeJsonParse(meta.tender_file_json, null),
      requirementsFile: safeJsonParse(meta.requirements_file_json, null),
      scoringFile: safeJsonParse(meta.scoring_file_json, null),
      proposalFile: safeJsonParse(meta.proposal_file_json, null),
      outputPath: meta.output_path || '',
      reportPath: meta.report_path || '',
      summary: safeJsonParse(meta.summary_json, null),
      checkTask: taskFromRow(task, taskLogStore),
    };
  }

  const saveSelectionTransaction = db.transaction((role, file) => {
    const field = fileFields[role];
    if (!field) throw new Error(`未知技术方案检查文件角色：${role}`);
    const [, column] = field;
    const current = ensureMetaRow();
    const nextJson = jsonOrNull(file);
    const updates = { [column]: nextJson };
    if ((current[column] || null) !== nextJson) {
      updates.report_path = '';
      updates.summary_json = null;
    }
    if (role === 'proposal') {
      updates.output_path = createSuggestedOutputPath(file);
    }
    updateMeta(updates);
  });

  function saveSelection(role, file) {
    saveSelectionTransaction(role, file || null);
    return loadState();
  }

  function saveOutputPath(outputPath) {
    updateMeta({ output_path: String(outputPath || '') });
    return loadState();
  }

  function applyPatch(patch) {
    const meta = {};
    if (hasOwn(patch, 'outputPath')) meta.output_path = String(patch.outputPath || '');
    if (hasOwn(patch, 'reportPath')) meta.report_path = String(patch.reportPath || '');
    if (hasOwn(patch, 'summary')) meta.summary_json = jsonOrNull(patch.summary);
    for (const [role, [stateField, column]] of Object.entries(fileFields)) {
      if (!hasOwn(patch, stateField)) continue;
      meta[column] = jsonOrNull(patch[stateField]);
      meta.report_path = '';
      meta.summary_json = null;
      if (role === 'proposal') meta.output_path = createSuggestedOutputPath(patch[stateField]);
    }
    if (Object.keys(meta).length) updateMeta(meta);
    if (hasOwn(patch, 'checkTask')) saveTask(patch.checkTask);
  }

  const updateTransaction = db.transaction((patch) => {
    applyPatch(patch || {});
  });

  function updateWithoutReload(patch) {
    updateTransaction(patch || {});
  }

  const checkpointTransaction = db.transaction((task, patch) => {
    saveTask(task);
    applyPatch(patch || {});
  });

  function checkpointTask(task, patch) {
    checkpointTransaction(task, patch || {});
    return loadState();
  }

  const clearTransaction = db.transaction(() => {
    db.prepare('DELETE FROM technical_plan_check_tasks').run();
    db.prepare('DELETE FROM technical_plan_check_meta').run();
    ensureMetaRow();
  });

  function clear() {
    clearTransaction();
    return loadState();
  }

  const recoverInterruptedTaskTransaction = db.transaction(() => {
    const task = db.prepare(`
      SELECT * FROM technical_plan_check_tasks
      WHERE type = ? AND status = 'running'
    `).get(taskType);
    if (!task) return;
    db.prepare(`
      UPDATE technical_plan_check_tasks
      SET status = 'error', error = @error, updated_at = @updated_at
      WHERE type = @type
    `).run({
      type: taskType,
      error: '应用已重启，技术方案检查任务已中断，请重新执行',
      updated_at: now(),
    });
  });

  function recoverInterruptedTask() {
    recoverInterruptedTaskTransaction();
    return loadState();
  }

  ensureMetaRow();

  return {
    loadState,
    saveSelection,
    saveOutputPath,
    checkpointTask,
    updateWithoutReload,
    clear,
    recoverInterruptedTask,
  };
}

module.exports = {
  createTechnicalPlanCheckStore,
};
