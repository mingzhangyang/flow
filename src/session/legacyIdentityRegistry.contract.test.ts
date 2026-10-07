import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKV } from '../storage/kv';
import { markLegacyAmbiguousFlowId, readLegacyAmbiguousFlowIds } from './legacyIdentityRegistry';

test('legacy ambiguity tombstone 持久、幂等，并支持任意开放字符串 ID', async () => {
  const kv = createInMemoryKV();
  await markLegacyAmbiguousFlowId(kv, 'same');
  await markLegacyAmbiguousFlowId(kv, 'same');
  await markLegacyAmbiguousFlowId(kv, '\ud800');

  assert.deepEqual(await readLegacyAmbiguousFlowIds(kv), ['same', '\ud800'].sort());
});

test('损坏 quarantine 数据 fail closed，而不是静默重新开放 legacy alias', async () => {
  const kv = createInMemoryKV();
  await kv.setItem('catalog:legacy-ambiguous-flow-ids:v1', '{"bad":true}');
  await assert.rejects(() => readLegacyAmbiguousFlowIds(kv));
});
