import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/**/._*', 'tests/**/.DS_Store'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx', 'server.ts'],
      exclude: [
        'src/main.tsx',
        'src/**/*.d.ts',
        'tests/**',
      ],
    },
  },
});
