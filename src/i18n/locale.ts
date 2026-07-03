// 语言（Locale）：整个应用的多语言基座。
// 与时钟/时区同一哲学（E3）：语言是**显式注入的输入**，纯逻辑层绝不隐读环境——
// 需要产出人读文本的纯函数一律接收 locale 参数；设备语言的探测只发生在 UI 边界
// （src/ui/i18n.ts）。这样文本输出保持确定性、可测（E4），且各模块自带自己的译文（C10）。

export type Locale = 'zh' | 'zh-Hant' | 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh', 'zh-Hant', 'en'];

/** 标签是否指向繁体中文：显式 Hant 脚本，或传统上使用繁体的地区（台湾/香港/澳门）。 */
function isTraditionalChinese(lowerTag: string): boolean {
  return lowerTag.includes('hant') || /-(tw|hk|mo)(-|$)/.test(lowerTag);
}

/**
 * 从设备语言标签列表（按用户偏好排序，如 ["zh-Hant-TW", "en-US"]）解析出受支持的语言。
 * 第一个能匹配的偏好胜出；中文按脚本/地区分简繁（未指明脚本的按简体）；都不认识时回落英文。
 */
export function resolveLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-')) {
      return isTraditionalChinese(lower) ? 'zh-Hant' : 'zh';
    }
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
  }
  return 'en';
}
