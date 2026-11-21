import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {chromiumExtensionId} from '../../lib/extension-id'
import {processStartedAtMs, processStartId} from '../../lib/process-started-at'
import {
  forgetSessionRun,
  getSessionRunId,
  stampReadyDistExtensionId,
  stampReadyKnownExtensionId
} from '../index'
import {
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  stampReadyBrowserExited,
  stampReadyBrowserLaunch,
  stampReadyBrowserLaunchFailed,
  stampReadyBrowserUpNotAttached,
  stampReadyCdpFault,
  stampReadyCdpPort,
  stampReadyExtensionId,
  stampReadyExtensionLoadRefused,
  stampReadyRdpPort,
  stampReadyWebDriver,
  writeManifest
} from './helpers/contract'

const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gunVTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxKLxoS2tFczGkPLPgizskuemMghRniWaoLcyehkd3qqGElvW/VDL5AaWTg0nLVkjRo9z+40RQzuVaE8AkAFmxZzow3x+VJYKdjykkJ0iT9wCS0DRTXu269V264Vf/3jvredZiKRkgwlL9xNAwxXFg0x/XFw005UWVRIkdgcKWTjpBP2dPwVZ4WWC+9aGVd+Gyn1o0CLelf4rEjGoXbAAEgAqeGUxrcIlbjXfbcmwIDAQAB'

describe('ready.json writer preservation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-writer-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = () => makeProjectWriter(tmp)

  it('preserves launcher-stamped browserExitedAt/browserExitCode across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyBrowserExited(writer.readyPath, {
      browserExitedAt: '2026-07-12T00:00:00.000Z',
      browserExitCode: 21,
      browserExitSignal: 'SIGTRAP'
    })

    stampReadyCdpPort(writer.readyPath, 9223)

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('ready')
    expect(after.browserExitedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(after.browserExitCode).toBe(21)
    expect(after.browserExitSignal).toBe('SIGTRAP')
    expect(after.cdpPort).toBe(9223)
  })

  it('keeps a browser gone before anything loaded as an error across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyBrowserExited(writer.readyPath, {
      status: 'error',
      code: 'browser_exited',
      message:
        'the chromium process exited (code 0) before the extension loaded, nothing is running',
      browserExitedAt: '2026-07-12T00:00:00.000Z',
      browserExitCode: 0,
      browserExitSignal: null
    })

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('error')
    expect(after.code).toBe('browser_exited')
    expect(after.message).toMatch(/before the extension loaded/)
    expect(after.browserExitedAt).toBe('2026-07-12T00:00:00.000Z')
  })

  it('keeps a browser that never spawned as an error across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyBrowserLaunchFailed(writer.readyPath, {
      status: 'error',
      code: 'browser_launch_failed',
      message:
        'the chromium process could not start (spawn /x/chrome EACCES), nothing is running',
      browserLaunchFailedAt: '2026-07-12T00:00:00.000Z',
      browserLaunchFailedReason: 'spawn /x/chrome EACCES'
    })

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('error')
    expect(after.code).toBe('browser_launch_failed')
    expect(after.message).toMatch(/could not start/)
    expect(after.browserLaunchFailedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(after.browserLaunchFailedReason).toBe('spawn /x/chrome EACCES')
  })

  it('preserves the launcher-stamped rdpPort across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyRdpPort(writer.readyPath, 9224)

    writer.writeReady()

    expect(readContract(writer.readyPath).rdpPort).toBe(9224)
  })

  it('preserves the launcher-stamped CDP fault across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyCdpFault(
      writer.readyPath,
      'E_CDP_TIMEOUT',
      'ensureLoaded timeout (10000ms)'
    )

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('ready')
    expect(after.cdpFaultCode).toBe('E_CDP_TIMEOUT')
    expect(after.cdpFaultMessage).toBe('ensureLoaded timeout (10000ms)')
  })

  it('preserves the launcher-stamped WebDriver session across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyWebDriver(writer.readyPath, {
      webdriverPort: 61234,
      webdriverSessionId: 'E3A9-webdriver-writer'
    })

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.webdriverPort).toBe(61234)
    expect(after.webdriverSessionId).toBe('E3A9-webdriver-writer')
  })

  it('preserves the launcher-stamped WebDriver refusal across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyWebDriver(writer.readyPath, {
      webdriverUnavailableReason: 'Allow Remote Automation is off'
    })

    writer.writeReady()

    expect(readContract(writer.readyPath).webdriverUnavailableReason).toBe(
      'Allow Remote Automation is off'
    )
  })

  it('preserves the launcher-stamped profilePath and browserPid across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    const profilePath = path.join(
      tmp,
      'dist',
      'extension-js',
      'profiles',
      'chromium-profile',
      'brave-Crimson-panda'
    )
    stampReadyBrowserLaunch(writer.readyPath, {profilePath, browserPid: 4242})

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.profilePath).toBe(profilePath)
    expect(after.browserPid).toBe(4242)
  })

  it('stamps when its own process started beside pid', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.pid).toBe(process.pid)
    expect(ready.pidStartedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )

    expect(
      Math.abs(
        Date.parse(String(ready.pidStartedAt)) -
          (Date.now() - process.uptime() * 1000)
      )
    ).toBeLessThan(5000)
  })

  it('preserves the launcher-stamped process start times across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyBrowserLaunch(writer.readyPath, {
      browserPid: 4242,
      browserStartedAt: '2026-07-12T00:00:01.000Z',
      launcherPid: 4241,
      launcherStartedAt: '2026-07-12T00:00:00.000Z'
    })

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.browserPid).toBe(4242)
    expect(after.browserStartedAt).toBe('2026-07-12T00:00:01.000Z')
    expect(after.launcherPid).toBe(4241)
    expect(after.launcherStartedAt).toBe('2026-07-12T00:00:00.000Z')
  })

  it('ready.json runId equals getSessionRunId for the same session', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.runId).toBe(getSessionRunId(tmp, 'chromium'))
    // A different browser is a different session identity.
    expect(getSessionRunId(tmp, 'firefox')).not.toBe(ready.runId)
  })

  it('gives the next session in the same process a run id of its own', () => {
    const first = getSessionRunId(tmp, 'chromium')
    const other = getSessionRunId(tmp, 'firefox')

    // Asked again while the session lives, it is the same run.
    expect(getSessionRunId(tmp, 'chromium')).toBe(first)

    forgetSessionRun(tmp, 'chromium')

    const second = getSessionRunId(tmp, 'chromium')
    expect(second).not.toBe(first)
    expect(getSessionRunId(tmp, 'chromium')).toBe(second)
    // Another browser of the same project is another session, left alone.
    expect(getSessionRunId(tmp, 'firefox')).toBe(other)

    const writer = makeWriter()
    writer.writeReady()
    expect(readContract(writer.readyPath).runId).toBe(second)
  })

  it('does not invent the fields when the launcher never stamped them', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect('browserExitedAt' in after).toBe(false)
    expect('browserExitCode' in after).toBe(false)
    expect('profilePath' in after).toBe(false)
    expect('browserPid' in after).toBe(false)
    expect('browserStartedAt' in after).toBe(false)
    expect('extensionId' in after).toBe(false)
  })

  it('derives the extension id from the emitted dist once it exists', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')
    writeManifest(distPath, {name: 'Fixture', version: '1.0.0'})

    const writer = makeWriter()
    writer.writeReady()

    expect(readContract(writer.readyPath).extensionId).toBe(
      chromiumExtensionId(distPath)
    )
  })

  it('derives the declared gecko id for a firefox session', () => {
    writeManifest(path.join(tmp, 'dist', 'firefox'), {
      name: 'Fixture',
      version: '1.0.0',
      browser_specific_settings: {gecko: {id: 'fixture@extension.js'}}
    })

    const writer = makeProjectWriter(tmp, {browser: 'firefox'})
    writer.writeReady()

    expect(readContract(writer.readyPath).extensionId).toBe(
      'fixture@extension.js'
    )
  })

  // Safari has no dist-derivable id (identity is the appex bundle id the
  // packager assigns), so ready.json must not carry a chromium hash for it.
  it('never derives a chromium id for a safari session', () => {
    writeManifest(path.join(tmp, 'dist', 'safari'), {
      name: 'Fixture',
      version: '1.0.0'
    })

    const writer = makeProjectWriter(tmp, {
      browser: 'safari',
      command: 'build'
    })
    writer.writeReady()

    expect('extensionId' in readContract(writer.readyPath)).toBe(false)
  })

  it('backfills a packager-known extension id for safari, first stamp wins', () => {
    const writer = makeProjectWriter(tmp, {
      browser: 'safari',
      command: 'build'
    })
    writer.writeReady()

    stampReadyKnownExtensionId(
      tmp,
      'safari',
      'dev.extensionjs.Fixture.Extension'
    )

    expect(readContract(writer.readyPath).extensionId).toBe(
      'dev.extensionjs.Fixture.Extension'
    )

    stampReadyKnownExtensionId(tmp, 'safari', 'com.example.other.Extension')
    expect(readContract(writer.readyPath).extensionId).toBe(
      'dev.extensionjs.Fixture.Extension'
    )
  })

  it('keeps a launcher-confirmed extension id over the derived one across recompiles', () => {
    writeManifest(path.join(tmp, 'dist', 'chromium'), {
      name: 'Fixture',
      version: '1.0.0'
    })

    const writer = makeWriter()
    writer.writeReady()

    stampReadyExtensionId(writer.readyPath, 'glocgelajdejkheibpdooiagpkkbfmhe')

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.extensionId).toBe('glocgelajdejkheibpdooiagpkkbfmhe')
    expect(after.extensionIdSource).toBe('browser')
  })

  it('recomputes a derived id when the manifest key changes mid-session', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')

    const writeDist = (manifest: Record<string, unknown>) =>
      writeManifest(distPath, {name: 'Fixture', version: '1.0.0', ...manifest})

    writeDist({})
    const writer = makeWriter()
    writer.writeReady()
    const pathHashed = readContract(writer.readyPath)
    expect(pathHashed.extensionIdSource).toBe('derived')

    writeDist({key: KEY})
    writer.writeReady()
    const keyed = readContract(writer.readyPath)
    expect(keyed.extensionId).toBe(chromiumExtensionId(distPath))
    expect(keyed.extensionId).not.toBe(pathHashed.extensionId)
    expect(keyed.extensionIdSource).toBe('derived')

    writeDist({})
    writer.writeReady()
    expect(readContract(writer.readyPath).extensionId).toBe(
      pathHashed.extensionId
    )
  })

  it('corrects the id a one-shot build read off the previous dist', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')
    writeManifest(distPath, {name: 'Fixture', version: '1.0.0'})

    const writer = makeProjectWriter(tmp, {command: 'build'})
    writer.writeReady()
    const stale = readContract(writer.readyPath)

    writeManifest(distPath, {name: 'Fixture', version: '1.0.0', key: KEY})

    stampReadyDistExtensionId(tmp, 'chromium', distPath)

    const after = readContract(writer.readyPath)
    expect(after.extensionId).toBe(chromiumExtensionId(distPath))
    expect(after.extensionId).not.toBe(stale.extensionId)
  })

  it('never lets a derivation replace a browser-confirmed id', () => {
    const distPath = path.join(tmp, 'dist', 'chromium')
    writeManifest(distPath, {name: 'Fixture', version: '1.0.0'})

    const writer = makeWriter()
    writer.writeReady()

    stampReadyExtensionId(writer.readyPath, 'glocgelajdejkheibpdooiagpkkbfmhe')

    stampReadyDistExtensionId(tmp, 'chromium', distPath)

    expect(readContract(writer.readyPath).extensionId).toBe(
      'glocgelajdejkheibpdooiagpkkbfmhe'
    )
  })

  it('stamps runtime:"attached"/executorAttachedAt once and preserves it across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    writer.stampExecutorAttached()
    const stamped = readContract(writer.readyPath)
    expect(stamped.runtime).toBe('attached')
    expect(typeof stamped.executorAttachedAt).toBe('string')
    const firstStamp = stamped.executorAttachedAt

    writer.writeReady()
    const afterCompile = readContract(writer.readyPath)
    expect(afterCompile.runtime).toBe('attached')
    expect(afterCompile.executorAttachedAt).toBe(firstStamp)

    writer.stampExecutorAttached()
    expect(readContract(writer.readyPath).executorAttachedAt).toBe(firstStamp)
  })

  it('stamps the Safari extension base from the producer origin and keeps it across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    writer.stampExecutorAttached({origin: 'http://127.0.0.1:3000'})
    expect('extensionBaseUrl' in readContract(writer.readyPath)).toBe(false)

    writer.stampExecutorAttached({
      origin: 'safari-web-extension://3F2A9C10-1B2C-4D5E-8F90-ABCDEF012345'
    })

    writer.writeReady()

    expect(readContract(writer.readyPath).extensionBaseUrl).toBe(
      'safari-web-extension://3F2A9C10-1B2C-4D5E-8F90-ABCDEF012345/'
    )
  })

  it('an attach clears the browser-up-not-attached note, a recompile keeps it', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyBrowserUpNotAttached(writer.readyPath, {
      browserUpNotAttachedAt: '2026-10-23T00:00:00.000Z',
      browserUpNotAttachedWaitMs: 15000,
      browserUpNotAttachedHint: 'Chrome is up, but nothing connected'
    })

    writer.writeReady()
    const afterCompile = readContract(writer.readyPath)
    expect(afterCompile.browserUpNotAttachedAt).toBe('2026-10-23T00:00:00.000Z')
    expect(afterCompile.browserUpNotAttachedWaitMs).toBe(15000)
    expect(afterCompile.browserUpNotAttachedHint).toBe(
      'Chrome is up, but nothing connected'
    )

    writer.stampExecutorAttached()
    const attached = readContract(writer.readyPath)
    expect(attached.runtime).toBe('attached')
    expect('browserUpNotAttachedAt' in attached).toBe(false)
    expect('browserUpNotAttachedWaitMs' in attached).toBe(false)
    expect('browserUpNotAttachedHint' in attached).toBe(false)

    writer.writeReady()
    expect('browserUpNotAttachedAt' in readContract(writer.readyPath)).toBe(
      false
    )
  })

  it('does not invent the runtime signal before the SW attaches', () => {
    const writer = makeWriter()
    writer.writeReady()
    const after = readContract(writer.readyPath)
    expect('runtime' in after).toBe(false)
    expect('executorAttachedAt' in after).toBe(false)
  })

  it('writeShutdown flips status to stopped, keeping session provenance', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyCdpPort(writer.readyPath, 9223)
    const ready = readContract(writer.readyPath)

    writer.writeShutdown()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('stopped')
    expect(after.code).toBe('shutdown')
    expect(after.cdpPort).toBe(9223)
    expect(after.runId).toBe(ready.runId)
  })

  it('stampExecutorDetached flips runtime off once the producer leaves', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.stampExecutorAttached()

    const attached = readContract(writer.readyPath)
    expect(attached.runtime).toBe('attached')
    expect(typeof attached.executorAttachedAt).toBe('string')

    writer.stampExecutorDetached()

    const after = readContract(writer.readyPath)
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

    const after = readContract(writer.readyPath)
    expect(after.runtime).toBe('detached')
    expect(typeof after.executorDetachedAt).toBe('string')
  })

  it('a reconnect clears the detached mark', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.stampExecutorAttached()
    writer.stampExecutorDetached()

    writer.stampExecutorAttached()

    const after = readContract(writer.readyPath)
    expect(after.runtime).toBe('attached')
    expect('executorDetachedAt' in after).toBe(false)
  })

  it('stampExecutorDetached is a no-op when nothing ever attached', () => {
    const writer = makeWriter()
    writer.writeReady()

    writer.stampExecutorDetached()

    const after = readContract(writer.readyPath)
    expect('runtime' in after).toBe(false)
    expect('executorDetachedAt' in after).toBe(false)
  })

  it('writeShutdown records the ending the caller names', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.writeShutdown('the preview session ended')

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('stopped')
    expect(after.message).toBe('the preview session ended')
  })

  it('writeEndedAsFailed turns a ready contract into error that a shutdown keeps', () => {
    const writer = makeWriter()
    writer.writeReady()

    writer.writeEndedAsFailed('E_PARENT_GONE', 'the host ended the session')

    const ended = readContract(writer.readyPath)
    expect(ended.status).toBe('error')
    expect(ended.code).toBe('shutdown')
    expect(ended.message).toBe('the host ended the session')
    expect(ended.endedAsFailedCode).toBe('E_PARENT_GONE')
    expect(typeof ended.endedAsFailedAt).toBe('string')

    writer.writeShutdown()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('error')
    expect(after.code).toBe('shutdown')
    expect(after.endedAsFailedCode).toBe('E_PARENT_GONE')
  })

  it('writeEndedAsFailed keeps the launch failure a contract already names', () => {
    const writer = makeWriter()
    writer.writeReady()

    patchContract(writer.readyPath, {
      status: 'error',
      code: 'browser_launch_failed',
      message: 'the browser binary was not found',
      browserLaunchFailedCode: 'E_BROWSER_BINARY_INVALID'
    })

    const failed = readContract(writer.readyPath)

    writer.writeEndedAsFailed('E_BROWSER_BINARY_INVALID', 'another message')

    const {endedAsFailedAt, endedAsFailedCode, ts, ...rest} = readContract(
      writer.readyPath
    )
    const {ts: _failedTs, ...before} = failed

    expect(rest).toEqual(before)
    expect(endedAsFailedCode).toBe('E_BROWSER_BINARY_INVALID')
    expect(typeof endedAsFailedAt).toBe('string')
    expect(typeof ts).toBe('string')
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

    const after = readContract(next.readyPath)
    expect(after.status).toBe('starting')
    expect(after.code).toBeUndefined()

    next.writeShutdown()
    expect(readContract(next.readyPath).status).toBe('stopped')
  })

  it('writeStarting from the same run keeps startedAt', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.writeReady()
    const first = readContract(writer.readyPath)

    const next = makeWriter()
    next.writeStarting()

    const after = readContract(next.readyPath)
    expect(after.status).toBe('starting')
    expect(after.startedAt).toBe(first.startedAt)
  })

  it('writeShutdown and stampExecutorDetached refuse another run on disk', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.stampExecutorAttached()

    patchContract(writer.readyPath, {runId: 'another-run'})

    writer.writeShutdown()
    writer.stampExecutorDetached()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('ready')
    expect(after.runtime).toBe('attached')
    expect('executorDetachedAt' in after).toBe(false)
  })

  it.runIf(process.platform === 'linux')(
    'a build writer replaces a dev contract whose pid another process holds',
    () => {
      const devWriter = makeWriter()
      devWriter.writeReady()

      // The pid is alive and is not the process that wrote the start name.
      patchContract(devWriter.readyPath, {pid: process.ppid})
      expect(readContract(devWriter.readyPath).pidStartId).toBe(
        processStartId(process.pid)
      )

      const buildWriter = makeProjectWriter(tmp, {command: 'build'})
      buildWriter.writeStarting()

      expect(readContract(devWriter.readyPath).command).toBe('build')
    }
  )

  it('a build writer never rewrites a LIVE dev session contract', () => {
    const devWriter = makeWriter()
    devWriter.writeReady()
    // Another live process, stamped with when it really started and, where
    // the system names a start, with the name that process would have written.
    const parentStartedAt = processStartedAtMs(process.ppid)
    patchContract(devWriter.readyPath, {
      pid: process.ppid,
      pidStartId: processStartId(process.ppid),
      pidStartedAt:
        parentStartedAt == null
          ? undefined
          : new Date(parentStartedAt).toISOString()
    })

    const ready = readContract(devWriter.readyPath)

    const buildWriter = makeProjectWriter(tmp, {command: 'build'})
    buildWriter.writeStarting()
    buildWriter.writeReady()
    buildWriter.appendEvent({
      type: 'compile_success',
      ts: new Date().toISOString(),
      command: 'build',
      browser: 'chromium'
    })

    const after = readContract(devWriter.readyPath)
    expect(after.command).toBe('dev')
    expect(after.pid).toBe(process.ppid)
    expect(after.runId).toBe(ready.runId)
    expect(fs.existsSync(devWriter.eventsPath)).toBe(false)
  })

  it('a build writer takes over a DEAD dev session contract normally', () => {
    const devWriter = makeWriter()
    devWriter.writeReady()
    patchContract(devWriter.readyPath, {pid: 99999999})

    const buildWriter = makeProjectWriter(tmp, {command: 'build'})
    buildWriter.writeStarting()

    const after = readContract(devWriter.readyPath)
    expect(after.command).toBe('build')
    expect(after.pid).toBe(process.pid)
  })

  // The browser refused the guest. A later compile succeeding says nothing
  // about that, so the contract must not drift back to green underneath it.
  it('keeps a browser load refusal red across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyExtensionLoadRefused(writer.readyPath, {
      status: 'error',
      code: 'extension_load_refused',
      message: 'Chrome refused to load the extension at /dist/chrome',
      extensionLoadRefusedAt: '2026-07-24T00:00:00.000Z',
      extensionLoadRefusedReason: 'Variable $2$ used but not defined.',
      extensionLoadRefusedCause: 'the cause the manifest shows'
    })

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('error')
    expect(after.code).toBe('extension_load_refused')
    expect(after.extensionLoadRefusedReason).toBe(
      'Variable $2$ used but not defined.'
    )

    expect(after.extensionLoadRefusedCause).toBe('the cause the manifest shows')
    expect(after.message).toContain('refused to load')
  })

  // The id read off the dist is a forecast of what the browser would assign.
  it('publishes no derived id for an extension the browser refused', () => {
    writeManifest(path.join(tmp, 'dist', 'chromium'), {
      manifest_version: 3,
      name: 'x',
      version: '1'
    })

    const writer = makeWriter()
    writer.writeReady()

    expect(readContract(writer.readyPath).extensionIdSource).toBe('derived')

    stampReadyExtensionLoadRefused(writer.readyPath, {
      status: 'error',
      code: 'extension_load_refused',
      extensionLoadRefusedAt: '2026-07-24T00:00:00.000Z'
    })

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.extensionId).toBeUndefined()
    expect(after.extensionIdSource).toBeUndefined()
  })

  it('keeps the refusal, its reason and its cause on a stopped contract', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyExtensionLoadRefused(writer.readyPath, {
      extensionLoadRefusedAt: '2026-07-24T00:00:00.000Z',
      extensionLoadRefusedReason: 'TypeError',
      extensionLoadRefusedCause: 'the cause the manifest shows'
    })

    writer.writeShutdown()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('stopped')
    expect(after.extensionLoadRefusedReason).toBe('TypeError')
    expect(after.extensionLoadRefusedCause).toBe('the cause the manifest shows')
  })

  it('preserves compiledAt when a later writer in the same run omits it', () => {
    const writer = makeWriter()
    writer.writeReady('2026-08-15T12:00:00.000Z')
    const first = readContract(writer.readyPath)

    const next = makeWriter()
    next.writeReady()

    const after = readContract(next.readyPath)
    expect(after.compiledAt).toBe('2026-08-15T12:00:00.000Z')
    expect(after.startedAt).toBe(first.startedAt)
  })

  // A new run re-asks the browser, so last run's verdict must not outlive it.
  it('drops the refusal when a new run starts', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyExtensionLoadRefused(writer.readyPath, {
      extensionLoadRefusedAt: '2026-07-24T00:00:00.000Z',
      extensionLoadRefusedReason: 'stale reason'
    })

    const nextRun = makeWriter()
    nextRun.writeStarting()
    nextRun.writeReady()

    const after = readContract(nextRun.readyPath)
    expect(after.status).toBe('ready')
    expect(after.code).toBeUndefined()
    expect(after.extensionLoadRefusedAt).toBeUndefined()
  })

  // The executor runs inside the guest, so an attach proves the browser
  // is running it - whoever repaired the load, the red verdict is now stale.
  it('clears a load refusal when the executor attaches', () => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyExtensionLoadRefused(writer.readyPath, {
      status: 'error',
      code: 'extension_load_refused',
      message: 'Chrome refused to load the extension at /dist/chromium',
      extensionLoadRefusedAt: '2026-07-24T00:00:00.000Z',
      extensionLoadRefusedReason: 'Variable $2$ used but not defined.'
    })

    writer.stampExecutorAttached()

    const after = readContract(writer.readyPath)
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

    stampReadyExtensionLoadRefused(writer.readyPath, {
      status: 'error',
      code: 'extension_load_refused',
      extensionLoadRefusedAt: '2026-07-24T00:00:00.000Z'
    })

    writer.stampExecutorAttached()
    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('ready')
    expect(after.code).toBeUndefined()
    expect(after.extensionLoadRefusedAt).toBeUndefined()
  })

  // An attach says nothing about an unrelated failure, so only the refusal
  // verdict may be cleared.
  it('leaves a non-refusal error status alone', () => {
    const writer = makeWriter()
    writer.writeReady()

    patchContract(writer.readyPath, {
      status: 'error',
      code: 'compile_failed',
      message: 'build broke'
    })

    writer.stampExecutorAttached()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('error')
    expect(after.code).toBe('compile_failed')
    expect(after.message).toBe('build broke')
  })
})

describe('the reload stamp', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-stamp-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it("stamps reloadedAt, reloadKind and reloadLabel on the run's own contract", () => {
    const writer = makeProjectWriter(tmp)
    writer.writeReady('2026-11-01T00:00:00.000Z')
    const before = readContract(writer.readyPath)

    writer.stampReload('background', 'background (service_worker.ts)')

    const after = readContract(writer.readyPath)
    expect(after.reloadKind).toBe('background')
    expect(after.reloadLabel).toBe('background (service_worker.ts)')
    expect(Date.parse(String(after.reloadedAt))).toBeGreaterThanOrEqual(
      Date.parse('2026-11-01T00:00:00.000Z')
    )

    expect(after.status).toBe(before.status)
    expect(after.compiledAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('drops the earlier label when a reload carries none', () => {
    const writer = makeProjectWriter(tmp)
    writer.writeReady()
    writer.stampReload('content', 'content_script (a.ts)')

    writer.stampReload('full')

    const after = readContract(writer.readyPath)
    expect(after.reloadKind).toBe('full')
    expect('reloadLabel' in after).toBe(false)
  })

  it('keeps the stamp through a recompile of the same run', () => {
    const writer = makeProjectWriter(tmp)
    writer.writeReady()
    writer.stampReload('page', 'page (options.html)')
    const stamped = readContract(writer.readyPath)

    writer.writeReady()

    const after = readContract(writer.readyPath)
    expect(after.reloadedAt).toBe(stamped.reloadedAt)
    expect(after.reloadKind).toBe('page')
    expect(after.reloadLabel).toBe('page (options.html)')
  })

  it('refuses another run on disk', () => {
    const writer = makeProjectWriter(tmp)
    writer.writeReady()
    patchContract(writer.readyPath, {runId: 'another-run'})
    const before = fs.readFileSync(writer.readyPath, 'utf-8')

    writer.stampReload('full', 'full reload')

    expect(fs.readFileSync(writer.readyPath, 'utf-8')).toBe(before)
  })

  it('is a no-op when no contract was ever written', () => {
    const writer = makeProjectWriter(tmp)

    writer.stampReload('full')

    expect(fs.existsSync(writer.readyPath)).toBe(false)
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

  it('reads name and version from the dist, not the edited source', () => {
    writeManifest(path.join(tmp, 'dist', 'chromium'), {
      manifest_version: 3,
      name: 'Built Name',
      version: '1.0.0'
    })

    writeManifest(path.join(tmp, 'src'), {
      manifest_version: 3,
      name: 'Edited Name',
      version: '9.9.9'
    })

    const writer = makeProjectWriter(tmp, {command: 'preview'})
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.extensionName).toBe('Built Name')
    expect(ready.extensionVersion).toBe('1.0.0')
  })

  it('falls back to the source manifest when the dist has none', () => {
    fs.mkdirSync(path.join(tmp, 'dist', 'chromium'), {recursive: true})
    writeManifest(path.join(tmp, 'src'), {
      manifest_version: 3,
      name: 'Source Only',
      version: '2.0.0'
    })

    const writer = makeProjectWriter(tmp, {command: 'preview'})
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.extensionName).toBe('Source Only')
    expect(ready.extensionVersion).toBe('2.0.0')
  })
})
