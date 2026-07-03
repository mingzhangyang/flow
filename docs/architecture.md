# 架构（Architecture）

本文件定义模块边界与接口。它服务于 **C9（Agent 优先维护架构）** 与 **C10（任何模块可被单独重建）**。
所有设计以 [`constitution/`](../constitution/README.md) 为准；本文只讲"怎么落地"，不改"是什么"。

## 分层总览

```
┌──────────────────────────────────────────────┐
│  UI 层                                          │
│  ├─ Editor（编辑，可以复杂）                      │
│  └─ Runner + Timeline Renderer（运行，必须极简）  │  ← C4
├──────────────────────────────────────────────┤
│  Runtime Engine（纯函数、最小状态）  ← E1/E2/E3/E4 │
├──────────────────────────────────────────────┤
│  Domain Model（Flow / Run / Node 类型 + schema） │  ← 领域模型
├────────────┬─────────────────┬────────────────┤
│  Storage    │  Notification    │  AI Assistant   │
│（本地优先）  │（定时通知/闹钟）  │（编辑器，非主人） │
└────────────┴─────────────────┴────────────────┘
```

**依赖方向**：上层依赖下层，下层不知道上层。Domain Model 不依赖任何模块。
模块之间**只通过类型化接口通信**（C10），每个接口配契约测试。

## 模块与契约

### 1. Domain Model（`src/domain/`）
纯类型与纯函数，无副作用。定义 `Flow`、`Run`、`Node`（五种类型见 `constitution/01-domain-model.md`）、schema 版本与校验、序列化/反序列化。
- **不变式**：Flow 不可变；Node 可带可选 `rationale`；每个 Flow 带 `schemaVersion`。

### 2. Runtime Engine（`src/runtime/`）
把「Flow 定义 + 注入时钟 + Run 事件日志」推进为"当前应处于的状态 + 接下来的事件"。
- 关键接口（示意）：
  - `reduce(run: Run, event: RunEvent, now: Instant): Run` — 纯函数，`now` 显式注入（E3）。
  - `project(flow: Flow, log: RunEvent[], now: Instant): RunState` — 由日志重建状态（E2）。
  - `nextEvents(flow, state, now): ScheduledEvent[]` — 每节点最近一次触发，驱动界面「下一次」。
  - `upcomingEvents(flow, now, tz, horizonMs)` — 窗口内**全部**触发（可跨多日），供通知层一次排入数日提醒。
  - `reduce` 对带下标的事件做范围校验——非法转移抛错，坏日志进不了 Run。
- **不变式**：无隐式 `now()`、无隐藏内存；同一输入必得同一输出（E4）。
- **重复规则（`runtime/recurrence.ts`）**：节律在 **Flow 级**（`Flow.repeat`，整个模式一起重复，ADR-0003）。`occursOnDay(repeat, anchor, tz)` 判定某条规则在某个本地日是否发生（weekly 按星期、everyNDays 按起算日取模），engine 排下一次触发与 adherence 过滤今日清单共用（今天不在节律上 = 整条 flow 今天无事件）；`describeRecurrence` 供 UI/解读。once 语义为「仅今天一次，过时不候」——无状态运行时不跨日顺延，这是缺省值（默认不重复）。
- **时区**：与时钟同为显式注入。`TimeZone.offsetAt(instant)` 表达「偏移随时刻变化」，因此 DST 切换日也正确（固定偏移标量仍兼容）；墙钟 → Instant 的换算集中在 `instantAtTimeOfDay`——被跳过的时刻取切换后第一个时刻，重复的时刻取第一次。适配器有二：`systemTimeZone`（按被询问时刻取设备偏移）与 `ianaTimeZone(name)`（按 IANA 时区名，供 `Flow.timeZone` 锚定非设备时区——出差时仍按家里的时区提醒）；`timeZoneForFlow(flow, fallback)` 做选择与坏名回退。测试注入固定或阶跃时区，IANA 适配器用真实 DST 切换点验证。
- **黄金测试**：一批 `(flow, injected clock, event log) → expected event sequence` 用例；DST 契约测试用自构造阶跃时区覆盖春/秋令时。

### 3. Storage（`src/storage/`）
持久化 Flow 定义与 Run 记录。本地优先、离线可用。
- 接口：`saveFlow / loadFlow / listFlows / exportFlow / importFlow / appendRunEvent / loadRun`。
- **不变式**：导出/导入用开放格式，round-trip 无损（C6/E5）。
- **读入闸门**：持久数据回到纯核心前先过校验——flow 快照（含 Run 内嵌、历史修订）走
  迁移 + 校验（`coerceFlow`），Run 事件日志用 `reduce` 从头重放验证（重放即校验，E4）；
  坏数据返回 null / 逐条跳过，绝不让非法状态流入运行时。
- **机密走窄端口**：`SecretStore`（getItem/setItem/removeItem，无枚举）。适配器
  `secureKv.native`（iOS Keychain / Android Keystore，expo-secure-store）、Web 回落
  AsyncStorage；AI 模型密钥经此存储，不与普通数据混在一个后端（C6）。
- **整库备份（`backup.ts` + `library.exportBackup/importBackup`）**：全部 flow + 历史修订 +
  打卡日志组装成一份开放格式 JSON（C6 兜底；不含瞬态 Run，不含 AI 密钥）。首页「备份」
  经系统分享面板存文件/发给自己；导入框自动识别备份全文（`parseBackup`，非备份则按单条
  flow 走）。恢复绝不覆盖本机：读回逐条过闸门（坏条目跳过），同 id 的 flow 走 commit
  入历史，打卡按占位合并、本机记录优先。

### 4. Notification Engine（`src/notifications/`）
把 Runtime 给出的触发时刻翻译成平台的本地定时通知/闹钟（expo-notifications）。
- 接口：`schedule(events) / cancel(ids) / rescheduleFor(run)`。
- **不变式**：不含业务逻辑，只做"事件 → 平台通知"的翻译；掉电/重启后可由 Run 记录重建。
- **多日排入与重排（`reschedule.ts`）**：用户打开某条日程型 flow 的运行视图即为它**登记**提醒
  （enroll，不为没打开过的 flow 自动推送）；App 启动 / 回到前台 / 库变更时把已登记 flow
  未来 7 天的提醒整批重排（上一批 id 记在 KV，先取消再排入）——App 几天不开，提醒也不断档（C5）。
  单批截断到 48 条（iOS 待决通知上限 64，留余量）；计划本身是纯函数（`plan.ts`），编排不含时钟隐读（E3）。

### 5. AI Assistant（`src/ai/`）
Flow 的**编辑器**，不是主人（见 `02-ai-principles.md`）。
- 能力顺序：解释 → 优化 → 找瓶颈 → 比较 →（最后）生成。
- **不变式**：只提议"新版本"，产出必须可 Diff / Undo（AI-C3）；对正在运行的 Run 只读（AI-C1）。
- **模型端口（`src/ai/model/`）**：生成能力经由 `ModelPort` 接口调用外部大模型，**不绑定任何一家供应商**。
  - `ModelPort`：`complete(ModelRequest) → ModelResponse` 的最小文本补全端口；`fetch` 显式注入（同 E3 时钟注入思路），契约测试用假 fetch 断言请求形状。
  - 适配器：`anthropic`（Claude Messages API）、`openaiCompatible`（覆盖 OpenAI / DeepSeek / Kimi / 通义 / 智谱 / Ollama 等一切 `/chat/completions` 方言）。新增供应商 = 新增一个 config 变体 + 一个适配器（扩展而非修改）。
  - 配置（供应商、端点、模型、密钥）只存本机（C6），且走 `SecretStore` 窄端口——原生端为系统安全存储（Keychain/Keystore），旧版明文位置读取时一次性搬迁；生成产物带 `provenance.source = "ai:<provider>/<model>"`（E6）。
  - 管线纯函数化：`buildGenerationRequest` / `parseGeneratedFlow`（解析、校验、分配 id）确定性可测；`generateFlow` 仅编排。
  - 真实端点连通性不入 CI（没有也不该有密钥）；`npm run check:ai`（`scripts/ai-smoke.mjs`）用自配 Key 走与应用完全相同的管线打一次真实 API，发布前/换供应商时手动验证。

### 6. Sharing（`src/sharing/`）
分享的社交面：把 Flow 组装成「人读的文案 + 可导入的数据」。
- 纯逻辑 `share.ts`：`buildShareText`（标题 + 解读/为什么 + 日程型医疗免责 + 数据分界线 + JSON）、`buildSharePayload`（署名与来源入 provenance，E6）、`extractFlowJson`（从整段分享文本提取数据，供导入端）。
- `Sharer` 端口 + `systemSharer` 适配器（原生 Share 面板 / Web Share / 剪贴板回退）。
- **不变式**：分享的是 Flow 定义（知识），绝不带 Run 状态；数据部分始终是开放格式（C6/E5）。

### 7. UI（`src/ui/` 或 `app/`）
- **Editor**：可以复杂。
- **Runner + Timeline Renderer**：必须极简，"打开即可开始"（C4）；只读 Runtime 状态并派发用户事件（暂停/跳过/确认/回退，C5）。

## 多语言（i18n）

语言与时钟/时区同一哲学（E3）：**locale 是显式注入的输入**，纯逻辑层绝不隐读环境。

- `src/i18n/locale.ts`：`Locale`（`'zh' | 'zh-Hant' | 'en'`）与偏好解析 `resolveLocale`，纯函数；
  中文按脚本/地区分简繁（Hant / 台港澳 → 繁体，未指明脚本按简体）。
  译文一律用 `Record<Locale, …>` 表——新增语言时漏译即编译错误。
- **产出人读文本的纯函数一律接收 locale 参数**（`describeRecurrence`、`explain`、`analyze`、
  `describeChange`、`buildShareText`、`planSequentialReminder`、模型适配器错误……），
  译文随各自模块存放（C10 模块自洽）；同一输入 + 同一 locale 必得同一输出（E4）。
- **UI 文案**集中在 `src/ui/strings.ts`（类型化文案表）；设备语言只在 UI 边界读一次
  （`src/ui/i18n.ts`，expo-localization），向下全部显式传递。
- **数据语言无关**：Flow 定义只存用户内容；diff 的字段名是稳定标识（译文在 describeChange）；
  分享文案的**分界线按语言**、导入端识别所有已知分界线——跨语言分享照常导入（C6/E5）。
- **示例**按语言各有一份内容等价、id 相同的定义（`examplesFor(locale)`）——切换语言不丢运行记录。

## 契约测试约定
每个模块在其目录下维护 `*.contract.test.ts`，只针对**公开接口**断言。
重构一个模块的内部实现时，契约测试 + Runtime 黄金测试必须仍绿。

## UI 回归（e2e）
逻辑层由契约测试守护，UI 层由 `e2e/`（`npm run test:e2e`）守护：`expo export` 出 web
静态构建 → 本地伺服 → playwright-core 驱动 headless Chromium 走真实界面，运行器仍是
`node --test`。确定性同 E3/E4 思路：假时钟固定注入（`FIXED_NOW`）、时区固定
Asia/Shanghai、语言固定 zh-CN。固化的验收路径：顺序型运行（开始/暂停/跳过/回退 +
整页刷新后恢复计时）、服药打卡（逐剂独立 + 刷新保留 + 免责可见）、编辑→导出→导入
闭环、once「过时不候」提示、AI 解读入口、整库备份→全新环境恢复。CI 与本地同一命令。
