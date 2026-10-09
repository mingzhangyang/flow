# 发布手册（Release Playbook）

面向 Phase 5：把已完成的产品送上真机与商店。EAS 配置见根目录 `eas.json`；
版本号唯一事实源是 `app.json`（`appVersionSource: local`），与 `package.json`
的一致性由 `npm run check` 的版本闸门保证。

## 一次性接入（需要账号，只做一次）

1. **Expo 账号**：`npm i -g eas-cli && eas login`
2. **绑定项目**：本仓库已绑定 EAS project `5f35674e-97d5-43ec-8e23-6ba95e27d0fd`，并将该非敏感 ID 固定在
   `app.json → expo.extra.eas.projectId`。CI 会校验它不得漂移。
3. **Android 签名凭证**：首次正式使用 EAS Build 前运行
   `eas credentials:configure-build -p android -e preview`，选择由 EAS 生成并托管新的
   Android keystore。完成后同一 EAS 项目/凭证应持续复用，不能每次构建重新生成。
4. **备份 Android keystore**：凭证创建完成后用 `eas credentials -p android` 导出备份到
   密码管理器/离线安全存储。keystore 丢失会影响后续覆盖升级和商店发布。
5. **GitHub Actions token**：GitHub 仓库 → Settings → Secrets and variables → Actions →
   New repository secret，新建 `EXPO_TOKEN`。Token 只放 Secret，不写入仓库文件、PR 或日志。
6. **Apple**：Apple Developer Program（个人 $99/年）。首次 `eas build -p ios` 时
   EAS 可代管证书与 provisioning profile（推荐，选 EAS managed credentials）。

> Expo 官方要求 CI 的非交互 EAS Build 在项目绑定和签名凭证已配置后使用。
> 本仓库的 projectId 已固定；GitHub Actions 不再创建或重新绑定 EAS project。
> Android keystore 仍应先交互式配置一次，之后 CI 用 `--freeze-credentials` 只读复用。

## 日常构建

| 目的 | 命令 |
|---|---|
| 真机联调（开发客户端） | `eas build --profile development -p ios/android` |
| 内测分发（Android 直装 APK / iOS ad-hoc） | `eas build --profile preview -p android` |
| GitHub 手动生成签名 Preview APK | Actions → **EAS Android Preview APK** → Run workflow |
| 商店正式包 | `eas build --profile production -p all` |
| 提交商店 | `eas submit -p ios` / `eas submit -p android` |

GitHub 的 Preview APK 工作流只允许手动触发，避免每次 push 消耗 EAS 构建额度。它会先执行
`npm run check`、e2e、Expo 依赖检查和 `expo-doctor`；全部通过后才触发 EAS。构建完成后，
工作流会把 EAS 生成的已签名 APK 下载回来，并上传为 GitHub Actions artifact
`flow-android-preview-apk`。

## 每次发版的版本号流程

1. 改 `app.json`：`expo.version`（用户可见版本，同步改 `package.json.version`，
   否则 `npm run check` 会拦下）；`ios.buildNumber` 与 `android.versionCode` 递增。
2. `npm run check && npm run test:e2e` 全绿。
3. `npx expo install --check` 无版本漂移，再跑 `npx expo-doctor@latest` 并确保**全部检查通过**；
   如有漂移，用 `npx expo install --fix` 对齐到当前 SDK 57 稳定补丁。
4. 打 tag：`git tag v<version>`。

## 真机验证清单（首次发布前必过）

- [ ] 打开服药示例 → 权限弹窗出现在**此时**（不是启动时）→ 允许
- [ ] App 在前台/后台时点击日程提醒 → 直接打开对应 Flow
- [ ] 强杀 App 后点击日程提醒冷启动 → 仍直接打开对应 Flow；随后普通重启不应重复跳转
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


## PR #16 — Mobile UX and native verification

The check workflow runs the browser mobile screenshot smoke after E2E, **reusing**
its web export (no second build). Images at 320dp and 430dp in three languages
are uploaded as the flow-mobile-screenshots GitHub Actions artifact. The ordinary
npm run shots command still produces 430dp high-resolution drafts. These are web
layouts, **not** native Android/iOS app screenshots.

The android-apk-smoke workflow performs Expo compatibility/doctor checks,
clean Android prebuild, release lint, assembleRelease and APK artifact
verification **without changing generated Android XML**. The prior
CFBundleDisplayName sed cleanup has been removed: an iOS metadata key leaking
into Android resources must fail the build and be fixed in Expo config.

After successful build, open the workflow run -> Artifacts -> download
flow-android-standalone-test-apk. **GitHub downloads a ZIP, not an APK**:
extract flow-android-standalone-test.apk before installing. The ZIP includes
source-commit.txt with the exact build commit, SHA256SUMS and required
signature.txt containing the successful `apksigner` verification output. The
workflow fails before upload if `apksigner` is unavailable, verification fails,
or APK Signature Scheme v2 is not reported as true. A Gradle test APK (possibly
debug signed) is not a distributable EAS-signed preview. The EAS Android Preview
APK workflow remains **manual**, reuses the existing keystore with
--freeze-credentials, and must never create or replace signing credentials
automatically.

### Release blockers and native device matrix

Sequential Run persistence (formerly a release blocker) is resolved: `saveRun`
rejects unless the whole Run snapshot is confirmed written and reports reminder
sync separately; the Runner shows a non-optimistic failure banner with Retry,
exits wait (bounded, 1.5s) for the in-flight save, confirm when it failed or is
still unconfirmed, and leaving anyway realigns the reminder with the persisted
Run. Web leave confirmations use the browser dialog (RN-web Alert is a no-op). Contract
tests replay the retried snapshot (`definitionRuntime` / `runSaveTracker`
contracts, `e2e/runner.test.ts`). Native storage-failure behavior still belongs
to the device matrix below.
A passed Android build is permission to begin device testing, **not** a store
release decision.

Exact Android reminders, Doze, OEM battery optimization, process kill and
reboot notifications are also unresolved release risks. Native verification
must remain explicitly unchecked until a connected device is exercised.

| Area | Android | iOS |
|---|---|---|
| System 3-button/gesture Back, dirty discard and pending check-in warning | [ ] | [ ] navigation |
| Native keyboard inset, bottom Save and long-list scrolling | [ ] | [ ] |
| Light/dark, larger text (1.3x+), TalkBack / VoiceOver | [ ] | [ ] |
| Reduced Motion runtime switch, pause/resume/skip | [ ] | [ ] |
| Foreground/background, force-kill, persistence recovery | [ ] | [ ] |
| Notification permission denial, settings return, tap navigation | [ ] | [ ] |
| Doze, exact alarm, process kill and reboot reminder delivery | [ ] | [ ] |
| OEM long-background reminder behavior | [ ] | N/A |
| Timezone change with anchored Flow | [ ] | [ ] |
| SecureStore Keystore/Keychain transient failure handling | [ ] | [ ] |

Web E2E and screenshot smoke do not exercise Android system Back, native
keyboard, screen readers, Dynamic Type, Doze or native notification delivery.
