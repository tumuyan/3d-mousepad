/* 纯函数级测试：超尺寸贴图的裁剪 / 压缩，以及"以某点为锚点缩放"的反解。

   这些边界以前只能在浏览器里验：先造一张 3360×4800 的 PNG、走上传、等弹窗、
   再拖滑条 —— 一次一分钟。搬成纯函数后同一批断言跑 <10ms，
   而且能覆盖"滑条量程取长边还是短边"这类拖 UI 根本量不到的内部状态。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tfCropSize, tfScale, tfEdgeRange, tfEdgeValue, tfFinalSize,
  tfClampCrop, tfFullCrop, tfApplyAspect, texFactors, zoomTexAbout,
} from '../../src/textureMath.js';

const MAX = 4096;

test('裁剪尺寸 = 裁剪区原像素，不乘任何缩放（默认 1:1 无损）', () => {
  assert.deepEqual(tfCropSize({ x: 10, y: 20, w: 3000, h: 2000 }), { w: 3000, h: 2000 });
});

test('裁剪尺寸不为 0（canvas 不接受 0 宽高）', () => {
  const s = tfCropSize({ x: 0, y: 0, w: 0, h: 0 });
  assert.ok(s.w >= 1 && s.h >= 1);
});

test('压缩只缩不放：目标边长大于当前长边时原样返回', () => {
  assert.deepEqual(tfScale({ w: 800, h: 600 }, 1024), { w: 800, h: 600 });
});

test('压缩按长边等比压小并保持比例', () => {
  const s = tfScale({ w: 3360, h: 4800 }, 1200);
  assert.equal(Math.max(s.w, s.h), 1200);
  assert.ok(Math.abs(s.w / s.h - 3360 / 4800) < 0.01);
});

test('滑条量程上界取原图长边 —— 取短边会让"1:1"变成够不着的死区', () => {
  // 3360×4800 的短边 3360 仍超上限；量程若按短边封顶，拉到最右也回不到原图
  const r = tfEdgeRange(3360, 4800);
  assert.equal(r.max, 4800);
});

test('滑条量程下界是 1 —— 写成 4096 会被浏览器把 1024 夹回 4096，滑条成摆设', () => {
  assert.equal(tfEdgeRange(3360, 4800).min, 1);
});

test('未动过（edge=0）回显为量程上界，即"不压缩"', () => {
  assert.equal(tfEdgeValue(3360, 4800, 0), 4800);
});

test('滑条刻度被夹在量程内（拖出量程的值不会变成"压到 1"）', () => {
  assert.equal(tfEdgeValue(3360, 4800, 1e9), 4800);
  assert.equal(tfEdgeValue(3360, 4800, -5), 1);
});

test('最终尺寸被软上限兜底：超上限的裁剪结果一定被压到上限内', () => {
  const o = tfFinalSize({ x: 0, y: 0, w: 3360, h: 4800 }, 3360, 4800, 4800, MAX);
  assert.ok(o.w <= MAX && o.h <= MAX, `仍超限：${o.w}×${o.h}`);
  assert.equal(Math.max(o.w, o.h), MAX);
});

test('最终尺寸 = 裁剪 → 压缩两段串联（各自只缩不放）', () => {
  const crop = { x: 0, y: 0, w: 3000, h: 3000 };
  const o = tfFinalSize(crop, 3360, 4800, 1000, MAX);
  assert.deepEqual(o, { w: 1000, h: 1000 });
});

test('裁剪框被夹在图内且不小于 16px', () => {
  const c = tfClampCrop({ x: -100, y: -100, w: 2, h: 2 }, 1000, 800, 0);
  assert.ok(c.x >= 0 && c.y >= 0 && c.w >= 16 && c.h >= 16);
  assert.ok(c.x + c.w <= 1000 && c.y + c.h <= 800);
});

test('锁比例时不能各自独立夹取 —— 一边撞边界就被夹成不同比例（1:1 变 0.84）', () => {
  const c = tfClampCrop({ x: 0, y: 0, w: 900, h: 900 }, 400, 800, 1);
  assert.ok(Math.abs(c.w - c.h) < 1e-6, `比例被夹坏：${c.w}×${c.h}`);
});

test('全选 = 整图；锁比例时给内接矩形（3360×4800 锁 1:1 → 3360×3360）', () => {
  assert.deepEqual(tfFullCrop(1000, 800, 0), { x: 0, y: 0, w: 1000, h: 800 });
  const c = tfFullCrop(3360, 4800, 1);
  assert.equal(c.w, 3360);
  assert.equal(c.h, 3360);
});

test('全选出来的框一定装得进图片（无论什么比例）', () => {
  for (const a of [0, 0.5, 0.75, 1, 1.5, 1.7777, 3]) {
    const c = tfFullCrop(3360, 4800, a);
    assert.ok(c.w <= 3360 + 1e-6 && c.h <= 4800 + 1e-6, `比例 ${a} 溢出：${c.w}×${c.h}`);
    if (a) assert.ok(Math.abs(c.w / c.h - a) < 1e-6);
  }
});

test('切换比例以面积为准，中心不动', () => {
  const before = { x: 100, y: 100, w: 400, h: 400 };
  const after = tfApplyAspect(before, 3360, 4800, 1.7777);
  const c0 = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
  const c1 = { x: after.x + after.w / 2, y: after.y + after.h / 2 };
  assert.ok(Math.abs(c0.x - c1.x) < 1 && Math.abs(c0.y - c1.y) < 1);
  assert.ok(Math.abs(after.w / after.h - 1.7777) < 1e-3);
});

test('缩放系数：横图压 u、竖图压 v，且不随 asp 之外的值变化', () => {
  assert.deepEqual(texFactors(2000, 1000, 1), { fx: 0.5, fy: 1 });
  assert.deepEqual(texFactors(1000, 2000, 1), { fx: 1, fy: 0.5 });
});

/* ---- 锚点缩放反解 ----
   tp.s 是 uv 的 repeat 系数：**越大贴图越小**，与画面大小反号。
   滚轮与捏合共用同一个反解函数，两处各写一份必然漏一处。 */
test('锚点缩放：s 变了，但锚点下的贴图像素不动（否则贴图会从手指下溜走）', () => {
  const tp = { s: 1.5, ox: -0.38, oy: -0.275, r: 0, asp: 1 };
  const m = { u: 0.42, v: 0.63 };
  const { fx, fy } = texFactors(1000, 1000, tp.asp);
  const texel = (p) => ({ u: (m.u - 0.5) * p.s * fx + 0.5 + p.ox + (1 - p.s * fx) / 2,
                          v: (m.v - 0.5) * p.s * fy + 0.5 + p.oy + (1 - p.s * fy) / 2 });
  const before = texel(tp);
  const r = zoomTexAbout(tp, 1000, 1000, 0.7, m);
  const after = texel({ ...tp, ...r });
  assert.ok(Math.abs(before.u - after.u) < 1e-9, `u 漂移 ${before.u} → ${after.u}`);
  assert.ok(Math.abs(before.v - after.v) < 1e-9, `v 漂移 ${before.v} → ${after.v}`);
});

test('锚点缩放：带旋转时同样成立（旋转矩阵参与反解，不能漏）', () => {
  const tp = { s: 2, ox: 0.1, oy: -0.2, r: 37, asp: 1.3 };
  const m = { u: 0.31, v: 0.77 };
  const rad = tp.r * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  const { fx, fy } = texFactors(1200, 800, tp.asp);
  const texel = p => {
    const du = (m.u - 0.5) * p.s * fx, dv = (m.v - 0.5) * p.s * fy;
    return { u: c * du + s * dv + 0.5 + p.ox + (1 - p.s * fx) / 2,
             v: -s * du + c * dv + 0.5 + p.oy + (1 - p.s * fy) / 2 };
  };
  const before = texel(tp);
  const r = zoomTexAbout(tp, 1200, 800, 0.4, m);
  const after = texel({ ...tp, ...r });
  assert.ok(Math.abs(before.u - after.u) < 1e-9 && Math.abs(before.v - after.v) < 1e-9);
});

test('锚点缩放：偏移被夹在 ±1（反解出来的值可能超出滑条量程）', () => {
  const r = zoomTexAbout({ s: 5, ox: 0, oy: 0, r: 0, asp: 1 }, 1000, 1000, 0.05, { u: 0.01, v: 0.99 });
  assert.ok(r.ox >= -1 && r.ox <= 1 && r.oy >= -1 && r.oy <= 1);
});

test('锚点缩放：无锚点（射线未命中垫面）时退化为只改 s', () => {
  const r = zoomTexAbout({ s: 1.5, ox: 0.2, oy: 0.3, r: 0, asp: 1 }, 1000, 1000, 0.8, null);
  assert.equal(r.s, 0.8);
  assert.equal(r.ox, 0.2);
  assert.equal(r.oy, 0.3);
});

test('锚点缩放：s 是反号 —— 放大画面需要 s 变小（与捏合 d0/d 同向）', () => {
  // 手指张开 → 想放大 → s 必须变小；此处直接断言 s 被写成了传入的目标值，
  // 方向的正确性由"锚点不动"那两条 + 浏览器里的红半边宽度断言共同保证。
  const r = zoomTexAbout({ s: 1.5, ox: 0, oy: 0, r: 0, asp: 1 }, 1000, 1000, 0.7, { u: 0.5, v: 0.5 });
  assert.equal(r.s, 0.7);
});
