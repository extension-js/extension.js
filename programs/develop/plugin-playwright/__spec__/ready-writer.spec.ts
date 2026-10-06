import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {chromiumExtensionId} from '../../lib/extension-id'
import {
  createPlaywrightMetadataWriter,
  getSessionRunId,
  stampReadyKnownExtensionId
} from '../index'

describe('ready.json writer preservation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-writer-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = () =>
    createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'dev',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })

  it('preserves launcher-stamped browserExitedAt/browserExitCode across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.browserExitedAt = '2026-07-12T00:00:00.000Z'
    ready.browserExitCode = 21
    ready.browserExitSignal = 'SIGTRAP'
    ready.cdpPort = 9223
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('ready')
    expect(after.browserExitedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(after.browserExitCode).toBe(21)
    expect(after.browserExitSignal).toBe('SIGTRAP')
    expect(after.cdpPort).toBe(9223)
  })

  it('keeps a browser gone before anything loaded as an error across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'browser_exited'
    ready.message =
      'the chromium process exited (code 0) before the extension loaded, nothing is running'

    ready.browserExitedAt = '2026-07-12T00:00:00.000Z'
    ready.browserExitCode = 0
    ready.browserExitSignal = null
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('error')
    expect(after.code).toBe('browser_exited')
    expect(after.message).toMatch(/before the extension loaded/)
    expect(after.browserExitedAt).toBe('2026-07-12T00:00:00.000Z')
  })

  it('keeps a browser that never spawned as an error across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'browser_launch_failed'
    ready.message =
      'the chromium process could not start (spawn /x/chrome EACCES), nothing is running'

    ready.browserLaunchFailedAt = '2026-07-12T00:00:00.000Z'
    ready.browserLaunchFailedReason = 'spawn /x/chrome EACCES'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('error')
    expect(after.code).toBe('browser_launch_failed')
    expect(after.message).toMatch(/could not start/)
    expect(after.browserLaunchFailedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(after.browserLaunchFailedReason).toBe('spawn /x/chrome EACCES')
  })

  it('preserves the launcher-stamped rdpPort across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.rdpPort = 9224
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.rdpPort).toBe(9224)
  })

  it('preserves the launcher-stamped WebDriver session across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.webdriverPort = 61234
    ready.webdriverSessionId = 'E3A9-webdriver-writer'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.webdriverPort).toBe(61234)
    expect(after.webdriverSessionId).toBe('E3A9-webdriver-writer')
  })

  it('preserves the launcher-stamped WebDriver refusal across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.webdriverUnavailableReason = 'Allow Remote Automation is off'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.webdriverUnavailableReason).toBe(
      'Allow Remote Automation is off'
    )
  })

  it('preserves the launcher-stamped profilePath and browserPid across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.profilePath = path.join(
      tmp,
      'dist',
      'extension-js',
      'profiles',
      'chromium-profile',
      'brave-Crimson-panda'
    )

    ready.browserPid = 4242
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.profilePath).toBe(ready.profilePath)
    expect(after.browserPid).toBe(4242)
  })

  it('ready.json runId equals getSessionRunId for the same session', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.runId).toBe(getSessionRunId(tmp, 'chromium'))
    // A different browser is a different session identity.
    expect(getSessionRunId(tmp, 'firefox')).not.toBe(ready.runId)
  })

  it('does not invent the fields when the launcher never stamped them', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect('browserExitedAt' in after).toBe(false)
    expect('browserExitCode' in after).toBe(false)
    expect('profilePath' in after).toBe(false)
    expect('browserPid' in after).toBe(false)
    expect('extensionId' in after).toBe(false)
  })

  it('derives the extension id from the emitted dist once it exists', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')
    fs.mkdirSync(distPath, {recursive: true})
    fs.writeFileSync(
      path.join(distPath, 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )

    const writer = makeWriter()
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.extensionId).toBe(chromiumExtensionId(distPath))
  })

  it('derives the declared gecko id for a firefox session', () => {
    const distPath = path.join(tmp, 'dist', 'firefox')
    fs.mkdirSync(distPath, {recursive: true})
    fs.writeFileSync(
      path.join(distPath, 'manifest.json'),
      JSON.stringify({
        name: 'Fixture',
        version: '1.0.0',
        browser_specific_settings: {gecko: {id: 'fixture@extension.js'}}
      })
    )

    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'firefox',
      command: 'dev',
      distPath,
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.extensionId).toBe('fixture@extension.js')
  })

  // Safari has no dist-derivable id (identity is the appex bundle id the
  // packager assigns), so ready.json must not carry a chromium hash for it.
  it('never derives a chromium id for a safari session', () => {
    const distPath = path.join(tmp, 'dist', 'safari')
    fs.mkdirSync(distPath, {recursive: true})
    fs.writeFileSync(
      path.join(distPath, 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )

    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'safari',
      command: 'build',
      distPath,
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect('extensionId' in after).toBe(false)
  })

  it('backfills a packager-known extension id for safari, first stamp wins', () => {
    const distPath = path.join(tmp, 'dist', 'safari')
    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'safari',
      command: 'build',
      distPath,
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    writer.writeReady()

    stampReadyKnownExtensionId(
      tmp,
      'safari',
      'dev.extensionjs.Fixture.Extension'
    )

    const stamped = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(stamped.extensionId).toBe('dev.extensionjs.Fixture.Extension')

    stampReadyKnownExtensionId(tmp, 'safari', 'com.example.other.Extension')
    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.extensionId).toBe('dev.extensionjs.Fixture.Extension')
  })

  it('keeps a launcher-confirmed extension id over the derived one across recompiles', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')
    fs.mkdirSync(distPath, {recursive: true})
    fs.writeFileSync(
      path.join(distPath, 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )

    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.extensionId = 'glocgelajdejkheibpdooiagpkkbfmhe'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.extensionId).toBe('glocgelajdejkheibpdooiagpkkbfmhe')
  })

  it('stamps runtime:"attached"/executorAttachedAt once and preserves it across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    writer.stampExecutorAttached()
    const stamped = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(stamped.runtime).toBe('attached')
    expect(typeof stamped.executorAttachedAt).toBe('string')
    const firstStamp = stamped.executorAttachedAt

    writer.writeReady()
    const afterCompile = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(afterCompile.runtime).toBe('attached')
    expect(afterCompile.executorAttachedAt).toBe(firstStamp)

    writer.stampExecutorAttached()
    const afterReattach = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(afterReattach.executorAttachedAt).toBe(firstStamp)
  })

  it('does not invent the runtime signal before the SW attaches', () => {
    const writer = makeWriter()
    writer.writeReady()
    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect('runtime' in after).toBe(false)
    expect('executorAttachedAt' in after).toBe(false)
  })

  it('writeShutdown flips status to stopped, keeping session provenance', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.cdpPort = 9223
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeShutdown()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('stopped')
    expect(after.code).toBe('shutdown')
    expect(after.cdpPort).toBe(9223)
    expect(after.runId).toBe(ready.runId)
  })

  it('stampExecutorDetached flips runtime off once the producer leaves', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.stampExecutorAttached()

    const attached = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(attached.runtime).toBe('attached')
    expect(typeof attached.executorAttachedAt).toBe('string')

    writer.stampExecutorDetached()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.runtime).toBe('detached')
    expect(typeof after.executorDetachedAt).toBe('string')
    // The attach time stays as provenance: it did connect once.
    expect(after.executorAttachedAt).toBe(attached.executorAttachedAt)
  })

  it('a recompile does not resurrect a producer that went away', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.stampExecutorAttached()
    writer.stampExecutorDetached()

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.runtime).toBe('detached')
    expect(typeof after.executorDetachedAt).toBe('string')
  })

  it('a reconnect clears the detached mark', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.stampExecutorAttached()
    writer.stampExecutorDetached()

    writer.stampExecutorAttached()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.runtime).toBe('attached')
    expect('executorDetachedAt' in after).toBe(false)
  })

  it('stampExecutorDetached is a no-op when nothing ever attached', () => {
    const writer = makeWriter()
    writer.writeReady()

    writer.stampExecutorDetached()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect('runtime' in after).toBe(false)
    expect('executorDetachedAt' in after).toBe(false)
  })

  it('writeShutdown records the ending the caller names', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.writeShutdown('the preview session ended')

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('stopped')
    expect(after.message).toBe('the preview session ended')
  })

  it('writeShutdown is a no-op when no contract was ever written', () => {
    const writer = makeWriter()
    writer.writeShutdown()
    expect(fs.existsSync(writer.readyPath)).toBe(false)
  })

  it('a writer a later writeStarting superseded leaves the contract alone', () => {
    const first = makeWriter()
    first.writeStarting()
    first.writeReady()

    const next = makeWriter()
    next.writeStarting()
    expect(first.isSuperseded()).toBe(true)
    expect(next.isSuperseded()).toBe(false)

    first.writeShutdown()
    first.writeError('compile_error', 'late')
    first.writeReady()

    const after = JSON.parse(fs.readFileSync(next.readyPath, 'utf-8'))
    expect(after.status).toBe('starting')
    expect(after.code).toBeUndefined()

    next.writeShutdown()
    expect(JSON.parse(fs.readFileSync(next.readyPath, 'utf-8')).status).toBe(
      'stopped'
    )
  })

  it('writeStarting from the same run keeps startedAt', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.writeReady()
    const first = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))

    const next = makeWriter()
    next.writeStarting()

    const after = JSON.parse(fs.readFileSync(next.readyPath, 'utf-8'))
    expect(after.status).toBe('starting')
    expect(after.startedAt).toBe(first.startedAt)
  })

  it('writeShutdown and stampExecutorDetached refuse another run on disk', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.stampExecutorAttached()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.runId = 'another-run'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeShutdown()
    writer.stampExecutorDetached()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('ready')
    expect(after.runtime).toBe('attached')
    expect('executorDetachedAt' in after).toBe(false)
  })

  it('a build writer never rewrites a LIVE dev session contract', () => {
    const devWriter = makeWriter()
    devWriter.writeReady()
    const ready = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    ready.pid = process.ppid
    fs.writeFileSync(devWriter.readyPath, JSON.stringify(ready))

    const buildWriter = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'build',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    buildWriter.writeStarting()
    buildWriter.writeReady()
    buildWriter.appendEvent({
      type: 'compile_success',
      ts: new Date().toISOString(),
      command: 'build',
      browser: 'chromium'
    })

    const after = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    expect(after.command).toBe('dev')
    expect(after.pid).toBe(process.ppid)
    expect(after.runId).toBe(ready.runId)
    expect(fs.existsSync(devWriter.eventsPath)).toBe(false)
  })

  it('a build writer takes over a DEAD dev session contract normally', () => {
    const devWriter = makeWriter()
    devWriter.writeReady()
    const ready = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    ready.pid = 99999999
    fs.writeFileSync(devWriter.readyPath, JSON.stringify(ready))

    const buildWriter = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'build',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    buildWriter.writeStarting()

    const after = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    expect(after.command).toBe('build')
    expect(after.pid).toBe(process.pid)
  })

  // The browser refused the guest. A later compile succeeding says nothing
  // about that, so the contract must not drift back to green underneath it.
  it('keeps a browser load refusal red across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'extension_load_refused'
    ready.message = 'Chrome refused to load the extension at /dist/chrome'
    ready.extensionLoadRefusedAt = '2026-07-24T00:00:00.000Z'
    ready.extensionLoadRefusedReason = 'Variable $2$ used but not defined.'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('error')
    expect(after.code).toBe('extension_load_refused')
    expect(after.extensionLoadRefusedReason).toBe(
      'Variable $2$ used but not defined.'
    )

    expect(after.message).toContain('refused to load')
  })

  it('preserves compiledAt when a later writer in the same run omits it', () => {
    const writer = makeWriter()
    writer.writeReady('2026-08-15T12:00:00.000Z')
    const first = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))

    const next = makeWriter()
    next.writeReady()

    const after = JSON.parse(fs.readFileSync(next.readyPath, 'utf-8'))
    expect(after.compiledAt).toBe('2026-08-15T12:00:00.000Z')
    expect(after.startedAt).toBe(first.startedAt)
  })

  // A new run re-asks the browser, so last run's verdict must not outlive it.
  it('drops the refusal when a new run starts', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.extensionLoadRefusedAt = '2026-07-24T00:00:00.000Z'
    ready.extensionLoadRefusedReason = 'stale reason'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    const nextRun = makeWriter()
    nextRun.writeStarting()
    nextRun.writeReady()

    const after = JSON.parse(fs.readFileSync(nextRun.readyPath, 'utf-8'))
    expect(after.status).toBe('ready')
    expect(after.code).toBeUndefined()
    expect(after.extensionLoadRefusedAt).toBeUndefined()
  })

  // The executor runs inside the guest, so an attach proves the browser
  // is running it - whoever repaired the load, the red verdict is now stale.
  it('clears a load refusal when the executor attaches', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'extension_load_refused'
    ready.message = 'Chrome refused to load the extension at /dist/chromium'
    ready.extensionLoadRefusedAt = '2026-07-24T00:00:00.000Z'
    ready.extensionLoadRefusedReason = 'Variable $2$ used but not defined.'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.stampExecutorAttached()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('ready')
    expect(after.code).toBeUndefined()
    expect(after.message).toBeUndefined()
    expect(after.extensionLoadRefusedAt).toBeUndefined()
    expect(after.extensionLoadRefusedReason).toBeUndefined()
    expect(after.runtime).toBe('attached')
  })

  // Once cleared it must stay cleared: the carry-forward reads the file it
  // just healed, so a later compile must not resurrect the refusal.
  it('does not resurrect a cleared refusal on the next compile', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'extension_load_refused'
    ready.extensionLoadRefusedAt = '2026-07-24T00:00:00.000Z'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.stampExecutorAttached()
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('ready')
    expect(after.code).toBeUndefined()
    expect(after.extensionLoadRefusedAt).toBeUndefined()
  })

  // An attach says nothing about an unrelated failure, so only the refusal
  // verdict may be cleared.
  it('leaves a non-refusal error status alone', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'compile_failed'
    ready.message = 'build broke'
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.stampExecutorAttached()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('error')
    expect(after.code).toBe('compile_failed')
    expect(after.message).toBe('build broke')
  })
})

describe('ready.json names the extension the browser loaded', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-provenance-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const writeManifest = (dir: string, name: string, version: string) => {
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name, version})
    )
  }

  it('reads name and version from the dist, not the edited source', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')
    const srcDir = path.join(tmp, 'src')
    writeManifest(distPath, 'Built Name', '1.0.0')
    writeManifest(srcDir, 'Edited Name', '9.9.9')

    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'preview',
      distPath,
      manifestPath: path.join(srcDir, 'manifest.json')
    })
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.extensionName).toBe('Built Name')
    expect(ready.extensionVersion).toBe('1.0.0')
  })

  it('falls back to the source manifest when the dist has none', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')
    const srcDir = path.join(tmp, 'src')
    fs.mkdirSync(distPath, {recursive: true})
    writeManifest(srcDir, 'Source Only', '2.0.0')

    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'preview',
      distPath,
      manifestPath: path.join(srcDir, 'manifest.json')
    })
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.extensionName).toBe('Source Only')
    expect(ready.extensionVersion).toBe('2.0.0')
  })
})
