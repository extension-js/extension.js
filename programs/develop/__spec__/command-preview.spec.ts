import * as fs from 'node:fs'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {
  PreviewBrowserSession,
  ResolvedPreviewOptions
} from '../command-preview'
import type {
  ProductionControlOptions,
  ProductionControlSession
} from '../lib/production-control'
import type {PreviewOptions} from '../types'
import {
  type ExtensionProject,
  type ProjectFile,
  writeExtensionProject,
  writeProjectFiles
} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

type ControlStart = (
  options: ProductionControlOptions
) => Promise<ProductionControlSession>

const control = vi.hoisted(() => ({
  fake: undefined as ControlStart | undefined,
  calls: [] as ProductionControlOptions[],
  sessions: [] as ProductionControlSession[]
}))

// Opens a loopback control server. It runs for real unless a test arms a
// session whose extension dials in on the test's own clock.
vi.mock(
  '../dev-server/control-bridge/production-control',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../dev-server/control-bridge/production-control')
      >()

    return {
      ...actual,
      startProductionControl: async (options: ProductionControlOptions) => {
        control.calls.push(options)

        const session = await (control.fake ?? actual.startProductionControl)(
          options
        )

        control.sessions.push(session)

        return session
      }
    }
  }
)

import {EXECUTOR_ATTACH_WAIT_MS, extensionPreview} from '../command-preview'
import {remoteArchiveCacheKey} from '../lib/remote-archive'
import {
  readyContractPath,
  sessionArtifactsIgnoreFilePath
} from '../lib/session-paths'
import {writeRemoteSource} from '../lib/zip'

const DARK_FLAGS = ['--force-dark-mode', '--enable-features=WebUIDarkMode']

const tempFolder = trackTempFolders()

interface PreviewProject extends ExtensionProject {
  // The browsers a build already exists for. Chrome unless the test says.
  built?: string[]
}

function builtManifest(name = 'spec-extension') {
  return {manifest_version: 3, name, version: '1.0.0'}
}

function project(options: PreviewProject = {}): string {
  const {built = ['chrome'], files, ...rest} = options
  const builds: Record<string, ProjectFile> = {}

  for (const browser of built) {
    builds[`dist/${browser}/manifest.json`] = builtManifest(rest.name)
  }

  return writeExtensionProject(tempFolder('extjs-command-preview-'), {
    ...rest,
    files: {...builds, ...files}
  })
}

function dist(root: string, browser = 'chrome'): string {
  return path.join(root, 'dist', browser)
}

function readReady(root: string, browser = 'chrome'): Record<string, any> {
  return JSON.parse(fs.readFileSync(readyContractPath(root, browser), 'utf8'))
}

type Launcher = (
  options: ResolvedPreviewOptions
) => Promise<PreviewBrowserSession | undefined>

let launcher = vi.fn<Launcher>(async () => undefined)

function launched(): ResolvedPreviewOptions {
  return launcher.mock.calls[0]?.[0]
}

function preview(
  source: string,
  options: Record<string, unknown> = {},
  launch: Launcher = launcher
) {
  return extensionPreview(source, options as unknown as PreviewOptions, launch)
}

// A session whose background never answers, or answers after the given wait.
function armControlSession(attachAfterMs?: number) {
  control.fake = async (options) => {
    if (attachAfterMs !== undefined) {
      setTimeout(() => options.onExecutorAttached?.(), attachAfterMs)
    }

    const controlledPath = path.join(options.packageJsonDir, 'controlled-copy')

    fs.cpSync(options.distPath, controlledPath, {recursive: true})

    return {
      controlPort: 5555,
      instanceId: 'inst-1',
      controlledPath,
      logsPath: 'dist/extension-js/chrome/logs.ndjson',
      backgroundAssets: ['background/service_worker.js'],
      broker: {},
      close: async () => {}
    } as unknown as ProductionControlSession
  }
}

// An archive case has to finish from the disk alone, so any fetch fails it.
function refuseNetwork() {
  const fetched = vi.fn(async () => {
    throw new Error('this spec never reaches the network')
  })

  vi.stubGlobal('fetch', fetched)

  return fetched
}

function standIn(folder: string) {
  const real = fs.realpathSync(folder)

  vi.spyOn(process, 'cwd').mockReturnValue(real)

  return real
}

describe('webpack/command-preview (run-only)', () => {
  const logged: string[] = []
  const warned: string[] = []
  const stderr: string[] = []
  // Exit handlers are captured, not registered, so listeners do not pile up
  // on the worker and a test can run the one the command asked for.
  const exitHandlers: Array<() => void> = []

  beforeEach(() => {
    launcher = vi.fn<Launcher>(async () => undefined)
    exitHandlers.length = 0
    logged.length = 0
    warned.length = 0
    stderr.length = 0

    const realOnce = process.once.bind(process)

    vi.spyOn(process, 'once').mockImplementation(((
      event: string,
      listener: (...args: any[]) => void
    ) => {
      if (event === 'exit') {
        exitHandlers.push(listener)

        return process
      }

      return realOnce(event, listener)
    }) as typeof process.once)

    // Human lines go to console.log, or to stderr while a machine reads stdout.
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '))
    })

    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.join(' '))
    })

    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderr.push(String(chunk))

      return true
    }) as typeof process.stderr.write)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()

    for (const session of control.sessions.splice(0)) await session.close()

    control.calls.length = 0
    control.fake = undefined
  })

  it('loads the controlled copy and publishes its control port with allowControl', async () => {
    const root = project()

    await preview(root, {
      browser: 'chrome',
      allowEval: true,
      metadataCommand: 'start'
    })

    expect(control.calls).toHaveLength(1)
    expect(control.calls[0]).toMatchObject({
      packageJsonDir: root,
      browser: 'chrome',
      distPath: dist(root),
      allowEval: true
    })

    const [session] = control.sessions

    expect(launched().outPath).toBe(session.controlledPath)
    expect(session.controlledPath).not.toBe(dist(root))
    expect(
      JSON.parse(
        fs.readFileSync(path.join(launched().outPath, 'manifest.json'), 'utf8')
      )
    ).toMatchObject({name: 'spec-extension'})

    // The copy carries the control runtime, so the launcher is told where
    // the author's own files are.
    expect(launched().shippedPath).toBe(dist(root))

    expect(session.controlPort).toBeGreaterThan(0)
    expect(readReady(root)).toMatchObject({
      status: 'ready',
      command: 'start',
      distPath: session.controlledPath,
      controlPort: session.controlPort,
      instanceId: session.instanceId,
      logsPath: path.join('dist', 'extension-js', 'chrome', 'logs.ndjson')
    })

    expect(logged.join('\n')).toContain('Control channel open')
  })

  it('holds ready on a control session until the extension dials in', async () => {
    const root = project()
    let statusAtLaunch = ''
    let launchedAt = 0

    armControlSession(150)

    await preview(root, {browser: 'chrome', allowControl: true}, async () => {
      launchedAt = Date.now()
      statusAtLaunch = readReady(root).status

      return undefined
    })

    const ready = readReady(root)

    expect(statusAtLaunch).toBe('starting')
    expect(Date.now() - launchedAt).toBeGreaterThanOrEqual(100)
    expect(ready).toMatchObject({status: 'ready', runtime: 'attached'})
    expect(Date.parse(ready.executorAttachedAt)).toBeLessThanOrEqual(
      Date.parse(ready.ts)
    )
  })

  it('writes ready after a bounded wait when no extension ever dials in', async () => {
    const root = project()

    let noteLaunched = () => {}

    const browserUp = new Promise<void>((resolve) => {
      noteLaunched = resolve
    })

    armControlSession()
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    const running = preview(
      root,
      {browser: 'chrome', allowControl: true},
      async () => {
        noteLaunched()

        return undefined
      }
    )

    await browserUp
    await vi.advanceTimersByTimeAsync(EXECUTOR_ATTACH_WAIT_MS - 1)
    expect(readReady(root).status).toBe('starting')

    await vi.advanceTimersByTimeAsync(1)
    await running

    expect(readReady(root).status).toBe('ready')
    expect(readReady(root)).not.toHaveProperty('executorAttachedAt')
  })

  it("hands the launched browser's background wake to the control broker", async () => {
    const root = project({built: ['firefox']})
    const wakeBackground = vi.fn(async () => true)

    await preview(
      root,
      {browser: 'firefox', allowControl: true, metadataCommand: 'start'},
      async () => ({wakeBackground})
    )

    const [controlOptions] = control.calls

    expect(typeof controlOptions.wakeExecutor).toBe('function')
    await expect(controlOptions.wakeExecutor?.()).resolves.toBe(true)
    expect(wakeBackground).toHaveBeenCalledTimes(1)
  })

  it('opens no control channel unless asked', async () => {
    const root = project()

    await preview(root, {browser: 'chrome'})

    expect(control.calls).toHaveLength(0)
    expect(launched().outPath).toBe(dist(root))
    expect('shippedPath' in launched()).toBe(false)
    expect(readReady(root)).not.toHaveProperty('controlPath')
  })

  it('falls back to manifest directory when dist/<browser> lacks manifest.json', async () => {
    const root = project({built: []})

    await preview(root, {browser: 'chrome'})

    expect(launcher).toHaveBeenCalledTimes(1)
    expect(launched().outPath).toBe(root)
  })

  it('previews a downloaded build archive where it landed, with no dist lookup or build advice', async () => {
    const url =
      'https://registry.example/ws/project/builds/abc/firefox.zip?t=token'
    const cache = fs.realpathSync(tempFolder('extjs-preview-cache-'))
    const landed = path.join(
      cache,
      'extension.js',
      'previews',
      remoteArchiveCacheKey(url)
    )
    const fetched = refuseNetwork()

    // The archive was fetched by an earlier run, so this one reads the cache.
    writeProjectFiles(landed, {'manifest.json': builtManifest()})
    writeRemoteSource(landed, url.split('?')[0])
    vi.stubEnv('XDG_CACHE_HOME', cache)

    await preview(url, {browser: 'firefox'})

    expect(fetched).not.toHaveBeenCalled()
    expect(launched().outPath).toBe(landed)

    const printed = logged.join('\n')

    expect(printed).not.toContain('No production build found')
    expect(printed).not.toContain('extension build')
  })

  it('previews a local build zip the same way', async () => {
    const here = standIn(tempFolder('extjs-preview-zip-'))

    fs.writeFileSync(
      path.join(here, 'chrome.zip'),
      zipSync({'manifest.json': strToU8(JSON.stringify(builtManifest()))})
    )

    await preview('./chrome.zip', {browser: 'chrome'})

    expect(launched().outPath).toBe(path.join(here, 'chrome'))
    expect(fs.existsSync(path.join(here, 'chrome', 'manifest.json'))).toBe(true)
    expect(logged.join('\n')).not.toContain('No production build found')
  })

  it('keeps the project path for a downloaded source archive that has a package.json', async () => {
    const url = 'https://github.com/owner/repo'
    const here = standIn(tempFolder('extjs-preview-clone-'))
    const fetched = refuseNetwork()

    fs.mkdirSync(path.join(here, 'repo'))

    const repo = writeExtensionProject(path.join(here, 'repo'), {
      files: {'dist/chrome/manifest.json': builtManifest()}
    })

    // Stamped as this url's clone, so the command reuses it and fetches nothing.
    writeRemoteSource(repo, url)

    await preview(url, {browser: 'chrome'})

    expect(fetched).not.toHaveBeenCalled()
    expect(launched().outPath).toBe(dist(repo))
  })

  it('says so when it falls back to the source manifest dir', async () => {
    const root = project({built: []})

    await preview(root, {browser: 'chrome'})

    const printed = logged.join('\n')

    expect(printed).toContain('previewing the source manifest directory')
    expect(printed).toContain('extension build --browser chrome')
  })

  // An unprefixed throw reaches the CLI sink as a raw stack with dist offsets,
  // so the refusal has to carry the channel glyph to print as one frame.
  it('refuses a directory with no manifest as a framed sentence, not a stack', async () => {
    const root = project()
    const thrown = await preview(root, {
      browser: 'chrome',
      outputPath: path.join(root, 'nope')
    })
      .then(() => undefined)
      .catch((err: Error) => err)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({code: 'E_PREVIEW_NO_DIST'})
    expect(thrown?.message).toContain('⏵⏵⏵')
    expect(thrown?.message).toContain('Preview is run-only')
    expect(thrown?.message).toContain('NOT FOUND')
    expect(thrown?.message).toContain(path.join(root, 'nope', 'manifest.json'))
    expect(launcher).not.toHaveBeenCalled()
  })

  it('returns the fallback as a warning so json output carries it', async () => {
    const root = project({built: []})
    const result = await preview(root, {browser: 'chrome'})

    expect(result?.warnings).toHaveLength(1)
    expect(result?.warnings[0]).toContain(
      'previewing the source manifest directory'
    )

    expect(result?.warnings[0]).not.toContain('⏵⏵⏵')
  })

  it('says so on the no-browser path too, and returns it as a warning', async () => {
    const root = project({built: []})
    const result = await preview(root, {browser: 'chrome', noBrowser: true})

    expect(warned.join('\n')).toContain(
      'previewing the source manifest directory'
    )

    expect(result?.warnings).toHaveLength(1)
    expect(launcher).not.toHaveBeenCalled()
  })

  it('stays quiet about the fallback when dist/<browser> is served', async () => {
    const root = project()
    const result = await preview(root, {browser: 'chrome'})

    expect(logged.join('\n')).not.toContain(
      'previewing the source manifest directory'
    )

    expect(result?.warnings).toEqual([])
  })

  it('describes itself as preview by default', async () => {
    await preview(project(), {browser: 'chrome'})

    const printed = logged.join('\n')

    expect(printed).toContain('Previewing on Chrome.')
    expect(printed).not.toContain('Starting on')
  })

  it('describes itself as start when invoked by start', async () => {
    await preview(project(), {browser: 'chrome', metadataCommand: 'start'})

    const printed = logged.join('\n')

    expect(printed).toContain('Starting on Chrome.')
    expect(printed).not.toContain('Previewing on')
  })

  it('keeps the previewing banner off stdout in machine mode', async () => {
    vi.stubEnv('EXTENSION_OUTPUT', 'json')

    await preview(project(), {browser: 'chrome'})

    expect(logged).toEqual([])
    expect(stderr.join('')).toContain('Previewing on Chrome.')
  })

  it('uses dist/<browser> when dist manifest exists', async () => {
    const root = project()

    await preview(root, {browser: 'chrome'})

    expect(launcher).toHaveBeenCalledTimes(1)
    expect(launched().outPath).toBe(dist(root))
  })

  it('uses an explicit outputPath over dist/<browser>', async () => {
    const root = project()
    // Left as the temp folder spells it, links and all, to prove the path
    // reaches the launcher and the run record exactly as it was passed.
    const custom = tempFolder('extjs-preview-unpacked-')

    writeProjectFiles(custom, {'manifest.json': builtManifest('unpacked')})

    await preview(root, {browser: 'chrome', outputPath: custom})

    expect(launcher).toHaveBeenCalledTimes(1)
    expect(launched().outPath).toBe(custom)
    // The run record describes the loaded directory, so the recorded path and
    // the extension id derived from it match the load.
    expect(readReady(root)).toMatchObject({
      distPath: custom,
      extensionName: 'unpacked'
    })

    expect(
      fs.readFileSync(sessionArtifactsIgnoreFilePath(root), 'utf8')
    ).toMatch(/^\*$/m)

    const printed = logged.join('\n')

    expect(printed).toContain(`Previewing chrome from ${custom}`)
    expect(printed).toContain(dist(root))
  })

  it('previews the build commands.preview.browser names when no browser is passed', async () => {
    const root = project({
      built: ['firefox'],
      config: `{commands: {preview: {browser: 'firefox'}}}`
    })

    await preview(root)

    expect(launched().outPath).toBe(dist(root, 'firefox'))
    expect(launched().browser).toBe('firefox')
  })

  it('records the stock build folder when no outputPath is given', async () => {
    const root = project()

    await preview(root, {browser: 'chrome'})

    expect(readReady(root).distPath).toBe(dist(root))
    expect(logged.join('\n')).not.toContain('Previewing chrome from')
  })

  it('throws when outputPath does not contain manifest.json', async () => {
    const root = project()
    const empty = path.join(root, 'empty')

    fs.mkdirSync(empty)

    await expect(
      preview(root, {browser: 'chrome', outputPath: empty})
    ).rejects.toThrow(/Preview is run-only and does not compile/)

    expect(launcher).not.toHaveBeenCalled()
    // The refusal names the missing manifest and nothing later rewrites it.
    expect(readReady(root)).toMatchObject({
      status: 'error',
      code: 'preview_manifest_missing',
      message: `Expected manifest at ${path.join(empty, 'manifest.json')}`
    })
  })

  // The exit listener is registered once per copy of the command, so a test
  // that counts it or runs it reads a fresh copy.
  async function freshPreview() {
    vi.resetModules()

    const fresh = await import('../command-preview')

    return (root: string, options: Record<string, unknown>) =>
      fresh.extensionPreview(
        root,
        options as unknown as PreviewOptions,
        launcher
      )
  }

  it.each([
    {label: 'preview', metadataCommand: undefined as 'start' | undefined},
    {label: 'start', metadataCommand: 'start' as const}
  ])('stamps stopped when the $label process exits after the launch', async ({
    label,
    metadataCommand
  }) => {
    const root = project()
    const run = await freshPreview()

    await run(root, {browser: 'chrome', metadataCommand})
    await run(root, {browser: 'chrome', metadataCommand})

    expect(launcher).toHaveBeenCalledTimes(2)
    expect(readReady(root).status).toBe('ready')
    expect(exitHandlers).toHaveLength(1)

    const readyAt = readReady(root).ts

    exitHandlers[0]()

    const ended = readReady(root)

    expect(ended).toMatchObject({
      status: 'stopped',
      code: 'shutdown',
      message: `the ${label} session ended`
    })

    expect(Date.parse(ended.ts)).toBeGreaterThanOrEqual(Date.parse(readyAt))
  })

  it('leaves a no-browser ready.json at ready after the process exits', async () => {
    const root = project()
    const run = await freshPreview()

    await run(root, {browser: 'chrome', noBrowser: true})

    expect(readReady(root).status).toBe('ready')
    expect(exitHandlers).toHaveLength(0)
  })

  it('skips browser launch when noBrowser is true', async () => {
    const root = project()

    await preview(root, {browser: 'chrome', noBrowser: true})

    expect(launcher).not.toHaveBeenCalled()

    const ready = readReady(root)

    expect(ready).toMatchObject({
      status: 'ready',
      command: 'preview',
      distPath: dist(root),
      port: null
    })

    const output = logged.join('\n')

    expect(output).toContain('Run ID')
    expect(output).toContain(ready.runId)
    expect(output).toContain('Previewing on Chrome (no-browser mode).')
    expect(output).not.toContain('Skipping the browser launch')
  })

  it('shows Run ID for firefox no-browser preview', async () => {
    const root = project({built: ['firefox']})

    await preview(root, {browser: 'firefox', noBrowser: true})

    expect(launcher).not.toHaveBeenCalled()

    const output = logged.join('\n')

    expect(output).toContain('Run ID')
    expect(output).toContain(readReady(root, 'firefox').runId)
    expect(output).toContain('Firefox (no-browser mode)')
  })

  it('keeps the no-browser card off stdout in machine mode', async () => {
    const root = project()

    vi.stubEnv('EXTENSION_OUTPUT', 'json')

    await preview(root, {browser: 'chrome', noBrowser: true})

    expect(launcher).not.toHaveBeenCalled()
    expect(logged).toEqual([])
    expect(stderr.join('')).toContain(readReady(root).runId)
  })

  it('resolves companion extensions before scanning', async () => {
    const storeId = 'fmkadmapgofadopljbjfkapdkoienihi'
    const storeLink = `https://chromewebstore.google.com/detail/react-developer-tools/${storeId}`
    // The store copy is on disk from an earlier run, so nothing is fetched.
    const root = project({
      built: ['chrome', 'firefox'],
      files: {
        [`extensions/chrome/${storeId}/manifest.json`]:
          builtManifest('from-store')
      }
    })
    const fetched = refuseNetwork()

    await preview(root, {browser: 'chrome', extensions: [storeLink]})

    expect(fetched).not.toHaveBeenCalled()
    expect(launched().extensionsToLoad).toEqual([
      path.join(root, 'extensions', 'chrome', storeId),
      dist(root)
    ])

    // The browser rides along, so a Chrome store link stays out of a Firefox
    // session.
    launcher.mockClear()

    await preview(root, {browser: 'firefox', extensions: [storeLink]})

    expect(fetched).not.toHaveBeenCalled()
    expect(launched().extensionsToLoad).toEqual([dist(root, 'firefox')])
  })

  // A link in the scanned folder that leads out of the project is left out,
  // and only a run that opens a browser says so.
  it.each([
    ['a run that opens a browser', {}, true],
    ['a dry run', {dryRun: true}, false]
  ])('tells the companion scan whether a browser opens: %s', async (_run, options, launches) => {
    const outside = fs.realpathSync(tempFolder('extjs-preview-outside-'))
    const root = project({config: `{extensions: {dir: './extensions'}}`})

    writeProjectFiles(outside, {'manifest.json': builtManifest('outside')})
    fs.mkdirSync(path.join(root, 'extensions'))
    fs.symlinkSync(outside, path.join(root, 'extensions', 'linked'), 'junction')

    await preview(root, {browser: 'chrome', ...options})

    expect(launched().extensionsToLoad).toEqual([dist(root)])
    expect(
      warned
        .join('\n')
        .includes('leads outside the project, so it is not loaded')
    ).toBe(launches)
  })

  it('passes the companions the project names, then the user output, to the preview runner', async () => {
    const root = project({
      config: `{extensions: {dir: './extensions', paths: ['./companions/a']}}`,
      files: {
        'companions/a/manifest.json': builtManifest('companion-a'),
        'extensions/b/manifest.json': builtManifest('companion-b'),
        'extensions/firefox/c/manifest.json': builtManifest('companion-c')
      }
    })

    await preview(root, {browser: 'chrome'})

    expect(launched()).toMatchObject({
      readyPath: readyContractPath(root, 'chrome'),
      contextDir: root,
      extensionsToLoad: [
        path.join(root, 'companions', 'a'),
        path.join(root, 'extensions', 'b'),
        dist(root)
      ]
    })

    // The run record lists what loads beside the user's build, and not it.
    expect(
      readReady(root).managedExtensions.map((managed: any) => managed.path)
    ).toEqual([
      path.join(root, 'companions', 'a'),
      path.join(root, 'extensions', 'b')
    ])
  })

  // Each env file sets the same two keys, so the address the config builds
  // says which mode and which browser the config was read for.
  const ENV_FILES = {
    '.env.production': 'PREVIEW_SPEC_MODE=production\n',
    '.env.development': 'PREVIEW_SPEC_MODE=development\n',
    '.env.chrome': 'PREVIEW_SPEC_BROWSER=chrome\n',
    '.env.firefox': 'PREVIEW_SPEC_BROWSER=firefox\n'
  }
  const ENV_ADDRESS =
    "'https://' + process.env.PREVIEW_SPEC_MODE + '-' + process.env.PREVIEW_SPEC_BROWSER"

  function forgetEnvFiles() {
    delete process.env.PREVIEW_SPEC_MODE
    delete process.env.PREVIEW_SPEC_BROWSER
  }

  it('loads commands.preview config when invoked as preview', async () => {
    const root = project({
      config: `{
  commands: {
    preview: {startingUrl: ${ENV_ADDRESS} + '.preview.example'},
    start: {startingUrl: ${ENV_ADDRESS} + '.start.example'}
  }
}`,
      files: ENV_FILES
    })

    try {
      await preview(root, {browser: 'chrome'})
    } finally {
      forgetEnvFiles()
    }

    expect(launched().startingUrl).toBe(
      'https://production-chrome.preview.example'
    )
  })

  it('loads commands.start config when invoked via start delegation', async () => {
    const root = project({
      config: `{
  commands: {
    preview: {
      startingUrl: ${ENV_ADDRESS} + '.preview.example',
      profile: '/from/commands/preview',
      browserFlags: ['--preview-flag']
    },
    start: {
      startingUrl: ${ENV_ADDRESS} + '.start.example',
      profile: '/from/commands/start',
      browserFlags: ['--start-flag']
    }
  }
}`,
      files: ENV_FILES
    })

    try {
      await preview(root, {browser: 'chrome', metadataCommand: 'start'})
    } finally {
      forgetEnvFiles()
    }

    expect(launched().startingUrl).toBe(
      'https://production-chrome.start.example'
    )

    expect(launched().profile).toBe('/from/commands/start')
    expect(launched().browserFlags).toEqual(['--start-flag', ...DARK_FLAGS])
  })

  describe.each([
    {label: 'preview', metadataCommand: undefined as 'start' | undefined},
    {label: 'start', metadataCommand: 'start' as const}
  ])('option precedence for $label (CLI > commands.$label > browser > defaults)', ({
    label,
    metadataCommand
  }) => {
    it('applies stock logger defaults when neither config nor CLI sets them', async () => {
      await preview(project(), {browser: 'chrome', metadataCommand})

      expect(launched()).toMatchObject({
        logFormat: 'pretty',
        logTimestamps: true,
        logColor: true,
        logLevel: 'off'
      })
    })

    it(`lets commands.${label} beat browser config for logger options (config-only)`, async () => {
      const root = project({
        config: `{
  browser: {chrome: {startingUrl: 'https://from-browser.example'}},
  commands: {
    ${label}: {
      startingUrl: 'https://from-commands-${label}.example',
      logFormat: 'json',
      logColor: false,
      logLevel: 'debug'
    }
  }
}`
      })

      await preview(root, {browser: 'chrome', metadataCommand})

      expect(launched()).toMatchObject({
        startingUrl: `https://from-commands-${label}.example`,
        logFormat: 'json',
        logColor: false,
        logLevel: 'debug'
      })
    })

    it(`lets explicit CLI values beat commands.${label} in both directions (both)`, async () => {
      const root = project({
        config: `{
  commands: {
    ${label}: {
      startingUrl: 'https://from-commands-${label}.example',
      logFormat: 'json',
      logColor: false
    }
  }
}`
      })

      await preview(root, {
        browser: 'chrome',
        metadataCommand,
        startingUrl: 'https://from-cli.example',
        logFormat: 'pretty',
        logColor: true
      })

      expect(launched()).toMatchObject({
        startingUrl: 'https://from-cli.example',
        logFormat: 'pretty',
        logColor: true
      })
    })

    it('applies flag-only logger values over stock defaults (flag-only)', async () => {
      await preview(project(), {
        browser: 'chrome',
        metadataCommand,
        logFormat: 'ndjson',
        logColor: false
      })

      expect(launched()).toMatchObject({
        logFormat: 'ndjson',
        logColor: false,
        logTimestamps: true
      })
    })

    it('concatenates browserFlags and deep-merges preferences across layers', async () => {
      const root = project({
        config: `{
  browser: {
    chrome: {
      browserFlags: ['--from-browser'],
      preferences: {a: 1, nested: {x: 1}}
    }
  },
  commands: {
    ${label}: {
      browserFlags: ['--from-command'],
      preferences: {b: 2, nested: {y: 2}}
    }
  }
}`
      })

      await preview(root, {
        browser: 'chrome',
        metadataCommand,
        browserFlags: ['--from-cli'],
        preferences: {a: 99, nested: {x: 3}}
      })

      expect(launched().browserFlags).toEqual([
        '--from-browser',
        '--from-command',
        '--from-cli',
        ...DARK_FLAGS
      ])

      expect(launched().preferences).toEqual({
        a: 99,
        b: 2,
        nested: {x: 3, y: 2}
      })
    })

    it('hands excludeBrowserFlags to the shared appearance defaults', async () => {
      const root = project()

      await preview(root, {browser: 'chrome', metadataCommand})

      expect(launched().browserFlags).toEqual(DARK_FLAGS)

      launcher.mockClear()

      await preview(root, {
        browser: 'chrome',
        metadataCommand,
        excludeBrowserFlags: ['--force-dark-mode']
      })

      expect(launched().browserFlags).toEqual([])
      expect(launched().excludeBrowserFlags).toEqual(['--force-dark-mode'])
    })
  })

  // The package root holds the config and the dependency, and the manifest
  // sits one folder down, so the warning proves which folder was read.
  it('checks managed dependency conflicts using package root when manifest is in src', async () => {
    const root = project({
      manifestFile: 'src/manifest.json',
      packageJson: {devDependencies: {'@rspack/core': '1.0.0'}},
      config: `{config: (config) => config} // loads '@rspack/core'`
    })

    await preview(root, {browser: 'chrome'})

    expect(launched()).toMatchObject({contextDir: root, outPath: dist(root)})
    expect(readReady(root).manifestPath).toBe(
      path.join(root, 'src', 'manifest.json')
    )

    const warnings = warned.join('\n')

    expect(warnings).toContain('@rspack/core')
    expect(warnings).toContain('extension.config.js')
  })
})
