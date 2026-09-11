const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createConfigStore } = require('./configStore.cjs');

function createTempApp() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-config-'));
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    userDataPath,
  };
}

function writeConfig(app, config) {
  fs.writeFileSync(path.join(app.userDataPath, 'user_config.json'), JSON.stringify(config), 'utf8');
}

function readBodyOutlineLevels(config) {
  return config.export_format.body_text.body_outline_levels;
}

test('missing body outline typography defaults to SimSun and small-four for every configured level', () => {
  const app = createTempApp();
  try {
    const config = createConfigStore(app).load();
    assert.deepEqual(
      readBodyOutlineLevels(config).map(({ font, size }) => ({ font, size })),
      [
        { font: '宋体', size: '小四' },
        { font: '宋体', size: '小四' },
        { font: '宋体', size: '小四' },
        { font: '宋体', size: '小四' },
      ],
    );
  } finally {
    fs.rmSync(app.userDataPath, { recursive: true, force: true });
  }
});

test('legacy ordered-list style is kept only as the first-level numbering style', () => {
  const app = createTempApp();
  try {
    writeConfig(app, {
      export_format: {
        body_text: {
          font: '宋体',
          size: '小四',
          ordered_list_style: 'chinese-paren',
        },
      },
    });

    const config = createConfigStore(app).load();
    const levels = readBodyOutlineLevels(config);
    assert.equal(levels[0].numbering_style, 'chinese-paren');
    assert.deepEqual(
      levels.map(({ font, size }) => ({ font, size })),
      [
        { font: '宋体', size: '小四' },
        { font: '宋体', size: '小四' },
        { font: '宋体', size: '小四' },
        { font: '宋体', size: '小四' },
      ],
    );
  } finally {
    fs.rmSync(app.userDataPath, { recursive: true, force: true });
  }
});
