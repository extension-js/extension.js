import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  claimReadyPath,
  describeLaunchFailure,
  readReadyRunId,
  stampReadyBrowserExited,
  stampReadyBrowserLaunch,
  stampReadyBrowserLaunchFailed,
  stampReadyExtensionId,
  stampReadyExtensionLoadRefused,
  stampReadyProfileLocked,
  stampReadyRdpPort
} from '../browsers-lib/ready-stamp'

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
    expect(ready.browserPid).toBe(4242)
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

    expect(typeof ready.browserLaunchFailedAt).toBe('string')
    expect(ready.browserLaunchFailedReason).toBe('spawn /x/chrome EACCES')
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
    expect(typeof exited.browserExitedAt).toBe('string')
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
    expect(typeof ready.browserExitedAt).toBe('string')
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
})
