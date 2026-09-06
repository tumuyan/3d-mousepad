/* 渲染与交互冒烟：渲染器启动、按需渲染、LOD、编辑态相机锁定、
   预览图导出后状态复原、配置导入校验（合法 / 越界 / 未知字段 / 坏文件）。

   断言名一律自解释，**不要**用「P0-1」「缺陷 9」这类编号：
   它们指向的是一份临时文档，删掉后编号就无处可查（历史来历请在注释里说明）。 */
import fs from 'node:fs';
import { serve, open, reporter, EXPECTED_LOG } from './_harness.mjs';

const server = await serve();
// 统计 WebGL 绘制调用与帧数（不改页面，纯外部插桩）
const { browser, page, errors } = await open(server, {
  initScript: () => {
    window.__draws = 0; window.__counts = []; window.__frames = 0;
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

  /* ---------- 编辑态相机必须锁定 ---------- */
  // 历史：编辑态曾写 `controls.enabled = false` 后紧跟 `setDragMode('view')`，
  // 后者又把它置回 true —— 赋值是死代码，锁定实际只靠覆盖层拦截指针事件。
  // 故这里必须**关掉覆盖层的事件拦截**才能真正验证，否则测试形同虚设。
  await page.evaluate(() => {
    document.querySelectorAll('#shapeCtrls input[type=checkbox]').forEach(cb => {
      if (cb.parentElement.textContent.includes('编辑轮廓') && !cb.checked) cb.click();
    });
  });
  await page.waitForTimeout(800);
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
  // 退出编辑
  await page.evaluate(() => {
    document.querySelectorAll('#shapeCtrls input[type=checkbox]').forEach(cb => {
      if (cb.parentElement.textContent.includes('编辑轮廓') && cb.checked) cb.click();
    });
  });
  await page.waitForTimeout(600);

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
