import assert from 'node:assert/strict';
import test from 'node:test';
import { composePressTransform } from './motionContract';

test('press transform preserves static caller transform entries', () => {
  const result = composePressTransform(
    [{ rotate: '8deg' }, { translateY: 3 }],
    0.975,
  );

  assert.deepEqual(result, [
    { rotate: '8deg' },
    { translateY: 3 },
    { scale: 0.975 },
  ]);
});

test('press transform preserves transforms produced by a style callback', () => {
  const style = (state: { pressed: boolean }) => ({
    transform: [
      { translateX: state.pressed ? 4 : 0 },
      { rotate: state.pressed ? '2deg' : '0deg' },
    ],
  });

  const callbackStyle = style({ pressed: true });
  const result = composePressTransform(callbackStyle.transform, 0.988);

  assert.deepEqual(result, [
    { translateX: 4 },
    { rotate: '2deg' },
    { scale: 0.988 },
  ]);
});

test('press transform composes RN string transforms with press scale', () => {
  assert.equal(
    composePressTransform('rotate(8deg)', 0.975),
    'rotate(8deg) scale(0.975)',
  );
});
