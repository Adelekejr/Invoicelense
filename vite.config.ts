import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
