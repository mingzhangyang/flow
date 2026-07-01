// 示例：每日服药 —— 日程型（绝对时刻、每日重复、多药并行独立）。
// 这是产品的创始场景，验证日程型拓扑是一等公民（01-domain-model.md §二）。
// 注意 E6：Flow 是描述性的，绝不构成医疗处方；示例仅作结构演示。

import { SCHEMA_VERSION, type Flow } from '../domain/types';

const hm = (h: number, m: number): number => h * 60 + m;

export const medicationFlow: Flow = {
  schemaVersion: SCHEMA_VERSION,
  id: 'example.medication',
  title: '每日服药提醒',
  description: '示例用药日程；请以医嘱为准。',
  topology: 'scheduled',
  nodes: [
    { kind: 'scheduled', id: 'morning', label: '早餐后：降压药 1 片', at: hm(8, 0), repeat: { kind: 'daily' }, rationale: '随餐服用可减少胃部刺激' },
    { kind: 'scheduled', id: 'noon', label: '午餐后：二甲双胍 1 片', at: hm(14, 0), repeat: { kind: 'daily' } },
    { kind: 'scheduled', id: 'evening', label: '睡前：他汀 1 片', at: hm(22, 0), repeat: { kind: 'daily' }, rationale: '夜间胆固醇合成最活跃' },
  ],
};
