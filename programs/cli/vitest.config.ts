import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['cli-lib/**/__spec__/**/*.spec.ts'],
    allowOnly: !process.env.CI
  }
})
