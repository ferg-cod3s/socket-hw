/**
 * Progress tracking for vulnerability scanning
 * Emits progress events that can be consumed by CLI or API
 */

export type ProgressStage =
  | 'detecting-ecosystem'
  | 'gathering-dependencies'
  | 'scanning-packages'
  | 'filtering-advisories'
  | 'finalizing';

export interface ProgressEvent {
  stage: ProgressStage;
  percent: number;
  message: string;
  depsScanned?: number;
  totalDeps?: number;
  timestamp: number;
}

export type ProgressListener = (event: ProgressEvent) => void;

class ProgressTracker {
  private listeners: Set<ProgressListener> = new Set();
  private currentStage: ProgressStage = 'detecting-ecosystem';
  private currentPercent: number = 0;

  /**
   * Subscribe to progress events
   */
  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emit a progress event
   */
  emit(stage: ProgressStage, percent: number, message: string, details?: {
    depsScanned?: number;
    totalDeps?: number;
  }): void {
    this.currentStage = stage;
    this.currentPercent = percent;

    const event: ProgressEvent = {
      stage,
      percent,
      message,
      depsScanned: details?.depsScanned,
      totalDeps: details?.totalDeps,
      timestamp: Date.now(),
    };

    // Emit to all listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Progress listener error:', error);
      }
    }
  }

  /**
   * Get current progress state
   */
  getState() {
    return {
      stage: this.currentStage,
      percent: this.currentPercent,
    };
  }

  /**
   * Clear all listeners
   */
  clear(): void {
    this.listeners.clear();
  }
}

// Export singleton instance
export const progressTracker = new ProgressTracker();

/**
 * Helper function to update progress during scanning
 * Usage in scan.ts:
 *   progressTracker.emit('gathering-dependencies', 20, 'Parsing dependencies...')
 */
export function updateProgress(
  stage: ProgressStage,
  percent: number,
  message: string,
  details?: { depsScanned?: number; totalDeps?: number }
): void {
  progressTracker.emit(stage, percent, message, details);
}
