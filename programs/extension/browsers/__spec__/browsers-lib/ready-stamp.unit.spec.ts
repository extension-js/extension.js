import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  claimReadyPath,
  clearReadyCdpPort,
  describeLaunchFailure,
  earlierManagedProfileBaseDir,
  launchFailureCode,
  managedProfileBaseDir,
  readReadyExecutorAttached,
  readReadyRunId,
  readyPathFor,
  stampReadyBrowserExited,
  stampReadyBrowserLaunch,
  stampReadyBrowserLaunchFailed,
  stampReadyBrowserUpNotAttached,
  stampReadyCdpFault,
  stampReadyCdpPort,
  stampReadyDevBrowserFlag,
  stampReadyExtensionBaseUrl,
  stampReadyExtensionId,
  stampReadyExtensionLoadRefused,
  stampReadyProfileLocked,
  stampReadyRdpPort,
  stampReadyRdpPortError
} from '../../browsers-lib/ready-stamp'
import {readyContractPath} from '../../../../develop/lib/session-contract'
import {isFreshContractPayload} from '../../../commands/dev-wait'
import {CDPClient} from '../../run-chromium/cdp/cdp-client'

// Every stamp time is written with toISOString.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('stampReadyRdpPort', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-'))
    outputPath = path.join(tmp, 'dist', 'firefox')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'firefox', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('publishes the RDP debugger-server port into ready.json', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', browser: 'firefox', runId: 'run-A'})
    )

    stampReadyRdpPort(outputPath, 6006)

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.rdpPort).toBe(6006)
    expect(ready.status).toBe('ready')
    expect(ready.runId).toBe('run-A')
  })

  it('turns a held dev compile ready, unless it still waits for the hello', () => {
    const held = {
      command: 'dev',
      status: 'starting',
      compiledAt: '2026-11-01T00:00:00.000Z'
    }

    fs.writeFileSync(readyPath, JSON.stringify(held))
    stampReadyRdpPort(outputPath, 6006)
    expect(JSON.parse(fs.readFileSync(readyPath, 'utf-8')).status).toBe('ready')

    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        ...held,
        awaitingExecutorSince: '2026-11-01T00:00:00.000Z'
      })
    )

    stampReadyRdpPort(outputPath, 6006)

    const waiting = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(waiting.status).toBe('starting')
    expect(waiting.rdpPort).toBe(6006)
  })

  it('turns a held dev compile ready on the reason Firefox opened no port', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'starting',
        compiledAt: '2026-11-01T00:00:00.000Z',
        rdpPort: 6006
      })
    )

    stampReadyRdpPortError(outputPath, 'the port never opened')

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('ready')
    expect(ready.rdpPortError).toBe('the port never opened')
    expect(ready.rdpPort).toBeUndefined()
  })

  it('leaves a held compile at starting while a code stands on the record', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'starting',
        compiledAt: '2026-11-01T00:00:00.000Z',
        code: 'profile_locked'
      })
    )

    stampReadyRdpPort(outputPath, 6006)

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('starting')
    expect(ready.rdpPort).toBe(6006)
  })

  it('keeps the port of a superseded run off the run that replaced it', () => {
    const held = {
      command: 'dev',
      status: 'starting',
      compiledAt: '2026-11-01T00:00:00.000Z',
      runId: 'run-B'
    }

    fs.writeFileSync(readyPath, JSON.stringify(held))
    stampReadyRdpPort(outputPath, 6006, 'run-A')

    expect(JSON.parse(fs.readFileSync(readyPath, 'utf-8'))).toEqual(held)
  })

  it('never replaces the port the new run stamped with an older one', () => {
    const owned = {
      command: 'dev',
      status: 'ready',
      compiledAt: '2026-11-01T00:00:00.000Z',
      runId: 'run-B',
      rdpPort: 6007
    }

    fs.writeFileSync(readyPath, JSON.stringify(owned))
    stampReadyRdpPort(outputPath, 6006, 'run-A')

    expect(JSON.parse(fs.readFileSync(readyPath, 'utf-8'))).toEqual(owned)
  })

  it('stamps and releases the contract of the run it belongs to', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'starting',
        compiledAt: '2026-11-01T00:00:00.000Z',
        runId: 'run-A'
      })
    )

    stampReadyRdpPort(outputPath, 6006, 'run-A')

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.rdpPort).toBe(6006)
    expect(ready.status).toBe('ready')
    expect(ready.runId).toBe('run-A')
  })

  it('stamps a contract that names no run, and one for a caller that names none', () => {
    const held = {
      command: 'dev',
      status: 'starting',
      compiledAt: '2026-11-01T00:00:00.000Z'
    }

    fs.writeFileSync(readyPath, JSON.stringify(held))
    stampReadyRdpPort(outputPath, 6006, 'run-A')

    const unnamed = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(unnamed.rdpPort).toBe(6006)
    expect(unnamed.status).toBe('ready')

    fs.writeFileSync(readyPath, JSON.stringify({...held, runId: 'run-B'}))
    stampReadyRdpPort(outputPath, 6006)

    const anonymous = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(anonymous.rdpPort).toBe(6006)
    expect(anonymous.status).toBe('ready')
  })

  it('is a no-op when the contract file does not exist yet', () => {
    expect(() => stampReadyRdpPort(outputPath, 6006)).not.toThrow()
    expect(fs.existsSync(readyPath)).toBe(false)
  })

  it('is a no-op for a missing output path or non-finite port', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
    stampReadyRdpPort(undefined, 6006)
    stampReadyRdpPort(outputPath, Number.NaN)
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect('rdpPort' in ready).toBe(false)
  })
})

describe('stampReadyBrowserLaunch', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-launch-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('publishes the resolved profile path and browser pid into ready.json', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', browser: 'chrome', runId: 'run-A'})
    )

    const profilePath = path.join(
      tmp,
      'dist',
      'extension-js',
      'profiles',
      'chrome-profile',
      'brave-Crimson-panda'
    )

    stampReadyBrowserLaunch(outputPath, {profilePath, browserPid: 4242})

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.profilePath).toBe(profilePath)
    expect(ready.browserPid).toBe(4242)
    expect(ready.status).toBe('ready')
    expect(ready.runId).toBe('run-A')
  })

  it('stamps the pid alone when no managed profile path exists', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))

    stampReadyBrowserLaunch(outputPath, {profilePath: '', browserPid: 4242})

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect('profilePath' in ready).toBe(false)
    expect(ready.browserPid).toBe(4242)
  })

  it('publishes when the browser and launcher processes started beside their pids', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))

    // This process is in the table. 2 ** 30 is larger than any pid the OS
    // hands out, so the table has no row for it and no start time to give.
    stampReadyBrowserLaunch(outputPath, {
      browserPid: process.pid,
      launcherPid: 2 ** 30
    })

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.browserPid).toBe(process.pid)
    expect(ready.browserStartedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )

    expect(
      Math.abs(
        Date.parse(ready.browserStartedAt) -
          (Date.now() - process.uptime() * 1000)
      )
    ).toBeLessThan(5000)

    expect(ready.launcherPid).toBe(2 ** 30)
    expect('launcherStartedAt' in ready).toBe(false)
  })

  it('reads a start time once per pid and drops it with the pid it dated', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        browserPid: process.pid,
        browserStartedAt: '2026-01-01T00:00:00.000Z'
      })
    )

    stampReadyBrowserLaunch(outputPath, {browserPid: process.pid})
    const same = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(same.browserStartedAt).toBe('2026-01-01T00:00:00.000Z')

    stampReadyBrowserLaunch(outputPath, {browserPid: 2 ** 30})
    const next = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(next.browserPid).toBe(2 ** 30)
    expect('browserStartedAt' in next).toBe(false)
  })

  it('is a no-op when the contract file does not exist yet', () => {
    expect(() =>
      stampReadyBrowserLaunch(outputPath, {profilePath: '/x', browserPid: 1})
    ).not.toThrow()

    expect(fs.existsSync(readyPath)).toBe(false)
  })

  it('ignores a missing output path and a non-finite pid', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
    stampReadyBrowserLaunch(undefined, {profilePath: '/x', browserPid: 1})
    stampReadyBrowserLaunch(outputPath, {browserPid: Number.NaN})
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect('profilePath' in ready).toBe(false)
    expect('browserPid' in ready).toBe(false)
  })

  it('publishes the resolved extension id next to the pid', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))

    stampReadyBrowserLaunch(outputPath, {
      browserPid: 4242,
      extensionId: 'glocgelajdejkheibpdooiagpkkbfmhe'
    })

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.extensionId).toBe('glocgelajdejkheibpdooiagpkkbfmhe')
    expect(ready.extensionIdSource).toBe('derived')
    expect(ready.browserPid).toBe(4242)
  })

  it('leaves a browser-confirmed id alone at launch', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        extensionIdSource: 'browser'
      })
    )

    stampReadyBrowserLaunch(outputPath, {
      browserPid: 4242,
      extensionId: 'glocgelajdejkheibpdooiagpkkbfmhe'
    })

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.extensionId).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(ready.extensionIdSource).toBe('browser')
  })

  it('omits the extension id when none resolved at launch', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))

    stampReadyBrowserLaunch(outputPath, {browserPid: 4242, extensionId: ''})

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect('extensionId' in ready).toBe(false)
  })
})

describe('stampReadyExtensionId', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-id-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('publishes the extension id into ready.json', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', browser: 'chrome', runId: 'run-A'})
    )

    stampReadyExtensionId(outputPath, 'glocgelajdejkheibpdooiagpkkbfmhe')

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.extensionId).toBe('glocgelajdejkheibpdooiagpkkbfmhe')
    expect(ready.status).toBe('ready')
    expect(ready.runId).toBe('run-A')
  })

  it('replaces a derived id when the browser confirms a different one', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      })
    )

    stampReadyExtensionId(outputPath, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.extensionId).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(ready.extensionIdSource).toBe('browser')
  })

  it('marks a matching derived id as browser-confirmed', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        extensionIdSource: 'derived'
      })
    )

    stampReadyExtensionId(outputPath, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.extensionIdSource).toBe('browser')
  })

  it('keeps the id a superseded run confirmed off the run that replaced it', () => {
    const owned = {
      status: 'ready',
      runId: 'run-B',
      extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      extensionIdSource: 'derived'
    }

    fs.writeFileSync(readyPath, JSON.stringify(owned))
    stampReadyExtensionId(
      outputPath,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'run-A'
    )

    expect(JSON.parse(fs.readFileSync(readyPath, 'utf-8'))).toEqual(owned)

    stampReadyExtensionId(
      outputPath,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'run-B'
    )

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.extensionId).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(ready.extensionIdSource).toBe('browser')
  })

  it('is a no-op for an empty id, missing path, or missing contract', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
    stampReadyExtensionId(outputPath, '')
    stampReadyExtensionId(outputPath, undefined)
    stampReadyExtensionId(undefined, 'cccccccccccccccccccccccccccccccc')
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect('extensionId' in ready).toBe(false)
    expect(() =>
      stampReadyExtensionId(
        path.join(tmp, 'dist', 'edge'),
        'cccccccccccccccccccccccccccccccc'
      )
    ).not.toThrow()
  })
})

describe('stampReadyBrowserLaunchFailed', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-launch-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        command: 'dev',
        browser: 'chrome',
        runId: 'run-A'
      })
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const readReady = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

  it('flips a dev session to an error that names the reason', () => {
    stampReadyBrowserLaunchFailed(outputPath, 'spawn /x/chrome EACCES', 'run-A')

    const ready = readReady()
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('browser_launch_failed')
    expect(ready.message).toBe(
      'the chrome process could not start (spawn /x/chrome EACCES), nothing is running'
    )

    expect(ready.browserLaunchFailedAt).toMatch(ISO_INSTANT)
    expect(ready.browserLaunchFailedReason).toBe('spawn /x/chrome EACCES')
  })

  it('carries the code a CDP refusal was thrown with', async () => {
    const error = await new CDPClient(9222)
      .sendCommand('Target.getTargets')
      .then(
        () => null,
        (reason: unknown) => reason
      )

    stampReadyBrowserLaunchFailed(
      outputPath,
      describeLaunchFailure(error),
      'run-A',
      launchFailureCode(error)
    )

    const ready = readReady()
    expect(ready.code).toBe('browser_launch_failed')
    expect(ready.browserLaunchFailedReason).toBe('CDP transport is not open')
    expect(ready.browserLaunchFailedCode).toBe('E_CDP_NOT_CONNECTED')
  })

  // A run-only session loading a source folder: the loaded directory is the
  // project root, and no contract lives at the path derived from it.
  it('stamps the contract the session claimed when the loaded directory cannot name it', () => {
    const sourceRoot = path.join(tmp, 'project')
    fs.mkdirSync(sourceRoot, {recursive: true})

    stampReadyBrowserLaunchFailed(sourceRoot, 'spawn /x/chrome EACCES')
    expect(readReady().status).toBe('ready')

    claimReadyPath(sourceRoot, readyPath)
    expect(readReadyRunId(sourceRoot)).toBe('run-A')
    stampReadyBrowserLaunchFailed(sourceRoot, 'spawn /x/chrome EACCES')

    const failed = readReady()
    expect(failed.status).toBe('error')
    expect(failed.code).toBe('browser_launch_failed')
    expect(failed.browserLaunchFailedReason).toBe('spawn /x/chrome EACCES')

    // Every later stamp follows the claim, not only the launch failure.
    stampReadyBrowserLaunch(sourceRoot, {browserPid: 4242}, 'run-A')
    stampReadyBrowserExited(sourceRoot, 0, null, 'run-A', {beforeReady: true})

    const exited = readReady()
    expect(exited.browserPid).toBe(4242)
    expect(exited.code).toBe('browser_exited')
    expect(exited.browserExitedAt).toMatch(ISO_INSTANT)
  })

  it('leaves a more specific verdict already on the contract alone', () => {
    stampReadyProfileLocked(outputPath, {message: 'profile is locked'}, 'run-A')
    stampReadyBrowserLaunchFailed(outputPath, 'spawn /x/chrome EACCES', 'run-A')

    const ready = readReady()
    expect(ready.code).toBe('profile_locked')
    expect(ready.browserLaunchFailedAt).toBeUndefined()
  })

  it('never stamps a run it does not belong to', () => {
    stampReadyBrowserLaunchFailed(outputPath, 'spawn /x/chrome EACCES', 'run-B')

    expect(readReady().status).toBe('ready')
  })

  it('is cleared by a later launch that did produce a browser', () => {
    stampReadyBrowserLaunchFailed(outputPath, 'spawn /x/chrome EACCES', 'run-A')
    stampReadyBrowserLaunch(outputPath, {browserPid: 4242}, 'run-A')

    const ready = readReady()
    expect(ready.status).toBe('ready')
    expect(ready.code).toBeUndefined()
    expect(ready.message).toBeUndefined()
    expect(ready.browserLaunchFailedAt).toBeUndefined()
    expect(ready.browserLaunchFailedReason).toBeUndefined()
    expect(ready.browserPid).toBe(4242)
  })
})

describe('stampReadyCdpFault', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-cdp-fault-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        command: 'dev',
        browser: 'chrome',
        runId: 'run-A'
      })
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const readReady = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

  it('names the fault beside a status that stays ready', () => {
    stampReadyCdpFault(
      outputPath,
      'E_CDP_TIMEOUT',
      'ensureLoaded timeout (10000ms)',
      'run-A'
    )

    const ready = readReady()
    expect(ready.status).toBe('ready')
    expect(ready.code).toBeUndefined()
    expect(ready.cdpFaultCode).toBe('E_CDP_TIMEOUT')
    expect(ready.cdpFaultMessage).toBe('ensureLoaded timeout (10000ms)')
  })

  it('never stamps a run it does not belong to', () => {
    stampReadyCdpFault(outputPath, 'E_CDP_TIMEOUT', 'late', 'run-B')

    expect('cdpFaultCode' in readReady()).toBe(false)
  })

  it('is a no-op without a code, an output path or a contract', () => {
    stampReadyCdpFault(outputPath, '', 'late', 'run-A')
    stampReadyCdpFault(undefined, 'E_CDP_TIMEOUT', 'late', 'run-A')
    expect('cdpFaultCode' in readReady()).toBe(false)

    fs.rmSync(readyPath)
    expect(() =>
      stampReadyCdpFault(outputPath, 'E_CDP_TIMEOUT', 'late', 'run-A')
    ).not.toThrow()

    expect(fs.existsSync(readyPath)).toBe(false)
  })
})

// A Chromium dev compile waits at starting for the launcher, and the port, or
// the fault that stands in for it, is what tells a reader the launch is in.
describe('a held Chromium dev contract', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  const held = {
    command: 'dev',
    browser: 'chrome',
    runId: 'run-A',
    status: 'starting',
    compiledAt: '2026-11-01T00:00:00.000Z',
    browserPid: 4242,
    binary: '/browsers/chrome'
  }

  const read = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-held-cdp-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('goes ready on the CDP port, with the launch beside it', () => {
    fs.writeFileSync(readyPath, JSON.stringify(held))

    stampReadyCdpPort(outputPath, 9222, 'run-A')

    expect(read()).toMatchObject({
      status: 'ready',
      cdpPort: 9222,
      browserPid: 4242,
      binary: '/browsers/chrome'
    })
  })

  it('goes ready on a port an earlier write already named', () => {
    fs.writeFileSync(readyPath, JSON.stringify({...held, cdpPort: 9222}))

    stampReadyCdpPort(outputPath, 9222, 'run-A')

    expect(read().status).toBe('ready')
  })

  it('goes ready on the fault when the wire never came up', () => {
    fs.writeFileSync(readyPath, JSON.stringify(held))

    stampReadyCdpFault(outputPath, 'E_CDP_CONNECT', 'no endpoint', 'run-A')

    expect(read()).toMatchObject({
      status: 'ready',
      cdpFaultCode: 'E_CDP_CONNECT'
    })
  })

  it('stays at starting while the compile is not in, or the hello is owed', () => {
    fs.writeFileSync(readyPath, JSON.stringify({...held, compiledAt: null}))
    stampReadyCdpPort(outputPath, 9222, 'run-A')
    expect(read()).toMatchObject({status: 'starting', cdpPort: 9222})

    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        ...held,
        awaitingExecutorSince: '2026-11-01T00:00:00.000Z'
      })
    )

    stampReadyCdpPort(outputPath, 9222, 'run-A')
    expect(read()).toMatchObject({status: 'starting', cdpPort: 9222})
  })

  it.each([
    'start',
    'preview'
  ])('leaves a %s contract for the launch phase to turn ready', (command) => {
    fs.writeFileSync(readyPath, JSON.stringify({...held, command}))

    stampReadyCdpPort(outputPath, 9222, 'run-A')

    expect(read()).toMatchObject({status: 'starting', cdpPort: 9222})
  })

  it('takes no port from a run that is not the contract owner', () => {
    fs.writeFileSync(readyPath, JSON.stringify(held))

    stampReadyCdpPort(outputPath, 9222, 'run-B')

    expect(read().status).toBe('starting')
    expect(read().cdpPort).toBeUndefined()
  })
})

describe('describeLaunchFailure', () => {
  it('flattens a human frame to one plain line', () => {
    const framed = new Error(
      "\u001b[31m⏵⏵⏵\u001b[39m Can't find a Chromium binary at the given path.\n\u001b[90mNOT FOUND\u001b[39m /nowhere/chrome\nPass --chromium-binary with a working path."
    )

    expect(describeLaunchFailure(framed)).toBe(
      "Can't find a Chromium binary at the given path. NOT FOUND /nowhere/chrome Pass --chromium-binary with a working path."
    )
  })

  it('keeps a plain spawn error as is', () => {
    expect(describeLaunchFailure(new Error('spawn /x/chrome EACCES'))).toBe(
      'spawn /x/chrome EACCES'
    )

    expect(describeLaunchFailure('a string reason')).toBe('a string reason')
  })
})

describe('stampReadyBrowserExited on a dev session', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-exit-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        command: 'dev',
        browser: 'chrome',
        runId: 'run-A'
      })
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const readReady = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

  it('keeps the compile status when the browser leaves after ready', () => {
    stampReadyBrowserExited(outputPath, 0, null, 'run-A')

    const ready = readReady()
    expect(ready.status).toBe('ready')
    expect(ready.code).toBeUndefined()
    expect(ready.browserExitCode).toBe(0)
    expect(ready.browserExitedAt).toMatch(ISO_INSTANT)
  })

  it('flips to a browser_exited error when the browser leaves before ready', () => {
    stampReadyBrowserExited(outputPath, 0, null, 'run-A', {beforeReady: true})

    const ready = readReady()
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('browser_exited')
    expect(ready.message).toBe(
      'the chrome process exited (code 0) before the extension loaded, nothing is running'
    )

    expect(ready.browserExitCode).toBe(0)
  })

  it('names the signal when a browser that never loaded was killed', () => {
    stampReadyBrowserExited(outputPath, null, 'SIGKILL', 'run-A', {
      beforeReady: true
    })

    expect(readReady().message).toMatch(/\(signal SIGKILL\) before/)
  })
})

describe('a stamp from a superseded run', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  const freshContract = () => ({
    status: 'ready',
    command: 'dev',
    browser: 'chrome',
    runId: 'run-B',
    browserPid: 2222
  })

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-run-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(readyPath, JSON.stringify(freshContract()))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const readReady = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

  it('changes nothing on browser exit', () => {
    stampReadyBrowserExited(outputPath, 15, 'SIGTERM', 'run-A')

    expect(readReady()).toEqual(freshContract())
  })

  it('changes nothing on browser launch', () => {
    stampReadyBrowserLaunch(outputPath, {browserPid: 9999}, 'run-A')

    expect(readReady()).toEqual(freshContract())
  })

  it('changes nothing on a profile lock', () => {
    stampReadyProfileLocked(outputPath, {message: 'locked'}, 'run-A')

    expect(readReady()).toEqual(freshContract())
  })

  it('changes nothing on a load refusal', () => {
    stampReadyExtensionLoadRefused(outputPath, 'bad icon', 'run-A')

    expect(readReady()).toEqual(freshContract())
  })

  it('still stamps the run that owns the contract', () => {
    stampReadyBrowserExited(outputPath, 15, 'SIGTERM', 'run-B')

    const ready = readReady()
    expect(ready.browserExitCode).toBe(15)
    expect(ready.browserExitSignal).toBe('SIGTERM')
  })

  it('reads the run a later stamp has to carry', () => {
    expect(readReadyRunId(outputPath)).toBe('run-B')
    expect(readReadyRunId(undefined)).toBeUndefined()
    expect(readReadyRunId(path.join(tmp, 'dist', 'edge'))).toBeUndefined()
  })

  it('reads the run of a record this process wrote', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({...freshContract(), pid: process.pid})
    )

    expect(readReadyRunId(outputPath)).toBe('run-B')
  })

  it('gives no run of its own for a record another process wrote', () => {
    const foreign = {...freshContract(), pid: process.pid + 1, cdpPort: 9222}
    fs.writeFileSync(readyPath, JSON.stringify(foreign))

    const runId = readReadyRunId(outputPath)
    expect(runId).not.toBe('run-B')

    stampReadyBrowserLaunch(outputPath, {browserPid: 9999}, runId)
    stampReadyBrowserExited(outputPath, 15, 'SIGTERM', runId)

    expect(readReady()).toEqual(foreign)
  })
})

describe('readReadyExecutorAttached', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-attached-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('is false until the dev server stamps the attach', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready', runId: 'r1'}))
    expect(readReadyExecutorAttached(outputPath, 'r1')).toBe(false)

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    ready.executorAttachedAt = new Date().toISOString()
    fs.writeFileSync(readyPath, JSON.stringify(ready))
    expect(readReadyExecutorAttached(outputPath, 'r1')).toBe(true)
  })

  it("does not take another run's attach for this one", () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        runId: 'old',
        executorAttachedAt: new Date().toISOString()
      })
    )

    expect(readReadyExecutorAttached(outputPath, 'new')).toBe(false)
  })

  it('is false with no contract or an unreadable one', () => {
    expect(readReadyExecutorAttached(outputPath, 'r1')).toBe(false)
    fs.writeFileSync(readyPath, '{not json')
    expect(readReadyExecutorAttached(outputPath, 'r1')).toBe(false)
    expect(readReadyExecutorAttached(undefined, 'r1')).toBe(false)
  })
})

describe('stampReadyBrowserUpNotAttached', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-not-attached-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('records the wait beside a status that stays ready', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', browser: 'chrome', runId: 'r1'})
    )

    stampReadyBrowserUpNotAttached(
      outputPath,
      {waitedMs: 15000, hint: 'Chrome (pid 7) is up, but nothing connected'},
      'r1'
    )

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('ready')
    expect(ready.browserUpNotAttachedAt).toMatch(ISO_INSTANT)
    expect(ready.browserUpNotAttachedWaitMs).toBe(15000)
    expect(ready.browserUpNotAttachedHint).toBe(
      'Chrome (pid 7) is up, but nothing connected'
    )
  })

  it("leaves a foreign run's contract alone", () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready', runId: 'r2'}))

    stampReadyBrowserUpNotAttached(outputPath, {waitedMs: 1, hint: 'x'}, 'r1')

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect('browserUpNotAttachedAt' in ready).toBe(false)
  })

  it('stamps profileReused with the launch details', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready', runId: 'r1'}))

    stampReadyBrowserLaunch(
      outputPath,
      {profilePath: '/p', browserPid: 9, profileReused: true},
      'r1'
    )

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.profileReused).toBe(true)
    expect(ready.profilePath).toBe('/p')
  })
})

describe('stampReadyExtensionBaseUrl', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-base-'))
    outputPath = path.join(tmp, 'dist', 'firefox')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'firefox', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('publishes the moz-extension base beside the fields already there', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        browser: 'firefox',
        runId: 'run-A',
        extensionId: 'probe@temporary-addon',
        extensionIdSource: 'browser'
      })
    )

    stampReadyExtensionBaseUrl(
      outputPath,
      'moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/'
    )

    expect(JSON.parse(fs.readFileSync(readyPath, 'utf-8'))).toEqual({
      status: 'ready',
      browser: 'firefox',
      runId: 'run-A',
      extensionId: 'probe@temporary-addon',
      extensionIdSource: 'browser',
      extensionBaseUrl: 'moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/'
    })
  })

  it('keeps the base of a superseded run off the run that replaced it', () => {
    const owned = {status: 'ready', browser: 'firefox', runId: 'run-B'}

    fs.writeFileSync(readyPath, JSON.stringify(owned))
    stampReadyExtensionBaseUrl(
      outputPath,
      'moz-extension://host-1234/',
      'run-A'
    )

    expect(JSON.parse(fs.readFileSync(readyPath, 'utf-8'))).toEqual(owned)

    stampReadyExtensionBaseUrl(
      outputPath,
      'moz-extension://host-1234/',
      'run-B'
    )

    expect(
      JSON.parse(fs.readFileSync(readyPath, 'utf-8')).extensionBaseUrl
    ).toBe('moz-extension://host-1234/')
  })

  it('writes nothing without a base, an output path or a contract', () => {
    stampReadyExtensionBaseUrl(outputPath, 'moz-extension://host-1234/')
    expect(fs.existsSync(readyPath)).toBe(false)

    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
    stampReadyExtensionBaseUrl(outputPath, undefined)
    stampReadyExtensionBaseUrl(outputPath, '  ')
    stampReadyExtensionBaseUrl(undefined, 'moz-extension://host-1234/')

    expect(
      'extensionBaseUrl' in JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    ).toBe(false)
  })
})

describe('the time a launcher stamp leaves on the record', () => {
  const WRITTEN = '2026-11-01T00:00:00.000Z'
  const held = {command: 'dev', status: 'starting', compiledAt: WRITTEN}
  const up = {command: 'dev', status: 'ready', compiledAt: WRITTEN}

  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-ts-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const stamped = (
    record: Record<string, unknown>,
    stamp: (out: string) => void
  ) => {
    fs.writeFileSync(readyPath, JSON.stringify({...record, ts: WRITTEN}))
    stamp(outputPath)

    return JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
  }

  it.each<
    [string, Record<string, unknown>, (out: string) => void, 'ready' | 'error']
  >([
    ['the RDP port', held, (out) => stampReadyRdpPort(out, 6006), 'ready'],
    [
      'the reason there is no RDP port',
      held,
      (out) => stampReadyRdpPortError(out, 'never opened'),
      'ready'
    ],
    ['the CDP port', held, (out) => stampReadyCdpPort(out, 9222), 'ready'],
    [
      'a CDP fault',
      held,
      (out) => stampReadyCdpFault(out, 'E_CDP_PORT_CLOSED', 'closed'),
      'ready'
    ],
    [
      'a launch after one that failed',
      {
        ...up,
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedAt: WRITTEN
      },
      (out) => stampReadyBrowserLaunch(out, {profilePath: '/tmp/profile'}),
      'ready'
    ],
    [
      'a failed launch',
      up,
      (out) => stampReadyBrowserLaunchFailed(out, 'no binary'),
      'error'
    ],
    [
      'a refused load',
      up,
      (out) => stampReadyExtensionLoadRefused(out, 'bad manifest'),
      'error'
    ],
    [
      'a locked profile',
      up,
      (out) => stampReadyProfileLocked(out, {}),
      'error'
    ],
    [
      'a browser that left a start session',
      {...up, command: 'start'},
      (out) => stampReadyBrowserExited(out, 1),
      'error'
    ],
    [
      'a browser that left before the extension loaded',
      up,
      (out) =>
        stampReadyBrowserExited(out, 1, null, undefined, {
          beforeReady: true
        }),
      'error'
    ]
  ])('dates the status %s writes', (_name, record, stamp, status) => {
    const before = Date.now()
    const ready = stamped(record, stamp)

    expect(ready.status).toBe(status)
    expect(ready.ts).toMatch(ISO_INSTANT)
    expect(Date.parse(ready.ts)).toBeGreaterThanOrEqual(before)
  })

  it.each<[string, Record<string, unknown>, (out: string) => void]>([
    ['a port on a ready record', up, (out) => stampReadyRdpPort(out, 6006)],
    [
      'a port a held record still cannot go ready on',
      {...held, awaitingExecutorSince: WRITTEN},
      (out) => stampReadyCdpPort(out, 9222)
    ],
    [
      'the extension ID',
      up,
      (out) => stampReadyExtensionId(out, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    ],
    [
      'the extension base URL',
      up,
      (out) => stampReadyExtensionBaseUrl(out, 'moz-extension://host-1234/')
    ],
    [
      'the launch details',
      up,
      (out) => stampReadyBrowserLaunch(out, {profilePath: '/tmp/profile'})
    ],
    [
      'a browser flag',
      up,
      (out) => stampReadyDevBrowserFlag(out, {kind: '', value: '--flag'})
    ],
    [
      'a browser that left a dev session',
      up,
      (out) => stampReadyBrowserExited(out, 0)
    ],
    [
      'the hint that nothing attached',
      {...up, compiledAt: null},
      (out) =>
        stampReadyBrowserUpNotAttached(out, {waitedMs: 10_000, hint: 'hint'})
    ]
  ])('leaves the date alone for %s, a fact beside the status', (_name, record, stamp) => {
    const ready = stamped(record, stamp)

    expect(ready.status).toBe(record.status)
    expect(ready.ts).toBe(WRITTEN)
    expect(ready).not.toEqual({...record, ts: WRITTEN})
  })

  it('lets a waiting reader take an error the launcher wrote late as recent', () => {
    const ready = stamped({...up, command: 'start'}, (out) =>
      stampReadyBrowserExited(out, 1)
    )

    expect(ready.code).toBe('browser_exited')
    expect(isFreshContractPayload(ready)).toBe(true)
  })
})

describe('readyPathFor', () => {
  it('names the contract in the session root beside the build folder', () => {
    expect(readyPathFor('/work/app/dist/chrome')).toBe(
      path.join('/work/app/dist/extension-js/chrome/ready.json')
    )
  })

  it('follows a build folder that is not under dist, and keeps a relative one relative', () => {
    expect(readyPathFor('/work/app/build/firefox')).toBe(
      path.join('/work/app/build/extension-js/firefox/ready.json')
    )

    expect(readyPathFor(path.join('dist', 'edge'))).toBe(
      path.join('dist', 'extension-js', 'edge', 'ready.json')
    )
  })

  // A dev session always loads dist/<browser> (the dev server's output path),
  // so the launcher finds the record the engine writes for any browser name.
  it.each([
    'chrome',
    'brave',
    'chromium-based',
    'gecko-based',
    'safari'
  ])('names the record the engine writes for a %s dev build', (browser) => {
    const project = path.resolve('/', 'work', 'app')

    expect(readyPathFor(path.join(project, 'dist', browser))).toBe(
      readyContractPath(project, browser)
    )
  })
})

describe('managedProfileBaseDir', () => {
  it('sits in the session root beside a loaded build folder', () => {
    expect(managedProfileBaseDir('/work/app/dist/chrome', 'chrome')).toBe(
      path.resolve('/work/app/dist/extension-js/profiles/chrome-profile')
    )

    expect(
      earlierManagedProfileBaseDir('/work/app/dist/chrome', 'chrome')
    ).toBeUndefined()
  })

  it('stays in the project when the project folder itself is loaded', () => {
    claimReadyPath(
      '/work/unbuilt',
      '/work/unbuilt/dist/extension-js/chrome/ready.json'
    )

    expect(managedProfileBaseDir('/work/unbuilt', 'chrome')).toBe(
      path.resolve('/work/unbuilt/dist/extension-js/profiles/chrome-profile')
    )

    // Earlier versions climbed out of the project into its parent folder.
    expect(earlierManagedProfileBaseDir('/work/unbuilt', 'chrome')).toBe(
      path.resolve('/work/extension-js/profiles/chrome-profile')
    )
  })

  it('leaves the folder of a controlled copy for the one documented place', () => {
    const controlled = '/work/app/dist/extension-js/firefox/controlled'

    claimReadyPath(controlled, '/work/app/dist/extension-js/firefox/ready.json')

    expect(managedProfileBaseDir(controlled, 'firefox')).toBe(
      path.resolve('/work/app/dist/extension-js/profiles/firefox-profile')
    )

    expect(earlierManagedProfileBaseDir(controlled, 'firefox')).toBe(
      path.resolve(
        '/work/app/dist/extension-js/firefox/extension-js/profiles/firefox-profile'
      )
    )
  })
})

describe('clearReadyCdpPort', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-clear-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('takes the port off the record of the run that named it and keeps the rest', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({runId: 'run-1', status: 'ready', cdpPort: 9222})
    )

    clearReadyCdpPort(outputPath, 'run-1')

    expect(JSON.parse(fs.readFileSync(readyPath, 'utf8'))).toEqual({
      runId: 'run-1',
      status: 'ready'
    })
  })

  it('leaves the port a later run wrote', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({runId: 'run-2', status: 'ready', cdpPort: 9223})
    )

    clearReadyCdpPort(outputPath, 'run-1')

    expect(JSON.parse(fs.readFileSync(readyPath, 'utf8')).cdpPort).toBe(9223)
  })
})
