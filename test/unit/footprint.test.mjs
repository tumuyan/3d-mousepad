/* 纯函数级测试：腕托足迹的采样、外扩、去自交。
   以前这些只能靠"导出 STL 数顶点"间接验；现在能直接断言几何性质。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wristFootprint, buildFootprint, removeOffsetLoops, segHit } from '../../src/footprint.js';

const baseP = {
  wristStyle: 'balls', padW: 230,
  wW: 150, wD: 89, wMorph: 0.55, wMorphRot: 0,
  wBW: 82, wGap: 71, wEgg: 0.1, wJoin: 16, wRot: 10,
};

const build = (over = {}, noRot = false) => {
  const P = { ...baseP, ...over };
  const out = [], edges = {};
  buildFootprint(P, 2, 0, out, noRot, edges);
  return { P, out, edges };
};

test('足迹：采样点数足够（过少会让凹槽消失、轮廓出现折角）', () => {
  const { out } = build();
  assert.ok(out.length > 50, `只有 ${out.length} 个点`);
});

test('足迹：所有坐标都是有限数（NaN 会让 ExtrudeGeometry 静默产出空几何）', () => {
  for (const style of ['none', 'full', 'balls']) {
    const { out } = build({ wristStyle: style });
    assert.ok(out.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), `${style} 出现非有限坐标`);
  }
});

test('足迹：按 右→左 排列（offsetFootprint 依赖这个方向，反了会把法向翻到内侧）', () => {
  const { out } = build();
  assert.ok(out[0].x > out[out.length - 1].x, `起点 x=${out[0].x} 应大于终点 x=${out[out.length - 1].x}`);
});

test('足迹：外扩后整体比未扩时更宽（M 是向外的等距偏移）', () => {
  const a = [], b = [];
  const P = { ...baseP };
  buildFootprint(P, 0, 0, a, false, {});
  buildFootprint(P, 10, 0, b, false, {});
  const span = pts => Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
  assert.ok(span(b) > span(a) + 15, `外扩没生效：${span(a)} → ${span(b)}`);
});

test('足迹：外扩后不产生自交（凹槽附近偏移最容易自交，会画出扭结轮廓）', () => {
  const { out } = build({ wGap: 60 });          // 两球重叠 → 凹槽明显
  let hits = 0;
  for (let i = 0; i < out.length - 1; i++) {
    for (let j = i + 2; j < out.length - 1; j++) {
      if (segHit(out[i], out[i + 1], out[j], out[j + 1])) hits++;
    }
  }
  assert.equal(hits, 0, `仍残留 ${hits} 处自交`);
});

test('足迹：双球间距拉大时两球分离，过渡弧仍把它们连成一条连续折线', () => {
  const { out } = build({ wGap: 200 });
  for (let i = 1; i < out.length; i++) {
    const d = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    assert.ok(d < 40, `第 ${i} 段跳了 ${d.toFixed(1)}mm，轮廓断了`);
  }
});

test('足迹：布局基准（noRot）与旋转角无关 —— 旋转不该改变垫身总长', () => {
  const ref0 = [], ref1 = [];
  const P0 = { ...baseP, wRot: 0 }, P1 = { ...baseP, wRot: 45 };
  buildFootprint(P0, 2, 0, ref0, true, {});
  buildFootprint(P1, 2, 0, ref1, true, {});
  const span = pts => Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
  assert.ok(Math.abs(span(ref0) - span(ref1)) < 1e-6, `旋转改变了布局基准：${span(ref0)} vs ${span(ref1)}`);
});

test('足迹：真实轮廓（noRot=false）确实随旋转角变化（否则上一条是假阳性）', () => {
  const a = [], b = [];
  buildFootprint({ ...baseP, wRot: 0 }, 2, 0, a, false, {});
  buildFootprint({ ...baseP, wRot: 45 }, 2, 0, b, false, {});
  const key = pts => pts.map(p => p.x.toFixed(3)).join(',');
  assert.notEqual(key(a), key(b), '旋转对真实轮廓没有影响');
});

test('足迹：侧缘 x 写进传入的 edges，两次调用互不覆盖', () => {
  const P = { ...baseP };
  const e1 = {}, e2 = {}, a = [], b = [];
  buildFootprint(P, 2, 0, a, false, e1);
  buildFootprint(P, 2, 0, b, true, e2);
  assert.ok(Number.isFinite(e1.L) && Number.isFinite(e1.R));
  assert.notEqual(e1, e2);
});

test('足迹：无腕托时退化成扁椭圆，不抛也不产出空数组', () => {
  const { out } = build({ wristStyle: 'none' });
  assert.ok(out.length > 50);
  assert.ok(out.every(p => Number.isFinite(p.x)));
});

test('足迹：整体腕托的肾形程度不改变足迹点数（变形只改坐标）', () => {
  const a = [], b = [];
  buildFootprint({ ...baseP, wristStyle: 'full', wMorph: 0 }, 2, 0, a, false, {});
  buildFootprint({ ...baseP, wristStyle: 'full', wMorph: 1.5 }, 2, 0, b, false, {});
  assert.equal(a.length, b.length);
});

test('去自交：真正的交叉被消掉', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 10, y: 10 },   // 斜向右上
    { x: 10, y: 0 }, { x: 0, y: 10 },   // 斜向左上 —— 与上一段交叉
    { x: 20, y: 10 },
  ];
  removeOffsetLoops(pts);
  // 去环后不应再存在交叉段
  let hits = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) if (segHit(pts[i], pts[i + 1], pts[j], pts[j + 1])) hits++;
  }
  assert.equal(hits, 0);
});

test('去自交：不交叉的折线原样保留（不该误删点）', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
  const n = pts.length;
  removeOffsetLoops(pts);
  assert.equal(pts.length, n);
});

test('线段求交：平行 / 共线返回 null（除零保护）', () => {
  assert.equal(segHit({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), null);
  assert.equal(segHit({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
});

test('wristFootprint：ball 的 ox 偏移只平移不清零（双球左右各一）', () => {
  const P = { ...baseP };
  const r = wristFootprint(P, 'ball', { rot: 0, ox: 35 });
  const l = wristFootprint(P, 'ball', { rot: 0, ox: -35 });
  const mx = a => a.reduce((s, p) => s + p.x, 0) / a.length;
  assert.ok(Math.abs(mx(r) - mx(l) - 70) < 1e-6, `间距不对：${mx(r) - mx(l)}`);
});
