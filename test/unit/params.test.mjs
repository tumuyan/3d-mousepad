/* 纯函数级测试：参数白名单校验与配置迁移。
   这些用例**不需要浏览器**：params.js / config.js 不 import three，node 直接跑，
   单次 <50ms —— 而同样的断言放在 Playwright 里要先起浏览器再等 3.5s CDN。

   用法：node --test test/unit/
   与浏览器冒烟脚本的分工：这里测"计算对不对"，那里测"画出来对不对"。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P_DEFAULTS, PARAM_SCHEMA, sanitizeParams, missingSchemaKeys } from '../../src/params.js';
import { CONFIG_VERSION } from '../../src/params.js';
import { migrateConfig } from '../../src/config.js';

test('每个参数都在 PARAM_SCHEMA 里登记（漏登记 = 导入时静默丢弃）', () => {
  assert.deepEqual(missingSchemaKeys(), []);
});

test('每个参数都声明了变更意图 onChange（漏声明 = 靠人记该不该重建）', () => {
  const missing = Object.keys(P_DEFAULTS).filter(k => !PARAM_SCHEMA[k]?.onChange);
  assert.deepEqual(missing, [], `缺 onChange：${missing.join('、')}`);
});

test('导入：白名单外的键被丢弃，不写进 P', () => {
  const { params, unknown } = sanitizeParams({ padW: 250, evilKey: 'x' });
  assert.equal('evilKey' in params, false);
  assert.deepEqual(unknown, ['evilKey']);
});

test('导入：语义是完整快照而非合并 —— 没写的键回到默认值', () => {
  const { params } = sanitizeParams({ padW: 250 });
  assert.equal(params.padW, 250);
  assert.equal(params.padH, P_DEFAULTS.padH);
});

test('导入：越界数值被夹回范围（夹紧不算异常，不告警）', () => {
  const { params, warnings } = sanitizeParams({ padW: 99999 });
  assert.equal(params.padW, PARAM_SCHEMA.padW.max);
  assert.equal(warnings.includes('padW'), false, '夹紧是常规处理，不该报"已回退默认"');
});

test('导入：非法枚举无法夹紧，回退默认并告警', () => {
  const { params, warnings } = sanitizeParams({ shape: 'nope' });
  assert.equal(params.shape, P_DEFAULTS.shape);
  assert.ok(warnings.includes('shape'));
});

test('导入：NaN / Infinity 不会透进几何', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'abc', null]) {
    const { params } = sanitizeParams({ padW: bad });
    assert.ok(Number.isFinite(params.padW), `${bad} 漏进去了`);
  }
});

test('导入：整数字段被取整而非保留小数', () => {
  const { params } = sanitizeParams({ exportScale: 2.7 });
  assert.equal(params.exportScale, 3);
});

test('导入：颜色必须是 #rrggbb，其他形式一律回退', () => {
  for (const bad of ['red', '#fff', '#GGGGGG', 123]) {
    const { params } = sanitizeParams({ matColor: bad });
    assert.equal(params.matColor, P_DEFAULTS.matColor, `${bad} 被放行了`);
  }
  assert.equal(sanitizeParams({ matColor: '#A1B2C3' }).params.matColor, '#A1B2C3');
});

test('导入：classicCtrl 少于 4 点视为非法，回退默认锚点', () => {
  const { params, warnings } = sanitizeParams({ classicCtrl: [{ x: 1, y: 2 }] });
  assert.ok(Array.isArray(params.classicCtrl) && params.classicCtrl.length >= 4);
  assert.ok(warnings.includes('classicCtrl'));
});

test('导入：classicCtrl 兼容旧版 {p:{x,y}} 嵌套结构', () => {
  const legacy = [
    { p: { x: -70, y: -110 }, pin: true }, { p: { x: -60, y: -40 } },
    { p: { x: 0, y: 100 } }, { p: { x: 70, y: -110 }, pin: true },
  ];
  const { params, warnings } = sanitizeParams({ classicCtrl: legacy });
  assert.equal(warnings.includes('classicCtrl'), false);
  assert.deepEqual({ x: params.classicCtrl[0].x, y: params.classicCtrl[0].y }, { x: -70, y: -110 });
});

test('导入：classicCtrl 的坐标被夹到 ±5000（越界会把编辑视口拉到荒谬尺度）', () => {
  const { params } = sanitizeParams({ classicCtrl: [
    { x: 1e9, y: 0 }, { x: 0, y: 1e6 }, { x: -1e9, y: 0 }, { x: 0, y: -1e6 },
  ] });
  for (const p of params.classicCtrl) {
    assert.ok(Math.abs(p.x) <= 5000 && Math.abs(p.y) <= 5000);
  }
});

test('导入：贴图变换是完整对象，缺字段按 t1 默认值补齐', () => {
  const { params } = sanitizeParams({ t2: { s: 2 } });
  assert.equal(params.t2.s, 2);
  assert.equal(params.t2.wrap, P_DEFAULTS.t1.wrap);
  assert.equal(params.t2.ox, P_DEFAULTS.t1.ox);
});

test('导入：非法输入（null / 数组 / 字符串）不会抛，整体回退默认值', () => {
  for (const bad of [null, undefined, [], 'x', 42]) {
    const { params } = sanitizeParams(bad);
    assert.equal(params.padW, P_DEFAULTS.padW);
  }
});

test('版本迁移：当前版本原样返回，不做任何改写', () => {
  const cfg = { type: '3dm-config', version: CONFIG_VERSION, params: {} };
  const { cfg: out, version } = migrateConfig(cfg);
  assert.equal(out, cfg);
  assert.equal(version, CONFIG_VERSION);
});

test('版本迁移：缺迁移步骤时停在能到的最高版本，由校验兜底（不静默丢弃）', () => {
  const { version } = migrateConfig({ version: 1 });
  assert.ok(version <= CONFIG_VERSION);
});
