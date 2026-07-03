// Sharer 适配器：原生用系统分享面板（微信/邮件/信息…），Web 优先 Web Share API，
// 退而复制到剪贴板。仅由应用引用；不进入 node 端类型检查（见 tsconfig.src.json exclude）。

import { Platform, Share } from 'react-native';
import { type Sharer } from './sharer';

interface WebNavigator {
  share?(data: { title?: string; text: string }): Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

export const systemSharer: Sharer = {
  async share({ title, message }) {
    if (Platform.OS !== 'web') {
      await Share.share({ title, message });
      return 'shared';
    }
    const nav = (globalThis as { navigator?: WebNavigator }).navigator;
    if (nav?.share) {
      try {
        await nav.share({ title, text: message });
        return 'shared';
      } catch {
        // 用户取消或环境不允许——落到剪贴板
      }
    }
    if (nav?.clipboard) {
      await nav.clipboard.writeText(message);
      return 'copied';
    }
    return 'unavailable';
  },
};
