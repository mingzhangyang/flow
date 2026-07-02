// 服药依从（打卡/漏服）纯逻辑。对应创始场景与 01-domain-model.md §二的日程型拓扑。
// 关键：每个剂量相互独立——漏一颗不阻塞其它（C5「现实优先」的非阻塞体现）。
// 时钟显式注入（E3），确定性可测（E4）。真正的持久化交给 Storage、下发交给 Notifier。

import { type Flow, type FlowNode, type ScheduledNode } from '../domain/types';
import { type Instant, type TimeZoneLike, instantAtTimeOfDay, MS_PER_MINUTE } from './clock';
import { occursOnDay } from './recurrence';

export type DoseStatus =
  | 'upcoming' // 未到点
  | 'due' // 到点、宽限期内可服
  | 'taken' // 已打卡服用
  | 'missed'; // 过了宽限期未服，或被显式标记未服

/** 一次打卡记录：对某个剂量占位（nodeId + 当天该时刻）的确认。 */
export interface CheckIn {
  nodeId: string;
  scheduledFor: Instant; // 该剂量在当天的绝对时刻
  taken: boolean; // true=已服；false=显式标记未服
  at: Instant; // 打卡发生的时刻
}

/** 某个剂量在 now 时刻的可观察状态。 */
export interface DoseState {
  nodeId: string;
  label: string;
  scheduledFor: Instant;
  status: DoseStatus;
  takenAt: Instant | null;
}

/** 构造一条打卡记录。 */
export function checkIn(nodeId: string, scheduledFor: Instant, taken: boolean, at: Instant): CheckIn {
  return { nodeId, scheduledFor, taken, at };
}

/**
 * 计算“今天”每个剂量在 now 时刻的状态。
 * @param graceMinutes 到点后仍算“可服（due）”的宽限分钟数；超出则记为 missed。
 */
export function todayDoses(
  flow: Flow,
  checkIns: CheckIn[],
  now: Instant,
  tz: TimeZoneLike,
  graceMinutes: number,
): DoseState[] {
  if (flow.topology !== 'scheduled') return [];
  const graceMs = graceMinutes * MS_PER_MINUTE;

  // 重复节律在 Flow 级：今天不在节律上，整条 flow 今天就没有剂量。
  if (!occursOnDay(flow.repeat ?? { kind: 'once' }, now, tz)) return [];
  const doses = scheduledNodes(flow.nodes).map((node): DoseState => {
    // 逐节点按墙钟换算（DST 正确）：切换日"午夜 + at 分钟"会偏一小时。
    const scheduledFor = instantAtTimeOfDay(now, node.at, tz);
    const ci = checkIns.find((c) => c.nodeId === node.id && c.scheduledFor === scheduledFor);

    let status: DoseStatus;
    let takenAt: Instant | null = null;
    if (ci && ci.taken) {
      status = 'taken';
      takenAt = ci.at;
    } else if (ci && !ci.taken) {
      status = 'missed'; // 被显式标记未服
    } else if (now < scheduledFor) {
      status = 'upcoming';
    } else if (now <= scheduledFor + graceMs) {
      status = 'due';
    } else {
      status = 'missed';
    }
    return { nodeId: node.id, label: node.label, scheduledFor, status, takenAt };
  });

  doses.sort((a, b) => a.scheduledFor - b.scheduledFor);
  return doses;
}

/** 在打卡日志中登记/覆盖一条记录（同 nodeId+scheduledFor 视为同一占位）。 */
export function recordCheckIn(log: CheckIn[], entry: CheckIn): CheckIn[] {
  const rest = log.filter((c) => !(c.nodeId === entry.nodeId && c.scheduledFor === entry.scheduledFor));
  return [...rest, entry];
}

function scheduledNodes(nodes: FlowNode[]): ScheduledNode[] {
  const acc: ScheduledNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'scheduled') acc.push(node);
    else if (node.kind === 'parallel') acc.push(...scheduledNodes(node.children));
  }
  return acc;
}
