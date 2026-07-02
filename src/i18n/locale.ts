// 语言（Locale）：整个应用的多语言基座。
// 与时钟/时区同一哲学（E3）：语言是**显式注入的输入**，纯逻辑层绝不隐读环境——
// 需要产出人读文本的纯函数一律接收 locale 参数；设备语言的探测只发生在 UI 边界
// （src/ui/i18n.ts）。这样文本输出保持确定性、可测（E4），且各模块自带自己的译文（C10）。

export type Locale = 'zh' | 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh', 'en'];

/**
 * 从设备语言标签列表（按用户偏好排序，如 ["zh-Hans-CN", "en-US"]）解析出受支持的语言。
 * 第一个能匹配的偏好胜出；都不认识时回落英文。
 */
export function resolveLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-')) return 'zh';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
  }
  return 'en';
}
