/* 腕托足迹：采样 → 等距外扩 → 去自交 → 双球过渡弧。纯几何，不 import three。
   ⚠️ 变换链必须与 3D 腕托逐字一致：单位球 → 变形 → 按半轴缩放 → 绕 y 旋转（T·R·S）。
   先旋转后缩放对非圆截面（rx≠rz）会得出与真实 cushion 完全不同的轮廓。 */

const BSTEPS = 100;

const degToRad = d => d * Math.PI / 180;

export function wristFootprint(P, kind, opts = {}) {
  const raw = [];
  if (kind === 'full') {
    const rx = P.wW / 2, ry = P.wD / 2, k = P.wMorph;
    const rad = opts.noRot ? 0 : degToRad(P.wMorphRot || 0);
    const c = Math.cos(rad), s = Math.sin(rad);
    // 足迹取「垫身坐标系下最左/最右两点之间、且经过最前端」的那半条轮廓：
    // 未旋转时即 t∈[0,π]；旋转后轮廓最宽点随之偏移 t0，两端接缝仍落在最宽处，
    // 否则旋转后会把侧缘切掉或留下缺口（t0 处 x 取极值，恒为正 → 起点是最右点）
    const t0 = Math.atan2(ry * s, rx * c);
    for (let i = 0; i <= BSTEPS; i++) {
      const t = t0 + (i / BSTEPS) * Math.PI;     // 右→左沿前半圈
      const x0u = Math.cos(t), z0u = Math.sin(t);
      // 标准朝向先变形（肾型形状固定），旋转在缩放之后统一施加
      let x1u = x0u, z1u = z0u;
      if (k > 0) {
        const g = Math.exp(-((x0u / 0.55) ** 2));
        const front = Math.max(0, z0u);
        z1u = z0u - k * 0.55 * g * front * front;
        x1u = x0u * (1 + k * 0.12);
      }
      const px = x1u * rx, pz = z1u * ry;        // 缩放（mesh.scale）
      raw.push({ x: c * px + s * pz,             // 绕 y 旋转，与 wristGroup.rotation.y 同向
                 z: -s * px + c * pz });
    }
  } else if (kind === 'ball') {
    // 单个双球：单位球 → 鹅蛋变形 → 缩放 → 绕 y 旋 wRot → 平移
    const sx = P.wBW / 2, sz = P.wD / 2, e = P.wEgg;
    const rad = opts.noRot ? 0 : (opts.rot || 0);
    const c = Math.cos(rad), s = Math.sin(rad);
    const ox = opts.ox || 0;
    for (let i = 0; i <= BSTEPS; i++) {
      const t = (i / BSTEPS) * Math.PI;          // 0..π，右→左沿前半圆
      let xu = Math.cos(t), zu = Math.sin(t);
      if (e) xu *= (1 + e * zu);                 // 鹅蛋：x 随 z 缩放
      const px = xu * sx, pz = zu * sz;          // 缩放（mesh.scale）
      raw.push({ x: ox + (c * px + s * pz),      // 绕 y 旋转（mesh.rotation.y）
                 z: -s * px + c * pz });
    }
  } else { // none：无腕托时用一段扁椭圆作为底边足迹（局部坐标，中心在原点）
    const rx = P.padW / 2, ry = P.padW * 0.25;
    for (let i = 0; i <= BSTEPS; i++) {
      const t = (i / BSTEPS) * Math.PI;
      raw.push({ x: Math.cos(t) * rx, z: Math.sin(t) * ry });
    }
  }
  return raw;
}
export function segHit(a1, a2, b1, b2) {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / den;
  const s = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / den;
  return (t > 1e-6 && t < 1 - 1e-6 && s > 1e-6 && s < 1 - 1e-6)
    ? { x: a1.x + d1x * t, y: a1.y + d1y * t } : null;
}

// 偏移折线去环：交叉时保留最外圈（修复凹槽附近偏移自交）
export function removeOffsetLoops(pts) {
  for (let pass = 0; pass < 6; pass++) {
    let done = true;
    outer:
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = i + 2; j < pts.length - 1; j++) {
        const hit = segHit(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (hit) {
          pts.splice(i + 1, j - i, hit);
          done = false;
          break outer;
        }
      }
    }
    if (done) break;
  }
}

// 把“原始足迹”沿曲线法向向外偏移 M，写入 out
// 未加 overhang 的腕托原始侧缘 x（腰线基准）。写进传入的 edges 对象而非模块级变量：
// 同一帧内 makeClassicShape 会跑两次 buildFootprint（真实轮廓 + 布局基准），
// 模块级变量会让第二次覆盖第一次。
export function offsetFootprint(raw, pushEdges, out, M, zBase, edges) {
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    let nx = dz / len, nz = -dx / len;
    const rlen = Math.hypot(p.x, p.z) || 1;
    if (nx * (p.x / rlen) + nz * (p.z / rlen) < 0) { nx = -nx; nz = -nz; }
    out.push({ x: p.x + nx * M, y: -(zBase + p.z + nz * M) });
  }
  if (pushEdges) {
    edges.R = raw[0].x;
    edges.L = raw[raw.length - 1].x;
  }
  removeOffsetLoops(out);
}

export function buildFootprint(P, M, zBase, out, noRot, edges) {
  if (P.wristStyle === 'full') {
    offsetFootprint(wristFootprint(P, 'full', { noRot }), !noRot, out, M, zBase, edges);
  } else if (P.wristStyle === 'balls') {
    const rot = noRot ? 0 : degToRad(P.wRot);
    const half = P.wGap / 2;
    const rxb = P.wBW / 2;
    // 右球：右→左；左球：右→左
    const rightBall = wristFootprint(P, 'ball', { rot: -rot, ox: half, noRot });
    const leftBall  = wristFootprint(P, 'ball', { rot:  rot, ox: -half, noRot });

    // 足迹曲线 i 点的前向切线（中心差分）
    function tanAt(arr, i) {
      const a = arr[Math.max(0, i - 1)], b = arr[Math.min(arr.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
    }

    // 双球间过渡弧：以两端切线做三次 Hermite 桥，替换/连接两侧弧段
    // kA/kB = 每侧被替换的采样数（0=保留原始相交尖角）
    // n = 桥采样密度
    function bridge(rawR, iA, rawL, iB, kA, kB, n) {
      const A = rawR[iA], B = rawL[iB];
      const mA = tanAt(rawR, iA), mB = tanAt(rawL, iB);
      // 切线臂长 ≈ 被替换的弧弦长，且不超过两端距离的一半
      const chordAB = Math.hypot(B.x - A.x, B.z - A.z);
      const armA = Math.min(Math.hypot(rawR[Math.min(iA + kA, BSTEPS)].x - A.x,
                                        rawR[Math.min(iA + kA, BSTEPS)].z - A.z) * 0.9,
                            chordAB * 0.45);
      const armB = Math.min(Math.hypot(rawL[Math.max(iB - kB, 0)].x - B.x,
                                        rawL[Math.max(iB - kB, 0)].z - B.z) * 0.9,
                            chordAB * 0.45);
      const bpts = [];
      for (let j = 1; j <= n; j++) {
        const t = j / (n + 1), u = 1 - t;
        bpts.push({
          x: u*u*u*A.x + 3*u*u*t*(A.x + mA.x*armA) + 3*u*t*t*(B.x - mB.x*armB) + t*t*t*B.x,
          z: u*u*u*A.z + 3*u*u*t*(A.z + mA.z*armA) + 3*u*t*t*(B.z - mB.z*armB) + t*t*t*B.z,
        });
      }
      return { pts: bpts };
    }

    let raw;
    if (half < rxb) {
      // 两球重叠：找两曲线最近点对作为交接处
      let bi = 0, bj = 0, bd = Infinity;
      for (let i = 0; i <= BSTEPS; i++) {
        for (let j = 0; j <= BSTEPS; j++) {
          const dx = rightBall[i].x - leftBall[j].x;
          const dz = rightBall[i].z - leftBall[j].z;
          const dd = dx * dx + dz * dz;
          if (dd < bd) { bd = dd; bi = i; bj = j; }
        }
      }
      // 用独立过渡弧替换交点附近的原始相交尖角
      const wJoin = P.wJoin != null ? P.wJoin : 16;
      if (wJoin > 0 && bi >= 2 && bj <= BSTEPS - 2) {
        const kA = Math.min(wJoin, bi - 1);
        const kB = Math.min(wJoin, BSTEPS - 1 - bj);
        const br = bridge(rightBall, bi - kA, leftBall, bj + kB, kA, kB, Math.max(10, kA));
        raw = rightBall.slice(0, bi - kA + 1).concat(br.pts, leftBall.slice(bj + kB));
      } else {
        raw = rightBall.slice(0, bi + 1).concat(leftBall.slice(bj));
      }
    } else {
      // 两球分离：同样插入一段独立过渡弧连接两球边缘
      const wJoin = P.wJoin != null ? P.wJoin : 16;
      const kSep = Math.max(2, Math.min(30, Math.round(BSTEPS * wJoin / 16 * 0.12)));
      if (wJoin > 0 && BSTEPS - kSep >= 1 && kSep <= BSTEPS - 1) {
        // 从两球相向端各回退若干采样，用过渡弧连接
        const br = bridge(rightBall, BSTEPS - kSep, leftBall, kSep, kSep, kSep,
                          Math.max(12, kSep));
        raw = rightBall.slice(0, BSTEPS - kSep + 1).concat(br.pts, leftBall.slice(kSep));
      } else {
        raw = rightBall.concat(leftBall);
      }
    }
    offsetFootprint(raw, !noRot, out, M, zBase, edges);
  } else {
    offsetFootprint(wristFootprint(P, 'none'), !noRot, out, M, zBase, edges);
  }
}
