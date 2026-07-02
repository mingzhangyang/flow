// Sharer 端口：把一段文本递出去（系统分享面板 / 剪贴板）。
// 纯逻辑只依赖本接口（C10）；平台差异全部收进适配器（systemSharer）。

export type ShareOutcome =
  | 'shared' // 已唤起系统分享（或 Web Share）
  | 'copied' // 平台无分享面板，已复制到剪贴板
  | 'unavailable'; // 两者皆不可用

export interface Sharer {
  share(payload: { title: string; message: string }): Promise<ShareOutcome>;
}
