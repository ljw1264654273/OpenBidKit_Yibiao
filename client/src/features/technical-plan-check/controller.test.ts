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
    technicalPlanCheck: { loadState: async () => { order.push('load'); return order.length === 1 ? snapshot : { ...snapshot, checkTask: task }; } },
    tasks: {
      onTaskEvent: (callback: (event: TaskEvent) => void) => { order.push('subscribe'); listener = callback; return () => { order.push('unsubscribe'); }; },
      getActiveTasks: async () => { order.push('active'); return [task, { ...task, type: 'other' }]; },
    },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await session.ready;
  assert.deepEqual(order, ['load', 'subscribe', 'active', 'load']);
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
  assert.deepEqual(order, ['load', 'subscribe', 'active', 'load', 'unsubscribe']);
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

test('recovers completion between the initial snapshot and task subscription', async () => {
  const completed = { ...snapshot, reportPath: '完成.docx', checkTask: { ...task, status: 'success' as const, progress: 100 } };
  const updates: TechnicalPlanCheckState[] = [];
  let reads = 0;
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: async () => ++reads === 1 ? { ...snapshot, checkTask: task } : completed },
    tasks: { onTaskEvent: () => () => {}, getActiveTasks: async () => [] },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await session.ready;
  assert.equal(updates.at(-1)?.checkTask?.status, 'success');
  assert.equal(updates.at(-1)?.reportPath, '完成.docx');
  session.dispose();
});

test('a delayed active task replay cannot roll back a newer completion event', async () => {
  const active = deferred<TaskEventTask[]>();
  const completed = { ...snapshot, reportPath: '完成.docx', checkTask: { ...task, status: 'success' as const, progress: 100 } };
  const updates: TechnicalPlanCheckState[] = [];
  let listener!: (event: TaskEvent) => void;
  let reads = 0;
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: async () => ++reads === 1 ? snapshot : completed },
    tasks: { onTaskEvent: (callback: (event: TaskEvent) => void) => { listener = callback; return () => {}; }, getActiveTasks: () => active.promise },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await Promise.resolve();
  listener({ task: completed.checkTask, technicalPlanCheckPatch: { reportPath: completed.reportPath } });
  const completionIndex = updates.length - 1;
  active.resolve([task]);
  await session.ready;
  assert.ok(updates.slice(completionIndex).every((state) => state.checkTask?.status === 'success'));
  session.dispose();
});

test('events received while refreshing the subscribed snapshot are reapplied in order', async () => {
  const refresh = deferred<TechnicalPlanCheckState>();
  const refreshStarted = deferred<void>();
  const updates: TechnicalPlanCheckState[] = [];
  let listener!: (event: TaskEvent) => void;
  let reads = 0;
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: () => { if (++reads === 1) return Promise.resolve(snapshot); refreshStarted.resolve(); return refresh.promise; } },
    tasks: { onTaskEvent: (callback: (event: TaskEvent) => void) => { listener = callback; return () => {}; }, getActiveTasks: async () => [] },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2, 'Subscribed snapshot must be refreshed');
  await refreshStarted.promise;
  listener({ task: { ...task, progress: 60 } });
  listener({ task: { ...task, status: 'success', progress: 100 }, technicalPlanCheckPatch: { reportPath: '最新.docx' } });
  refresh.resolve({ ...snapshot, outputPath: '权威输出.docx', checkTask: task });
  await session.ready;
  assert.equal(updates.at(-1)?.outputPath, '权威输出.docx');
  assert.equal(updates.at(-1)?.checkTask?.status, 'success');
  assert.equal(updates.at(-1)?.reportPath, '最新.docx');
  session.dispose();
});

test('a file selection snapshot received during refresh stays authoritative', async () => {
  const refresh = deferred<TechnicalPlanCheckState>();
  const updates: TechnicalPlanCheckState[] = [];
  let reads = 0;
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: () => ++reads === 1 ? Promise.resolve(snapshot) : refresh.promise },
    tasks: { onTaskEvent: () => () => {}, getActiveTasks: async () => [] },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2);
  const selected = { ...snapshot, outputPath: '新选择.docx' };
  session.updateState(selected);
  session.applyEvent({ task: { ...task, progress: 60 } });
  refresh.resolve(snapshot);
  await session.ready;
  assert.equal(updates.at(-1)?.outputPath, '新选择.docx');
  assert.equal(updates.at(-1)?.checkTask?.progress, 60);
  session.dispose();
});

test('late subscribed snapshot completion after unmount cannot update state', async () => {
  const refresh = deferred<TechnicalPlanCheckState>();
  const updates: TechnicalPlanCheckState[] = [];
  let reads = 0;
  let unsubscribed = 0;
  const session = initializeTechnicalPlanCheckPage({
    technicalPlanCheck: { loadState: () => ++reads === 1 ? Promise.resolve(snapshot) : refresh.promise },
    tasks: { onTaskEvent: () => () => { unsubscribed += 1; }, getActiveTasks: async () => [] },
  }, (state: TechnicalPlanCheckState) => updates.push(state), assert.fail);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2);
  const count = updates.length;
  session.dispose();
  refresh.resolve({ ...snapshot, reportPath: '完成.docx' });
  await session.ready;
  assert.equal(updates.length, count);
  assert.equal(unsubscribed, 1);
});
