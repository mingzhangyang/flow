import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAnimateReveal } from './motionContract';

test('reveal does not replay old UI state when Reduce Motion preference changes', () => {
  assert.equal(shouldAnimateReveal({
    active: true,
    reducedMotion: true,
    firstRender: true,
    animateOnMount: true,
    replayChanged: false,
  }), false);

  assert.equal(shouldAnimateReveal({
    active: true,
    reducedMotion: false,
    firstRender: false,
    animateOnMount: true,
    replayChanged: false,
  }), false);

  assert.equal(shouldAnimateReveal({
    active: true,
    reducedMotion: false,
    firstRender: false,
    animateOnMount: true,
    replayChanged: true,
  }), true);
});
