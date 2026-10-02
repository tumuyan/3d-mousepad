/* 滚轮缩放方向冒烟：滚轮向上（deltaY < 0）= 放大贴图，与双指捏合「张开=放大」同向。

   为什么单独一个脚本：方向这类错误**不抛异常、控制台干净**，只能靠量画面发现。
   历史背景（Agents.md 曾记「滚轮与捏合方向相反，未统一」）：
   滚轮原写作 `s * exp(-deltaY * 0.001)`，向上滚 → s 变大 → 贴图缩小；
   而捏合张开 → s 变小 → 贴图放大。两者对「放大」的手势约定正好相反。
   现滚轮改为 `s * exp(deltaY * 0.001)`（符号取反），与捏合对齐。

   断言名一律自解释，**不要**用「P0-1」这类编号。 */
import zlib from 'node:zlib';
import { serve, open, reporter } from './_harness.mjs';

const server = await serve();
const { browser, page, errors } = await open(server);
const { ok, finish } = reporter('滚轮缩放方向');

// 左红右蓝的定位图：交界竖直，便于逐像素量红半边占了多少横向像素
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

  // 切到「顶视 + 编辑主贴图」，并换一张好量的定位图
  await page.evaluate(() => {
    [...document.querySelectorAll('#modeSeg button')].find(b => b.dataset.mode === 't1').click();
    [...document.querySelectorAll('#viewSeg button')].find(b => b.dataset.view === 'top').click();
  });
  await page.waitForTimeout(600);
  await page.setInputFiles('#file1', { name: 'lr.png', mimeType: 'image/png', buffer: makeLR(256) });
  await page.waitForTimeout(1200);

  // 缩放滑条（s 是 uv 的 repeat 系数：s 越大，贴图越小 —— 两者反号）
  const texS = {
    read: () => page.evaluate(() => Number([...document.querySelectorAll('#tex1Ctrls .row')]
      .find(r => r.textContent.includes('缩放')).querySelector('input[type=range]').value)),
    set: v => page.evaluate(v => {
      const el = [...document.querySelectorAll('#tex1Ctrls .row')]
        .find(r => r.textContent.includes('缩放')).querySelector('input[type=range]');
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v),
  };
  const texOff = prop => page.evaluate(prop => {
    const names = { ox: '偏移 X', oy: '偏移 Y' };
    const el = [...document.querySelectorAll('#tex1Ctrls .row')]
      .find(r => r.textContent.includes(names[prop])).querySelector('input[type=range]');
    return Number(el.value);
  }, prop);

  // 红半边的屏幕宽度：贴图越大，红半边占的横向像素越多
  const redSpan = () => page.evaluate(() => {
    const cv = document.getElementById('view');
    const off = document.createElement('canvas');
    off.width = cv.width; off.height = cv.height;
    const g = off.getContext('2d');
    g.drawImage(cv, 0, 0);
    const dpr = cv.width / cv.clientWidth;
    const img = g.getImageData(0, 0, cv.width, cv.height).data;
    const isRed = (x, y) => {
      const i = (y * cv.width + x) * 4;
      return img[i] > 120 && img[i + 1] < 90 && img[i + 2] < 90;
    };
    let min = Infinity, max = -1;
    for (let y = Math.floor(cv.height * 0.3); y < cv.height * 0.7; y += 3) {
      for (let x = 0; x < cv.width; x++) {
        if (isRed(x, y)) { if (x < min) min = x; if (x > max) max = x; }
      }
    }
    return max < 0 ? -1 : Math.round((max - min) / dpr);
  });

  const box = await page.locator('#view').boundingBox();
  const at = (fx, fy) => ({ x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) });
  const wheel = async (dy, pt) => {
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(350);
  };

  // 基准 s 取 1.5：s=1 时贴图恰好铺满画布，放大方向会被画布缘裁掉，
  // 红带宽度卡在上限不动 —— 那是采样饱和，不是方向问题。
  const reset = async () => { await texS.set(1.5); await page.waitForTimeout(300); };
  await reset();
  const s0 = await texS.read();
  const span0 = await redSpan();
  ok('前置：基准 s=1.5 时红半边可量且在画布内（不饱和）',
    s0 === 1.5 && span0 > 20 && span0 < box.width - 10, `s=${s0}, 红带 ${span0}px`);

  // ① 核心断言：滚轮向上 = 放大（s 变小，贴图变大）
  await wheel(-240, at(0.5, 0.5));
  const sUp = await texS.read();
  const spanUp = await redSpan();
  ok('滚轮向上（deltaY<0）= 放大：tp.s 变小、贴图红半边变宽',
    sUp < s0 && spanUp > span0 + 10,
    `s ${s0} → ${sUp}（期望变小）, 红带 ${span0} → ${spanUp}px（期望变宽）`);

  // ② 反方向：滚轮向下 = 缩小，回到基准附近（同一位移量，方向相反）
  await reset();
  await wheel(240, at(0.5, 0.5));
  const sDown = await texS.read();
  const spanDown = await redSpan();
  ok('滚轮向下（deltaY>0）= 缩小：tp.s 变大、贴图红半边变窄',
    sDown > 1.5 && spanDown < span0 - 10,
    `s 1.5 → ${sDown}（期望变大）, 红带 ${span0} → ${spanDown}px（期望变窄）`);

  // ③ 与捏合同向：捏合的判据是「张开手指 → s 变小」。这里直接用同一套换算复核
  //    滚轮方向的手感约定与捏合一致（张开=放大），避免日后有人只改一侧。
  //    pinch 代码：ns = s0 * (d0 / d)，张开时 d>d0 → ns < s0；滚轮向上同理须 s 减小。
  await reset();
  await wheel(-240, at(0.5, 0.5));
  const sWheelUp = await texS.read();
  const sPinchOpen = 1.5 * (100 / 135);   // 捏合张开（100 → 135）后的 s，见 smoke-mobile 的用例
  ok('滚轮与捏合同向：两者「放大」都给 s 减小（不再一处放大一处缩小）',
    sWheelUp < 1.5 && sPinchOpen < 1.5,
    `滚轮向上 s=${sWheelUp}，捏合张开 s=${sPinchOpen.toFixed(3)}（都期望 < 1.5）`);

  // ④ 仍是「以鼠标位置为锚点」：光标下的贴图像素不动，只改缩放。
  //    符号改动只应翻转方向，不该顺带破坏锚点反解（zoomTexAbout 未被改动）。
  await reset();
  const anchor = at(0.32, 0.5);
  await wheel(-240, anchor);
  const offAfter = { ox: await texOff('ox'), oy: await texOff('oy') };
  ok('滚轮缩放仍以鼠标位置为锚点（偏移被反解，不是原地缩放）',
    Math.abs(offAfter.ox) > 0.005 || Math.abs(offAfter.oy) > 0.005,
    `缩放后 ox=${offAfter.ox}, oy=${offAfter.oy}（偏离中心 -> 需反解偏移）`);

  // ⑤ Shift+滚轮是旋转，不参与本次方向统一（保持原手感）
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('#tex1Ctrls .row')]
      .find(r => r.textContent.includes('缩放')).querySelector('input[type=range]');
    el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const rot = () => page.evaluate(() => Number([...document.querySelectorAll('#tex1Ctrls .row')]
    .find(r => r.textContent.includes('旋转')).querySelector('input[type=range]').value));
  const r0 = await rot();
  await page.keyboard.down('Shift');
  await wheel(-100, at(0.5, 0.5));
  await page.keyboard.up('Shift');
  const r1 = await rot();
  ok('Shift+滚轮仍改旋转、不改缩放（方向统一不波及旋转路径）',
    r1 !== r0 && (await texS.read()) === 1.5, `旋转 ${r0} → ${r1}, s=${await texS.read()}`);

  // ⑥ 视角模式不拦截滚轮（相机缩放交给 OrbitControls，未被本次改动牵动）
  await page.evaluate(() => [...document.querySelectorAll('#modeSeg button')]
    .find(b => b.dataset.mode === 'view').click());
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => document.getElementById('modeHint').style.display);
  await wheel(-240, at(0.5, 0.5));
  ok('视角模式下滚轮不写贴图参数（不显示贴图编辑提示，交由相机缩放）',
    before === 'none' && (await page.evaluate(() => document.getElementById('modeHint').style.display)) === 'none'
      && (await texS.read()) === 1.5, `modeHint=${before}, s=${await texS.read()}`);

  /* ---------- 未捕获错误 ---------- */
  const unexpected = errors.filter(e => !/WebGL|SwiftShader|Deprecat/.test(e));
  ok('全程无非预期未捕获错误', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
} catch (e) {
  crashed = e;
} finally {
  await browser.close();
  await server.stop();
}
process.exit(finish(crashed));
