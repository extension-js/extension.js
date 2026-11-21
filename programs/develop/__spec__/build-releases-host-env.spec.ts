import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

// A library host that runs a build keeps running after it. The env files the
// config loaded and the card the build claimed must not stay in its process.
const tempFolder = trackTempFolders()
const PROBE = 'EXTENSION_PUBLIC_HOST_PROBE'
const CARD_KEYS = 'EXTENSION_CLI_CARD_KEYS'
const touched = [PROBE, CARD_KEYS, 'EXTENSION_CLI_BANNER_PRINTED']
const before = Object.fromEntries(touched.map((key) => [key, process.env[key]]))

afterEach(() => {
  vi.restoreAllMocks()

  for (const key of touched) {
    if (before[key] === undefined) delete process.env[key]
    else process.env[key] = before[key]
  }
})

function project(background = 'console.log("background")\n') {
  const root = tempFolder('extjs-host-env-')
  const write = (file: string, text: string) =>
    fs.writeFileSync(path.join(root, file), text)

  write(
    'package.json',
    JSON.stringify({private: true, name: 'host-env', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Host env',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  write('background.js', background)
  write('extension.config.js', 'module.exports = {}\n')
  write('.env', `${PROBE}=from-file\n`)

  return root
}

// A config whose compiler waits, per browser, for the spec to let it run.
const GATED_CONFIG = `module.exports = {config: (config) => {
  config.plugins = [...(config.plugins || []), {apply(compiler) {
    compiler.hooks.beforeRun.tapPromise('spec-gate', async () => {
      const gate = globalThis.__hostEnvGates || {}
      const parts = String(compiler.options.output.path).split(/[\\\\/]/)
      const name = Object.keys(gate).find((browser) =>
        parts.some(
          (part, at) => parts[at - 1] === 'dist' && part.includes(browser)
        )
      )

      if (name) await gate[name]
    })
  }}]
  return config
}}
`

function quiet() {
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined)
  }

  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
}

async function build(root: string, options: Record<string, unknown> = {}) {
  const {resetBuildToolchainLine} = await import('../command-build')

  resetBuildToolchainLine()
  quiet()

  try {
    await buildProject(root, {
      silent: undefined,
      mode: 'production',
      exitOnError: false,
      ...options
    })

    return undefined
  } catch (error) {
    return error
  } finally {
    vi.restoreAllMocks()
  }
}

function cardsOf(root: string): string[] {
  const dist = path.join(fs.realpathSync(root), 'dist', 'chrome')

  return String(process.env[CARD_KEYS] || '')
    .split('\u001f')
    .filter((key) => key.endsWith(`::${dist}`))
}

describe('a library host after a build (real rspack)', () => {
  it('keeps neither the env files nor the card once the build resolves', async () => {
    const root = project()

    expect(await build(root)).toBeUndefined()
    expect(process.env[PROBE]).toBeUndefined()
    expect(cardsOf(root)).toEqual([])
  }, 120_000)

  it('keeps neither once the build rejects', async () => {
    const root = project('const = broken\n')

    expect(await build(root)).toBeInstanceOf(Error)
    expect(process.env[PROBE]).toBeUndefined()
    expect(cardsOf(root)).toEqual([])
  }, 120_000)

  it('keeps a value the host set before the call, and its other cards', async () => {
    const root = project()
    process.env[PROBE] = 'from-host'
    process.env[CARD_KEYS] = 'firefox::/elsewhere/dist/firefox'

    expect(await build(root)).toBeUndefined()
    expect(process.env[PROBE]).toBe('from-host')
    expect(process.env[CARD_KEYS]).toBe('firefox::/elsewhere/dist/firefox')
  }, 120_000)

  it('hands both to the start preview leg and takes them back when it ends', async () => {
    const root = project()

    expect(
      await build(root, {metadataCommand: 'start', launchFollows: true})
    ).toBeUndefined()

    // Between the build and the launch the preview leg still needs them.
    expect(process.env[PROBE]).toBe('from-file')
    expect(cardsOf(root)).toHaveLength(1)

    const {extensionPreview} = await import('../command-preview')
    const seenAtLaunch: unknown[] = []

    quiet()

    const ended = await extensionPreview(
      root,
      {browser: 'chrome', mode: 'production', metadataCommand: 'start'},
      async () => {
        seenAtLaunch.push(process.env[PROBE], cardsOf(root).length)

        throw new Error('the browser closed')
      }
    ).catch((error: unknown) => error)

    vi.restoreAllMocks()

    expect(ended).toBeInstanceOf(Error)
    expect(seenAtLaunch).toEqual(['from-file', 1])
    expect(process.env[PROBE]).toBeUndefined()
    expect(cardsOf(root)).toEqual([])
  }, 120_000)

  it('keeps the env files for a build still running when another one ends', async () => {
    const root = project()
    fs.writeFileSync(path.join(root, 'extension.config.js'), GATED_CONFIG)

    let open: () => void = () => undefined
    const gates = {
      chrome: new Promise<void>((resolve) => {
        open = resolve
      })
    }

    Object.assign(globalThis, {__hostEnvGates: gates})

    const waiting = build(root, {browser: 'chrome'})

    try {
      expect(await build(root, {browser: 'firefox'})).toBeUndefined()
      // The chrome build has not compiled yet and reads the same files.
      expect(process.env[PROBE]).toBe('from-file')

      open()

      expect(await waiting).toBeUndefined()
      expect(process.env[PROBE]).toBeUndefined()
    } finally {
      open()
      await waiting
      Reflect.deleteProperty(globalThis, '__hostEnvGates')
    }
  }, 180_000)

  it('gives the card back when printing it throws', async () => {
    const root = project()
    const {resetBuildToolchainLine} = await import('../command-build')

    resetBuildToolchainLine()
    quiet()
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      if (parts.join(' ').includes('Host env 1.0.0')) {
        throw new Error('the terminal is gone')
      }
    })

    await buildProject(root, {
      silent: undefined,
      mode: 'production',
      exitOnError: false
    }).catch(() => undefined)

    vi.restoreAllMocks()

    expect(cardsOf(root)).toEqual([])
  }, 120_000)

  it('takes the start build card back from a preview leg that fails early', async () => {
    const root = project()

    // Only a leg with no browser named reads this, after it knows its
    // project and before it knows its output folder.
    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      'module.exports = {commands: {start: {browser: "no-such-browser"}}}\n'
    )

    expect(
      await build(root, {metadataCommand: 'start', launchFollows: true})
    ).toBeUndefined()

    expect(cardsOf(root)).toHaveLength(1)

    const {extensionPreview} = await import('../command-preview')

    quiet()

    const ended = await extensionPreview(
      root,
      {mode: 'production', metadataCommand: 'start'} as never,
      async () => undefined
    ).catch((error: unknown) => error)

    vi.restoreAllMocks()

    expect(ended).toBeInstanceOf(Error)
    expect(process.env[PROBE]).toBeUndefined()
    expect(cardsOf(root)).toEqual([])
  }, 120_000)

  it('takes what a start build parked back from a leg refused at once', async () => {
    const root = project()

    expect(
      await build(root, {metadataCommand: 'start', launchFollows: true})
    ).toBeUndefined()

    const {extensionPreview} = await import('../command-preview')

    // No launcher: refused before the project is even looked for.
    const ended = await extensionPreview(root, {
      browser: 'chrome',
      mode: 'production',
      metadataCommand: 'start'
    } as never).catch((error: unknown) => error)

    expect(ended).toBeInstanceOf(Error)
    expect(process.env[PROBE]).toBeUndefined()
    expect(cardsOf(root)).toEqual([])
  }, 120_000)

  it('holds nothing after a dry run, which opens no browser', async () => {
    const root = project()

    expect(await build(root)).toBeUndefined()

    const {extensionPreview} = await import('../command-preview')

    quiet()
    await extensionPreview(
      root,
      {browser: 'chrome', mode: 'production', dryRun: true} as never,
      async () => undefined
    )

    vi.restoreAllMocks()

    expect(process.env[PROBE]).toBeUndefined()
    expect(cardsOf(root)).toEqual([])
  }, 120_000)

  it('holds both while the browser is open and gives them back when it is gone', async () => {
    const root = project()

    expect(
      await build(root, {metadataCommand: 'start', launchFollows: true})
    ).toBeUndefined()

    const {extensionPreview} = await import('../command-preview')
    let close: () => void = () => undefined
    const ended = new Promise<void>((resolve) => {
      close = resolve
    })

    quiet()
    await extensionPreview(
      root,
      {browser: 'chrome', mode: 'production', metadataCommand: 'start'},
      async () => ({ended})
    )

    vi.restoreAllMocks()

    expect(process.env[PROBE]).toBe('from-file')
    expect(cardsOf(root)).toHaveLength(1)

    close()
    await ended
    await new Promise((resolve) => setImmediate(resolve))

    expect(process.env[PROBE]).toBeUndefined()
    expect(cardsOf(root)).toEqual([])
  }, 120_000)
})
