const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveYibiaoAssetPath } = require('./assetPathResolver.cjs');

test('asset resolver finds project-scoped illustration files when the global asset path is absent', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-assets-'));
  const globalDir = path.join(rootDir, 'generated-images');
  const projectTechnicalPlanDir = path.join(rootDir, 'bid-projects', 'project-1', 'technical-plan');
  const imagePath = path.join(projectTechnicalPlanDir, 'generated-illustrations', 'revision', 'item.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'image');

  try {
    assert.equal(
      resolveYibiaoAssetPath(
        'yibiao-asset://generated-images/technical-plan/illustrations/revision/item.png',
        {
          generatedImagesDir: globalDir,
          projectTechnicalPlanDirs: [projectTechnicalPlanDir],
        },
      ),
      imagePath,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('asset resolver rejects paths outside the configured asset root', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-assets-'));
  try {
    assert.equal(
      resolveYibiaoAssetPath('yibiao-asset://generated-images/%2e%2e/secret.png', {
        generatedImagesDir: rootDir,
      }),
      null,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
