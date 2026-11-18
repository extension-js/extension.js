import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {prefix} from '../../lib/messaging'
import * as messages from '../js-frameworks-lib/messages'
import {fakePackage, makeProject} from './project-fixture'

type Notice = {delivered: boolean}

// Each detector or step that prints a once-only line, the project that makes
// it print, and the exact line. A fresh module stands for a fresh process.
const cases: Array<{
  name: string
  files: Record<string, string | object>
  line: string
  run: (root: string, notice?: Notice) => Promise<unknown>
}> = [
  {
    name: 'React',
    files: {'package.json': {dependencies: {react: '19'}}},
    line: `${prefix('debug')} ${messages.isUsingIntegration('React')}`,
    run: async (root, notice) =>
      (await import('../js-tools/react')).isUsingReact(root, notice)
  },
  {
    name: 'Preact',
    files: {'package.json': {dependencies: {preact: '10'}}},
    line: `${prefix('debug')} ${messages.isUsingIntegration('Preact')}`,
    run: async (root, notice) =>
      (await import('../js-tools/preact')).isUsingPreact(root, notice)
  },
  {
    name: 'Vue',
    files: {'package.json': {dependencies: {vue: '3'}}},
    line: `${prefix('debug')} ${messages.isUsingIntegration('Vue')}`,
    run: async (root, notice) =>
      (await import('../js-tools/vue')).isUsingVue(root, notice)
  },
  {
    name: 'Solid',
    files: {'package.json': {dependencies: {'solid-js': '1'}}},
    line: `${prefix('debug')} ${messages.isUsingIntegration('Solid')}`,
    run: async (root, notice) =>
      (await import('../js-tools/solid')).isUsingSolid(root, notice)
  },
  {
    // Today's line carries no debug glyph, unlike its four siblings.
    name: 'Svelte',
    files: {'package.json': {dependencies: {svelte: '5'}}},
    line: messages.isUsingIntegration('Svelte'),
    run: async (root, notice) =>
      (await import('../js-tools/svelte')).isUsingSvelte(root, notice)
  },
  {
    name: 'a custom loader file',
    files: {
      'package.json': {},
      'vue.loader.mjs': 'export default {}\n'
    },
    line: messages.isUsingCustomLoader('vue.loader.mjs'),
    run: async (root, notice) =>
      (
        await import('../js-frameworks-lib/load-loader-options')
      ).loadLoaderOptions(root, 'vue', notice)
  },
  {
    name: 'TypeScript',
    files: {
      'package.json': {devDependencies: {typescript: '5'}},
      'tsconfig.json': {}
    },
    line: `${prefix('debug')} ${messages.isUsingIntegration('TypeScript')}`,
    run: async (root, notice) =>
      (await import('../js-tools/typescript')).ensureTypeScriptConfig(
        root,
        undefined,
        notice
      )
  }
]

describe('lines printed once', () => {
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('EXTENSION_DEBUG', 'true')
    vi.stubEnv('EXTENSION_OUTPUT', undefined)
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(
    cases
  )('prints the $name line once per record a caller passes', async ({
    files,
    line,
    run
  }) => {
    const root = makeProject(files)
    const first = {delivered: false}

    await run(root, first)
    await run(root, first)
    expect(log.mock.calls).toEqual([[line]])
    expect(first).toEqual({delivered: true})

    await run(root, {delivered: false})
    expect(log.mock.calls).toEqual([[line], [line]])
  })

  it.each(
    cases
  )('prints the $name line once per process by default, whatever the project', async ({
    files,
    line,
    run
  }) => {
    await run(makeProject(files))
    await run(makeProject(files))
    expect(log.mock.calls).toEqual([[line]])
  })

  it.each(cases)('prints no $name line outside debug', async ({files, run}) => {
    vi.stubEnv('EXTENSION_DEBUG', undefined)
    vi.stubEnv('EXTENSION_AUTHOR_MODE', undefined)

    await run(makeProject(files), {delivered: false})
    expect(log).not.toHaveBeenCalled()
  })
})

describe('the Svelte compiler and runtime mismatch warning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns once per record when the compiler is newer than the project svelte', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {maybeUseSvelte} = await import('../js-tools/svelte')
    const {createRequire} = await import('node:module')
    const path = await import('node:path')
    const compilerVersion = createRequire(
      createRequire(path.join(__dirname, '..', '..', 'x.js')).resolve(
        'svelte-loader'
      )
    )('svelte/package.json').version as string
    const root = makeProject({'package.json': {dependencies: {svelte: '5'}}})
    fakePackage(root, 'svelte', {version: '5.0.0'})
    const record = {delivered: false}

    await maybeUseSvelte(root, 'development', {mismatchNotice: record})
    await maybeUseSvelte(root, 'development', {mismatchNotice: record})

    expect(warn.mock.calls).toEqual([
      [messages.svelteCompilerRuntimeMismatch(compilerVersion, '5.0.0')]
    ])
  })
})
