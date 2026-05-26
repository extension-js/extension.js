import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {afterEach, describe, expect, it} from 'vitest'
import {
  createPlaywrightMetadataWriter,
  getPlaywrightMetadataDir
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
    // unset string fields are omitted (not serialized as undefined)
    expect('instanceId' in ready).toBe(false)
    // controlPort normalizes to null when unset
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
})
