// Flow catalog 契约：定义优先级与提醒登记身份必须在开放 ID 空间中保持唯一。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import {
  catalogEntriesWithOwnedPrecedence,
  catalogWithOwnedPrecedence,
  examplesVisibleAlongsideOwned,
  catalogDefinitionIdentity,
  reminderEnrollmentKey,
  resolveCatalogEntry,
  resolveCatalogEntryForRoute,
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
  const shadow = catalogDefinitionIdentity('x', 'owned', [{ ...example, id: 'x' }]);
  const literalCollisionId = shadow.key;
  const unrelated = catalogDefinitionIdentity(literalCollisionId, 'owned', [example]);

  assert.notEqual(shadow.key, unrelated.key);
  assert.equal(shadow.legacyFlowId, undefined);
  assert.equal(unrelated.legacyFlowId, literalCollisionId);
});

test('shadowing owned 不接受裸 flowId 迁移；非冲突定义保留 legacy alias', () => {
  const shadow = catalogDefinitionIdentity(example.id, 'owned', [example]);
  assert.equal(shadow.legacyFlowId, undefined);

  const other = { ...owned, id: 'mine' };
  const normal = catalogDefinitionIdentity(other.id, 'owned', [example]);
  assert.equal(normal.legacyFlowId, 'mine');

  const [entry] = catalogEntriesWithOwnedPrecedence([example], [owned]);
  assert.equal(entry.definitionKey, reminderEnrollmentKey(owned.id, 'owned', [example]));
  assert.equal(resolveCatalogEntry('shared-id', [owned], [example])?.legacyFlowId, undefined);
});


test('旧通知或错误 definitionKey 不会在 shadowing 后打开同 id 的另一份定义', () => {
  const exampleIdentity = catalogDefinitionIdentity(example.id, 'example', [example]);
  const ownedIdentity = catalogDefinitionIdentity(owned.id, 'owned', [example]);

  assert.equal(resolveCatalogEntryForRoute(example.id, exampleIdentity.key, [owned], [example]), null);
  assert.equal(
    resolveCatalogEntryForRoute(owned.id, ownedIdentity.key, [owned], [example])?.source,
    'owned',
  );
  assert.equal(resolveCatalogEntryForRoute(owned.id, undefined, [owned], [example]), null);
});
