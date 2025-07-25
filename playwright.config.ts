// ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// █████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
// ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝

import {defineConfig, devices} from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // Increase global timeout for CI environments
  timeout: process.env.CI ? 90_000 : 60_000,
  testDir: './examples',

  // Disable parallel execution if tests are interdependent
  fullyParallel: false,

  // Prevent accidental test.only commits
  forbidOnly: !!process.env.CI,

  // Increase retries for both CI and local
  retries: process.env.CI ? 3 : 2,

  // Reduce concurrent workers to prevent resource contention
  workers: process.env.CI ? 1 : 2,

  // Enhanced reporting for better debugging
  reporter: [
    ['html', {outputFolder: 'e2e-report'}],
    ['list'],
    ['json', {outputFile: 'test-results.json'}]
  ],

  use: {
    // Always collect traces for better debugging
    trace: 'on',

    // Capture media for all test failures
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Increase timeouts for network operations
    actionTimeout: 20000,
    navigationTimeout: 45000,

    // Stable viewport
    viewport: {width: 1280, height: 720},

    // Add additional stability settings
    launchOptions: {
      slowMo: process.env.CI ? 100 : 0 // Slow down operations in CI
    },

    // Better error handling
    ignoreHTTPSErrors: true
  },

  // Focused browser testing
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']}
    }

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ]

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
})
