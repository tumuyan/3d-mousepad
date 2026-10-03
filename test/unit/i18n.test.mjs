/* 纯函数级测试：词典完整性。

   i18n 最容易坏的方式是"翻译了一半"：加新文案时只补了 zh，en 里缺词，
   界面上就冒出 `panel.shape` 这种原始 key。这类问题在浏览器里要靠"切一次语言、
   肉眼扫一遍全界面"才能发现 —— 这里用两条断言一次性钉死。

   ⚠️ 语言环境是模块级状态（localStorage / navigator 在 node 里不存在），
      故本文件的用例顺序有依赖：先测缺词，再测切换。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, initLang, getLang, setLang, otherLang, t, has, keysOf } from '../../src/i18n.js';

// 提供一个假的 localStorage 供 initLang / setLang 使用
const memStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test('词典里 zh 与 en 的 key 完全一致（缺词会在界面上露出原始 key）', () => {
  const base = new Set(keysOf('zh'));
  assert.ok(base.size > 100, `词条太少：${base.size}`);
  for (const l of LANGS) {
    if (l === 'zh') continue;
    const other = new Set(keysOf(l));
    const missing = [...base].filter(k => !other.has(k));
    const extra = [...other].filter(k => !base.has(k));
    assert.deepEqual(missing, [], `${l} 缺词：${missing.slice(0, 10).join(', ')}`);
    assert.deepEqual(extra, [], `${l} 多出未登记的词条：${extra.slice(0, 10).join(', ')}`);
  }
});

test('每条文案都不是空串（空串在界面上等于"这里本该有字但没了"）', () => {
  for (const l of LANGS) for (const k of keysOf(l)) {
    assert.ok(String(t(k)).length > 0 || l !== getLang(), `${l}/${k} 是空串`);
  }
});

test('切换语言后取到的是另一种语言的文案', () => {
  const store = memStore();
  const start = getLang();
  try {
    const other = otherLang();
    const before = t('panel.shape');
    setLang(other, store);
    const after = t('panel.shape');
    assert.notEqual(after, before);
    assert.equal(getLang(), other);
  } finally {
    setLang(start, store);
  }
});

test('切到同一语言是无操作（不重复触发刷新）', () => {
  const cur = getLang();
  assert.equal(setLang(cur, memStore()), cur);
});

test('缺词时返回 key 本身 —— 比半截翻译更显眼，便于立刻发现', () => {
  assert.equal(t('this.key.does.not.exist'), 'this.key.does.not.exist');
});

test('占位符替换：{name} 之类的变量会被填上', () => {
  const cur = getLang();
  try {
    setLang('zh', null);
    assert.equal(t('save.saved', { name: 'X' }), '已保存为「X」');
    assert.equal(t('cfg.importedTexFail', { n: 3 }), '配置已导入，但有 3 张贴图加载失败');
  } finally { setLang(cur, null); }
});

test('缺占位符变量时保留原始 {name} 而不是渲染成 undefined', () => {
  assert.match(t('save.saved'), /\{name\}/);
});

test('initLang：存过的语言优先于 navigator.language', () => {
  const store = memStore();
  store.setItem('3dm.lang', 'en');
  assert.equal(initLang(store), 'en');
});

test('initLang：存储不可用时也不抛（隐私模式）', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.ok(LANGS.includes(initLang(bad)));
});

test('setLang：写入存储失败不影响切换本身（配额满 / 隐私模式）', () => {
  const bad = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const cur = getLang();
  try {
    // ⚠️ otherLang() 只能先算一次：setLang 之后它返回的就是"切回去"的方向了
    const target = otherLang();
    assert.equal(setLang(target, bad), target);
    assert.equal(getLang(), target);
  } finally { setLang(cur, null); }
});
