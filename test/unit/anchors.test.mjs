/* 纯函数级测试：经典款上半轮廓的贝塞尔锚点 —— 烘焙 / 平滑 / 校验。

   这些是拖锚点手感的数学根基。以前只能靠"拖一下看画面"验，
   现在能直接断言"pin 锚点是否钉在接缝上""手柄是否共线"这类数值性质。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakeClassicCtrl, autoSmoothClassicCtrl, ensureClassicCtrl } from '../../src/anchors.js';
import { DEFAULT_CLASSIC_CTRL } from '../../src/params.js';

const P = { padW: 230 };
const SEAM_L = { x: -70, y: -110 }, SEAM_R = { x: 70, y: -110 };
// 端点切线：离开端点沿底轮廓向内的方向（下方），两侧同向才视觉对称
const dL = { x: 0, y: -1 }, dR = { x: 0, y: -1 };

const finite = p => Number.isFinite(p.x) && Number.isFinite(p.y)
  && Number.isFinite(p.h1.x) && Number.isFinite(p.h1.y)
  && Number.isFinite(p.h2.x) && Number.isFinite(p.h2.y);

test('烘焙：首尾锚点正好落在腕托接缝上（pin）', () => {
  const pts = bakeClassicCtrl(P, SEAM_L, SEAM_R, dL, dR, 130);
  assert.equal(pts[0].pin, true);
  assert.equal(pts[pts.length - 1].pin, true);
  assert.deepEqual({ x: pts[0].x, y: pts[0].y }, SEAM_L);
  assert.deepEqual({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }, SEAM_R);
});

test('烘焙：点数不固定，但至少 4 点（否则构不成闭合轮廓）', () => {
  const pts = bakeClassicCtrl(P, SEAM_L, SEAM_R, dL, dR, 130);
  assert.ok(pts.length >= 4);
});

test('烘焙：不会改写入参的接缝对象（烘焙是纯生成）', () => {
  const seam = { x: -70, y: -110 };
  bakeClassicCtrl(P, seam, { x: 70, y: -110 }, dL, dR, 130);
  assert.deepEqual(seam, { x: -70, y: -110 });
});

test('烘焙：端点切线继承足迹方向（G1 衔接，不在接缝处出现折痕）', () => {
  const pts = bakeClassicCtrl(P, SEAM_L, SEAM_R, { x: 0.6, y: -0.8 }, { x: -0.6, y: -0.8 }, 130);
  const n = pts.length - 1;
  // 首点 h2 应沿 -dL 方向离开锚点（底轮廓在端点处与上半轮廓反向）
  const v0 = { x: pts[0].h2.x - pts[0].x, y: pts[0].h2.y - pts[0].y };
  const l0 = Math.hypot(v0.x, v0.y) || 1;
  assert.ok((v0.x / l0) * -0.6 + (v0.y / l0) * 0.8 > 0.99, '首点切线未继承足迹方向');
  const vN = { x: pts[n].h1.x - pts[n].x, y: pts[n].h1.y - pts[n].y };
  const lN = Math.hypot(vN.x, vN.y) || 1;
  assert.ok((vN.x / lN) * 0.6 + (vN.y / lN) * 0.8 > 0.99, '末点切线未继承足迹方向');
});

test('平滑：中间锚点的两个手柄与相邻点共线（G1 连续的必要条件）', () => {
  const pts = bakeClassicCtrl(P, SEAM_L, SEAM_R, dL, dR, 130);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    // h1 - p 与 h2 - p 必须反向共线
    const a = { x: p.h1.x - p.x, y: p.h1.y - p.y };
    const b = { x: p.h2.x - p.x, y: p.h2.y - p.y };
    const la = Math.hypot(a.x, a.y) || 1, lb = Math.hypot(b.x, b.y) || 1;
    const dot = (a.x / la) * (b.x / lb) + (a.y / la) * (b.y / lb);
    assert.ok(dot < -0.999, `第 ${i} 个锚点手柄不共线，dot=${dot}`);
  }
});

test('平滑：所有手柄都是有限数（NaN 会让 ExtrudeGeometry 静默崩）', () => {
  const pts = bakeClassicCtrl(P, SEAM_L, SEAM_R, dL, dR, 130);
  assert.ok(pts.every(finite));
});

test('平滑：对单点数组不越界（首尾没有邻居时也能跑完）', () => {
  const single = [{ x: 0, y: 0 }];
  autoSmoothClassicCtrl(single);
  assert.ok(finite(single[0]));
});

test('校验：空 / 非法锚点会被重新烘焙，而不是带着 NaN 进几何', () => {
  for (const bad of [null, undefined, [], [{ x: NaN, y: 0 }], [{ x: 1 }]]) {
    const P2 = { padW: 230, classicCtrl: bad };
    const c = ensureClassicCtrl(P2, SEAM_L, SEAM_R, dL, dR, 130);
    assert.ok(Array.isArray(c) && c.length >= 4, '未被重新烘焙');
    assert.ok(c.every(finite));
  }
});

test('校验：合法锚点原样保留（用户的编辑结果不被覆盖）', () => {
  const mine = [{ x: -70, y: -110, h1: { x: -70, y: -110 }, h2: { x: -60, y: -90 }, pin: true },
                { x: 0, y: 120, h1: { x: -30, y: 120 }, h2: { x: 30, y: 120 } },
                { x: 70, y: -110, h1: { x: 60, y: -90 }, h2: { x: 70, y: -110 }, pin: true }];
  const P2 = { padW: 230, classicCtrl: mine };
  const c = ensureClassicCtrl(P2, SEAM_L, SEAM_R, dL, dR, 130);
  assert.equal(c, mine, '合法锚点被换掉了');
  assert.equal(c[1].y, 120);
});

test('校验：接缝移动时只平移两端 pin 锚点，中间锚点不动', () => {
  const mine = [{ x: -70, y: -110, h1: { x: -70, y: -110 }, h2: { x: -60, y: -90 }, pin: true },
                { x: 0, y: 120, h1: { x: -30, y: 120 }, h2: { x: 30, y: 120 } },
                { x: 70, y: -110, h1: { x: 60, y: -90 }, h2: { x: 70, y: -110 }, pin: true }];
  const P2 = { padW: 230, classicCtrl: mine.map(p => ({ ...p, h1: { ...p.h1 }, h2: { ...p.h2 } })) };
  const moved = { x: -85, y: -125 }, movedR = { x: 85, y: -125 };
  ensureClassicCtrl(P2, moved, movedR, dL, dR, 130);
  assert.deepEqual({ x: P2.classicCtrl[0].x, y: P2.classicCtrl[0].y }, moved);
  assert.deepEqual({ x: P2.classicCtrl[2].x, y: P2.classicCtrl[2].y }, movedR);
  assert.equal(P2.classicCtrl[1].y, 120, '中间锚点被接缝带走了');
});

test('校验：缺手柄的中间锚点会被补一对共线手柄（防止读到 undefined 崩溃）', () => {
  const P2 = { padW: 230, classicCtrl: [
    { x: -70, y: -110, pin: true }, { x: 0, y: 120 }, { x: 70, y: -110, pin: true },
    { x: 40, y: -100 }, { x: -40, y: -100 },
  ] };
  const c = ensureClassicCtrl(P2, SEAM_L, SEAM_R, dL, dR, 130);
  assert.ok(c.every(finite), '仍有锚点缺手柄或坐标非有限');
});

test('出厂默认锚点：坐标与手柄全有限，且能被深拷贝（配置文件往返的前提）', () => {
  // pin 标记是运行时由 ensureClassicCtrl 补上的（设计稿里只有坐标 + 手柄），故这里不断言它
  assert.ok(DEFAULT_CLASSIC_CTRL.length >= 4);
  assert.ok(DEFAULT_CLASSIC_CTRL.every(finite));
  // structuredClone 是运行时的深拷贝来源，必须能处理它
  const copy = structuredClone(DEFAULT_CLASSIC_CTRL);
  assert.deepEqual(copy, DEFAULT_CLASSIC_CTRL);
});
