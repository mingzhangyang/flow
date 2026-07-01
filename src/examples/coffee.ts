// 示例：法压咖啡 —— 顺序型（相对计时）。
// 体现 C2（Flow 是可阅读的知识）与 C3（节点表达事件而非时间）。

import { SCHEMA_VERSION, type Flow } from '../domain/types';

export const coffeeFlow: Flow = {
  schemaVersion: SCHEMA_VERSION,
  version: 1,
  id: 'example.coffee',
  title: '法压咖啡',
  description: '一杯基础法压壶咖啡的冲泡流程。',
  topology: 'sequential',
  nodes: [
    { kind: 'instant', id: 'water', label: '加入热水' },
    { kind: 'timed', id: 'steep', label: '浸泡', durationSec: 240, rationale: '让咖啡粉充分萃取' },
    { kind: 'instant', id: 'stir', label: '搅拌' },
    { kind: 'timed', id: 'settle', label: '静置', durationSec: 30, rationale: '让粉末沉降，减少入口的苦涩' },
    { kind: 'gate', id: 'press', label: '缓慢压杆', rationale: '过快下压会过度萃取' },
  ],
};
