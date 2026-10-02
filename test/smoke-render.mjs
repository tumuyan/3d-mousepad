/* 渲染与交互冒烟：渲染器启动、按需渲染、LOD、编辑态相机锁定、
   预览图导出后状态复原、配置导入校验（合法 / 越界 / 未知字段 / 坏文件）。

   断言名一律自解释，**不要**用「P0-1」「缺陷 9」这类编号：
   它们指向的是一份临时文档，删掉后编号就无处可查（历史来历请在注释里说明）。 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { serve, open, reporter, EXPECTED_LOG } from './_harness.mjs';

const server = await serve();
// 统计 WebGL 绘制调用与帧数（不改页面，纯外部插桩）
// 另计三类"看不见但很贵"的开销：离屏 FBO 绑定（阴影贴图重渲）、纹理上传（整图重传 GPU）、
// bufferData（新几何上传显存 —— rebuild 的必然结果，故用它判断"是否真的重建了几何"）
const { browser, page, errors } = await open(server, {
  initScript: () => {
    window.__draws = 0; window.__counts = []; window.__frames = 0;
    window.__fb = 0; window.__tex = 0; window.__buf = 0;
    const patch = p => {
      if (!p) return;
      for (const fn of ['drawElements', 'drawArrays']) {
        const orig = p[fn]; if (!orig) continue;
        p[fn] = function (...a) {
          window.__draws++;
          const n = fn === 'drawElements' ? a[1] : a[2];
          if (typeof n === 'number') window.__counts.push(n);
          return orig.apply(this, a);
        };
      }
      // 第二参传 null = 回到默认帧缓冲，不算；只有绑真实 FBO 才是离屏渲染（阴影 pass）
      const bf = p.bindFramebuffer;
      if (bf) p.bindFramebuffer = function (t, fb) { if (fb) window.__fb++; return bf.apply(this, arguments); };
      for (const fn of ['texImage2D', 'texSubImage2D']) {
        const orig = p[fn]; if (!orig) continue;
        p[fn] = function (...a) { window.__tex++; return orig.apply(this, a); };
      }
      for (const fn of ['bufferData', 'bufferSubData']) {
        const orig = p[fn]; if (!orig) continue;
        p[fn] = function (...a) { window.__buf++; return orig.apply(this, a); };
      }
    };
    patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    const tick = () => { window.__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  },
});
const { ok, finish } = reporter('渲染与交互');

let crashed = null;
try {
  ok('页面加载无 pageerror / console.error', errors.length === 0, errors.slice(0, 5).join(' | '));

  const boot = await page.evaluate(() => ({
    draws: window.__draws, frames: window.__frames,
    canvasW: document.querySelector('#view').width,
    hasPad: !!document.querySelector('#view'),
  }));
  ok('渲染器已启动（有绘制调用、有帧）', boot.draws > 0 && boot.frames > 0, JSON.stringify(boot));

  /* ---------- 按需渲染 ---------- */
  await page.evaluate(() => { window.__draws = 0; window.__frames = 0; });
  await page.waitForTimeout(2000);
  const idle = await page.evaluate(() => ({ d: window.__draws, f: window.__frames }));
  // 主循环带安全阀（连续 30 帧无渲染则无条件渲一次）→ 2 秒约 4 次；修复前是每帧都渲
  ok('按需渲染：空闲时渲染次数远低于帧数', idle.d < idle.f, `idle draws=${idle.d}, frames=${idle.f}`);

  /* ---------- LOD 预览 ---------- */
  // details 已由 harness 统一展开；这里再等一拍让布局稳定。
  // 挑滑条时必须选「当前可见」的：经典模式下 基础宽度/基础长度/圆角 被隐藏，
  // 且面板可滚动，视口外的元素没有有效位置。
  await page.waitForTimeout(300);
  const maxOf = () => page.evaluate(() => window.__counts.reduce((a, b) => Math.max(a, b), 0));
  const clear = () => page.evaluate(() => { window.__counts.length = 0; });

  const slider = page.locator('#shapeCtrls .row').filter({ hasText: '基础厚度' }).locator('input[type=range]').first();
  await slider.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await slider.boundingBox();
  let draftMax = 0, fullMax = 0;
  if (!box) {
    console.log('!! 找不到可见滑条，LOD 测试跳过');
  } else {
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    // 先拖两下让 LOD 生效
    await page.mouse.move(box.x + box.width * 0.35, y); await page.waitForTimeout(80);
    await page.mouse.move(box.x + box.width * 0.4, y);  await page.waitForTimeout(80);
    await clear();                       // 清掉起步阶段的采样，只留纯 LOD 拖动
    for (let i = 4; i <= 7; i++) {
      await page.mouse.move(box.x + box.width * (i / 10), y);
      await page.waitForTimeout(80);
    }
    draftMax = await maxOf();            // 拖动中 = 低精度
    await clear();
    await page.mouse.up();               // 松手 → change → 全质量重建 + 渲染
    await page.waitForTimeout(900);
    fullMax = await maxOf();             // 松手后 = 全质量
  }
  ok('LOD：拖动时用低精度、松手后回到全质量', draftMax > 0 && fullMax > draftMax * 1.5,
    `draft max verts=${draftMax}, full max verts=${fullMax}`);

  /* ---------- 方案 A：侧壁平滑法线 + 顶点焊接 ---------- */
  // 历史：ExtrudeGeometry 产出**非索引**几何，其 computeVertexNormals() 只能得到逐面法线，
  // 倒角于是表现为一圈平面带（bevelSegments 段可见棱线）。weldCreased() 一次完成
  // 「焊接成索引几何 + 按折痕角平滑法线」，位置一个字节都不动。
  // 失效时**不报错、不崩溃**，只是倒角重新变棱面 —— 现有断言一条也发现不了，故断言焊接结果。
  // ⚠️ 依赖页面上的 window.padGeoInfo（与 setDbgRebuild 同类的调试读取口）。
  const padInfo = () => page.evaluate(() => window.padGeoInfo());
  const setSliderVal = async (label, v) => {
    await page.evaluate(([label, v]) => {
      const row = [...document.querySelectorAll('#panel .row')]
        .find(r => r.querySelector('label')?.textContent === label);
      const inp = row.querySelector('input[type=range]');
      inp.value = v;
      inp.dispatchEvent(new Event('input', { bubbles: true }));   // set：重建
      inp.dispatchEvent(new Event('change', { bubbles: true }));  // 收尾 LOD：回到全质量
    }, [label, v]);
    await page.waitForTimeout(500);
  };

  const padA = await padInfo();
  ok('方案 A：垫身已焊接为索引几何，且保留顶面/边缘两个材质分组',
    !!padA && padA.indexed && padA.groups === 2 && padA.hasNormal, JSON.stringify(padA));
  // 非索引时顶点数恒等于 三角数×3；焊接后每个三角摊不到 1 个顶点
  ok('方案 A：顶点被复用（顶点数 < 三角数）',
    !!padA && padA.verts < padA.tris, `verts=${padA?.verts}, tris=${padA?.tris}`);
  // 倒角与顶/底盖相切（G1），整圈都该被平滑 → 不该有顶点因折痕被拆开
  ok('方案 A：有倒角时盖面与倒角平滑过渡（无折痕拆分）',
    !!padA && padA.verts === padA.uniquePos, JSON.stringify(padA));

  await setSliderVal('边缘倒角', 0);
  const padB = await padInfo();
  // 无倒角时顶/底盖与侧壁是 90° 硬边，必须拆开，否则边缘会被抹成软过渡
  ok('方案 A：无倒角时顶/底 90° 硬边被保留（顶点被折痕拆开）',
    !!padB && padB.indexed && padB.verts > padB.uniquePos,
    `verts=${padB?.verts}, uniquePos=${padB?.uniquePos}`);
  await setSliderVal('边缘倒角', 3);

  /* ---------- 只影响材质的参数：不得重建几何、不得白渲阴影、不得重传纹理 ---------- */
  // 历史：这类参数曾统一走 rebuild()，白跑 ExtrudeGeometry + 腕托球体；光照组还曾无条件
  // markShadowDirty()，让 5 个与阴影无关的控件每次输入都重渲一次 2048² 深度图；贴图变换
  // 则每次输入都把整张图重传 GPU。三者失效时**都不报错**，只是变慢，现有断言一条也发现
  // 不了 —— 故逐条断言「不该发生时确实没发生」，并配「画面确实变化」的正向护栏，
  // 避免"为了把计数归零而把功能改废"的假阳性。
  // toast 是 position:fixed; z-index:9999，会叠在 #stage 上污染截图比对 → 先隐藏。
  await page.addStyleTag({ content: '#toast-wrap{display:none !important}' });

  // 测试贴图：8px 棋盘，一半完全不透明、一半完全透明。
  // 必须带 alpha —— 重复模式选 cutout 会 discard alpha<0.5 的片元，
  // 不含透明的图根本看不出 uCutout 有没有更新。
  const makePNG = (size = 64) => {
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
      const o = y * (size * 4 + 1);
      raw[o] = 0;                                     // filter: none
      for (let x = 0; x < size; x++) {
        const on = ((x >> 3) + (y >> 3)) % 2 === 0;
        raw[o + 1 + x * 4] = 220; raw[o + 2 + x * 4] = 60; raw[o + 3 + x * 4] = 60;
        raw[o + 4 + x * 4] = on ? 255 : 0;
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6;                         // 8bit RGBA
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]);
  };
  await page.setInputFiles('#file1', { name: 'alpha.png', mimeType: 'image/png', buffer: makePNG() });
  await page.waitForTimeout(1500);
  ok('测试贴图已载入（带 alpha 的棋盘格）',
    await page.evaluate(() => !!document.querySelector('#dz1 img')));

  // rebuild 计数：[rebuild] 走 console.log，harness 只收 error，不会污染 errors
  let rebuildHits = 0;
  const onRebuild = m => { if (/^\[rebuild\]/.test(m.text())) rebuildHits++; };
  page.on('console', onRebuild);
  await page.evaluate(() => window.setDbgRebuild(true));

  const setCtl = (host, label, v, evt) => page.evaluate(({ host, label, v, evt }) => {
    const row = [...document.querySelectorAll(host + ' .row')].find(r => r.textContent.includes(label));
    if (!row) throw new Error('找不到控件行: ' + host + ' / ' + label);
    const inp = row.querySelector('input,select');
    inp.value = String(v);
    // input 走 LOD 预览、change 收尾回到全质量；select 只认 change
    inp.dispatchEvent(new Event(evt || 'input', { bubbles: true }));
    if (evt !== 'change') inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, { host, label, v, evt });

  // 测量一次「改控件」动作的代价：画面是否变化 + 三类开销各发生几次
  const measure = async (host, label, v, evt) => {
    await page.evaluate(() => { window.__fb = 0; window.__tex = 0; });
    rebuildHits = 0;
    const a = await page.locator('#stage').screenshot();
    await setCtl(host, label, v, evt);
    await page.waitForTimeout(400);
    const b = await page.locator('#stage').screenshot();
    const c = await page.evaluate(() => ({ fb: window.__fb, tex: window.__tex }));
    return { changed: Buffer.compare(a, b) !== 0, rebuilds: rebuildHits, fb: c.fb, tex: c.tex };
  };

  const mRough = await measure('#shapeCtrls', '表面粗糙', 0.15);
  ok('改「表面粗糙」后画面变化', mRough.changed);
  ok('改「表面粗糙」不重建几何（走材质更新而非 rebuild）', mRough.rebuilds === 0,
    `rebuild ${mRough.rebuilds} 次`);

  // 边缘颜色只在「边缘随正面整体着色」关闭时才有独立材质可改；关它本身会重建，属预期
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#shapeCtrls .row')]
      .find(r => r.textContent.includes('边缘随正面整体着色'));
    const cb = row.querySelector('input[type=checkbox]');
    if (cb.checked) cb.click();
  });
  await page.waitForTimeout(800);
  const mEdge = await measure('#shapeCtrls', '边缘颜色', '#ff0000');
  ok('改「边缘颜色」后画面变化', mEdge.changed);
  ok('改「边缘颜色」不重建几何（走材质更新而非 rebuild）', mEdge.rebuilds === 0,
    `rebuild ${mEdge.rebuilds} 次`);

  const mHemi = await measure('#lightCtrls', '环境光', 1.6);
  ok('改「环境光」后画面变化', mHemi.changed);
  ok('改「环境光」不重渲阴影贴图（与阴影无关的控件不该置脏）', mHemi.fb === 0,
    `离屏 FBO 绑定 ${mHemi.fb} 次`);

  // 对照组：主光方位确实改变深度图，必须重渲。没有它，上一条"0 次"可能只是插桩没生效
  const mAz = await measure('#lightCtrls', '主光方位', 120);
  ok('改「主光方位」会重渲阴影贴图（对照组，防止上一条是假阳性）', mAz.fb > 0,
    `离屏 FBO 绑定 ${mAz.fb} 次`);

  const mScale = await measure('#tex1Ctrls', '缩放', 2.5);
  ok('拖「贴图缩放」后画面变化', mScale.changed);
  ok('拖「贴图缩放」不重传纹理（只改 texture.matrix，不需要 needsUpdate）', mScale.tex === 0,
    `纹理上传 ${mScale.tex} 次`);

  // 重复模式：uCutout 只在编译期求值一次，旧实现靠 rebuild() 刷它。
  // 默认 cutout（GL 上与 clamp 同为 ClampToEdgeWrapping）→ 切到 clamp 不该有任何重传。
  const mWrap = await measure('#tex1Ctrls', '重复模式', 'clamp', 'change');
  ok('切「重复模式」后画面变化（uCutout 确实更新，未静默失效）', mWrap.changed);
  ok('切「重复模式」不重建几何且纹理无需重传', mWrap.rebuilds === 0 && mWrap.tex === 0,
    `rebuild ${mWrap.rebuilds} 次，纹理上传 ${mWrap.tex} 次`);

  /* ---------- 切换编辑模式不得重建几何 ---------- */
  // 历史：setCurveEdit() 末尾曾无条件 rebuild()，理由是"进入时关 bevel 让覆盖层与网格对齐"。
  // 而 buildPad() 恒 `bevelEnabled: P.bevel > 0`、根本不读 curveEdit —— 那次重建一个顶点都没变，
  // 白跑 ExtrudeGeometry + 腕托球体，还连带白渲一次 2048² 深度图。
  // 失效时**不报错**，只是每次勾选白花十几毫秒，故断言"不该发生时确实没发生"；
  // 同时断言画面仍会更新（防止为了把计数归零而干脆不重绘）。
  // baseView：进入编辑前的画面基线（此时参数已被前面的用例改过，不是出厂默认视图），
  // 退出后画面必须逐字节回到它。
  // ⚠️ 逐字节比较的前置条件：画面是「按需渲染 + 无逐帧动画」的确定性输出。
  // 若将来引入动画循环、或把 toast / 提示条挪进 #stage，这两条需改为"稳定若干帧后再比较"。
  const baseView = await page.locator('#stage').screenshot();
  const setEdit = want => page.evaluate(w => {
    document.querySelectorAll('#shapeCtrls input[type=checkbox]').forEach(cb => {
      if (cb.parentElement.textContent.includes('编辑轮廓') && cb.checked !== w) cb.click();
    });
  }, want);
  const measureEdit = async want => {
    await page.evaluate(() => { window.__fb = 0; window.__buf = 0; window.__tex = 0; });
    rebuildHits = 0;
    const a = await page.locator('#stage').screenshot();
    await setEdit(want);
    await page.waitForTimeout(250);          // 留足两三帧：首次进入还要 buildOrtho + fitEditOrtho
    const b = await page.locator('#stage').screenshot();
    const c = await page.evaluate(() => ({ fb: window.__fb, buf: window.__buf }));
    return { changed: Buffer.compare(a, b) !== 0, fb: c.fb, buf: c.buf, rebuilds: rebuildHits, shot: b };
  };

  const mEditOn = await measureEdit(true);
  ok('进入编辑轮廓：画面在 250ms 内更新', mEditOn.changed);
  ok('进入编辑轮廓不重建几何、不重渲阴影',
    mEditOn.buf === 0 && mEditOn.fb === 0 && mEditOn.rebuilds === 0,
    `bufferData ${mEditOn.buf} 次，离屏 FBO ${mEditOn.fb} 次，rebuild ${mEditOn.rebuilds} 次`);

  /* ---------- 编辑态相机必须锁定 ---------- */
  // 历史：编辑态曾写 `controls.enabled = false` 后紧跟 `setDragMode('view')`，
  // 后者又把它置回 true —— 赋值是死代码，锁定实际只靠覆盖层拦截指针事件。
  // 故这里必须**关掉覆盖层的事件拦截**才能真正验证，否则测试形同虚设。
  const editOn = await page.evaluate(() =>
    document.getElementById('curveLayer').classList.contains('on'));
  ok('编辑轮廓模式已开启', editOn);

  const stage = await page.locator('#stage').boundingBox();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  const before = await page.locator('#stage').screenshot();

  await page.evaluate(() => { document.getElementById('curveLayer').style.pointerEvents = 'none'; });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx + i * 14, cy + i * 9); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await page.locator('#stage').screenshot();
  ok('编辑态相机锁定：覆盖层不拦截事件时画面仍不变',
    Buffer.compare(before, after) === 0,
    `before=${before.length}B after=${after.length}B`);

  await page.evaluate(() => { document.getElementById('curveLayer').style.pointerEvents = ''; });

  // 退出编辑（同样测量：只换相机与叠加层，几何一个顶点都不该变）
  const mEditOff = await measureEdit(false);
  ok('退出编辑轮廓：画面在 250ms 内更新（相机复位已显式置脏）', mEditOff.changed);
  ok('退出编辑轮廓不重建几何、不重渲阴影',
    mEditOff.buf === 0 && mEditOff.fb === 0 && mEditOff.rebuilds === 0,
    `bufferData ${mEditOff.buf} 次，离屏 FBO ${mEditOff.fb} 次，rebuild ${mEditOff.rebuilds} 次`);
  ok('退出编辑轮廓后画面与进入前逐字节一致（相机已复位）',
    Buffer.compare(baseView, mEditOff.shot) === 0,
    `base=${baseView.length}B after=${mEditOff.shot.length}B`);

  // 负向对照：真正改几何的滑条必须仍产生 bufferData 与阴影重渲。
  // 没有它，上面那几个"0 次"无法与"探针没挂上导致的全 0"区分开。
  await page.evaluate(() => { window.__fb = 0; window.__buf = 0; });
  rebuildHits = 0;
  const thickNow = await page.evaluate(() => Number(
    [...document.querySelectorAll('#panel .row')]
      .find(r => r.querySelector('label')?.textContent === '基础厚度')
      .querySelector('input[type=range]').value));
  await setSliderVal('基础厚度', Math.abs(thickNow - 6) > 0.05 ? 6 : 3);
  const neg = await page.evaluate(() => ({ fb: window.__fb, buf: window.__buf }));
  ok('负向对照：改「基础厚度」确实重建几何并重渲阴影（证明上几条不是假阳性）',
    neg.buf > 0 && neg.fb > 0 && rebuildHits > 0,
    `bufferData ${neg.buf} 次，离屏 FBO ${neg.fb} 次，rebuild ${rebuildHits} 次`);
  // 还原厚度：后续用例虽然都是自比较，但留下一个被改过的全局参数，
  // 会让以后新增的"依赖默认厚度"的断言静默跑偏，故这里就还原掉。
  await setSliderVal('基础厚度', thickNow);

  /* ---------- 退出编辑必须收尾 LOD（commitLOD 的护栏） ---------- */
  // 删掉 setCurveEdit() 末尾的 rebuild() 后，退出编辑时**唯一**的几何收尾就是 commitLOD()。
  // 而上面几条断言要的恰恰是「退出编辑不 rebuild」—— 少了这条护栏，把 commitLOD() 一起删掉
  // 也能全绿，代价是几何静默停在低精度版本并被导出（不报错、不崩溃）。
  // 两者的区别只在「退出前是否真的用过低精度」，故必须真实复现一次：
  //   编辑态内只发 input（等价于"滑条按住不放" / "锚点拖到一半"，与真实拖拽同构）→ 直接退出编辑。
  const fullVerts = (await padInfo()).verts;        // 退出前的全质量基线
  await setEdit(true);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#shapeCtrls .row')]
      .find(r => r.textContent.includes('腕托顶距'));
    const inp = row.querySelector('input[type=range]');
    const v0 = inp.value;
    const bump = Number(v0) + 10;
    inp.value = String(bump > Number(inp.max) ? Number(inp.min) : bump);
    inp.dispatchEvent(new Event('input', { bubbles: true }));   // 只发 input：不松手
    // 再拖回原值（仍不发 change）：几何参数回到基线，退出后的顶点数才能与基线严格相等 ——
    // 顺带把"参数是否正确"也纳入断言（顶点数随外形变化，7704 → 挪动后 7794）。
    inp.value = v0;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const draftVerts = (await padInfo()).verts;
  rebuildHits = 0;
  await setEdit(false);                             // 退出 → commitLOD() 必须补一次全质量重建
  await page.waitForTimeout(700);
  const afterVerts = (await padInfo()).verts;
  ok('编辑态内用过低精度后退出编辑：几何被补回全质量（commitLOD 未失效）',
    draftVerts < fullVerts && rebuildHits > 0 && afterVerts === fullVerts,
    `全质量基线 ${fullVerts} 顶点 → 编辑态拖动 ${draftVerts} → 退出后 ${afterVerts}（rebuild ${rebuildHits} 次）`);

  page.off('console', onRebuild);
  await page.evaluate(() => window.setDbgRebuild(false));

  /* ---------- 导出后渲染器状态必须复原 ---------- */
  // 导出会临时把渲染器改成"导出态"（放大画布 + pixelRatio=1 + 可能的 viewOffset），
  // 靠 try/finally 恢复。这里验证 finally 真的生效：尺寸与画面都必须回到导出前。
  const preExp = await page.locator('#stage').screenshot();
  const beforeSize = await page.evaluate(() => {
    const c = document.querySelector('#view');
    return { w: c.width, h: c.height, cssW: c.clientWidth };
  });
  const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导出预览图'));
    if (b) b.click(); else throw new Error('找不到导出预览图按钮');
  });
  const d1 = await dl;
  const postExp = await page.locator('#stage').screenshot();
  const afterSize = await page.evaluate(() => {
    const c = document.querySelector('#view');
    return { w: c.width, h: c.height, cssW: c.clientWidth };
  });
  ok('导出预览图：产生下载', !!d1, d1 ? d1.suggestedFilename() : 'no download');
  ok('导出预览图：画布尺寸已复原',
    JSON.stringify(beforeSize) === JSON.stringify(afterSize),
    `${JSON.stringify(beforeSize)} -> ${JSON.stringify(afterSize)}`);
  ok('导出预览图：画面与导出前一致', Buffer.compare(preExp, postExp) === 0,
    `${preExp.length}B vs ${postExp.length}B`);

  /* ---------- 几何入口异常兜底 ---------- */
  // 历史：rebuild() 下面挂着 makeClassicShape / buildPad / buildWrist，三者都没有 try。
  // 一旦抛异常，滑条 oninput、锚点 pointermove、导入配置、启动首次重建这几条路径全部
  // 直接冒泡 —— 渲染循环本身还在跑，但几何停在半成品，用户只看到"画面不动"且毫无提示。
  // 这里必须**真的让几何抛一次**：光断言"改一堆参数没崩"证明不了兜底链路存在（改动前也全绿）。
  // 注入点挂在页面上的 window.__geoFaultOnce()（见 index.html 内的说明）。
  const toastTexts = () => page.evaluate(() =>
    [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent));
  const clearToasts = () => page.evaluate(() => {
    document.querySelectorAll('#toast-wrap .toast').forEach(t => t.remove());
  });

  /* 挑参数有两条硬约束，选错了用例会假绿：
     ① 必须真的进几何 —— 材质 / 光照类参数改了根本不重建，注入的故障没机会触发；
     ② 必须**只在 classic 模式下可见且生效** ——「基础宽度」在经典款里是派生值
        （总长由腕托足迹 + 腕托顶距推出，见 padHeight()），改 padW 顶点一个都不变；
        而它在经典款下又是隐藏行，通用滑条选择器会去操作一个无效控件。
     故这里用「前后长度」(wD)：经典款 / 全款式都生效，且默认可见（腕托 style=full 或 balls）。
     越界值也刻意选成"会被滑条夹回去"的量级，好让"回退到抛出前的值"与"被夹到边界值"
     能区分开（前者回到 89，后者只会落在 160 上）。 */
  const wdInput = label => page.evaluate(label => {
    const c = [...document.querySelectorAll('#panel .row')]
      .find(r => r.querySelector('label')?.textContent === label);
    const inp = c.querySelector('input[type=range]');
    return { value: Number(inp.value), min: Number(inp.min), max: Number(inp.max) };
  }, label);
  /* 用 defineProperty 绕过 range 自身的夹紧，模拟"P 里真的存了越界值"。
     ⚠️ 覆写的是 value 的 **getter**（返回常量）而不是 setter —— 覆写 setter 时浏览器
     仍会按 min/max 夹紧 getter 的返回值，根本造不出越界。用完必须删掉这个属性，
     否则后续读取永远拿到那个常量，断言会在两个位置同时失真：
     "回退到上一个可用参数"读到常量而误判失败、"后续操作仍能响应"反而误判通过。 */
  const setOver = (label, v) => page.evaluate(({ label, v }) => {
    const c = [...document.querySelectorAll('#panel .row')]
      .find(r => r.querySelector('label')?.textContent === label);
    const inp = c.querySelector('input[type=range]');
    Object.defineProperty(inp, 'value', { get: () => String(v), configurable: true });
    try {
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      delete inp.value;   // 复原为原型上的原生访问器
    }
  }, { label, v });

  await clearToasts();
  const wd = await wdInput('前后长度');
  const vertsBefore = (await padInfo()).verts;
  await page.evaluate(() => window.__geoFaultOnce('测试注入的几何故障'));
  await setOver('前后长度', wd.max + 100);   // 越出滑条上限：回退后必须落回合法区间内
  await page.waitForTimeout(600);
  const injected = await toastTexts();
  ok('几何兜底：几何入口抛异常时给出 toast 提示（不再静默）',
    injected.some(t => t.includes('几何重建失败')), injected.join(' || '));
  ok('几何兜底：提示里带上了具体原因（便于用户反馈）',
    injected.some(t => t.includes('测试注入的几何故障')), injected.join(' || '));
  const wdAfter = await wdInput('前后长度');
  const vertsAfter = (await padInfo()).verts;
  // 两条断言必须同时成立，各挡一种"假修复"：
  //   · 只看参数 —— 参数闸门（clampGeoParams）单独就能让这条变绿，捕获取消了也发现不了；
  //   · 只看几何 —— 会退化成"任何成功重建都通过"，没变化也过。
  // 合起来才唯一指向"回退到上一个可用参数、且坏几何被换成了好几何"。
  ok('几何兜底：参数回退到抛出前的值（越界值没有留在 P 里）',
    Math.abs(wdAfter.value - wd.value) < 1e-6,
    `抛出前 ${wd.value}，越界写入 ${wd.max + 100}，回退后 ${wdAfter.value}（合法区间 ${wd.min}~${wd.max}）`);
  // 越界值 260 会真的改变几何（顶点数 7704 → 7974）。若兜底链路断了，P 里留着 260、
  // 几何也停在按 260 生成的那份 —— 必须能区分"回到了抛出前的状态"与"停在了坏状态"。
  ok('几何兜底：画面继续可用（几何被换回重建前的完整版本，而不是停在半成品）',
    vertsAfter === vertsBefore,
    `${vertsBefore} -> ${vertsAfter}`);

  /* 注入后应用必须还能正常响应下一次操作（"卡死"的反例） */
  await clearToasts();
  const vertsFrozen = (await padInfo()).verts;
  await setOver('前后长度', wdAfter.value < wd.max - 40 ? wdAfter.value + 40 : wdAfter.value - 40);
  await page.waitForTimeout(600);
  const recovered = await padInfo();
  ok('几何兜底：注入畸形故障后应用仍能响应后续操作（不卡死）',
    recovered.verts !== vertsFrozen,
    `${vertsFrozen} -> ${recovered.verts} 顶点`);
  const rebound = await toastTexts();
  ok('几何兜底：故障恢复后不再刷错误提示', !rebound.some(t => t.includes('几何重建失败')),
    rebound.join(' || '));
  await setOver('前后长度', wd.value);
  await page.waitForTimeout(400);

  /* ---------- 滑条越界：参数二次收敛而不是崩掉 ---------- */
  // 滑条自身有 min/max，但"导入配置 → 值落在套表边界内 → 用户再往极端拖"这类组合
  // 在几何入口处没有第二道闸。这里直接把 input.value 写到范围外 ——
  // 浏览器对 range 会立刻夹回 min/max，故用 defineProperty 绕过，模拟"值真的越界"。
  // ⚠️ 必须确认"没有收敛"时这条用例真的会 FAIL：用「基础厚度」(0~10，不影响顶点数)
  // 写的话，越界值与收敛值都落在乐观区间内，断言恒真 —— 那是假绿。
  await clearToasts();
  const vertsForClamp = (await padInfo()).verts;
  await setOver('前后长度', 999);
  await page.waitForTimeout(600);
  const clamped = await page.evaluate(() => window.__geoState().wD);
  // 999 被入口夹到 160（滑条上界）；没有这道闸就会原样进几何，画出畸形模型
  ok('滑条越界：几何入口二次收敛到合法范围（而不是画出畸形模型）',
    Number.isFinite(clamped) && clamped > 0 && clamped < 400, `P.wD=${clamped}`);
  const clampToast = await toastTexts();
  ok('滑条越界：收敛时给出提示', clampToast.some(t => t.includes('已收敛超出范围')), clampToast.join(' || '));
  // 收敛后几何应当仍是"完整可渲染"的：不能因为参数被夹就崩掉或半成品
  const clampGeo = await padInfo();
  ok('滑条越界：收敛后几何仍完整可渲染（顶点数正常、材质分组完好）',
    clampGeo && clampGeo.verts > 0 && clampGeo.groups === 2 && clampGeo.indexed,
    JSON.stringify(clampGeo));
  await setOver('前后长度', wd.value);
  await page.waitForTimeout(400);
  ok('滑条越界用例已还原参数', (await padInfo()).verts === vertsForClamp,
    `${vertsForClamp} -> ${(await padInfo()).verts}`);

  /* ---------- 配置导入校验 ---------- */
  const importCfg = async (obj, name) => {
    await page.evaluate(async ({ obj, name }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(obj)], name, { type: 'application/json' }));
      const inp = document.getElementById('cfgFile');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, { obj, name });
    await page.waitForTimeout(700);
    return page.evaluate(() => [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent).join(' || '));
  };

  const tValid = await importCfg(
    { type: '3dm-config', version: 1, params: { padW: 300, padH: 300, shape: 'rect' } }, 'ok.json');
  ok('配置导入：合法配置导入成功', tValid.includes('配置已导入'), tValid);

  /* 导入后贴图变换控件必须仍写进 P.t1。
     历史：导入校验会为 t1/t2 生成全新对象，而控件曾在闭包里捕获旧引用 ——
     拖动有反应、UI 读数也对，但画面与导出的配置都不变，且完全不报错。
     这类静默失效只能靠"改控件 → 导出配置 → 读回值"的端到端路径发现。 */
  const TEX_SCALE = 2.34;
  await page.evaluate(v => {
    const row = [...document.querySelectorAll('#tex1Ctrls .row')]
      .find(r => r.textContent.includes('缩放'));
    const inp = row.querySelector('input[type=range]');
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(TEX_SCALE));
  await page.waitForTimeout(300);
  const dlCfg = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  // 用 evaluate 触发而非 page.click：toast 可能盖住按钮导致点击被拦截
  await page.evaluate(() => document.querySelector('[data-act="exportJson"]').click());
  const cfgDl = await dlCfg;
  let exportedS = null;
  if (cfgDl) exportedS = JSON.parse(fs.readFileSync(await cfgDl.path(), 'utf8')).params.t1.s;
  ok('配置导入：贴图变换控件仍写入 P.t1（不因导入换对象而失效）',
    Math.abs((exportedS ?? -1) - TEX_SCALE) < 1e-6,
    `控件设为 ${TEX_SCALE}，导出的 params.t1.s=${exportedS}`);

  const tBad = await importCfg({ type: '3dm-config', version: 1, params: { padW: 99999, shape: 'nope' } }, 'bad.json');
  ok('配置导入：越界/非法枚举被拦下并提示', tBad.includes('回退默认'), tBad);

  const tInject = await importCfg(
    { type: '3dm-config', version: 1, params: { padW: 240, __proto__: { polluted: 1 }, evilKey: 'x' } }, 'inj.json');
  ok('配置导入：未知字段被忽略', tInject.includes('未知字段') || tInject.includes('配置已导入'), tInject);

  const tWrong = await importCfg({ hello: 'world' }, 'wrong.json');
  ok('配置导入：非配置文件被拒绝并提示', tWrong.includes('导入失败'), tWrong);

  const tCorrupt = await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4, 5])], 'broken.zip', { type: 'application/zip' }));
    const inp = document.getElementById('cfgFile');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    return [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent).join(' || ');
  });
  ok('配置导入：损坏 ZIP 被拒绝并提示（不再静默）', tCorrupt.includes('导入失败'), tCorrupt);

  /* ---------- 坏图片不再静默 ---------- */
  // 关键：FileReader.readAsDataURL 对任何文件都成功，真实失败在 <img> 解码阶段，
  // 所以只补 FileReader.onerror 是无效的，必须由 makeTex 的 onError 兜住。
  const tBadImg = await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'fake.png', { type: 'image/png' }));
    const inp = document.getElementById('file1');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2500));
    return [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent).join(' || ');
  });
  ok('贴图：损坏图片有明确失败提示', tBadImg.includes('加载失败'), tBadImg);

  /* ---------- 收尾 ---------- */
  const finalErrors = errors.filter(e => !EXPECTED_LOG.test(e));
  ok('全流程无意外未捕获错误（pageerror 与非预期 console.error）', finalErrors.length === 0,
    finalErrors.slice(0, 5).join(' | '));
} catch (e) {
  crashed = e;   // 只记录不重抛：finally 收尾后仍要打印已完成的断言清单
} finally {
  await browser.close();
  await server.stop();
}
process.exit(finish(crashed));
