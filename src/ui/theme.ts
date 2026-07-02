// 统一的视觉基调：安静、克制。运行界面必须简单（C4）。

export const colors = {
  bg: '#F6F6F3',
  surface: '#FFFFFF',
  border: '#E7E7E1',
  text: '#1B1B18',
  textMuted: '#6E6E66',
  accent: '#2F6F4F', // 沉静的绿
  accentText: '#FFFFFF',
  done: '#A6ADA4',
  pending: '#C7C7BF',
  warn: '#B4541E',
};

/**
 * 深色沉浸调色板：只用于「运行中」的仪式感场景（Runner）。
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
