import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude temporary test workspaces created under __spec__
      '**/__spec__/.tmp-**/**',
      '**/.tmp-tests/**'
    ],
    // Integration specs build real example projects under examples/.../dist.
    // Run in a single thread to avoid cross-spec interference on those folders.
    poolOptions: {
      threads: {singleThread: true, isolate: true}
    }
  }
})


