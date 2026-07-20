// ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// █████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
// ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {defineConfig, devices} from '@playwright/test'

export default defineConfig({
  timeout: process.env.CI ? 90_000 : 60_000,
  testDir: 'templates',
  testMatch: ['templates/**/*.spec.ts'],
  testIgnore: ['dist/**', '**/dist/**', 'extensions/**', 'e2e/**'],

  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 3 : 2,

  // Single worker, DELIBERATE: the content-reload spec edits template sources
  // mid-run and leaks into other workers' dist reads; single-worker is race-free.
  workers: 1,

  reporter: [
    ['html', {outputFolder: 'e2e-report'}],
    ['list'],
    ['json', {outputFile: 'test-results.json'}]
  ],

  use: {
    trace: 'retain-on-failure',

    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    actionTimeout: 20000,
    navigationTimeout: 45000,

    viewport: {width: 1280, height: 720},

    launchOptions: {
      slowMo: process.env.CI ? 100 : 0
    },

    ignoreHTTPSErrors: true
  },

  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']}
    },

    {
      name: 'firefox',
      use: {...devices['Desktop Firefox']}
    }
  ]
})
