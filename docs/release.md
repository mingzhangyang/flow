# 发布手册（Release Playbook）

面向 Phase 5：把已完成的产品送上真机与商店。EAS 配置见根目录 `eas.json`；
版本号唯一事实源是 `app.json`（`appVersionSource: local`），与 `package.json`
的一致性由 `npm run check` 的版本闸门保证。

## 一次性接入（需要账号，只做一次）

1. **Expo 账号**：`npm i -g eas-cli && eas login`
2. **绑定项目**：`eas init`——会把 `extra.eas.projectId` 写进 `app.json`，提交它。
3. **Apple**：Apple Developer Program（个人 $99/年）。首次 `eas build -p ios` 时
   EAS 可代管证书与 provisioning profile（推荐，选 EAS managed credentials）。
4. **Android**：Play Console（一次性 $25）。首次 `eas build -p android` 时让 EAS
   生成 keystore，然后**立刻**导出备份到密码管理器——keystore 丢失 = 永远无法更新
   已上架应用。步骤与存放规范见 [`docs/keystore-backup.md`](./keystore-backup.md)
   （无 TTY 环境用网页控制台下载，交互式 `eas credentials` 跑不了）。

## 日常构建

| 目的 | 命令 |
|---|---|
| 真机联调（开发客户端） | `eas build --profile development -p ios/android` |
| 内测分发（Android 直装 APK / iOS ad-hoc） | `eas build --profile preview -p android` |
| 商店正式包 | `eas build --profile production -p all` |
| 提交商店 | `eas submit -p ios` / `eas submit -p android` |

## 每次发版的版本号流程

1. 改 `app.json`：`expo.version`（用户可见版本，同步改 `package.json.version`，
   否则 `npm run check` 会拦下）；`ios.buildNumber` 与 `android.versionCode` 递增。
2. `npm run check && npm run test:e2e` 全绿。
3. `npx expo-doctor` 20/20（含「依赖版本与 SDK 匹配」——漂移会在 EAS 构建时才暴露；
   `npx expo install --fix` 可对齐到 SDK 期望的补丁版本）。
4. 打 tag：`git tag v<version>`。

## 真机验证清单（首次发布前必过）

- [ ] 打开服药示例 → 权限弹窗出现在**此时**（不是启动时）→ 允许
- [ ] 强杀 App → 到点提醒响（iOS / Android 各测）
- [ ] 重启设备 → 到点提醒响（Android 重点：boot receiver）
- [ ] Android `adb shell dumpsys deviceidle force-idle` 模拟 Doze → 到点是否被推迟
      （明显推迟 → 需要 `SCHEDULE_EXACT_ALARM` 引导，见 roadmap 余项）
- [ ] 拒绝通知权限 → 日程视图出现警示横幅 → 点「去系统设置」→ 开启后回来横幅消失
- [ ] 国产 ROM（小米/华为等）至少一台：后台数小时后提醒仍到点
- [ ] 锚定时区 flow：改设备时区后提醒时刻仍按锚定时区

## 商店提交前置

- [ ] 隐私政策上线（Cloudflare Pages，私有仓库亦免费）：
  1. Cloudflare 控制台 → Workers & Pages → Create → **Pages** → Connect to Git，
     授权并选择本仓库；
  2. 项目名建议 `zhunshi`（决定默认域名 `zhunshi.pages.dev`）；
  3. Production branch：`main`；**Build command 留空**；Build output directory：`site`；
  4. 部署完成后政策位于 `https://zhunshi.pages.dev/privacy/`（站点根为一页简介）。
     此后 main 上 `site/` 的任何变更自动重新部署；如换项目名或绑定自有域名，
     同步更新本文与 `docs/store-listing.md`、`docs/privacy-policy.md` 里的 URL。
- [ ] 商店文案与截图（见 `docs/store-listing.md`；截图草稿 `npm run shots`）
- [ ] 健康类内容申报 + AI 第三方数据共享申报（申报口径同见 store-listing）
