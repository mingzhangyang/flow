// Flow 校验。保证一份定义结构合法、节点类型与拓扑相容。

import { SCHEMA_VERSION, type Flow, type FlowNode, type Topology } from './types';
import { MINUTES_PER_DAY } from '../runtime/clock';

export interface ValidationIssue {
  path: string;
  message: string;
}

const SEQUENTIAL_KINDS = new Set<string>(['timed', 'gate', 'instant']);
const SCHEDULED_KINDS = new Set<string>(['scheduled', 'parallel']);

/** 返回所有问题；空数组表示合法。 */
export function validateFlow(flow: Flow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (flow.schemaVersion !== SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `unsupported schema version ${String(flow.schemaVersion)}` });
  }
  if (!flow.id) issues.push({ path: 'id', message: 'id is required' });
  if (!flow.title) issues.push({ path: 'title', message: 'title is required' });
  if (flow.topology !== 'sequential' && flow.topology !== 'scheduled') {
    issues.push({ path: 'topology', message: `unknown topology "${String(flow.topology)}"` });
  }
  if (flow.nodes.length === 0) {
    issues.push({ path: 'nodes', message: 'a flow needs at least one node' });
  }

  const seenIds = new Set<string>();
  flow.nodes.forEach((node, i) => validateNode(node, `nodes[${i}]`, flow.topology, seenIds, issues));

  return issues;
}

function validateNode(
  node: FlowNode,
  path: string,
  topology: Topology,
  seenIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!node.id) {
    issues.push({ path: `${path}.id`, message: 'node id is required' });
  } else if (seenIds.has(node.id)) {
    issues.push({ path: `${path}.id`, message: `duplicate node id "${node.id}"` });
  } else {
    seenIds.add(node.id);
  }
  if (!node.label) issues.push({ path: `${path}.label`, message: 'node label is required' });

  const allowed = topology === 'sequential' ? SEQUENTIAL_KINDS : SCHEDULED_KINDS;
  if (!allowed.has(node.kind)) {
    issues.push({ path: `${path}.kind`, message: `node kind "${node.kind}" is not allowed in a ${topology} flow` });
  }

  switch (node.kind) {
    case 'timed':
      if (!(node.durationSec > 0)) {
        issues.push({ path: `${path}.durationSec`, message: 'durationSec must be > 0' });
      }
      break;
    case 'scheduled':
      if (!(node.at >= 0 && node.at < MINUTES_PER_DAY)) {
        issues.push({ path: `${path}.at`, message: `at must be within [0, ${MINUTES_PER_DAY}) minutes` });
      }
      break;
    case 'parallel':
      if (node.children.length === 0) {
        issues.push({ path: `${path}.children`, message: 'parallel group needs at least one child' });
      }
      node.children.forEach((child, j) =>
        validateNode(child, `${path}.children[${j}]`, topology, seenIds, issues),
      );
      break;
  }
}

/** 校验失败即抛错，附带全部问题。 */
export function assertValidFlow(flow: Flow): void {
  const issues = validateFlow(flow);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`invalid flow: ${detail}`);
  }
}
