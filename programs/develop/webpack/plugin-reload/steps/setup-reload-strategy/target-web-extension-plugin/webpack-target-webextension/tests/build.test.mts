import rspack from '@rspack/core'
import { run } from './config.mjs'
import { expect, test } from 'vitest'

test('Manifest v2 basic test', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv2-basic',
    option: { background: { pageEntry: 'background' } },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v2 HMR test', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv2-hmr',
    option: { background: { pageEntry: 'background' } },
    touch(_, rc) {
      rc.plugins!.push(new rspack.HotModuleReplacementPlugin())
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v2 basic test, no option', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv2-basic-none',
    option: {},
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 basic test', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-basic',
    option: { background: { serviceWorkerEntry: 'background' } },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 (splitChunks: all) test', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-splitChunks-all',
    option: { background: { serviceWorkerEntry: 'background' } },
    touch(c, rc) {
      c.optimization = rc.optimization = { splitChunks: { chunks: 'all', minSize: 1 } }
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 (splitChunks: all) + runtimeChunk test', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-splitChunks-runtimeChunk',
    option: {
      background: { serviceWorkerEntry: 'background' },
      experimental_output: {
        background: 'sw.js',
        content(manifest, list) {
          manifest.content_scripts[0].js = list
        },
      },
      weakRuntimeCheck: true,
    },
    touch(c, rc) {
      c.optimization = rc.optimization = {
        splitChunks: { chunks: 'all', minSize: 1 },
        runtimeChunk: {
          name({ name }) {
            if (name === 'background') return 'background-runtime'
            return 'runtime'
          },
        },
      }
    },
    touchManifest(manifest) {
      manifest.background.service_worker = 'sw.js'
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 output test (string)', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-output-string',
    option: {
      background: { serviceWorkerEntry: 'background' },
      experimental_output: {
        background: 'sw.js',
        content: 'cs.js',
      },
      weakRuntimeCheck: true,
    },
    touch(c, rc) {
      c.optimization = rc.optimization = {
        splitChunks: { chunks: 'all', minSize: 1 },
        runtimeChunk: {
          name({ name }) {
            if (name === 'background') return 'background-runtime'
            return 'runtime'
          },
        },
      }
    },
    touchManifest(manifest) {
      manifest.background.service_worker = 'sw.js'
      manifest.content_scripts[0].js = ['cs.js']
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 output test (function)', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-output-function',
    option: {
      background: { serviceWorkerEntry: 'background' },
      experimental_output: {
        background: 'sw.js',
        content(manifest, files) {
          manifest.content_scripts[0].js = files
        },
      },
      weakRuntimeCheck: true,
    },
    touch(c, rc) {
      c.optimization = rc.optimization = {
        splitChunks: { chunks: 'all', minSize: 1 },
        runtimeChunk: {
          name({ name }) {
            if (name === 'background') return 'background-runtime'
            return 'runtime'
          },
        },
      }
    },
    touchManifest(manifest) {
      manifest.background.service_worker = 'sw.js'
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 output test (object)', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-output-object',
    option: {
      background: { serviceWorkerEntry: 'background' },
      experimental_output: {
        background: {
          file: 'sw.js',
          touch(manifest, file) {
            manifest.background.service_worker = file
          },
        },
        content(manifest, files) {
          manifest.content_scripts[0].js = files
        },
      },
      weakRuntimeCheck: true,
    },
    touch(c, rc) {
      c.optimization = rc.optimization = {
        splitChunks: { chunks: 'all', minSize: 1 },
        runtimeChunk: {
          name({ name }) {
            if (name === 'background') return 'background-runtime'
            return 'runtime'
          },
        },
      }
    },
    touchManifest(manifest) {
      manifest.background.service_worker = 'sw.js'
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 output test (false) (should throw)', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-output-false',
    option: {
      background: { serviceWorkerEntry: 'background' },
      experimental_output: {
        background: 'sw.js',
        content: false,
      },
      weakRuntimeCheck: true,
    },
    touch(c, rc) {
      c.optimization = rc.optimization = {
        splitChunks: { chunks: 'all', minSize: 1 },
        runtimeChunk: {
          name({ name }) {
            if (name === 'background') return 'background-runtime'
            return 'runtime'
          },
        },
      }
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "reason": [
          [Error: [webpack-extension-target] Entry "content" emits more than one initial file which is prohibited (specified in options.experimental_output).],
        ],
        "status": "rejected",
      },
      {
        "reason": [
          {
            "message": "  × Error: [webpack-extension-target] Entry "content" emits more than one initial file which is prohibited (specified in options.experimental_output).
    ",
            "name": "Error",
          },
        ],
        "status": "rejected",
      },
    ]
  `)
})

test('Manifest v3 basic test (with public_path)', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-basic-public-path',
    option: { background: { serviceWorkerEntry: 'background' } },
    touch(c, rc) {
      c.output!.publicPath = rc.output!.publicPath = '/'
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 basic test (with weakRuntime)', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-basic-weak-runtime',
    option: { background: { serviceWorkerEntry: 'background' }, weakRuntimeCheck: true },
    touch(c, rc) {
      c.output!.publicPath = rc.output!.publicPath = '/'
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 HMR test', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-hmr',
    option: { background: { serviceWorkerEntry: 'background' }, weakRuntimeCheck: true },
    touch(_, rc) {
      rc.plugins!.push(new rspack.HotModuleReplacementPlugin())
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

// This crashes at runtime. This is expected. ReferenceError: document is not defined
test('Manifest v3 basic test, no option', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-basic-none',
    option: {},
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v2 + Manifest v3 dual entry test', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-dual',
    touch(c, rc) {
      // @ts-expect-error
      c.entry!.backgroundWorker = rc.entry!.backgroundWorker = './background.js'
    },
    option: { background: { pageEntry: 'background', serviceWorkerEntry: 'backgroundWorker' } },
    touchManifest(manifest) {
      manifest.background.service_worker = 'backgroundWorker.js'
    },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v2 with native dynamic import disabled', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv2-basic-no-esm',
    touch(c, rc) {
      c.output!.environment = rc.output!.environment = { dynamicImport: false }
    },
    option: { background: { pageEntry: 'background' } },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 with native dynamic import disabled', async () => {
  const result = await run({
    input: './fixtures/basic',
    output: './snapshot/mv3-basic-no-esm',
    touch(c, rc) {
      c.output!.environment = rc.output!.environment = { dynamicImport: false }
    },
    option: { background: { serviceWorkerEntry: 'background' } },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v2 with no dynamic import in code', async () => {
  const result = await run({
    input: './fixtures/basic-no-dynamic-import',
    output: './snapshot/mv2-basic-no-dynamic-import',
    option: { background: { pageEntry: 'background' } },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})

test('Manifest v3 with no dynamic import in code', async () => {
  const result = await run({
    input: './fixtures/basic-no-dynamic-import',
    output: './snapshot/mv3-basic-no-dynamic-import',
    option: { background: { serviceWorkerEntry: 'background' } },
  })
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "status": "fulfilled",
        "value": [],
      },
      {
        "status": "fulfilled",
        "value": [],
      },
    ]
  `)
})
