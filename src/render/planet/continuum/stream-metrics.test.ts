// stream-metrics.test.ts
import { describe, expect, it } from 'vitest';
import {
  estimateCoverSeconds, approachSlaPass, APPROACH_COVER_SLA_SEC,
} from './stream-metrics';
import { APPROACH_COVER_SLA_SEC as SLA } from './chunk-types';

describe('stream SLA', () => {
  it('estimates cover time from pending and build rate', () => {
    expect(estimateCoverSeconds(96, 30)).toBeCloseTo(3.2, 1);
    expect(estimateCoverSeconds(0, 30)).toBe(0);
  });

  it('fails SLA when cover seconds exceed budget', () => {
    const report = approachSlaPass({
      coverSeconds: SLA + 1,
      facingMedianTexAt03: 128,
      worstFrameMs: 12,
    });
    expect(report.coverOk).toBe(false);
    expect(report.fidelityOk).toBe(true);
    expect(report.budgetOk).toBe(true);
    expect(report.pass).toBe(false);
  });

  it('fails SLA when facing fidelity is below minimum', () => {
    const report = approachSlaPass({
      coverSeconds: SLA,
      facingMedianTexAt03: 95,
      worstFrameMs: 12,
    });
    expect(report.coverOk).toBe(true);
    expect(report.fidelityOk).toBe(false);
    expect(report.budgetOk).toBe(true);
    expect(report.pass).toBe(false);
  });

  it('fails SLA when worst frame exceeds 60fps budget', () => {
    const report = approachSlaPass({
      coverSeconds: SLA,
      facingMedianTexAt03: 128,
      worstFrameMs: 16.68,
    });
    expect(report.coverOk).toBe(true);
    expect(report.fidelityOk).toBe(true);
    expect(report.budgetOk).toBe(false);
    expect(report.pass).toBe(false);
  });

  it('re-exports APPROACH_COVER_SLA_SEC from chunk-types', () => {
    expect(APPROACH_COVER_SLA_SEC).toBe(SLA);
    expect(APPROACH_COVER_SLA_SEC).toBe(3);
  });
});
