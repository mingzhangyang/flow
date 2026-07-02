// SVG → PNG 渲染（Chromium 截图；透明底用 omitBackground）。
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const jobs = [
  { svg: 'icon.svg', out: 'icon.png', w: 1024, h: 1024, alpha: false },
  { svg: 'adaptive-foreground.svg', out: 'android-icon-foreground.png', w: 512, h: 512, alpha: true },
  { svg: 'adaptive-background.svg', out: 'android-icon-background.png', w: 512, h: 512, alpha: false },
  { svg: 'adaptive-monochrome.svg', out: 'android-icon-monochrome.png', w: 432, h: 432, alpha: true },
  { svg: 'splash-icon.svg', out: 'splash-icon.png', w: 1024, h: 1024, alpha: true },
  { svg: 'favicon.svg', out: 'favicon.png', w: 48, h: 48, alpha: true },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.w, height: j.h } });
  const svg = readFileSync(`assets/brand/${j.svg}`, 'utf8')
    .replace(/width="\d+"/, `width="${j.w}"`)
    .replace(/height="\d+"/, `height="${j.h}"`);
  await page.setContent(`<!doctype html><style>html,body{margin:0;padding:0}</style>${svg}`);
  await page.screenshot({ path: `assets/${j.out}`, omitBackground: j.alpha });
  await page.close();
  console.log(`${j.out} ${j.w}x${j.h} ✓`);
}
// 额外：给我自己看的放大 favicon 预览
const page = await browser.newPage({ viewport: { width: 192, height: 192 } });
const fav = readFileSync('assets/brand/favicon.svg', 'utf8')
  .replace('width="48"', 'width="192"').replace('height="48"', 'height="192"');
await page.setContent(`<!doctype html><style>html,body{margin:0}</style>${fav}`);
await page.screenshot({ path: 'assets/brand/favicon-preview-192.png', omitBackground: true });
await browser.close();
console.log('done');
