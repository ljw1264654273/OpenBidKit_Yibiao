const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { getOpenXmlHelperLaunch } = require('./openXmlHelperService.cjs');

test('development helper runs the framework-dependent dll through dotnet', () => {
  const workspace = path.join('C:', 'workspace');
  const launch = getOpenXmlHelperLaunch({ isPackaged: false }, workspace);

  assert.equal(launch.command, 'dotnet');
  assert.equal(path.basename(launch.args[0]), 'openxmlhelper.dll');
  assert.deepEqual(launch.args.slice(1), ['--workspace', workspace]);
});

