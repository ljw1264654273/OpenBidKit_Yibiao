const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { buildDocxResult } = require('./exportService.cjs');

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

test('Word export loads project-scoped illustration assets from the project technical-plan directory', async () => {
  const projectTechnicalPlanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-export-project-'));
  const revision = 'revision-1';
  const itemId = 'item-1';
  const imagePath = path.join(projectTechnicalPlanDir, 'generated-illustrations', revision, `${itemId}.png`);
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, onePixelPng);

  try {
    const result = await buildDocxResult({
      project_name: '项目级图片导出测试',
      project_technical_plan_dir: projectTechnicalPlanDir,
      outline: [{
        id: '1',
        title: '项目组织机构架构图',
        content: `![项目组织机构架构图](yibiao-asset://generated-images/technical-plan/illustrations/${revision}/${itemId}.png)`,
      }],
    });

    assert.deepEqual(result.warnings, []);
    const zip = new AdmZip(result.buffer);
    assert.ok(zip.getEntries().some((entry) => entry.entryName.startsWith('word/media/')));
  } finally {
    fs.rmSync(projectTechnicalPlanDir, { recursive: true, force: true });
  }
});
