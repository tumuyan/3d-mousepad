/* 经典款上半轮廓的贝塞尔锚点：烘焙 / 平滑 / 校验。纯数学，不 import three，
   故拖锚点这类手感问题能在 node:test 里用数值断言钉住（见 test/unit/anchors.test.mjs）。 */

export function bakeClassicCtrl(P, pBL, pBR, dBLv, dBRv, topY) {
  const halfW = P.padW / 2;
  const yBL = pBL.y, yBR = pBR.y;
  const spanL = topY - yBL, spanR = topY - yBR;
  // 切线长度取相邻锚点间距的经验比例，保证初始形状即平滑饱满
  const mk = (x, y) => ({ x, y, h1: { x, y }, h2: { x, y } });
  const pts = [
    { ...mk(pBL.x, yBL), pin: true },
    mk(-halfW * 0.985, yBL + spanL * 0.34),          // 左腰
    mk(-halfW * 0.90, yBL + spanL * 0.72),           // 左肩
    mk(-halfW * 0.06, topY),                          // 顶（略偏左，符合人机工程）
    mk(halfW * 0.88, yBR + spanR * 0.70),            // 右肩
    mk(halfW * 0.97, yBR + spanR * 0.32),            // 右腰
    { ...mk(pBR.x, yBR), pin: true },
  ];
  // 端点切线：严格继承足迹端点切线做 G1 衔接（左右对称，数学正确）。
  // 底轮廓在端点处的切向与上半轮廓起点切向天然反向（闭曲线），故取 -dBLv / -dBRv。
  autoSmoothClassicCtrl(pts);
  const n = pts.length - 1;
  const t0 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) * 0.42;
  pts[0].h2 = { x: pts[0].x - dBLv.x * t0, y: pts[0].y - dBLv.y * t0 };
  const tN = Math.hypot(pts[n - 1].x - pts[n].x, pts[n - 1].y - pts[n].y) * 0.42;
  pts[n].h1 = { x: pts[n].x - dBRv.x * tN, y: pts[n].y - dBRv.y * tN };
  return pts;
}

export function autoSmoothClassicCtrl(pts) {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[i - 1] || p, b = pts[i + 1] || p;
    const tx = (b.x - a.x) * 0.5, ty = (b.y - a.y) * 0.5;
    const dPrev = Math.hypot(p.x - a.x, p.y - a.y);
    const dNext = Math.hypot(b.x - p.x, b.y - p.y);
    const L = Math.hypot(tx, ty) || 1;
    const k1 = Math.min(dPrev * 0.42, L) / L;
    const k2 = Math.min(dNext * 0.42, L) / L;
    p.h1 = { x: p.x - tx * k1, y: p.y - ty * k1 };
    p.h2 = { x: p.x + tx * k2, y: p.y + ty * k2 };
  }
}

export function ensureClassicCtrl(P, pBL, pBR, dBLv, dBRv, topY) {
  let c = P.classicCtrl;
  const stale = !Array.isArray(c) || c.length < 3
    || !c[0] || !c[c.length - 1]
    || c.some(p => !p
        || !Number.isFinite(p.x) || !Number.isFinite(p.y)
        || ((p.h1 || p.h2) && (!p.h1 || !p.h2
            || !Number.isFinite(p.h1.x) || !Number.isFinite(p.h1.y)
            || !Number.isFinite(p.h2.x) || !Number.isFinite(p.h2.y))));
  if (stale) {
    P.classicCtrl = bakeClassicCtrl(P, pBL, pBR, dBLv, dBRv, topY);
    return P.classicCtrl;
  }
  // 腕托尺寸/位置变化时，仅平移两端 pin 锚点并重算其切线，中间锚点不动
  const first = c[0], last = c[c.length - 1];
  // ⚠️ 早退条件只跳过"平移"，不能跳过切线：接缝已在位却缺手柄的锚点
  // （手写配置常见）会带着 undefined 进 makeClassicShape，读 a.h2 时直接抛。
  const moveEnd = (p, target, dir, neighbor, isFirst) => {
    p.x = target.x; p.y = target.y;
    const t = Math.hypot(neighbor.x - p.x, neighbor.y - p.y) * 0.42;
    const h = { x: p.x - dir.x * t, y: p.y - dir.y * t };
    if (isFirst) p.h2 = h; else p.h1 = h;
  };
  moveEnd(first, pBL, dBLv, c[1], true);
  moveEnd(last, pBR, dBRv, c[c.length - 2], false);
  first.pin = last.pin = true;
  // “接缝”类锚点（设计稿可能只存 p、无 h1/h2）补一对平滑共线手柄，
  // 避免 makeClassicShape() 的贝塞尔链读到 undefined 手柄。
  // ⚠️ 遍历范围含首尾：只补中间的话，两端缺手柄的锚点仍会让贝塞尔链崩。
  for (let i = 0; i < c.length; i++) {
    const p = c[i];
    if (p.h1 && p.h2) continue;
    const a = c[i - 1] || p, b = c[i + 1] || p;
    const tx = (b.x - a.x) * 0.5, ty = (b.y - a.y) * 0.5;
    const L = Math.hypot(tx, ty) || 1;
    const k1 = Math.min(Math.hypot(p.x - a.x, p.y - a.y) * 0.42, L) / L;
    const k2 = Math.min(Math.hypot(b.x - p.x, b.y - p.y) * 0.42, L) / L;
    p.h1 = { x: p.x - tx * k1, y: p.y - ty * k1 };
    p.h2 = { x: p.x + tx * k2, y: p.y + ty * k2 };
  }
  return c;
}

// 经典款：轮廓 = 贴合腕托的等距底部曲线 + 平滑侧边/顶部
