// UI 文案表：全部界面字符串按语言集中于此（纯数据 + 少量格式化函数，无副作用）。
// 纯逻辑层的文案不在这里——它们各自带译文、按显式注入的 locale 输出（见 src/i18n/locale.ts）。
// 品牌名遵循 ADR-0002：中文「准时」，英文 "Zhunshi"。

import { type Locale } from '../i18n/locale';

const zh = {
  // 通用
  back: '‹ 返回',
  cancel: '取消',
  save: '保存',
  delete: '删除',

  // 首页
  brand: '准时',
  headerDate: (month: number, day: number, weekday: number): string =>
    `${month} 月 ${day} 日 · 周${'日一二三四五六'[weekday]}`,
  upNext: '接下来',
  newSequential: '＋ 顺序',
  newScheduled: '＋ 日程',
  aiGenerate: '✨ AI 生成',
  importAction: '导入',
  sectionMine: '我的',
  sectionExamples: '示例',
  cardMeta: (n: number, topology: 'sequential' | 'scheduled'): string =>
    `${n} ${topology === 'sequential' ? '步' : '个时刻'} · 点按运行`,
  linkInsight: '解读',
  linkEdit: '编辑',
  linkShare: '分享',

  // 运行（顺序型）
  runDone: '已完成',
  runTotalSteps: (n: number): string => `共 ${n} 步`,
  runStepOf: (i: number, n: number, paused: boolean): string =>
    `第 ${i} / ${n} 步${paused ? ' · 已暂停' : ''}`,
  runStartAnytime: '随时开始',
  runGateHint: '完成后确认',
  runInstantHint: '完成即过',
  runFlowFinished: '这条 flow 走完了',
  runTimeUp: '计时完成，可进入下一步',
  runRestart: '重新开始',
  runStart: '开始',
  runConfirm: '确认',
  runCompleteStep: '完成本步',
  runPrev: '上一步',
  runResume: '恢复',
  runPause: '暂停',
  runSkip: '跳过',

  // Timeline 节点元信息
  nodeNeedsConfirm: '需确认',
  nodeInstant: '即时',

  // 日程视图（服药）
  doseUpcoming: '待服',
  doseDue: '可服用',
  doseTaken: '已服',
  doseMissed: '漏服',
  scheduleToday: (cadence: string, timeZone?: string): string =>
    `今天 · ${cadence}${timeZone ? ` · 按 ${timeZone} 时区` : ''}`,
  scheduleOffDay: (next: { month: number; day: number; time: string } | null): string =>
    `今天不在节律上${next ? `，下一次：${next.month} 月 ${next.day} 日 ${next.time}` : ''}。`,
  scheduleNow: (time: string): string => `现在 ${time}`,
  checkIn: '打卡',
  undo: '撤销',
  scheduleNote: '本表仅作提醒之用，不构成医疗处方或诊断；请以医嘱为准。',

  // 编辑器
  editorTitle: '编辑',
  editorFlowName: '流程名称',
  editorDescription: '一句话描述（可选）',
  editorTimeZone: '锚定时区（可选，如 Asia/Shanghai；留空跟随设备）',
  editorRepeat: '重复',
  editorWeekdaysLabel: '星期',
  editorEveryNDays: '间隔(天)',
  editorSectionScheduled: '定时事件',
  editorSectionSteps: '步骤',
  editorKindTimed: '计时',
  editorKindGate: '确认',
  editorKindInstant: '瞬时',
  editorRepeatOnce: '仅今天',
  editorRepeatDaily: '每天',
  editorRepeatWeekly: '每周',
  editorRepeatEveryN: '隔 N 天',
  weekdayNames: ['日', '一', '二', '三', '四', '五', '六'],
  editorTime: '时间',
  editorDuration: '时长(秒)',
  editorWhy: '为什么（可选）',
  editorEventPlaceholder: '事件（如：早餐后服药）',
  editorStepPlaceholder: '这一步做什么',
  editorAddEvent: '＋ 添加事件',
  editorAddStep: '＋ 添加步骤',
  editorInvalidTimeZone: (name: string): string =>
    `时区名无效：${name}（应为 IANA 名，如 Asia/Shanghai）`,

  // 分享 / 导出
  exportTitle: '分享 · 导出',
  exportHint:
    '分享全文 = 一段人能读懂的做法说明 + 可导入的数据。对方把全文粘进「准时」的导入框，就收下了这条 flow。',
  exportAuthor: '署名（可选，随分享一起标注来源）',
  exportPreview: '预览',
  exportShareFull: '分享全文…',
  exportDataOnly: '仅数据（JSON）',
  exportShareData: '只分享数据',
  shareOutcomeShared: '已唤起分享 ✓',
  shareOutcomeCopied: '已复制全文，去粘贴给朋友吧 ✓',
  shareOutcomeUnavailable: '此环境不支持分享或剪贴板',

  // 导入
  importTitle: '导入',
  importHint: '把朋友分享的全文（或 flow 的 JSON）粘贴到下面，导入到你的库。',
  importNotFound: '没有找到可导入的 flow 数据，请粘贴分享全文或 JSON',
  importConfirm: '确认导入',

  // AI 助手（解读/洞察/差异）
  insightTitle: 'AI 助手',
  insightReading: '解读',
  insightFindings: '洞察',
  insightNoFindings: '没有发现明显问题 👍',
  insightDiffTitle: (version: number): string => `与上一版（v${version}）的差异`,
  insightNoDiff: '与上一版没有差异。',
  insightRestore: '回到上一版',
  insightNote: '以上由本地解释器生成，不含真实模型。AI 永远只提议与解释，改动由你决定、可回退。',

  // AI 生成
  generateTitle: 'AI 生成',
  generateHint: '用一句话描述你的时间模式，AI 会转写成一条 flow 草稿，由你审阅后保存。',
  generatePlaceholder: '例：法压咖啡——倒 92 度热水，浸泡 4 分钟，压下压杆再倒出',
  generateModelSettings: '模型设置',
  generateProviderOpenAI: 'OpenAI 兼容',
  generateBaseUrl: '端点（Base URL）',
  generateModel: '模型',
  generateModelPlaceholder: '如 deepseek-chat',
  generateApiKey: 'API Key（只保存在本机）',
  generateKeyOptional: '本地服务（Ollama）可留空',
  generateBusy: '生成中…',
  generateSubmit: '生成草稿',
  generateFootnote: '生成后会进入编辑器，确认无误再保存；保存即产生可回退的新版本。',
};

export type Strings = typeof zh;

const en: Strings = {
  back: '‹ Back',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',

  brand: 'Zhunshi',
  headerDate: (month, day, weekday) =>
    `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday]}, ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${day}`,
  upNext: 'UP NEXT',
  newSequential: '＋ Sequence',
  newScheduled: '＋ Schedule',
  aiGenerate: '✨ AI draft',
  importAction: 'Import',
  sectionMine: 'MINE',
  sectionExamples: 'EXAMPLES',
  cardMeta: (n, topology) =>
    `${n} ${topology === 'sequential' ? (n === 1 ? 'step' : 'steps') : n === 1 ? 'time' : 'times'} · tap to run`,
  linkInsight: 'Insight',
  linkEdit: 'Edit',
  linkShare: 'Share',

  runDone: 'Done',
  runTotalSteps: (n) => `${n} ${n === 1 ? 'step' : 'steps'}`,
  runStepOf: (i, n, paused) => `Step ${i} of ${n}${paused ? ' · paused' : ''}`,
  runStartAnytime: 'Start anytime',
  runGateHint: 'Confirm when done',
  runInstantHint: 'Tap when done',
  runFlowFinished: 'This flow is complete',
  runTimeUp: "Time's up — continue when ready",
  runRestart: 'Restart',
  runStart: 'Start',
  runConfirm: 'Confirm',
  runCompleteStep: 'Complete step',
  runPrev: 'Previous',
  runResume: 'Resume',
  runPause: 'Pause',
  runSkip: 'Skip',

  nodeNeedsConfirm: 'confirm',
  nodeInstant: 'instant',

  doseUpcoming: 'Upcoming',
  doseDue: 'Due',
  doseTaken: 'Taken',
  doseMissed: 'Missed',
  scheduleToday: (cadence, timeZone) =>
    `Today · ${cadence}${timeZone ? ` · in ${timeZone}` : ''}`,
  scheduleOffDay: (next) =>
    `Not on the cadence today${next ? `. Next: ${next.month}/${next.day} at ${next.time}` : ''}.`,
  scheduleNow: (time) => `Now ${time}`,
  checkIn: 'Check in',
  undo: 'Undo',
  scheduleNote:
    "This list is a reminder aid only — not a medical prescription or diagnosis. Follow your clinician's advice.",

  editorTitle: 'Edit',
  editorFlowName: 'Flow name',
  editorDescription: 'One-line description (optional)',
  editorTimeZone: 'Anchor time zone (optional, e.g. Asia/Shanghai; blank = device)',
  editorRepeat: 'Repeat',
  editorWeekdaysLabel: 'Weekday',
  editorEveryNDays: 'Every (days)',
  editorSectionScheduled: 'TIMED EVENTS',
  editorSectionSteps: 'STEPS',
  editorKindTimed: 'Timed',
  editorKindGate: 'Confirm',
  editorKindInstant: 'Instant',
  editorRepeatOnce: 'Today only',
  editorRepeatDaily: 'Daily',
  editorRepeatWeekly: 'Weekly',
  editorRepeatEveryN: 'Every N days',
  weekdayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  editorTime: 'Time',
  editorDuration: 'Duration (s)',
  editorWhy: 'Why (optional)',
  editorEventPlaceholder: 'Event (e.g. morning pill)',
  editorStepPlaceholder: 'What happens in this step',
  editorAddEvent: '＋ Add event',
  editorAddStep: '＋ Add step',
  editorInvalidTimeZone: (name) =>
    `Invalid time zone: ${name} (use an IANA name like Asia/Shanghai)`,

  exportTitle: 'Share · Export',
  exportHint:
    'The full share text = a human-readable walkthrough plus importable data. Paste the whole text into Zhunshi\'s import box to receive the flow.',
  exportAuthor: 'Sign your name (optional, noted as the source)',
  exportPreview: 'PREVIEW',
  exportShareFull: 'Share full text…',
  exportDataOnly: 'DATA ONLY (JSON)',
  exportShareData: 'Share data only',
  shareOutcomeShared: 'Share sheet opened ✓',
  shareOutcomeCopied: 'Copied — paste it to a friend ✓',
  shareOutcomeUnavailable: 'Sharing and clipboard are unavailable here',

  importTitle: 'Import',
  importHint: "Paste a friend's shared text (or a flow's JSON) below to add it to your library.",
  importNotFound: 'No importable flow data found — paste the full share text or JSON',
  importConfirm: 'Import',

  insightTitle: 'AI Assistant',
  insightReading: 'READING',
  insightFindings: 'INSIGHTS',
  insightNoFindings: 'No obvious issues found 👍',
  insightDiffTitle: (version) => `Changes since v${version}`,
  insightNoDiff: 'No changes from the previous version.',
  insightRestore: 'Restore previous version',
  insightNote:
    'Generated by the local interpreter — no external model involved. AI only proposes and explains; you decide, and changes can be undone.',

  generateTitle: 'AI Draft',
  generateHint: 'Describe your temporal pattern in a sentence; AI drafts a flow for you to review and save.',
  generatePlaceholder: 'e.g. French press — pour 92°C water, steep 4 minutes, press and pour',
  generateModelSettings: 'MODEL SETTINGS',
  generateProviderOpenAI: 'OpenAI-compatible',
  generateBaseUrl: 'Endpoint (Base URL)',
  generateModel: 'Model',
  generateModelPlaceholder: 'e.g. deepseek-chat',
  generateApiKey: 'API Key (stored only on this device)',
  generateKeyOptional: 'Optional for local services (Ollama)',
  generateBusy: 'Generating…',
  generateSubmit: 'Generate draft',
  generateFootnote: 'The draft opens in the editor; saving creates a new, restorable version.',
};

export const STRINGS: Record<Locale, Strings> = { zh, en };
