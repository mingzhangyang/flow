// Expo 配置插件：关闭 Android 的 ExtraTranslation 致命 lint。
//
// 背景：app.json 的 `locales` 用 CFBundleDisplayName 本地化 iOS 应用显示名。
// Expo 会把它一并生成到 Android 的 values-*/strings.xml，而默认 locale 没有该键，
// Android 的 lintVitalRelease 遂将 ExtraTranslation 判为致命错误，release 构建失败。
// 该键只对 iOS 有意义（Android 应用名取自 app.json 的 name，无法经此本地化），
// 因此在 app/build.gradle 内关闭这一项 lint 检查即可：保留 iOS 本地化，放行 Android 构建。
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidLintExtraTranslation(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    const contents = cfg.modResults.contents;
    if (contents.includes("disable 'ExtraTranslation'")) return cfg;
    cfg.modResults.contents = contents.replace(
      'android {',
      "android {\n    lint {\n        disable 'ExtraTranslation'\n    }",
    );
    return cfg;
  });
};
