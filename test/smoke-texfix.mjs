/* 超尺寸贴图处理冒烟：上传超过 MAX_TEX_EDGE 的图片时，
   不再直接报错丢弃，而是弹出「裁剪 / 压缩」界面；确认后应用合规的新图，取消则不动槽位。

   本弹窗的尺寸语义（改代码前先看这里，容易踩）：
   - 默认 1:1 —— 不裁不压时按**原图像素**上传，旧实现无条件压到上限导致静默掉分辨率；
   - 裁剪框决定输出 —— 用户自己决定留多少，「裁多大就出多大」；
   - 长边裁剪滑条**单向**：只把输出按长边等比压小，往回拉不会放大（放大 = 凭空插值）；
     想撤销压缩用「1 : 1」按钮。刻度是**独立状态**（`tf.edge`），**不碰裁剪框** ——
     否则「裁剪」与「压缩」两段读数永远是同一个数，分段就白分了；
     量程 `[min(原图长边, 软上限), 原图长边]`，**最右端恒为 1:1 无损**；
   - 读数**分段**：`原图 → 裁剪 → 压缩`，每段只在"确实变小"时才出现
     （没裁就没「裁剪」段，没压就没「压缩」段）；
   - 上限 `MAX_TEX_EDGE` 是软上限：超出只是自动压缩 + 文案提示，不拦着用户。

   断言名一律自解释，**不要**用「P0-1」这类编号。 */
import zlib from 'node:zlib';
import { serve, open, reporter } from './_harness.mjs';

const server = await serve();
const { browser, page, errors } = await open(server);
const { ok, finish } = reporter('超尺寸贴图处理');

/* 生成一张 W×H 的 RGBA PNG：左半红、右半蓝，便于目视与像素判定。
   PNG 直接用 zlib 手搓（与 smoke-render 同一套最小封装），避免引入图像库。 */
function makePNG(W, H) {
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
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    const o = y * (W * 4 + 1); raw[o] = 0;           // filter: none
    for (let x = 0; x < W; x++) {
      const left = x < W / 2;
      raw[o + 1 + x * 4] = left ? 230 : 40;
      raw[o + 2 + x * 4] = 40;
      raw[o + 3 + x * 4] = left ? 20 : 200;
      raw[o + 4 + x * 4] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;                           // 8bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BIG = { name: 'big.png', mimeType: 'image/png', buffer: makePNG(3360, 4800) };
const SMALL = { name: 'small.png', mimeType: 'image/png', buffer: makePNG(300, 300) };
// 宽高比 != 1 的超尺寸图：滑条量程按"原图短边"封顶，只有非 1:1 的图才验得出。
// 横图用 4:3（若错误地按长边封顶，拉满恰好还是 4800×3600，看不出问题），
// 竖图用 3:4（按长边封顶会放大成 4800 高，一测就露），两张都留着。
const BIG43 = { name: 'big43.png', mimeType: 'image/png', buffer: makePNG(4800, 3600) };
const BIG34 = { name: 'big34.png', mimeType: 'image/png', buffer: makePNG(3600, 4800) };

// 弹窗内部状态（`tf` 是模块作用域变量，靠 window.tfState() 这个调试口子读）
const tfState = () => page.evaluate(() => window.tfState());
const modalOut = () => page.evaluate(() => document.getElementById('tfOut').textContent);
// 把「长边裁剪」滑条推到某个刻度（只压缩不放大；刻度是独立状态，不动裁剪框）
const setEdge = v => page.evaluate(v => {
  const s = document.getElementById('tfSize');
  s.value = String(v);
  s.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

let crashed = null;
try {
  ok('页面加载无 pageerror / console.error', errors.length === 0, errors.slice(0, 5).join(' | '));

  const modal = () => page.evaluate(() => {
    const el = document.getElementById('texFix');
    return {
      on: el.classList.contains('on'),
      dim: document.getElementById('tfDim').textContent,
      max: document.getElementById('tfMax').textContent,
      out: document.getElementById('tfOut').textContent,
    };
  });

  /* ---------- 超尺寸：弹出处理界面而不是直接报错 ---------- */
  await page.setInputFiles('#file1', BIG);
  await page.waitForTimeout(1200);
  const m1 = await modal();
  ok('超尺寸时弹出处理弹窗', m1.on, JSON.stringify(m1));
  ok('弹窗写明原始尺寸', /3360/.test(m1.dim) && /4800/.test(m1.dim), m1.dim);
  ok('弹窗写明上限', /4096/.test(m1.max), m1.max);
  ok('未弹出「加载失败」报错提示',
    await page.evaluate(() => !document.querySelector('.toast.err')), '');
  ok('此时槽位仍为空（处理未完成不写贴图）',
    await page.evaluate(() => !document.querySelector('#dz1 img')), '');
  // 默认 1:1：不裁不压就按原图像素走。旧实现无条件压到上限，用户白掉一半分辨率还不知道。
  // 默认刻度停在最右端（原图长边）= 不主动压缩，故没有「裁剪」段
  ok('默认不裁剪（读数没有「裁剪」段）', !/裁剪/.test(m1.out), m1.out);
  // 但 3360×4800 本身就超软上限（4096），于是仍会出现「压缩」段 —— 这是兜底，不是 bug
  ok('默认仍超软上限，读数给出「压缩」段说明已压到上限内',
    /^原图 3360 × 4800 px → 压缩 2867 × 4096 px，约/.test(m1.out), m1.out);
  ok('超软上限时读数标红', await page.evaluate(() =>
    document.getElementById('tfOut').classList.contains('bad')), m1.out);
  const st1 = await tfState();
  ok('默认刻度停在量程最右端（= 原图长边 4800，即不主动压缩）',
    st1.edge === 4800, JSON.stringify({ edge: st1.edge, final: st1.final }));
  const st0 = await tfState();
  ok('默认裁剪框即整图', st0.crop.w === 3360 && st0.crop.h === 4800, JSON.stringify(st0.crop));

  /* ---------- 裁剪：裁剪框多大，输出就多大（不缩放） ---------- */
  // 输出尺寸直接读状态，不从读数里抠 —— 读数里有「裁剪」「压缩」两段相似数字，
  // 用正则取段位很容易取错（实测先撞上「裁剪」段）。读数本身另有断言专测。
  const outW = async () => (await tfState()).final;
  // 读数里的「裁剪」段尺寸（没裁剪时为 null）
  const cropW = () => page.evaluate(() => {
    const m = /裁剪 (\d+) × (\d+)/.exec(document.getElementById('tfOut').textContent);
    return m ? { w: +m[1], h: +m[2] } : null;
  });
  const o1 = await outW();
  const se = await page.locator('#tfCrop .tf-h[data-dir=se]').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x - 110, se.y - 130, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const st2 = await tfState();
  const o2 = await outW();
  ok('拖动裁剪框后输出尺寸随之缩小',
    o2.w < o1.w && o2.h < o1.h, `${JSON.stringify(o1)} -> ${JSON.stringify(o2)}`);
  ok('输出尺寸 = 裁剪框原像素（1:1，不缩放）',
    o2.w === Math.round(st2.crop.w) && o2.h === Math.round(st2.crop.h),
    `output=${JSON.stringify(o2)} crop=${JSON.stringify(st2.crop)}`);
  ok('裁剪后读数出现「裁剪」段，其数字 = 裁剪框像素',
    (await cropW()) && (await cropW()).w === Math.round(st2.crop.w), await modalOut());
  ok('裁剪后（未压缩）读数段序为 原图 → 裁剪',
    /^原图 3360 × 4800 px → 裁剪 \d+ × \d+ px，约/.test(await modalOut()), await modalOut());

  /* ---------- 压缩：长边裁剪滑条 ---------- */
  // 先精确指定裁剪框（拖手柄量不出"恰好 3000×3000"这种整数，实测拖出来是 1568×2704）。
  // 3000×3000 的选择有讲究：长边 3000 < 上界 4800，故"裁剪段"与"压缩段"是两个不同的数，
  // 才能验出三段各就各位 —— 若裁剪尺寸恰好等于刻度，两段数字撞在一起，分段就测不出来了。
  const setCrop = (c) => page.evaluate(c => window.tfSetCrop(c), c);
  await setCrop({ x: 180, y: 0, w: 3000, h: 3000 });
  await page.waitForTimeout(150);
  const preCrop = await tfState();
  ok('（前置）裁剪框已设为 3000 × 3000',
    Math.round(preCrop.crop.w) === 3000 && Math.round(preCrop.crop.h) === 3000,
    JSON.stringify(preCrop.crop));

  const maxEdge = +await page.evaluate(() => document.getElementById('tfSize').max);
  const minEdge = +await page.evaluate(() => document.getElementById('tfSize').min);
  // 上界必须取**长边**：拉到最右才是"不压缩"；取短边的话 1:1 就得靠别的按钮找补
  ok('滑条量程上界 = 原图长边（最右端恒为 1:1 无损）', maxEdge === 4800, String(maxEdge));
  // 下界必须够到软上限以下：若取 min(长边, 上限)=4096，浏览器会把 1024 夹回 4096，
  // 滑条就成了摆设（实测）。取 1 才能压出任意合规尺寸。
  ok('滑条量程下界 = 1（够得到上限以下的任何刻度）', minEdge === 1, `${minEdge} / ${maxEdge}`);
  await setEdge(1024);
  await page.waitForTimeout(150);
  const o3 = await outW();
  ok('长边裁剪滑条生效（长边压到 1024）',
    Math.max(o3.w, o3.h) === 1024, JSON.stringify(o3));
  // 三段读数：裁剪段 = 用户裁的 3000×3000，压缩段 = 实际输出 1024×1024
  const m3 = await modalOut();
  const c3 = await tfState();
  ok('压缩时读数三段齐全且各就各位（原图 → 裁剪 → 压缩）',
    /^原图 3360 × 4800 px → 裁剪 3000 × 3000 px → 压缩 1024 × 1024 px，约/.test(m3), m3);
  // 关键：压缩**没有**动裁剪框，两段才是两个不同的数（旧实现把裁剪框一起压成 1024，分段白分）
  ok('压缩只改输出、不改裁剪框（裁剪框仍是用户裁的 3000 × 3000）',
    Math.round(c3.crop.w) === 3000 && Math.round(c3.crop.h) === 3000, JSON.stringify(c3.crop));
  // 滑条只管压小：往回拉不会放大（旧实现把"拉满"当成缩放基准，于是拖小之后再拉满 = 放大）
  await setEdge(maxEdge);
  await page.waitForTimeout(150);
  const o4 = await outW();
  ok('滑条往回拉不会放大（只能压小，放大是凭空插值）',
    o4.w === 3000 && o4.h === 3000, `${JSON.stringify(o3)} -> ${JSON.stringify(o4)}`);
  // 刻度回上界 = 撤销压缩，压缩段应整段消失
  ok('往回拉后压缩段消失，输出回到裁剪尺寸',
    /^原图 3360 × 4800 px → 裁剪 3000 × 3000 px，约/.test(await modalOut()), await modalOut());
  await setEdge(1024);
  await page.waitForTimeout(150);
  await page.click('#tfOrig');
  await page.waitForTimeout(150);
  const o4b = await outW();
  ok('「1 : 1」按钮把刻度复位到最右端，输出 = 裁剪尺寸（滑条只缩不放，此为唯一回退出口）',
    o4b.w === Math.round((await tfState()).crop.w) && o4b.h === Math.round((await tfState()).crop.h)
      && (await tfState()).edge === maxEdge, JSON.stringify(o4b));

  await page.selectOption('#tfFormat', 'image/jpeg');
  await page.waitForTimeout(150);
  ok('选 JPEG 时出现质量滑条',
    await page.evaluate(() => document.getElementById('tfQualityRow').style.display !== 'none'), '');

  /* ---------- 比例锁定 ---------- */
  await page.selectOption('#tfAspect', '1');
  await page.waitForTimeout(150);
  const ratio = await page.evaluate(() => {
    const r = document.getElementById('tfCrop').getBoundingClientRect();
    return +(r.width / r.height).toFixed(3);
  });
  ok('锁 1:1 后裁剪框为正方形（且未被边界夹变形）', Math.abs(ratio - 1) < 0.02, String(ratio));
  const sq = await tfState();
  ok('锁 1:1 后输出仍是裁剪框原像素',
    Math.abs(sq.crop.w - sq.crop.h) < 1, JSON.stringify(sq.crop));

  /* ---------- 全选 ---------- */
  await page.click('#tfFull');
  await page.waitForTimeout(150);
  // 上一步锁着 1:1，「全选」得到的是**内接正方形**而不是整图
  const stFull = await tfState();
  ok('锁比例下「全选」得到内接正方形（3360 × 3360），不是整图',
    Math.round(stFull.crop.w) === 3360 && Math.round(stFull.crop.h) === 3360,
    JSON.stringify(stFull.crop));
  // 3360 未超软上限，故**没有**压缩段，输出就是裁剪像素
  const oFull = await outW();
  ok('全选后输出尺寸 = 当前裁剪框像素（未超上限故无压缩段）',
    oFull.w === 3360 && oFull.h === 3360 && !/压缩 \d/.test(await modalOut()),
    JSON.stringify(oFull));
  // 未裁未压的读数分支：解锁比例 + 全选（与重开弹窗同一状态）
  await page.selectOption('#tfAspect', 'free');
  await page.waitForTimeout(100);
  await page.click('#tfFull');
  await page.waitForTimeout(150);
  ok('全选回整图后读数收起「裁剪」段（没裁就不该有这一段）',
    !/裁剪/.test(await modalOut()) && /^原图 3360 × 4800 px/.test(await modalOut()), await modalOut());
  // 全选之上再点 1:1，就是"什么都不动"（滑条已停在最右端）
  await page.click('#tfOrig');
  await page.waitForTimeout(150);
  ok('未裁未压时点「1 : 1」仍无「裁剪」段（刻度复位只影响压缩段）',
    /^原图 3360 × 4800 px/.test(await modalOut()) && !/裁剪/.test(await modalOut()), await modalOut());

  /* ---------- 软上限：不拦人，只提示会压缩 ---------- */
  const mBig = await page.evaluate(() => ({
    out: document.getElementById('tfOut').textContent,
    bad: document.getElementById('tfOut').classList.contains('bad'),
  }));
  ok('未裁未压且超限：读数无「裁剪」段，但有「压缩」段说明已压到上限内',
    !/裁剪/.test(mBig.out) && /压缩 2867 × 4096 px/.test(mBig.out), mBig.out);
  ok('超上限时标红（软上限只提示不拦人，应用仍可用）',
    mBig.bad && await page.evaluate(() => !document.getElementById('tfApply').disabled), mBig.out);

  /* ---------- 应用：写入合规贴图 + 预览 ---------- */
  await page.selectOption('#tfFormat', 'image/png');
  await page.click('#tfApply');
  await page.waitForTimeout(1200);
  const applied = await page.evaluate(() => ({
    on: document.getElementById('texFix').classList.contains('on'),
    preview: !!document.querySelector('#dz1 img'),
    // ⚠️ 不要把这个 src 放进断言 detail：它是 JPEG/PNG 的 dataURL，
    // 一打印就是几十 KB 的 base64，会把测试输出整个淹掉。
    isData: ((document.querySelector('#dz1 img') || {}).src || '').startsWith('data:image/'),
  }));
  ok('应用后弹窗关闭', !applied.on, `on=${applied.on}`);
  ok('应用后槽位出现预览', applied.preview && applied.isData, `preview=${applied.preview}`);
  const dim = await page.evaluate(() => new Promise(res => {
    const i = new Image();
    i.onload = () => res({ w: i.width, h: i.height });
    i.src = document.querySelector('#dz1 img').src;
  }));
  ok('应用的贴图为处理后的尺寸（不超过上限）', dim.w <= 4096 && dim.h <= 4096, JSON.stringify(dim));

  /* ---------- 取消：不留半截状态 ---------- */
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.setInputFiles('#file2', BIG);
  await page.waitForTimeout(1200);
  ok('腕托槽位同样能弹出处理界面', (await modal()).on, '');
  await page.click('#tfCancel');
  await page.waitForTimeout(400);
  const afterCancel = await page.evaluate(() => ({
    on: document.getElementById('texFix').classList.contains('on'),
    dz: !!document.querySelector('#dz2 img'),
    toast: (document.querySelector('.toast') || {}).textContent || '',
    isErr: !!document.querySelector('.toast.err'),
  }));
  ok('取消后弹窗关闭', !afterCancel.on, JSON.stringify(afterCancel));
  ok('取消后不写入贴图', !afterCancel.dz, '');
  ok('取消用普通提示而非报错', !afterCancel.isErr && /取消/.test(afterCancel.toast), afterCancel.toast);

  /* ---------- 非 1:1 原图：滑条拉满同样是 1:1，不会把图偷偷放大 ---------- */
  // 4:3 的图是最能暴露"滑条上界取长边"这个坑的形状：原图短边 3600 < 长边 4800，
  // 若上界取长边，拉到满就会得到 4800×3600 —— 比原图还大，纯属凭空插值。
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.setInputFiles('#file1', BIG43);
  await page.waitForTimeout(1200);
  const m43 = await modalOut();
  ok('4:3 超尺寸图默认不裁剪', !/裁剪/.test(m43), m43);
  const max43 = +await page.evaluate(() => document.getElementById('tfSize').max);
  ok('4:3 图滑条上界取原图长边 4800', max43 === 4800, String(max43));
  // 刚打开时未压缩，"滑条拉满"就是不动它（滑条已停在最右端）。
  // 这也是「上界取原图短边」的判据：若错取长边 4800，默认位置会落在中间，
  // 反而能把它"拉"到 4800 —— 即把图悄悄放大。
  // 长边 4800 超软上限 → 兜底压到 4096×3072，故这里读的是最终尺寸
  const o43 = await outW();
  ok('4:3 图默认未裁剪，仅被软上限兜底压到 4096 × 3072',
    o43.w === 4096 && o43.h === 3072, JSON.stringify(o43));
  const atMax = await page.evaluate(() =>
    document.getElementById('tfSize').value === document.getElementById('tfSize').max);
  ok('4:3 图打开时滑条已停在最右端（拉到满 = 不压缩）', atMax, '');
  await setEdge(1200);
  await page.waitForTimeout(150);
  const c43 = await outW();
  ok('4:3 图压缩保持比例', Math.abs(c43.w / c43.h - 4 / 3) < 0.02 && Math.max(c43.w, c43.h) === 1200,
    JSON.stringify(c43));
  // 被压小后不可逆：1:1 只能回到"当时裁剪框"的原尺寸 = 压缩后的尺寸，不会凭空还原原图
  await page.click('#tfOrig');
  await page.waitForTimeout(150);
  // 撤销压缩后回到"裁剪尺寸"，但 4800 仍超软上限，故最终仍是 4096×3072 ——
  // 要验的是"滑条不再起作用"，看 edge 复位比看尺寸更准
  const r43 = await outW();
  ok('1 : 1 撤销压缩后刻度复位、滑条不再缩小（尺寸受软上限兜底不变）',
    (await tfState()).edge === max43 && r43.w === 4096 && r43.h === 3072,
    JSON.stringify({ edge: (await tfState()).edge, final: r43 }));
  await page.click('#tfCancel');
  await page.waitForTimeout(300);

  /* ---------- 竖图：滑条拉满不得放大（3:4，长边封顶的写法会当场露馅） ---------- */
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.setInputFiles('#file1', BIG34);
  await page.waitForTimeout(1200);
  const max34 = +await page.evaluate(() => document.getElementById('tfSize').max);
  ok('竖图滑条上界取原图长边 4800', max34 === 4800, String(max34));
  const o34 = await outW();
  ok('竖图默认未裁剪，仅被软上限兜底压到 3072 × 4096',
    o34.w === 3072 && o34.h === 4096, JSON.stringify(o34));
  await setEdge(900);
  await page.waitForTimeout(150);
  const c34 = await outW();
  ok('竖图压缩后保持 3:4 比例且长边 = 900', c34.w === 675 && c34.h === 900, JSON.stringify(c34));
  await page.click('#tfCancel');
  await page.waitForTimeout(300);

  /* ---------- 小图不受影响 ---------- */
  await page.setInputFiles('#file1', SMALL);
  await page.waitForTimeout(800);
  ok('小图不触发弹窗且正常上传',
    await page.evaluate(() => !document.getElementById('texFix').classList.contains('on')
      && !!document.querySelector('#dz1 img')), '');

  /* ---------- 窄屏：控件不能把弹窗挤爆 ---------- */
  // 弹窗是阻塞式流程，窄屏下也必须能完整操作（参照 smoke-mobile 的视口档位）
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  await page.setInputFiles('#file1', BIG);
  await page.waitForTimeout(1200);
  const narrow = await page.evaluate(() => {
    const box = document.querySelector('.tf-box').getBoundingClientRect();
    const size = document.getElementById('tfSize').getBoundingClientRect();
    const orig = document.getElementById('tfOrig').getBoundingClientRect();
    return {
      on: document.getElementById('texFix').classList.contains('on'),
      boxW: Math.round(box.width), vw: window.innerWidth,
      stageH: Math.round(document.getElementById('tfStage').getBoundingClientRect().height),
      bodyH: Math.round(document.querySelector('.tf-body').scrollHeight),
      bodyVisible: Math.round(document.querySelector('.tf-body').clientHeight),
      sliderW: Math.round(size.width),
      origIn: orig.right <= box.right + 1 && orig.left >= box.left - 1,
    };
  });
  ok('窄屏下弹窗仍可打开且宽度不溢出', narrow.on && narrow.boxW <= narrow.vw - 20, JSON.stringify(narrow));
  ok('窄屏下裁剪画布仍有可用高度', narrow.stageH >= 120, String(narrow.stageH));
  ok('窄屏下「1 : 1」按钮未被挤出弹窗', narrow.origIn, JSON.stringify(narrow));
  ok('窄屏下滑条仍有可拖动宽度', narrow.sliderW >= 60, String(narrow.sliderW));
  const narrowInfo = await page.evaluate(() => {
    const r = document.querySelector('.tf-out').getBoundingClientRect();
    const box = document.querySelector('.tf-box').getBoundingClientRect();
    return { outBottom: Math.round(r.bottom), boxBottom: Math.round(box.bottom),
      outRight: Math.round(r.right), boxRight: Math.round(box.right) };
  });
  ok('窄屏下读数行不横向溢出弹窗',
    narrowInfo.outRight <= narrowInfo.boxRight + 1, JSON.stringify(narrowInfo));
  await page.click('#tfCancel');
  await page.waitForTimeout(300);

  /* ---------- 未捕获错误 ---------- */
  // 故意喂坏输入会产生 console.error（已配用户可见提示），与 EXPECTED_LOG 的约定一致
  const unexpected = errors.filter(e => !/\[贴图加载失败\]|\[读取文件失败\]/.test(e));
  ok('全程无非预期未捕获错误', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
} catch (e) {
  crashed = e;
} finally {
  await browser.close();
  await server.stop();
}
process.exit(finish(crashed));
