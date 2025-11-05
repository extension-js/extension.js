import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'cli-lib/**/__spec__/**/*.spec.ts',
      '__spec__/(dynamic-install|cache-reuse-offline|dlx-pnpm|telemetry-default).spec.ts'
    ],
    sequence: {concurrent: false},
    allowOnly: !process.env.CI
  }
})
