# Constitution Layer

这不是 API 文档，而是 **Flow 产品的设计法则**。

任何 Agent（Claude / GPT / Gemint / 其他）或人类，在为本仓库写下任何代码或做出任何设计决策**之前**，都必须先阅读并遵循这一层。它的目的是：无论换用哪个模型、经过多少次对话，产品的方向都不会漂移。

## 阅读顺序

1. [`00-core.md`](./00-core.md) — 核心宪章：使命、愿景、第一原则、**Flow 不是什么**
2. [`01-domain-model.md`](./01-domain-model.md) — 领域模型：Flow / Run / Node 的定义与两种时间拓扑
3. [`02-ai-principles.md`](./02-ai-principles.md) — AI 在产品中的角色约束
4. [`03-engineering.md`](./03-engineering.md) — 工程约束：声明式、确定性、格式、安全
5. [`04-agent-development.md`](./04-agent-development.md) — Agent 开发流程与追溯约定

每份文档都刻意保持在一屏之内。宁可短而锐，也不要长到没人读。

## 三条使用约定

**1. 追溯（Traceability）。** 每个 PR / commit 都要能回答"它满足哪一条 Constraint"。约定在提交信息或 PR 描述里写一行：

```
Constitution: C3, C5   # 本次改动服务于第 3、第 5 条约束
```

如果一个功能无法追溯到任何一条约束，按 Constraint 8，它值得被重新思考。

**2. 先架构，后代码。** 实现任何新功能前，先回答 [`04-agent-development.md`](./04-agent-development.md) 中的三个问题。答案清晰之前，不写代码。

**3. 层级不是铁板一块。**

- **不可变原则**（宪法级，改动需极慎重、走 ADR）：使命、愿景、Constraint 0、C1–C6、AI-C1–C4、领域模型中的 Flow/Run 区分。
- **可修订的工程选择**（随经验演进）：具体存储格式、是否引入 DSL、UI 技术、通知实现等，见 `03-engineering.md`。

区分二者，是为了让技术决策可以灵活演进，而不必每次都像"修宪"。

## 版本

本宪章自身也需版本化。任何对**不可变原则**的改动，都记录为一条 ADR（架构决策记录），放在 `docs/adr/`。

- 当前宪章版本：`v1.0`
- 最近修订：2026-07-01（整合 Flow/Run 区分、两种时间拓扑、确定性定义、医疗安全等审查意见）
