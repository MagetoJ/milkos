import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Frontend unit tests for the offline platform (lib/offline, lib/sync, lib/sensors, lib/bluetooth).
// IndexedDB is provided by fake-indexeddb; see tests/frontend/setup.ts for the browser globals.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    include: ['tests/frontend/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/frontend/setup.ts'],
  },
});
