/* 移动端 / 窄屏布局与触控冒烟：工具栏不再重叠、面板抽屉开合、画布尺寸跟随、
   触屏手势不被页面手势抢走。

   断言名一律自解释，**不要**用「P0-1」「缺陷 9」这类编号。

   为什么需要这组用例：本项目原本只按桌面固定布局做（330px 常驻侧栏 + 两端各一个
   绝对定位工具栏）。窄屏下侧栏把画布挤到只剩几十像素、两个工具栏直接叠在一起，
   而这两类问题都**不会抛异常**，只看桌面截图永远发现不了 —— 只能在具体视口下量。 */
import zlib from 'node:zlib';
import { serve, open, reporter, EXPECTED_LOG } from './_harness.mjs';

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

const server = await serve();
const { browser, page, errors } = await open(server, {
  viewport: PORTRAIT, hasTouch: true, isMobile: true,
});
const { ok, finish } = reporter('移动端布局与触控');

// 量一个元素的盒子（取整，避免浮点噪声让断言飘）
const boxOf = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
}, sel);
const metrics = () => page.evaluate(() => {
  const st = document.getElementById('stage');
  const cv = document.getElementById('view');
  const tb = document.getElementById('toolbar');
  return {
    stageW: st.clientWidth, stageH: st.clientHeight,
    canvasAttrW: cv.width, canvasAttrH: cv.height,
    canvasCssW: cv.clientWidth, canvasCssH: cv.clientHeight,
    dpr: devicePixelRatio,
    // 画布内部分辨率比必须等于它的 CSS 盒子的比，否则画面被拉伸
    ratioCanvas: +(cv.width / cv.height).toFixed(4),
    ratioCss: +(st.clientWidth / st.clientHeight).toFixed(4),
    // 横向溢出：内容比容器宽 = 有东西被挤出屏幕外
    overflowX: tb.scrollWidth - tb.clientWidth,
    panelOpen: document.body.classList.contains('panel-open'),
    toggleDisplay: getComputedStyle(document.getElementById('panelToggle')).display,
    handleDisplay: getComputedStyle(document.getElementById('panelHandle')).display,
  };
});

// 左红右蓝的定位图：交界竖直，便于逐像素量 u=0.5 落在屏幕哪一列。
const makeLR = (size = 256) => {
  const T = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const o = y * (size * 4 + 1); raw[o] = 0;
    for (let x = 0; x < size; x++) {
      const i = o + 1 + x * 4;
      const left = x < size / 2;
      raw[i] = left ? 230 : 20; raw[i + 1] = 20; raw[i + 2] = left ? 20 : 230; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
};

let crashed = null;
try {
  ok('页面加载无 pageerror / console.error', errors.length === 0, errors.slice(0, 5).join(' | '));

  /* ---------- 窄屏：面板是抽屉，画布占满 ---------- */
  let m = await metrics();
  ok('窄屏：侧栏不再常驻占用宽度（画布占满视口宽）',
    m.stageW === PORTRAIT.width, `stageW=${m.stageW}, 期望 ${PORTRAIT.width}`);
  ok('窄屏：面板开关按钮可见', m.toggleDisplay !== 'none', m.toggleDisplay);
  ok('窄屏：初始状态抽屉关闭且尚未收到面板上',
    !m.panelOpen, `panelOpen=${m.panelOpen}`);
  const panelClosed = await boxOf('#panel');
  ok('窄屏：抽屉关闭时面板整体移出左边界（不遮挡画布）',
    panelClosed.r <= 1, `panel right=${panelClosed.r}`);

  /* ---------- 画布尺寸跟随容器（backing store 不被拉伸） ---------- */
  ok('窄屏：画布内部分辨率比与 CSS 盒子一致（画面未拉伸）',
    Math.abs(m.ratioCanvas - m.ratioCss) < 0.01,
    `canvas=${m.ratioCanvas} css=${m.ratioCss}`);
  // backing store = CSS 尺寸 × dpr（dpr 上限 2，与 resize() 里一致）
  ok('窄屏：画布 backing store 按 dpr 正确换算',
    m.canvasAttrW === m.canvasCssW * Math.min(m.dpr, 2),
    `attr=${m.canvasAttrW} css=${m.canvasCssW} dpr=${m.dpr}`);

  /* ---------- 参数按钮在工具栏里，且排在「配置」左边 ---------- */
  const btnOrder = await page.evaluate(() => {
    const tb = document.querySelector('#toolbar .tb-left');
    const ids = [...tb.querySelectorAll('#panelToggle, #ddExportImg, #ddExportModel, #ddConfig')]
      .map(e => e.id);
    return ids;
  });
  ok('参数按钮：在工具栏左组内，且位于「配置」左边',
    btnOrder.indexOf('panelToggle') > -1 && btnOrder.indexOf('panelToggle') < btnOrder.indexOf('ddConfig'),
    btnOrder.join(' -> '));
  // 旧实现是 fixed 浮层，会盖在面板内容/画布上；并入工具栏后不应再脱离文档流
  const togglePos = await page.evaluate(() =>
    getComputedStyle(document.getElementById('panelToggle')).position);
  ok('参数按钮：不再脱离文档流（不是 fixed 浮层）', togglePos === 'static',
    `position=${togglePos}`);

  /* ---------- 折叠把手：收起时贴在屏幕左缘 ---------- */
  let handle = await boxOf('#panelHandle');
  ok('折叠把手：窄屏可见', m.handleDisplay !== 'none', m.handleDisplay);
  ok('折叠把手：抽屉收起时整只手留在视口内（可点到）',
    handle.l >= 0 && handle.r <= PORTRAIT.width,
    `handle=[${handle.l}, ${handle.r}]`);
  ok('折叠把手：抽屉收起时贴在屏幕左缘（不外溢、也不被裁掉）',
    handle.l <= 2 && handle.r > 0, JSON.stringify(handle));

  /* ---------- 抽屉开合 ---------- */
  await page.click('#panelToggle');
  await page.waitForTimeout(400);   // 等 CSS transition（220ms）结束
  m = await metrics();
  const panelOpen = await boxOf('#panel');
  ok('抽屉：点按钮后面板滑入视口内', m.panelOpen && panelOpen.l >= -1,
    `panelOpen=${m.panelOpen}, panel left=${panelOpen.l}`);
  /* ---------- 层级：抽屉必须盖住工具栏 ---------- */
  // 旧实现把工具栏 z-index 设成 11「高于抽屉 9」，但两者属于不同的层叠上下文
  // （抽屉是 #app 的子元素，工具栏是 #stage 的后代），11 压不住 9：抽屉一打开，
  // 面板里的 <h1> 标题就整片盖在工具栏按钮上。用「区域内最顶上是谁」来量，
  // 比读 z-index 数字更接近用户真正看到的东西。
  // 判据用「最顶上那个元素是否位于 #panel 子树内」：抽屉里还有 details/summary 等
  // 子元素，断言「最顶上必须正好是 #panel」会把正常情况也判失败。
  const inPanel = `el => el && document.getElementById('panel').contains(el)`;
  const topAt = await page.evaluate(`(() => {
    const tb = document.getElementById('toolbar').getBoundingClientRect();
    const x = Math.round(tb.left + tb.width / 2);
    const y = Math.round(tb.top + tb.height / 2);
    const els = document.elementsFromPoint(x, y);
    return { inside: els.some(${inPanel}), top: els.slice(0,3).map(e => e.id || e.tagName) };
  })()`);
  ok('层级：抽屉打开时工具栏被盖住（该处最顶上的元素属于抽屉）',
    topAt.inside, `elementFromPoint=[${topAt.top.join(', ')}]`);
  const btnHit = await page.evaluate(`(() => {
    const b = document.querySelector('#toolbar .tb-left .dd-btn').getBoundingClientRect();
    const el = document.elementFromPoint(Math.round(b.left + b.width/2), Math.round(b.top + b.height/2));
    return { inside: (${inPanel})(el), name: el ? (el.id || el.tagName) : null };
  })()`);
  ok('层级：抽屉打开时工具栏按钮点不到（不会误触发导出/配置）',
    btnHit.inside, `hit=${btnHit.name}`);

  /* ---------- 折叠把手：展开时走到抽屉右缘 ---------- */
  handle = await boxOf('#panelHandle');
  ok('折叠把手：抽屉展开时贴在抽屉右缘',
    Math.abs(handle.l - panelOpen.r) <= 2,
    `handle.left=${handle.l}, panel.right=${panelOpen.r}`);
  ok('折叠把手：抽屉展开时整只手仍在视口内（可点到）',
    handle.r <= PORTRAIT.width, `handle.right=${handle.r}`);
  ok('抽屉：抽屉打开后画布比并未被拉坏（backing store 仍与盒子一致）',
    Math.abs(m.ratioCanvas - m.ratioCss) < 0.01,
    `canvas=${m.ratioCanvas} css=${m.ratioCss}`);
  const scrimVisible = await page.evaluate(() =>
    getComputedStyle(document.getElementById('panelScrim')).display !== 'none');
  ok('抽屉：遮罩随抽屉出现', scrimVisible);

  // 抽屉打开时点遮罩（画布区）应收起
  await page.evaluate(() => document.getElementById('panelScrim').click());
  await page.waitForTimeout(400);
  m = await metrics();
  ok('抽屉：点遮罩可收起', !m.panelOpen, `panelOpen=${m.panelOpen}`);

  // 真实触摸点面板开关（验证触摸链路，不只是鼠标 click）
  await page.tap('#panelToggle');
  await page.waitForTimeout(400);
  m = await metrics();
  ok('抽屉：触摸事件也能打开抽屉', m.panelOpen, `panelOpen=${m.panelOpen}`);
  // 折叠把手收抽屉（用户提的第二条：抽屉右缘那个小按钮）
  await page.tap('#panelHandle');
  await page.waitForTimeout(400);
  m = await metrics();
  ok('抽屉：触摸折叠把手可收起抽屉', !m.panelOpen, `panelOpen=${m.panelOpen}`);
  // 再从收起态用把手拉出来
  await page.tap('#panelHandle');
  await page.waitForTimeout(400);
  m = await metrics();
  ok('抽屉：收起态点折叠把手可拉开抽屉', m.panelOpen, `panelOpen=${m.panelOpen}`);
  // ⚠️ 抽屉展开时参数按钮已被抽屉盖住（这正是本次要的层级效果），故收抽屉只能靠把手；
  //    「参数按钮也能收起」这条语义在收起态无法验证，改由下一次展开时观察 aria 属性。
  await page.tap('#panelHandle');
  await page.waitForTimeout(400);
  m = await metrics();
  ok('抽屉：展开态只能用把手/遮罩收起（参数按钮已被抽屉盖住）',
    !m.panelOpen, `panelOpen=${m.panelOpen}`);
  // 收起态下参数按钮可点：展开抽屉，并确认它的无障碍语义已切到「收起」
  await page.tap('#panelToggle');
  await page.waitForTimeout(400);
  const aria = await page.evaluate(() => {
    const t = document.getElementById('panelToggle'), h = document.getElementById('panelHandle');
    return { tLabel: t.getAttribute('aria-label'), tExpanded: t.getAttribute('aria-expanded'),
             hLabel: h.getAttribute('aria-label'), hExpanded: h.getAttribute('aria-expanded') };
  });
  ok('抽屉：展开后参数按钮/把手的无障碍语义切到「收起」',
    aria.tLabel === '收起参数面板' && aria.tExpanded === 'true'
    && aria.hLabel === '收起参数面板' && aria.hExpanded === 'true', JSON.stringify(aria));
  await page.tap('#panelHandle');
  await page.waitForTimeout(400);

  /* ---------- 触控尺寸：滑条命中区域必须够大（手指点得中） ---------- */
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  await page.click('#panelToggle');
  await page.waitForTimeout(400);
  const sliderH = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#tex1Ctrls .row')].find(r => r.textContent.includes('缩放'));
    return row ? Math.round(row.querySelector('input[type=range]').getBoundingClientRect().height) : 0;
  });
  ok('触控：滑条命中高度 ≥ 28px（手指可点中）', sliderH >= 28, `height=${sliderH}px`);
  // 触摸点滑条末端，值应改变
  const valBefore = await page.evaluate(() =>
    document.querySelector('#tex1Ctrls input[type=range]').value);
  const sb = await boxOf('#tex1Ctrls input[type=range]');
  await page.touchscreen.tap(sb.l + sb.w * 0.8, sb.t + sb.h / 2);
  await page.waitForTimeout(300);
  const valAfter = await page.evaluate(() =>
    document.querySelector('#tex1Ctrls input[type=range]').value);
  ok('触控：触摸滑条可改变数值', Number(valAfter) > Number(valBefore),
    `${valBefore} -> ${valAfter}`);
  await page.evaluate(() => document.getElementById('panelScrim').click());
  await page.waitForTimeout(400);

  /* ---------- 横屏：整页不横向溢出 ---------- */
  await page.setViewportSize(LANDSCAPE);
  await page.waitForTimeout(500);
  m = await metrics();
  ok('横屏：工具栏不横向溢出（两组按钮不重叠）', m.overflowX <= 0, `overflowX=${m.overflowX}`);
  ok('横屏：画布比仍然正确（旋转后未拉伸）',
    Math.abs(m.ratioCanvas - m.ratioCss) < 0.01, `canvas=${m.ratioCanvas} css=${m.ratioCss}`);
  ok('横屏：画布仍占满视口宽', m.stageW === LANDSCAPE.width, `stageW=${m.stageW}`);

  /* ---------- 平板 ---------- */
  await page.setViewportSize(TABLET);
  await page.waitForTimeout(500);
  m = await metrics();
  ok('平板：工具栏不横向溢出', m.overflowX <= 0, `overflowX=${m.overflowX}`);
  ok('平板：画布占满视口宽', m.stageW === TABLET.width, `stageW=${m.stageW}`);

  /* ---------- 桌面：侧栏恢复常驻、开关按钮隐藏 ---------- */
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(500);
  m = await metrics();
  const desktopPanel = await boxOf('#panel');
  ok('桌面：侧栏恢复常驻在左侧（不再移出屏幕）',
    desktopPanel.l === 0 && desktopPanel.r > 300, JSON.stringify(desktopPanel));
  ok('桌面：面板开关按钮隐藏（避免与常驻侧栏重复）',
    m.toggleDisplay === 'none', m.toggleDisplay);
  ok('桌面：折叠把手隐藏（宽屏由常驻侧栏承担）',
    m.handleDisplay === 'none', m.handleDisplay);
  ok('桌面：画布宽度 = 视口 - 侧栏', m.stageW === DESKTOP.width - desktopPanel.w,
    `stageW=${m.stageW}, panelW=${desktopPanel.w}`);

  /* ---------- 工具栏永不重叠（跨多个宽度） ---------- */
  // 旧实现是 #topbar(left) 与 #toolbar(right) 两个绝对定位兄弟节点，
  // 视口窄于两者之和时直接叠在一起（实测 900px 就开始重合 80px）。
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(400);
  const overlap = await page.evaluate(() => {
    const left = document.querySelector('#toolbar .tb-left').getBoundingClientRect();
    const right = document.querySelector('#toolbar .tb-right').getBoundingClientRect();
    // 同一容器内 flex 排列，两者的水平重叠量必然为 0（换行时纵向错开）
    return {
      sameRow: Math.abs(left.top - right.top) < 2,
      overlapX: Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)),
    };
  });
  ok('900px：左组与右组不重叠（横向重叠为 0）', overlap.overlapX === 0,
    JSON.stringify(overlap));

  /* ---------- 层级：抽屉打开时工具栏不会"透出"成鬼影 ---------- */
  // 光比 z-index 数字是不够的：抽屉是 #app 的直接子元素、工具栏是 #stage 的后代，
  // 两者属于**不同的层叠上下文**，数字大小根本不可比。所以这里量两件事：
  //   ① 屏幕上该点的最顶层元素是谁（elementFromPoint）；② 工具栏是否已隐藏。
  await page.setViewportSize(PORTRAIT);
  await page.waitForTimeout(400);
  await page.click('#panelToggle');
  await page.waitForTimeout(400);
  const layer = await page.evaluate(() => {
    const z = el => Number(getComputedStyle(document.querySelector(el)).zIndex) || 0;
    const tb = document.getElementById('toolbar');
    const panel = document.getElementById('panel');
    const r = tb.getBoundingClientRect();
    const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return {
      toolbar: z('#toolbar'), scrim: z('#panelScrim'), panel: z('#panel'), toggle: z('#panelToggle'),
      toolbarOpacity: getComputedStyle(tb).opacity,
      toolbarPE: getComputedStyle(tb).pointerEvents,
      // 抽屉子树里有 details/summary 等子元素，判「最顶上是谁」时不能要求正好是 #panel
      topInsidePanel: !!top && panel.contains(top),
      topAtToolbar: top ? (top.id || top.tagName) : null,
    };
  });
  ok('层级：抽屉打开时工具栏被盖住（该处最顶上的元素属于抽屉）',
    layer.topInsidePanel, JSON.stringify(layer));
  ok('层级：抽屉打开时工具栏已淡出且不接收指针',
    Number(layer.toolbarOpacity) === 0 && layer.toolbarPE === 'none', JSON.stringify(layer));
  ok('层级：遮罩低于抽屉（抽屉内容不被遮罩压暗）',
    layer.scrim < layer.panel, JSON.stringify(layer));
  ok('层级：参数按钮已在工具栏内（不是独立 z-index 浮层）',
    layer.toggle === 0 || layer.toggle === layer.toolbar, JSON.stringify(layer));
  await page.evaluate(() => document.getElementById('panelScrim').click());
  await page.waitForTimeout(400);

  /* ---------- 双指旋转：手指转哪边，贴图就转哪边 ---------- */
  // 手势方向必须与贴图旋转方向一致，否则"调整贴图时越调越别扭"。
  // 这里不比对像素（贴图分割易受材质亮度影响），而是走 CDP 真实多指触摸，
  // 断言 r 的增量符号：手指视觉顺时针时 r 必须减小。
  //
  // 判据的由来：r>0 在画面上是**逆时针**（uv 的 v 轴向上，叠加 uvAtPoint 的
  // v = 0.5 - z/S 之后，符号与直觉相反；由红色半边重心随 r 的位移实测确认）。
  // 屏幕坐标 y 向下，atan2 角度增大 = 视觉顺时针，故顺时针时 Δa>0，
  // 要让它对应 r 减小，公式必须是 `r -= Δa`。
  await page.setViewportSize(PORTRAIT);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach(d => { d.open = true; });
    [...document.querySelectorAll('#modeSeg button')].find(b => b.dataset.mode === 't1').click();
    [...document.querySelectorAll('#viewSeg button')].find(b => b.dataset.view === 'top').click();
  });
  await page.waitForTimeout(600);

  const texRot = {
    read: () => page.evaluate(() => {
      const row = [...document.querySelectorAll('#tex1Ctrls .row')]
        .find(r => r.textContent.includes('旋转'));
      return Number(row.querySelector('input[type=range]').value);
    }),
    set: v => page.evaluate(v => {
      const row = [...document.querySelectorAll('#tex1Ctrls .row')]
        .find(r => r.textContent.includes('旋转'));
      const el = row.querySelector('input[type=range]');
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v),
  };
  // 真实多指：一根当枢轴（留在 180°），另一根绕它转。
  // 两指若关于中心对称，A→B 向量方向与手指转动方向差 180°，Δa 会绕圈，故必须不对称。
  const cdp = await page.context().newCDPSession(page);
  const CX = Math.round(PORTRAIT.width / 2), CY = 400, RAD = 70;
  const at = deg => [CX + RAD * Math.cos(deg * Math.PI / 180), CY + RAD * Math.sin(deg * Math.PI / 180)];
  const swipe = async (fromDeg, toDeg) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: at(180)[0], y: at(180)[1], id: 0 }, { x: at(fromDeg)[0], y: at(fromDeg)[1], id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: at(180)[0], y: at(180)[1], id: 0 }, { x: at(toDeg)[0], y: at(toDeg)[1], id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };

  await texRot.set(0);
  // 手指从 -90°（正上）转到 -45°（右上）：屏幕坐标里角度增大 = 视觉顺时针
  await swipe(-90, -45);
  const rCw = await texRot.read();
  ok('双指旋转：手指顺时针转，贴图顺时针转（r 减小）', rCw < -5,
    `r=${rCw}（期望 < 0，说明手指顺时针时贴图也顺时针）`);

  await texRot.set(0);
  // 反向：手指从 -45°（右上）转到 -90°（正上）= 视觉逆时针
  await swipe(-45, -90);
  const rCcw = await texRot.read();
  ok('双指旋转：手指逆时针转，贴图逆时针转（r 增大）', rCcw > 5,
    `r=${rCcw}（期望 > 0）`);

  // 只对符号不够：还要确认旋转量跟着手指走，而不是恒等若干度。
  // ⚠️ 期望值不是手势扫过的 45°，而是它的一半 —— 这里让动指绕**两指中点**以外
  // 的固定枢轴转，动指到枢轴的向量只转掉一半（几何上恒成立，见下）。
  // 用 30° / 60° 两档交叉验证比例，避免把「恰好 22.5」当成写死的常数。
  await texRot.set(0);
  await swipe(-90, -60);
  const r30 = await texRot.read();
  await texRot.set(0);
  await swipe(-90, -30);
  const r60 = await texRot.read();
  ok('双指旋转：旋转量随手势线性变化（30°/60° 手势给出成倍的旋转）',
    Math.abs(r30) > 10 && Math.abs(r60) > Math.abs(r30) * 1.8 && Math.abs(r60) < Math.abs(r30) * 2.2,
    `30° 档 r=${r30}，60° 档 r=${r60}（期望后者约为前者 2 倍）`);
  await texRot.set(0);

  /* ---------- 双指捏合：围绕两指中点缩放，而不是从手指底下溜走 ---------- */
  // 为什么单独量这件事：原来的实现只写 `tp.s = s0 * (d/d0)`，没有像滚轮那条路径那样
  // 反解 ox/oy。贴图会**整块从手指底下平移出去** —— 手感是「越缩越跑」，而不是原地放大。
  // 这类错误同样不抛异常、控制台干净，只能量像素。
  //
  // 判据选「红蓝交界线」：贴图的 u=0.5 恰好落在交界上，且交界是竖直的，
  // 与画布中线垂直，位移一像素都能读出来，不受材质亮度与贴图占比影响。
  const texS = {
    read: () => page.evaluate(() => {
      const row = [...document.querySelectorAll('#tex1Ctrls .row')]
        .find(r => r.textContent.includes('缩放'));
      return Number(row.querySelector('input[type=range]').value);
    }),
    set: v => page.evaluate(v => {
      const row = [...document.querySelectorAll('#tex1Ctrls .row')]
        .find(r => r.textContent.includes('缩放'));
      const el = row.querySelector('input[type=range]');
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v),
  };
  // 交界线的屏幕 x（CSS 像素）：逐行找「红像素的最右缘」，取中位数抗噪
  // ⚠️ 采样行不能写死：贴图放大后会缩小、上下也收缩，固定采样行可能整行落在贴图之外，
  // 那时读到的是 -1（无红像素），断言会以 "位移 0" 的形式**假通过**。
  // 故先扫全画布找出红像素所在的行区间，只在其中取中位数。
  const seamX = () => page.evaluate(() => {
    const cv = document.getElementById('view');
    const off = document.createElement('canvas');
    off.width = cv.width; off.height = cv.height;
    off.getContext('2d').drawImage(cv, 0, 0);
    const g = off.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    const img = g.getImageData(0, 0, cv.width, cv.height).data;
    const isRed = (x, y) => {
      const i = (y * cv.width + x) * 4;
      return img[i] > 120 && img[i + 1] < 90 && img[i + 2] < 90;
    };
    // 找出含红像素的行（工具栏在上方，红像素只会来自贴图）
    const rows = [];
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) if (isRed(x, y)) { rows.push(y); break; }
    }
    if (!rows.length) return -1;
    const xs = [];
    for (let k = 0; k < 20; k++) {
      const y = rows[Math.floor((rows.length - 1) * (k + 0.5) / 20)];
      let last = -1;
      for (let x = 0; x < cv.width; x++) if (isRed(x, y)) last = x;
      if (last >= 0) xs.push(last / dpr);
    }
    xs.sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : -1;
  });
  await page.setViewportSize(PORTRAIT);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('#modeSeg button')].find(b => b.dataset.mode === 't1').click();
    [...document.querySelectorAll('#viewSeg button')].find(b => b.dataset.view === 'top').click();
  });
  await page.waitForTimeout(600);
  // 换一张左红右蓝的定位图：交界线是竖直的，便于逐像素量
  await page.setInputFiles('#file1', { name: 'lr.png', mimeType: 'image/png', buffer: makeLR(256) });
  await page.waitForTimeout(1200);

  // 红带的屏幕宽度：贴图放得越大，红半边占的横向像素越多。
  // 光看 tp.s 的数值大小判不出「手感反没反」——必须量画面。
  const seamSpan = () => page.evaluate(() => {
    const cv = document.getElementById('view');
    const off = document.createElement('canvas');
    off.width = cv.width; off.height = cv.height;
    off.getContext('2d').drawImage(cv, 0, 0);
    const g = off.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    const img = g.getImageData(0, 0, cv.width, cv.height).data;
    const isRed = (x, y) => {
      const i = (y * cv.width + x) * 4;
      return img[i] > 120 && img[i + 1] < 90 && img[i + 2] < 90;
    };
    let min = Infinity, max = -1;
    // 取中间一段高度，避开工具栏与上下边缘
    for (let y = Math.floor(cv.height * 0.3); y < cv.height * 0.7; y += 3) {
      for (let x = 0; x < cv.width; x++) {
        if (isRed(x, y)) { if (x < min) min = x; if (x > max) max = x; }
      }
    }
    return max < 0 ? -1 : Math.round((max - min) / dpr);
  });

  // 两指中点 = 画布正中。
  // ⚠️ 基准 s 必须留出余量：s=1 时贴图恰好铺满画布，再放大红半边就被画布缘裁掉，
  // 量到的「红带宽度」卡在画布宽度上不动，断言会以「宽度没变」的形式失败 ——
  // 那是采样窗口饱和，不是方向的问题。基准取 s=1.5（贴图明显小于画布），
  // 两个方向都留在可测区间内。
  const PX2 = Math.round(PORTRAIT.width / 2), PY2 = Math.round(PORTRAIT.height / 2);
  const pinchPts = d => [{ x: PX2 - d / 2, y: PY2, id: 0 }, { x: PX2 + d / 2, y: PY2, id: 1 }];
  const resetTex = (sv = 1.5) => page.evaluate(sv => {
    const rows = [...document.querySelectorAll('#tex1Ctrls .row')];
    ['缩放', '偏移 X', '偏移 Y'].forEach(n => {
      const el = rows.find(r => r.textContent.includes(n)).querySelector('input[type=range]');
      el.value = n === '缩放' ? String(sv) : '0'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, sv);

  // 手指**张开**（100 → 135）应当把贴图**放大**。
  // 期望值是 tp.s **减小**（s 是 uv 的 repeat 系数，越大贴图越小，见 applyTexParams），
  // 且红带变宽。只用 s 的方向不够 —— s 与画面大小是反号，正是这个反号让上一版把
  // `d/d0` 写成了「看起来对、手感反」。所以两条一起断言。
  await resetTex();
  await page.waitForTimeout(300);
  const spanBefore = await seamSpan();
  // 前置：采样必须真的量到红半边。少了这条，`seamSpan` 万一读空（返回 -1），
  // 「变宽 / 变窄」两条都会拿 -1 比大小，得到一个恰好反向的假结论。
  ok('双指捏合方向的前置：贴图红半边可量且在画布内（不饱和）',
    spanBefore > 20 && spanBefore < PORTRAIT.width - 10, `红带 ${spanBefore}px`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinchPts(100) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinchPts(117) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinchPts(135) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const spanAfter = await seamSpan();
  const zoomed = await texS.read();
  ok('双指捏合：手指张开 = 放大贴图（tp.s 变小，贴图红半变宽）',
    zoomed < 1.4 && spanAfter > spanBefore + 10,
    `s 1.5 → ${zoomed}（期望变小），红带 ${spanBefore} → ${spanAfter}px（期望变宽）`);

  // 反方向：手指**收拢**（135 → 100）应当把贴图**缩小**。
  // 少了这条，只测「张开=放大」可能被某个恰好对称的实现蒙混过关。
  await resetTex();
  await page.waitForTimeout(300);
  const spanReset2 = await seamSpan();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinchPts(135) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinchPts(117) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinchPts(100) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const spanPinched = await seamSpan();
  const shrunk = await texS.read();
  ok('双指捏合：手指收拢 = 缩小贴图（tp.s 变大，贴图红半变窄）',
    shrunk > 1.6 && spanPinched < spanReset2 - 10,
    `s 1.5 → ${shrunk}（期望变大），红带 ${spanReset2} → ${spanPinched}px（期望变窄）`);

  // 围绕两指中点缩放：中点下的贴图边缘不动。
  // 和上面两条分开量：方向与锚点是两件事，混在一起失败时说不清是哪个坏了。
  // 基准取 s=1：此时红蓝交界正好落在画布中线 x≈195，与两指中点重合，
  // 断言才「量在锚点上」。用 s=1.5 的话交界在 x≈290，锚点 195 处没有可量的边缘，
  // 位移就只是「交界随缩放整体平移」的噪声，测不到锚点是否起作用。
  await resetTex(1);
  await page.waitForTimeout(300);
  const seamBefore = await seamX();
  ok('双指捏合锚点的前置：交界落在两指中点附近（否则量不到锚点）',
    Math.abs(seamBefore - PX2) <= 12, `交界 x=${seamBefore}，中点 ${PX2}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinchPts(100) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinchPts(135) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const seamAfter = await seamX();
  ok('双指捏合：围绕两指中点缩放（中点下的贴图边缘不动）',
    Math.abs(seamAfter - seamBefore) <= 4,
    `中点 x=${PX2}，交界 缩前 ${seamBefore} → 缩后 ${seamAfter}（位移 ${(seamAfter - seamBefore).toFixed(1)}px，期望 ≤4）`);
  // 负向对照：锚点必须真的起作用 —— 手指中点挪到画布左缘，交界应明显被推走。
  // 少了这条，"交界不动" 可能只是因为我们压根没改任何偏移。
  await texS.set(1);
  await page.evaluate(() => {
    const set = (n, v) => {
      const row = [...document.querySelectorAll('#tex1Ctrls .row')].find(r => r.textContent.includes(n));
      const el = row.querySelector('input[type=range]');
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('偏移 X', 0); set('偏移 Y', 0); set('旋转', 0);
  });
  await page.waitForTimeout(400);
  const seamReset = await seamX();
  ok('双指捏合负向对照的前置：交界可测（采样到红像素所在行）',
    seamReset >= 0, `交界 x=${seamReset}`);
  const PX3 = 60;
  const pinchAt = d => [{ x: PX3 - d / 2, y: PY2, id: 0 }, { x: PX3 + d / 2, y: PY2, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinchAt(60) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinchAt(120) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const seamShifted = await seamX();
  ok('双指捏合：锚点偏移时贴图跟着挪（证明锚点真的参与计算）',
    Math.abs(seamShifted - seamReset) > 10,
    `交界 基准 ${seamReset} → 偏锚点缩放后 ${seamShifted}（期望位移 >10px）`);
  await texS.set(1);
  await page.waitForTimeout(300);

  await page.evaluate(() => [...document.querySelectorAll('#modeSeg button')].find(b => b.dataset.mode === 'view').click());
  await page.waitForTimeout(300);

  /* ---------- 触控：画布禁止浏览器接管手势 ---------- */
  const touchAction = await page.evaluate(() =>
    getComputedStyle(document.getElementById('stage')).touchAction);
  ok('触控：画布区域 touch-action:none（不抢 OrbitControls 的手势）',
    touchAction === 'none', touchAction);
  const vpMeta = await page.evaluate(() =>
    document.querySelector('meta[name=viewport]').getAttribute('content'));
  ok('触控：viewport 禁用页面缩放（避免与应用手势打架）',
    /user-scalable=no/.test(vpMeta) && /maximum-scale=1/.test(vpMeta), vpMeta);

  ok('全流程无意外未捕获错误（pageerror 与非预期 console.error）',
    errors.filter(e => !EXPECTED_LOG.test(e)).length === 0,
    errors.filter(e => !EXPECTED_LOG.test(e)).slice(0, 5).join(' | '));
} catch (e) {
  crashed = e;
} finally {
  await browser.close();
  await server.stop();
}
process.exit(finish(crashed));
