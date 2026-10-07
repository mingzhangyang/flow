// Catalog mutation 不能让一个已有事件的 active sequential Run 变得不可达。
// - 已有 owned definition：允许普通内容修订，但 active Run 存在时禁止改 topology。
// - 当前只有 example：如果 example 有 active Run，则禁止创建同-ID owned Flow 去遮蔽它。
// 读取失败直接向上传播（fail closed）。

import { type Flow, type Run } from '../domain/types';
import { catalogDefinitionKey } from './flowCatalog';
import { activeRunId } from './runPersistence';

export class ActiveRunConflictError extends Error {
  constructor() {
    super('Finish or reset the active run before replacing this Flow.');
    this.name = 'ActiveRunConflictError';
  }
}

export interface ActiveRunLookup {
  loadRun(id: string): Promise<Run | null>;
}

function hasStarted(run: Run | null): run is Run {
  return run !== null && run.events.length > 0;
}

export async function assertFlowMutationKeepsActiveRunReachable(opts: {
  nextFlow: Flow;
  currentOwned: Flow | null;
  examples: readonly Flow[];
  runs: ActiveRunLookup;
}): Promise<void> {
  if (opts.currentOwned) {
    const ownedKey = catalogDefinitionKey(opts.nextFlow.id, 'owned');
    const active = await opts.runs.loadRun(activeRunId(ownedKey));
    if (hasStarted(active) && active.flow.topology !== opts.nextFlow.topology) {
      throw new ActiveRunConflictError();
    }
    return;
  }

  if (opts.examples.some((flow) => flow.id === opts.nextFlow.id)) {
    const exampleKey = catalogDefinitionKey(opts.nextFlow.id, 'example');
    const active = await opts.runs.loadRun(activeRunId(exampleKey));
    if (hasStarted(active)) throw new ActiveRunConflictError();
  }
}
