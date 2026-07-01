// Flow 编辑：纯变换。每个函数返回新的 Flow，绝不修改入参（Flow 不可变）。
// 编辑“可以复杂”（C4 的对偶）；这里只做结构变换，版本递增与历史留存交给 library。

import { SCHEMA_VERSION, type Flow, type FlowNode, type Topology } from './types';

/** 一个尚未成型的空 Flow（version 1）。 */
export function createFlow(params: {
  id: string;
  title: string;
  topology: Topology;
  description?: string;
}): Flow {
  return {
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    id: params.id,
    title: params.title,
    description: params.description,
    topology: params.topology,
    nodes: [],
  };
}

export function setMeta(flow: Flow, meta: { title?: string; description?: string }): Flow {
  return {
    ...flow,
    title: meta.title ?? flow.title,
    description: meta.description ?? flow.description,
  };
}

export function addNode(flow: Flow, node: FlowNode): Flow {
  return { ...flow, nodes: [...flow.nodes, node] };
}

export function updateNode(flow: Flow, id: string, patch: Partial<FlowNode>): Flow {
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as FlowNode) : n)),
  };
}

export function removeNode(flow: Flow, id: string): Flow {
  return { ...flow, nodes: flow.nodes.filter((n) => n.id !== id) };
}

/** 上移（dir=-1）或下移（dir=+1）某个节点。越界则原样返回。 */
export function moveNode(flow: Flow, id: string, dir: -1 | 1): Flow {
  const i = flow.nodes.findIndex((n) => n.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= flow.nodes.length) return flow;
  const nodes = [...flow.nodes];
  [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
  return { ...flow, nodes };
}
