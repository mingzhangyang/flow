export const motionDuration = {
  instant: 0,
  press: 90,
  fast: 140,
  state: 190,
  insertion: 220,
  emphasis: 260,
  progress: 500,
} as const;

export const motionScale = {
  compactPressed: 0.975,
  cardPressed: 0.988,
  confirmationFrom: 0.92,
} as const;

export const motionDistance = {
  state: 6,
  insertion: 8,
} as const;

export const motionSpring = {
  confirmation: {
    stiffness: 320,
    damping: 30,
    mass: 0.8,
    overshootClamping: true,
  },
} as const;

export type SemanticMotion =
  | 'pressCompact'
  | 'pressCard'
  | 'state'
  | 'insertion'
  | 'confirmation'
  | 'progress';

export interface MotionSpec {
  duration: number;
  scale: number;
  opacity: number;
  translateY: number;
}

const fullMotion: Record<SemanticMotion, MotionSpec> = {
  pressCompact: { duration: motionDuration.press, scale: motionScale.compactPressed, opacity: 1, translateY: 0 },
  pressCard: { duration: motionDuration.press, scale: motionScale.cardPressed, opacity: 1, translateY: 0 },
  state: { duration: motionDuration.state, scale: 1, opacity: 0.78, translateY: motionDistance.state },
  insertion: { duration: motionDuration.insertion, scale: 1, opacity: 0, translateY: motionDistance.insertion },
  confirmation: { duration: motionDuration.emphasis, scale: motionScale.confirmationFrom, opacity: 0.72, translateY: 0 },
  progress: { duration: motionDuration.progress, scale: 1, opacity: 1, translateY: 0 },
};

export function motionSpecFor(reduceMotion: boolean, semantic: SemanticMotion): MotionSpec {
  if (!reduceMotion) return fullMotion[semantic];
  return { duration: motionDuration.instant, scale: 1, opacity: 1, translateY: 0 };
}
