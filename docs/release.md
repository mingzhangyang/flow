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

## 冻结候选版本（真机验证前必做）

真机证据只对**生成该安装包的 commit**有效。旧 APK 能用于试装，不能替代当前 HEAD 的发布验证。

1. 确认准备材料已提交、工作树干净，分支已推远端且 CI 全绿。
2. 在同一 commit 运行 `npm run check && npm run test:e2e`，再运行 `npx expo-doctor`；任何失败都先修复。
3. 用 `git rev-parse HEAD` 记录完整 RC SHA，然后从该 SHA 执行
   `eas build --profile preview -p android`（iOS 候选版本使用对应 profile/platform）。
4. 在 EAS 构建记录中核对 commit SHA，把 SHA、build ID、产物链接写入
   [`release-status.md`](./release-status.md) 与本次结果表。下载 APK，运行
   `scripts/android-reminder-check.sh apk-sha256 <path>`，同时记录 artifact SHA-256。
5. 代码、依赖、app config 或原生配置一旦变化，旧真机结论自动失效：生成新 build ID，并重跑受影响项。

合并前再次确认 `git rev-parse HEAD` 与结果表 RC SHA 完全一致。若 main 或候选分支在验证后发生变化，
不得沿用旧结果。

## 每次发版的版本号流程

1. 改 `app.json`：`expo.version`（用户可见版本，同步改 `package.json.version`，
   否则 `npm run check` 会拦下）；`ios.buildNumber` 与 `android.versionCode` 递增。
2. `npm run check && npm run test:e2e` 全绿。
3. `npx expo-doctor` 20/20（含「依赖版本与 SDK 匹配」——漂移会在 EAS 构建时才暴露；
   `npx expo install --fix` 可对齐到 SDK 期望的补丁版本）。
4. 打 tag：`git tag v<version>`。

## 真机验证清单（首次发布前必过）

### Android RC 验证

使用 [`../scripts/android-reminder-check.sh`](../scripts/android-reminder-check.sh) 辅助，并把完整证据填入
[`android-reminder-test-results.md`](./android-reminder-test-results.md) 的副本。

- [ ] 结果表 RC SHA、EAS build ID、APK SHA-256 与设备上安装的文件一致
- [ ] 全新安装（或确认备份后清除测试数据）→ 启动时不弹通知权限 → 首次打开服药示例才弹 → 允许
- [ ] 前台、按 Home 后台、普通后台进程死亡（脚本 `process-death`）三种状态都到点提醒
- [ ] 重启设备且不先打开 App → 到点提醒（boot receiver / 系统调度验证）
- [ ] Android 12+ 分别记录“闹钟和提醒”特殊访问授予/撤销状态；授予后进入 Doze 仍按时提醒
- [ ] 撤销特殊访问后重复 Doze：若明显推迟且 App 没有诚实提示/引导，作为发布阻塞处理
- [ ] 拒绝通知权限 → 日程视图出现警示横幅 → 点「去系统设置」→ 开启后回来横幅消失
- [ ] 锚定时区 flow：改设备时区后提醒时刻仍按锚定时区
- [ ] 编辑/删除已登记 flow 后，旧提醒被替换/取消，无孤儿提醒
- [ ] `force-stop --ack-platform-limit` 只验证平台边界：重新打开前**不期待**提醒；重新打开并安排未来提醒后恢复
- [ ] 国产 ROM（小米/华为等）至少一台：后台数小时后提醒仍到点；无设备时是唯一可显式延期项

默认准时判据为“不提前、延迟不超过 60 秒”；若设备/系统需要不同容差，必须在开始测试前写入结果表并说明，
不能看到结果后再放宽。清除应用数据会删除本地 Flow 与设置，操作前先按 C6 完成备份。

> Android 的“普通进程死亡”和 force-stop 不是一回事。force-stop 会把包置于 stopped state，
> 用户重新打开前系统不允许它自行恢复；因此不能用 `adb shell am force-stop` 证明“后台仍会提醒”。

### iOS RC 验证（产生 iOS 构建后独立执行）

- [ ] 记录独立的 commit SHA、build ID、iOS 版本与设备型号
- [ ] 权限请求只在首次登记提醒时出现；允许/拒绝/设置恢复均符合文案
- [ ] 前台、后台、从 App Switcher 划掉后分别验证本地提醒
- [ ] 重启/系统升级边界与锚定时区行为有记录
- [ ] 真机结果绑定待发布 iOS RC；未验证前不得进入 TestFlight / App Store 发布列车

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
