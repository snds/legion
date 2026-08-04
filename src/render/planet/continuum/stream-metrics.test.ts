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
});
