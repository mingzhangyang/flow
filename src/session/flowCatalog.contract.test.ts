// Flow catalog 契约：用户 Flow 遮蔽示例时，定义解析与提醒登记身份都保持一致。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type Flow } from '../domain/types';
import {
  catalogEntriesWithOwnedPrecedence,
  catalogWithOwnedPrecedence,
  examplesVisibleAlongsideOwned,
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

test('提醒登记身份只在 owned shadow 冲突时与裸 flowId 分离', () => {
  const exampleKey = reminderEnrollmentKey(example.id, 'example', [example]);
  const ownedKey = reminderEnrollmentKey(owned.id, 'owned', [example]);
  assert.equal(exampleKey, 'shared-id');
  assert.notEqual(ownedKey, exampleKey);

  const [entry] = catalogEntriesWithOwnedPrecedence([example], [owned]);
  assert.equal(entry.source, 'owned');
  assert.equal(entry.enrollmentKey, ownedKey);

  const resolved = resolveCatalogEntry('shared-id', [owned], [example]);
  assert.equal(resolved?.source, 'owned');
  assert.equal(resolved?.enrollmentKey, ownedKey);
});

test('非冲突用户 Flow 沿用旧 flowId enrollment key，兼容已有登记', () => {
  const other = { ...owned, id: 'mine' };
  assert.equal(reminderEnrollmentKey(other.id, 'owned', [example]), 'mine');
});
