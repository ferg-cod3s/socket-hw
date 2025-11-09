import { describe, it, expect, beforeEach } from 'vitest';
import { progressTracker, updateProgress } from '../../src/utils/progress.js';

describe('Progress Tracking Integration', () => {
  let progressEvents: any[] = [];

  beforeEach(() => {
    progressTracker.clear();
    progressEvents = [];

    // Subscribe to all progress events
    progressTracker.subscribe((event) => {
      progressEvents.push(event);
    });
  });

  it('should emit progress events through updateProgress', () => {
    updateProgress('detecting-ecosystem', 10, 'Detecting ecosystem...');

    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0].stage).toBe('detecting-ecosystem');
    expect(progressEvents[0].percent).toBe(10);
  });

  it('should emit events in sequence', () => {
    updateProgress('detecting-ecosystem', 5, 'Starting detection...');
    updateProgress('gathering-dependencies', 20, 'Gathering...');
    updateProgress('scanning-packages', 50, 'Scanning...');
    updateProgress('finalizing', 100, 'Complete');

    expect(progressEvents).toHaveLength(4);
    expect(progressEvents[0].stage).toBe('detecting-ecosystem');
    expect(progressEvents[1].stage).toBe('gathering-dependencies');
    expect(progressEvents[2].stage).toBe('scanning-packages');
    expect(progressEvents[3].stage).toBe('finalizing');
  });

  it('should maintain ascending percentage values', () => {
    updateProgress('detecting-ecosystem', 5, 'Stage 1');
    updateProgress('gathering-dependencies', 25, 'Stage 2');
    updateProgress('scanning-packages', 60, 'Stage 3');
    updateProgress('filtering-advisories', 80, 'Stage 4');
    updateProgress('finalizing', 100, 'Stage 5');

    let lastPercent = 0;
    for (const event of progressEvents) {
      expect(event.percent).toBeGreaterThanOrEqual(lastPercent);
      lastPercent = event.percent;
    }
  });

  it('should track dependency counts in details', () => {
    updateProgress('scanning-packages', 30, 'Found 100 dependencies', {
      depsScanned: 0,
      totalDeps: 100,
    });

    updateProgress('scanning-packages', 50, 'Scanned batch 1/5', {
      depsScanned: 50,
      totalDeps: 100,
    });

    expect(progressEvents[0].depsScanned).toBe(0);
    expect(progressEvents[0].totalDeps).toBe(100);

    expect(progressEvents[1].depsScanned).toBe(50);
    expect(progressEvents[1].totalDeps).toBe(100);
  });

  it('should have valid timestamps', () => {
    const beforeTime = Date.now();
    updateProgress('detecting-ecosystem', 10, 'Test');
    const afterTime = Date.now();

    const event = progressEvents[0];
    expect(event.timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(event.timestamp).toBeLessThanOrEqual(afterTime);
  });

  it('should end at 100%', () => {
    updateProgress('finalizing', 100, 'Complete');
    expect(progressEvents[0].percent).toBe(100);
  });

  it('should support all valid stages', () => {
    const stages = ['detecting-ecosystem', 'gathering-dependencies', 'scanning-packages', 'filtering-advisories', 'finalizing'];

    stages.forEach((stage, index) => {
      updateProgress(stage as any, index * 20, `Stage ${stage}`);
    });

    expect(progressEvents).toHaveLength(stages.length);
    stages.forEach((stage, index) => {
      expect(progressEvents[index].stage).toBe(stage);
    });
  });

  it('should handle concurrent listeners during progress updates', () => {
    const listener1Events: any[] = [];
    const listener2Events: any[] = [];
    const listener3Events: any[] = [];

    progressTracker.clear();
    progressTracker.subscribe((e) => listener1Events.push(e));
    progressTracker.subscribe((e) => listener2Events.push(e));
    progressTracker.subscribe((e) => listener3Events.push(e));

    updateProgress('scanning-packages', 50, 'Test');

    expect(listener1Events).toHaveLength(1);
    expect(listener2Events).toHaveLength(1);
    expect(listener3Events).toHaveLength(1);
    expect(listener1Events[0]).toEqual(listener2Events[0]);
    expect(listener2Events[0]).toEqual(listener3Events[0]);
  });

  it('should include meaningful stage messages', () => {
    updateProgress('detecting-ecosystem', 10, 'Detecting ecosystem...');
    updateProgress('gathering-dependencies', 20, 'Reading dependencies...');
    updateProgress('scanning-packages', 50, 'Scanning batch 1/5');

    for (const event of progressEvents) {
      expect(event.message).toBeDefined();
      expect(event.message.length).toBeGreaterThan(0);
    }
  });

  it('should simulate realistic scan progress flow', () => {
    // Simulate a realistic progress flow during scanning
    updateProgress('detecting-ecosystem', 5, 'Detecting npm ecosystem...');
    updateProgress('gathering-dependencies', 20, 'Found 342 dependencies from package-lock.json');
    updateProgress('scanning-packages', 30, 'Scanning batch 1/7', { depsScanned: 0, totalDeps: 342 });
    updateProgress('scanning-packages', 40, 'Scanning batch 2/7', { depsScanned: 50, totalDeps: 342 });
    updateProgress('scanning-packages', 50, 'Scanning batch 3/7', { depsScanned: 100, totalDeps: 342 });
    updateProgress('scanning-packages', 60, 'Scanning batch 4/7', { depsScanned: 150, totalDeps: 342 });
    updateProgress('scanning-packages', 70, 'Scanning batch 5/7', { depsScanned: 200, totalDeps: 342 });
    updateProgress('filtering-advisories', 80, 'Filtering advisories based on ignore list...');
    updateProgress('finalizing', 100, 'Scan complete');

    expect(progressEvents).toHaveLength(9);
    expect(progressEvents[0].stage).toBe('detecting-ecosystem');
    expect(progressEvents[progressEvents.length - 1].percent).toBe(100);
    expect(progressEvents[progressEvents.length - 1].message).toContain('complete');
  });
});
