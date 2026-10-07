import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow, type Run } from '../domain/types';
import { catalogDefinitionKey } from './flowCatalog';
import { activeRunId } from './runPersistence';
import { ActiveRunConflictError, assertFlowMutationKeepsActiveRunReachable } from './catalogRunGuard';

const sequential: Flow = {
  schemaVersion: 2,
  id: 'same',
  title: 'Sequential',
  topology: 'sequential',
  nodes: [],
};
const scheduled: Flow = {
  ...sequential,
  title: 'Scheduled',
  topology: 'scheduled',
};

function lookup(entries: Record<string, Run>) {
  return {
    async loadRun(id: string) {
      return entries[id] ?? null;
    },
  };
}

test('active owned Run 存在时禁止 topology replacement', async () => {
  const key = catalogDefinitionKey('same', 'owned');
  const run: Run = { id: activeRunId(key), flow: sequential, events: [{ type: 'started', at: 1 }] };

  await assert.rejects(
    () => assertFlowMutationKeepsActiveRunReachable({
      nextFlow: scheduled,
      currentOwned: sequential,
      examples: [],
      runs: lookup({ [run.id]: run }),
    }),
    ActiveRunConflictError,
  );
});

test('active owned Run 不阻止同 topology 内容修订；Run 继续使用自己的 snapshot', async () => {
  const key = catalogDefinitionKey('same', 'owned');
  const run: Run = { id: activeRunId(key), flow: sequential, events: [{ type: 'started', at: 1 }] };

  await assert.doesNotReject(() =>
    assertFlowMutationKeepsActiveRunReachable({
      nextFlow: { ...sequential, title: 'Edited' },
      currentOwned: sequential,
      examples: [],
      runs: lookup({ [run.id]: run }),
    }),
  );
});

test('active example Run 存在时禁止同-ID owned Flow 遮蔽它', async () => {
  const key = catalogDefinitionKey('same', 'example');
  const run: Run = { id: activeRunId(key), flow: sequential, events: [{ type: 'started', at: 1 }] };

  await assert.rejects(
    () => assertFlowMutationKeepsActiveRunReachable({
      nextFlow: sequential,
      currentOwned: null,
      examples: [sequential],
      runs: lookup({ [run.id]: run }),
    }),
    ActiveRunConflictError,
  );
});

test('只有空闲 Run 时 mutation 可以继续', async () => {
  const key = catalogDefinitionKey('same', 'owned');
  const run: Run = { id: activeRunId(key), flow: sequential, events: [] };
  await assert.doesNotReject(() =>
    assertFlowMutationKeepsActiveRunReachable({
      nextFlow: scheduled,
      currentOwned: sequential,
      examples: [],
      runs: lookup({ [run.id]: run }),
    }),
  );
});
