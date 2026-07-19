# 发布进度快照（Session Handoff）

> 本文是**某次工作会话的状态快照**，供下个 session 直接接续。快照时间：**2026-07-19**。
> 权威流程仍以 [`release.md`](./release.md) 为准；本文只记“现在到哪了 / 下一步做什么”。
> git 与 EAS 状态会变化，接续前必须重新核对，不能把本页当作实时接口。

## 一句话现状

Android 曾在 commit `21452e4` 成功生成可安装 preview APK，但当前分支 HEAD 已到 `01d9eb5`，
其后 4 个提交包含原生提醒与生命周期变更。因此旧 APK **不是当前发布候选版本（RC）**，只能用于试装。
准备材料已入库并推远端。当前首要顺序是：备份 keystore → 从精确 HEAD 构建新 RC → Android 真机验证。

## 当前工程基线

- 分支：`chore/eas-project-link`
- 准备前代码 HEAD：`01d9eb5cc2c80b5db2f65fbbc75582d5b658b814`
- 准备提交：`f517f41`（文档/脚本）+ `aaff5b5`（脚本 executable bit）
- `main` 基线：`89c21be`；实时 HEAD 与领先数以 `git rev-parse HEAD` / `git rev-list` 为准
- 远端：已建立 `origin/chore/eas-project-link` upstream，准备提交已异地备份
- `npm run check`：2026-07-19 本地通过；源代码中 172 个 `test(...)` 用例
- RC 闸门尚未执行：`npm run test:e2e`、`npx expo-doctor`、当前 HEAD 的 EAS build 均需在冻结 RC 时重跑
- 真机验证：尚未开始
- Android keystore：仍只由 EAS 云端托管，尚未完成独立备份

## 已完成的实施前准备

1. [`plan-2026-07-19.md`](./plan-2026-07-19.md) 已改为“测试 SHA = 待合并 HEAD”的硬门槛；
   任何代码、依赖或原生配置修复都会使旧证据失效。
2. [`release.md`](./release.md) 已拆分 Android / iOS 发布门槛，并澄清普通进程死亡与 Android
   force-stop 的平台语义。
3. [`../scripts/android-reminder-check.sh`](../scripts/android-reminder-check.sh) 已准备设备快照、
   普通进程死亡、Doze、设置页、受保护的 force-stop / reboot 等 adb 操作。
4. [`android-reminder-test-results.md`](./android-reminder-test-results.md) 已准备 RC 身份、设备环境、
   必测结果、异常证据和发布结论模板。
5. [`release-evidence/`](./release-evidence/README.md) 已定义逐 RC 留档与隐私规则。
6. 真实服药 dogfood / 用户验证已加入 E6 边界：只能作为既有提醒的并行辅助，不得替代医嘱或唯一提醒。

以上准备已由 commit `f517f41` 与 `aaff5b5` 入库并推送；后续状态更新单独提交，避免改写已发布历史。

## 历史构建产物（仅试装，不作为当前 RC 证据）

- 成功构建 commit：`21452e4c2b2c9650479e8ad8e808e04ac20eab3f`
- EAS build ID：`6737d8b9-9b90-4fe4-b1ac-c81c1f23ff16`
- APK 直链：https://expo.dev/artifacts/eas/61YT_BdvgvG28aUZjUe_cylZCPcqV04WCMLqkk1NpWQ.apk
- 构建页：https://expo.dev/accounts/ideas-flow/projects/flow/builds/6737d8b9-9b90-4fe4-b1ac-c81c1f23ff16
- 签名凭据：`Build Credentials EdrPA2S4Zz (default)`

该构建证明 `ExtraTranslation` release lint 修复在当时可构建；它没有包含后续设置页、拓扑提示、
提醒生命周期与 Run 完整性加固，不能用来放行当前分支。

## 下一步（严格按顺序）

- [x] **P0.1 准备材料入库**：提交本次文档与脚本，提交信息标注
      `Constitution: C5, C6, C10; E6`；确认没有相关文件仍未跟踪。
- [x] **P0.2 推送分支**：`git push -u origin chore/eas-project-link`；等待 CI 的 check 与 e2e 均通过。
- [ ] **P0.3 备份 Android keystore**：按 [`keystore-backup.md`](./keystore-backup.md) 下载 `.jks`、
      保存三组值到 KeePassXC，并为 `.kdbx` 建立异地副本；`.jks` 绝不入库。
- [ ] **P1.1 冻结 Android RC**：工作树干净、CI 全绿后，按 [`release.md`](./release.md)
      重跑 check / e2e / expo-doctor，记录完整 SHA，从该 SHA 生成新的 EAS preview APK，
      并记录下载文件的 SHA-256。
- [ ] **P1.2 真机验证**：安装精确 RC，用辅助脚本执行清单并把填写后的模板另存为
      `docs/release-evidence/android-YYYYMMDD-<short-sha>.md`。
- [ ] **P2 合并**：仅当 Android 必测项通过且结果表 SHA 与 HEAD 相同，才 fast-forward 合并到 main。

## EAS 项目与环境

- Expo 账号：`ideas-flow`
- 项目：`@ideas-flow/flow`
- projectId：`5f35674e-97d5-43ec-8e23-6ba95e27d0fd`
- 环境：WSL2 + `/mnt/c`；依赖已安装，I/O 较慢
- 交互式 EAS 凭据命令在无 TTY 会话不可用；keystore 备份优先走 Web 控制台
- 凭据页：https://expo.dev/accounts/ideas-flow/projects/flow/credentials

## 已知但不阻塞准备阶段的事项

- `expo-system-ui` 尚未安装；只影响 Android 原生层随深浅色切换，不影响应用内主题或提醒验证。
- 国产 ROM 一夜观察可以因无设备成为唯一显式延期项，但必须保留在结果表中。
- iOS 尚无 RC；Android 结果不可复用于 iOS，进入 TestFlight / App Store 前需独立真机门槛。
