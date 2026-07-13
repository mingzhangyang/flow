// 应用偏好（Settings）：语言与外观的用户覆盖，字段缺省即「跟随系统」。
// 读入过闸门（同 storage 的约定）：坏 JSON / 非法枚举值逐字段丢弃，回落跟随系统。
// 键带版本号、字段只加不改（E5 加法演进）；未知字段容忍——旧版本读新数据不崩。

import { type KVStore } from '../storage/kv';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/locale';

const KEY = 'settings:v1';

export type Appearance = 'light' | 'dark';

/** 用户偏好；缺省字段表示跟随系统。 */
export interface Settings {
  locale?: Locale;
  appearance?: Appearance;
}

function coerceSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const settings: Settings = {};
  if (typeof o.locale === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(o.locale)) {
    settings.locale = o.locale as Locale;
  }
  if (o.appearance === 'light' || o.appearance === 'dark') settings.appearance = o.appearance;
  return settings;
}

export async function loadSettings(kv: KVStore): Promise<Settings> {
  try {
    const text = await kv.getItem(KEY);
    if (text === null) return {};
    return coerceSettings(JSON.parse(text));
  } catch {
    return {};
  }
}

export async function saveSettings(kv: KVStore, settings: Settings): Promise<void> {
  await kv.setItem(KEY, JSON.stringify(settings));
}
