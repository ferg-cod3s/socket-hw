import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock EventSource for client-side tests
global.EventSource = class {
  url: string;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
  readyState = 1;
  CONNECTING = 0;
  OPEN = 1;
  CLOSED = 2;
  onopen: null | (() => void) = null;
  onmessage: null | ((event: { data: string }) => void) = null;
  onerror: null | ((error: Error) => void) = null;

  constructor(url: string) {
    this.url = url;
  }
} as any;
