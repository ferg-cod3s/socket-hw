import { describe, it, expect, beforeEach, vi } from 'vitest';
import { progressTracker, updateProgress, type ProgressEvent, type ProgressStage } from '../../src/utils/progress.js';

describe('Progress Tracking', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    progressTracker.clear();
  });

  describe('ProgressTracker', () => {
    it('should emit events to subscribers', () => {
      const listener = vi.fn();
      progressTracker.subscribe(listener);

      updateProgress('detecting-ecosystem', 10, 'Detecting ecosystem...');

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0] as ProgressEvent;
      expect(event.stage).toBe('detecting-ecosystem');
      expect(event.percent).toBe(10);
      expect(event.message).toBe('Detecting ecosystem...');
      expect(event.timestamp).toBeDefined();
    });

    it('should support multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      progressTracker.subscribe(listener1);
      progressTracker.subscribe(listener2);
      progressTracker.subscribe(listener3);

      updateProgress('gathering-dependencies', 25, 'Gathering dependencies...');

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
      expect(listener3).toHaveBeenCalledOnce();
    });

    it('should allow unsubscribing via returned function', () => {
      const listener = vi.fn();
      const unsubscribe = progressTracker.subscribe(listener);

      updateProgress('scanning-packages', 30, 'Scanning packages...');
      expect(listener).toHaveBeenCalledTimes(1);

      // Unsubscribe
      unsubscribe();

      updateProgress('scanning-packages', 50, 'Still scanning...');
      expect(listener).toHaveBeenCalledTimes(1); // Should still be 1
    });

    it('should include dependency details in events', () => {
      const listener = vi.fn();
      progressTracker.subscribe(listener);

      updateProgress('scanning-packages', 40, 'Scanning batch 1/5', {
        depsScanned: 100,
        totalDeps: 500,
      });

      const event = listener.mock.calls[0][0] as ProgressEvent;
      expect(event.depsScanned).toBe(100);
      expect(event.totalDeps).toBe(500);
    });

    it('should handle errors in listeners gracefully', () => {
      const throwingListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const normalListener = vi.fn();

      progressTracker.subscribe(throwingListener);
      progressTracker.subscribe(normalListener);

      // Should not throw
      expect(() => {
        updateProgress('filtering-advisories', 75, 'Filtering...');
      }).not.toThrow();

      expect(throwingListener).toHaveBeenCalledOnce();
      expect(normalListener).toHaveBeenCalledOnce();
    });

    it('should return current state', () => {
      updateProgress('detecting-ecosystem', 10, 'Starting...');
      const state = progressTracker.getState();

      expect(state.stage).toBe('detecting-ecosystem');
      expect(state.percent).toBe(10);

      updateProgress('finalizing', 100, 'Complete');
      const updatedState = progressTracker.getState();

      expect(updatedState.stage).toBe('finalizing');
      expect(updatedState.percent).toBe(100);
    });

    it('should clear all listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      progressTracker.subscribe(listener1);
      progressTracker.subscribe(listener2);

      progressTracker.clear();

      updateProgress('detecting-ecosystem', 10, 'Test');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('should include timestamp with each event', () => {
      const listener = vi.fn();
      progressTracker.subscribe(listener);

      const beforeTime = Date.now();
      updateProgress('gathering-dependencies', 20, 'Gathering...');
      const afterTime = Date.now();

      const event = listener.mock.calls[0][0] as ProgressEvent;
      expect(event.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(event.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should track all valid progress stages', () => {
      const listener = vi.fn();
      progressTracker.subscribe(listener);

      const stages: ProgressStage[] = [
        'detecting-ecosystem',
        'gathering-dependencies',
        'scanning-packages',
        'filtering-advisories',
        'finalizing',
      ];

      stages.forEach((stage, index) => {
        updateProgress(stage, index * 20, `Stage: ${stage}`);
      });

      expect(listener).toHaveBeenCalledTimes(stages.length);

      stages.forEach((stage, index) => {
        const event = listener.mock.calls[index][0] as ProgressEvent;
        expect(event.stage).toBe(stage);
      });
    });

    it('should work with percentage 0-100', () => {
      const listener = vi.fn();
      progressTracker.subscribe(listener);

      updateProgress('scanning-packages', 0, 'Starting');
      updateProgress('scanning-packages', 50, 'Halfway');
      updateProgress('finalizing', 100, 'Complete');

      expect(listener).toHaveBeenCalledTimes(3);

      const call1 = listener.mock.calls[0][0] as ProgressEvent;
      const call2 = listener.mock.calls[1][0] as ProgressEvent;
      const call3 = listener.mock.calls[2][0] as ProgressEvent;

      expect(call1.percent).toBe(0);
      expect(call2.percent).toBe(50);
      expect(call3.percent).toBe(100);
    });

    it('should maintain state across multiple emissions', () => {
      updateProgress('detecting-ecosystem', 10, 'Detecting');
      let state = progressTracker.getState();
      expect(state.percent).toBe(10);

      updateProgress('gathering-dependencies', 20, 'Gathering');
      state = progressTracker.getState();
      expect(state.percent).toBe(20);

      updateProgress('scanning-packages', 30, 'Scanning');
      state = progressTracker.getState();
      expect(state.percent).toBe(30);
    });
  });
});
