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

  // One retry in CI, DELIBERATE: with a 90s testTimeout on one worker,
  // every genuine failure at three retries costs six minutes of wall clock,
  // which is what turned a broken suite into a cancel instead of a verdict.
  retries: process.env.CI ? 1 : 2,

  // Stop the CI run once ten tests have truly failed. A healthy night is
  // unaffected, and a night where a whole spec family breaks ends as a
  // complete red run with ten named failures and an uploaded report,
  // instead of grinding retried 90s timeouts past the job budget.
  maxFailures: process.env.CI ? 10 : 0,

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
      // A project-level testIgnore replaces the top-level one, so the shared
      // ignores are repeated here. The firefox specs are excluded because the
      // firefox project below already runs them, and they spawn their own
      // Firefox regardless of the project device, so running them here again
      // was pure duplication.
      testIgnore: [
        'dist/**',
        '**/dist/**',
        'extensions/**',
        'e2e/**',
        /templates\/template\.firefox.*\.spec\.ts$/
      ],
      use: {...devices['Desktop Chrome']}
    },

    {
      name: 'firefox',
      testMatch: /templates\/template\.firefox.*\.spec\.ts$/,
      use: {...devices['Desktop Firefox']}
    }
  ]
})
