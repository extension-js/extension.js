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
const openStartingUrlSpy = vi.fn(
  async (_url: string, _options?: {beforeNavigate?: () => void}) => 'navigated'
)
const evaluateInBackgroundSpy = vi.fn(
  async (_expression: string, _timeoutMs: number): Promise<unknown> => undefined
)
const releaseSessionSpy = vi.fn()
const openBackgroundSessionSpy = vi.fn(async () => ({
  evaluate: evaluateInBackgroundSpy,
  release: releaseSessionSpy
}))

vi.mock('../../run-chromium/cdp/cdp-extension-controller', () => {
  class CDPExtensionController {
    connect = connectSpy
    verifyGuestLoaded = verifyGuestLoadedSpy
    ensureLoaded = ensureLoadedSpy
    getInfoBestEffort = vi.fn(async () => null)
    openTab = vi.fn(async () => {})
    openStartingUrl = openStartingUrlSpy
    openBackgroundSession = openBackgroundSessionSpy
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
import {holdRefusalPredictions} from '../../browsers-lib/manifest-refusal'
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
    openStartingUrlSpy.mockClear()
    evaluateInBackgroundSpy.mockReset()
    releaseSessionSpy.mockClear()
    openBackgroundSessionSpy.mockClear()
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

    // The run ends on this refusal and its last frame carries the reason.
    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).not.toMatch(/refused to load this extension/i)

    expect(
      logSink.mock.calls.some((c) =>
        String(c[0]?.text || '').startsWith('extension_load_refused:')
      )
    ).toBe(true)
  })

  it('records a Manifest V2 refusal the session already said without printing it again', async () => {
    const {outPath, readyPath} = makeStartSession()
    const reason =
      'Cannot install extension because it uses an unsupported manifest version.'
    verifyGuestLoadedSpy.mockResolvedValue({status: 'refused', reason})

    const logSink = vi.fn()
    const plugin: Record<string, unknown> = {
      browser: 'chrome',
      logSink,
      launchRunId: 'run-start',
      manifestV2RefusalSaid: true
    }

    await runCheck(outPath, plugin)

    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(
      /refused to load this extension/i
    )

    const ready = readReady(readyPath)
    expect(ready.code).toBe('extension_load_refused')
    expect(ready.extensionLoadRefusedReason).toBe(reason)
    expect(plugin.extensionLoadRefused).toBe(reason)
    expect(
      logSink.mock.calls.some((c) =>
        String(c[0]?.text || '').startsWith('extension_load_refused:')
      )
    ).toBe(true)
  })

  it('prints no block for a refusal the preflight did not predict', async () => {
    const {outPath, readyPath} = makeStartSession()
    const reason =
      'This extension requires Google Chrome for Testing version 999 or greater.'
    verifyGuestLoadedSpy.mockResolvedValue({status: 'refused', reason})

    const plugin: Record<string, unknown> = {
      browser: 'chrome',
      launchRunId: 'run-start',
      manifestV2RefusalSaid: true
    }

    expect(await runCheck(outPath, plugin)).toBe('refused')

    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(
      /refused to load this extension/i
    )

    expect(readReady(readyPath).extensionLoadRefusedReason).toBe(reason)
    expect(plugin.extensionLoadRefused).toBe(reason)
  })

  // The preflight held its block for this answer: the browser's sentence is
  // the one reported, and a guest it took leaves the prediction to print.
  it('drops a held prediction on a refusal and keeps it for any other answer', async () => {
    for (const [outcome, kept] of [
      [{status: 'refused', reason: 'requires version 999'}, []],
      [{status: 'loaded', extensionId: 'a'.repeat(32)}, ['predicted block']],
      [{status: 'unknown'}, ['predicted block']]
    ] as const) {
      const {outPath} = makeStartSession()
      const printed: string[] = []
      const held = holdRefusalPredictions((message) => printed.push(message))

      held.hold('predicted block')
      verifyGuestLoadedSpy.mockResolvedValue(outcome)

      await runCheck(outPath, {
        browser: 'chrome',
        launchRunId: 'run-start',
        heldRefusalPredictions: held
      })

      held.flush()
      expect(printed).toEqual(kept)
    }
  })

  // The launch was made only to hear the browser, and its last frame carries
  // the reason, so the refusal is recorded and its block is not printed.
  it('records the sentence of the browser for a run the refusal ends', async () => {
    const {outPath, readyPath} = makeStartSession()
    const reason =
      'Cannot install extension because it uses an unsupported manifest version.'
    verifyGuestLoadedSpy.mockResolvedValue({status: 'refused', reason})

    const logSink = vi.fn()
    const plugin: Record<string, unknown> = {
      browser: 'chrome',
      logSink,
      launchRunId: 'run-start',
      loadRefusalEndsRun: true,
      startingUrl: 'https://example.com/'
    }

    expect(await runCheck(outPath, plugin)).toBe('refused')

    const ready = readReady(readyPath)
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('extension_load_refused')
    expect(ready.extensionLoadRefusedReason).toBe(reason)
    expect(ready.message).toContain(reason)
    expect(plugin.extensionLoadRefused).toBe(reason)
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(
      /refused to load this extension/i
    )

    expect(openStartingUrlSpy).not.toHaveBeenCalled()
    expect(
      logSink.mock.calls.some((c) =>
        String(c[0]?.text || '').startsWith('extension_load_refused:')
      )
    ).toBe(true)
  })

  it('opens no page when a run that ends on refusal gets no answer', async () => {
    const {outPath, readyPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({status: 'unknown'})

    expect(
      await runCheck(outPath, {
        browser: 'chrome',
        launchRunId: 'run-start',
        loadRefusalEndsRun: true,
        startingUrl: 'https://example.com/'
      })
    ).toBe('unknown')

    expect(openStartingUrlSpy).not.toHaveBeenCalled()
    expect(readReady(readyPath).extensionLoadRefusedReason).toBeUndefined()
  })

  it('keeps the session when the browser takes a guest called refused', async () => {
    const {outPath, readyPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    expect(
      await runCheck(outPath, {
        browser: 'chrome',
        launchRunId: 'run-start',
        loadRefusalEndsRun: true,
        startingUrl: 'https://example.com/'
      })
    ).toBe('loaded')

    expect(openStartingUrlSpy.mock.calls[0][0]).toBe('https://example.com/')
    expect(readReady(readyPath).status).toBe('ready')
  })

  // A start session opens about:blank, so the starting page loads once the
  // guest is in the browser and its document_start CSS can reach it.
  it('opens the starting url once the guest has loaded', async () => {
    const {outPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    await runCheck(outPath, {
      browser: 'chrome',
      startingUrl: 'https://example.com/'
    })

    expect(openStartingUrlSpy.mock.calls[0][0]).toBe('https://example.com/')
    expect(verifyGuestLoadedSpy.mock.invocationCallOrder[0]).toBeLessThan(
      openStartingUrlSpy.mock.invocationCallOrder[0]
    )
  })

  // A production build has no dev server to say the registrations landed,
  // so the background is asked before the page is.
  it('asks the background for its boot registrations before the starting url', async () => {
    const {outPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    evaluateInBackgroundSpy.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))

      return {outcome: 'settled', count: 2, looks: 3, waitedMs: 50}
    })

    await runCheck(outPath, {
      browser: 'chrome',
      startingUrl: 'https://example.com/',
      bootRegistrationsFromBackground: true
    })

    expect(evaluateInBackgroundSpy).toHaveBeenCalledTimes(1)
    expect(evaluateInBackgroundSpy.mock.calls[0][0]).toContain(
      'getRegisteredContentScripts'
    )

    expect(evaluateInBackgroundSpy.mock.calls[0][1]).toBe(5000)
    expect(evaluateInBackgroundSpy.mock.invocationCallOrder[0]).toBeLessThan(
      openStartingUrlSpy.mock.invocationCallOrder[0]
    )

    expect(openStartingUrlSpy.mock.calls[0][0]).toBe('https://example.com/')
    // A registry that was filled in time leaves nothing to watch for.
    expect(evaluateInBackgroundSpy).toHaveBeenCalledTimes(1)
    expect(releaseSessionSpy).toHaveBeenCalledTimes(1)
  })

  // The page opened on an empty registry, so the same session keeps reading
  // and says so when a registration follows.
  it('says so in one line when a registration lands after the starting url', async () => {
    const {outPath} = makeStartSession()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    evaluateInBackgroundSpy
      .mockResolvedValueOnce({outcome: 'none', count: 0, looks: 2, ageMs: 160})
      .mockResolvedValueOnce({count: 0, ageMs: 300})
      .mockResolvedValue({count: 2, ageMs: 1240})

    await runCheck(outPath, {
      browser: 'chrome',
      startingUrl: 'https://example.com/',
      bootRegistrationsFromBackground: true
    })

    expect(openStartingUrlSpy).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => expect(releaseSessionSpy).toHaveBeenCalledTimes(1))

    const printed = [
      ...warnSpy.mock.calls,
      ...logSpy.mock.calls,
      ...errorSpy.mock.calls
    ]
      .map((call) => String(call[0]))
      .filter((line) => line.includes('registered a content script'))

    warnSpy.mockRestore()
    logSpy.mockRestore()

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('1.2s after it started')
    expect(openBackgroundSessionSpy).toHaveBeenCalledTimes(1)
    expect(evaluateInBackgroundSpy.mock.invocationCallOrder[1]).toBeGreaterThan(
      openStartingUrlSpy.mock.invocationCallOrder[0]
    )
  })

  it('asks the background nothing when its files name no registration', async () => {
    const {outPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    await runCheck(outPath, {
      browser: 'chrome',
      startingUrl: 'https://example.com/'
    })

    expect(openBackgroundSessionSpy).not.toHaveBeenCalled()
    expect(evaluateInBackgroundSpy).not.toHaveBeenCalled()
    expect(openStartingUrlSpy).toHaveBeenCalledTimes(1)
  })

  it('asks the background nothing when no page will open', async () => {
    const {outPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    await runCheck(outPath, {
      browser: 'chrome',
      bootRegistrationsFromBackground: true
    })

    expect(openBackgroundSessionSpy).not.toHaveBeenCalled()
    expect(evaluateInBackgroundSpy).not.toHaveBeenCalled()
  })

  it('still opens the starting url when the background cannot be asked', async () => {
    const {outPath} = makeStartSession()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    evaluateInBackgroundSpy.mockRejectedValue(new Error('target closed'))

    await runCheck(outPath, {
      browser: 'chrome',
      startingUrl: 'https://example.com/',
      bootRegistrationsFromBackground: true
    })

    const printed = [
      ...warnSpy.mock.calls,
      ...logSpy.mock.calls,
      ...errorSpy.mock.calls
    ]
      .map((call) => String(call[0]))
      .filter((line) =>
        line.includes('before the background finished registering')
      )

    warnSpy.mockRestore()
    logSpy.mockRestore()

    expect(printed).toHaveLength(1)
    expect(openStartingUrlSpy.mock.calls[0][0]).toBe('https://example.com/')
    expect(releaseSessionSpy).toHaveBeenCalledTimes(1)
  })

  it('opens no starting url for a refused guest', async () => {
    const {outPath} = makeStartSession()
    verifyGuestLoadedSpy.mockResolvedValue({status: 'refused', reason: 'no'})

    await runCheck(outPath, {
      browser: 'chrome',
      startingUrl: 'https://example.com/'
    })

    expect(openStartingUrlSpy).not.toHaveBeenCalled()
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
  // Only a dev session prints this block: a run-only launch ends on the
  // refusal, and its last frame says to run the command again.
  it('tells a dev session to save, on either engine', async () => {
    const messages = await import('../../browsers-lib/messages')

    for (const text of [
      messages.chromiumExtensionLoadRefused('/dist/chrome', 'no'),
      messages.geckoAddonLoadRefused('/dist/firefox', 'no')
    ]) {
      expect(text).toContain('Fix the reason above and save.')
      expect(text).toContain('restart the dev session')
    }
  })

  it('ends a run-only launch with one frame for either engine', async () => {
    const messages = await import('../../browsers-lib/messages')

    for (const browser of ['chrome', 'firefox']) {
      const text = messages.browserRefusesTheExtension(
        browser,
        `/dist/${browser}`,
        'no'
      )

      expect(text).toContain('refuses to load this extension')
      expect(text).toContain('REASON no')
      expect(text).toContain(
        'Fix what the browser names, then run the command again.'
      )

      expect(text).not.toContain('save')
    }
  })
})
