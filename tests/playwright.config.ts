import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: process.env.TEST_SITE_URL || 'https://d1x6j6gxhzrxnh.cloudfront.net',
    headless: true,
  },
});
