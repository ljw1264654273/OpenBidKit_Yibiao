const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8');
}

function assertMissing(relativePath) {
  const absolutePath = path.join(clientRoot, relativePath);
  const hasFiles = (directory) => fs.existsSync(directory)
    && fs.readdirSync(directory, { withFileTypes: true }).some((entry) => (
      entry.isFile() || (entry.isDirectory() && hasFiles(path.join(directory, entry.name)))
    ));
  assert.equal(
    hasFiles(absolutePath),
    false,
    `${relativePath} should not contain files`,
  );
}

test('removed feature directories and entry points are absent', () => {
  assertMissing('src/features/bid-opportunity');
  assertMissing('src/features/plugins');
  assertMissing('src/features/resources');
  assertMissing('src/styles/feature-plugins.css');
  assertMissing('src/styles/feature-resources.css');
  assertMissing('electron/ipc/pluginIpc.cjs');
  assertMissing('electron/services/pluginService.cjs');
  assertMissing('electron/services/pluginContext.cjs');
  assertMissing('electron/services/pluginConfigWindow.cjs');
  assertMissing('electron/preload-plugin-config.cjs');
});

test('remaining client entry points do not expose removed features', () => {
  const menuConfig = read('src/app/menuConfig.ts');
  const router = read('src/app/AppRouter.tsx');
  const sidebar = read('src/components/Sidebar.tsx');
  const preload = read('electron/preload.cjs');
  const ipcTypes = read('src/shared/types/ipc.ts');

  for (const source of [menuConfig, router, sidebar, preload, ipcTypes]) {
    assert.doesNotMatch(source, /投标机会|资源下载|插件管理|plugin-manager|bid-opportunity|plugins:|pluginConfig/);
  }
});
