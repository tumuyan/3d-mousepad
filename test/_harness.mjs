/* 冒烟测试公共装置：起本地静态服务、启动浏览器、收集断言与页面错误。
   两个 smoke 脚本共用，避免重复约 60 行样板。

   设计要点：
   - 自举静态服务 + 随机端口：不要求用户先 `npm run serve`，也不会与已在跑的
     server.js（5213）抢端口 —— 端口传 0 由内核分配空闲端口。
   - SwiftShader 软件渲染：无 GPU 的容器 / CI 也能跑，代价是慢（单次约 1 分钟）。
   - 测试只服务仓库根目录。index.html 依赖 CDN 加载 Three.js，故仍需联网。   */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

export async function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    // 目录穿越防护：解析后必须仍在 ROOT 内
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    stop: () => new Promise(r => server.close(r)),
  };
}

export async function open(server, { initScript } = {}) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForTimeout(3500);   // 等 CDN 加载 + 首页渲染稳定
  // 控制面板默认折叠，**折叠区内的控件没有有效位置**（locator 会一直等到超时），
  // 所有脚本都得先展开。放进 harness 里统一做，避免某个脚本漏掉。
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  return { browser, page, errors };
}

export function reporter(title) {
  const results = [];
  const ok = (n, pass, detail = '') => results.push({ n, pass: !!pass, detail });
  const finish = () => {
    console.log(`\n============ ${title} ============`);
    let fail = 0;
    for (const r of results) {
      if (!r.pass) fail++;
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.detail ? '\n        ' + r.detail : ''}`);
    }
    console.log(`\n${results.length - fail}/${results.length} 通过`);
    return fail;
  };
  return { ok, finish };
}

/* 页面里这些 console.error 是**刻意保留**的排查线索，每条都配了用户可见的 toast
   （断言里已单独验证 toast），不应算作"意外错误"让测试失败。
   ⚠️ 新增"故意喂坏输入"的用例时，若页面会打新的 console.error，要同步加进这里。 */
export const EXPECTED_LOG =
  /WebGL|SwiftShader|Deprecat|\[导入配置\]|\[贴图加载失败\]|\[读取文件失败\]|\[导出模型\]|\[导出预览图\]|\[导出模型渲染图\]/;
