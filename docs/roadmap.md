# 开发路线图（Roadmap）

每个阶段的每项功能都追溯到宪章条款（**C8**）。若某项无法追溯，就不该做。
顺序原则：**先立地基（领域模型 + Runtime），再做运行，再做编辑，最后才是 AI。**
这与 AI-C4（先理解、后生成）和 C1（Flow 优先于 Timer）一致。

---

## Phase 0 — 地基与领域模型  ✅ 已完成
> 目标：把"是什么"用代码固定下来，让一切可测试、可重放。

- [x] 领域类型：`Flow` / `Run` / `FlowNode`（五种类型）+ `schemaVersion` + 可选 `rationale`　`C0,C2,E5`
- [x] 校验与序列化（开放格式，round-trip 无损）　`C6,E5`
- [x] Runtime 骨架：`reduce` / `project` / `nextEvents`，时钟显式注入　`E1,E2,E3`
- [x] Runtime 黄金测试（含顺序型与日程型两种拓扑）　`E4`
- [x] 项目脚手架：目录结构、`node --test` 运行器、契约测试约定　`C10`

**验收**：✅ 给定示例 Flow + 注入时钟 + 事件日志，Runtime 产出确定的事件序列（`npm run check`：typecheck 通过，20 用例全绿）。

## Phase 1 — 最小可运行（MVP：运行体验）  ✅ 已完成
> 目标：一条 Flow 能被真正"跑"起来，运行界面极简。

- [x] 动作层 `src/session/actions`：意图 + now → RunEvent（纯函数、可测试）　`C5`
- [x] Runner + Timeline Renderer：打开即可开始，一屏看清"现在/下一步"　`C4`
- [x] 运行控制：暂停 / 恢复 / 跳过 / 回退 / 等待确认　`C5`
- [x] 日程型运行视图：未来 24h 的 `nextEvents` 列表（服药）　`领域模型§二,E6`
- [x] 内置两条示例 Flow：法压咖啡（顺序型）+ 服药（日程型）　`C2`
- [x] 本地 Storage：`KVStore` 端口 + 纯 `Storage` + AsyncStorage 适配（Web 回退 localStorage）；Run 持久化与掉线恢复　`C6`
- [x] Notification：纯规划器 `plan` + `Notifier` 端口 + expo-notifications 适配（原生）；顺序计时到点 & 日程提醒　`C5`

**验收**：✅ 打开示例 Flow 即跑，可暂停/跳过/回退；**整页刷新后重开自动恢复到原步骤且计时继续**（Playwright 验证：03:59→reload→03:49）；类型检查 + 33 单测通过。通知逻辑经单测与真实 API 类型校验；**本地推送需真机验证**（headless 无法覆盖）。

## Phase 2 — 创始场景闭环（服药 / 日程型）  ✅ 已完成
> 目标：把创始场景真正做扎实，验证日程型拓扑不是二等公民。

- [x] 日程型节点：绝对时刻 + 每日重复 + 多药并行独立　`领域模型§二`
- [x] 打卡（已服用/实际时间）与漏服的非阻塞处理：`adherence` 纯逻辑 + 今日清单 UI　`C5`
- [x] 绝对时间的本地定时通知；时区以显式偏移注入（E3）　`E3`
- [x] DST（夏令时）：时区升级为「偏移随时刻变化」的注入接口 `TimeZone`；切换日的墙钟换算、次日推进、被跳过/重复时刻均有确定语义　`E3,E4`
- [x] 锚定非设备时区：`Flow.timeZone`（IANA 名，可选，加法演进）+ `ianaTimeZone` 适配器——出差时仍按锚定时区提醒；编辑器可设/清除并校验，日程视图标注　`E3,E5,C6`
- [x] 重复方式扩展：仅今天（once，**默认不重复**）/ 每天 / 每周指定星期 / 每 N 天（起算日显式入定义）；**节律归属 Flow 级**（整个模式一起重复，ADR-0003，schemaVersion 2 + v1 自动迁移）；今日清单与下一次触发按节律过滤；编辑器与 AI 生成同步支持　`领域模型§二,C0,E4,E5`
- [x] 医疗安全：描述性文案 + 免责声明（分享来源标注随 Phase 3 分享落地）　`E6`

**验收**：✅ 三种药每日独立提醒；今日清单可逐剂打卡，**漏一颗不影响其它**（Playwright 验证：08:00 打卡为“已服·07:00”，14:00/22:00 仍待服；整页刷新后打卡状态保留）；40 单测通过。
**已知限制**：~~跨 DST 切换日的偏移变化尚未处理~~（已完成：`TimeZone` 接口 + `instantAtTimeOfDay`，DST 契约测试覆盖春/秋令时、跳过与重复时刻）；本地推送需真机验证。

## Phase 3 — 编辑与共享  ✅ 已完成
> 目标：让 Flow 成为可读、可分享的知识（编辑可以复杂）。

- [x] Flow 编辑器：增删/重排节点、切换类型、填 rationale（"为什么"）　`C2`
- [x] 版本化：`library.commit` 提交为新修订，旧版本入历史（`saveRevisions`）　`AI-C3 的前置`
- [x] 导出 / 导入 / 分享（开放格式 JSON，带 schemaVersion 与 provenance.importedAt）　`C6,E5,E6`
- [x] 分享的社交面：可读分享文案（解读 + 「为什么」+ 日程型医疗免责）+ 署名入 provenance + 系统分享面板（原生 Share / Web Share / 剪贴板回退）；导入端接受整段分享全文（自动提取数据）　`E6,AI-C2,C6,C10`

**验收**：✅ 新建顺序型 flow → 填步骤与 rationale → 保存（"我的 · v1"）→ 运行；导出为合法 JSON → 改 id/标题后导入 → 库中新增一条（Playwright 全程验证，无报错）。

## Phase 4 — AI 编辑器（理解优先）  ✅ 已完成（离线解释器版本）
> 目标：AI 作为编辑器介入，严格遵守 AI 原则。顺序即能力优先级。
> 本阶段为**离线解释器**：全部由本地纯函数生成，不调用任何外部模型。

- [x] 解释一个 Flow（它在做什么、为什么）：`ai/explain`　`AI-C4①`
- [x] 找瓶颈 / 优化建议：`ai/analyze`（瓶颈占比、缺失 rationale、间隔过近…）　`AI-C4②③`
- [x] 比较两个 Flow：`ai/diff`　`AI-C4④`
- [x] 改动可 Diff / Undo：`InsightScreen` 展示与上一版差异 + `library.restore`「回到上一版」；AI 只读 Flow 定义、绝不碰运行中的 Run　`AI-C1,AI-C3`
- [x] （最后）从自然语言**生成** Flow —— 经 `ModelPort` 接入真实模型，**不绑定单一供应商**：Anthropic（Claude）与任意 OpenAI 兼容端点（DeepSeek / Kimi / 通义 / 智谱 / Ollama…）可切换；密钥只存本机；生成物为草稿，入编辑器审阅后保存为新版本　`AI-C1,AI-C3,C6,E6`

**验收**：✅ 对示例/自建 flow 生成解读与洞察（瓶颈、缺失“为什么”）；编辑产生新版本后可看差异并「回到上一版」（Playwright 全程验证，无报错）。
**说明**：自然语言生成已实现——模型层为供应商无关的 `ModelPort`（见 `docs/architecture.md` §5）；适配器与解析管线经契约测试 + 本地 mock 端点端到端验证；对真实云端 API 的连通性依用户自配密钥，未在 CI 覆盖。

---

## Phase 5 — 发布准备（进行中）
> 目标：把已完成的产品送上真机与商店。工程面已就绪；余项多为资产、账号与合规。

- [x] CI：GitHub Actions 每次 push/PR 跑 `npm run check`（与本地完全一致）　`C10`
- [x] 应用标识：`bundleIdentifier` / `android.package`（com.mingzhangyang.zhunshi）、`scheme: zhunshi`、buildNumber / versionCode；`expo-notifications` plugin 接入　`C6`
- [x] 隐私政策草稿：`docs/privacy-policy.md`（本地优先、无账号、无遥测、AI BYOK；待托管 URL、生效日期、联系方式）　`C6,E6`
- [x] 提醒不断档：日程提醒多日排入（7 天窗口、上限 48）+ 启动/回前台/库变更时重排——App 几天不开，服药提醒也到点　`C5,E3`
- [x] 加固（项目审查修复）：导入同 id 不再静默覆盖（旧版本入历史）；AI 密钥入系统安全存储（Keychain/Keystore，旧数据自动搬迁）；持久数据读入前迁移 + 校验（Run 日志重放即校验）；历史修订设上限　`C6,AI-C3,E4,E5`
- [ ] 真机验证本地推送（iOS 权限时机、Android 13+ 通知权限与渠道、后台到点）——需真机
- [ ] 品牌资产：替换占位 icon / adaptive icon / splash / favicon
- [ ] EAS：`eas init` + `eas.json`、签名（Apple Developer 账号、Android keystore 备份）、TestFlight / internal testing 内测
- [ ] 商店合规与材料：隐私政策上线到公开 URL、健康类内容申报（免责声明首用可见）、AI 第三方数据共享申报、商店文案与截图
- [ ]（可选，v1.0 后）崩溃上报（与无追踪承诺一致）、OTA 更新、国内商店的软著/备案

## 里程碑
- **M1（地基）** = Phase 0：可重放的 Runtime。
- **M2（能跑）** = Phase 1：MVP 运行体验。
- **M3（创始场景）** = Phase 2：服药闭环。
- **M4（知识载体）** = Phase 3：编辑与共享。
- **M5（AI 编辑器）** = Phase 4。
- **M6（发布）** = Phase 5：真机 + 商店。

## 记录约定
- 触碰不可变原则的决策 → 写一条 ADR 到 `docs/adr/`。
- 每个 PR/commit 标注 `Constitution: C_`。
