const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const typescript = require('typescript');

function loadRegionOptions() {
  const source = fs.readFileSync(path.join(__dirname, 'regionOptions.ts'), 'utf8');
  const output = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', output)(module.exports, require, module);
  return module.exports;
}

test('offline province and city options follow the selected province', () => {
  const { provinceOptions, getCityOptions, selectProvince } = loadRegionOptions();
  assert.equal(provinceOptions.length, 34);
  const guangdong = provinceOptions.find((option) => option.name === '广东省');
  assert.ok(guangdong);
  assert.ok(getCityOptions(guangdong.code).some((option) => option.name === '广州市'));
  assert.ok(!getCityOptions(guangdong.code).some((option) => option.name === '上海市'));
  assert.deepEqual(getCityOptions(''), []);
  assert.deepEqual(selectProvince(guangdong.code), { provinceCode: guangdong.code, cityCode: '' });
  const beijing = provinceOptions.find((option) => option.name === '北京市');
  assert.ok(getCityOptions(beijing.code).length > 0);
});

test('folder region label has no placeholder or duplicate municipality', () => {
  const { formatFolderRegion } = loadRegionOptions();
  assert.equal(formatFolderRegion(null, null), '');
  assert.equal(formatFolderRegion('广东省', null), '广东省');
  assert.equal(formatFolderRegion('广东省', '广州市'), '广东省 · 广州市');
  assert.equal(formatFolderRegion('北京市', '北京市'), '北京市');
});
