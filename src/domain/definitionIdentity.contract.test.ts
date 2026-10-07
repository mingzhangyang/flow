import { test } from 'node:test';
import assert from 'node:assert/strict';

import { definitionKey, parseDefinitionKey, type DefinitionSource } from './definitionIdentity';

test('definition identity 对开放 flowId 做 canonical round-trip', () => {
  const flowId = '__proto__/x/\ud800';
  for (const source of ['owned', 'example'] as const satisfies readonly DefinitionSource[]) {
    const identity = { source, flowId };
    assert.deepEqual(parseDefinitionKey(definitionKey(identity)), identity);
  }
});

test('parser 只接受精确 canonical definition-v1 tuple', () => {
  const canonical = definitionKey({ source: 'owned', flowId: 'x' });

  assert.equal(parseDefinitionKey('x'), null);
  assert.equal(parseDefinitionKey(` ${canonical}`), null);
  assert.equal(parseDefinitionKey(JSON.stringify(['definition-v1', 'owned', 'x', 'extra'])), null);
  assert.equal(parseDefinitionKey(JSON.stringify(['definition-v1', 'other', 'x'])), null);
  assert.equal(parseDefinitionKey(JSON.stringify(['definition-v2', 'owned', 'x'])), null);
  assert.equal(parseDefinitionKey(JSON.stringify(['definition-v1', 'owned', ''])), null);
  assert.throws(() => definitionKey({ source: 'owned', flowId: '' }));
});
