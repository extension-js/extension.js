import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  readReadyRunId,
  stampReadyBrowserExited,
  stampReadyBrowserLaunch,
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
