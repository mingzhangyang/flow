// 领域类型。这是全系统的地基，对应 constitution/01-domain-model.md。
// 核心区分：Flow（定义，不可变）≠ Run（运行实例，携带事件日志）。

import type { Instant, TimeOfDay } from '../runtime/clock';

/**
 * 当前 Flow 文件格式版本。格式只能加法演进或带迁移（E5）。
 * v2：重复方式从节点上移到 Flow（重复描述的是整个时间模式的节律，见 ADR-0003）；
 *     v1 数据在反序列化时自动迁移（serialize.ts）。
 */
export const SCHEMA_VERSION = 2;
export type SchemaVersion = typeof SCHEMA_VERSION;

/** 相对时长，整数秒。 */
export type DurationSec = number;

/**
 * 重复方式（加法演进，E5）。缺省应为 once——「不重复」是最保守的默认。
 * - once：仅今天这一次（到点提醒，过时不候；运行时无状态，不跨日顺延）。
 * - daily：每天。
 * - weekly：每周指定的星期几（0=周日 … 6=周六，与 JS Date#getDay 一致）。
 * - everyNDays：每 N 天一次，从 fromDay（本地日序号，见 runtime/clock 的 localDayIndex）起算。
 */
export type Recurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] }
  | { kind: 'everyNDays'; n: number; fromDay: number };

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

/** 绝对时刻：钉在墙钟时间上，属日程型拓扑，可并行独立。重复节律在 Flow 级（Flow.repeat）。 */
export interface ScheduledNode extends NodeBase {
  kind: 'scheduled';
  at: TimeOfDay;
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
  /**
   * 可选的锚定时区（IANA 名，如 "Asia/Shanghai"）。设置后，日程型节点的墙钟
   * 时刻按此时区换算而非设备时区——出差时仍按家里的时区提醒。缺省跟随设备。
   * 加法演进（E5）：旧数据无此字段，行为不变。
   */
  timeZone?: string;
  /**
   * 日程型 flow 的重复节律（整个模式一起重复；缺省 = 仅今天，默认不重复）。
   * 只对 topology === 'scheduled' 有意义；顺序型 flow 由用户随时手动运行。
   */
  repeat?: Recurrence;
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
