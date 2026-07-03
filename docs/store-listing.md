# 商店材料（草稿）

三语文案 + 申报口径 + 截图方案。字数按平台上限校核（iOS 名称/副标题 30 字符、
关键词 100 字符；Play 标题 30、简述 80、详述 4000）。
截图草稿：`npm run shots` → `shots/<语言>/`（web 构建 + 假时钟，构图与状态每次一致；
**正式截图需真机重截**——web 版会多一行「网页版不支持定时提醒」提示，真机没有）。

## 名称与分类

| 项 | 值 |
|---|---|
| 名称 | 准时 / 準時 / Zhunshi |
| 副标题（iOS，≤30 字符） | zh: 把经验变成可运行的时间流程 · en: Turn know-how into runnable routines |
| Bundle / Package | com.mingzhangyang.zhunshi |
| 类别 | 主：效率（Productivity）；副：健康健美（Health & Fitness） |
| 年龄分级 | 4+ / Everyone（无用户生成内容共享平台、无广告） |
| 定价 | 免费（v1 无内购） |

## 描述

### 简体中文

**一句话**：准时把「怎么做」变成可以运行的时间流程——冲一杯咖啡，或一天三次不漏服药。

**详述**：

> 很多知识是有时间结构的：法压咖啡要浸泡 4 分钟再压杆，有些药必须饭后、有些必须睡前。「准时」把这样的经验变成一条条可运行的 flow——不是待办，不是日历，而是**能一步步跑起来的时间流程**。
>
> **顺序型**：打开即可开始。全屏计时告诉你现在做什么、还剩多久、为什么这么做；现实优先——随时暂停、跳过、回退。
> **日程型**：一天的时间轴钉着每个时刻。每天 / 每周 / 隔 N 天重复，逐项打卡，漏一项不影响其它；提醒交给系统，App 几周不开也到点就响。
> **知识可分享**：每一步都能写下「为什么」。一条 flow 可以导出成人能读懂的文字加开放格式数据，朋友粘贴即可导入。
> **数据永远是你的**：无账号、无服务器、无追踪；一键备份全部数据，开放 JSON 格式随时带走。
> **AI 起草（可选）**：一句话生成 flow 草稿，用你自己的模型服务（Anthropic / DeepSeek / 本地 Ollama…），密钥只存在本机。
>
> 服药等健康场景：本应用仅作提醒，不构成医疗处方或诊断，请以医嘱为准。

### 繁體中文

> 很多知識是有時間結構的：法壓咖啡要浸泡 4 分鐘再壓桿，有些藥必須飯後、有些必須睡前。「準時」把這樣的經驗變成一條條可執行的 flow——不是待辦，不是日曆，而是**能一步步跑起來的時間流程**。
>
> **順序型**：打開即可開始。全螢幕計時告訴你現在做什麼、還剩多久、為什麼這麼做；現實優先——隨時暫停、跳過、回退。
> **日程型**：一天的時間軸釘著每個時刻。每天 / 每週 / 隔 N 天重複，逐項打卡，漏一項不影響其它；提醒交給系統，App 幾週不開也到點就響。
> **知識可分享**：每一步都能寫下「為什麼」。一條 flow 可以匯出成人能讀懂的文字加開放格式資料，朋友貼上即可匯入。
> **資料永遠是你的**：無帳號、無伺服器、無追蹤；一鍵備份全部資料，開放 JSON 格式隨時帶走。
> **AI 起草（可選）**：一句話生成 flow 草稿，用你自己的模型服務，金鑰只存在本機。
>
> 服藥等健康場景：本應用僅作提醒，不構成醫療處方或診斷，請以醫囑為準。

### English

> A lot of knowledge has a temporal shape: French press needs a 4-minute steep before you press; some pills go after meals, others at bedtime. Zhunshi turns that know-how into runnable flows — not a to-do list, not a calendar, but **step-by-step routines you can actually run**.
>
> **Sequences**: open and go. A full-screen timer shows what you're doing, how long is left, and why this step matters. Reality first — pause, skip, or step back anytime.
> **Schedules**: your day as a timeline of pinned moments. Repeat daily / weekly / every N days, check off each item independently — missing one never blocks the rest. Reminders are handed to the OS, so they fire on time even if you don't open the app for weeks.
> **Knowledge you can share**: every step can carry its "why". Export a flow as readable text plus open-format data; a friend imports it by pasting.
> **Your data stays yours**: no accounts, no servers, no tracking. One-tap backup of everything in open JSON.
> **AI drafting (optional)**: describe a routine in one sentence and get a draft flow — powered by a model service you configure (Anthropic / DeepSeek / local Ollama…). Your API key never leaves the device.
>
> For medication and other health uses: this app is a reminder aid only, not medical advice, prescription, or diagnosis — follow your clinician.

**关键词（iOS，≤100 字符）**
zh：`计时,流程,服药提醒,打卡,习惯,咖啡,冲煮,日程,提醒,时间管理`
en：`timer,routine,medication,reminder,checklist,brew,coffee,schedule,habit,flow`

## 审核申报口径

**健康类内容**（App Review 备注 / Play 健康应用申报）：
- 应用不提供医疗建议、诊断或处方；所有用药内容由用户自行录入，界面常驻免责声明
  （首个日程视图即可见），分享内容附带来源标注与免责文案。
- 不接入 HealthKit / Health Connect，不读写任何健康 API 数据。

**AI 与第三方数据共享**（Apple 隐私标签 / Play 数据安全表）：
- 数据收集：**无**。无账号、无服务器、无分析 SDK——隐私标签选「不收集数据」。
- 可选的 AI 生成功能会把**用户主动输入的一段描述**直接发送到**用户自己配置**的第三方
  模型服务（BYOK）；开发者不经手、不存储。Play 数据安全表口径：用户主动发起的、
  面向用户所选服务商的数据传输；App 本身不共享数据。
- API 密钥存于系统安全存储（Keychain / Keystore），仅本机。

**权限清单**：通知（本地提醒，用户首次开启某条日程的提醒时请求）。无相机/定位/通讯录等。

**隐私政策 URL**：`https://mingzhangyang.github.io/flow/privacy/`（启用 GitHub Pages 后生效）。

## 截图方案（iOS 6.7" / Android 手机各一套，三语）

| # | 画面 | 状态（`npm run shots` 已按此构图） | 配文（叠加标题，后期加） |
|---|---|---|---|
| 1 | 首页 | 「接下来」块 + 示例库 | 此刻该干嘛，一眼看清 |
| 2 | 运行 | 法压咖啡第 2 步计时中（沉浸深色） | 打开即可开始，现实随时优先 |
| 3 | 日程 | 已打卡 1 剂的服药时间轴 | 到点就响，漏一顿不乱全天 |
| 4 | 解读 | AI 助手的解读与洞察 | 每一步都有「为什么」 |
| 5（真机补） | 分享 | 导出预览（人读文案 + 数据） | 好经验，值得传下去 |

## 待办（对应 roadmap Phase 5 余项）

- [ ] 真机重截正式截图（叠加配文与设备框）
- [ ] App Store Connect / Play Console 填入以上文案与申报
- [ ] 国内商店（如需）：软著/备案另行评估
