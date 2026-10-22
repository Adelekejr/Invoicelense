import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:8084', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1100 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'small-phone', use: { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npm run dev -- --port 8084', url: 'http://127.0.0.1:8084', reuseExistingServer: !process.env.CI },
});
