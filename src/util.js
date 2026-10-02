/* 零依赖工具函数。
   ⚠️ 本模块（以及 params / config / geometry / textureMath）**不得 import three**：
   它们要能在 node:test 里直接 import（见 test/unit/*.test.mjs），
   一旦引入 three 就只能靠浏览器 + CDN，反馈环会从毫秒级退化到分钟级。 */

// 二维归一化。任何需要单位向量的地方复用它，不要重复定义。
export const norm2 = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

// 数值夹取。本地实现而非 THREE.MathUtils.clamp：为了 params.js 保持零依赖
// （schema 校验是纯逻辑，不该为了一个 clamp 拖进整个 three）。
export const clampNum = (v, min, max) => (v < min ? min : v > max ? max : v);

// 宽松解析数字：null / '' / 非有限值一律返回 null，由调用方决定回退什么。
export function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// 点路径读写（'t1.s' → P.t1.s）。
// 贴图变换控件走路径而不是闭包捕获 P.t1 对象：导入配置会整体换掉这两个对象，
// 捕获旧引用会写进游离对象（拖动有反应、UI 读数也对，但画面永远不变且不报错）。
export function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}
export function setPath(obj, path, v) {
  const ks = path.split('.');
  let cur = obj;
  for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]];
  cur[ks[ks.length - 1]] = v;
}
