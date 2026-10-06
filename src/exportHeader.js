/* 导出图片顶部的署名条：软件名（两段配色，与页面 <h1> 同款）+ 当前页面二维码。

   这个模块只放**能在 node:test 里直接跑**的东西：版式计算、二维码内容、
   二维码库的按需加载。真正的绘制在 index.html —— 署名条是**真实 DOM**
   （`#exportHeader`，颜色字体全走 :root 的设计 token），由 `html-to-image`
   截成位图后贴到导出图顶部。这样做的理由见 Agents.md §4「导出图署名条」：
   canvas 画文字要么把配色抄第二份、要么算不准随导出倍率缩放的尺寸。

   设计约束：
   · 尺寸全部按**导出图宽度**折算，不按物理毫米 —— 画面里的垫子是相机投影，
     与毫米没有固定关系；按毫米定高会让署名条在默认视角下比画面主体还高。
   · 所有系数都在这一个文件里合并好。⚠️ 不要留"两个系数相加"给 CSS 去算：
     `calc(a * var(--x) + b * var(--x))` 里的字面项会被解析成无单位数字，式子作废。
   · 二维码库走 CDN 按需加载（与 three 同一条路径）。离线时静默缺省，
     只跳二维码、署名条照出，绝不因为拉不到库把整张导出搞失败。 */

const QR_MODULE = 'qrcode';
const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';

// 署名条的高度 ÷ 图宽。默认参数下实测值：
//   图宽 1440（2x 导出）→ 条高 137，画面主体（垫子）高约 570，两者比例稳定。
//
// ⚠️ 这条比例决定了"署名条里装得下多大的二维码"，已知边界：
//     1x 导出（图宽约 720）→ 条高约 69px → 29 模块的码每模块不到 1px。
//   二维码每个模块至少要 ~2px 才能被扫码器稳定采样，也就是说 **1x 导出图里的
//   二维码是读不出来的，2x / 3x 才读得出来**。这是"署名条按图宽定高"的必然结果，
//   不是 bug：要让 1x 也读得出，条高得翻一倍（0.19），署名条会占掉画面近两成高度，
//   为一张缩略图的二维码牺牲主体尺寸不划算。真要 1x 可扫，就走别的路子
//   （比如二维码单独给一张足够大的附加图），不要动这条比例。
export const HEADER_W_RATIO = 0.095;

/* 二维码内容：当前页面地址。纯数据函数，便于断言"锚点被丢掉、查询参数保留"。 */
export function qrURL(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    return u.toString();
  } catch { return String(href || ''); }
}

/* 二维码的静区（quiet zone），单位 = 模块数。ISO/IEC 18004 要求四周 ≥ 4。
   ⚠️ 这条不是"好看一点"，是**能不能扫出来**：二维码最外圈的黑模块若与深色背景直接
      相接，定位图案（三个角的回字形）找不出边界，整码作废。
   ⚠️ 而且它和 `margin` 必须**取同一个数**：版式按 QUIET_ZONE 留白、生成位图时按
      `margin: 0` 出图，中间那圈留白就成了假的 —— 白卡上看似留了边，实际全是白像素，
      扫不扫得出来全看运气。改一个必须改另一个。 */
export const QUIET_ZONE = 4;

/* 署名条版式。**所有量都是"图宽的百分比"**，index.html 把它们乘 1000 组成
   `calc(k * var(--hdr-w))`，故同一份系数在 1x / 2x / 3x 下给出的观感完全一致。

   ⚠️ 这里有一条"卡装不下"的硬约束：白底卡的高度 = 本体 + 两倍静区，而静区宽度
      反比于模块数 —— 21 模块（短地址）时卡占条高 0.86，57 模块时就只剩 0.70。
      故卡**绝不能"定高"**：定高的话短地址下卡会顶穿条底，正好坐在那条品牌色分隔线上，
      观感就是"画面被标题压住、贴得太紧"。这里的做法是：先由 INSET 与 gap 算出卡的
      **高度上限**，再取"按比例想要的尺寸"与它的小值作为卡边长，最后按边长反算模块边长。
      方块属性不丢，且任何模块数下卡都在条内、上下都有留白。

   返回 { H, gap, fs, xs, qs, qx, qy, card, mod, rule }：
     H    条高
     gap  条底与画面之间的留白带（与底色同色，视觉上就是"标题离画面远一点"）
     fs   软件名字号
     xs   软件名左内边距
     mod  有二维码时，单个模块的边长（二维码本体 = mod × 模块数，正方形）
     qs   二维码本体边长（含静区在内是 card × card）
     qx   二维码本体左边缘
     qy   二维码本体上边缘（卡片整体在 [0, H-gap] 这段里竖直居中）
     card 白底卡的边长 = qs + 2 倍静区
     rule 底部那条品牌色分隔线的高度 */
export function headerLayout(qrModules) {
  const H = HEADER_W_RATIO;          // 条高
  const gap = 0.25 * H;              // 条底留白：署名条与画面之间的呼吸
  const rule = 0.015 * H;            // 底部品牌色分隔线
  // 卡片可用高度：条高扣掉下方留白与分隔线，再上下各留 INSET 一圈。
  const box = H - gap - rule;
  const inset = 0.11 * H;
  const cardMax = Math.max(0.1 * H, box - 2 * inset);
  // 二维码**本体**在条高里占的比例。模块边长由它除以模块数得到，
  // 这样不论二维码是 21 模块（短地址）还是 77 模块（长地址），本体的观感大小都稳定，
  // 只是密度不同。若反过来固定"单个模块的物理尺寸"，长地址的二维码会撑破署名条。
  // ⚠️ 别改成固定模块边长：模块数随 URL 长度浮动（v3=29 → v10=57），
  //    固定模块边长时二维码本体的尺寸会跟着地址一起漂。
  const qrRatio = 0.62;
  const modWant = qrModules > 0 ? qrRatio * H / qrModules : 0.62 * H / 29;
  // 卡的边长同时受两头上限：纵向（cardMax）与横向（右侧留白 qx 之外的可用宽度）。
  // ⚠️ 卡必须是方块，故取两者的小值，再按它反算模块边长 —— 绝不能只压纵向，
  //    那只把卡压扁成矩形，"白条"那个老毛病就回来了。
  const cardWant = qrRatio * H + 2 * QUIET_ZONE * modWant;
  const card = Math.min(cardWant, cardMax, 0.62 * H);
  const mod = card / (qrModules > 0 ? qrModules + 2 * QUIET_ZONE : 29 + 2 * QUIET_ZONE);
  const qs = mod * (qrModules > 0 ? qrModules : 29);
  // 卡片整体在 [0, H-gap] 这段里竖直居中 → 上下留白各 (box-card)/2，与模块数无关
  const cardTop = (box - card) / 2;
  const right = 0.24 * H;            // 卡片右侧内边距
  return {
    H, gap, rule, card, mod, qs,
    qx: 1 - right - qs,
    qy: cardTop + QUIET_ZONE * mod,
    fs: 0.47 * H,                    // 软件名字号
    xs: 0.30 * H,                    // 左内边距（约 3% 图宽，窄图也不挤）
  };
}

/* 二维码模块只加载一次。
   ⚠️ 失败不重试：离线时每次导出都重试只是白等一次超时。
   库按需加载 —— 只有真正导出带署名条的图时才会去拉这 ~10KB。 */
let qrLoading = null, qrMod = null;
export function loadQr() {
  if (!qrLoading) {
    qrLoading = import(/* @vite-ignore */ QR_MODULE)
      .catch(() => import(/* @vite-ignore */ QR_CDN))
      .then(m => { qrMod = (m.default && m.default.toCanvas) ? m.default : m; return qrMod; })
      .catch(e => { console.warn('[署名条] 二维码模块不可用，导出只保留软件名', e); return null; });
  }
  return qrLoading;
}
export function __setQrModule(m) { qrMod = m; qrLoading = m ? Promise.resolve(m) : null; }
