import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {extensionPreview, type ResolvedPreviewOptions} from '../command-preview'
import {CONTROL_PORT_ASSET_NAME} from '../dev-server/control-bridge/producer-runtime'
import {trackTempFolders} from './helpers/temp-folders'

// A preview read the way a caller reads it: the code on the rejection, the
// state left in ready.json, the control port, the options the launcher gets.
const tempFolder = trackTempFolders()

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function builtProject(browser = 'chromium', config?: string) {
  const root = fs.realpathSync(tempFolder('extjs-preview-states-'))
  const dist = path.join(root, 'dist', browser)

  fs.mkdirSync(dist, {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'preview-states', version: '0.0.0'})
  )

  const manifest = JSON.stringify({
    manifest_version: 3,
    name: 'preview-states',
    version: '1.0.0',
    background: {service_worker: 'background.js'}
  })

  fs.writeFileSync(path.join(root, 'manifest.json'), manifest)
  fs.writeFileSync(path.join(dist, 'manifest.json'), manifest)
  fs.writeFileSync(path.join(dist, 'background.js'), 'console.log(1)\n')

  if (config) fs.writeFileSync(path.join(root, 'extension.config.js'), config)

  return root
}

function readyFile(root: string, browser = 'chromium') {
  return path.join(root, 'dist', 'extension-js', browser, 'ready.json')
}

function readReady(root: string, browser = 'chromium') {
  return JSON.parse(fs.readFileSync(readyFile(root, browser), 'utf-8'))
}

function recordBuild(root: string, browser: string, outputPath: string) {
  const folder = path.join(root, 'dist', 'extension-js', browser)

  fs.mkdirSync(folder, {recursive: true})
  fs.writeFileSync(
    path.join(folder, 'build-summary.json'),
    JSON.stringify({browser, output_path: outputPath})
  )
}

function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({port, host: '127.0.0.1'})

    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => resolve(false))
  })
}

async function rejection(run: Promise<unknown>) {
  try {
    await run
  } catch (error) {
    return error as Error & {code?: string}
  }

  throw new Error('expected the preview to reject')
}

const launchNothing = async () => {}

describe('preview refusals that come before any state is written', () => {
  it('codes a call that has no launcher and leaves no ready.json', async () => {
    const root = builtProject()
    const error = await rejection(
      extensionPreview(root, {browser: 'chromium'} as any)
    )

    expect(error.code).toBe('E_INVALID_OPTION')
    expect(error.message).toContain('without a browser launcher')
    expect(error.message).not.toContain('programs/')
    expect(fs.existsSync(readyFile(root))).toBe(false)
  })

  it.each([
    {allowControl: true},
    {allowEval: true}
  ])('refuses noBrowser with %o as an invalid option', async (control) => {
    const root = builtProject()
    const error = await rejection(
      extensionPreview(root, {
        browser: 'chromium',
        noBrowser: true,
        ...control
      } as any)
    )

    expect(error.code).toBe('E_INVALID_OPTION')
    expect(error.message).toContain('--no-browser cannot be combined')
    expect(fs.existsSync(readyFile(root))).toBe(false)
  })

  it('still previews with no browser when no control channel is asked for', async () => {
    const root = builtProject()

    await extensionPreview(root, {browser: 'chromium', noBrowser: true} as any)

    expect(readReady(root).status).toBe('ready')
  })
})

describe('a preview that fails after it wrote starting', () => {
  it('records an error when the project config throws', async () => {
    const root = builtProject(
      'chromium',
      "throw new Error('config exploded')\n"
    )
    const launcher = vi.fn(launchNothing)
    const error = await rejection(
      extensionPreview(root, {browser: 'chromium'} as any, launcher)
    )

    expect(error.code).toBe('E_CONFIG_LOAD')
    expect(launcher).not.toHaveBeenCalled()

    const ready = readReady(root)

    expect(ready.status).toBe('error')
    expect(ready.code).toBe('preview_failed')
    expect(ready.message).toContain('config exploded')
  })

  it('records an error when a companion extension cannot be resolved', async () => {
    const root = builtProject()
    const launcher = vi.fn(launchNothing)
    const error = await rejection(
      extensionPreview(
        root,
        {
          browser: 'chromium',
          extensions: {paths: ['abcdefghijklmnopabcdefghijklmnop']}
        } as any,
        launcher
      )
    )

    expect(error.message).toContain('looks like a store id')
    expect(launcher).not.toHaveBeenCalled()

    const ready = readReady(root)

    expect(ready.status).toBe('error')
    expect(ready.code).toBe('preview_failed')
    expect(ready.message).toContain('looks like a store id')
  })

  it('warns about a companion the call named and launches without it', async () => {
    const root = builtProject()
    const launcher = vi.fn(async (_opts: ResolvedPreviewOptions) => {})
    const result = await extensionPreview(
      root,
      {browser: 'chromium', extensions: ['./extensions/gone']} as any,
      launcher
    )
    const gone = path.join(root, 'extensions', 'gone')

    expect(result?.warnings).toHaveLength(1)
    expect(result?.warnings[0]).toMatch(/^E_COMPANION_EXTENSION_PATH: /)
    expect(result?.warnings[0]).toContain('ENTRY ./extensions/gone')
    expect(result?.warnings[0]).toContain('DECLARED IN the --extensions flag')
    expect(result?.warnings[0]).toContain(
      `NOT FOUND ${path.join(gone, 'manifest.json')}`
    )

    const printed = vi
      .mocked(console.warn)
      .mock.calls.map((call) => String(call[0]))

    expect(
      printed.filter((line) => line.includes('./extensions/gone'))
    ).toHaveLength(1)

    expect(launcher).toHaveBeenCalledTimes(1)
    expect(launcher.mock.calls[0][0].extensionsToLoad).not.toContain(gone)
    expect(readReady(root).status).toBe('ready')
  })

  it('names the config file when the companion was declared there', async () => {
    const root = builtProject(
      'chromium',
      "module.exports = {extensions: {paths: ['./extensions/empty']}}\n"
    )

    // The folder is there and holds no manifest, so it is not an extension.
    fs.mkdirSync(path.join(root, 'extensions', 'empty'), {recursive: true})

    const launcher = vi.fn(launchNothing)
    const result = await extensionPreview(
      root,
      {browser: 'chromium'} as any,
      launcher
    )

    expect(result?.warnings).toHaveLength(1)
    expect(result?.warnings[0]).toContain('./extensions/empty')
    expect(result?.warnings[0]).toContain('extension.config.js')
    expect(result?.warnings[0]).not.toContain('--extensions')
    expect(launcher).toHaveBeenCalledTimes(1)
    expect(readReady(root).status).toBe('ready')
  })

  it('keeps the warning off stdout when a machine reads it', async () => {
    const root = builtProject()

    vi.stubEnv('EXTENSION_OUTPUT', 'json')

    try {
      const result = await extensionPreview(
        root,
        {browser: 'chromium', extensions: ['./extensions/gone']} as any,
        launchNothing
      )

      expect(result?.warnings).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }

    const said = [console.log, console.warn]
      .flatMap((sink) => vi.mocked(sink).mock.calls)
      .map((call) => String(call[0]))

    expect(said.filter((line) => line.includes('extensions/gone'))).toEqual([])
  })

  it('loads the companions that resolve and stays quiet about a scanned folder', async () => {
    const root = builtProject()
    const companion = path.join(root, 'extensions', 'other')

    fs.mkdirSync(companion, {recursive: true})
    fs.mkdirSync(path.join(root, 'extensions', 'not-one'), {recursive: true})
    fs.writeFileSync(
      path.join(companion, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'other', version: '1.0.0'})
    )

    const launcher = vi.fn(async (_opts: ResolvedPreviewOptions) => {})

    const result = await extensionPreview(
      root,
      {browser: 'chromium'} as any,
      launcher
    )

    expect(result?.warnings).toEqual([])
    expect(launcher.mock.calls[0][0].extensionsToLoad).toContain(companion)
    expect(readReady(root).status).toBe('ready')
  })

  it('records an error when the control channel cannot open', async () => {
    const root = builtProject()
    const launcher = vi.fn(launchNothing)

    // An address from the documentation range, which no interface here holds.
    await rejection(
      extensionPreview(
        root,
        {browser: 'chromium', allowControl: true, host: '192.0.2.1'} as any,
        launcher
      )
    )

    expect(launcher).not.toHaveBeenCalled()

    const ready = readReady(root)

    expect(ready.status).toBe('error')
    expect(ready.code).toBe('preview_failed')
  })

  it('records an error and closes the control port when the launcher rejects', async () => {
    const root = builtProject()
    let controlPort = 0
    let openWhileLaunching = false

    const error = await rejection(
      extensionPreview(
        root,
        {browser: 'chromium', allowControl: true} as any,
        async (opts) => {
          // The copy the browser loads carries the port its producer dials.
          controlPort = JSON.parse(
            fs.readFileSync(
              path.join(opts.outPath, CONTROL_PORT_ASSET_NAME),
              'utf-8'
            )
          ).port

          openWhileLaunching = await portAnswers(controlPort)

          throw new Error('the browser never came up')
        }
      )
    )

    expect(error.message).toBe('the browser never came up')
    expect(controlPort).toBeGreaterThan(0)
    expect(openWhileLaunching).toBe(true)
    expect(await portAnswers(controlPort)).toBe(false)

    const ready = readReady(root)

    expect(ready.status).toBe('error')
    expect(ready.code).toBe('browser_launch_failed')
    expect(ready.message).toBe('the browser never came up')
  })

  it('keeps the failure a launcher recorded itself', async () => {
    const root = builtProject()

    await rejection(
      extensionPreview(root, {browser: 'chromium'} as any, async () => {
        const ready = readReady(root)

        fs.writeFileSync(
          readyFile(root),
          JSON.stringify({
            ...ready,
            status: 'error',
            code: 'profile_locked',
            message: 'the profile is in use'
          })
        )

        throw new Error('launch refused')
      })
    )

    const ready = readReady(root)

    expect(ready.code).toBe('profile_locked')
    expect(ready.message).toBe('the profile is in use')
  })
})

describe('what a preview hands the launcher', () => {
  async function resolved(
    root: string,
    options: Record<string, unknown>
  ): Promise<ResolvedPreviewOptions> {
    let seen: ResolvedPreviewOptions | undefined

    await extensionPreview(root, options as any, async (opts) => {
      seen = opts
    })

    if (!seen) throw new Error('the launcher was not called')

    return seen
  }

  it('carries keepProfileChanges and copyFromProfile from the call', async () => {
    const root = builtProject()
    const seed = path.join(root, 'seed-profile')
    const opts = await resolved(root, {
      browser: 'chromium',
      keepProfileChanges: true,
      copyFromProfile: seed
    })

    expect(opts.keepProfileChanges).toBe(true)
    expect(opts.copyFromProfile).toBe(seed)
  })

  it.each([
    'preview',
    'start'
  ] as const)('carries both from commands.%s in the config', async (command) => {
    const root = builtProject(
      'chromium',
      `module.exports = {commands: {${command}: {keepProfileChanges: true, copyFromProfile: './seed-profile'}}}\n`
    )
    const opts = await resolved(root, {
      browser: 'chromium',
      metadataCommand: command
    })

    expect(opts.keepProfileChanges).toBe(true)
    expect(opts.copyFromProfile).toBe('./seed-profile')
  })

  it('leaves both unset when nothing asks for them', async () => {
    const opts = await resolved(builtProject(), {browser: 'chromium'})

    expect(opts.keepProfileChanges).toBeUndefined()
    expect(opts.copyFromProfile).toBeUndefined()
  })

  it('previews the chromium build when no browser is named, as build does', async () => {
    const root = builtProject('chromium')
    const opts = await resolved(root, {})

    expect(opts.browser).toBe('chromium')
    expect(opts.outPath).toBe(path.join(root, 'dist', 'chromium'))
  })
})

describe('a build folder asked to run in another browser', () => {
  it('refuses a recorded Chrome build in Firefox and names both', async () => {
    const root = builtProject('chrome')
    const dist = path.join(root, 'dist', 'chrome')
    const launcher = vi.fn(launchNothing)

    recordBuild(root, 'chrome', dist)

    const error = await rejection(
      extensionPreview(dist, {browser: 'firefox'} as any, launcher)
    )

    expect(error.code).toBe('E_INVALID_OPTION')
    expect(error.message).toContain('was built for chrome')
    expect(error.message).toContain('cannot be previewed in firefox')
    expect(launcher).not.toHaveBeenCalled()
    expect(fs.existsSync(readyFile(root, 'firefox'))).toBe(false)
  })

  it('refuses the same folder passed as outputPath', async () => {
    const root = builtProject('chrome')
    const dist = path.join(root, 'dist', 'chrome')

    recordBuild(root, 'chrome', dist)

    const error = await rejection(
      extensionPreview(
        root,
        {browser: 'firefox', outputPath: dist} as any,
        launchNothing
      )
    )

    expect(error.code).toBe('E_INVALID_OPTION')
  })

  it('loads a recorded Chrome build in another Chromium browser', async () => {
    const root = builtProject('chrome')
    const dist = path.join(root, 'dist', 'chrome')
    const launcher = vi.fn(launchNothing)

    recordBuild(root, 'chrome', dist)

    await extensionPreview(dist, {browser: 'edge'} as any, launcher)

    expect(launcher).toHaveBeenCalledTimes(1)
  })

  it('loads a folder that no build summary names', async () => {
    const root = builtProject('chrome')
    const launcher = vi.fn(launchNothing)

    await extensionPreview(
      path.join(root, 'dist', 'chrome'),
      {browser: 'firefox'} as any,
      launcher
    )

    expect(launcher).toHaveBeenCalledTimes(1)
  })
})

describe('the exit listener of a preview', () => {
  it('is added once however many sessions the process opens', async () => {
    const before = process.listenerCount('exit')

    await extensionPreview(
      builtProject(),
      {browser: 'chromium'} as any,
      launchNothing
    )

    const afterFirst = process.listenerCount('exit')

    await extensionPreview(
      builtProject(),
      {browser: 'chromium'} as any,
      launchNothing
    )

    await extensionPreview(
      builtProject(),
      {browser: 'chromium'} as any,
      launchNothing
    )

    expect(afterFirst - before).toBeLessThanOrEqual(1)
    expect(process.listenerCount('exit')).toBe(afterFirst)
  })
})
