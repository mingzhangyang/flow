// Flow 序列化。开放、可读、可 diff 的格式（E5）；序列化 <-> 反序列化无损。
// 规范化的 JSON；旧版本在反序列化时迁移（E5：加法演进或带迁移）。

import { SCHEMA_VERSION, type Flow, type FlowNode, type Recurrence } from './types';
import { assertValidFlow } from './validate';

/** 序列化为规范 JSON 文本（缩进 2、末尾换行，利于 Git 与人类阅读）。 */
export function serializeFlow(flow: Flow): string {
  assertValidFlow(flow);
  return JSON.stringify(flow, null, 2) + '\n';
}

/** 从开放格式 JSON 解析出一份 Flow；旧 schema 自动迁移，然后校验。 */
export function deserializeFlow(text: string): Flow {
  return coerceFlow(JSON.parse(text));
}

/**
 * 已解析的 JSON 值 → 合法 Flow：旧 schema 迁移 + 校验。
 * 持久层读回的任何 flow 快照（Run 内嵌、历史修订）都应经此闸门，
 * 保证旧数据升级后仍被迁移、坏数据不会流入纯核心（E5）。
 */
export function coerceFlow(data: unknown): Flow {
  let flow = data as Flow;
  if ((flow as { schemaVersion?: number }).schemaVersion === 1) {
    flow = migrateV1(flow);
  }
  assertValidFlow(flow);
  return flow;
}

/**
 * v1 → v2：重复方式从节点上移到 Flow（ADR-0003）。
 * v1 允许各节点节律不同；v2 的 Flow 只有一个节律——取第一个 scheduled 节点的
 * repeat 作为整条 flow 的节律（v1 期无真实用户数据，混合节律仅存在于理论上）。
 */
function migrateV1(v1: Flow): Flow {
  type V1Node = FlowNode & { repeat?: Recurrence };
  let flowRepeat: Recurrence | undefined;

  const stripped = (nodes: V1Node[]): FlowNode[] =>
    nodes.map((node) => {
      if (node.kind === 'scheduled') {
        const { repeat, ...rest } = node;
        flowRepeat = flowRepeat ?? repeat;
        return rest as FlowNode;
      }
      if (node.kind === 'parallel') {
        return { ...node, children: stripped(node.children as V1Node[]) };
      }
      return node;
    });

  const nodes = stripped(v1.nodes as V1Node[]);
  return {
    ...v1,
    schemaVersion: SCHEMA_VERSION,
    nodes,
    ...(v1.topology === 'scheduled' && flowRepeat ? { repeat: flowRepeat } : {}),
  };
}
