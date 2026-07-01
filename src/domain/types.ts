// 领域类型。这是全系统的地基，对应 constitution/01-domain-model.md。
// 核心区分：Flow（定义，不可变）≠ Run（运行实例，携带事件日志）。

import type { Instant, TimeOfDay } from '../runtime/clock';

/** 当前 Flow 文件格式版本。格式只能加法演进或带迁移（E5）。 */
export const SCHEMA_VERSION = 1;
export type SchemaVersion = typeof SCHEMA_VERSION;

/** 相对时长，整数秒。 */
export type DurationSec = number;

/** 重复方式。v1 仅支持一次性与每日。 */
export type Recurrence = { kind: 'once' } | { kind: 'daily' };

// ---- 节点（5 种，见 01-domain-model.md）----

export interface NodeBase {
  id: string;
  label: string;
  /** 可选的“为什么”。它把 Flow 从配置升为知识（C2、AI-C2）。 */
  rationale?: string;
}

/** 计时步骤：有持续时长，属顺序型拓扑。 */
export interface TimedNode extends NodeBase {
  kind: 'timed';
  durationSec: DurationSec;
}

/** 绝对时刻：钉在墙钟时间上，属日程型拓扑，可重复、可并行独立。 */
export interface ScheduledNode extends NodeBase {
  kind: 'scheduled';
  at: TimeOfDay;
  repeat: Recurrence;
}

/** 手动确认：等待用户确认后才继续（C5）。 */
export interface GateNode extends NodeBase {
  kind: 'gate';
}

/** 瞬时动作 / 检查点：无时长的一步。 */
export interface InstantNode extends NodeBase {
  kind: 'instant';
}

/** 并行组：一组互相独立的子事件（例如同一时刻的多种药）。 */
export interface ParallelNode extends NodeBase {
  kind: 'parallel';
  children: FlowNode[];
}

export type FlowNode =
  | TimedNode
  | ScheduledNode
  | GateNode
  | InstantNode
  | ParallelNode;

export type NodeKind = FlowNode['kind'];

/** 两种时间拓扑，都是一等公民（01-domain-model.md §二）。 */
export type Topology = 'sequential' | 'scheduled';

/** 来源信息。分享/导入的 Flow 应带 provenance（E6）。 */
export interface Provenance {
  author?: string;
  source?: string;
  importedAt?: Instant;
}

/** Flow —— 可复用、不可变的定义。 */
export interface Flow {
  schemaVersion: SchemaVersion;
  id: string;
  title: string;
  description?: string;
  topology: Topology;
  nodes: FlowNode[];
  /** 内容修订号，编辑提交时递增（缺省视为 1）。 */
  version?: number;
  provenance?: Provenance;
}

// ---- Run（运行实例）----

/**
 * Run 事件。这份日志让 Run 可重放、可验证（E4）：现实中的暂停/跳过/回退
 * 都被纳入“输入”，因此 C5（现实优先）与确定性互补而非冲突。
 * 每个事件都携带自己的 Instant（由调用方注入的时钟给出，E3）。
 */
export type RunEvent =
  | { type: 'started'; at: Instant }
  | { type: 'stepCompleted'; index: number; at: Instant }
  | { type: 'skipped'; index: number; at: Instant }
  | { type: 'gateConfirmed'; index: number; at: Instant }
  | { type: 'paused'; at: Instant }
  | { type: 'resumed'; at: Instant }
  | { type: 'wentBack'; toIndex: number; at: Instant };

export type RunEventType = RunEvent['type'];

/**
 * Run —— 某个 Flow 的一次运行实例。
 * `flow` 是定义的快照：Run 一旦开始，其定义对 AI 只读（AI-C1）。
 */
export interface Run {
  id: string;
  flow: Flow;
  events: RunEvent[];
}
