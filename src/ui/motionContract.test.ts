import assert from 'node:assert/strict';
import test from 'node:test';
import { motionDuration, motionSpecFor } from './motionContract';

test('motion contract keeps semantic durations centralized', () => {
  assert.equal(motionSpecFor(false, 'pressCompact').duration, motionDuration.press);
  assert.equal(motionSpecFor(false, 'insertion').duration, motionDuration.insertion);
  assert.equal(motionSpecFor(false, 'progress').duration, motionDuration.progress);
});

test('reduced motion removes movement while preserving final visual state', () => {
  for (const semantic of ['pressCompact', 'pressCard', 'state', 'insertion', 'confirmation', 'progress'] as const) {
    assert.deepEqual(motionSpecFor(true, semantic), {
      duration: 0,
      scale: 1,
      opacity: 1,
      translateY: 0,
    });
  }
});
