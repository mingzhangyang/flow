import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type CheckIn } from '../runtime/adherence';
import { loadCheckInsForDefinition } from './checkInPersistence';

const old: CheckIn[] = [{ nodeId: 'dose', scheduledFor: 1, taken: true, at: 2 }];

test('missing v2 会迁移 legacy，并先写 v2 presence marker', async () => {
  const calls: string[] = [];
  const log = await loadCheckInsForDefinition(
    {
      async loadDefinitionCheckInsRecord() { calls.push('load-v2'); return null; },
      async loadCheckIns() { calls.push('load-legacy'); return old; },
      async saveDefinitionCheckIns(_key, value) {
        calls.push(`save-v2:${value.length}`);
      },
      async deleteCheckIns() { calls.push('delete-legacy'); },
    },
    'definition',
    'legacy',
  );
  assert.deepEqual(log, old);
  assert.deepEqual(calls, ['load-v2', 'load-legacy', 'save-v2:1', 'delete-legacy']);
});

test('present-empty v2 永远胜出，不会把 stale legacy 重新导入', async () => {
  let legacyReads = 0;
  const log = await loadCheckInsForDefinition(
    {
      async loadDefinitionCheckInsRecord() { return []; },
      async loadCheckIns() { legacyReads += 1; return old; },
      async saveDefinitionCheckIns() { throw new Error('must not rewrite present v2'); },
      async deleteCheckIns() { throw new Error('cleanup may fail safely'); },
    },
    'definition',
    'legacy',
  );
  assert.deepEqual(log, []);
  assert.equal(legacyReads, 0);
});

test('legacy cleanup 失败不影响已持久化的 v2 读取结果', async () => {
  const log = await loadCheckInsForDefinition(
    {
      async loadDefinitionCheckInsRecord() { return old; },
      async loadCheckIns() { return []; },
      async saveDefinitionCheckIns() {},
      async deleteCheckIns() { throw new Error('cleanup failed'); },
    },
    'definition',
    'legacy',
  );
  assert.deepEqual(log, old);
});
