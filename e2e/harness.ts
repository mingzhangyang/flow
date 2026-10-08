// UI 回归（e2e）的公共骨架：静态伺服 `expo export` 的 web 构建 + playwright-core 驱动
// headless Chromium。与契约测试同一运行器（node --test），先 `npm run build:web`。
//
// 确定性与宪章同一思路（E3/E4）：时间用 Playwright 的假时钟固定注入（FIXED_NOW），
// 时区固定 Asia/Shanghai，语言固定 zh-CN——用例断言简体文案，不受宿主环境影响。

import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type LaunchOptions } from 'playwright-core';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

/** 固定「现在」：2026-07-15（周三）09:00，Asia/Shanghai。09:00 时 08:00 剂在宽限期内（due）。 */
export const FIXED_NOW = Date.parse('2026-07-15T09:00:00+08:00');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** 伺服 dist 的最小静态服务器（SPA 回退到 index.html）；端口 0 = 随机，可并行。 */
function serveDist(): Promise<{ server: http.Server; baseUrl: string }> {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist/ 不存在——先运行 `npm run build:web`（test:e2e 脚本已包含）');
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST) || !existsSync(file) || url.pathname === '/') {
      file = path.join(DIST, 'index.html');
    }
    readFile(file)
      .then((body) => {
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404);
        res.end();
      });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/**
 * 浏览器选择（playwright-core 不自带浏览器）：
 * E2E_CHROMIUM 显式指定 > playwright 登记目录里已有的 > /opt/pw-browsers/chromium（托管容器）>
 * 系统 Chrome（GitHub Actions 运行器预装）。
 */
function launchOptions(): LaunchOptions {
  if (process.env.E2E_CHROMIUM) return { executablePath: process.env.E2E_CHROMIUM };
  try {
    if (existsSync(chromium.executablePath())) return {};
  } catch {
    // registry 未安装——继续向下找
  }
  if (existsSync('/opt/pw-browsers/chromium')) return { executablePath: '/opt/pw-browsers/chromium' };
  return { channel: 'chrome' };
}

export interface OpenAppOptions {
  /** 浏览器 locale（决定应用语言）。默认 zh-CN。 */
  locale?: string;
  /** 等待首页就绪所用的品牌字样（随语言而变）。默认「准时」。 */
  brand?: string;
  /** 视口（CSS 像素）。截图脚本用手机视口；测试用默认桌面视口。 */
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  /** Accessibility preference injected before the app loads. */
  reducedMotion?: 'reduce' | 'no-preference';
  /** Simulated platform faults / test-only adapters, injected before app module loads. */
  initScripts?: string[];
}

export interface E2E {
  baseUrl: string;
  browser: Browser;
  /** 新开一个隔离环境（独立 localStorage）并打开首页（假时钟已注入，品牌已可见）。 */
  openApp(opts?: OpenAppOptions): Promise<Page>;
  close(): Promise<void>;
}

export async function startE2E(): Promise<E2E> {
  const { server, baseUrl } = await serveDist();
  const browser = await chromium.launch(launchOptions());
  const contexts: BrowserContext[] = [];

  return {
    baseUrl,
    browser,
    async openApp(opts?: OpenAppOptions) {
      const context = await browser.newContext({
        locale: opts?.locale ?? 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        permissions: ['clipboard-read', 'clipboard-write'],
        ...(opts?.viewport ? { viewport: opts.viewport } : {}),
        ...(opts?.deviceScaleFactor ? { deviceScaleFactor: opts.deviceScaleFactor } : {}),
        ...(opts?.reducedMotion ? { reducedMotion: opts.reducedMotion } : {}),
      });
      contexts.push(context);
      for (const script of opts?.initScripts ?? []) await context.addInitScript({ content: script });
      const page = await context.newPage();
      await page.clock.install({ time: FIXED_NOW });
      await page.goto(baseUrl);
      await page.getByText(opts?.brand ?? '准时', { exact: true }).waitFor({ timeout: 30_000 });
      return page;
    },
    async close() {
      for (const context of contexts) await context.close().catch(() => {});
      await browser.close().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** 断言某文本在页面上（默认 10s 内出现）。 */
export async function expectText(page: Page, text: string | RegExp, timeout = 10_000): Promise<void> {
  await page.getByText(text).first().waitFor({ timeout });
}
