# Flow — Agent 入口

## 先读宪章（强制）

在为本仓库写下任何代码或做任何设计决策之前，**先阅读 [`constitution/`](./constitution/README.md)**。
它是本产品的设计法则，凌驾于个人偏好与单次对话之上。核心一句话：

> Flow 是一种用于表达、执行和共享「时间模式（Temporal Pattern）」的载体。

开工前请走一遍 [`constitution/04-agent-development.md`](./constitution/04-agent-development.md) 的检查清单，
并在提交信息里标注本次改动服务的约束，例如 `Constitution: C3, C5`。

## 规划文档

- 架构与模块边界：[`docs/architecture.md`](./docs/architecture.md)
- 开发路线图与 MVP 范围：[`docs/roadmap.md`](./docs/roadmap.md)
- 商业化方向（记录）：[`docs/monetization.md`](./docs/monetization.md)

## 技术栈提示

本项目使用 Expo / React Native（SDK 57）。Expo 各版本 API 差异较大，
写代码前请查阅对应版本的官方文档：https://docs.expo.dev/versions/v57.0.0/
