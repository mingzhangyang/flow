import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import {
  catalogDefinitionKey,
  catalogEntriesWithOwnedPrecedence,
  catalogWithOwnedPrecedence,
  examplesVisibleAlongsideOwned,
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
const owned: Flow = { ...example, title: '用户版本', version: 1 };

test('owned 同 id 遮蔽 example，但二者 definitionKey 永远不同', () => {
  assert.deepEqual(examplesVisibleAlongsideOwned([example], [owned]), []);
  assert.deepEqual(catalogWithOwnedPrecedence([example], [owned]), [owned]);
  assert.notEqual(
    catalogDefinitionKey(example.id, 'example'),
    catalogDefinitionKey(owned.id, 'owned'),
  );
});

test('definitionKey 对开放 ID 保持注入性', () => {
  const a = catalogDefinitionKey('x', 'owned');
  const b = catalogDefinitionKey(a, 'owned');
  const c = catalogDefinitionKey('x', 'example');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('catalog 解析统一 owned > example', () => {
  assert.equal(resolveCatalogFlow('shared-id', [owned], [example])?.title, '用户版本');
  assert.equal(resolveCatalogEntry('shared-id', [owned], [example])?.source, 'owned');
  assert.equal(resolveCatalogFlow('missing', [owned], [example]), null);
});

test('通知必须精确匹配当前可见 definitionKey；stale / malformed key 都 fail closed', () => {
  const ownedKey = catalogDefinitionKey(owned.id, 'owned');
  const exampleKey = catalogDefinitionKey(example.id, 'example');
  assert.equal(resolveCatalogEntryForRoute(owned.id, 'bare-id', [owned], [example]), null);
  assert.equal(resolveCatalogEntryForRoute(owned.id, exampleKey, [owned], [example]), null);
  assert.equal(resolveCatalogEntryForRoute(owned.id, ownedKey, [owned], [example])?.source, 'owned');
  assert.equal(catalogEntriesWithOwnedPrecedence([example], [owned])[0]?.definitionKey, ownedKey);
});
