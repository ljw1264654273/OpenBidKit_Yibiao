const assert = require('node:assert/strict');
const test = require('node:test');

const { collectGeneratedImageReferences } = require('./storageCleanupService.cjs');

test('startup image cleanup collects references from project-scoped technical-plan tables', () => {
  const db = {
    prepare(sql) {
      if (/SELECT\s+name\s+FROM\s+sqlite_master/i.test(sql)) {
        return {
          all: () => [
            { name: 'technical_plan_illustration_items' },
            { name: 'technical_plan_outline_nodes' },
            { name: 'technical_plan_project_9af6f752_illustration_items' },
            { name: 'technical_plan_project_9af6f752_outline_nodes' },
          ],
        };
      }
      return {
        all: () => [
          { value: 'yibiao-asset://generated-images/legacy.png' },
          { value: '![项目图](yibiao-asset://generated-images/2026-09-18-project.png)' },
        ],
      };
    },
  };

  assert.deepEqual(
    [...collectGeneratedImageReferences(db)].sort(),
    ['2026-09-18-project.png', 'legacy.png'],
  );
});
