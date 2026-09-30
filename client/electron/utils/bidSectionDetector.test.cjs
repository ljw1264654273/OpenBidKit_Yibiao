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

test('章节编号后的标的物不误报为多个标段', () => {
  assert.deepEqual(
    detectBidSections([
      '12.投标配置与分项报价表',
      '12.1 投标人应按照招标文件规定格式填报。',
      '12.2 标的物',
      '12.2.1 采购人需求的有关服务等。',
    ].join('\n')),
    { hasMultiple: false, totalDeclared: null },
  );
});

test('多个采购标的不等同于多个投标包', () => {
  assert.deepEqual(
    detectBidSections('本项目共2个标的，整体作为一个采购包实施。'),
    { hasMultiple: false, totalDeclared: null },
  );
});

test('明确声明多个采购包时仍识别为多标段', () => {
  assert.deepEqual(
    detectBidSections('本次采购共划分为2个采购包，供应商可选择其中一个采购包投标。'),
    { hasMultiple: true, totalDeclared: 2 },
  );
});
