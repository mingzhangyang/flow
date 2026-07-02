# ADR-0003：重复节律归属 Flow，而非节点

日期：2026-07（schemaVersion 1 → 2）

## 决策

`Recurrence`（仅今天 / 每天 / 每周 / 每 N 天）从 `ScheduledNode.repeat` 上移为
`Flow.repeat`（可选，缺省 = 仅今天）。日程型 flow 的所有节点共享同一节律。

## 理由

1. **概念**：Flow 是「一个时间模式」（宪章 C0）。「每日服药」是整个模式每天重复，
   节点只是模式内的时刻。节律是模式的属性，不是单个事件的属性。
2. **产品**：节点级 repeat 允许同一 flow 里各事件节律不同——表达力换来的是
   编辑器每个节点一套重复控件、今日视图难以解释（"为什么 B 药今天不在？"）。
   不同节律 = 不同的时间模式 = 应该是两条 flow，分开还能各自锚定时区、独立分享。
3. **一致性**：解读（explain）、日程视图、通知一律以 flow 为单位描述节律，
   文案与心智模型对齐（"每天在这些时间提醒：…"）。

## 代价与迁移

- **表达力收窄**：一条 flow 内不再支持混合节律。混合场景拆成多条 flow（首页
  「接下来」块会跨 flow 聚合最近一次提醒，体验无损）。
- **schema 破坏性变更** → schemaVersion 2 + 反序列化自动迁移（E5「加法演进或带迁移」）：
  v1 数据取第一个 scheduled 节点的 repeat 作为 flow 节律，节点字段剥除。
  v1 期无真实用户数据，混合节律仅存在于理论上，迁移无实际损失。
- 存量存储（AsyncStorage）经 `deserializeFlow` 读取即迁移；导入旧分享文本同理。

## 影响面

domain（types/validate/serialize/editing）、runtime（engine/adherence）、
ai（explain/generate 的 prompt 与解析，含"模型把 repeat 写在节点上"的容错提升）、
ui（编辑器节律控件上移到 flow 级、日程视图节律入标题并新增"今天不在节律上"空态）。
