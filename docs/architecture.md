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
  - `nextEvents(flow, state, now): ScheduledEvent[]` — 供通知层调度。
- **不变式**：无隐式 `now()`、无隐藏内存；同一输入必得同一输出（E4）。
- **重复规则（`runtime/recurrence.ts`）**：`occursOnDay(repeat, anchor, tz)` 判定某条规则在某个本地日是否发生（weekly 按星期、everyNDays 按起算日取模），engine 排下一次触发与 adherence 过滤今日清单共用；`describeRecurrence` 供 UI/解读。once 语义为「仅今天一次，过时不候」——无状态运行时不跨日顺延，这是缺省值（默认不重复）。
- **时区**：与时钟同为显式注入。`TimeZone.offsetAt(instant)` 表达「偏移随时刻变化」，因此 DST 切换日也正确（固定偏移标量仍兼容）；墙钟 → Instant 的换算集中在 `instantAtTimeOfDay`——被跳过的时刻取切换后第一个时刻，重复的时刻取第一次。适配器有二：`systemTimeZone`（按被询问时刻取设备偏移）与 `ianaTimeZone(name)`（按 IANA 时区名，供 `Flow.timeZone` 锚定非设备时区——出差时仍按家里的时区提醒）；`timeZoneForFlow(flow, fallback)` 做选择与坏名回退。测试注入固定或阶跃时区，IANA 适配器用真实 DST 切换点验证。
- **黄金测试**：一批 `(flow, injected clock, event log) → expected event sequence` 用例；DST 契约测试用自构造阶跃时区覆盖春/秋令时。

### 3. Storage（`src/storage/`）
持久化 Flow 定义与 Run 记录。本地优先、离线可用。
- 接口：`saveFlow / loadFlow / listFlows / exportFlow / importFlow / appendRunEvent / loadRun`。
- **不变式**：导出/导入用开放格式，round-trip 无损（C6/E5）。

### 4. Notification Engine（`src/notifications/`）
把 Runtime 给出的 `nextEvents` 翻译成平台的本地定时通知/闹钟（expo-notifications）。
- 接口：`schedule(events) / cancel(ids) / rescheduleFor(run)`。
- **不变式**：不含业务逻辑，只做"事件 → 平台通知"的翻译；掉电/重启后可由 Run 记录重建。

### 5. AI Assistant（`src/ai/`）
Flow 的**编辑器**，不是主人（见 `02-ai-principles.md`）。
- 能力顺序：解释 → 优化 → 找瓶颈 → 比较 →（最后）生成。
- **不变式**：只提议"新版本"，产出必须可 Diff / Undo（AI-C3）；对正在运行的 Run 只读（AI-C1）。
- **模型端口（`src/ai/model/`）**：生成能力经由 `ModelPort` 接口调用外部大模型，**不绑定任何一家供应商**。
  - `ModelPort`：`complete(ModelRequest) → ModelResponse` 的最小文本补全端口；`fetch` 显式注入（同 E3 时钟注入思路），契约测试用假 fetch 断言请求形状。
  - 适配器：`anthropic`（Claude Messages API）、`openaiCompatible`（覆盖 OpenAI / DeepSeek / Kimi / 通义 / 智谱 / Ollama 等一切 `/chat/completions` 方言）。新增供应商 = 新增一个 config 变体 + 一个适配器（扩展而非修改）。
  - 配置（供应商、端点、模型、密钥）经 `KVStore` 只存本机（C6）；生成产物带 `provenance.source = "ai:<provider>/<model>"`（E6）。
  - 管线纯函数化：`buildGenerationRequest` / `parseGeneratedFlow`（解析、校验、分配 id）确定性可测；`generateFlow` 仅编排。

### 6. Sharing（`src/sharing/`）
分享的社交面：把 Flow 组装成「人读的文案 + 可导入的数据」。
- 纯逻辑 `share.ts`：`buildShareText`（标题 + 解读/为什么 + 日程型医疗免责 + 数据分界线 + JSON）、`buildSharePayload`（署名与来源入 provenance，E6）、`extractFlowJson`（从整段分享文本提取数据，供导入端）。
- `Sharer` 端口 + `systemSharer` 适配器（原生 Share 面板 / Web Share / 剪贴板回退）。
- **不变式**：分享的是 Flow 定义（知识），绝不带 Run 状态；数据部分始终是开放格式（C6/E5）。

### 7. UI（`src/ui/` 或 `app/`）
- **Editor**：可以复杂。
- **Runner + Timeline Renderer**：必须极简，"打开即可开始"（C4）；只读 Runtime 状态并派发用户事件（暂停/跳过/确认/回退，C5）。

## 契约测试约定
每个模块在其目录下维护 `*.contract.test.ts`，只针对**公开接口**断言。
重构一个模块的内部实现时，契约测试 + Runtime 黄金测试必须仍绿。
