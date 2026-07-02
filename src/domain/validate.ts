// Flow 校验。保证一份定义结构合法、节点类型与拓扑相容。

import { SCHEMA_VERSION, type Flow, type FlowNode, type Recurrence, type Topology } from './types';
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
  if (flow.version !== undefined && !(Number.isInteger(flow.version) && flow.version >= 1)) {
    issues.push({ path: 'version', message: 'version must be an integer >= 1' });
  }
  // 只做形状校验；IANA 名是否真实存在由运行时适配器判定（domain 不触宿主 API）。
  if (flow.timeZone !== undefined && !(typeof flow.timeZone === 'string' && flow.timeZone.trim() !== '')) {
    issues.push({ path: 'timeZone', message: 'timeZone must be a non-empty IANA name when present' });
  }
  // 重复节律在 Flow 级：仅日程型有意义（缺省 = 仅今天）。
  if (flow.repeat !== undefined) {
    if (flow.topology !== 'scheduled') {
      issues.push({ path: 'repeat', message: 'repeat only applies to scheduled flows' });
    } else {
      validateRecurrence(flow.repeat, 'repeat', issues);
    }
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

function validateRecurrence(repeat: Recurrence, path: string, issues: ValidationIssue[]): void {
  switch (repeat?.kind) {
    case 'once':
    case 'daily':
      break;
    case 'weekly': {
      const days = repeat.days;
      const valid =
        Array.isArray(days) &&
        days.length > 0 &&
        days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
        new Set(days).size === days.length;
      if (!valid) {
        issues.push({ path: `${path}.days`, message: 'weekly days must be unique integers within 0..6, at least one' });
      }
      break;
    }
    case 'everyNDays':
      if (!(Number.isInteger(repeat.n) && repeat.n >= 1)) {
        issues.push({ path: `${path}.n`, message: 'everyNDays n must be an integer >= 1' });
      }
      if (!Number.isInteger(repeat.fromDay)) {
        issues.push({ path: `${path}.fromDay`, message: 'everyNDays fromDay must be an integer (local day index)' });
      }
      break;
    default:
      issues.push({ path, message: `unknown recurrence kind "${String((repeat as { kind?: unknown })?.kind)}"` });
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
