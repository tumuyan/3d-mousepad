/* 配置（反）序列化：ZIP 打包 / 解包、配置版本迁移、安全文件名。纯逻辑，不 import three。 */

import { P, CONFIG_VERSION } from './params.js';

// 配置文件大小上限。base64 贴图内嵌时体积会膨胀约 1/3，32MB 足以容纳若干张大图，
// 同时挡住"误选了视频/磁盘镜像"这类会让页面卡死或 OOM 的输入。
export const MAX_CONFIG_BYTES = 32 * 1024 * 1024;

// —— 最小 ZIP（store 模式，无压缩，零依赖）+ CRC32 ——
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// 大数组安全转 base64（避免 String.fromCharCode(...大数组) 栈溢出）
export function b64FromBytes(u8) {
  let s = ''; const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(s);
}
// 将若干文件 [{name, bytes}] 打包成 store 模式 zip 的 Blob
export function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = f.bytes;
    const nameBytes = enc.encode(f.name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); // store
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    chunks.push(local);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true); cdv.setUint16(12, 0, true);
    cdv.setUint32(16, crc, true); cdv.setUint32(20, data.length, true); cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, nameBytes.length, true); cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true); cdv.setUint16(36, 0, true); cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length;
  }
  let centralSize = 0; central.forEach(c => centralSize += c.length);
  const centralOffset = offset;
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true); edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true); edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralOffset, true); edv.setUint16(20, 0, true);
  const blob = new Blob([...chunks, ...central, end], { type: 'application/zip' });
  return blob;
}
// 解析 store 模式 zip，返回 Map<name, Uint8Array>
export function parseZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  // 从末尾 EOCD 找 central directory 偏移
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const cdOffset = dv.getUint32(eocd + 16, true);
  let p = cdOffset;
  const count = dv.getUint16(eocd + 10, true);
  for (let i = 0; i < count; i++) {
    // 目录项头部定长 46 字节：先判越界再读。否则 p 越界会抛 RangeError，
    // 被上层 catch 后统一报成"不是有效的 ZIP 文件"，掩盖真实的目录损坏。
    if (p < 0 || p + 46 > bytes.length) throw new Error('ZIP 目录已损坏');
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    // P0-2：打包端只用 store（method 0），故 deflate(8) 等压缩条目一律拒绝。
    // 旧实现把它们当作原始字节直接吐出，上层会据此拼出"看起来合法"的 dataURL，
    // 解码在 <img> 内部失败且无 onError → 静默无贴图，却提示"配置已导入"。
    if (method !== 0) throw new Error(`ZIP 条目 "${name}" 使用了不支持的压缩方式（method=${method}）`);
    // 越界保护：localOffset / compSize 来自文件，可能把读指针指到缓冲区之外
    if (localOffset + 30 > bytes.length || localOffset < 0) throw new Error(`ZIP 条目 "${name}" 的偏移越界`);
    const ldv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dataOff = localOffset + 30 + ldv.getUint16(localOffset + 26, true) + ldv.getUint16(localOffset + 28, true);
    if (dataOff + compSize > bytes.length) throw new Error(`ZIP 条目 "${name}" 的数据越界`);
    const data = bytes.subarray(dataOff, dataOff + compSize);
    // CRC 失败必须抛错而不是 console.warn：损坏的数据继续走下去同样只会静默失败
    if (crc32(data) !== crc) throw new Error(`ZIP 条目 "${name}" 校验失败（文件已损坏）`);
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
// 贴图槽位 → 可内嵌进配置的数据（只认 data: URL，页面上拖来的 blob: 无法持久化）
export function texturePayload(slot, texOf) {
  const tex = texOf(slot);
  if (!tex || !tex.image || !tex.image.src || tex.image.src.indexOf('data:') !== 0) return null;
  const src = tex.image.src;
  const m = src.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  if (!m) return null;
  return { name: slot === 1 ? 'tex1' : 'tex2', mime: m[1], base64: m[2] };
}
export function serializeConfig(params, withTextures, texOf) {
  const cfg = { type: '3dm-config', version: CONFIG_VERSION, params };
  if (withTextures) {
    const t = [];
    const t1 = texturePayload(1, texOf), t2 = texturePayload(2, texOf);
    if (t1) t.push(t1); if (t2) t.push(t2);
    if (t.length) cfg.textures = t;
  }
  return cfg;
}
export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// 由配置名称生成安全文件名：去除路径分隔符等非法字符，空格转下划线；留空回退默认名
export function safeFileName(name, fallback) {
  const s = (name || '').trim();
  if (!s) return fallback;
  const cleaned = s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 80);
  return cleaned || fallback;
}

/* ---------- 配置格式迁移 ----------
   version 字段此前只在导入时提示一句"已尝试导入"，没有真正的迁移函数：
   旧配置一旦与新参数不同名（或单位变了），只能全字段回退默认值，等于丢设计。
   这里给出骨架：migrations 按 `from` 版本登记，逐级升到 CONFIG_VERSION。
   ⚠️ 迁移函数只做**字段改名 / 换算**这类确定性变换，不要读几何、不要触发 rebuild。
   ⚠️ 迁移失败必须抛错而不是"尽力继续"：半迁移的参数组合比拒绝导入更难排查。 */
export const migrations = {};

export function migrateConfig(cfg) {
  let v = Number(cfg && cfg.version);
  if (!Number.isFinite(v)) v = 1;
  let cur = cfg;
  while (v < CONFIG_VERSION) {
    const step = migrations[v];
    if (!step) break;                       // 缺迁移步骤：停在能到的最高版本，由校验兜底
    cur = step(cur);
    v++;
  }
  return { cfg: cur, version: v };
}
