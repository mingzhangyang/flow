# 品牌资产

## 概念

**表圈 + 时间珠 + 对勾。**
圆环是钟面；环顶开口处的圆点是「钉在环上的墙钟时刻」——正是本产品的核心隐喻
（日程型节点钉在一天的固定时刻上）；环内对勾即「准时完成 / 打卡」。

视觉基调与应用内 `src/ui/theme.ts` 同源：

- 主绿 `#2F6F4F`（accent，图标背景为其上下 ±8% 明度的渐变 `#357A5B → #2A6347`）
- 米白 `#F6F6F3`（bg，深底上的标记色）

## 文件

| SVG 源 | 渲染目标 | 尺寸 | 用途 |
|---|---|---|---|
| `icon.svg` | `../icon.png` | 1024² | iOS / 通用图标（不透明） |
| `adaptive-foreground.svg` | `../android-icon-foreground.png` | 512² | Android 自适应前景（安全区 61%） |
| `adaptive-background.svg` | `../android-icon-background.png` | 512² | Android 自适应背景 |
| `adaptive-monochrome.svg` | `../android-icon-monochrome.png` | 432² | Android 13+ 主题图标（白剪影） |
| `splash-icon.svg` | `../splash-icon.png` | 1024² | 启动屏标记（绿标记、透明底） |
| `favicon.svg` | `../favicon.png` | 48² | Web favicon（加粗版标记） |

## 重新生成

改动任一 SVG 后运行（用仓库自带的 Chromium 截图渲染，无需额外依赖）：

```bash
node scripts/render-brand.mjs
```
