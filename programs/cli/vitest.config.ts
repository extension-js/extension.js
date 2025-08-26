import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['cli-lib/**/__spec__/**/*.spec.ts'],
    coverage: {
      exclude: [
        '**/messages.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/types/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/rslib.config.*',
        '**/vitest.config.*'
      ]
    }
  }
})
