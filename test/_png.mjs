/* PNG 最小读取器：只依赖 node:zlib，不引第三方。

   为什么需要它：署名条的断言要落到**像素**上 —— 「导出图顶部确实多了一条
   深底 + 白字 + 品牌粉 + 右上角白底黑块」，这句话在字节级没法验，在截图级
   又会被 Playwright 的截图编码差异干扰。直接解 PNG 最稳，也最快。

   ⚠️ 只支持 8bit RGBA、无隔行（浏览器 `toDataURL('image/png')` 的产物）。
      够本仓库用，不打算做通用解码器。 */

// PNG 签名 8 字节 + 长度 4 + 'IHDR' 4，宽高各 4 字节
import zlib from 'node:zlib';

export function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// 解出整张位图（含 PNG 的四种行过滤器还原）
export function pngPixels(buf) {
  const { w, h } = pngSize(buf);
  let off = 8, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const dst = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? dst[x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      dst[x] = v & 0xff;
    }
  }
  return {
    w, h, data: out,
    at(x, y) { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2], out[i + 3]]; },
  };
}

/* 统计某区域内满足判定的像素数。默认步长 3：署名条动辄几百万像素，
   逐点扫在主线程上是可感知的开销，而"有没有白字 / 有没有品牌粉"这种
   存在性判定不需要全采样。 */
export function countPixels(px, { x0 = 0, y0 = 0, x1 = px.w, y1 = px.h, step = 3 }, test) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x += step) if (test(px.at(x, y))) n++;
  return n;
}
