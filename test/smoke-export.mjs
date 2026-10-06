/* 导出与资源冒烟：环境贴图未被误释放、阴影按需更新、导入清贴图、
   GLB/STL/OBJ 导出非空、模型渲染图导出后画面复原。

   断言名一律自解释，**不要**用「P0-3」「P1-1」这类编号：
   它们指向的是一份临时文档，删掉后编号就无处可查（历史来历请在注释里说明）。 */
import { statSync, readFileSync } from 'node:fs';
import { serve, open, reporter, EXPECTED_LOG } from './_harness.mjs';
import { pngPixels, countPixels } from './_png.mjs';
import { HEADER_W_RATIO } from '../src/exportHeader.js';

const server = await serve();
const { browser, page, errors } = await open(server);
const { ok, finish } = reporter('导出与资源');

let crashed = null;
try {
  // #toast-wrap 是 position:fixed; bottom:28px; z-index:9999，**叠在 #stage 上面**，
  // 元素截图会把它一起拍进去。错误类 toast 要 5s 才消失，会污染所有画面比对。
  // 本脚本做的是截图比对（toast 文案的断言在 smoke-render.mjs 里做），故直接隐藏。
  await page.addStyleTag({ content: '#toast-wrap{display:none !important;}' });
  await page.waitForTimeout(300);

  const shot = async () => page.locator('#stage').screenshot();
  const rowByText = t => page.locator('.row').filter({ hasText: t }).first();

  /* ---------- 环境贴图未被误释放 ---------- */
  // 释放 PMREMGenerator 时若连带 dispose 了 scene.environment，
  // 材质会失去环境反射、画面整体变暗。这里只做"渲染器仍正常"的粗筛。
  const env = await page.evaluate(() => {
    const c = document.querySelector('#view');
    return { hasCanvas: !!c, w: c.width };
  });
  ok('环境贴图未被误释放（渲染器正常）', env.hasCanvas && env.w > 0, JSON.stringify(env));

  /* ---------- 阴影按需更新 ---------- */
  // 阴影贴图改为 autoUpdate=false + 显式 needsUpdate。不能改成"把 castShadow 绑到
  // P.shadow"——那会连带删掉腕托投在垫身上的阴影，改变默认外观。
  const shadowCb = page.locator('#lightCtrls input[type=checkbox]').first();
  await shadowCb.scrollIntoViewIfNeeded();
  const shadowOff = await shot();
  await shadowCb.check();                       // 地面阴影 ON → updateLights → 置阴影脏
  await page.waitForTimeout(700);
  const shadowOn = await shot();
  ok('阴影按需更新：开启地面阴影后画面变化',
    Buffer.compare(shadowOff, shadowOn) !== 0,
    `${shadowOff.length}B vs ${shadowOn.length}B`);

  // 改主光方位：updateLights 必须置 shadowMap.needsUpdate，否则阴影会停在上次的样子
  const az = rowByText('主光方位').locator('input[type=range]');
  await az.scrollIntoViewIfNeeded();
  const box = await az.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, y);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const shadowMoved = await shot();
  ok('阴影按需更新：改主光方位后阴影同步',
    Buffer.compare(shadowOn, shadowMoved) !== 0,
    `${shadowOn.length}B vs ${shadowMoved.length}B`);

  // 静止时不应再有任何重绘 —— 与按需渲染叠加验证
  const s1 = await shot();
  await page.waitForTimeout(1200);
  const s2 = await shot();
  ok('静止 1.2s 内画面稳定（无持续重绘）', Buffer.compare(s1, s2) === 0, `${s1.length}B vs ${s2.length}B`);

  /* ---------- 导入无贴图配置应清空已有贴图 ---------- */
  // 先塞一张真实可用的 PNG 进主贴图槽
  const uploaded = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ff0000'; g.fillRect(0, 0, 64, 64);
    const url = c.toDataURL('image/png');
    const bin = Uint8Array.from(atob(url.split(',')[1]), ch => ch.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'tex.png', { type: 'image/png' }));
    const inp = document.getElementById('file1');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    return document.getElementById('dz1').innerHTML.includes('<img');
  });
  ok('前置：贴图已成功上传', uploaded === true, `dz1 has img = ${uploaded}`);

  // 导入一份不带贴图(JSON)的配置 → 两个槽位都应被清空
  await page.evaluate(async () => {
    const cfg = { type: '3dm-config', version: 1, params: { padW: 250, padH: 250, shape: 'classic' } };
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(cfg)], 'n.json', { type: 'application/json' }));
    const inp = document.getElementById('cfgFile');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1200));
  });
  const cleared = await page.evaluate(() => ({
    dz1: document.getElementById('dz1').innerHTML,
    dz2: document.getElementById('dz2').innerHTML,
  }));
  ok('导入无贴图配置后清空已有贴图（预览回到占位）',
    !cleared.dz1.includes('<img') && !cleared.dz2.includes('<img'),
    JSON.stringify(cleared).slice(0, 160));

  /* ---------- 模型导出：GLB / STL / OBJ ---------- */
  // 导出前必须 ensureFullQuality()，否则 LOD 的低精度几何会被直接写进成品
  for (const [name, ext] of [['GLB', 'glb'], ['STL', 'stl'], ['OBJ', 'obj']]) {
    const dp = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    const clicked = await page.evaluate(n => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === n
        || x.textContent.includes(n));
      if (!b) return false;
      b.click(); return true;
    }, name);
    const d = await dp;
    let size = 0;
    if (d) {
      const p = await d.path();
      if (p) size = statSync(p).size;
    }
    ok(`模型导出 ${name} 成功且非空`, clicked && !!d && size > 1000,
      d ? `${d.suggestedFilename()} ${size}B` : 'no download');
  }

  /* ---------- 导出图顶部的署名条 ---------- */
  // 断言落到**像素**上：署名条的存在与否在字节级验不出来（多一条深色横幅只改体积），
  // 而截图比对又会被 Playwright 的截图编码差异干扰。直接解 PNG 最稳。
  // 判据取自需求本身：「深底 + 白字 + 品牌粉 + 右上角白底黑块」。
  const isWhite = c => c[0] > 230 && c[1] > 230 && c[2] > 230;
  const isPink = c => c[0] > 230 && c[1] > 100 && c[1] < 170 && c[2] > 165;
  const isDarkBg = c => c[0] < 45 && c[1] < 45 && c[2] < 50;
  const headerBand = px => Math.round(px.w * HEADER_W_RATIO);
  {
    const dpH = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导出预览图'));
      if (b) b.click();
    });
    const dh = await dpH;
    let px = null;
    if (dh) { const p = await dh.path(); if (p) px = pngPixels(readFileSync(p)); }
    ok('署名条：导出图已产出可解析', !!px, px ? `${px.w}×${px.h}` : 'no download');
    if (px) {
      const hb = headerBand(px);
      const white = countPixels(px, { y1: hb }, isWhite);
      const pink = countPixels(px, { y1: hb }, isPink);
      const dark = countPixels(px, { y1: hb }, isDarkBg);
      const bandArea = hb * px.w / 3;
      ok('署名条：顶部是一条深底横幅', dark > bandArea * 0.3, `深色像素 ${dark} / 采样 ${Math.round(bandArea)}`);
      ok('署名条：软件名带白色文字段', white > 200, `白色像素 ${white}`);
      ok('署名条：软件名带品牌粉强调段（与页面标题同款配色）', pink > 200, `粉色像素 ${pink}`);
      // 负向对照：横幅下方是画面（默认浅灰背景 #e9e7ec），既不该有深底也不该有粉色。
      // 没有这条的话，"整张图都是深色"也能让上面几条全绿。
      const belowDark = countPixels(px, { y0: hb + 4, y1: Math.min(px.h, hb + 400) }, isDarkBg);
      ok('署名条：横幅只占顶部一条（画面区域未被覆盖）', belowDark < (px.w * 400 / 3) * 0.2,
        `画面区深色像素 ${belowDark}`);
      // 二维码：右上角的白底方块，且白底内部**必须有深色模块**。
      // ⚠️ 只数"右上角有多少深色像素"是假通过 —— 横幅底色本身就是深色。
      //    必须先框出白底方块（二维码一定有白底，否则深色模块在深底上读不出来），
      //    再在白底内部数深色模块。
      const body = { y1: hb };
      const xs = [], ys = [];
      for (let y = 0; y < hb; y++) for (let x = Math.round(px.w * 0.8); x < px.w; x += 2) {
        if (isWhite(px.at(x, y))) { xs.push(x); ys.push(y); }
      }
      const qrBox = xs.length ? {
        x0: Math.min(...xs), x1: Math.max(...xs) + 1,
        y0: Math.min(...ys), y1: Math.max(...ys) + 1,
      } : null;
      ok('署名条：右上角有二维码白底方块', !!qrBox && (qrBox.x1 - qrBox.x0) > hb * 0.4,
        qrBox ? JSON.stringify(qrBox) : '未找到白底');
      if (qrBox) {
        /* 静区（quiet zone）：这一轮修的就是它 —— 二维码直接画在深色横幅上时，
           边缘黑模块与底色融成一片，定位图案找不到边界，扫码器整个读不出来。
           判据是「白底卡的内圈有一整圈是白的」：从卡的四条边各向内收一段，
           那一圈上不该出现任何深色像素。⚠️ 不能只判"卡的边长比二维码大"，
           那只证明盒子大了，证明不了里面没把黑模块摊出去。
           ⚠️ 内缩量必须**小于静区**，否则这一圈会切进二维码本体、把黑模块误判成
              "静区不干净"。静区 = 4 个模块，卡 = 本体 + 8 个模块，故卡宽的
              4/37 ≈ 10.8% 就是静区。这里取卡宽的 8%（比静区窄一点，落在纯白区里）。 */
        const innerBox = {
          x0: qrBox.x0 + Math.max(1, Math.round((qrBox.x1 - qrBox.x0) * 0.08)),
          x1: qrBox.x1 - Math.max(1, Math.round((qrBox.x1 - qrBox.x0) * 0.08)),
          y0: qrBox.y0 + Math.max(1, Math.round((qrBox.y1 - qrBox.y0) * 0.08)),
          y1: qrBox.y1 - Math.max(1, Math.round((qrBox.y1 - qrBox.y0) * 0.08)),
        };
        // 深色模块**只数二维码本体**（静区那一圈必然是白的，混进来会把密度摊薄）：
        // 白底卡 = 本体 + 静区，卡的尺寸约为本体的 1.28 倍，直接按卡面积算会低报 ~35%。
        const inner = countPixels(px, { ...innerBox, step: 1 },
          c => c[0] < 90 && c[1] < 90 && c[2] < 100);
        const innerArea = (innerBox.x1 - innerBox.x0) * (innerBox.y1 - innerBox.y0);
        // 真二维码的深色模块约占 40%~60%；纯白方块（二维码没画上）会接近 0
        ok('署名条：二维码本体里确有深色模块（不是一块空白）',
          inner > innerArea * 0.2, `深色模块 ${inner} / 本体面积 ${innerArea}`);
        // 静区环 = 卡的四条内缩边带，逐点扫（静区必须逐像素连续，不能抽样）
        let ringDark = 0;
        for (let x = qrBox.x0; x < qrBox.x1; x++) {
          if (px.at(x, innerBox.y0)[0] < 200) ringDark++;
          if (px.at(x, innerBox.y1 - 1)[0] < 200) ringDark++;
        }
        for (let y = qrBox.y0; y < qrBox.y1; y++) {
          if (px.at(innerBox.x0, y)[0] < 200) ringDark++;
          if (px.at(innerBox.x1 - 1, y)[0] < 200) ringDark++;
        }
        ok('署名条：二维码四周有静区（边缘黑模块没与深底相接，扫码器能定位）',
          ringDark === 0,
          `静区环上仍有 ${ringDark} 个非白像素（静区必须 ≥4 模块）`);
        /* 静区必须是**纯白**。曾经在这里铺过棋盘格当"透明底的占位图案"，
           灰格子落进静区里就成了定位图案旁边的杂色噪声 —— 静区是按像素判定的，
           差一点点就落在扫码器的容忍边界上。这条把"静区里只有白与黑"钉死。 */
        const grayish = countPixels(px, { ...qrBox, step: 1 },
          c => c[0] < 250 && c[0] > 90 && c[1] < 250 && c[1] > 90);
        ok('署名条：二维码静区是纯白（不许有灰格子混进留白）',
          grayish === 0, `静区/卡内出现 ${grayish} 个灰像素`);
        /* 静区四边**等宽**（都 = 4 个模块）。曾经的写法把静区算了两遍：
           `toCanvas({margin: 4})` 是在指定 width 里内缩，QR 本体只剩 29/37，
           外层卡再补一圈 4 模块，于是出现"一边 2 模块、一边 4 模块"的畸形留白，
           模块边长比版式预期小了近 1/4，模块被压到 1.5px 以下就扫不动了。 */
        /* 静区四边**等宽**（都 = 4 个模块）。曾经的写法把静区算了两遍：
           `toCanvas({margin: 4})` 是在指定 width 里内缩，QR 本体只剩 29/37，
           外层卡再补一圈 4 模块，于是出现"一边 2 模块、一边 4 模块"的畸形留白，
           模块边长比版式预期小了近 1/4，模块被压到 1.5px 以下就扫不动了。
           量法：在卡的中部横/竖各拉一条线，找第一个/最后一个深色像素。 */
        const gaps = (() => {
          // ⚠️ 按**列/行的极值**量静区，不要按卡中线拉一条线：
          //    中线可能正好落在没有黑模块的码字行上，量出来的"右静区"会虚大。
          //    每列/每行的深色像素取最外沿，得到的是整块码的真正外接框。
          const dark = c => c[0] < 128 && c[1] < 128 && c[2] < 140;
          let l = qrBox.x1, r = qrBox.x0, t = qrBox.y1, b = qrBox.y0;
          for (let y = qrBox.y0; y < qrBox.y1; y++) for (let x = qrBox.x0; x < qrBox.x1; x++) {
            if (!dark(px.at(x, y))) continue;
            if (x < l) l = x; if (x > r) r = x;
            if (y < t) t = y; if (y > b) b = y;
          }
          if (l > r) return null;
          return {
            L: l - qrBox.x0, R: qrBox.x1 - 1 - r,
            T: t - qrBox.y0, B: qrBox.y1 - 1 - b,
          };
        })();
        ok('署名条：静区四边等宽（静区没被算两遍）',
          !!gaps && Math.max(gaps.L, gaps.R, gaps.T, gaps.B) - Math.min(gaps.L, gaps.R, gaps.T, gaps.B) <= 2,
          gaps ? JSON.stringify(gaps) : '未测到');
        /* 模块边长 = 本体 / 模块数。版式把模块边长的**期望值**定死在 qs/模块数 上，
           出图时必须与之吻合 —— 差一点点就说明"库里又悄悄加了一圈 margin"，
           或"版式与位图各算了一份尺寸"。2x 导出下实测 ≈ 1.9px，掉到 1.5px 以下
           就会开始丢模块（1x 导出本来就只有 ~0.96px，那是比例决定的、扫描器读不出，
           见 src/exportHeader.js 里 HEADER_W_RATIO 的注释）。 */
        const bodyPx = gaps ? (qrBox.x1 - qrBox.x0 - gaps.L - gaps.R) : 0;
        const modPx = bodyPx / 29;
        ok('署名条：模块边长与版式预期吻合（≈ qs/模块数，没被库里加的第二圈静区压小）',
          modPx > 1.5, `模块边长 ${modPx.toFixed(2)}px（预期 ≈ 2px）`);
      }
      void body;
    }
  }

  /* ---------- 「模型渲染图」的贴合裁剪 + 署名条宽度 ---------- */
  // 这一节修的是两个用户可见的毛病：
  //   ① 导出图右侧多出一条透明边 —— 署名条比画面宽。
  //   ② 画面顶部离署名条太近 —— 白底卡几乎顶满整条横幅。
  // ⚠️ 判据全部落在**像素坐标**上：这两个毛病在"有没有署名条"这种存在性断言里
  //    完全看不出来（前一节 12 条全绿，毛病照样在）。
  {
    const dpM = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('模型渲染图'));
      if (b) b.click();
    });
    const dm = await dpM;
    let pm = null;
    if (dm) { const p = await dm.path(); if (p) pm = pngPixels(readFileSync(p)); }
    ok('模型渲染图：已产出可解析', !!pm, pm ? `${pm.w}×${pm.h}` : 'no download');
    if (pm) {
      // 署名条高：从顶部往下找第一行"最左像素透明"的行（署名条铺满整幅画布宽）
      let hb = 0;
      for (let y = 0; y < pm.h; y++) if (pm.at(0, y)[3] === 0) { hb = y; break; }
      ok('模型渲染图：顶部确有署名条', hb > 0, `条高 ${hb}px`);
      // 署名条的宽度（第 1 行左右边界）与画面内容的宽度（署名条以下的不透明包围盒）
      const bandW = (() => {
        let a = -1, b = -1;
        for (let x = 0; x < pm.w; x++) if (pm.at(x, 1)[3] > 0) { if (a < 0) a = x; b = x; }
        return a < 0 ? 0 : b - a + 1;
      })();
      let mnx = pm.w, mxx = -1;
      for (let y = hb; y < pm.h; y++) for (let x = 0; x < pm.w; x++) {
        if (pm.at(x, y)[3] > 0) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; }
      }
      const bodyW = mxx - mnx + 1;
      /* ① 署名条与画面同宽，且都顶到画布左右边缘 —— 差一像素就是那条透明边。
         允许 1px 的取整余量（投影外接盒的 PAD 是 2px 屏幕边、随倍率取整）。 */
      ok('模型渲染图：署名条与画面等宽（不再多出透明边）',
        Math.abs(bandW - bodyW) <= 1,
        `署名条 ${bandW}px vs 画面 ${bodyW}px`);
      ok('模型渲染图：画面左右不留透明边',
        mnx <= 1 && pm.w - 1 - mxx <= 1,
        `左 ${mnx}px 右 ${pm.w - 1 - mxx}px`);
      /* ② 白底卡在条内竖直居中，上下都留得下 —— 这是"标题离画面太近"的量化判据。
         卡以外的部分由 headerLayout 的 gap + rule 保证，这里直接量卡的位置。 */
      const isWh = c => c[0] > 240 && c[1] > 240 && c[2] > 240;
      const cxs = [], cys = [];
      for (let y = 0; y < hb; y++) for (let x = Math.round(pm.w * 0.75); x < pm.w; x += 1) {
        if (isWh(pm.at(x, y))) { cxs.push(x); cys.push(y); }
      }
      ok('模型渲染图：右上角有二维码白底卡', cxs.length > 0, `${cxs.length} 个白像素`);
      if (cxs.length) {
        const cy0 = Math.min(...cys), cy1 = Math.max(...cys) + 1;
        const topGap = cy0, botGap = hb - cy1;
        ok('模型渲染图：白底卡上下都有留白（画面不再贴着标题）',
          topGap >= 4 && botGap >= 4,
          `卡上留白 ${topGap}px、下留白 ${botGap}px`);
        ok('模型渲染图：白底卡大致竖直居中（上下留白差 ≤ 卡高的 1/3）',
          Math.abs(topGap - botGap) <= (cy1 - cy0) / 3,
          `上 ${topGap} 下 ${botGap} 卡高 ${cy1 - cy0}`);
      }
    }
  }

  /* ---------- 「署名条留空底」的显隐 ---------- */
  // 它只在"导出透明"打开时才有意义。⚠️ 这条断言必须验**当场勾选**的一致性，
  // 而不是只跑一遍 uiSyncers —— 后者只在导入配置 / 恢复草稿时遍历，
  // 曾经就是漏了 applyParamThen 导致这一行勾了「导出时透明背景」也不出现。
  {
    const state = () => page.evaluate(() => {
      const q = k => document.querySelector(`label[data-i18n="${k}"]`)?.closest('.row');
      return {
        tp: q('ctl.exportTransparent').querySelector('input[type=checkbox]').checked,
        hdr: q('ctl.exportHeader').querySelector('input[type=checkbox]').checked,
        clearVisible: q('ctl.exportHeaderTransparent').style.display !== 'none',
      };
    });
    const set = (k, v) => page.evaluate(([k, val]) => {
      const cb = document.querySelector(`label[data-i18n="${k}"]`).closest('.row')
        .querySelector('input[type=checkbox]');
      cb.checked = val; cb.dispatchEvent(new Event('change', { bubbles: true }));
    }, [k, v]);
    ok('留空底：默认（不透明导出）隐藏', (await state()).clearVisible === false);
    await set('ctl.exportTransparent', true); await page.waitForTimeout(120);
    ok('留空底：勾上「导出时透明背景」后当场出现', (await state()).clearVisible === true);
    await set('ctl.exportTransparent', false); await page.waitForTimeout(120);
    ok('留空底：取消「导出时透明背景」后当场隐藏', (await state()).clearVisible === false);
  }

  /* ---------- 关掉署名条后导出图恢复原状 ---------- */
  // 负向对照：没有这条，"顶部永远有深底"也能让上面几条全绿。
  {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.row')]
        .find(r => r.textContent.includes('导出图署名条'));
      const cb = row.querySelector('input[type=checkbox]');
      cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const dpN = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导出预览图'));
      if (b) b.click();
    });
    const dn = await dpN;
    let pxn = null;
    if (dn) { const p = await dn.path(); if (p) pxn = pngPixels(readFileSync(p)); }
    ok('关掉署名条：导出图顶部不再有深底横幅', !!pxn && (() => {
      const hb = Math.round(pxn.w * HEADER_W_RATIO);
      const dark = countPixels(pxn, { y1: hb }, isDarkBg);
      const area = hb * pxn.w / 3;
      return dark < area * 0.1;
    })(), pxn ? `${pxn.w}×${pxn.h}` : 'no download');
    // 还原设置，避免影响后面的用例
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.row')]
        .find(r => r.textContent.includes('导出图署名条'));
      const cb = row.querySelector('input[type=checkbox]');
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /* ---------- 导出后画面未走形 ---------- */
  // 模型渲染图会临时改写 5 处状态（透明背景 / 阴影面 / pixelRatio / 画布尺寸 /
  // 相机 viewOffset + aspect），靠 try/finally 全部恢复
  const beforeShot = await shot();
  const dp2 = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('模型渲染图'));
    if (b) b.click();
  });
  await dp2;
  await page.waitForTimeout(900);
  const afterShot = await shot();
  ok('模型渲染图导出后画面复原', Buffer.compare(beforeShot, afterShot) === 0,
    `${beforeShot.length}B vs ${afterShot.length}B`);

  const final = errors.filter(e => !EXPECTED_LOG.test(e));
  ok('无意外未捕获错误', final.length === 0, final.slice(0, 4).join(' | '));
} catch (e) {
  crashed = e;   // 只记录不重抛：finally 收尾后仍要打印已完成的断言清单
} finally {
  await browser.close();
  await server.stop();
}
process.exit(finish(crashed));
