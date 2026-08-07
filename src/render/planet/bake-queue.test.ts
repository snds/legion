import { describe, it, expect, beforeEach } from 'vitest';
import { enqueueBake, cancelBake, bakeFinished, bakeQueueState } from './bake-queue';

describe('bake-queue', () => {
  beforeEach(() => {
    // Drain any leftover state between tests.
    const { activeId, waiting } = bakeQueueState();
    if (activeId) bakeFinished(activeId);
    for (const id of waiting) cancelBake(id);
    const again = bakeQueueState();
    if (again.activeId) bakeFinished(again.activeId);
  });

  it('runs the first job immediately and queues the rest', () => {
    const started: string[] = [];
    enqueueBake({ id: 'a', start: () => { started.push('a'); } });
    enqueueBake({ id: 'b', start: () => { started.push('b'); } });
    enqueueBake({ id: 'c', start: () => { started.push('c'); } });
    expect(started).toEqual(['a']);
    expect(bakeQueueState()).toEqual({ activeId: 'a', waiting: ['b', 'c'] });

    bakeFinished('a');
    expect(started).toEqual(['a', 'b']);
    bakeFinished('b');
    expect(started).toEqual(['a', 'b', 'c']);
    bakeFinished('c');
    expect(bakeQueueState()).toEqual({ activeId: null, waiting: [] });
  });

  it('dedupes the same id and cancels waiters', () => {
    const started: string[] = [];
    enqueueBake({ id: 'a', start: () => { started.push('a'); } });
    enqueueBake({ id: 'a', start: () => { started.push('a2'); } });
    enqueueBake({ id: 'b', start: () => { started.push('b'); } });
    cancelBake('b');
    expect(bakeQueueState().waiting).toEqual([]);
    bakeFinished('a');
    expect(started).toEqual(['a']);
    expect(bakeQueueState().activeId).toBeNull();
  });
});
