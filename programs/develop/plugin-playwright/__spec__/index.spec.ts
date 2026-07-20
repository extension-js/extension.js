import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  createPlaywrightMetadataWriter,
  formatStatsErrors,
  getPlaywrightMetadataDir,
  PlaywrightPlugin
} from '../index'

describe('plugin-playwright metadata writer', () => {
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

  it('writes ready.json under dist/extension-js/<browser>', () => {
    const projectRoot = createTempProject()
    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: projectRoot,
      browser: 'chromium',
      command: 'dev',
      distPath: path.join(projectRoot, 'dist', 'chromium'),
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080
    })

    writer.writeStarting()
    writer.writeReady('2026-03-04T00:00:00.000Z')

    const dir = getPlaywrightMetadataDir(projectRoot, 'chromium')
    const readyPath = path.join(dir, 'ready.json')
    expect(fs.existsSync(readyPath)).toBe(true)
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'))
    expect(ready.status).toBe('ready')
    expect(ready.command).toBe('dev')
    expect(ready.browser).toBe('chromium')
    expect(typeof ready.runId).toBe('string')
    expect(ready.runId.length).toBeGreaterThan(5)
    expect(typeof ready.startedAt).toBe('string')
    expect(ready.compiledAt).toBe('2026-03-04T00:00:00.000Z')
  })

  it('emits schemaVersion 2 and agent-bridge discovery fields', () => {
    const projectRoot = createTempProject()
    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: projectRoot,
      browser: 'chrome',
      command: 'dev',
      distPath: path.join(projectRoot, 'dist', 'chrome'),
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080,
      instanceId: 'inst-xyz',
      controlPort: 8147,
      controlPath: '/extjs-control',
      logsPath: 'dist/extension-js/chrome/logs.ndjson'
    })

    writer.writeReady('2026-03-04T00:00:00.000Z')

    const ready = JSON.parse(
      fs.readFileSync(
        path.join(
          getPlaywrightMetadataDir(projectRoot, 'chrome'),
          'ready.json'
        ),
        'utf8'
      )
    )
    expect(ready.schemaVersion).toBe(2)
    expect(ready.instanceId).toBe('inst-xyz')
    expect(ready.controlPort).toBe(8147)
    expect(ready.controlPath).toBe('/extjs-control')
    expect(ready.logsPath).toBe('dist/extension-js/chrome/logs.ndjson')
  })

  it('still emits schemaVersion 2 with control fields omitted when unset', () => {
    const projectRoot = createTempProject()
    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: projectRoot,
      browser: 'chromium',
      command: 'dev',
      distPath: path.join(projectRoot, 'dist', 'chromium'),
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080
    })

    writer.writeReady('2026-03-04T00:00:00.000Z')

    const ready = JSON.parse(
      fs.readFileSync(
        path.join(
          getPlaywrightMetadataDir(projectRoot, 'chromium'),
          'ready.json'
        ),
        'utf8'
      )
    )
    expect(ready.schemaVersion).toBe(2)
    expect('instanceId' in ready).toBe(false)
    expect(ready.controlPort).toBeNull()
  })

  it('appends events as ndjson', () => {
    const projectRoot = createTempProject()
    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: projectRoot,
      browser: 'firefox',
      command: 'preview',
      distPath: path.join(projectRoot, 'dist', 'firefox'),
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

    const eventsPath = path.join(
      getPlaywrightMetadataDir(projectRoot, 'firefox'),
      'events.ndjson'
    )
    const lines = fs
      .readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
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
    const plugin = new PlaywrightPlugin({
      packageJsonDir: projectRoot,
      browser: 'chromium',
      mode: 'development',
      outputPath: path.join(projectRoot, 'dist', 'chromium'),
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080
    })

    const taps: Record<string, (arg?: unknown) => void> = {}
    const hook = (name: string) => ({
      tap: (_pluginName: string, fn: (arg?: unknown) => void) => {
        taps[name] = fn
      }
    })
    plugin.apply({
      hooks: {
        compile: hook('compile'),
        done: hook('done'),
        failed: hook('failed'),
        watchClose: hook('watchClose')
      }
    } as any)

    taps.done({
      compilation: {startTime: 0, endTime: 25},
      hasErrors: () => true,
      toJson: () => ({
        errors: [
          {
            message:
              '\u001b[31m× Module build failed\u001b[0m: Unterminated string constant'
          }
        ]
      })
    })

    const dir = getPlaywrightMetadataDir(projectRoot, 'chromium')
    const ready = JSON.parse(
      fs.readFileSync(path.join(dir, 'ready.json'), 'utf8')
    )
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('compile_error')
    expect(ready.errors).toEqual([
      '× Module build failed: Unterminated string constant'
    ])

    const events = fs
      .readFileSync(path.join(dir, 'events.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const errorEvent = events.find((event) => event.type === 'compile_error')
    expect(errorEvent.errorCount).toBe(1)
    expect(errorEvent.errors).toEqual([
      '× Module build failed: Unterminated string constant'
    ])
  })

  it('falls back to the errors: N placeholder when stats carry no messages', () => {
    const projectRoot = createTempProject()
    const plugin = new PlaywrightPlugin({
      packageJsonDir: projectRoot,
      browser: 'chromium',
      mode: 'development',
      outputPath: path.join(projectRoot, 'dist', 'chromium'),
      manifestPath: path.join(projectRoot, 'manifest.json'),
      port: 8080
    })

    const taps: Record<string, (arg?: unknown) => void> = {}
    const hook = (name: string) => ({
      tap: (_pluginName: string, fn: (arg?: unknown) => void) => {
        taps[name] = fn
      }
    })
    plugin.apply({
      hooks: {
        compile: hook('compile'),
        done: hook('done'),
        failed: hook('failed'),
        watchClose: hook('watchClose')
      }
    } as any)

    taps.done({
      compilation: {startTime: 0, endTime: 25},
      hasErrors: () => true,
      toJson: () => ({errors: [{message: ''}, {message: '   '}]})
    })

    const dir = getPlaywrightMetadataDir(projectRoot, 'chromium')
    const ready = JSON.parse(
      fs.readFileSync(path.join(dir, 'ready.json'), 'utf8')
    )
    expect(ready.errors).toEqual(['errors: 2'])
  })
})
