// 发布静态闸门：把不需要账号/真机即可确定的发布配置固定进 CI。
// 账号绑定、证书、商店后台与真机通知可靠性仍由 docs/release.md 的人工清单负责。
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));

function fail(message) {
  console.error(`release config invalid: ${message}`);
  process.exit(1);
}

if (pkg.version !== app.expo.version) {
  fail(`version mismatch: package.json = ${pkg.version}, app.json expo.version = ${app.expo.version}`);
}

const iosId = app.expo.ios?.bundleIdentifier;
const androidId = app.expo.android?.package;
if (!iosId || !androidId || iosId !== androidId) {
  fail(`iOS bundleIdentifier and Android package must match (got ${iosId ?? 'missing'} / ${androidId ?? 'missing'})`);
}
if (!app.expo.scheme || typeof app.expo.scheme !== 'string') fail('expo.scheme is missing');
if (!app.expo.ios?.buildNumber || Number(app.expo.ios.buildNumber) < 1) fail('ios.buildNumber must be >= 1');
if (!Number.isInteger(app.expo.android?.versionCode) || app.expo.android.versionCode < 1) {
  fail('android.versionCode must be a positive integer');
}

const plugins = new Set(app.expo.plugins ?? []);
for (const required of ['expo-notifications', 'expo-secure-store', 'expo-localization']) {
  if (!plugins.has(required)) fail(`required Expo plugin missing: ${required}`);
}

if (eas.cli?.appVersionSource !== 'local') fail('eas.cli.appVersionSource must stay local');
if (!Object.prototype.hasOwnProperty.call(eas.build ?? {}, 'production')) fail('EAS production build profile missing');
if (!Object.prototype.hasOwnProperty.call(eas.submit ?? {}, 'production')) fail('EAS production submit profile missing');

for (const asset of ['../assets/icon.png', '../assets/favicon.png', '../assets/splash-icon.png', '../site/privacy/index.html']) {
  if (!existsSync(new URL(asset, import.meta.url))) fail(`release asset missing: ${asset.replace('../', '')}`);
}

console.log(`release config ok: ${pkg.version} / ${iosId}`);
