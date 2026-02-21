import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts']
  }
})
