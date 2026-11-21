import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  formatStatsErrors,
  getReadyContractDir,
  ReadyContractPlugin
} from '../index'
import {
  applyToFakeCompiler,
  doneStats,
  makeWriter,
  readContract,
  readEvents
} from './helpers/contract'

describe('plugin-ready-contract metadata writer', () => {
  const tmpRoots: string[] = []

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, {recursive: true, force: true})
    }

    tmpRoots.length = 0
  })

  function createTempProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-meta-'))
    tmpRoots.push(root)

    return root
  }

  const readyIn = (projectRoot: string, browser: string) =>
    readContract(
      path.join(getReadyContractDir(projectRoot, browser), 'ready.json')
    )

  const eventsIn = (projectRoot: string, browser: string) =>
    readEvents(
      path.join(getReadyContractDir(projectRoot, browser), 'events.ndjson')
    )

  const makePlugin = (
    projectRoot: string,
    options: Partial<ConstructorParameters<typeof ReadyContractPlugin>[0]> = {}
  ) => {
    const browser = options.browser ?? 'chromium'

    return new ReadyContractPlugin({
      packageJsonDir: projectRoot,
      browser,
      mode: 'development',
      outputPath: path.join(projectRoot, 'dist', browser),
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080,
      ...options
    })
  }

  it('writes ready.json under dist/extension-js/<browser>', () => {
    const projectRoot = createTempProject()
    const writer = makeWriter(projectRoot, {
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080
    })

    writer.writeStarting()
    writer.writeReady('2026-03-04T00:00:00.000Z')

    const readyPath = path.join(
      getReadyContractDir(projectRoot, 'chromium'),
      'ready.json'
    )
    expect(fs.existsSync(readyPath)).toBe(true)
    const ready = readContract(readyPath)
    expect(ready.status).toBe('ready')
    expect(ready.command).toBe('dev')
    expect(ready.browser).toBe('chromium')
    expect(typeof ready.runId).toBe('string')
    expect(String(ready.runId).length).toBeGreaterThan(5)
    expect(typeof ready.startedAt).toBe('string')
    expect(ready.compiledAt).toBe('2026-03-04T00:00:00.000Z')
  })

  it('emits schemaVersion 2 and agent-bridge discovery fields', () => {
    const projectRoot = createTempProject()
    const writer = makeWriter(projectRoot, {
      browser: 'chrome',
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080,
      instanceId: 'inst-xyz',
      controlPort: 8147,
      controlPath: '/extjs-control',
      logsPath: 'dist/extension-js/chrome/logs.ndjson'
    })

    writer.writeReady('2026-03-04T00:00:00.000Z')

    const ready = readyIn(projectRoot, 'chrome')
    expect(ready.schemaVersion).toBe(2)
    expect(ready.instanceId).toBe('inst-xyz')
    expect(ready.controlPort).toBe(8147)
    expect(ready.controlPath).toBe('/extjs-control')
    expect(ready.logsPath).toBe('dist/extension-js/chrome/logs.ndjson')
  })

  it('still emits schemaVersion 2 with control fields omitted when unset', () => {
    const projectRoot = createTempProject()
    const writer = makeWriter(projectRoot, {
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080
    })

    writer.writeReady('2026-03-04T00:00:00.000Z')

    const ready = readyIn(projectRoot, 'chromium')
    expect(ready.schemaVersion).toBe(2)
    expect('instanceId' in ready).toBe(false)
    expect(ready.controlPort).toBeNull()
  })

  it('appends events as ndjson', () => {
    const projectRoot = createTempProject()
    const writer = makeWriter(projectRoot, {
      browser: 'firefox',
      command: 'preview',
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: null
    })

    writer.appendEvent({
      type: 'compile_start',
      ts: '2026-03-04T00:00:00.000Z',
      command: 'preview',
      browser: 'firefox'
    })

    writer.appendEvent({
      type: 'compile_success',
      ts: '2026-03-04T00:00:01.000Z',
      command: 'preview',
      browser: 'firefox',
      durationMs: 100,
      errorCount: 0
    })

    const lines = eventsIn(projectRoot, 'firefox')
    expect(lines).toHaveLength(2)
    expect(lines[0].type).toBe('compile_start')
    expect(lines[1].type).toBe('compile_success')
  })

  it('formats stats errors: message extraction, ANSI strip, cap at 10', () => {
    expect(formatStatsErrors(undefined)).toEqual([])
    expect(formatStatsErrors('nope')).toEqual([])
    expect(
      formatStatsErrors([
        {message: '\u001b[31mModule build failed\u001b[0m: bad token'},
        'plain string error',
        {message: '   '},
        null
      ])
    ).toEqual(['Module build failed: bad token', 'plain string error'])

    const many = Array.from({length: 15}, (_, i) => ({message: `error ${i}`}))
    expect(formatStatsErrors(many)).toHaveLength(10)
  })

  it('writes real compile-error text into ready.json and the compile_error event', () => {
    const projectRoot = createTempProject()
    const taps = applyToFakeCompiler(makePlugin(projectRoot))

    taps.done(
      doneStats([
        {
          message:
            '\u001b[31m× Module build failed\u001b[0m: Unterminated string constant'
        }
      ])
    )

    const ready = readyIn(projectRoot, 'chromium')
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('compile_error')
    expect(ready.errors).toEqual([
      '× Module build failed: Unterminated string constant'
    ])

    const errorEvent = eventsIn(projectRoot, 'chromium').find(
      (event) => event.type === 'compile_error'
    )
    expect(errorEvent?.errorCount).toBe(1)
    expect(errorEvent?.errors).toEqual([
      '× Module build failed: Unterminated string constant'
    ])
  })

  it('writes the failed-hook error as plain text into errors and the event', () => {
    const projectRoot = createTempProject()
    const taps = applyToFakeCompiler(
      makePlugin(projectRoot, {browser: 'firefox'})
    )

    taps.failed(
      new Error('\u001b[31mERROR\u001b[39m Cannot read the rspack config')
    )

    const ready = readyIn(projectRoot, 'firefox')
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('compile_failed')
    expect(ready.compiledAt).toBeNull()
    expect(ready.message).toBe('ERROR Cannot read the rspack config')
    expect(ready.errors).toEqual(['ERROR Cannot read the rspack config'])

    const errorEvent = eventsIn(projectRoot, 'firefox').find(
      (event) => event.type === 'compile_error'
    )
    expect(errorEvent?.errorCount).toBe(1)
    expect(errorEvent?.errors).toEqual(['ERROR Cannot read the rspack config'])
  })

  it('falls back to the errors: N placeholder when stats carry no messages', () => {
    const projectRoot = createTempProject()
    const taps = applyToFakeCompiler(makePlugin(projectRoot))

    taps.done(doneStats([{message: ''}, {message: '   '}]))

    expect(readyIn(projectRoot, 'chromium').errors).toEqual(['errors: 2'])
  })

  it('keeps the receipt on starting after a compile a launch follows', () => {
    const projectRoot = createTempProject()
    const taps = applyToFakeCompiler(
      makePlugin(projectRoot, {
        browser: 'chrome',
        mode: 'production',
        command: 'start',
        port: null,
        launchFollows: true
      })
    )

    taps.done(doneStats())

    const ready = readyIn(projectRoot, 'chrome')
    expect(ready.status).toBe('starting')
    expect(ready.command).toBe('start')
    expect(typeof ready.compiledAt).toBe('string')

    expect(
      eventsIn(projectRoot, 'chrome').map((event) => event.type)
    ).toContain('compile_success')
  })
})

describe('the plugin across a watch session', () => {
  const tmpRoots: string[] = []

  afterEach(() => {
    for (const root of tmpRoots.splice(0)) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  const watchedPlugin = (
    options: Partial<ConstructorParameters<typeof ReadyContractPlugin>[0]> = {}
  ) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-watch-'))
    tmpRoots.push(projectRoot)

    const plugin = new ReadyContractPlugin({
      packageJsonDir: projectRoot,
      browser: 'chromium',
      mode: 'development',
      outputPath: path.join(projectRoot, 'dist', 'chromium'),
      manifestPath: path.join(projectRoot, 'manifest.json'),
      ...options
    })
    const metadataDir = getReadyContractDir(projectRoot, 'chromium')

    return {
      plugin,
      projectRoot,
      ready: () => readContract(path.join(metadataDir, 'ready.json')),
      eventTypes: () =>
        readEvents(path.join(metadataDir, 'events.ndjson')).map(
          (event) => event.type
        )
    }
  }

  it('appends compile_start when a compile begins', () => {
    const session = watchedPlugin()
    const taps = applyToFakeCompiler(session.plugin)

    taps.compile()

    expect(session.eventTypes()).toEqual(['compile_start'])
  })

  it('on watch close a dev session appends shutdown and stamps stopped', () => {
    const session = watchedPlugin()
    const taps = applyToFakeCompiler(session.plugin)
    taps.done(doneStats())

    taps.watchClose()

    expect(session.eventTypes()).toEqual(['compile_success', 'shutdown'])
    const ready = session.ready()
    expect(ready.status).toBe('stopped')
    expect(ready.code).toBe('shutdown')
    expect(ready.message).toBe('the dev session ended (watch closed)')
  })

  it('on watch close a start receipt stays ready', () => {
    const session = watchedPlugin({mode: 'production', command: 'start'})
    const taps = applyToFakeCompiler(session.plugin)
    taps.done(doneStats())

    taps.watchClose()

    expect(session.eventTypes()).toEqual(['compile_success', 'shutdown'])
    expect(session.ready().status).toBe('ready')
    expect(session.ready().code).toBeUndefined()
  })

  it('a watch that a restart superseded closes without the event or the stamp', () => {
    const first = watchedPlugin()
    const closing = applyToFakeCompiler(first.plugin)
    const restarted = new ReadyContractPlugin({
      packageJsonDir: first.projectRoot,
      browser: 'chromium',
      mode: 'development',
      outputPath: path.join(first.projectRoot, 'dist', 'chromium'),
      manifestPath: path.join(first.projectRoot, 'manifest.json')
    })
    applyToFakeCompiler(restarted)

    closing.watchClose()

    expect(first.eventTypes()).toEqual([])
    expect(first.ready().status).toBe('starting')
  })
})
