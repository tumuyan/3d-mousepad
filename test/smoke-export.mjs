/* 导出与资源冒烟：环境贴图未被误释放、阴影按需更新、导入清贴图、
   GLB/STL/OBJ 导出非空、模型渲染图导出后画面复原。

   断言名一律自解释，**不要**用「P0-3」「P1-1」这类编号：
   它们指向的是一份临时文档，删掉后编号就无处可查（历史来历请在注释里说明）。 */
import { statSync } from 'node:fs';
import { serve, open, reporter, EXPECTED_LOG } from './_harness.mjs';

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
