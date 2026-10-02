/* 国际化与本地保存的冒烟验证。

   为什么要单独一个脚本（而不是塞进 smoke-render）：
     · 切语言是**全局状态**，与画面像素比对混在一个页面里会互相污染
       （切完语言所有 label 都变了，按文案找控件的断言会集体失效）；
     · 槽位用例要写 localStorage / IndexedDB，会留下草稿，
       后面的脚本若复用到同一个 profile 就会"凭空恢复出上次的参数"。
   Playwright 的 context 是隔离的，正好各跑各的。

   纯函数部分（词典齐不齐、ZIP 对不对）不在这里 —— 见 test/unit/。 */
import { serve, open, reporter, EXPECTED_LOG } from './_harness.mjs';

const server = await serve();
const { browser, page, errors } = await open(server);
const { ok, finish } = reporter('国际化与本地保存');

let crashed = null;
try {
  /* ---------- i18n：默认语言 ---------- */
  const zh = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    shape: [...document.querySelectorAll('#shapeCtrls .row label')].map(l => l.textContent),
    tb: document.querySelector('#toolbar .tb-left .dd-btn').textContent,
    slot: document.querySelector('#slotList .hint')?.textContent,
    dz: document.getElementById('dz1').textContent,
  }));
  ok('默认按 zh-CN 渲染（冒烟脚本按中文文案找控件，语言错了会集体失效）',
    zh.lang === 'zh-CN', zh.lang);
  ok('参数面板标签是中文', zh.shape.includes('基础宽度'), zh.shape.slice(0, 4).join(' / '));
  ok('工具栏按钮是中文', /导出图片/.test(zh.tb), zh.tb);

  /* ---------- 界面上不出现原始 key（缺词时 t() 返回 key 本身） ---------- */
  const rawKeys = await page.evaluate(() => {
    const bad = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = (n.nodeValue || '').trim();
      // 只挑"长得像 key"的：两段点分小写英文，如 panel.shape / ctl.padW
      if (/^[a-z]+(\.[a-zA-Z]+){1,2}$/.test(s)) bad.push(s);
    }
    return bad;
  });
  ok('界面上没有裸露的 i18n key（缺词会在页面上直接显示 key）',
    rawKeys.length === 0, rawKeys.slice(0, 8).join(' | '));

  /* ---------- 切到英文 ---------- */
  await page.click('#langBtn');
  await page.waitForTimeout(400);
  const en = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    shape: [...document.querySelectorAll('#shapeCtrls .row label')].map(l => l.textContent),
    tb: document.querySelector('#toolbar .tb-left .dd-btn').textContent,
    btn: document.getElementById('langBtn').textContent,
    dz: document.getElementById('dz1').textContent,
    saveBtn: document.getElementById('slotSave').textContent,
    // 悬停说明也要跟着换
    note: [...document.querySelectorAll('#shapeCtrls .row[title]')].map(r => r.title)[0],
  }));
  ok('切换后 <html lang> 跟着变', en.lang === 'en', en.lang);
  ok('参数面板标签变为英文', en.shape.includes('Base width'), en.shape.slice(0, 4).join(' / '));
  ok('工具栏按钮变为英文', /Export image/i.test(en.tb), en.tb);
  ok('上传占位文案变为英文', /Click to upload/i.test(en.dz), en.dz.slice(0, 40));
  ok('语言按钮显示的是"切回去"的那种语言', en.btn === '中文', en.btn);
  ok('槽位「保存」按钮变为英文', /Save/i.test(en.saveBtn), en.saveBtn);
  ok('滑条悬停说明也变为英文（note 走的是 i18n 而非写死）',
    !!en.note && /mm/.test(en.note) && !/[一-鿿]/.test(en.note), (en.note || '').slice(0, 60));

  /* ---------- 切语言不动参数、不动几何 ---------- */
  const geoBefore = await page.evaluate(() => window.padGeoInfo());
  const pBefore = await page.evaluate(() => JSON.stringify(window.__geoState()));
  await page.click('#langBtn');
  await page.waitForTimeout(400);
  const geoAfter = await page.evaluate(() => window.padGeoInfo());
  const pAfter = await page.evaluate(() => JSON.stringify(window.__geoState()));
  ok('切回中文：标签恢复', await page.evaluate(() =>
    [...document.querySelectorAll('#shapeCtrls .row label')].some(l => l.textContent === '基础宽度')));
  ok('切换语言不重建几何（顶点数与参数都不变）',
    geoBefore && geoAfter && geoBefore.verts === geoAfter.verts && pBefore === pAfter,
    `verts ${geoBefore?.verts} → ${geoAfter?.verts}`);

  /* ---------- 语言偏好被记住 ---------- */
  await page.click('#langBtn');       // → en
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3600);
  const afterReload = await page.evaluate(() => document.documentElement.lang);
  ok('刷新后仍是上次选的语言（偏好写进了 localStorage）', afterReload === 'en', afterReload);
  await page.evaluate(() => localStorage.removeItem('3dm.lang'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3600);

  /* ---------- 自动草稿 ---------- */
  const setSlider = (label, v) => page.evaluate(({ label, v }) => {
    const row = [...document.querySelectorAll('#panel .row')]
      .find(r => r.querySelector('label')?.textContent === label);
    const inp = row.querySelector('input[type=range]');
    inp.value = String(v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, { label, v });

  await setSlider('基础厚度', 6);
  await page.waitForTimeout(1200);      // 防抖 600ms
  const draft = await page.evaluate(() => {
    const s = localStorage.getItem('3dm.draft.v1');
    return s ? JSON.parse(s).thick : null;
  });
  ok('改参数后自动草稿已落盘', draft === 6, `draft.thick=${draft}`);

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3600);
  const restored = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#shapeCtrls .row')]
      .find(r => r.querySelector('label')?.textContent === '基础厚度');
    return {
      dom: row.querySelector('input[type=range]').value,
      toast: [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent).join(' || '),
    };
  });
  ok('刷新后草稿被恢复（滑条读数也是恢复后的值，不是默认）', restored.dom === '6',
    `滑条=${restored.dom}`);
  ok('恢复草稿时给出提示（否则用户不知道画面为什么不是默认）',
    /已恢复|Restored/i.test(restored.toast), restored.toast);

  /* ---------- 方案槽位 ---------- */
  await setSlider('基础厚度', 8);
  await page.waitForTimeout(900);
  await page.evaluate(() => { document.getElementById('slotName').value = '方案A'; });
  await page.click('#slotSave');
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => ({
    names: [...document.querySelectorAll('#slotList .slot-name')].map(n => n.textContent),
    toast: [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent).join(' || '),
  }));
  ok('保存后方案出现在列表里', saved.names.includes('方案A'), saved.names.join(' / '));
  ok('保存成功有提示', /已保存|Saved/i.test(saved.toast), saved.toast);

  // 改坏参数，再载入方案 → 应回到保存时的值
  await setSlider('基础厚度', 2);
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#slotList .slot-row')];
    const row = rows.find(r => r.querySelector('.slot-name').textContent === '方案A');
    [...row.querySelectorAll('button')].find(b => /载入|Load/i.test(b.textContent)).click();
  });
  await page.waitForTimeout(900);
  const loaded = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#shapeCtrls .row')]
      .find(r => r.querySelector('label')?.textContent === '基础厚度');
    return row.querySelector('input[type=range]').value;
  });
  ok('载入方案后参数回到保存时的值', loaded === '8', `滑条=${loaded}`);

  // 删除
  page.on('dialog', d => d.accept());
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#slotList .slot-row')]
      .find(r => r.querySelector('.slot-name').textContent === '方案A');
    [...row.querySelectorAll('button')].find(b => /删除|Delete/i.test(b.textContent)).click();
  });
  await page.waitForTimeout(700);
  const afterDel = await page.evaluate(() =>
    [...document.querySelectorAll('#slotList .slot-name')].map(n => n.textContent));
  ok('删除后方案从列表消失', !afterDel.includes('方案A'), afterDel.join(' / '));

  /* ---------- 空态 ---------- */
  const empty = await page.evaluate(() => document.querySelector('#slotList .hint')?.textContent);
  ok('没有方案时给出空态说明（不是一片空白）', !!empty && empty.length > 0, empty || '');

  const final = errors.filter(e => !EXPECTED_LOG.test(e));
  ok('无意外未捕获错误', final.length === 0, final.slice(0, 4).join(' | '));
} catch (e) {
  crashed = e;   // 只记录不重抛：finally 收尾后仍要打印已完成的断言清单
} finally {
  await browser.close();
  await server.stop();
}
process.exit(finish(crashed));
