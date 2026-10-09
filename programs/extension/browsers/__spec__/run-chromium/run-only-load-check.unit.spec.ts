import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const verifyGuestLoadedSpy = vi.fn()
const ensureLoadedSpy = vi.fn()
const connectSpy = vi.fn(async () => {})

vi.mock('../../run-chromium/cdp/cdp-extension-controller', () => {
  class CDPExtensionController {
    connect = connectSpy
    verifyGuestLoaded = verifyGuestLoadedSpy
    ensureLoaded = ensureLoadedSpy
    getInfoBestEffort = vi.fn(async () => null)
    openTab = vi.fn(async () => {})
  }

  return {CDPExtensionController}
})

vi.mock('../../browsers-lib/banner', () => ({
  printDevBannerOnce: vi.fn(async () => true),
  printProdBannerOnce: vi.fn(async () => true)
}))

// No develop bridge: wait mode falls back to the plain dist/extension-js path.
vi.mock('../../../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => {
    throw new Error('no bridge in this spec')
  })
}))

import {runWaitMode} from '../../../commands/dev-wait'
import * as banner from '../../browsers-lib/banner'
import {browserConfig} from '../../run-chromium/chromium-launch/browser-config'
import {verifyGuestLoadAfterLaunch} from '../../run-chromium/chromium-launch/setup-cdp-after-launch'

const tempDirs: string[] = []

// A `start` session as extensionPreview leaves it before the launch returns:
// the contract exists, the launcher fills in what it learns about the browser.
function makeStartSession(): {
  root: string
  outPath: string
  readyPath: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-only-load-check-'))
  tempDirs.push(root)
  const outPath = path.join(root, 'dist', 'chrome')
  const readyPath = path.join(
    root,
    'dist',
    'extension-js',
    'chrome',
    'ready.json'
  )
  fs.mkdirSync(outPath, {recursive: true})
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}')
  fs.writeFileSync(
    path.join(outPath, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      content_security_policy: {
        extension_pages: "script-src 'self' 'unsafe-inline'"
      }
    })
  )

  fs.writeFileSync(
    readyPath,
    JSON.stringify({
      status: 'ready',
      command: 'start',
      browser: 'chrome',
      runId: 'run-start',
      pid: process.pid,
      ts: new Date().toISOString(),
      browserPid: 4242,
      errors: []
    })
  )

  return {root, outPath, readyPath}
}

const runOnlyArgs = (outPath: string) => [
  `--load-extension=${outPath}`,
  '--remote-debugging-port=9333',
  '--remote-debugging-pipe'
]

const readReady = (readyPath: string) =>
  JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

describe('run-only launch flags', () => {
  const compilation = (outPath: string) =>
    ({options: {mode: 'production', output: {path: outPath}}}) as any

  it('opens the debugging wire for a production launch that asks for it', () => {
    const {outPath} = makeStartSession()
    const flags = browserConfig(
      compilation(outPath),
      {browser: 'chrome', extension: [outPath], profile: false} as any,
      {provision: false, cdp: true}
    )

    expect(flags).toContain('--remote-debugging-pipe')
    expect(flags.some((f) => f.startsWith('--remote-debugging-port='))).toBe(
      true
    )
  })

  it('keeps a production launch without the wire when nobody asks', () => {
    const {outPath} = makeStartSession()
    const flags = browserConfig(
      compilation(outPath),
      {browser: 'chrome', extension: [outPath], profile: false} as any,
      {provision: false}
    )

    expect(flags.some((f) => f.startsWith('--remote-debugging-'))).toBe(false)
  })
})

describe('verifyGuestLoadAfterLaunch (run-only load evidence)', () => {
  let errorSpy: MockInstance<typeof console.error>

  beforeEach(() => {
    verifyGuestLoadedSpy.mockReset()
    ensureLoadedSpy.mockReset()
    connectSpy.mockClear()
    ;(banner.printDevBannerOnce as any).mockClear()
    ;(banner.printProdBannerOnce as any).mockClear()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()

    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop() as string, {recursive: true, force: true})
    }
  })

  const runCheck = (outPath: string, plugin: Record<string, unknown>) =>
    verifyGuestLoadAfterLaunch(
      {options: {mode: 'production', output: {path: outPath}}} as any,
      plugin as any,
      runOnlyArgs(outPath),
      undefined
    )

  it('reads a refused manifest off the start contract with the cdp port', async () => {
    const {outPath, readyPath} = makeStartSession()
    const reason =
      "'content_security_policy.extension_pages': Insecure CSP value \"'unsafe-inline'\" in directive 'script-src'."
    verifyGuestLoadedSpy.mockResolvedValue({status: 'refused', reason})

    const logSink = vi.fn()
    const plugin: Record<string, unknown> = {
      browser: 'chrome',
      logSink,
      launchRunId: 'run-start'
    }

    await runCheck(outPath, plugin)

    const ready = readReady(readyPath)
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('extension_load_refused')
    expect(ready.cdpPort).toBe(9333)
    expect(typeof ready.extensionLoadRefusedAt).toBe('string')
    expect(ready.extensionLoadRefusedReason).toBe(reason)
    // The browser is still the one the launch stamped.
    expect(ready.browserPid).toBe(4242)

    expect(plugin.extensionLoadRefused).toBe(reason)
    // The pipe is the browser's lifeline, so the controller stays held.
    expect(plugin.cdpController).toBeDefined()

    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toMatch(/refused to load this extension/i)
    expect(printed).toContain('rebuild, and run the command again')
    expect(printed).not.toContain('restart the dev session')

    expect(
      logSink.mock.calls.some((c) =>
        String(c[0]?.text || '').startsWith('extension_load_refused:')
      )
    ).toBe(true)
  })

  it('stamps the cdp port and leaves a loaded guest ready', async () => {
    const {outPath, readyPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    const plugin: Record<string, unknown> = {
      browser: 'chrome',
      launchRunId: 'run-start'
    }

    await runCheck(outPath, plugin)

    const ready = readReady(readyPath)
    expect(ready.status).toBe('ready')
    expect(ready.code).toBeUndefined()
    expect(ready.cdpPort).toBe(9333)
    expect(ready.extensionLoadRefusedAt).toBeUndefined()
    expect(plugin.extensionLoadRefused).toBeUndefined()
  })

  // Run-only has no reload to deliver, so the dev-only wiring stays out.
  it('asks the load question and nothing else', async () => {
    const {outPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({status: 'loaded', extensionId: 'x'})

    await runCheck(outPath, {browser: 'chrome'})

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(ensureLoadedSpy).not.toHaveBeenCalled()
    expect(banner.printDevBannerOnce).not.toHaveBeenCalled()
    expect(banner.printProdBannerOnce).not.toHaveBeenCalled()
  })

  it('leaves a contract owned by another run alone', async () => {
    const {outPath, readyPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({status: 'refused', reason: 'no'})

    await runCheck(outPath, {browser: 'chrome', launchRunId: 'older-run'})

    const ready = readReady(readyPath)
    expect(ready.status).toBe('ready')
    expect(ready.cdpPort).toBeUndefined()
    expect(ready.extensionLoadRefusedAt).toBeUndefined()
  })

  it('fails start --wait on the refusal the check recorded', async () => {
    const {root, outPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'refused',
      reason: 'Insecure CSP value'
    })

    await runCheck(outPath, {browser: 'chrome', launchRunId: 'run-start'})

    const error = await runWaitMode({
      command: 'start',
      pathOrRemoteUrl: root,
      browsers: ['chrome'],
      waitTimeout: '3000',
      waitFormat: 'json'
    }).then(
      () => null,
      (e: unknown) => e as Error & {code?: string}
    )

    expect(error).toBeInstanceOf(Error)
    expect(error?.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(error?.message).toContain('Insecure CSP value')
  })
})

describe('load refusal recovery line', () => {
  // A run-only session has no watcher, so "save" would promise a reload
  // that never comes, on either engine.
  it('tells a run-only session to rebuild and run again', async () => {
    const messages = await import('../../browsers-lib/messages')

    for (const text of [
      messages.chromiumExtensionLoadRefused('/dist/chrome', 'no', {
        runOnly: true
      }),
      messages.geckoAddonLoadRefused('/dist/firefox', 'no', {runOnly: true})
    ]) {
      expect(text).toContain('rebuild, and run the command again')
      expect(text).not.toContain('restart the dev session')
    }

    for (const text of [
      messages.chromiumExtensionLoadRefused('/dist/chrome', 'no'),
      messages.geckoAddonLoadRefused('/dist/firefox', 'no')
    ]) {
      expect(text).toContain('Fix the reason above and save.')
      expect(text).toContain('restart the dev session')
    }
  })
})
