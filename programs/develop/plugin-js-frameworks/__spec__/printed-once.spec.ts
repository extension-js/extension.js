import {createRequire} from 'node:module'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {takeCodedWarnings} from '../../lib/coded-warnings'
import {prefix, stripChannelPrefix} from '../../lib/messaging'
import * as messages from '../js-frameworks-lib/messages'
import {configure, fakePackage, MANIFEST, makeProject} from './project-fixture'

type Notice = {delivered: boolean}

// Each detector or step that prints a once-only line, the project that makes
// it print, and the exact line.
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
    name: 'Svelte',
    files: {'package.json': {dependencies: {svelte: '5'}}},
    line: `${prefix('debug')} ${messages.isUsingIntegration('Svelte')}`,
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
  )('prints no $name line for a caller that keeps no record', async ({
    files,
    run
  }) => {
    await run(makeProject(files))
    await run(makeProject(files))
    expect(log).not.toHaveBeenCalled()
  })

  it.each(cases)('prints no $name line outside debug', async ({files, run}) => {
    vi.stubEnv('EXTENSION_DEBUG', undefined)
    vi.stubEnv('EXTENSION_AUTHOR_MODE', undefined)

    await run(makeProject(files), {delivered: false})
    expect(log).not.toHaveBeenCalled()
  })
})

describe('two builds in one process', () => {
  beforeEach(() => {
    vi.stubEnv('EXTENSION_DEBUG', 'true')
    vi.stubEnv('EXTENSION_OUTPUT', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('each print the line of the framework they found', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const line = `${prefix('debug')} ${messages.isUsingIntegration('Preact')}`
    const files = {
      'package.json': {dependencies: {preact: '10'}},
      'manifest.json': MANIFEST
    }

    await configure(makeProject(files))
    await configure(makeProject(files))

    expect(log.mock.calls.filter(([text]) => text === line)).toHaveLength(2)
  })
})

describe('the Svelte compiler and runtime mismatch warning', () => {
  const compilerVersion = createRequire(
    createRequire(path.join(__dirname, '..', '..', 'x.js')).resolve(
      'svelte-loader'
    )
  )('svelte/package.json').version as string
  const frame = messages.svelteCompilerRuntimeMismatch(compilerVersion, '5.0.0')

  function olderSvelteProject() {
    const root = makeProject({
      'package.json': {dependencies: {svelte: '5'}},
      'manifest.json': MANIFEST
    })
    fakePackage(root, 'svelte', {version: '5.0.0'})

    return root
  }

  beforeEach(() => {
    vi.stubEnv('EXTENSION_OUTPUT', undefined)
    takeCodedWarnings()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('warns once per record when the compiler is newer than the project svelte', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {maybeUseSvelte} = await import('../js-tools/svelte')
    const {createSessionNotices} = await import(
      '../js-frameworks-lib/session-notices'
    )
    const root = olderSvelteProject()
    const notices = createSessionNotices()

    await maybeUseSvelte(root, 'development', {notices})
    await maybeUseSvelte(root, 'development', {notices})

    expect(warn.mock.calls).toEqual([[frame]])
  })

  it('warns in each of two builds and hands each warning its code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await configure(olderSvelteProject())
    expect(takeCodedWarnings()).toEqual([
      `W_MANAGED_DEP_CONFLICT: ${stripChannelPrefix(frame)}`
    ])

    await configure(olderSvelteProject())
    expect(takeCodedWarnings()).toEqual([
      `W_MANAGED_DEP_CONFLICT: ${stripChannelPrefix(frame)}`
    ])

    expect(warn.mock.calls).toEqual([[frame], [frame]])
  })

  it('keeps the frame off a machine reader and still hands it the code', async () => {
    vi.stubEnv('EXTENSION_OUTPUT', 'json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await configure(olderSvelteProject())

    expect(warn).not.toHaveBeenCalled()
    expect(takeCodedWarnings()).toEqual([
      `W_MANAGED_DEP_CONFLICT: ${stripChannelPrefix(frame)}`
    ])
  })
})
