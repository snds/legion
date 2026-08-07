import {
  APPROACH_COVER_SLA_SEC,
  APPROACH_FIDELITY_MIN_TEX_AT_03AU,
} from './chunk-types';

export { APPROACH_COVER_SLA_SEC };

export function estimateCoverSeconds(pending: number, buildsPerSec: number): number {
  if (pending <= 0) return 0;
  const rate = Math.max(1e-6, buildsPerSec);
  return pending / rate;
}

export interface ApproachSlaInput {
  coverSeconds: number;
  facingMedianTexAt03: number;
  worstFrameMs: number;
}

export type ApproachSlaReport = ReturnType<typeof approachSlaPass>;

export function approachSlaPass(input: ApproachSlaInput) {
  const coverOk = input.coverSeconds <= APPROACH_COVER_SLA_SEC;
  const fidelityOk = input.facingMedianTexAt03 >= APPROACH_FIDELITY_MIN_TEX_AT_03AU;
  const budgetOk = input.worstFrameMs <= 16.67;
  return { coverOk, fidelityOk, budgetOk, pass: coverOk && fidelityOk && budgetOk };
}
