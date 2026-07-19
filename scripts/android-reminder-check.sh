#!/usr/bin/env bash

# Android 本地提醒真机验证助手。
#
# 只封装可重复、可审计的 adb 操作；不判断提醒是否真的响，观察结果仍需人工写入
# docs/android-reminder-test-results.md。force-stop 与 reboot 都要求显式确认参数，避免误操作。

set -euo pipefail

readonly ZHUNSHI_PACKAGE="${ZHUNSHI_ANDROID_PACKAGE:-com.mingzhangyang.zhunshi}"
readonly ZHUNSHI_ADB="${ZHUNSHI_ADB_BIN:-adb}"

usage() {
  sed -n '/^# 用法：$/,/^# ---$/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'
}

# 用法：
#   scripts/android-reminder-check.sh <command>
#
# 命令：
#   apk-sha256 <apk-path>        计算待安装 APK 的 SHA-256，绑定构建产物
#   preflight                    确认 adb、设备连接和应用安装状态
#   snapshot                     输出设备/系统/权限诊断快照（不含 adb serial）
#   process-death                普通后台进程死亡；提醒仍应由系统送达
#   doze-enter                   进入强制 Doze；测试结束必须执行 doze-exit
#   doze-exit                    退出强制 Doze，并恢复电池状态
#   open-notification-settings   打开应用通知设置
#   open-exact-alarm-settings    打开“闹钟和提醒”特殊访问设置（Android 12+）
#   force-stop --ack-platform-limit
#                                置为 stopped state；重新打开前不期待提醒送达
#   reopen                       从 stopped state 重新打开应用
#   reboot --confirm             重启连接设备；会中断设备当前工作
#   help                         显示本说明
#
# 可选环境变量：
#   ZHUNSHI_ANDROID_PACKAGE      覆盖包名
#   ZHUNSHI_ADB_BIN              覆盖 adb 可执行文件
#   ANDROID_SERIAL               多设备连接时选择目标（adb 原生变量）
# ---

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_device() {
  command -v "$ZHUNSHI_ADB" >/dev/null 2>&1 || fail "找不到 adb；请先安装 Android platform-tools"
  [[ "$("$ZHUNSHI_ADB" get-state 2>/dev/null || true)" == "device" ]] ||
    fail "没有可用 adb 设备；请解锁设备、允许 USB 调试，并用 adb devices -l 检查"
}

require_installed() {
  require_device
  "$ZHUNSHI_ADB" shell pm path "$ZHUNSHI_PACKAGE" >/dev/null 2>&1 ||
    fail "设备上未安装 $ZHUNSHI_PACKAGE"
}

apk_sha256() {
  local apk_path="${1:-}"
  [[ -n "$apk_path" ]] || fail "请提供 APK 路径"
  [[ -f "$apk_path" ]] || fail "APK 不存在：$apk_path"
  command -v sha256sum >/dev/null 2>&1 || fail "找不到 sha256sum"
  sha256sum "$apk_path"
}

preflight() {
  require_installed
  printf 'adb: %s\n' "$ZHUNSHI_ADB"
  printf 'package: %s\n' "$ZHUNSHI_PACKAGE"
  printf 'device: %s %s (Android %s / API %s)\n' \
    "$("$ZHUNSHI_ADB" shell getprop ro.product.manufacturer | tr -d '\r')" \
    "$("$ZHUNSHI_ADB" shell getprop ro.product.model | tr -d '\r')" \
    "$("$ZHUNSHI_ADB" shell getprop ro.build.version.release | tr -d '\r')" \
    "$("$ZHUNSHI_ADB" shell getprop ro.build.version.sdk | tr -d '\r')"
  printf 'installed: yes\n'
}

snapshot() {
  require_installed
  printf 'captured_at_host: %s\n' "$(date -Iseconds)"
  printf 'package: %s\n' "$ZHUNSHI_PACKAGE"
  printf 'manufacturer: %s\n' "$("$ZHUNSHI_ADB" shell getprop ro.product.manufacturer | tr -d '\r')"
  printf 'model: %s\n' "$("$ZHUNSHI_ADB" shell getprop ro.product.model | tr -d '\r')"
  printf 'android_release: %s\n' "$("$ZHUNSHI_ADB" shell getprop ro.build.version.release | tr -d '\r')"
  printf 'android_api: %s\n' "$("$ZHUNSHI_ADB" shell getprop ro.build.version.sdk | tr -d '\r')"
  printf 'build_fingerprint: %s\n' "$("$ZHUNSHI_ADB" shell getprop ro.build.fingerprint | tr -d '\r')"
  printf 'device_timezone: %s\n' "$("$ZHUNSHI_ADB" shell getprop persist.sys.timezone | tr -d '\r')"
  printf 'device_time: %s\n' "$("$ZHUNSHI_ADB" shell date -Iseconds 2>/dev/null | tr -d '\r' || true)"
  printf '\ninstalled app version:\n'
  "$ZHUNSHI_ADB" shell dumpsys package "$ZHUNSHI_PACKAGE" 2>/dev/null |
    sed -n '/versionCode=/p;/versionName=/p' |
    sed -n '1,4p'
  printf '\nnotification permission/app-op:\n'
  "$ZHUNSHI_ADB" shell appops get "$ZHUNSHI_PACKAGE" POST_NOTIFICATION 2>/dev/null || true
  printf '\nexact-alarm app-op (diagnostic only; system Settings is authoritative):\n'
  "$ZHUNSHI_ADB" shell appops get "$ZHUNSHI_PACKAGE" SCHEDULE_EXACT_ALARM 2>/dev/null || true
  printf '\npackage stopped state:\n'
  "$ZHUNSHI_ADB" shell dumpsys package "$ZHUNSHI_PACKAGE" 2>/dev/null |
    sed -n '/User 0:/,/^[[:space:]]*User [1-9][0-9]*:/p' |
    sed -n '1,12p'
}

process_death() {
  require_installed
  printf '先按 Home 让应用进入后台；现在请求系统终止其普通后台进程。\n'
  "$ZHUNSHI_ADB" shell am kill "$ZHUNSHI_PACKAGE"
  printf '完成。此操作不进入 stopped state；已排入系统的提醒仍应送达。\n'
}

doze_enter() {
  require_installed
  printf '进入强制 Doze。测试结束后务必运行 doze-exit。\n'
  "$ZHUNSHI_ADB" shell dumpsys battery unplug
  "$ZHUNSHI_ADB" shell dumpsys deviceidle force-idle
  "$ZHUNSHI_ADB" shell dumpsys deviceidle get deep
}

doze_exit() {
  require_device
  "$ZHUNSHI_ADB" shell dumpsys deviceidle unforce
  "$ZHUNSHI_ADB" shell dumpsys battery reset
  printf '已退出强制 Doze，并恢复电池状态。\n'
}

open_notification_settings() {
  require_installed
  "$ZHUNSHI_ADB" shell am start \
    -a android.settings.APP_NOTIFICATION_SETTINGS \
    --es android.provider.extra.APP_PACKAGE "$ZHUNSHI_PACKAGE"
}

open_exact_alarm_settings() {
  require_installed
  "$ZHUNSHI_ADB" shell am start \
    -a android.settings.REQUEST_SCHEDULE_EXACT_ALARM \
    -d "package:$ZHUNSHI_PACKAGE"
}

force_stop() {
  require_installed
  [[ "${1:-}" == "--ack-platform-limit" ]] ||
    fail "force-stop 会禁止应用自启动；确认理解后加 --ack-platform-limit"
  "$ZHUNSHI_ADB" shell am force-stop "$ZHUNSHI_PACKAGE"
  printf '应用已进入 stopped state。重新运行 reopen 前，不期待本地提醒送达。\n'
}

reopen() {
  require_installed
  "$ZHUNSHI_ADB" shell monkey \
    -p "$ZHUNSHI_PACKAGE" \
    -c android.intent.category.LAUNCHER 1 >/dev/null
  printf '已重新打开应用；请为未来时刻重新安排提醒后继续验证。\n'
}

reboot_device() {
  require_device
  [[ "${1:-}" == "--confirm" ]] || fail "重启会中断设备当前工作；确认后加 --confirm"
  "$ZHUNSHI_ADB" reboot
  printf '已发送重启命令。设备恢复连接后先运行 preflight。\n'
}

case "${1:-help}" in
  apk-sha256) apk_sha256 "${2:-}" ;;
  preflight) preflight ;;
  snapshot) snapshot ;;
  process-death) process_death ;;
  doze-enter) doze_enter ;;
  doze-exit) doze_exit ;;
  open-notification-settings) open_notification_settings ;;
  open-exact-alarm-settings) open_exact_alarm_settings ;;
  force-stop) force_stop "${2:-}" ;;
  reopen) reopen ;;
  reboot) reboot_device "${2:-}" ;;
  help|-h|--help) usage ;;
  *) usage >&2; fail "未知命令：$1" ;;
esac
