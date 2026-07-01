// Flow 序列化。开放、可读、可 diff 的格式（E5）；序列化 <-> 反序列化无损。
// v1 采用规范化的 JSON。将来若引入更易读的 DSL，也只是这层之上的翻译（03-engineering.md）。

import { type Flow } from './types.ts';
import { assertValidFlow } from './validate.ts';

/** 序列化为规范 JSON 文本（缩进 2、末尾换行，利于 Git 与人类阅读）。 */
export function serializeFlow(flow: Flow): string {
  assertValidFlow(flow);
  return JSON.stringify(flow, null, 2) + '\n';
}

/** 从开放格式 JSON 解析出一份 Flow，并校验。 */
export function deserializeFlow(text: string): Flow {
  const data = JSON.parse(text) as Flow;
  assertValidFlow(data);
  return data;
}
