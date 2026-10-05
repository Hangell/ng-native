/**
 * The Vitest half of this package's own suite, configured exactly as an app's would be: the one
 * plugin, from the package's own entry point.
 */
import { defineConfig } from 'vitest/config';
import { ngNative } from './runner/vitest.mjs';

export default defineConfig({
  plugins: [ngNative()],
  test: { maxWorkers: 1, testTimeout: 30_000, include: ['src/**/*.vitest.test.ts'] },
});
