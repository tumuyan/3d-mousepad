/* 纯函数级测试：导出图署名条的版式与二维码内容。

   署名条最容易坏的方式是"尺寸跟着导出倍率漂"：1x 看着正常、3x 导出时
   署名条细成一条线，或者反过来盖掉半个画面。版式全部是"图宽的百分比"，
   比例关系对了，倍率就自动对了 —— 这里把这些**比例关系**钉死，
   像素级的观感（真出图里有没有那条横幅）由 test/smoke-export.mjs 兜。

   ⚠️ 语言环境是模块级状态，本文件不碰 i18n。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerLayout, qrURL, HEADER_W_RATIO, QUIET_ZONE } from '../../src/exportHeader.js';

test('署名条高度按图宽折算，不按物理毫米', () => {
  const L = headerLayout();
  assert.equal(L.H, HEADER_W_RATIO);
  // 与毫米无关：模块里不该出现任何 mm 概念，比值也不随别的参数变
  assert.deepEqual(headerLayout(), L);
});

test('署名条整体的纵向占比落在合理区间（太低看不见、太高盖画面）', () => {
  const L = headerLayout();
  assert.ok(L.H > 0.05 && L.H < 0.2, `条高占比 ${L.H} 越界`);
});

test('二维码是正方形，完整落在署名条内且不越出右边界', () => {
  const L = headerLayout(29);
  assert.ok(L.qs > 0, '二维码边长必须为正');
  assert.ok(L.qx > 0, '二维码必须留出右侧内边距');
  assert.ok(Math.abs(L.qx + L.qs - (1 - 0.24 * L.H)) < 1e-9, '二维码右边距不等于 0.24H');
});

/* 静区（quiet zone）是这一轮的核心修正：二维码直接画在深色横幅上时，
   边缘黑模块与底色融成一片，定位图案找不到边界，扫码器整个读不出来。
   两条不变量：白底卡四周有真留白，且静区宽度符合 QR 标准的 ≥ 4 模块。 */
test('白底卡比二维码本体大出两倍静区（卡内四周真的留了白）', () => {
  const mods = 29;
  const L = headerLayout(mods);
  assert.ok(L.mod > 0, '模块边长必须为正');
  // 本体 = 模块数 × 模块边长；卡 = 本体 + 两侧静区
  assert.ok(Math.abs(L.qs - L.mod * mods) < 1e-12, '本体边长 must = 模块数 × 模块边长');
  assert.ok(L.card > L.qs, `白底卡 ${L.card} 没有比二维码本体 ${L.qs} 大`);
  assert.ok(Math.abs(L.card - (L.qs + 2 * QUIET_ZONE * L.mod)) < 1e-12, '卡边长 ≠ 本体 + 两倍静区');
});

test('静区宽度满足 QR 标准的 ≥ 4 模块', () => {
  assert.ok(QUIET_ZONE >= 4, `静区 ${QUIET_ZONE} 模块 < 4，扫码器不保证能定位`);
});

/* 卡片"装不下"是这一轮修的第二个毛病：静区宽度反比于模块数，21 模块时
   卡 = 本体 + 8 个静区模块 ≈ 条高的 0.86。卡若"定高"，短地址下就会顶穿条底，
   正好坐在那条品牌色分隔线上 —— 观感就是"画面被标题压住、贴得太紧"。
   这里把"卡在条里、且上下都有留白"钉成不变量，任何模块数都跑不掉。 */
test('白底卡在任何模块数下都装在署名条里，且上下都有留白', () => {
  for (const mods of [0, 21, 25, 29, 33, 41, 57, 77]) {
    const L = headerLayout(mods);
    const cardTop = L.qy - QUIET_ZONE * L.mod;
    const cardBottom = cardTop + L.card;
    assert.ok(cardTop > 0, `${mods} 模块：卡上边缘 ${cardTop} 贴顶了`);
    assert.ok(cardBottom < L.H - L.gap, `${mods} 模块：卡下边缘 ${cardBottom} 越过了留白带`);
    // 上下留白对称（卡在 [0, H-gap] 里竖直居中，与模块数无关）
    assert.ok(Math.abs(cardTop - (L.H - L.gap - L.rule - L.card) / 2) < 1e-12,
      `${mods} 模块：卡不在条内竖直居中`);
  }
});

test('卡片上下留白与二维码模块数无关（换地址不会让画面贴得更近）', () => {
  const top = mods => { const L = headerLayout(mods); return L.qy - QUIET_ZONE * L.mod; };
  assert.ok(Math.abs(top(21) - top(57)) < 1e-12, '卡上边缘随模块数漂了');
});

test('条底留白带（gap）+ 分隔线之外才是画面：留白必须是正的', () => {
  const L = headerLayout(29);
  assert.ok(L.gap > 0, '署名条与画面之间没有留白');
  assert.ok(L.gap < L.H * 0.5, `留白 ${L.gap} 吃掉了半个条高`);
  assert.ok(L.gap + L.rule + L.card <= L.H + 1e-12, '留白 + 分隔线 + 卡高越过了条高');
});

test('卡片横向也留得下（卡右缘不越出条内可用宽度）', () => {
  for (const mods of [0, 21, 29, 57]) {
    const L = headerLayout(mods);
    assert.ok(L.qx > L.xs + L.fs * 7, `${mods} 模块：二维码左缘 ${L.qx} 吃进了标题量级`);
    assert.ok(L.qx + L.qs < 1, `${mods} 模块：二维码本体越出右边界`);
  }
});

test('无二维码（库拉不到）时退回一个安全尺寸，不产出 0 宽的二维码区', () => {
  const L = headerLayout(0);
  assert.ok(L.qs > 0 && L.card > 0, '退化版式仍须给出正的方块尺寸');
  // 退化版式按"典型模块数"（29）给尺寸，绝不是 0 —— 0 会让卡塌成一条线
  assert.ok(L.mod > 0, '退化版式仍须给出正的模块边长');
});

test('软件名区与二维码区不重叠（左内边距 + 字号量级 < 二维码左缘）', () => {
  const L = headerLayout(29);
  assert.ok(L.xs > 0 && L.xs < L.qx, `左内边距 ${L.xs} 吃进了二维码左缘 ${L.qx}`);
  // 字号是"大概占多宽"的粗估基准：软件名两段加起来约 6~7 个字宽，
  // 只要 xs + 该量级仍小于 qx，常规标题就不会撞上二维码
  assert.ok(L.xs + L.fs * 7 < L.qx, `文字量级 ${L.xs + L.fs * 7} 已越过二维码左缘 ${L.qx}`);
});

test('字号与二维码都完整落在署名条内（上下不出界）', () => {
  const L = headerLayout(29);
  assert.ok(L.fs > 0 && L.fs < L.H, `字号 ${L.fs} 越界`);
  assert.ok(L.qy + L.qs < L.H, '二维码纵向越出署名条');
});


test('二维码内容丢锚点、保留查询参数（锚点是本页内的状态，不该进码）', () => {
  assert.equal(qrURL('https://x.y/z/index.html?a=1#frag'), 'https://x.y/z/index.html?a=1');
  assert.equal(qrURL('https://x.y/z/#a#b'), 'https://x.y/z/');
});

test('二维码内容拿到非法 URL 时原样返回（不抛，否则整张导出会失败）', () => {
  assert.equal(qrURL('not a url'), 'not a url');
  assert.equal(qrURL(''), '');
  assert.equal(qrURL(undefined), '');
});

