/* 参数定义 + 配置（反）序列化 + 白名单校验。纯逻辑，不 import three。
   拆出来的直接收益：sanitizeParams / CONFIG 迁移 / 参数元数据都能在 node:test 里直接断言，
   不必开浏览器 + 等 3.5s CDN。 */

import { clampNum, numOrNull } from './util.js';

// 默认经典轮廓锚点（按 3d MousePad Template），用于首次加载与“重置锚点”。
// 运行时坐标采用顶层 {x,y,h1,h2}（与 bakeClassicCtrl / makeClassicShape 约定一致）。
// 共 7 个锚点：首尾为 pin（接缝，手柄由 ensureClassicCtrl 重算），中间 5 个可拖拽。
export const DEFAULT_CLASSIC_CTRL = [
  { x: -77.87016515677138, y: -116.87196203842663, h1: { x: -77.87016515677138, y: -116.87196203842663 }, h2: { x: -81.75976991430169, y: -101.1194309458591 } },
  { x: -72.39671119796571, y: -66.03870827899848, h1: { x: -73.41438595928038, y: -78.25380858100641 }, h2: { x: -70.87398786041214, y: -47.76153465979944 } },
  { x: -103.02017794430475, y: -3.591958181479075, h1: { x: -91.22373904493193, y: -27.961251618686443 }, h2: { x: -112.8317730574489, y: 16.67700963490084 } },
  { x: -93.14914645679774, y: 50.287355985997074, h1: { x: -98.81515685043313, y: 43.43436161334235 }, h2: { x: -63.7719811054472, y: 85.8188031332696 } },
  { x: 0.5478745968429263, y: 96.93694595772325, h1: { x: -34.775768031004915, y: 96.15593587902342 }, h2: { x: 29.71789177917693, y: 97.58189862172993 } },
  { x: 91.81815115714443, y: 46.6804878923647, h1: { x: 70.12431390266855, y: 79.49146313593883 }, h2: { x: 110.86396431535806, y: 17.874532694237914 } },
  { x: 99.68920152549207, y: -32.5305450234862, h1: { x: 99.68920152549207, y: -32.5305450234862 }, h2: { x: 93.8222688203322, y: -56.27944749493295 } },
  { x: 82.84846493178915, y: -85.45820524939745, h1: { x: 87.09875240404779, y: -61.367411896576435 }, h2: { x: 81.13539464219684, y: -95.16795373459694 } },
  { x: 77.87016515677138, y: -116.87196203842663, h1: { x: 81.1672277264742, y: -105.1974693635984 }, h2: { x: 77.87016515677138, y: -116.87196203842663 } },
];
/* ================= 单位约定 =================
   所有长度类参数一律为**毫米**，且 1 个世界单位 = 1mm（不引入任何全局缩放）。
   这条约定是 3D 导出、SVG/印刷落地的前提：STL/OBJ 直接按 mm 写出，
   GLB 按 glTF 米制规范在根节点套 0.001。
   ⚠️ 凡是新增长度参数，一律以 mm 为单位，不要引入 cm/m 或归一化比例。
   ⚠️ 已知两处"参数值 ≠ 成品尺寸"，见 Agents.md「单位约定」一节：
      · 倒角外扩：外廓 = 参数 + 1.8 × bevel（bevelSize = bevel × 0.9 向四周外扩）
      · 总厚度：成品总厚 = thick + 2 × bevel（倒角在上下两侧各加一层）       */
export const MM_PER_UNIT = 1;   // 世界单位 → 毫米；保持 1 即"世界单位 = mm"
export const P = {
  // 外形
  shape: 'classic',   // rect | ellipse | stadium | classic
  cfgName: '',        // 配置名称，用于导出文件名（留空则用默认名）
  // padW/padH 为**轮廓**尺寸（mm）；注意倒角还会让成品外廓再大 1.8×bevel
  padW: 230, padH: 265, corner: 48, thick: 1, bevel: 3,
  edgeColor: '#f4f1ec',
  edgeSame: true,   // true=边缘与上表面作为整体着色（共享本色+贴图）
  // 腕托（以下长度量均为 mm）
  wristStyle: 'balls', // none | full | balls
  wH: 27,             // 隆起高度
  wW: 150,            // 宽度（整体式）
  wD: 89,             // 前后长度
  wPos: 20,           // 距底边距离
  wGap: 71,           // 双球间距
  wBW: 82,            // 单球宽度
  wMorph: 0.55,       // 整体腕托: 0=椭球 1=肾型
  wMorphRot: 0,       // 整体腕托旋转角度（度），肾型形状不变，仅绕竖直轴旋转
  wRot: 10,           // 双球旋转角（两球反向，度）
  wEgg: 0.1,          // 双球鹅蛋度 -0.45..0.45
  wJoin: 16,          // 双球过渡弧宽度（0=保留原始相交尖角）
  wMargin: 2,         // 经典款：外形超出腕托的距离（overhang）
  wristTopGap: 215,   // 经典款：腕托顶 → 轮廓顶的距离（决定垫身总长）
  // 经典款上半轮廓：一串三次贝塞尔锚点（含切线手柄），由腕托足迹自动烘焙后可手动拖拽。
  // null 表示尚未烘焙，首次生成时按 wristTopGap 自动生成。
  // 结构：[{ x, y, h1:{x,y}, h2:{x,y}, pin?:true }]，pin 点为足迹接缝，位置由腕托决定
  classicCtrl: structuredClone(DEFAULT_CLASSIC_CTRL),
  // 材质
  rough: 0.55,
  matColor: '#b6e3a8',   // 材质底色（贴图叠加在其上方）
  matOpacity: 1,         // 本色不透明度（整体）
  texOpacity: 1,         // 贴图不透明度（仅影响贴图叠加强度）
  // 贴图变换
  t1: { s: 1, ox: 0, oy: 0, r: 0, wrap: 'cutout', asp: 1 },
  t2: { s: 1, ox: 0, oy: 0, r: 0, wrap: 'cutout', asp: 1 },
  // 光照
  hemi: 0.55, key: 1.8, az: 35, el: 55, lightColor: '#ffffff', env: 0.6,
  shadow: false,
  // 背景/导出
  bg: '#e9e7ec', transparent: false, exportTransparent: false, exportScale: 2,
};

/* ================= 配置导入校验（缺陷 6） =================
   原实现是 `Object.assign(P, cfg.params)`：既会把任意未知键写进 P（可注入状态），
   也会让 NaN / Infinity / 越界值直接进入几何，而这类错误不会抛异常，只会画出畸形模型
   或直接让 ExtrudeGeometry 崩掉。故改为白名单 + 类型/范围校验：
     · 白名单外的键 —— 丢弃（并记录 warning）
     · 类型不符 / 越界 —— 回退该字段的默认值（并记录 warning）
     · classicCtrl —— 单独做结构校验，不合法则整体回退 DEFAULT_CLASSIC_CTRL
   ⚠️ 新增参数必须同时登记到 PARAM_SCHEMA，否则导入时会被静默丢弃（下方有 dev 自检）。   */
export const P_DEFAULTS = structuredClone(P);
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const TEX2D_SCHEMA = {
  s:    { t: 'num', min: 0.05, max: 20 },
  ox:   { t: 'num', min: -1, max: 1 },
  oy:   { t: 'num', min: -1, max: 1 },
  r:    { t: 'num', min: -360, max: 360 },
  wrap: { t: 'enum', vals: ['clamp', 'cutout', 'repeat', 'mirror'] },
  asp:  { t: 'num', min: 0.1, max: 10 },
};
/* onChange —— 参数变更后的**处理意图**。

   此前每个控件回调都是手写 `P.x = v; rebuild()` 或 `refreshTextures()`：
   哪里 replay（重建几何）、哪里只刷材质、哪里要 `markRenderDirty()` 全靠开发者记得，
   Agents.md 里反复强调"漏掉 = 画面不更新"，正说明这一层脆。
   现在把意图写进 schema，新增参数时 `onChange` 是**必填项**，漏掉会在启动自检里报警。

   取值（按代价从大到小，别跳级）：
     'rebuild'  几何变了：跑 rebuild()（最贵：ExtrudeGeometry + 腕托球体 + 阴影深度图）
     'material' 只改材质：updateMatBase / updateMatRough / updateEdgeColor / updateCutout
     'render'   只改画面：updateLights / updateBackground / refreshTextures
     'none'     只存值，当下不需要任何刷新（导出倍率、配置名）
   ⚠️ 'rebuild' 与 'material' 不能互换：反过来写会让每次拖滑条都白跑一次全量几何重建
      （实测拖「表面粗糙」10 次 = 11 次 rebuild，与真正需要重建的「基础厚度」次数相同）。 */
export const CHANGE_KINDS = ['rebuild', 'material', 'render', 'none'];

// 数值范围比滑条区间略宽：滑条限制的是"合理设计空间"，这里只需挡住会让几何崩坏的值，
// 以免旧配置或手改配置被无谓地截断。
export const PARAM_SCHEMA = {
  shape:       { t: 'enum', vals: ['classic', 'rect', 'ellipse', 'stadium'] , onChange: 'rebuild' },
  cfgName:     { t: 'str', max: 120 , onChange: 'none' },
  padW:        { t: 'num', min: 80, max: 600 , onChange: 'rebuild' },
  padH:        { t: 'num', min: 80, max: 600 , onChange: 'rebuild' },
  corner:      { t: 'num', min: 0, max: 150 , onChange: 'rebuild' },
  thick:       { t: 'num', min: 0, max: 30 , onChange: 'rebuild' },
  bevel:       { t: 'num', min: 0, max: 20 , onChange: 'rebuild' },
  edgeColor:   { t: 'color' , onChange: 'material' },
  edgeSame:    { t: 'bool' , onChange: 'rebuild' },
  wristStyle:  { t: 'enum', vals: ['none', 'full', 'balls'] , onChange: 'rebuild' },
  wH:          { t: 'num', min: 0, max: 120 , onChange: 'rebuild' },
  wW:          { t: 'num', min: 10, max: 500 , onChange: 'rebuild' },
  wD:          { t: 'num', min: 5, max: 400 , onChange: 'rebuild' },
  wPos:        { t: 'num', min: 0, max: 300 , onChange: 'rebuild' },
  wGap:        { t: 'num', min: 0, max: 400 , onChange: 'rebuild' },
  wBW:         { t: 'num', min: 10, max: 300 , onChange: 'rebuild' },
  wMorph:      { t: 'num', min: 0, max: 3 , onChange: 'rebuild' },
  wMorphRot:   { t: 'num', min: -360, max: 360 , onChange: 'rebuild' },
  wRot:        { t: 'num', min: -90, max: 90 , onChange: 'rebuild' },
  wEgg:        { t: 'num', min: -1, max: 1 , onChange: 'rebuild' },
  wJoin:       { t: 'num', min: 0, max: 100 , onChange: 'rebuild' },
  wMargin:     { t: 'num', min: 0, max: 40 , onChange: 'rebuild' },
  wristTopGap: { t: 'num', min: 20, max: 500 , onChange: 'rebuild' },
  rough:       { t: 'num', min: 0, max: 1 , onChange: 'material' },
  matColor:    { t: 'color' , onChange: 'material' },
  matOpacity:  { t: 'num', min: 0, max: 1 , onChange: 'material' },
  texOpacity:  { t: 'num', min: 0, max: 1 , onChange: 'material' },
  t1:          { t: 'tex2d' , onChange: 'render' },
  t2:          { t: 'tex2d' , onChange: 'render' },
  classicCtrl: { t: 'ctrl' , onChange: 'rebuild' },
  hemi:        { t: 'num', min: 0, max: 5 , onChange: 'render' },
  key:         { t: 'num', min: 0, max: 10 , onChange: 'render' },
  az:          { t: 'num', min: -360, max: 360 , onChange: 'render' },
  el:          { t: 'num', min: 0, max: 90 , onChange: 'render' },
  lightColor:  { t: 'color' , onChange: 'render' },
  env:         { t: 'num', min: 0, max: 5 , onChange: 'render' },
  shadow:      { t: 'bool' , onChange: 'render' },
  bg:          { t: 'color' , onChange: 'render' },
  transparent: { t: 'bool' , onChange: 'render' },
  exportTransparent: { t: 'bool' , onChange: 'none' },
  exportScale: { t: 'num', min: 1, max: 3, int: true , onChange: 'none' },
};
export function sanitizeNum(v, s) {
  const n = numOrNull(v);
  if (n === null) return undefined;
  return clampNum(s.int ? Math.round(n) : n, s.min, s.max);
}
export function sanitizeTex2d(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const [k, s] of Object.entries(TEX2D_SCHEMA)) {
    const d = P_DEFAULTS.t1[k];
    const v = (k in raw) ? sanitizeField(raw[k], s) : undefined;
    out[k] = v === undefined ? d : v;
  }
  return out;
}
// classicCtrl 单独校验：它决定上半轮廓，坏数据会直接让 makeClassicShape 崩掉。
// 返回 undefined = 非法（调用方回退默认）；返回 null = 合法且表示"尚未烘焙"。
export function sanitizeClassicCtrl(raw) {
  if (raw === null || raw === undefined) return null;   // 未烘焙：由 makeClassicShape 自动生成
  if (!Array.isArray(raw) || raw.length < 4) return undefined;   // 少于 4 点无法构成闭合轮廓
  const pts = [];
  for (const pt of raw) {
    if (!pt || typeof pt !== 'object') return undefined;
    // 兼容旧版 { p:{x,y}, h1, h2 } 嵌套结构（运行时约定为顶层 {x,y,h1,h2}）
    const x = numOrNull(pt.x !== undefined ? pt.x : (pt.p && pt.p.x));
    const y = numOrNull(pt.y !== undefined ? pt.y : (pt.p && pt.p.y));
    if (x === null || y === null) return undefined;
    // 坐标夹到 ±5000mm：越界值不会崩，但会让 fitEditOrtho 把视口拉到荒谬的尺度
    const cx = clampNum(x, -5000, 5000);
    const cy = clampNum(y, -5000, 5000);
    const hd = h => {
      const hx = numOrNull(h && h.x), hy = numOrNull(h && h.y);
      return (hx === null || hy === null) ? { x: cx, y: cy } : { x: hx, y: hy };
    };
    const o = { x: cx, y: cy, h1: hd(pt.h1), h2: hd(pt.h2) };
    if (pt.pin) o.pin = true;
    pts.push(o);
  }
  return pts;
}
export function sanitizeField(raw, s) {
  switch (s.t) {
    case 'num':   return sanitizeNum(raw, s);
    case 'enum':  return s.vals.includes(raw) ? raw : undefined;
    case 'bool':  return typeof raw === 'boolean' ? raw : undefined;
    case 'color': return (typeof raw === 'string' && COLOR_RE.test(raw)) ? raw : undefined;
    case 'str':   return typeof raw === 'string' ? raw.slice(0, s.max) : undefined;
    case 'tex2d': return sanitizeTex2d(raw);
    case 'ctrl':  return sanitizeClassicCtrl(raw);
    default:      return undefined;
  }
}
// 返回 { params, warnings }。params 只含白名单内的键，每个非法字段都以默认值顶替并记 warning。
// ⚠️ 语义是「配置 = 完整快照」而非「合并」：配置里没写的键会被重置为默认值，
// 与旧的 Object.assign 不同。本工具导出的配置含全部字段，故只影响手写 / 外部生成的配置。
export function sanitizeParams(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const params = {}, warnings = [];
  for (const [key, s] of Object.entries(PARAM_SCHEMA)) {
    const has = key in src && src[key] !== undefined;
    const v = has ? sanitizeField(src[key], s) : undefined;
    if (v === undefined) {
      if (has) warnings.push(key);
      params[key] = structuredClone(P_DEFAULTS[key]);
    } else {
      params[key] = v;
    }
  }
  const unknown = Object.keys(src).filter(k => !(k in PARAM_SCHEMA));
  // ⚠️ warnings / unknown 只给**键名**，不拼用户可见句子：文案属于 i18n 层，
  // 这里写死中文的话，切到英文界面后导入提示仍是中文。
  return { params, warnings, unknown };
}

/* dev 自检：新增参数忘记登记 schema 时，导入会把它静默丢弃 —— 启动时在控制台提醒。
   返回缺失的键名数组（空 = 全部登记），由调用方决定怎么提示。 */
export function missingSchemaKeys() {
  return Object.keys(P_DEFAULTS).filter(k => !(k in PARAM_SCHEMA));
}
/* 配置格式版本。导入时若版本不同会先走 migrateConfig() 升级，再交给白名单校验。 */
export const CONFIG_VERSION = 1;
