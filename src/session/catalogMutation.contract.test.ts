import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCommittedCatalogMutation } from './catalogMutation';

test('mutation + sync 都成功时返回业务结果', async () => {
  const events: string[] = [];
  const result = await runCommittedCatalogMutation(
    async (mutation) => {
      events.push('refresh:start');
      await mutation();
      events.push('refresh:end');
    },
    async () => {
      events.push('mutation');
      return 42;
    },
  );

  assert.equal(result, 42);
  assert.deepEqual(events, ['refresh:start', 'mutation', 'refresh:end']);
});

test('mutation 本身失败：refresh 仍可收口，但向 UI 返回原 mutation error', async () => {
  const original = new Error('save failed');
  let refreshCompleted = false;

  await assert.rejects(
    () =>
      runCommittedCatalogMutation(
        async (mutation) => {
          await mutation();
          refreshCompleted = true;
        },
        async () => {
          throw original;
        },
      ),
    (error) => error === original,
  );
  assert.equal(refreshCompleted, true);
});

test('mutation 已提交但派生 sync 失败：返回提交结果，不诱导用户重复保存', async () => {
  const result = await runCommittedCatalogMutation(
    async (mutation) => {
      await mutation();
      throw new Error('reminder reschedule failed');
    },
    async () => ({ id: 'saved', version: 2 }),
  );

  assert.deepEqual(result, { id: 'saved', version: 2 });
});

test('refresh 在 mutation 执行前失败：不能伪造业务成功', async () => {
  const syncError = new Error('catalog unavailable');
  let mutationRan = false;

  await assert.rejects(
    () =>
      runCommittedCatalogMutation(
        async () => {
          throw syncError;
        },
        async () => {
          mutationRan = true;
          return 1;
        },
      ),
    (error) => error === syncError,
  );
  assert.equal(mutationRan, false);
});
