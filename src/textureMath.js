/* 贴图尺寸的纯计算：裁剪 → 压缩 → 软上限，以及「以垫面某点为锚点改缩放」的反解。
   全部不碰 DOM / three，故能在 node:test 里直接断言边界（滑条量程、只缩不放、锚点不动点）。 */

import { clampNum } from './util.js';

// 至少 1px：canvas 不接受 0。裁剪区最小 16px 是拖拽侧的保底，计算侧只挡 0。
export function tfCropSize(crop) {
  return { w: Math.max(1, Math.round(crop.w)), h: Math.max(1, Math.round(crop.h)) };
}

// 只朝一个方向走：把长边等比缩到 edge，已小于 edge 则原样返回。
// 单向是刻意的 —— 往回拉把图放大等于凭空插值；「不想要压缩」的出口是「1 : 1」按钮。
export function tfScale(s, edge) {
  const long = Math.max(s.w, s.h);
  if (!(edge < long)) return s;
  const k = edge / long;
  return { w: Math.max(1, Math.round(s.w * k)), h: Math.max(1, Math.round(s.h * k)) };
}

// 滑条刻度范围 `[1, 原图长边]`：
//   · 上界**必须**取长边 —— 拉到最右才是"不压缩"；取短边的话，"1:1"会变成一整块够不着的死区
//     （实测 3360×4800 的短边 3360 仍超上限，拉到最右也回不到原图）。
//   · 下界取 1，**不能**取 min(长边, 上限)：min 属性会被浏览器强制生效，
//     写 4096 的话拖到 1024 会被夹回 4096，滑条成摆设（实测）。
export function tfEdgeRange(imgW, imgH) {
  return { min: 1, max: Math.max(1, Math.round(Math.max(imgW, imgH))) };
}
// 0 = 未压缩（回显落到上界）；其余刻度用 clamp 而非 Math.max(1,·)：
// min 属性若不生效，拖到量程外的值会原样进 tfScale，那就不是"压到 1024"而是"压到 1"。
export function tfEdgeValue(imgW, imgH, edge) {
  const r = tfEdgeRange(imgW, imgH);
  return edge ? clampNum(edge, r.min, r.max) : r.max;
}

// 最终输出 = 裁剪尺寸按长边滑条等比压小，再被软上限兜底。
// 两段各调一次 tfScale 而不是先取 min：滑条是用户意图，软上限是合规底线，
// 分开写才能让读数分清「我压了」与「被自动压了」。
export function tfFinalSize(crop, imgW, imgH, edge, maxEdge) {
  const o = tfScale(tfCropSize(crop), tfEdgeValue(imgW, imgH, edge));
  return tfScale(o, Math.min(maxEdge, Math.max(o.w, o.h)));
}

// 把裁剪框限制在图片范围内并保底 16px。
// ⚠️ 锁比例时不能对 w / h 各自独立夹取 —— 一旦有一边先撞到图片边界，
//    两边就被夹成不同比例（实测 1:1 被夹成 0.84）。改为等比缩到装得下为止。
export function tfClampCrop(c, imgW, imgH, aspect) {
  const min = 16;
  if (aspect) {
    const k = Math.min(1, imgW / c.w, imgH / c.h);
    c.w *= k; c.h *= k;
    if (Math.max(c.w, c.h) < min) {   // 极端窄图：退回最小尺寸并保比
      c.w = aspect >= 1 ? min : min * aspect;
      c.h = c.w / aspect;
    }
  } else {
    c.w = Math.min(Math.max(min, c.w), imgW);
    c.h = Math.min(Math.max(min, c.h), imgH);
  }
  c.x = clampNum(c.x, 0, imgW - c.w);
  c.y = clampNum(c.y, 0, imgH - c.h);
  return c;
}

// 「全选」= 尽可能大。锁着比例时给的是**内接**矩形（3360×4800 锁 1:1 → 3360×3360），
// 否则点一下全选就跳出个不满足比例的大框，锁比例等于摆设。
export function tfFullCrop(imgW, imgH, aspect) {
  let w = imgW, h = imgH;
  if (aspect) {
    if (aspect >= 1) h = w / aspect; else w = h * aspect;
    if (w > imgW) { w = imgW; h = w / aspect; }
    if (h > imgH) { h = imgH; w = h * aspect; }
  }
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
}

// 锁比例时以**面积**而非宽为基准：换比例时画面上的框不会突然跳一大截。
export function tfApplyAspect(crop, imgW, imgH, aspect) {
  const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
  const area = crop.w * crop.h;
  const w = Math.sqrt(area * aspect), h = w / aspect;
  return tfClampCrop({ x: cx - w / 2, y: cy - h / 2, w, h }, imgW, imgH, aspect);
}

// 贴图 uv 变换的缩放系数：s（repeat）× 长宽比修正。
// a<1（竖图）时压 v、a>1（横图）时压 u，保证贴图不被拉伸。
// ⚠️ 与 applyTexParams 里的 fx/fy 必须逐字一致，两处算出不同的话锚点反解会整体错位。
export function texFactors(imgW, imgH, asp) {
  const a0 = imgH ? imgW / imgH : 1;
  const a = a0 * (asp || 1);
  return { fx: a >= 1 ? 1 / a : 1, fy: a >= 1 ? 1 : a };
}

/* 以垫面上某个 uv 点（m）为锚点改缩放：反解新的 ox/oy，使该点下的贴图像素不动。
   ⚠️ 滚轮与双指捏合必须共用本函数。两处都要「以输入位置为锚点」，
   若各写一份，改一处必然漏一处 —— 触屏捏合最初就是因为只写 `tp.s = ...` 没有反解偏移，
   表现为「放大后贴图整块从手指下溜走」。
   返回新的 { s, ox, oy }，不写回入参：调用方拿去赋值，纯函数更好测。 */
export function zoomTexAbout(tp, imgW, imgH, ns, m, clampOff = clampNum) {
  if (!m || !imgW || !imgH) return { s: ns, ox: tp.ox, oy: tp.oy };
  const { fx, fy } = texFactors(imgW, imgH, tp.asp);
  const rad = (tp.r || 0) * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  // 贴图坐标 = R·S·(uv-0.5) + 0.5 + offset（与 three.js uvTransform 一致）
  const texelAt = (sc, ox, oy) => {
    const rx = sc * fx, ry = sc * fy;
    const du = (m.u - 0.5) * rx, dv = (m.v - 0.5) * ry;
    return {
      u: c * du + s * dv + 0.5 + ox + (1 - rx) / 2,
      v: -s * du + c * dv + 0.5 + oy + (1 - ry) / 2,
    };
  };
  const p = texelAt(tp.s, tp.ox, tp.oy);   // 当前锚点处的贴图坐标
  const rx2 = ns * fx, ry2 = ns * fy;
  const du2 = (m.u - 0.5) * rx2, dv2 = (m.v - 0.5) * ry2;
  const offU = p.u - (c * du2 + s * dv2 + 0.5);
  const offV = p.v - (-s * du2 + c * dv2 + 0.5);
  return {
    s: ns,
    ox: clampOff(offU - (1 - rx2) / 2, -1, 1),
    oy: clampOff(offV - (1 - ry2) / 2, -1, 1),
  };
}
