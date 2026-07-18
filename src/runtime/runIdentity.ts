/** 一条 Flow 在设备上的可恢复“当前运行”实例 id；同时也是其顺序计时提醒 id。 */
export function activeRunId(flowId: string): string {
  return `active-${flowId}`;
}
