import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCatalogCycle } from './catalogCycle';

test('旧 deletion recovery 一定先于较新的 mutation，之后再恢复当前 mutation 产生的 intent', async () => {
  const events: string[] = [];
  let recoverCount = 0;

  const result = await runCatalogCycle({
    async recover() {
      recoverCount += 1;
      events.push(`recover:${recoverCount}`);
    },
    async mutation() {
      events.push('mutation');
    },
    async project() {
      events.push('project');
      return 42;
    },
  });

  assert.equal(result, 42);
  assert.deepEqual(events, ['recover:1', 'mutation', 'recover:2', 'project']);
});

test('前置 recovery 失败时绝不执行较新的 mutation', async () => {
  let mutationRan = false;
  await assert.rejects(() =>
    runCatalogCycle({
      async recover() {
        throw new Error('pending delete unavailable');
      },
      async mutation() {
        mutationRan = true;
      },
      async project() {
        return null;
      },
    }),
  );
  assert.equal(mutationRan, false);
});
