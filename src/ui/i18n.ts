// 语言探测的唯一注入点（与 systemTimeZone 同一角色）：纯逻辑层只接收 locale 参数，
// 这里在 UI 边界读一次设备语言（expo-localization），向下全部显式传递（E3 思路）。

import { useMemo } from 'react';
import { getLocales } from 'expo-localization';
import { resolveLocale, type Locale } from '../i18n/locale';
import { useSettings } from './settings-context';
import { STRINGS, type Strings } from './strings';

export function deviceLocale(): Locale {
  try {
    return resolveLocale(getLocales().map((l) => l.languageTag));
  } catch {
    return 'en';
  }
}

export interface I18n {
  locale: Locale;
  t: Strings;
}

/** 当前语言与文案表：设置里的覆盖优先，缺省用设备语言（后者一次探测，会话中途极少变）。 */
export function useI18n(): I18n {
  const override = useSettings().settings.locale;
  return useMemo(() => {
    const locale = override ?? deviceLocale();
    return { locale, t: STRINGS[locale] };
  }, [override]);
}
