import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { TaskEvent, TaskEventTask } from '../../shared/types/ipc';
import type { TechnicalPlanCheckState } from './types';

// Node does not resolve Vite's extensionless TypeScript imports.
const source = fs.readFileSync(new URL('./controller.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  .replace("'./state'", JSON.stringify(new URL('./state.ts', import.meta.url).href));
const { initializeTechnicalPlanCheckPage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const snapshot: TechnicalPlanCheckState = { tenderFile: null, requirementsFile: null, scoringFile: null, proposalFile: null, outputPath: '初始.docx', reportPath: '', summary: null };
const task: TaskEventTask = { task_id: 'task-1', type: 'technical-plan-check', status: 'running', progress: 20, logs: ['阶段 1'], started_at: '', updated_at: '' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

test('loads snapshot, subscribes, then replays active tasks and merges later events', async () => {
  const order: string[] = [];
  const updates: TechnicalPlanCheckState[] = [];
  let listener!: (event: TaskEvent) => void;
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: async () => { order.push('load'); return snapshot; } },
    tasks: {
      onTaskEvent: (callback: (event: TaskEvent) => void) => { order.push('subscribe'); listener = callback; return () => { order.push('unsubscribe'); }; },
      getActiveTasks: async () => { order.push('active'); return [task, { ...task, type: 'other' }]; },
    },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await session.ready;
  assert.deepEqual(order, ['load', 'subscribe', 'active']);
  assert.equal(updates.at(-1)?.outputPath, '初始.docx');
  assert.equal(updates.at(-1)?.checkTask?.progress, 20);
  listener({ task: { ...task, progress: 60 }, technicalPlanCheckPatch: { outputPath: '更新.docx', reportPath: '' } });
  assert.equal(updates.at(-1)?.outputPath, '更新.docx');
  assert.equal(updates.at(-1)?.checkTask?.progress, 60);
  session.dispose();
  session.dispose();
  const count = updates.length;
  listener({ task });
  assert.equal(updates.length, count);
  assert.deepEqual(order, ['load', 'subscribe', 'active', 'unsubscribe']);
});

test('late snapshot completion after unmount cannot subscribe or update the page', async () => {
  const pending = deferred<TechnicalPlanCheckState>();
  const updates: TechnicalPlanCheckState[] = [];
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: () => pending.promise },
    tasks: { onTaskEvent: assert.fail, getActiveTasks: assert.fail },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  session.dispose();
  pending.resolve(snapshot);
  await session.ready;
  assert.deepEqual(updates, []);
});

test('late active tasks completion after unmount cannot overwrite state', async () => {
  const pending = deferred<TaskEventTask[]>();
  const updates: TechnicalPlanCheckState[] = [];
  let unsubscribed = 0;
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: async () => snapshot },
    tasks: { onTaskEvent: () => () => { unsubscribed += 1; }, getActiveTasks: () => pending.promise },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await Promise.resolve();
  session.dispose();
  pending.resolve([task]);
  await session.ready;
  assert.equal(unsubscribed, 1);
  assert.equal(updates.length, 1);
});

test('late async failure after unmount is not shown to the page', async () => {
  const pending = deferred<TechnicalPlanCheckState>();
  const errors: unknown[] = [];
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: () => pending.promise },
    tasks: { onTaskEvent: assert.fail, getActiveTasks: assert.fail },
  }, assert.fail, (error: unknown) => errors.push(error));
  session.dispose();
  pending.reject(new Error('读取失败'));
  await session.ready;
  assert.deepEqual(errors, []);
});

test('initialization errors are reported while mounted', async () => {
  const failure = new Error('读取失败');
  const errors: unknown[] = [];
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: async () => { throw failure; } },
    tasks: { onTaskEvent: assert.fail, getActiveTasks: assert.fail },
  }, assert.fail, (error: unknown) => errors.push(error));
  await session.ready;
  assert.deepEqual(errors, [failure]);
  session.dispose();
});

test('file selection snapshots remain authoritative when task events arrive', async () => {
  const updates: TechnicalPlanCheckState[] = [];
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: async () => snapshot },
    tasks: { onTaskEvent: () => () => {}, getActiveTasks: async () => [] },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await session.ready;
  const selected = { ...snapshot, proposalFile: { path: 'C:\\中文目录\\方案.docx', name: '方案.docx' }, outputPath: '方案检查记录.docx' };
  session.updateState(selected);
  session.applyEvent({ task });
  assert.deepEqual(updates.at(-1)?.proposalFile, selected.proposalFile);
  assert.equal(updates.at(-1)?.outputPath, selected.outputPath);
  session.dispose();
  session.updateState(snapshot);
  assert.equal(updates.at(-1)?.outputPath, selected.outputPath);
});
