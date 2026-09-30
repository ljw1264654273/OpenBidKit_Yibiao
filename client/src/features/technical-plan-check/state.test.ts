import assert from 'node:assert/strict';
import test from 'node:test';
import type { TechnicalPlanCheckState, TechnicalPlanCheckTask } from './types';

const moduleUrl = new URL('./state.ts', import.meta.url).href;
const { mergeTechnicalPlanCheckState, getTechnicalPlanCheckActions } = await import(moduleUrl);
const file = { path: 'C:\\中文目录\\方案.docx', name: '方案.docx' };
const task: TechnicalPlanCheckTask = { task_id: 'check-1', type: 'technical-plan-check', status: 'success', progress: 100, logs: ['检查完成'], started_at: '', updated_at: '' };
const ready: TechnicalPlanCheckState = { tenderFile: file, requirementsFile: file, scoringFile: file, proposalFile: file, outputPath: 'C:\\中文目录\\检查记录.docx', reportPath: '', summary: null };

test('full snapshot replay replaces previous fields and applies event task', () => {
  const snapshot = { ...ready, tenderFile: null, outputPath: '', checkTask: undefined };
  const merged = mergeTechnicalPlanCheckState(ready, { task, technicalPlanCheck: snapshot });
  assert.equal(merged.tenderFile, null);
  assert.equal(merged.outputPath, '');
  assert.deepEqual(merged.checkTask, task);
});

test('partial patch preserves missing fields and clears explicit null, empty and undefined fields', () => {
  const previous = { ...ready, reportPath: 'old.docx', summary: { total: 1 }, checkTask: task };
  const merged = mergeTechnicalPlanCheckState(previous, { technicalPlanCheckPatch: { tenderFile: null, reportPath: '', summary: null, checkTask: undefined } });
  assert.equal(merged.tenderFile, null);
  assert.equal(merged.requirementsFile, file);
  assert.equal(merged.outputPath, ready.outputPath);
  assert.equal(merged.reportPath, '');
  assert.equal(merged.summary, null);
  assert.ok(Object.prototype.hasOwnProperty.call(merged, 'checkTask'));
  assert.equal(merged.checkTask, undefined);
});

test('unrelated task events leave the check page untouched', () => {
  assert.equal(mergeTechnicalPlanCheckState(ready, { task: { ...task, type: 'bid-analysis' } }), ready);
});

for (const status of ['running', 'queued', 'pausing']) {
  test(`${status} task disables input, output, start and report actions`, () => {
    const actions = getTechnicalPlanCheckActions({ ...ready, reportPath: 'report.docx', checkTask: { ...task, status } });
    assert.equal(actions.inputsDisabled, true);
    assert.equal(actions.outputDisabled, true);
    assert.equal(actions.startDisabled, true);
    assert.equal(actions.openReportDisabled, true);
    assert.ok(actions.startDisabledReason);
  });
}

test('start requires all four inputs and an output path', () => {
  assert.equal(getTechnicalPlanCheckActions(ready).startDisabled, false);
  for (const key of ['tenderFile', 'requirementsFile', 'scoringFile', 'proposalFile'] as const) {
    const actions = getTechnicalPlanCheckActions({ ...ready, [key]: null });
    assert.equal(actions.startDisabled, true);
    assert.ok(actions.startDisabledReason);
  }
  assert.equal(getTechnicalPlanCheckActions({ ...ready, outputPath: '' }).startDisabled, true);
});

test('only successful report can be opened', () => {
  assert.equal(getTechnicalPlanCheckActions({ ...ready, reportPath: 'report.docx', checkTask: task }).openReportDisabled, false);
  assert.equal(getTechnicalPlanCheckActions({ ...ready, reportPath: 'report.docx', checkTask: { ...task, status: 'error' } }).openReportDisabled, true);
  assert.equal(getTechnicalPlanCheckActions({ ...ready, checkTask: task }).openReportDisabled, true);
});
