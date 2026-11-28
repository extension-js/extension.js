import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {BrowserLogger, CompilationLike} from '../../browsers-types'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../../run-chromium/chromium-launch'

// The private launch state the rows set up or read back.
interface LaunchInternals {
  closeHandlerContext: {
    command: 'dev' | 'preview' | 'start'
    extensionOutputPath?: string
    runId?: string
  } | null
  logger: BrowserLogger
  didReportReady: boolean
  readyDeferred: boolean
  profileReused: boolean
  browserGone: boolean
}

function internals(plugin: ChromiumLaunchPlugin) {
  return plugin as unknown as LaunchInternals
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

function makePlugin(tmp: string, runId = 'run-A') {
  const outputPath = path.join(tmp, 'dist', 'chrome')
  const readyPath = path.join(
    tmp,
    'dist',
    'extension-js',
    'chrome',
    'ready.json'
  )
  fs.mkdirSync(outputPath, {recursive: true})
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(
    path.join(outputPath, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'x', version: '1.0'})
  )

  fs.writeFileSync(
    readyPath,
    JSON.stringify({status: 'ready', browser: 'chrome', runId})
  )

  const plugin = new ChromiumLaunchPlugin(
    {browser: 'chrome', extension: [outputPath], dryRun: false},
    createChromiumContext()
  )
  internals(plugin).closeHandlerContext = {
    command: 'dev',
    extensionOutputPath: outputPath,
    runId
  }

  internals(plugin).logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }

  const reportReady = vi.fn(() => {
    internals(plugin).didReportReady = true
  })
  const compilation: CompilationLike = {options: {mode: 'development'}}

  return {plugin, outputPath, readyPath, reportReady, compilation}
}

function stampAttached(readyPath: string) {
  const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
  ready.runtime = 'attached'
  ready.executorAttachedAt = new Date().toISOString()
  fs.writeFileSync(readyPath, JSON.stringify(ready))
}

describe('the ready line waits for the dev runtime to attach', () => {
  let tmp: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-after-attach-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  function warned(): string {
    return [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => stripAnsi(String(call[0] ?? '')))
      .join('\n')
  }

  it('prints ready as soon as the contract shows the attach', async () => {
    const {plugin, readyPath, reportReady, compilation} = makePlugin(tmp)
    stampAttached(readyPath)

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      graceMs: 2_000,
      pollMs: 20
    })

    expect(reportReady).toHaveBeenCalledTimes(1)
    expect(warned()).not.toMatch(/has not connected/)
  })

  it('holds ready past the grace period and says what it is waiting on', async () => {
    const {plugin, readyPath, reportReady, compilation} = makePlugin(tmp)
    const profilePath = path.join(tmp, 'profile')
    fs.mkdirSync(profilePath)
    internals(plugin).profileReused = true

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      browserPid: 4242,
      profilePath,
      graceMs: 120,
      pollMs: 20
    })

    expect(reportReady).not.toHaveBeenCalled()
    const text = warned()
    expect(text).toMatch(
      /Chrome \(pid 4242\) is up, but the extension has not connected/
    )

    expect(text).toContain(profilePath)
    expect(text).toMatch(/had been run before/)
    expect(text).toMatch(/--profile <new path>/)

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('ready')
    expect(typeof ready.browserUpNotAttachedAt).toBe('string')
    expect(ready.browserUpNotAttachedWaitMs).toBe(120)
    expect(ready.browserUpNotAttachedHint).toMatch(/has not connected/)
    expect(ready.browserUpNotAttachedHint).not.toMatch(/\u001b\[/)
    expect(internals(plugin).readyDeferred).toBe(true)

    // The watch outlives the grace period: the first attach prints the line.
    stampAttached(readyPath)
    await vi.waitFor(() => expect(reportReady).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
      interval: 20
    })
  })

  it('describes a fresh profile differently from a reused one', async () => {
    const {plugin, reportReady, compilation} = makePlugin(tmp)
    internals(plugin).profileReused = false

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      profilePath: path.join(tmp, 'fresh'),
      graceMs: 60,
      pollMs: 20
    })

    expect(warned()).toMatch(/is fresh, so look at the browser window/)
    internals(plugin).browserGone = true
  })

  it('stops waiting when the browser leaves', async () => {
    const {plugin, reportReady, compilation} = makePlugin(tmp)
    setTimeout(() => {
      internals(plugin).browserGone = true
    }, 40)

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      graceMs: 5_000,
      pollMs: 10
    })

    expect(reportReady).not.toHaveBeenCalled()
    expect(warned()).not.toMatch(/has not connected/)
  })

  it('ignores an attach stamped by another run', async () => {
    const {plugin, readyPath, reportReady, compilation} = makePlugin(tmp)
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    ready.runId = 'run-B'
    ready.executorAttachedAt = new Date().toISOString()
    fs.writeFileSync(readyPath, JSON.stringify(ready))

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      graceMs: 60,
      pollMs: 20
    })

    expect(reportReady).not.toHaveBeenCalled()
    internals(plugin).browserGone = true
  })

  it('does not wait where nothing can attach', async () => {
    const {plugin, outputPath, reportReady, compilation} = makePlugin(tmp)

    // Production mode: the ready claim is about the build, not a runtime.
    await plugin.reportReadyWhenAttached({
      compilation: {options: {mode: 'production'}},
      enableCdp: true,
      reportReady,
      graceMs: 5_000
    })

    expect(reportReady).toHaveBeenCalledTimes(1)

    // No CDP: nothing downstream verifies the load either.
    internals(plugin).didReportReady = false
    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: false,
      reportReady,
      graceMs: 5_000
    })

    expect(reportReady).toHaveBeenCalledTimes(2)

    // A static theme ships no background, so no runtime ever connects.
    internals(plugin).didReportReady = false
    fs.writeFileSync(
      path.join(outputPath, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 't',
        version: '1.0',
        theme: {}
      })
    )

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      graceMs: 5_000
    })

    expect(reportReady).toHaveBeenCalledTimes(3)
  })

  // What the launcher asks its controller once the wait ran out.
  function controlledBy(
    plugin: ChromiumLaunchPlugin,
    controller: {
      guestDisableReasons: () => Promise<string[] | undefined>
      ensureDeveloperMode: () => Promise<string>
    }
  ) {
    ;(
      plugin as unknown as {ctx: {setController: (c: unknown) => void}}
    ).ctx.setController(controller)
  }

  it('turns developer mode on for a guest the browser turned off over it, then prints ready', async () => {
    const {plugin, readyPath, reportReady, compilation} = makePlugin(tmp)
    const ensureDeveloperMode = vi.fn(async () => {
      stampAttached(readyPath)

      return 'enabled'
    })

    controlledBy(plugin, {
      guestDisableReasons: async () => ['unsupportedDeveloperExtension'],
      ensureDeveloperMode
    })

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      graceMs: 120,
      pollMs: 20
    })

    expect(ensureDeveloperMode).toHaveBeenCalledTimes(1)
    expect(reportReady).toHaveBeenCalledTimes(1)
    expect(warned()).not.toMatch(/has not connected/)
  })

  it('names the reason when developer mode could not be turned on', async () => {
    const {plugin, reportReady, compilation} = makePlugin(tmp)
    internals(plugin).profileReused = true

    controlledBy(plugin, {
      guestDisableReasons: async () => ['unsupportedDeveloperExtension'],
      ensureDeveloperMode: async () => 'unavailable'
    })

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      browserPid: 4242,
      profilePath: path.join(tmp, 'profile'),
      graceMs: 120,
      pollMs: 20
    })

    expect(reportReady).not.toHaveBeenCalled()
    const text = warned()
    expect(text).toMatch(
      /Chrome \(pid 4242\) is up, but it turned the extension off \(unsupportedDeveloperExtension\), so it has not connected/
    )

    expect(text).toMatch(/switch on "Developer mode"/)
    expect(text).not.toMatch(/profile picker/)
    internals(plugin).browserGone = true
  })

  it('names any other reason and leaves developer mode alone', async () => {
    const {plugin, reportReady, compilation} = makePlugin(tmp)
    const ensureDeveloperMode = vi.fn(async () => 'enabled')

    controlledBy(plugin, {
      guestDisableReasons: async () => ['userAction'],
      ensureDeveloperMode
    })

    await plugin.reportReadyWhenAttached({
      compilation,
      enableCdp: true,
      reportReady,
      graceMs: 120,
      pollMs: 20
    })

    expect(ensureDeveloperMode).not.toHaveBeenCalled()
    expect(warned()).toMatch(/it turned the extension off \(userAction\)/)
    expect(warned()).toMatch(/turn the extension back on there/)
    internals(plugin).browserGone = true
  })
})
