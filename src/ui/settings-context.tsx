// 设置上下文：用户偏好在 UI 边界的注入点（与 i18n 的设备语言探测同一角色）。
// 解析规则一律「用户覆盖 ?? 系统」——纯逻辑层继续只接收显式参数，E3 思路不变。
// 无 Provider 时回落空偏好（即全部跟随系统），测试与单屏渲染无需额外脚手架。

import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { type Settings } from '../session/settings';

export interface SettingsContextValue {
  settings: Settings;
  /** 替换整份偏好并持久化（App 根提供实现；字段设为 undefined 即恢复跟随系统）。 */
  update(next: Settings): void;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: {},
  update: () => {},
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

/** 界面配色模式：用户覆盖 ?? 系统模式。运行页的沉浸深绿不经此处（场景，非模式）。 */
export function useAppScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const { settings } = useSettings();
  return settings.appearance ?? (system === 'dark' ? 'dark' : 'light');
}
