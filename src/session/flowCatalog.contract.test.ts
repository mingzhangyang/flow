// Flow catalog 契约：定义优先级与提醒登记身份必须在开放 ID 空间中保持唯一。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import {
  catalogEntriesWithOwnedPrecedence,
  catalogWithOwnedPrecedence,
  examplesVisibleAlongsideOwned,
  reminderEnrollmentIdentity,
  reminderEnrollmentKey,
  resolveCatalogEntry,
  resolveCatalogFlow,
} from './flowCatalog';

const example: Flow = {
  schemaVersion: 2,
  id: 'shared-id',
  title: '内置示例',
  topology: 'sequential',
  nodes: [],
};

const owned: Flow = {
  ...example,
  title: '用户导入版本',
  version: 1,
};

test('同 id 用户 Flow 遮蔽内置示例', () => {
  assert.deepEqual(examplesVisibleAlongsideOwned([example], [owned]), []);
  assert.deepEqual(catalogWithOwnedPrecedence([example], [owned]), [owned]);
  assert.equal(resolveCatalogFlow('shared-id', [owned], [example])?.title, '用户导入版本');
});

test('没有冲突时示例仍可见、仍可解析', () => {
  const other = { ...owned, id: 'mine' };
  assert.deepEqual(examplesVisibleAlongsideOwned([example], [other]), [example]);
  assert.deepEqual(catalogWithOwnedPrecedence([example], [other]), [other, example]);
  assert.equal(resolveCatalogFlow('shared-id', [other], [example])?.title, '内置示例');
  assert.equal(resolveCatalogFlow('missing', [other], [example]), null);
});

test('source + flowId 编码对任意开放 ID 保持唯一', () => {
  const shadow = reminderEnrollmentIdentity('x', 'owned', [{ ...example, id: 'x' }]);
  const literalCollisionId = shadow.key;
  const unrelated = reminderEnrollmentIdentity(literalCollisionId, 'owned', [example]);

  assert.notEqual(shadow.key, unrelated.key);
  assert.equal(shadow.legacyId, undefined);
  assert.equal(unrelated.legacyId, literalCollisionId);
});

test('shadowing owned 不接受裸 flowId 迁移；非冲突定义保留 legacy alias', () => {
  const shadow = reminderEnrollmentIdentity(example.id, 'owned', [example]);
  assert.equal(shadow.legacyId, undefined);

  const other = { ...owned, id: 'mine' };
  const normal = reminderEnrollmentIdentity(other.id, 'owned', [example]);
  assert.equal(normal.legacyId, 'mine');

  const [entry] = catalogEntriesWithOwnedPrecedence([example], [owned]);
  assert.equal(entry.enrollmentKey, reminderEnrollmentKey(owned.id, 'owned', [example]));
  assert.equal(resolveCatalogEntry('shared-id', [owned], [example])?.legacyEnrollmentId, undefined);
});
