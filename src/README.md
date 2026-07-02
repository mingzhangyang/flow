# src —— 纯逻辑层

本目录是与框架无关的纯 TypeScript。它不依赖 React Native / Expo，可被 `node --test` 直接运行。
所有设计以 [`../constitution/`](../constitution/README.md) 为准，模块边界见 [`../docs/architecture.md`](../docs/architecture.md)。

## 模块

- `domain/` —— 领域模型：`Flow` / `Run` / `FlowNode`（5 种）类型、校验、序列化。纯类型与纯函数。
- `runtime/` —— 运行时引擎：`reduce` / `project` / `nextEvents`，以及时钟层。时钟显式注入（E3），全部确定性（E4）。
- `session/` —— 动作层：把「用户意图 + now」翻译为 `RunEvent`（纯函数、可测试）。
- `storage/` —— 持久化：`KVStore` 端口 + 纯 `Storage`（可测）+ `asyncStorageKv` 适配器（应用侧）。
- `notifications/` —— 通知：纯规划器 `plan` + `Notifier` 端口 + `expoNotifier`（`.ts` 默认 noop / `.native.ts` 原生实现）。
- `ai/` —— AI 助手：`explain` / `analyze` / `diff` 离线解释器；`generate` 自然语言生成管线；`model/` 供应商无关的 `ModelPort` 端口 + Anthropic / OpenAI 兼容适配器（fetch 注入、可契约测试）。
- `examples/` —— 两条示例 Flow：`coffee`（顺序型）、`medication`（日程型）。
- `ui/` —— React Native 展示层（`*.tsx` 与 hook）：只读 runtime 状态、派发事件。非纯逻辑，由 `tsconfig.json` 做类型检查。

> 引用原生模块的适配器（`asyncStorageKv.ts`、`expoNotifier.native.ts`）与 `ui/` 不进入 node 端类型检查，由应用侧 `tsconfig.json` 覆盖（见 `tsconfig.src.json` 的 exclude）。

> 注意：不要使用 `src/app/` 目录名——Expo Router 保留了 `app/` / `src/app/` 作为路由约定。

## 约定

- **可擦除 TS**：不使用 enum / namespace / 参数属性等（`erasableSyntaxOnly`），以便 `node --test` 原生剥离类型直接运行。
- **相对 import 带 `.ts` 后缀**：Node 的类型剥离需要显式扩展名。
- **契约测试**：每个模块用 `*.contract.test.ts` 只针对公开接口断言；运行时的确定性用 `runtime.golden.test.ts` 做黄金主测试（C10）。

## 命令

```bash
npm run typecheck   # tsc -p tsconfig.src.json
npm test            # node --test（运行所有 *.test.ts）
npm run check       # 先类型检查再跑测试
```
