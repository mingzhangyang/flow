// Flow catalog 契约：导入/用户数据与内置示例发生 id 冲突时，用户 Flow 永远胜出。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import {
  catalogWithOwnedPrecedence,
  examplesVisibleAlongsideOwned,
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
