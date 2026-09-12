const assert = require('node:assert/strict');
const test = require('node:test');

const { detectBidSections } = require('./bidSectionDetector.cjs');

test('明确声明多个标段时返回标段总数', () => {
  assert.deepEqual(
    detectBidSections('本项目共划分为3个标段。投标人可选择其中一个标段投标。'),
    { hasMultiple: true, totalDeclared: 3 },
  );
});

test('明确声明不划分标段时不误报', () => {
  assert.deepEqual(
    detectBidSections('本项目不划分标段，采购内容作为一个整体采购包件。'),
    { hasMultiple: false, totalDeclared: null },
  );
});

test('连续标段标题可识别为多标段', () => {
  assert.equal(
    detectBidSections('一标段：设备采购\n二标段：安装服务').hasMultiple,
    true,
  );
});

test('采购文件使用标项一二三时可识别为多标段', () => {
  assert.deepEqual(
    detectBidSections(`
      本次采购共3个标项，主要内容为：
      标项一：望海街道、武原街道。
      标项二：澉浦镇、秦山街道。
      标项三：百步镇、沈荡镇。
    `),
    { hasMultiple: true, totalDeclared: 3 },
  );
});
