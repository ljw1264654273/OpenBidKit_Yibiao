import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(fileURLToPath(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url)), 'utf8');

test('manual outline save applies the persisted content and illustration state', () => {
  const save = source.match(/const saveOutline = async \(request: SaveOutlineRequest\) => \{([\s\S]*?)\n  \};/)?.[1];
  assert.ok(save);
  assert.match(save, /\.\.\.\(saved \|\| \{\}\)/);
  assert.doesNotMatch(save, /contentGenerationSections\s*,/);
  assert.doesNotMatch(save, /contentGenerationPlans\s*,/);
});

test('AI outline adjustment accepts explicitly cleared illustration plans', () => {
  const adjustment = source.match(/if \(taskType === 'outline-adjustment'\) \{([\s\S]*?)\n        \}/)?.[1];
  assert.ok(adjustment);
  assert.match(adjustment, /contentIllustrationPlan: hasOwnField\(technicalPlan, 'contentIllustrationPlan'\) \? technicalPlan\.contentIllustrationPlan/);
  assert.match(adjustment, /contentGenerationSections: hasOwnField\(technicalPlan, 'contentGenerationSections'\)/);
  assert.match(adjustment, /contentGenerationPlans: hasOwnField\(technicalPlan, 'contentGenerationPlans'\)/);
});
