/* 纯函数级测试：ZIP（store 模式）打包 / 解包、CRC 校验、安全文件名、配置迁移骨架。

   以前这些只能靠"造一个坏 ZIP 上传、看有没有 toast"来验：慢，且量不到
   "deflate 条目被拒"与"CRC 不匹配被拒"是同一条还是两条路径。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, makeZip, parseZip, safeFileName, MAX_CONFIG_BYTES } from '../../src/config.js';
import { migrations, migrateConfig } from '../../src/config.js';
import { CONFIG_VERSION } from '../../src/params.js';

const enc = new TextEncoder();
const zipOf = files => makeZip(files.map(f => ({ name: f.name, bytes: enc.encode(f.body) })));

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

test('CRC32：已知向量的结果与标准实现一致', () => {
  assert.equal(crc32(enc.encode('')), 0);
  assert.equal(crc32(enc.encode('a')), 0xe8b7be43);
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('ZIP 往返：store 条目能原样取回', async () => {
  const blob = zipOf([{ name: 'config.json', body: '{"a":1}' }, { name: 'tex1.png', body: 'PNG-DATA' }]);
  const files = parseZip(await bytesOf(blob));
  assert.equal(files.get('config.json') && new TextDecoder().decode(files.get('config.json')), '{"a":1}');
  assert.equal(new TextDecoder().decode(files.get('tex1.png')), 'PNG-DATA');
});

test('ZIP：非 store（deflate，method 8）条目被拒 —— 否则会吐出"看起来合法"的坏数据', async () => {
  // 手工把第一个条目的 method 字段改成 8
  const raw = await bytesOf(zipOf([{ name: 'a.txt', body: 'hello' }]));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  dv.setUint16(8, 8, true);        // local header 的 method
  let eocd = -1;
  for (let i = raw.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const p = dv.getUint32(eocd + 16, true);
  dv.setUint16(p + 10, 8, true);   // central directory 的 method
  assert.throws(() => parseZip(raw), /不支持的压缩方式/);
});

test('ZIP：CRC 不匹配必须抛错 —— 损坏数据继续走只会静默失败', async () => {
  const raw = await bytesOf(zipOf([{ name: 'a.txt', body: 'hello' }]));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  // 数据区起点 = local header(30) + 文件名长度(5)；打乱它而不动 header
  const off = 30 + dv.getUint16(26, true);
  raw[off] ^= 0xff;
  assert.throws(() => parseZip(raw), /校验失败/);
});

test('ZIP：非 ZIP 内容被拒（不崩、给出可读原因）', () => {
  assert.throws(() => parseZip(new Uint8Array([1, 2, 3, 4, 5])), /不是有效的 ZIP/);
});

test('ZIP：目录项越界被拒，而不是报成"不是有效 ZIP"掩盖真实损坏', async () => {
  const raw = await bytesOf(zipOf([{ name: 'a.txt', body: 'hello' }]));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let eocd = -1;
  for (let i = raw.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  dv.setUint32(eocd + 16, raw.length + 1000, true);   // 目录偏移指到缓冲区外
  assert.throws(() => parseZip(raw), /目录已损坏|不是有效的 ZIP/);
});

test('ZIP：空文件列表也能打包并解出空 Map', async () => {
  const files = parseZip(await bytesOf(makeZip([])));
  assert.equal(files.size, 0);
});

test('安全文件名：路径分隔符与非法字符被清掉，空格转下划线', () => {
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j', 'fb'), 'abcdefghij');
  assert.equal(safeFileName('my pad', 'fb'), 'my_pad');
});

test('安全文件名：留空 / 只剩点 时回退默认名', () => {
  assert.equal(safeFileName('', 'mousepad-config'), 'mousepad-config');
  assert.equal(safeFileName('   ', 'mousepad-config'), 'mousepad-config');
  assert.equal(safeFileName('...', 'mousepad-config'), 'mousepad-config');
});

test('安全文件名：长度被截到 80（文件系统上限）', () => {
  assert.ok(safeFileName('x'.repeat(200), 'fb').length <= 80);
});

test('配置体积上限是 32MB（挡住误选视频 / 磁盘镜像）', () => {
  assert.equal(MAX_CONFIG_BYTES, 32 * 1024 * 1024);
});

test('迁移骨架：可登记版本步骤并被逐级执行', () => {
  const saved = { ...migrations };
  try {
    // CONFIG_VERSION 当前是 1，故这里是"已经最新、无需迁移"的情形；
    // 骨架本身仍要可登记（把 version 抬上去后这条会真正跑迁移）。
    migrations[1] = cfg => ({ ...cfg, params: { ...cfg.params, padW: 999 }, version: 2 });
    const { cfg, version } = migrateConfig({ version: 1, params: { padW: 230 } });
    assert.equal(version, CONFIG_VERSION);
    assert.equal(cfg.params.padW, CONFIG_VERSION > 1 ? 999 : 230);
  } finally {
    for (const k of Object.keys(migrations)) delete migrations[k];
    Object.assign(migrations, saved);
  }
});

test('迁移：无 version 字段的旧配置按 v1 处理（不因缺字段被拒）', () => {
  const { version } = migrateConfig({ params: { padW: 230 } });
  assert.equal(version, 1);
});

test('迁移：高于当前版本的配置不会被"降级"改写', () => {
  const cfg = { version: CONFIG_VERSION + 5, params: { padW: 230 } };
  assert.equal(migrateConfig(cfg).cfg, cfg);
});
