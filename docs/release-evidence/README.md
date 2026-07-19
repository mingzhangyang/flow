# 发布验证证据

此目录保存与具体发布候选版本绑定的真机验证结果。每次验证从对应模板复制新文件，不覆盖旧证据。

Android 命名约定：

```text
android-YYYYMMDD-<short-sha>.md
```

规则：

- 文件内必须记录完整 commit SHA、EAS build ID、设备/系统版本和明确结论。
- 代码、依赖、app config 或原生配置变化后创建新记录；旧记录保留，但不能放行新 RC。
- 不记录 adb serial、账号、药名、服药时间或其它个人健康信息。
- 截图或日志若含个人信息，先脱敏再入库；无法安全脱敏则只记录本机受控位置，不提交文件本身。
- 模板见 [`../android-reminder-test-results.md`](../android-reminder-test-results.md)。
