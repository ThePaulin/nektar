import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installBrowserMocks } from './browserMocks';

installBrowserMocks();

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});
