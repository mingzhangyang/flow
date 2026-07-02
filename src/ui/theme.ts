// 统一的视觉基调：安静、克制。运行界面必须简单（C4）。
// 深/浅色模式：界面调色板随系统模式切换（paletteFor）；
// 运行页的深墨绿是「场景」不是「模式」，两种模式下都保持沉浸（dark 常量）。

export interface Palette {
  bg: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  done: string;
  pending: string;
  warn: string;
}

/** 浅色（默认）：暖米白 + 沉静绿。 */
export const light: Palette = {
  bg: '#F6F6F3',
  surface: '#FFFFFF',
  border: '#E7E7E1',
  text: '#1B1B18',
  textMuted: '#6E6E66',
  accent: '#2F6F4F',
  accentText: '#FFFFFF',
  done: '#A6ADA4',
  pending: '#C7C7BF',
  warn: '#B4541E',
};

/** 深色：暖调近黑（微绿），强调色换亮薄荷保证对比度。 */
export const darkScheme: Palette = {
  bg: '#141614',
  surface: '#1E211E',
  border: '#32362F',
  text: '#EDEDE8',
  textMuted: '#9BA096',
  accent: '#8FD0AC',
  accentText: '#12241B',
  done: '#4A5147',
  pending: '#5C6357', // 兼作 placeholder，深底上需保有可读性
  warn: '#D98B57',
};

/** 系统模式 → 调色板（接受 RN 的 ColorSchemeName，含 'unspecified'）。 */
export function paletteFor(scheme: string | null | undefined): Palette {
  return scheme === 'dark' ? darkScheme : light;
}

/** 兼容别名：静态引用视为浅色（正在逐屏迁移到 paletteFor）。 */
export const colors = light;

/**
 * 深色沉浸调色板：只用于「运行中」的仪式感场景（Runner），不随系统模式变。
 * 浅色首页 → 深墨绿运行，一开一合即是品牌体验；珠与环延续应用图标的形状语言。
 */
export const dark = {
  bg: '#143326',
  surface: '#1C4132',
  border: '#2C5341',
  text: '#F6F6F3',
  textMuted: '#8FAF9D',
  faint: '#3A5C4B', // 环轨、分隔线
  accent: '#8FD0AC', // 深底上的亮薄荷
  warm: '#E8B04B', // 倒计时最后阶段的暖色
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

/** 字号阶梯：刻意拉开层级，避免"均匀的平淡"。 */
export const type = { caption: 12, body: 15, emphasis: 17, title: 22, display: 34, clock: 64 } as const;

/** 数字展示字体（IBM Plex Mono，App 启动时加载）：只用于时刻数字，仪器感。 */
export const mono = { thin: 'IBMPlexMono_200ExtraLight', medium: 'IBMPlexMono_500Medium' } as const;
