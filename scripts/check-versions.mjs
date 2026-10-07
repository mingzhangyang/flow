// 发布静态闸门：把不需要账号/真机即可确定的发布配置固定进 CI。
// 账号绑定、证书、商店后台与真机通知可靠性仍由 docs/release.md 的人工清单负责。
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));

const CANONICAL_APPLICATION_ID = 'com.mingzhangyang.zhunshi';
const CANONICAL_SCHEME = 'zhunshi';
const CANONICAL_EAS_PROJECT_ID = '5f35674e-97d5-43ec-8e23-6ba95e27d0fd';

function fail(message) {
  console.error(`release config invalid: ${message}`);
  process.exit(1);
}

function configuredAssetUrl(label, path) {
  if (typeof path !== 'string' || path.trim() === '') fail(`${label} is missing`);
  const relative = path.replace(/^\.\//, '');
  const url = new URL(`../${relative}`, import.meta.url);
  if (!existsSync(url)) fail(`${label} points to missing file: ${path}`);
  return url;
}

function assertConfiguredAsset(label, path) {
  configuredAssetUrl(label, path);
}

function readConfiguredJson(label, path) {
  const url = configuredAssetUrl(label, path);
  try {
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch (error) {
    fail(`${label} must contain valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
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

const easProjectId = app.expo.extra?.eas?.projectId;
if (easProjectId !== CANONICAL_EAS_PROJECT_ID) {
  fail(`expo.extra.eas.projectId must remain ${CANONICAL_EAS_PROJECT_ID} (got ${easProjectId ?? 'missing'})`);
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

if (app.expo.ios?.infoPlist?.CFBundleAllowMixedLocalizations !== true) {
  fail('ios.infoPlist.CFBundleAllowMixedLocalizations must be true when localized app metadata is configured');
}

const locales = app.expo.locales;
if (locales === null || typeof locales !== 'object' || Array.isArray(locales)) {
  fail('expo.locales must be an object');
}
for (const locale of ['zh', 'zh-Hant', 'en']) {
  const label = `expo.locales.${locale}`;
  const localized = readConfiguredJson(label, locales[locale]);

  if (!isProfileObject(localized)) fail(`${label} must contain a JSON object`);
  if ('CFBundleDisplayName' in localized || 'app_name' in localized) {
    fail(`${label} must nest platform strings under ios/android, not at the locale root`);
  }

  const iosName = localized.ios?.CFBundleDisplayName;
  const androidName = localized.android?.app_name;
  if (!nonEmptyString(iosName)) fail(`${label}.ios.CFBundleDisplayName must be a non-empty string`);
  if (!nonEmptyString(androidName)) fail(`${label}.android.app_name must be a non-empty string`);
}

for (const asset of ['../assets/splash-icon.png', '../site/privacy/index.html']) {
  if (!existsSync(new URL(asset, import.meta.url))) fail(`release asset missing: ${asset.replace('../', '')}`);
}

console.log(`release config ok: ${pkg.version} / ${CANONICAL_APPLICATION_ID}`);
