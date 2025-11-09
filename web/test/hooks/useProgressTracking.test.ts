import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useProgressTracking } from '../../src/hooks/useProgressTracking';

describe('useProgressTracking Hook', () => {
  let eventSourceInstance: any;
  let mockEventSourceClass: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create a mock EventSource class that we can spy on
    mockEventSourceClass = vi.fn(function (this: any, url: string) {
      this.url = url;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.close = vi.fn();
      this.readyState = 1; // OPEN
      this.OPEN = 1;
      this.CLOSED = 2;
      this.addEventListener = vi.fn();
      this.removeEventListener = vi.fn();

      // Store the instance so tests can access it
      eventSourceInstance = this;
    });

    mockEventSourceClass.OPEN = 1;
    mockEventSourceClass.CLOSED = 2;

    global.EventSource = mockEventSourceClass as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers(); // Ensure timers are reset after each test
  });

  it('should return null progress when jobId is null', () => {
    const { result } = renderHook(() => useProgressTracking(null));

    expect(result.current.progress).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should establish EventSource connection when jobId is provided', () => {
    renderHook(() => useProgressTracking('job-123'));

    expect(mockEventSourceClass).toHaveBeenCalledWith('/api/scan/progress?jobId=job-123');
  });

  it('should create EventSource instance with correct URL format', () => {
    renderHook(() => useProgressTracking('my-job-id'));

    const callArgs = mockEventSourceClass.mock.calls[0][0];
    expect(callArgs).toContain('/api/scan/progress');
    expect(callArgs).toContain('my-job-id');
  });

  it('should handle invalid JSON messages gracefully', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // Wait for handlers to be attached
    await waitFor(() => {
      expect(eventSourceInstance.onmessage).not.toBeNull();
    });

    // Simulate invalid message - should not crash
    expect(() => {
      act(() => {
        eventSourceInstance.onmessage({
          data: 'not-valid-json{',
        });
      });
    }).not.toThrow();

    // Progress should still be null since message was invalid
    expect(result.current.progress).toBeNull();
  });

  it('should create and store EventSource on mount', () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // Verify EventSource was created with correct URL
    expect(mockEventSourceClass).toHaveBeenCalledWith(expect.stringContaining('job-123'));

    // Verify the hook returns the expected initial state
    expect(result.current.isConnected).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should not attempt connection when jobId is empty string', () => {
    mockEventSourceClass.mockClear();

    renderHook(() => useProgressTracking(''));

    expect(mockEventSourceClass).not.toHaveBeenCalled();
  });

  it('should handle rerendering with different props', () => {
    const { rerender } = renderHook(({ jobId }) => useProgressTracking(jobId), { initialProps: { jobId: 'job-123' } });

    expect(mockEventSourceClass).toHaveBeenCalledWith(expect.stringContaining('job-123'));

    mockEventSourceClass.mockClear();
    rerender({ jobId: 'job-456' });

    // Hook should connect to new job
    expect(mockEventSourceClass).toHaveBeenCalledWith(expect.stringContaining('job-456'));
  });

  it('should encode jobId in URL', () => {
    renderHook(() => useProgressTracking('job-with-special-chars'));

    const callArgs = mockEventSourceClass.mock.calls[0][0];
    expect(callArgs).toContain('job-with-special-chars');
  });

  it('should support multiple concurrent jobs', () => {
    mockEventSourceClass.mockClear();

    renderHook(() => useProgressTracking('job-1'));
    renderHook(() => useProgressTracking('job-2'));
    renderHook(() => useProgressTracking('job-3'));

    expect(mockEventSourceClass).toHaveBeenCalledTimes(3);
    expect(mockEventSourceClass).toHaveBeenCalledWith(expect.stringContaining('job-1'));
    expect(mockEventSourceClass).toHaveBeenCalledWith(expect.stringContaining('job-2'));
    expect(mockEventSourceClass).toHaveBeenCalledWith(expect.stringContaining('job-3'));
  });

  it('should initialize with proper return types', () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // progress can be null or an object
    expect(result.current.progress === null || typeof result.current.progress === 'object').toBe(true);
    expect(typeof result.current.isConnected).toBe('boolean');
    // error can be null or a string
    expect(result.current.error === null || typeof result.current.error === 'string').toBe(true);
  });

  it('should handle URL parameters correctly', () => {
    renderHook(() => useProgressTracking('scan-abc123'));

    const callArgs = mockEventSourceClass.mock.calls[0][0];
    expect(callArgs).toMatch(/jobId=scan-abc123/);
  });

  it('should return hook interface with proper structure', () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    expect(result.current).toHaveProperty('progress');
    expect(result.current).toHaveProperty('isConnected');
    expect(result.current).toHaveProperty('error');
  });

  it('should set isConnected to true when connection opens', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    expect(result.current.isConnected).toBe(false);

    // Wait for hook to attach handlers
    await waitFor(() => {
      expect(eventSourceInstance.onopen).not.toBeNull();
    });

    // Trigger onopen event
    act(() => {
      eventSourceInstance.onopen();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
    expect(result.current.error).toBeNull();
  });

  it('should reset error state when connection opens', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // Wait for handlers to be attached
    await waitFor(() => {
      expect(eventSourceInstance.onerror).not.toBeNull();
    });

    // Manually set an error first (simulate previous error)
    act(() => {
      eventSourceInstance.onerror({ target: eventSourceInstance });
    });

    // Wait for error to be set
    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });

    // Now trigger onopen - should clear error
    act(() => {
      eventSourceInstance.onopen();
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.isConnected).toBe(true);
    });
  });

  it('should parse and update progress on valid message', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    const progressData = {
      stage: 'scanning',
      percent: 50,
      depsScanned: 5,
      totalDeps: 10,
    };

    // Wait for hook to attach handlers
    await waitFor(() => {
      expect(eventSourceInstance.onmessage).not.toBeNull();
    });

    // Trigger onmessage with valid JSON
    act(() => {
      eventSourceInstance.onmessage({
        data: JSON.stringify(progressData),
      });
    });

    await waitFor(() => {
      expect(result.current.progress).toEqual(progressData);
    });
  });

  it('should update progress multiple times with different data', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    const progressData1 = {
      stage: 'scanning',
      percent: 25,
      depsScanned: 2,
      totalDeps: 8,
    };

    const progressData2 = {
      stage: 'analyzing',
      percent: 75,
      depsScanned: 6,
      totalDeps: 8,
    };

    // Wait for hook to attach handlers
    await waitFor(() => {
      expect(eventSourceInstance.onmessage).not.toBeNull();
    });

    // First update
    act(() => {
      eventSourceInstance.onmessage({
        data: JSON.stringify(progressData1),
      });
    });

    await waitFor(() => {
      expect(result.current.progress).toEqual(progressData1);
    });

    // Second update
    act(() => {
      eventSourceInstance.onmessage({
        data: JSON.stringify(progressData2),
      });
    });

    await waitFor(() => {
      expect(result.current.progress).toEqual(progressData2);
    });
  });

  it('should set isConnected to false on error', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // Wait for handlers to be attached
    await waitFor(() => {
      expect(eventSourceInstance.onopen).not.toBeNull();
    });

    // Set connected first
    act(() => {
      eventSourceInstance.onopen();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    // Set readyState to something other than CLOSED to trigger retry logic
    eventSourceInstance.readyState = 0; // CONNECTING

    // Trigger error
    act(() => {
      eventSourceInstance.onerror({ target: eventSourceInstance });
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });
  });

  it('should not retry when EventSource is intentionally closed', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // Wait for handlers to be attached
    await waitFor(() => {
      expect(eventSourceInstance.onerror).not.toBeNull();
    });

    // Set readyState to CLOSED
    eventSourceInstance.readyState = 2; // CLOSED

    // Trigger error - should not attempt retry
    act(() => {
      eventSourceInstance.onerror({ target: eventSourceInstance });
    });

    // Should remain disconnected without error message
    expect(result.current.isConnected).toBe(false);
  });

  it('should retry connection with exponential backoff on error', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // Wait for handlers to be attached with REAL timers
    await waitFor(() => {
      expect(eventSourceInstance.onerror).not.toBeNull();
    });

    // NOW switch to fake timers
    vi.useFakeTimers();

    // Set readyState to CONNECTING to trigger retry
    eventSourceInstance.readyState = 0;

    // Trigger first error
    act(() => {
      eventSourceInstance.onerror({ target: eventSourceInstance });
    });

    // Fast forward 2 seconds (first retry delay)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Should have attempted to reconnect
    expect(mockEventSourceClass).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should set error after max retries exceeded', async () => {
    const { result } = renderHook(() => useProgressTracking('job-123'));

    // Wait for handlers to be attached with REAL timers
    await waitFor(() => {
      expect(eventSourceInstance.onerror).not.toBeNull();
    });

    // NOW switch to fake timers
    vi.useFakeTimers();

    // Set readyState to trigger retries
    eventSourceInstance.readyState = 0;

    // Trigger error 3 times (max retries = 3)
    for (let i = 0; i < 3; i++) {
      act(() => {
        eventSourceInstance.onerror({ target: eventSourceInstance });
      });

      // Calculate exponential backoff delay
      const delayMs = Math.min(1000 * Math.pow(2, i + 1), 10000);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delayMs);
      });
    }

    // Trigger one more error (should exceed max retries)
    act(() => {
      eventSourceInstance.onerror({ target: eventSourceInstance });
    });

    // Switch back to real timers to use waitFor
    vi.useRealTimers();

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to connect to progress stream after multiple attempts');
    });
  });

  it('should handle EventSource constructor error', () => {
    // Make EventSource constructor throw
    mockEventSourceClass.mockImplementationOnce(function () {
      throw new Error('Connection failed');
    });

    const { result } = renderHook(() => useProgressTracking('job-123'));

    expect(result.current.error).toBe('Connection failed');
    expect(result.current.isConnected).toBe(false);
  });

  it('should handle EventSource constructor error with non-Error object', () => {
    // Make EventSource constructor throw a non-Error
    mockEventSourceClass.mockImplementationOnce(function () {
      throw 'String error';
    });

    const { result } = renderHook(() => useProgressTracking('job-123'));

    expect(result.current.error).toBe('Failed to connect to progress stream');
    expect(result.current.isConnected).toBe(false);
  });

  it('should close EventSource and reset connection state on unmount', async () => {
    const { result, unmount } = renderHook(() => useProgressTracking('job-123'));

    // Wait for handlers to be attached
    await waitFor(() => {
      expect(eventSourceInstance.onopen).not.toBeNull();
    });

    // Set connected first
    act(() => {
      eventSourceInstance.onopen();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    expect(eventSourceInstance).toBeDefined();
    expect(eventSourceInstance.close).not.toHaveBeenCalled();

    unmount();

    // Cleanup should close the EventSource
    expect(eventSourceInstance.close).toHaveBeenCalledTimes(1);
  });
});
