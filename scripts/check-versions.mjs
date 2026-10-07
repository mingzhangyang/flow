// 发布静态闸门：把不需要账号/真机即可确定的发布配置固定进 CI。
// 账号绑定、证书、商店后台与真机通知可靠性仍由 docs/release.md 的人工清单负责。
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));

const CANONICAL_APPLICATION_ID = 'com.mingzhangyang.zhunshi';
const CANONICAL_SCHEME = 'zhunshi';

function fail(message) {
  console.error(`release config invalid: ${message}`);
  process.exit(1);
}

function assertConfiguredAsset(label, path) {
  if (typeof path !== 'string' || path.trim() === '') fail(`${label} is missing`);
  const relative = path.replace(/^\.\//, '');
  if (!existsSync(new URL(`../${relative}`, import.meta.url))) {
    fail(`${label} points to missing file: ${path}`);
  }
}

if (pkg.version !== app.expo.version) {
  fail(`version mismatch: package.json = ${pkg.version}, app.json expo.version = ${app.expo.version}`);
}

const iosId = app.expo.ios?.bundleIdentifier;
const androidId = app.expo.android?.package;
if (iosId !== CANONICAL_APPLICATION_ID) {
  fail(`ios.bundleIdentifier must remain ${CANONICAL_APPLICATION_ID} (got ${iosId ?? 'missing'})`);
}
if (androidId !== CANONICAL_APPLICATION_ID) {
  fail(`android.package must remain ${CANONICAL_APPLICATION_ID} (got ${androidId ?? 'missing'})`);
}

if (app.expo.scheme !== CANONICAL_SCHEME) {
  fail(`expo.scheme must remain ${CANONICAL_SCHEME} (got ${String(app.expo.scheme ?? 'missing')})`);
}

const iosBuildNumber = app.expo.ios?.buildNumber;
if (typeof iosBuildNumber !== 'string' || !/^[1-9]\d*(?:\.\d+){0,2}$/.test(iosBuildNumber)) {
  fail('ios.buildNumber must be a CFBundleVersion-style positive numeric string (for example 1 or 1.2.3)');
}

if (!Number.isInteger(app.expo.android?.versionCode) || app.expo.android.versionCode < 1) {
  fail('android.versionCode must be a positive integer');
}

const plugins = new Set(
  (app.expo.plugins ?? [])
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
    .filter((entry) => typeof entry === 'string'),
);
for (const required of ['expo-notifications', 'expo-secure-store', 'expo-localization']) {
  if (!plugins.has(required)) fail(`required Expo plugin missing: ${required}`);
}

if (eas.cli?.appVersionSource !== 'local') fail('eas.cli.appVersionSource must stay local');

const isProfileObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
if (!isProfileObject(eas.build?.production)) fail('EAS production build profile must be an object');
if (!isProfileObject(eas.submit?.production)) fail('EAS production submit profile must be an object');

assertConfiguredAsset('expo.icon', app.expo.icon);
assertConfiguredAsset('android.adaptiveIcon.foregroundImage', app.expo.android?.adaptiveIcon?.foregroundImage);
assertConfiguredAsset('android.adaptiveIcon.backgroundImage', app.expo.android?.adaptiveIcon?.backgroundImage);
assertConfiguredAsset('android.adaptiveIcon.monochromeImage', app.expo.android?.adaptiveIcon?.monochromeImage);
assertConfiguredAsset('web.favicon', app.expo.web?.favicon);

for (const asset of ['../assets/splash-icon.png', '../site/privacy/index.html']) {
  if (!existsSync(new URL(asset, import.meta.url))) fail(`release asset missing: ${asset.replace('../', '')}`);
}

console.log(`release config ok: ${pkg.version} / ${CANONICAL_APPLICATION_ID}`);
